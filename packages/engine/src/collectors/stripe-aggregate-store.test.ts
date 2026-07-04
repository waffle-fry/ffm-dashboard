import { describe, it, expect } from 'vitest';
import {
    StripeAggregateStore,
    type AggregatableBalanceTxn,
    type AggregatableCharge,
} from './stripe-aggregate-store.js';

// Fixed reference clock: 2026-07-15T12:00:00Z (a Wednesday).
const NOW = new Date('2026-07-15T12:00:00.000Z');
const START_OF_DAY = new Date('2026-07-15T00:00:00.000Z');
const START_OF_WEEK = new Date('2026-07-13T00:00:00.000Z'); // Monday
const START_OF_MONTH = new Date('2026-07-01T00:00:00.000Z');

/** Unix seconds for an ISO instant. */
function unix(iso: string): number {
    return Math.floor(Date.parse(iso) / 1000);
}

function bt(overrides: Partial<AggregatableBalanceTxn>): AggregatableBalanceTxn {
    return {
        id: 'txn_x',
        type: 'charge',
        amount: 0,
        net: 0,
        fee: 0,
        created: unix('2026-07-15T10:00:00Z'),
        ...overrides,
    };
}

function charge(overrides: Partial<AggregatableCharge>): AggregatableCharge {
    return {
        id: 'ch_x',
        created: unix('2026-07-15T10:00:00Z'),
        status: 'succeeded',
        ...overrides,
    };
}

describe('StripeAggregateStore — period aggregation by UTC day', () => {
    it('sums balance-transaction revenue into the correct day/week/month periods', () => {
        const store = new StripeAggregateStore();
        store.ingestBalanceTransactions([
            // today (2026-07-15)
            bt({ id: 'a', amount: 10_00, net: 9_00, fee: 1_00, created: unix('2026-07-15T09:00:00Z') }),
            // earlier this week (Monday 2026-07-13) — in week & month, not day
            bt({ id: 'b', amount: 20_00, net: 18_00, fee: 2_00, created: unix('2026-07-13T08:00:00Z') }),
            // earlier this month (2026-07-02) — in month only
            bt({ id: 'c', amount: 30_00, net: 27_00, fee: 3_00, created: unix('2026-07-02T08:00:00Z') }),
            // last month (2026-06-30) — in none of these periods
            bt({ id: 'd', amount: 99_00, net: 90_00, fee: 9_00, created: unix('2026-06-30T23:00:00Z') }),
        ]);

        const day = store.periodTotals(START_OF_DAY, NOW);
        const week = store.periodTotals(START_OF_WEEK, NOW);
        const month = store.periodTotals(START_OF_MONTH, NOW);

        expect(day.gross).toBe(10);
        expect(day.net).toBe(9);
        expect(day.fees).toBe(1);

        expect(week.gross).toBe(30); // today + Monday
        expect(month.gross).toBe(60); // today + Monday + 2nd
        // June 30 excluded from all three.
    });

    it('counts successful/failed charges per period; pending are ignored', () => {
        const store = new StripeAggregateStore();
        store.ingestCharges([
            charge({ id: 'c1', status: 'succeeded', created: unix('2026-07-15T09:00:00Z') }),
            charge({ id: 'c2', status: 'failed', created: unix('2026-07-15T09:30:00Z') }),
            charge({ id: 'c3', status: 'pending', created: unix('2026-07-15T09:45:00Z') }),
            charge({ id: 'c4', status: 'succeeded', created: unix('2026-07-02T09:00:00Z') }), // month only
        ]);

        const day = store.periodTotals(START_OF_DAY, NOW);
        const month = store.periodTotals(START_OF_MONTH, NOW);

        expect(day.successful).toBe(1);
        expect(day.failed).toBe(1);
        expect(month.successful).toBe(2);
        expect(month.failed).toBe(1);
    });

    it('counts refunds only from balance transactions of type "refund"', () => {
        const store = new StripeAggregateStore();
        store.ingestBalanceTransactions([
            bt({ id: 'r1', type: 'refund', amount: -5_00, net: -5_00, created: unix('2026-07-15T09:00:00Z') }),
            bt({ id: 'r2', type: 'refund', amount: -6_00, net: -6_00, created: unix('2026-07-02T09:00:00Z') }),
            bt({ id: 'p1', type: 'payout', amount: -100_00, created: unix('2026-07-15T09:00:00Z') }),
            bt({ id: 'ch1', type: 'charge', amount: 50_00, created: unix('2026-07-15T09:00:00Z') }),
        ]);

        expect(store.periodTotals(START_OF_DAY, NOW).refunds).toBe(1);
        expect(store.periodTotals(START_OF_MONTH, NOW).refunds).toBe(2);
    });

    it('positiveGross includes only positive amounts (gross volume)', () => {
        const store = new StripeAggregateStore();
        store.ingestBalanceTransactions([
            bt({ id: 'a', type: 'charge', amount: 100_00, created: unix('2026-07-15T09:00:00Z') }),
            bt({ id: 'b', type: 'refund', amount: -40_00, created: unix('2026-07-15T09:30:00Z') }),
            bt({ id: 'c', type: 'payout', amount: -50_00, created: unix('2026-07-15T10:00:00Z') }),
        ]);
        const day = store.periodTotals(START_OF_DAY, NOW);
        expect(day.positiveGross).toBe(100); // only the +100.00 charge
        expect(day.gross).toBe(10); // 100 - 40 - 50 net movement
    });
});

describe('StripeAggregateStore — incremental de-duplication', () => {
    it('does not double-count ids seen across overlapping ingests', () => {
        const store = new StripeAggregateStore();
        const txn = bt({ id: 'dup', amount: 10_00, created: unix('2026-07-15T09:00:00Z') });

        // First poll ingests it; a later poll re-fetches the overlap window and
        // sees the same id again — it must not be counted twice.
        store.ingestBalanceTransactions([txn]);
        store.markSynced(unix('2026-07-15T09:05:00Z'));
        store.ingestBalanceTransactions([txn, bt({ id: 'new', amount: 5_00, created: unix('2026-07-15T09:04:00Z') })]);

        expect(store.periodTotals(START_OF_DAY, NOW).gross).toBe(15); // 10 + 5, not 25
    });

    it('de-duplicates charges by id too', () => {
        const store = new StripeAggregateStore();
        const c = charge({ id: 'dup', status: 'succeeded' });
        store.ingestCharges([c]);
        store.ingestCharges([c]);
        expect(store.periodTotals(START_OF_DAY, NOW).successful).toBe(1);
    });

    it('tracks the last-sync high-water mark', () => {
        const store = new StripeAggregateStore();
        expect(store.hasSynced()).toBe(false);
        expect(store.getLastSyncUnix()).toBeNull();
        store.markSynced(1234);
        expect(store.hasSynced()).toBe(true);
        expect(store.getLastSyncUnix()).toBe(1234);
    });
});

describe('StripeAggregateStore — pruning', () => {
    it('drops buckets older than the retention window but keeps in-window data', () => {
        const store = new StripeAggregateStore({ retentionDays: 45 });
        store.ingestBalanceTransactions([
            bt({ id: 'old', amount: 100_00, created: unix('2026-05-01T00:00:00Z') }), // ~75 days before NOW
            bt({ id: 'recent', amount: 20_00, created: unix('2026-07-10T00:00:00Z') }),
        ]);

        store.prune(NOW);

        // The old (out-of-retention) bucket is gone; the recent one remains and
        // is still counted in the month total.
        expect(store.periodTotals(START_OF_MONTH, NOW).gross).toBe(20);
        // A wide query that would have included May now sees only the recent bucket.
        const wideStart = new Date('2026-04-01T00:00:00.000Z');
        expect(store.periodTotals(wideStart, NOW).gross).toBe(20);
    });

    it('forgets seen-ids older than the dedup window (so they could be re-counted only outside the overlap)', () => {
        const store = new StripeAggregateStore({ dedupWindowSec: 3600 });
        const old = bt({ id: 'old', amount: 10_00, created: unix('2026-07-15T09:00:00Z') });
        store.ingestBalanceTransactions([old]);
        // Advance well past the dedup window and prune.
        store.prune(new Date('2026-07-15T12:00:00Z'));
        // Its id is forgotten, so a (hypothetical) re-ingest would count again —
        // safe in practice because items older than the overlap are never re-fetched.
        store.ingestBalanceTransactions([old]);
        expect(store.periodTotals(START_OF_DAY, NOW).gross).toBe(20);
    });
});
