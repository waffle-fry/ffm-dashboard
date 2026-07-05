import { describe, it, expect } from 'vitest';
import {
    SpotlightCollector,
    aggregatePayments,
    selectRecentPayments,
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
});

describe('SpotlightCollector', () => {
    it('assembles the payload with payments and balance', async () => {
        const collector = new SpotlightCollector(makeSource(), {
            username: 'yourstraightbf',
        });
        const result = await collector.collect();
        const s = result.spotlight!;
        expect(s.username).toBe('yourstraightbf');
        expect(s.currency).toBe('GBP');
        expect(s.succeededPaymentCount).toBe(2);
        expect(s.totalPaymentCount).toBe(4);
        expect(s.succeededPaymentValue).toBe('15.50');
        expect(s.balanceAvailable).toBe('123.45');
        expect(s.balancePending).toBe('67.89');
        expect(s.balanceError).toBeNull();
        expect(s.profileError).toBeNull();
        expect(s.stripeAccountId).toBe('acct_1');
        // Recent payments included, newest first.
        expect(s.recentPayments).toHaveLength(4);
        expect(s.recentPayments[0].amount).toBe('10.00');
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
