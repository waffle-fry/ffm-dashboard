// StripeCollector — aggregates Stripe data into the revenue, disputes,
// transactions and summary metrics (Requirements 3.1, 3.2, 3.3, 6.1, 6.3, 9.1,
// 9.2, 10.1, 10.2, 10.3, 10.4).
//
// This collector is the write-side source for four cache entries:
//   - `revenue`      -> RevenueMetrics       (gross/net/fees + payment counts per period)
//   - `disputes`     -> DisputeMetrics        (open disputes, countdown, ordering)
//   - `transactions` -> TransactionFeedMetrics (20 most recent successful payments)
//   - `summary`      -> PlatformSummaryMetrics (lifetime volume, take/dispute rate, ...)
//
// Dependency-injection design
// ----------------------------
// To keep this collector unit-testable and free of any hard dependency on the
// `stripe` SDK, it consumes a narrowly-typed {@link StripeClientPort} rather
// than the SDK directly. The port describes ONLY the reads this collector
// performs (balance transactions, charges, disputes, recent charges) and hands
// back plain arrays — the SDK wiring, pagination and auth live in task 8.1.
//
// Unit conventions
// ----------------
// Stripe reports monetary amounts in the currency's *minor* units (pence for
// GBP). To avoid floating-point drift, sums are accumulated in integer minor
// units and converted to major units exactly once before formatting. All date
// boundaries are UTC (see ../utils/time-boundaries.js) so results are timezone
// independent.

import type {
    DisputeItem,
    DisputeMetrics,
    DisputeStatus,
    PeriodMetrics,
    PlatformSummaryMetrics,
    RevenueMetrics,
    TransactionFeedMetrics,
} from '@fans-fund-me/shared';

import type { CollectedMetrics, MetricCollector } from '../aggregator/scheduler.js';
import type { MetricKey } from '../cache/metrics-cache.js';

import { calculateAverage, calculateDisputeRate, calculateTakeRate } from '../utils/calculations.js';
import { sumUsdBalances } from '../utils/balances.js';
import { calculateDaysRemaining, isOpenDispute } from '../utils/disputes.js';
import { formatMoney } from '../utils/formatting.js';
import {
    getStartOfDay,
    getStartOfMonth,
    getStartOfWeek,
    isWithinPeriod,
} from '../utils/time-boundaries.js';
import { stripPii, type RawTransaction } from '../utils/transactions.js';
import {
    StripeAggregateStore,
    type PeriodTotals,
} from './stripe-aggregate-store.js';

// ---------------------------------------------------------------------------
// Narrow Stripe data shapes — only the fields this collector reads.
// ---------------------------------------------------------------------------

/**
 * A Stripe balance transaction: a money movement on the Stripe balance. All
 * monetary fields are in minor units (e.g. pence) and `created` is a Unix
 * timestamp in seconds.
 */
export interface StripeBalanceTransactionRecord {
    /** Balance-transaction id, e.g. "txn_...". Used to de-duplicate incremental fetches. */
    id: string;
    /** Balance-transaction type, e.g. 'charge' | 'payment' | 'refund' | 'payout'. */
    type: string;
    /** Gross amount of the movement, minor units (can be negative, e.g. refunds). */
    amount: number;
    /** Net amount after fees, minor units. */
    net: number;
    /** Stripe fee for the movement, minor units. */
    fee: number;
    /** Creation time, Unix seconds. */
    created: number;
}

/** A Stripe charge (payment attempt). Monetary fields in minor units. */
export interface StripeChargeRecord {
    /** Full charge id, e.g. "ch_3P...". Truncated before it reaches the feed. */
    id: string;
    /** Charge amount, minor units. */
    amount: number;
    /** ISO 4217 currency code, e.g. "gbp". */
    currency: string;
    /** Creation time, Unix seconds. */
    created: number;
    /** Outcome of the charge. */
    status: 'succeeded' | 'pending' | 'failed';
    /** Whether the charge has been fully refunded. */
    refunded: boolean;
    /** Amount refunded so far, minor units. */
    amount_refunded: number;
}

/** A Stripe dispute (chargeback). Monetary fields in minor units. */
export interface StripeDisputeRecord {
    /** Dispute id, e.g. "dp_...". */
    id: string;
    /** Disputed amount, minor units. */
    amount: number;
    /** Id of the disputed charge — a "ch_..." id. */
    charge: string;
    /**
     * Id of the payment intent the dispute is attached to — a "pi_..." id, or
     * null when the charge was not created via a PaymentIntent. This is the id
     * used to key the S3 evidence folders (`batches/<n>/<pi_...>/`), so it is
     * preferred over `charge` as the dispute's surfaced payment id (Req 6.3, 7.1).
     */
    payment_intent: string | null;
    /** Current dispute status. */
    status: DisputeStatus;
    /** Creation time, Unix seconds. */
    created: number;
    /** Evidence deadline metadata; `due_by` is Unix seconds or null. */
    evidence_details?: { due_by: number | null } | null;
}

/**
 * Per-dispute evidence result merged into the open dispute list.
 *
 * Structurally matches the S3 collector's `DisputeProgress`, but declared here
 * so the Stripe collector needs no import from the S3 collector (keeping the two
 * decoupled). Keyed by the dispute's payment id.
 */
export interface DisputeEvidenceResult {
    /** The dispute's payment id (matches {@link DisputeItem.paymentId}). */
    paymentId: string;
    /** Whether the Evidence_Upload step is complete. */
    evidenceUploaded: boolean;
    /** Whether the Response_Upload step is complete (response PDF present). */
    responseUploaded: boolean;
    /** The batch folder holding the evidence, or null when none found. */
    batchNumber: number | null;
}

/**
 * Supplies dispute evidence flags from an external source (S3). Injected into
 * {@link StripeCollector} so open disputes can be enriched with evidence state
 * without coupling the collector to the S3 SDK or the S3 collector directly.
 */
export interface DisputeEvidenceProvider {
    /**
     * Returns evidence progress for each supplied open dispute. Implementations
     * key results by `paymentId`; disputes with no result keep their defaults.
     */
    checkEvidence(
        disputes: readonly { paymentId: string; status: DisputeStatus }[],
    ): Promise<DisputeEvidenceResult[]>;
}

/**
 * The narrow set of Stripe reads this collector performs.
 *
 * Each method returns the fully-paginated set of records; pagination, retries
 * and auth are the concern of the concrete adapter wired in task 8.1. Keeping
 * the surface this small makes the collector trivial to unit test with an
 * in-memory fake.
 */
export interface StripeClientPort {
    /**
     * Balance transactions created at or after `createdGte` (Unix seconds).
     * Bounded by date so a large account's full history is never paginated on
     * every refresh — the collector only needs the current reporting window.
     */
    listBalanceTransactions(params: { createdGte: number }): Promise<StripeBalanceTransactionRecord[]>;
    /** Charges created at or after `createdGte` (Unix seconds). */
    listCharges(params: { createdGte: number }): Promise<StripeChargeRecord[]>;
    /**
     * Disputes created at or after `createdGte` (Unix seconds). Bounded to a
     * recent window rather than all-time: our "open" statuses are early-stage
     * (short evidence deadlines), so open disputes — and any dispute created in
     * the current month — always fall well inside the lookback window, while
     * years of closed disputes are never paginated.
     */
    listDisputes(params: { createdGte: number }): Promise<StripeDisputeRecord[]>;
    /** Most recent charges, newest first, up to `limit`. */
    listRecentCharges(params: { limit: number }): Promise<StripeChargeRecord[]>;
}

/** A single currency entry of the platform's own Stripe available balance. */
export interface StripePlatformBalanceEntry {
    /** ISO 4217 currency code as reported by Stripe (lowercase, e.g. "gbp"). */
    currency: string;
    /** Available amount in that currency, minor units (e.g. pence). */
    amount: number;
}

/**
 * Reads the platform's OWN Stripe balance (not a connected account). Injected
 * into {@link StripeCollector} so the platform balance can be folded into the
 * summary metric. Separate from {@link StripeClientPort} to keep that port —
 * and its many test fakes — focused on the aggregation reads; the production
 * {@link StripeClient} implements both.
 */
export interface PlatformBalanceProvider {
    /** The platform account's available balance, one entry per currency. */
    getPlatformBalance(): Promise<StripePlatformBalanceEntry[]>;
}

/**
 * Reads the platform's Mercury bank balance. Returns the total available
 * balance across the platform's Mercury accounts, in USD major units.
 */
export interface MercuryClientPort {
    getBalanceUsd(): Promise<number>;
}

/**
 * Converts a major-unit amount between ISO 4217 currencies using the platform's
 * stored exchange rates. Returns null when a required rate is unavailable so the
 * caller can mark the figure unavailable rather than fabricate one.
 */
export interface CurrencyConverter {
    convert(amount: number, from: string, to: string): Promise<number | null>;
}

// ---------------------------------------------------------------------------
// Pure helpers — small, side-effect-free functions that do the data shaping.
// ---------------------------------------------------------------------------

/** Number of recent successful payments surfaced in the feed (Req 9.1). */
export const RECENT_TRANSACTION_LIMIT = 20;

/** Number of minor units per major unit (e.g. 100 pence per pound). */
const MINOR_UNITS_PER_MAJOR = 100;

/** Converts an integer minor-unit amount to major units (pence -> pounds). */
function minorToMajor(minor: number): number {
    return minor / MINOR_UNITS_PER_MAJOR;
}

/** Converts a Unix-seconds timestamp to an ISO 8601 string. */
function unixSecondsToIso(seconds: number): string {
    return new Date(seconds * 1000).toISOString();
}

/** Converts a Date to Unix seconds (for Stripe `created[gte]` filters). */
function toUnixSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

/** Resolves a dispute's evidence deadline to an ISO string for day counting. */
function disputeDueByIso(dispute: StripeDisputeRecord, now: Date): string {
    const dueBy = dispute.evidence_details?.due_by;
    return typeof dueBy === 'number' ? unixSecondsToIso(dueBy) : now.toISOString();
}

/**
 * Filters to open disputes, maps them to {@link DisputeItem}s, and sorts by
 * days remaining ascending — soonest deadline first (design Property 15,
 * Requirements 6.1, 6.3).
 *
 * The dispute's payment id is taken from `payment_intent` (the "pi_..." id used
 * to key the S3 evidence folders), falling back to the "ch_..." charge id when
 * no payment intent is present (Req 6.3, 7.1).
 *
 * `evidenceUploaded`/`responseUploaded`/`evidenceBatch` are left at their
 * "nothing found" defaults here: those come from the S3 evidence check and are
 * merged in by {@link mergeEvidence}. Open disputes always require a response,
 * so false/null is the correct starting state.
 */
function buildDisputeItems(
    disputes: readonly StripeDisputeRecord[],
    now: Date,
): DisputeItem[] {
    return disputes
        .filter((dispute) => isOpenDispute(dispute.status))
        .map((dispute) => ({
            paymentId: dispute.payment_intent ?? dispute.charge,
            amountUsd: formatMoney(minorToMajor(dispute.amount)),
            daysRemaining: calculateDaysRemaining(disputeDueByIso(dispute, now), now),
            evidenceUploaded: false,
            responseUploaded: false,
            evidenceBatch: null,
            status: dispute.status,
        }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/**
 * Merges S3 evidence results into the open dispute list, matching on
 * `paymentId`. Returns a new array; disputes with no matching evidence result
 * are returned unchanged (keeping their false/null defaults).
 */
function mergeEvidence(
    disputes: readonly DisputeItem[],
    evidence: readonly DisputeEvidenceResult[],
): DisputeItem[] {
    const byPaymentId = new Map(evidence.map((result) => [result.paymentId, result]));
    return disputes.map((dispute) => {
        const result = byPaymentId.get(dispute.paymentId);
        if (result === undefined) {
            return dispute;
        }
        return {
            ...dispute,
            evidenceUploaded: result.evidenceUploaded,
            responseUploaded: result.responseUploaded,
            evidenceBatch: result.batchNumber,
        };
    });
}

/** Converts a charge to the PII-bearing raw shape consumed by {@link stripPii}. */
function chargeToRawTransaction(charge: StripeChargeRecord): RawTransaction {
    return {
        id: charge.id,
        amount: minorToMajor(charge.amount),
        currency: charge.currency,
        timestamp: unixSecondsToIso(charge.created),
    };
}

/**
 * Builds the recent-transactions feed: successful charges only, newest first,
 * limited to {@link RECENT_TRANSACTION_LIMIT}, with ids truncated and PII
 * stripped (design Property 22, Requirements 9.1, 9.2, 9.4).
 */
function buildTransactionFeed(charges: readonly StripeChargeRecord[]) {
    return charges
        .filter((charge) => charge.status === 'succeeded')
        .slice()
        .sort((a, b) => b.created - a.created)
        .slice(0, RECENT_TRANSACTION_LIMIT)
        .map((charge) => stripPii(chargeToRawTransaction(charge)));
}

/** Counts disputes created within [periodStart, now]. */
function countDisputesInPeriod(
    disputes: readonly StripeDisputeRecord[],
    periodStart: Date,
    now: Date,
): number {
    let count = 0;
    for (const dispute of disputes) {
        if (isWithinPeriod(unixSecondsToIso(dispute.created), periodStart, now)) {
            count += 1;
        }
    }
    return count;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/** Cache entries this collector is responsible for. */
const STRIPE_METRIC_KEYS = ['revenue', 'disputes', 'transactions', 'summary'] as const satisfies readonly MetricKey[];

/**
 * Default overlap window (seconds) applied to each incremental fetch. Each poll
 * re-fetches the last OVERLAP seconds and de-duplicates by id, so items created
 * around the previous high-water mark (or indexed slightly late by Stripe) are
 * never missed. 15 minutes is comfortably larger than poll-interval jitter while
 * keeping the re-fetch small.
 */
const DEFAULT_OVERLAP_SEC = 15 * 60;

/**
 * Default dispute lookback window (seconds). Disputes created before this are
 * not fetched. 180 days is a wide safety margin: our "open" statuses are
 * early-stage (evidence deadlines are ~1-3 weeks), so open disputes are always
 * far more recent than this, and the current month is trivially inside it.
 */
const DEFAULT_DISPUTE_LOOKBACK_SEC = 180 * 24 * 60 * 60;

/** Construction options for {@link StripeCollector}. */
export interface StripeCollectorOptions {
    /** Overlap window in seconds for incremental fetches. Default 15 minutes. */
    overlapSec?: number;
    /** How far back (seconds) to fetch disputes. Default 180 days. */
    disputeLookbackSec?: number;
    /**
     * Optional S3-backed evidence provider. When supplied, open disputes are
     * enriched with `evidenceUploaded`/`responseUploaded`/`evidenceBatch` from
     * S3. A failure here never breaks the Stripe metrics (see {@link StripeCollector.collect}).
     */
    evidenceProvider?: DisputeEvidenceProvider;
    /**
     * Optional reader for the platform's own Stripe balance (Req 11.1). When
     * supplied together with {@link StripeCollectorOptions.converter}, the
     * platform Stripe balance is converted to USD and folded into the summary.
     */
    balanceProvider?: PlatformBalanceProvider;
    /**
     * Optional Mercury bank-balance reader (Req 11.2). When supplied, the
     * Mercury balance is folded into the summary (already in USD).
     */
    mercuryClient?: MercuryClientPort;
    /**
     * Optional currency converter (Req 11.3, 11.5) used to convert the Stripe
     * balance to USD and the USD total to GBP. Required for the Stripe balance
     * and the GBP total; when absent those figures are reported as unavailable.
     */
    converter?: CurrencyConverter;
}

/**
 * Collects Stripe-derived metrics for the revenue, disputes, transactions and
 * summary widgets. Conforms to {@link MetricCollector} so the DataAggregator
 * can schedule it alongside the other source collectors.
 *
 * Revenue and payment-count metrics are aggregated INCREMENTALLY via a
 * long-lived {@link StripeAggregateStore}: the first poll after start backfills
 * the current reporting window, and every subsequent poll fetches only the
 * delta since the last sync (plus an overlap, de-duplicated by id). This keeps
 * steady-state polls fast regardless of how far into the month it is.
 *
 * Disputes and the recent-transactions feed are fetched fresh each poll: dispute
 * status is mutable (so it cannot be aggregated incrementally by creation time)
 * and the feed is a cheap fixed-size query.
 */
export class StripeCollector implements MetricCollector {
    readonly name = 'stripe';
    readonly metricKeys = STRIPE_METRIC_KEYS;

    private readonly client: StripeClientPort;
    private readonly store: StripeAggregateStore;
    private readonly overlapSec: number;
    private readonly disputeLookbackSec: number;
    private readonly evidenceProvider: DisputeEvidenceProvider | undefined;
    private readonly balanceProvider: PlatformBalanceProvider | undefined;
    private readonly mercuryClient: MercuryClientPort | undefined;
    private readonly converter: CurrencyConverter | undefined;

    constructor(client: StripeClientPort, options: StripeCollectorOptions = {}) {
        this.client = client;
        this.store = new StripeAggregateStore();
        this.overlapSec = options.overlapSec ?? DEFAULT_OVERLAP_SEC;
        this.disputeLookbackSec = options.disputeLookbackSec ?? DEFAULT_DISPUTE_LOOKBACK_SEC;
        this.evidenceProvider = options.evidenceProvider;
        this.balanceProvider = options.balanceProvider;
        this.mercuryClient = options.mercuryClient;
        this.converter = options.converter;
    }

    async collect(): Promise<CollectedMetrics> {
        const now = new Date();
        const startOfDay = getStartOfDay(now);
        const startOfWeek = getStartOfWeek(now);
        const startOfMonth = getStartOfMonth(now);

        // Earliest reporting boundary (the week can begin before the 1st early
        // in a month). Used to backfill on a cold start.
        const earliestStartUnix = toUnixSeconds(
            new Date(
                Math.min(
                    startOfDay.getTime(),
                    startOfWeek.getTime(),
                    startOfMonth.getTime(),
                ),
            ),
        );

        // Incremental window: on a cold start fetch the whole reporting window;
        // thereafter fetch only what's new since the last sync, minus an overlap
        // (de-duplicated by id on ingest). The store already holds the earlier
        // buckets for this month from previous polls.
        const lastSync = this.store.getLastSyncUnix();
        const createdGte =
            lastSync === null ? earliestStartUnix : lastSync - this.overlapSec;

        // Disputes are fetched fresh (status is mutable) but bounded to a recent
        // window so years of closed disputes are never paginated.
        const disputesCreatedGte = toUnixSeconds(now) - this.disputeLookbackSec;

        // Balance transactions + charges feed the incremental store; disputes and
        // the recent feed are fetched fresh (see class doc).
        const [balanceTransactions, charges, disputes, recentCharges] = await Promise.all([
            this.client.listBalanceTransactions({ createdGte }),
            this.client.listCharges({ createdGte }),
            this.client.listDisputes({ createdGte: disputesCreatedGte }),
            this.client.listRecentCharges({ limit: RECENT_TRANSACTION_LIMIT }),
        ]);

        // Fold the delta into the running per-day aggregate.
        this.store.ingestBalanceTransactions(balanceTransactions);
        this.store.ingestCharges(charges);
        this.store.markSynced(toUnixSeconds(now));
        this.store.prune(now);

        const lastRefreshed = now.toISOString();

        // Revenue & payment counts per period, summed from the store (Req 3.1-3.3).
        const dayTotals = this.store.periodTotals(startOfDay, now);
        const weekTotals = this.store.periodTotals(startOfWeek, now);
        const monthTotals = this.store.periodTotals(startOfMonth, now);

        const revenue: RevenueMetrics = {
            periods: {
                day: toPeriodMetrics(dayTotals),
                week: toPeriodMetrics(weekTotals),
                month: toPeriodMetrics(monthTotals),
            },
            lastRefreshed,
        };

        // Open disputes, countdown & ordering (Req 6.1, 6.3) — fresh each poll.
        let disputeItems = buildDisputeItems(disputes, now);

        // Enrich with S3 evidence flags when a provider is configured. This is
        // best-effort for the Stripe metrics: an S3 failure (e.g. permissions
        // denied, timeout) must NOT break the dispute amounts/deadlines, so it
        // is isolated in a try/catch. The failure is surfaced to the UI via
        // `evidenceError` (Req 7) so the team knows the evidence columns are
        // unavailable rather than silently showing everything as "not uploaded".
        let evidenceError: string | null = null;
        if (this.evidenceProvider !== undefined && disputeItems.length > 0) {
            try {
                const evidence = await this.evidenceProvider.checkEvidence(
                    disputeItems.map((dispute) => ({
                        paymentId: dispute.paymentId,
                        status: dispute.status,
                    })),
                );
                disputeItems = mergeEvidence(disputeItems, evidence);
            } catch (error) {
                evidenceError =
                    error instanceof Error ? error.message : String(error);
            }
        }

        const disputeMetrics: DisputeMetrics = {
            nearestDeadlineDays: disputeItems.length > 0 ? disputeItems[0].daysRemaining : null,
            disputes: disputeItems,
            evidenceError,
            lastRefreshed,
        };

        // Recent transaction feed (Req 9.1, 9.2) — fresh each poll.
        const transactions: TransactionFeedMetrics = {
            transactions: buildTransactionFeed(recentCharges),
            lastRefreshed,
        };

        // Platform summary (Req 10.1-10.4).
        const monthlyDisputeCount = countDisputesInPeriod(disputes, startOfMonth, now);

        // Platform account balances (Req 11). Each source is read independently
        // with its own error isolation so one failure never blanks the others
        // (mirrors the S3 `evidenceError` pattern above).
        const balances = await this.collectBalances();

        const summary: PlatformSummaryMetrics = {
            monthlyGrossVolume: formatMoney(monthTotals.positiveGross),
            monthlyTakeRate: calculateTakeRate(monthTotals.fees, monthTotals.gross),
            monthlyDisputeRate: calculateDisputeRate(monthlyDisputeCount, monthTotals.successful),
            monthlyPaymentCount: monthTotals.successful,
            ...balances,
            lastRefreshed,
        };

        return {
            revenue,
            disputes: disputeMetrics,
            transactions,
            summary,
        };
    }

    /**
     * Reads the platform's Stripe and Mercury balances and derives the USD/GBP
     * totals (Requirement 11). Returns the balance subset of
     * {@link PlatformSummaryMetrics}.
     *
     * Each source is wrapped in its own try/catch so a failure in one (missing
     * permission, missing token, missing FX rate) surfaces only on that tile's
     * error field while the other balance — and the rest of the summary — keep
     * rendering (Req 11.7, 11.8). The totals are computed from whatever numeric
     * balances are available and are null when none are (Req 11.9).
     */
    private async collectBalances(): Promise<
        Pick<
            PlatformSummaryMetrics,
            | 'stripeBalanceUsd'
            | 'stripeBalanceError'
            | 'mercuryBalanceUsd'
            | 'mercuryBalanceError'
            | 'totalBalanceUsd'
            | 'totalBalanceGbp'
        >
    > {
        let stripeUsd: number | null = null;
        let stripeBalanceError: string | null = null;
        let mercuryUsd: number | null = null;
        let mercuryBalanceError: string | null = null;

        // Platform's own Stripe balance, summed per-currency and converted to USD.
        if (this.balanceProvider !== undefined) {
            try {
                if (this.converter === undefined) {
                    throw new Error('currency converter unavailable');
                }
                const entries = await this.balanceProvider.getPlatformBalance();
                let total = 0;
                for (const entry of entries) {
                    const usd = await this.converter.convert(
                        minorToMajor(entry.amount),
                        entry.currency,
                        'USD',
                    );
                    if (usd === null) {
                        throw new Error(
                            `no exchange rate to convert ${entry.currency.toUpperCase()} balance to USD`,
                        );
                    }
                    total += usd;
                }
                stripeUsd = total;
            } catch (error) {
                stripeBalanceError = error instanceof Error ? error.message : String(error);
            }
        }

        // Mercury bank balance (already USD).
        if (this.mercuryClient !== undefined) {
            try {
                mercuryUsd = await this.mercuryClient.getBalanceUsd();
            } catch (error) {
                mercuryBalanceError = error instanceof Error ? error.message : String(error);
            }
        }

        const totalUsd = sumUsdBalances([stripeUsd, mercuryUsd]);

        // GBP view of the total (Req 11.5). Best-effort: an unavailable rate or
        // converter simply leaves the GBP total null.
        let totalGbp: number | null = null;
        if (totalUsd !== null && this.converter !== undefined) {
            try {
                totalGbp = await this.converter.convert(totalUsd, 'USD', 'GBP');
            } catch {
                totalGbp = null;
            }
        }

        return {
            stripeBalanceUsd: stripeUsd === null ? null : formatMoney(stripeUsd),
            stripeBalanceError,
            mercuryBalanceUsd: mercuryUsd === null ? null : formatMoney(mercuryUsd),
            mercuryBalanceError,
            totalBalanceUsd: totalUsd === null ? null : formatMoney(totalUsd),
            totalBalanceGbp: totalGbp === null ? null : formatMoney(totalGbp),
        };
    }
}

/**
 * Maps aggregated {@link PeriodTotals} to the {@link PeriodMetrics} API shape.
 * The average payment is gross revenue divided by successful payment count, or
 * null when there are none (Requirement 3.3, via {@link calculateAverage}).
 */
function toPeriodMetrics(totals: PeriodTotals): PeriodMetrics {
    return {
        grossRevenue: formatMoney(totals.gross),
        netRevenue: formatMoney(totals.net),
        totalFees: formatMoney(totals.fees),
        successfulPayments: totals.successful,
        failedPayments: totals.failed,
        refunds: totals.refunds,
        averagePayment: calculateAverage(totals.gross, totals.successful),
    };
}
