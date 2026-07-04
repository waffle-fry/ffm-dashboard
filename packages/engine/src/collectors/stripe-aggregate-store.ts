// StripeAggregateStore — incremental, per-UTC-day aggregation of Stripe money
// movements, so the StripeCollector does not re-paginate the whole reporting
// window on every poll.
//
// Why this exists
// ---------------
// A high-volume Stripe account accumulates thousands of balance transactions
// and charges per month. Re-fetching and re-summing the entire month on every
// 5-minute poll does not scale (pagination time grows through the month and
// eventually exceeds any reasonable per-source timeout). Instead this store:
//
//   1. keeps a small running aggregate PER UTC DAY (gross/net/fees, positive
//      gross volume, and successful/failed/refund counts);
//   2. ingests only the DELTA since the last successful poll (the collector
//      fetches `created >= lastSync - overlap`), de-duplicating by object id so
//      the overlap re-fetch never double-counts;
//   3. answers period queries (day/week/month) by summing the day buckets in
//      the range — which is exactly equal to summing the raw transactions whose
//      timestamps fall in the period, because periods align to UTC-day
//      boundaries.
//
// Period rollover needs no special handling: "today", "this week", and "this
// month" are just different day-key ranges over the same buckets, so a new day
// starting simply changes which buckets are summed.
//
// Refund semantics
// ----------------
// Refund counts come from balance transactions of type `refund` (each refund is
// a distinct money movement with its own `created` time), NOT from a charge's
// mutable `refunded` flag. A charge's refund can happen days after the charge
// was created; tracking it via the charge flag would require re-fetching old
// charges (defeating incrementality). Counting refund *events* is both
// incremental-friendly and a more faithful "refunds in this period" measure.

/** A balance transaction as consumed by the store (minor units; `created` is Unix seconds). */
export interface AggregatableBalanceTxn {
    id: string;
    /** Stripe balance-transaction type, e.g. 'charge' | 'payment' | 'refund' | 'payout'. */
    type: string;
    amount: number;
    net: number;
    fee: number;
    created: number;
}

/** A charge as consumed by the store (`created` is Unix seconds). */
export interface AggregatableCharge {
    id: string;
    created: number;
    status: string;
}

/** Aggregated totals for a query period, in MAJOR units (counts are integers). */
export interface PeriodTotals {
    gross: number;
    net: number;
    fees: number;
    /** Sum of positive balance-transaction amounts (gross volume). */
    positiveGross: number;
    successful: number;
    failed: number;
    refunds: number;
}

/** Balance-transaction type that represents a refund money movement. */
export const REFUND_BALANCE_TXN_TYPE = 'refund';

/** Charge status counted as a successful payment. */
const SUCCEEDED = 'succeeded';
/** Charge status counted as a failed payment. */
const FAILED = 'failed';

const SECONDS_PER_DAY = 24 * 60 * 60;
const MINOR_UNITS_PER_MAJOR = 100;

/** Per-UTC-day running aggregate. All monetary fields are integer minor units. */
interface DayBucket {
    grossMinor: number;
    netMinor: number;
    feeMinor: number;
    positiveGrossMinor: number;
    successful: number;
    failed: number;
    refunds: number;
}

function emptyBucket(): DayBucket {
    return {
        grossMinor: 0,
        netMinor: 0,
        feeMinor: 0,
        positiveGrossMinor: 0,
        successful: 0,
        failed: 0,
        refunds: 0,
    };
}

/** The UTC calendar-day key ('YYYY-MM-DD') for a Unix-seconds timestamp. */
function dayKeyOf(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Construction options for {@link StripeAggregateStore}. */
export interface StripeAggregateStoreOptions {
    /**
     * How many days of day-buckets to retain. Must comfortably exceed the
     * widest reporting window (a month, plus a week that can begin before the
     * 1st). Older buckets are pruned to bound memory. Default 45.
     */
    retentionDays?: number;
    /**
     * How long (seconds) to remember ingested object ids for de-duplication.
     * Must exceed the collector's overlap window (older items are never
     * re-fetched, so their ids can be forgotten). Default 3600 (1 hour).
     */
    dedupWindowSec?: number;
}

/**
 * Incremental per-day aggregate store. Not thread-safe, but the collector runs
 * a single refresh at a time (the scheduler serialises Stripe refreshes), so
 * ingest/query calls never overlap.
 */
export class StripeAggregateStore {
    private readonly buckets = new Map<string, DayBucket>();
    /** id -> created (Unix seconds), for de-duplicating overlap re-fetches. */
    private readonly seen = new Map<string, number>();
    private lastSyncUnix: number | null = null;
    private readonly retentionDays: number;
    private readonly dedupWindowSec: number;

    constructor(options: StripeAggregateStoreOptions = {}) {
        this.retentionDays = options.retentionDays ?? 45;
        this.dedupWindowSec = options.dedupWindowSec ?? 3600;
    }

    /** True once at least one ingest cycle has completed (i.e. not a cold start). */
    hasSynced(): boolean {
        return this.lastSyncUnix !== null;
    }

    /** Unix-seconds high-water mark of the last sync, or null before the first. */
    getLastSyncUnix(): number | null {
        return this.lastSyncUnix;
    }

    private bucketFor(key: string): DayBucket {
        let bucket = this.buckets.get(key);
        if (bucket === undefined) {
            bucket = emptyBucket();
            this.buckets.set(key, bucket);
        }
        return bucket;
    }

    /**
     * Ingests balance transactions, skipping any id already seen (overlap
     * de-duplication). Updates gross/net/fees, positive gross volume, and refund
     * counts (type === 'refund').
     */
    ingestBalanceTransactions(txns: Iterable<AggregatableBalanceTxn>): void {
        for (const txn of txns) {
            const dedupKey = `bt:${txn.id}`;
            if (this.seen.has(dedupKey)) {
                continue;
            }
            this.seen.set(dedupKey, txn.created);
            const bucket = this.bucketFor(dayKeyOf(txn.created));
            bucket.grossMinor += txn.amount;
            bucket.netMinor += txn.net;
            bucket.feeMinor += txn.fee;
            if (txn.amount > 0) {
                bucket.positiveGrossMinor += txn.amount;
            }
            if (txn.type === REFUND_BALANCE_TXN_TYPE) {
                bucket.refunds += 1;
            }
        }
    }

    /**
     * Ingests charges, skipping any id already seen. Counts successful and
     * failed payments by the charge's (immutable) status. Refunds are NOT taken
     * from charges — see the module header.
     */
    ingestCharges(charges: Iterable<AggregatableCharge>): void {
        for (const charge of charges) {
            const dedupKey = `ch:${charge.id}`;
            if (this.seen.has(dedupKey)) {
                continue;
            }
            this.seen.set(dedupKey, charge.created);
            const bucket = this.bucketFor(dayKeyOf(charge.created));
            if (charge.status === SUCCEEDED) {
                bucket.successful += 1;
            } else if (charge.status === FAILED) {
                bucket.failed += 1;
            }
        }
    }

    /** Records the high-water mark for the next incremental fetch. */
    markSynced(nowUnix: number): void {
        this.lastSyncUnix = nowUnix;
    }

    /**
     * Sums the day buckets whose UTC day falls within [periodStart, now].
     *
     * Because periods align to UTC-day boundaries, this equals the sum over the
     * raw transactions whose timestamps fall in the period. Monetary totals are
     * converted from minor to major units.
     */
    periodTotals(periodStart: Date, now: Date): PeriodTotals {
        const startKey = dayKeyOf(Math.floor(periodStart.getTime() / 1000));
        const endKey = dayKeyOf(Math.floor(now.getTime() / 1000));

        let grossMinor = 0;
        let netMinor = 0;
        let feeMinor = 0;
        let positiveGrossMinor = 0;
        let successful = 0;
        let failed = 0;
        let refunds = 0;

        for (const [key, bucket] of this.buckets) {
            // 'YYYY-MM-DD' strings compare chronologically.
            if (key < startKey || key > endKey) {
                continue;
            }
            grossMinor += bucket.grossMinor;
            netMinor += bucket.netMinor;
            feeMinor += bucket.feeMinor;
            positiveGrossMinor += bucket.positiveGrossMinor;
            successful += bucket.successful;
            failed += bucket.failed;
            refunds += bucket.refunds;
        }

        return {
            gross: grossMinor / MINOR_UNITS_PER_MAJOR,
            net: netMinor / MINOR_UNITS_PER_MAJOR,
            fees: feeMinor / MINOR_UNITS_PER_MAJOR,
            positiveGross: positiveGrossMinor / MINOR_UNITS_PER_MAJOR,
            successful,
            failed,
            refunds,
        };
    }

    /**
     * Drops buckets older than the retention window and seen-ids older than the
     * de-dup window, bounding memory over long-running processes.
     */
    prune(now: Date): void {
        const nowUnix = Math.floor(now.getTime() / 1000);
        const bucketCutoffKey = dayKeyOf(nowUnix - this.retentionDays * SECONDS_PER_DAY);
        for (const key of this.buckets.keys()) {
            if (key < bucketCutoffKey) {
                this.buckets.delete(key);
            }
        }
        const dedupCutoff = nowUnix - this.dedupWindowSec;
        for (const [id, created] of this.seen) {
            if (created < dedupCutoff) {
                this.seen.delete(id);
            }
        }
    }
}
