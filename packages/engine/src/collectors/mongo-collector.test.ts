// Unit tests for MongoCollector and its pure aggregation helpers.

import { describe, it, expect } from 'vitest';
import {
    MongoCollector,
    buildUserGrowthMetrics,
    countActiveCreatorsInPeriod,
    countNewUsersInPeriod,
    countUsersByRole,
    type MongoClientPort,
    type MongoPaymentRecord,
    type MongoUserRecord,
} from './mongo-collector.js';

// A fixed "now" for deterministic period math.
// 2024-01-17 is a Wednesday; week starts Monday 2024-01-15, month starts 2024-01-01.
const NOW = new Date('2024-01-17T12:00:00.000Z');

function creator(createdAt: string): MongoUserRecord {
    return { role: 'creator', createdAt };
}
function fan(createdAt: string): MongoUserRecord {
    return { role: 'fan', createdAt };
}
function payment(creatorId: string, createdAt: string, status = 'succeeded'): MongoPaymentRecord {
    return { creatorId, createdAt, status };
}

describe('countUsersByRole', () => {
    it('counts users matching a role case-insensitively', () => {
        const users: MongoUserRecord[] = [
            creator('2024-01-01T00:00:00.000Z'),
            { role: 'Creator', createdAt: '2024-01-02T00:00:00.000Z' },
            fan('2024-01-03T00:00:00.000Z'),
        ];
        expect(countUsersByRole(users, 'creator')).toBe(2);
        expect(countUsersByRole(users, 'fan')).toBe(1);
    });

    it('returns 0 for an empty set', () => {
        expect(countUsersByRole([], 'creator')).toBe(0);
    });
});

describe('countNewUsersInPeriod', () => {
    it('counts only role matches registered within [periodStart, now]', () => {
        const weekStart = new Date('2024-01-15T00:00:00.000Z');
        const users: MongoUserRecord[] = [
            creator('2024-01-16T09:00:00.000Z'), // in week
            creator('2024-01-10T09:00:00.000Z'), // before week
            fan('2024-01-16T10:00:00.000Z'), // in week but wrong role
            creator('2024-01-17T13:00:00.000Z'), // after now -> excluded
        ];
        expect(countNewUsersInPeriod(users, 'creator', weekStart, NOW)).toBe(1);
    });
});

describe('countActiveCreatorsInPeriod', () => {
    it('counts distinct creators with a successful payment in the period', () => {
        const dayStart = new Date('2024-01-17T00:00:00.000Z');
        const payments: MongoPaymentRecord[] = [
            payment('c1', '2024-01-17T01:00:00.000Z'),
            payment('c1', '2024-01-17T02:00:00.000Z'), // same creator -> not double counted
            payment('c2', '2024-01-17T03:00:00.000Z'),
            payment('c3', '2024-01-16T23:00:00.000Z'), // before day start
            payment('c4', '2024-01-17T04:00:00.000Z', 'failed'), // not successful
        ];
        expect(countActiveCreatorsInPeriod(payments, dayStart, NOW)).toBe(2);
    });

    it('returns 0 when no successful payments fall in the period', () => {
        expect(countActiveCreatorsInPeriod([], new Date('2024-01-01T00:00:00.000Z'), NOW)).toBe(0);
    });
});

describe('buildUserGrowthMetrics', () => {
    it('produces totals and all three periods with active creators', () => {
        const users: MongoUserRecord[] = [
            creator('2023-12-01T00:00:00.000Z'), // old creator (total only)
            creator('2024-01-17T08:00:00.000Z'), // new today
            fan('2024-01-16T00:00:00.000Z'), // new this week
            fan('2024-01-05T00:00:00.000Z'), // new this month
        ];
        const payments: MongoPaymentRecord[] = [
            payment('c1', '2024-01-17T09:00:00.000Z'), // active today/week/month
            payment('c2', '2024-01-03T09:00:00.000Z'), // active month only
        ];

        const m = buildUserGrowthMetrics(users, payments, NOW);

        expect(m.totalCreators).toBe(2);
        expect(m.totalFans).toBe(2);

        expect(m.periods.day.newCreators).toBe(1);
        expect(m.periods.day.newFans).toBe(0);
        expect(m.periods.day.activeCreators).toBe(1);

        expect(m.periods.week.newCreators).toBe(1);
        expect(m.periods.week.newFans).toBe(1);
        expect(m.periods.week.activeCreators).toBe(1);

        expect(m.periods.month.newCreators).toBe(1);
        expect(m.periods.month.newFans).toBe(2);
        expect(m.periods.month.activeCreators).toBe(2);

        expect(m.lastRefreshed).toBe(NOW.toISOString());
    });

    it('reports zero (never omits) for every empty period metric (Req 4.5)', () => {
        const m = buildUserGrowthMetrics([], [], NOW);
        expect(m.totalCreators).toBe(0);
        expect(m.totalFans).toBe(0);
        for (const period of [m.periods.day, m.periods.week, m.periods.month]) {
            expect(period.newCreators).toBe(0);
            expect(period.newFans).toBe(0);
            expect(period.activeCreators).toBe(0);
        }
    });
});

describe('MongoCollector', () => {
    it('conforms to the MetricCollector contract and returns the users key', async () => {
        const fakeClient: MongoClientPort = {
            getUsers: async () => [creator('2024-01-17T08:00:00.000Z'), fan('2024-01-17T09:00:00.000Z')],
            getPayments: async () => [payment('c1', '2024-01-17T10:00:00.000Z')],
        };
        const collector = new MongoCollector(fakeClient);

        expect(collector.name).toBe('MongoDB');
        expect(collector.metricKeys).toEqual(['users']);

        const result = await collector.collect();
        expect(result.users).toBeDefined();
        expect(result.users?.totalCreators).toBe(1);
        expect(result.users?.totalFans).toBe(1);
    });

    it('passes a Date lower bound to getPayments so the driver can filter by date', async () => {
        let requestedSince: unknown = null;
        const fakeClient: MongoClientPort = {
            getUsers: async () => [],
            getPayments: async (since: Date) => {
                requestedSince = since;
                return [];
            },
        };
        const collector = new MongoCollector(fakeClient);
        await collector.collect();
        expect(requestedSince).toBeInstanceOf(Date);
    });
});
