// Property-based tests for the StripeCollector.
//
// These properties exercise the collector through its public `collect()` method,
// driven by an in-memory fake that implements the narrow `StripeClientPort`. The
// aggregation/sorting helpers (sumRevenueInPeriod, countPaymentsInPeriod,
// buildDisputeItems, buildTransactionFeed) are module-private, so we verify the
// real behaviour end-to-end through the collector's output rather than calling
// them directly.
//
// Unit conventions mirrored from the source under test:
//   - Monetary amounts on the port are in MINOR units (pence).
//   - `collect()` returns formatted GBP MAJOR-unit strings with 2 decimal places
//     (via formatMoney), so revenue oracles format the expected minor-unit sum
//     the same way.
//   - `created` / `due_by` are Unix timestamps in SECONDS.
//
// now-handling: `collect()` reads its own `new Date()` internally. Each property
// captures a `now` at the top of the run and derives every generated timestamp
// from it with a >= 2s margin below now, so membership within a period is stable
// against the sub-millisecond gap between the test's `now` and the collector's.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { StripeCollector } from './stripe-collector.js';
import type {
    StripeBalanceTransactionRecord,
    StripeChargeRecord,
    StripeClientPort,
    StripeDisputeRecord,
} from './stripe-collector.js';
import type { DisputeStatus } from '@fans-fund-me/shared';

import { formatMoney } from '../utils/formatting.js';
import {
    getStartOfDay,
    getStartOfMonth,
    getStartOfWeek,
    isWithinPeriod,
} from '../utils/time-boundaries.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SECONDS_PER_DAY = 24 * 60 * 60;
/** Widest window we generate over: ~40 days back, ending 2s before "now". */
const MIN_OFFSET_SEC = -40 * SECONDS_PER_DAY;
const MAX_OFFSET_SEC = -2;

/** Disputes/feed limit surfaced by the collector (Req 9.1). */
const RECENT_TRANSACTION_LIMIT = 20;

/** DisputeStatus values the collector treats as open/actionable (Req 7.7). */
const OPEN_STATUSES: readonly DisputeStatus[] = [
    'warning_needs_response',
    'needs_response',
];
/** DisputeStatus values the collector treats as closed/non-actionable. */
const CLOSED_STATUSES: readonly DisputeStatus[] = [
    'warning_under_review',
    'under_review',
    'won',
    'lost',
    'charge_refunded',
];
const OPEN_STATUS_SET = new Set<DisputeStatus>(OPEN_STATUSES);

/**
 * Builds an in-memory {@link StripeClientPort}. Every method defaults to an
 * empty list so each property only supplies the data it cares about. Params
 * (createdGte / limit) are intentionally ignored: the collector re-filters and
 * re-limits internally, which is exactly the behaviour under test.
 */
function makeStripeClient(data: {
    balanceTransactions?: StripeBalanceTransactionRecord[];
    charges?: StripeChargeRecord[];
    disputes?: StripeDisputeRecord[];
    recentCharges?: StripeChargeRecord[];
}): StripeClientPort {
    return {
        listBalanceTransactions: async () => data.balanceTransactions ?? [],
        listCharges: async () => data.charges ?? [],
        listDisputes: async () => data.disputes ?? [],
        listRecentCharges: async () => data.recentCharges ?? [],
    };
}

/** Converts a Unix-seconds timestamp to the ISO form the collector produces. */
function unixSecondsToIso(seconds: number): string {
    return new Date(seconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Property 5: Time-bounded revenue aggregation
//
// Feature: ops-dashboard, Property 5: Time-bounded revenue aggregation
//
// Task 6.2 (Validates Requirements 3.1, 3.2): for any set of balance
// transactions with arbitrary amounts (minor units, incl. negatives) and
// timestamps, the gross total reported for a period equals the sum of the
// `amount`s of the transactions whose timestamps fall within that period's UTC
// boundaries, converted to major units and formatted to 2dp.
// ---------------------------------------------------------------------------

const balanceTxnArb = fc.record({
    offsetSec: fc.integer({ min: MIN_OFFSET_SEC, max: MAX_OFFSET_SEC }),
    // Minor units, including negative movements (refunds/payouts).
    amount: fc.integer({ min: -500_000, max: 500_000 }),
    net: fc.integer({ min: -500_000, max: 500_000 }),
    fee: fc.integer({ min: 0, max: 50_000 }),
});

describe('StripeCollector revenue (Property 5: Time-bounded revenue aggregation)', () => {
    it('reports gross per period equal to the summed minor amounts within the UTC period', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(balanceTxnArb, { maxLength: 60 }),
                async (rawTxns) => {
                    const now = new Date();
                    const nowSec = Math.floor(now.getTime() / 1000);

                    const transactions: StripeBalanceTransactionRecord[] = rawTxns.map(
                        (t, i) => ({
                            id: `bt_${i}`,
                            type: 'charge',
                            amount: t.amount,
                            net: t.net,
                            fee: t.fee,
                            created: nowSec + t.offsetSec,
                        }),
                    );

                    const collector = new StripeCollector(
                        makeStripeClient({ balanceTransactions: transactions }),
                    );
                    const result = await collector.collect();

                    // Independent oracle: sum minor-unit `amount`s in-period,
                    // convert to major units, format identically to the source.
                    const expectedGross = (periodStart: Date): string => {
                        let minor = 0;
                        for (const txn of transactions) {
                            if (
                                isWithinPeriod(
                                    unixSecondsToIso(txn.created),
                                    periodStart,
                                    now,
                                )
                            ) {
                                minor += txn.amount;
                            }
                        }
                        return formatMoney(minor / 100);
                    };

                    expect(result.revenue?.periods.day.grossRevenue).toBe(
                        expectedGross(getStartOfDay(now)),
                    );
                    expect(result.revenue?.periods.week.grossRevenue).toBe(
                        expectedGross(getStartOfWeek(now)),
                    );
                    expect(result.revenue?.periods.month.grossRevenue).toBe(
                        expectedGross(getStartOfMonth(now)),
                    );
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Property 6: Payment count aggregation
//
// Feature: ops-dashboard, Property 6: Payment count aggregation
//
// Task 6.3 (Validates Requirements 3.2, 10.4): for any set of charges and
// balance transactions with arbitrary timestamps, the per-status counts
// reported for a period equal the number of matching items whose timestamps
// fall within the period's UTC boundaries. Successful = charge status
// 'succeeded'; failed = charge status 'failed'; refunds = balance transactions
// of type 'refund' (refund *events*, so a refund is counted when it occurs,
// independent of when the original charge was created — this is what makes the
// aggregation incremental and is a more faithful "refunds in period" measure).
// ---------------------------------------------------------------------------

const chargeCountArb = fc.record({
    offsetSec: fc.integer({ min: MIN_OFFSET_SEC, max: MAX_OFFSET_SEC }),
    amount: fc.integer({ min: 0, max: 1_000_000 }),
    status: fc.constantFrom<StripeChargeRecord['status']>(
        'succeeded',
        'failed',
        'pending',
    ),
});

const refundTxnArb = fc.record({
    offsetSec: fc.integer({ min: MIN_OFFSET_SEC, max: MAX_OFFSET_SEC }),
    amount: fc.integer({ min: -500_000, max: 500_000 }),
    // Mix refund and non-refund balance transactions so only 'refund' counts.
    isRefund: fc.boolean(),
});

describe('StripeCollector payment counts (Property 6: Payment count aggregation)', () => {
    it('reports per-status counts equal to matching items within each UTC period', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(chargeCountArb, { maxLength: 60 }),
                fc.array(refundTxnArb, { maxLength: 60 }),
                async (rawCharges, rawRefunds) => {
                    const now = new Date();
                    const nowSec = Math.floor(now.getTime() / 1000);

                    // Index-based ids guarantee uniqueness (real Stripe ids are
                    // unique; the store de-duplicates by id).
                    const charges: StripeChargeRecord[] = rawCharges.map((c, i) => ({
                        id: `ch_${i}`,
                        amount: c.amount,
                        currency: 'gbp',
                        created: nowSec + c.offsetSec,
                        status: c.status,
                        refunded: false,
                        amount_refunded: 0,
                    }));

                    const balanceTransactions: StripeBalanceTransactionRecord[] =
                        rawRefunds.map((r, i) => ({
                            id: `bt_${i}`,
                            type: r.isRefund ? 'refund' : 'charge',
                            amount: r.amount,
                            net: r.amount,
                            fee: 0,
                            created: nowSec + r.offsetSec,
                        }));

                    const collector = new StripeCollector(
                        makeStripeClient({ charges, balanceTransactions }),
                    );
                    const result = await collector.collect();

                    const expectedCounts = (periodStart: Date) => {
                        let successful = 0;
                        let failed = 0;
                        let refunds = 0;
                        for (const charge of charges) {
                            if (
                                isWithinPeriod(
                                    unixSecondsToIso(charge.created),
                                    periodStart,
                                    now,
                                )
                            ) {
                                if (charge.status === 'succeeded') successful += 1;
                                if (charge.status === 'failed') failed += 1;
                            }
                        }
                        for (const txn of balanceTransactions) {
                            if (
                                txn.type === 'refund' &&
                                isWithinPeriod(
                                    unixSecondsToIso(txn.created),
                                    periodStart,
                                    now,
                                )
                            ) {
                                refunds += 1;
                            }
                        }
                        return { successful, failed, refunds };
                    };

                    const periods = [
                        ['day', getStartOfDay(now)] as const,
                        ['week', getStartOfWeek(now)] as const,
                        ['month', getStartOfMonth(now)] as const,
                    ];

                    for (const [name, start] of periods) {
                        const expected = expectedCounts(start);
                        const actual = result.revenue?.periods[name];
                        expect(actual?.successfulPayments).toBe(expected.successful);
                        expect(actual?.failedPayments).toBe(expected.failed);
                        expect(actual?.refunds).toBe(expected.refunds);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Property 15: Dispute list ordering
//
// Feature: ops-dashboard, Property 15: Dispute list ordering
//
// Task 6.4 (Validates Requirement 6.3): for any set of disputes with arbitrary
// statuses and deadlines, the formatted dispute list contains exactly the OPEN
// disputes and is sorted ascending by daysRemaining (soonest deadline first).
// The nearest-deadline value equals the first (soonest) item, or null when
// there are no open disputes.
// ---------------------------------------------------------------------------

const disputeArb = fc.record({
    id: fc.string(),
    charge: fc.string({ minLength: 1 }),
    amount: fc.integer({ min: 0, max: 1_000_000 }),
    status: fc.constantFrom<DisputeStatus>(...OPEN_STATUSES, ...CLOSED_STATUSES),
    createdOffsetSec: fc.integer({ min: MIN_OFFSET_SEC, max: MAX_OFFSET_SEC }),
    // Deadline offset spans past (overdue) and future so daysRemaining varies.
    dueByOffsetSec: fc.option(
        fc.integer({ min: -20 * SECONDS_PER_DAY, max: 20 * SECONDS_PER_DAY }),
        { nil: null },
    ),
});

describe('StripeCollector disputes (Property 15: Dispute list ordering)', () => {
    it('lists exactly the open disputes sorted ascending by daysRemaining', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(disputeArb, { maxLength: 40 }),
                async (rawDisputes) => {
                    const now = new Date();
                    const nowSec = Math.floor(now.getTime() / 1000);

                    const disputes: StripeDisputeRecord[] = rawDisputes.map((d) => ({
                        id: d.id,
                        amount: d.amount,
                        charge: d.charge,
                        // Null so the surfaced paymentId falls back to `charge`,
                        // which the oracle below matches against.
                        payment_intent: null,
                        status: d.status,
                        created: nowSec + d.createdOffsetSec,
                        evidence_details: {
                            due_by:
                                d.dueByOffsetSec === null
                                    ? null
                                    : nowSec + d.dueByOffsetSec,
                        },
                    }));

                    const collector = new StripeCollector(
                        makeStripeClient({ disputes }),
                    );
                    const result = await collector.collect();

                    const items = result.disputes?.disputes ?? [];

                    // Only open disputes are surfaced (independent oracle).
                    const expectedOpenCharges = disputes
                        .filter((d) => OPEN_STATUS_SET.has(d.status))
                        .map((d) => d.charge);
                    expect(items.length).toBe(expectedOpenCharges.length);
                    expect([...items.map((i) => i.paymentId)].sort()).toEqual(
                        [...expectedOpenCharges].sort(),
                    );

                    // Ascending by daysRemaining (soonest first).
                    for (let i = 1; i < items.length; i += 1) {
                        expect(items[i - 1].daysRemaining).toBeLessThanOrEqual(
                            items[i].daysRemaining,
                        );
                    }

                    // Nearest deadline mirrors the first item, or null when empty.
                    expect(result.disputes?.nearestDeadlineDays).toBe(
                        items.length > 0 ? items[0].daysRemaining : null,
                    );
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Property 22: Transaction feed ordering
//
// Feature: ops-dashboard, Property 22: Transaction feed ordering
//
// Task 6.5 (Validates Requirements 9.1, 9.2): for any set of charges, the
// transaction feed contains only successful charges, is sorted descending by
// timestamp (most recent first), and is limited to at most 20 items.
// ---------------------------------------------------------------------------

const feedChargeArb = fc.record({
    id: fc.string({ minLength: 1 }),
    offsetSec: fc.integer({ min: MIN_OFFSET_SEC, max: MAX_OFFSET_SEC }),
    amount: fc.integer({ min: 0, max: 1_000_000 }),
    status: fc.constantFrom<StripeChargeRecord['status']>(
        'succeeded',
        'failed',
        'pending',
    ),
    refunded: fc.boolean(),
    amountRefunded: fc.integer({ min: 0, max: 10_000 }),
});

describe('StripeCollector transaction feed (Property 22: Transaction feed ordering)', () => {
    it('sorts the feed descending by timestamp and limits it to at most 20 items', async () => {
        await fc.assert(
            fc.asyncProperty(
                // Allow more than the limit so truncation is exercised.
                fc.array(feedChargeArb, { maxLength: 40 }),
                async (rawCharges) => {
                    const now = new Date();
                    const nowSec = Math.floor(now.getTime() / 1000);

                    const recentCharges: StripeChargeRecord[] = rawCharges.map((c) => ({
                        id: c.id,
                        amount: c.amount,
                        currency: 'gbp',
                        created: nowSec + c.offsetSec,
                        status: c.status,
                        refunded: c.refunded,
                        amount_refunded: c.amountRefunded,
                    }));

                    const collector = new StripeCollector(
                        makeStripeClient({ recentCharges }),
                    );
                    const result = await collector.collect();

                    const feed = result.transactions?.transactions ?? [];

                    // Feed length equals the successful charges capped at the limit.
                    const succeededCount = recentCharges.filter(
                        (c) => c.status === 'succeeded',
                    ).length;
                    expect(feed.length).toBe(
                        Math.min(RECENT_TRANSACTION_LIMIT, succeededCount),
                    );
                    expect(feed.length).toBeLessThanOrEqual(RECENT_TRANSACTION_LIMIT);

                    // Descending by timestamp (most recent first).
                    for (let i = 1; i < feed.length; i += 1) {
                        expect(Date.parse(feed[i - 1].timestamp)).toBeGreaterThanOrEqual(
                            Date.parse(feed[i].timestamp),
                        );
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
