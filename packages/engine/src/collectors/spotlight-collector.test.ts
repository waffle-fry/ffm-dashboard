import { describe, it, expect } from 'vitest';
import {
    SpotlightCollector,
    aggregatePayments,
    selectRecentPayments,
    RECENT_PAYMENTS_LIMIT,
    type SpotlightSource,
    type SpotlightProfile,
    type SpotlightPayment,
} from './spotlight-collector.js';

const PROFILE: SpotlightProfile = {
    profileId: 'p1',
    username: 'yourstraightbf',
    displayName: 'Straight BF',
    country: 'GB',
    currency: 'GBP',
    ffmStatus: 'APPROVED',
    acceptingPayments: true,
};

const T0 = Date.parse('2026-07-01T00:00:00.000Z');
const PAYMENTS: SpotlightPayment[] = [
    { state: 'succeeded', recipientAmount: 550, recipientCurrency: 'GBP', createdUnixMilli: T0 + 1000 },
    { state: 'succeeded', recipientAmount: 1000, recipientCurrency: 'GBP', createdUnixMilli: T0 + 4000 },
    { state: 'requires_payment_method', recipientAmount: 999, recipientCurrency: 'GBP', createdUnixMilli: T0 + 3000 },
    { state: 'canceled', recipientAmount: 100, recipientCurrency: 'GBP', createdUnixMilli: T0 + 2000 },
];

/** Builds a SpotlightSource fake with overridable behaviour. */
function makeSource(overrides: Partial<SpotlightSource> = {}): SpotlightSource {
    return {
        getProfileByUsername: async () => PROFILE,
        getCustomer: async () => ({ stripeId: 'acct_1', email: 'a@b.com', country: 'GB' }),
        getReceivedPayments: async () => PAYMENTS,
        getBalance: async () => ({ available: 12345, pending: 6789 }),
        ...overrides,
    };
}

describe('aggregatePayments', () => {
    it('counts succeeded and sums only succeeded recipient amounts', () => {
        const totals = aggregatePayments(PAYMENTS);
        expect(totals.succeededCount).toBe(2);
        expect(totals.totalCount).toBe(4);
        expect(totals.succeededMinor).toBe(1550);
    });

    it('handles an empty list', () => {
        expect(aggregatePayments([])).toEqual({
            succeededCount: 0,
            totalCount: 0,
            succeededMinor: 0,
        });
    });
});

describe('selectRecentPayments', () => {
    it('returns payments newest-first, formatted, limited', () => {
        const recent = selectRecentPayments(PAYMENTS, 3);
        expect(recent).toHaveLength(3);
        // Newest first by createdUnixMilli: 1000(+4000), 999(+3000), 100(+2000).
        expect(recent.map((p) => p.amount)).toEqual(['10.00', '9.99', '1.00']);
        expect(recent[0]).toEqual({
            amount: '10.00',
            currency: 'GBP',
            state: 'succeeded',
            timestamp: new Date(T0 + 4000).toISOString(),
        });
    });

    it('does not mutate the input array', () => {
        const copy = [...PAYMENTS];
        selectRecentPayments(PAYMENTS);
        expect(PAYMENTS).toEqual(copy);
    });

    it('defaults to a limit of 10, newest first', () => {
        expect(RECENT_PAYMENTS_LIMIT).toBe(10);
        // 14 payments, one per minute; the default selection keeps the newest 10.
        const many: SpotlightPayment[] = Array.from({ length: 14 }, (_, i) => ({
            state: 'succeeded',
            recipientAmount: (i + 1) * 100,
            recipientCurrency: 'GBP',
            createdUnixMilli: T0 + i * 60_000,
        }));
        const recent = selectRecentPayments(many);
        expect(recent).toHaveLength(10);
        // Newest first: the last-created (i=13) is first.
        expect(recent[0].amount).toBe('14.00');
        expect(recent[9].amount).toBe('5.00');
    });
});

describe('SpotlightCollector', () => {
    it('assembles the payload with payments and balance', async () => {
        const collector = new SpotlightCollector(makeSource(), {
            username: 'yourstraightbf',
            // Pin "now" to just after the fixture payments so day metrics are
            // deterministic (all PAYMENTS fall on the same UTC day as T0).
            now: () => new Date(T0 + 5000),
        });
        const result = await collector.collect();
        const s = result.spotlight!;
        expect(s.username).toBe('yourstraightbf');
        expect(s.currency).toBe('GBP');
        expect(s.succeededPaymentCount).toBe(2);
        expect(s.totalPaymentCount).toBe(4);
        expect(s.succeededPaymentValue).toBe('15.50');
        // Both succeeded payments are on T0's UTC day -> today's totals match.
        expect(s.dayPaymentCount).toBe(2);
        expect(s.dayPaymentValue).toBe('15.50');
        expect(s.balanceAvailable).toBe('123.45');
        expect(s.balancePending).toBe('67.89');
        expect(s.balanceError).toBeNull();
        expect(s.profileError).toBeNull();
        expect(s.stripeAccountId).toBe('acct_1');
        // Recent payments included, newest first.
        expect(s.recentPayments).toHaveLength(4);
        expect(s.recentPayments[0].amount).toBe('10.00');
    });

    it('counts and sums only succeeded payments received today (since UTC midnight)', async () => {
        const dayStart = Date.parse('2026-07-05T00:00:00.000Z');
        const payments: SpotlightPayment[] = [
            // Today, succeeded -> counts.
            { state: 'succeeded', recipientAmount: 500, recipientCurrency: 'GBP', createdUnixMilli: dayStart + 3_600_000 },
            // Today, but not succeeded -> excluded from the count/value.
            { state: 'requires_payment_method', recipientAmount: 999, recipientCurrency: 'GBP', createdUnixMilli: dayStart + 100 },
            // Yesterday, succeeded -> counts for all-time but NOT today.
            { state: 'succeeded', recipientAmount: 250, recipientCurrency: 'GBP', createdUnixMilli: dayStart - 3_600_000 },
        ];
        const collector = new SpotlightCollector(
            makeSource({ getReceivedPayments: async () => payments }),
            { username: 'yourstraightbf', now: () => new Date(dayStart + 7_200_000) },
        );
        const s = (await collector.collect()).spotlight!;
        expect(s.dayPaymentCount).toBe(1);
        expect(s.dayPaymentValue).toBe('5.00');
        // All-time still counts both succeeded payments.
        expect(s.succeededPaymentCount).toBe(2);
        expect(s.succeededPaymentValue).toBe('7.50');
    });

    it('surfaces a balance error but still reports payments', async () => {
        const collector = new SpotlightCollector(
            makeSource({
                getBalance: async () => {
                    throw new Error('Permission denied. balance_read required.');
                },
            }),
            { username: 'yourstraightbf' },
        );
        const s = (await collector.collect()).spotlight!;
        expect(s.balanceError).toContain('balance_read');
        expect(s.balanceAvailable).toBeNull();
        expect(s.succeededPaymentCount).toBe(2);
        expect(s.succeededPaymentValue).toBe('15.50');
    });

    it('reports when no Stripe account is linked', async () => {
        const collector = new SpotlightCollector(
            makeSource({ getCustomer: async () => ({ stripeId: null, email: null, country: null }) }),
            { username: 'yourstraightbf' },
        );
        const s = (await collector.collect()).spotlight!;
        expect(s.stripeAccountId).toBeNull();
        expect(s.balanceError).toMatch(/no stripe account/i);
    });

    it('reports a profile error when the user is not found', async () => {
        const collector = new SpotlightCollector(
            makeSource({ getProfileByUsername: async () => null }),
            { username: 'ghost' },
        );
        const s = (await collector.collect()).spotlight!;
        expect(s.profileError).toContain('ghost');
        expect(s.succeededPaymentCount).toBe(0);
        expect(s.succeededPaymentValue).toBe('0.00');
    });
});
