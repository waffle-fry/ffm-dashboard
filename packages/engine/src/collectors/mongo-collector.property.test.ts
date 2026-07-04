// Property-based tests for the MongoCollector's pure aggregation helpers.
//
// Feature: ops-dashboard, Property 8: User count aggregation by role and time
// boundary (task 6.7).
// Feature: ops-dashboard, Property 9: Active creator detection (task 6.8).
//
// Task 6.7 / Property 8 (Validates Requirements 4.1, 4.2): for any set of user
// records with roles (Creator/Fan) and registration timestamps, the total count
// per role SHALL equal the number of records whose role matches (compared
// case-insensitively), and the new-count within a UTC period SHALL equal the
// number of matching-role records whose createdAt falls inside [periodStart, now].
//
// Task 6.8 / Property 9 (Validates Requirement 4.3): for any set of creators and
// payments, the active-creator count for a period SHALL equal the number of
// DISTINCT creatorIds that have at least one successful payment (status
// 'succeeded', compared case-insensitively) whose timestamp falls inside the
// period's UTC boundaries [periodStart, now].
//
// Each property computes the expected value with an independent reference in the
// test (not by calling the production helper under test), so the property is a
// genuine cross-check rather than a tautology. The reference mirrors the source's
// exact matching semantics: role via `role.toLowerCase() === canonical`, status
// via `status.toLowerCase() === 'succeeded'`, and inclusion via an absolute-instant
// `ts >= periodStart && ts <= now` comparison with unparseable timestamps excluded.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    buildUserGrowthMetrics,
    countActiveCreatorsInPeriod,
    countNewUsersInPeriod,
    countUsersByRole,
    CREATOR_ROLE,
    FAN_ROLE,
    SUCCESSFUL_PAYMENT_STATUS,
    type MongoPaymentRecord,
    type MongoUserRecord,
} from './mongo-collector.js';
import {
    getStartOfDay,
    getStartOfMonth,
    getStartOfWeek,
} from '../utils/time-boundaries.js';

// --- Independent reference implementations ---------------------------------
// These deliberately re-derive the answer from first principles rather than
// reusing the production helpers, so the properties cross-check the source.

/** Reference role match: case-insensitive equality against a canonical role. */
function refHasRole(user: MongoUserRecord, canonicalRole: string): boolean {
    return typeof user.role === 'string' && user.role.toLowerCase() === canonicalRole;
}

/** Reference success match: case-insensitive equality against 'succeeded'. */
function refIsSuccessful(payment: MongoPaymentRecord): boolean {
    return (
        typeof payment.status === 'string' &&
        payment.status.toLowerCase() === SUCCESSFUL_PAYMENT_STATUS
    );
}

/** Reference inclusion: absolute-instant [periodStart, now], bad timestamps excluded. */
function refWithinPeriod(timestamp: string, periodStart: Date, now: Date): boolean {
    const ts = Date.parse(timestamp);
    if (Number.isNaN(ts)) {
        return false;
    }
    return ts >= periodStart.getTime() && ts <= now.getTime();
}

function refCountByRole(users: readonly MongoUserRecord[], canonicalRole: string): number {
    return users.filter((u) => refHasRole(u, canonicalRole)).length;
}

function refCountNewInPeriod(
    users: readonly MongoUserRecord[],
    canonicalRole: string,
    periodStart: Date,
    now: Date,
): number {
    return users.filter(
        (u) => refHasRole(u, canonicalRole) && refWithinPeriod(u.createdAt, periodStart, now),
    ).length;
}

function refActiveCreators(
    payments: readonly MongoPaymentRecord[],
    periodStart: Date,
    now: Date,
): number {
    const ids = new Set<string>();
    for (const p of payments) {
        if (refIsSuccessful(p) && refWithinPeriod(p.createdAt, periodStart, now)) {
            ids.add(p.creatorId);
        }
    }
    return ids.size;
}

// --- Generators -------------------------------------------------------------

// A fixed reference "now". 2024-01-17 is a Wednesday, so the three period
// boundaries are distinct: day 2024-01-17, week (Monday) 2024-01-15,
// month 2024-01-01. Generating timestamps around this range guarantees a mix of
// in-period and out-of-period records for every period.
const NOW = new Date('2024-01-17T12:00:00.000Z');
const NOW_MS = NOW.getTime();

// Span from ~40 days before `now` (well before the month start) to ~1 day after
// `now` (after the upper bound), so records land both inside and outside each of
// the day/week/month windows and also strictly after `now` (excluded).
const RANGE_START_MS = NOW_MS - 40 * 24 * 60 * 60 * 1000;
const RANGE_END_MS = NOW_MS + 24 * 60 * 60 * 1000;

// ISO timestamps spread across the range, with extra weight on the exact
// boundaries so the inclusive [periodStart, now] edges are exercised.
const timestampArb: fc.Arbitrary<string> = fc.oneof(
    {
        weight: 6,
        arbitrary: fc
            .integer({ min: RANGE_START_MS, max: RANGE_END_MS })
            .map((ms) => new Date(ms).toISOString()),
    },
    {
        weight: 1,
        arbitrary: fc.constantFrom(
            NOW.toISOString(), // exactly `now` (included)
            new Date(NOW_MS + 1).toISOString(), // just after `now` (excluded)
            getStartOfDay(NOW).toISOString(), // exactly day start (included)
            new Date(getStartOfDay(NOW).getTime() - 1).toISOString(), // just before day start
            getStartOfWeek(NOW).toISOString(), // exactly week start (included)
            getStartOfMonth(NOW).toISOString(), // exactly month start (included)
        ),
    },
);

// Mixed-case role strings, including non-Creator/Fan roles. The source compares
// case-insensitively, so 'Creator', 'CREATOR', 'creator' must all count as
// creators, while 'admin'/'' count as neither.
const roleArb: fc.Arbitrary<string> = fc.constantFrom(
    'creator',
    'Creator',
    'CREATOR',
    'CrEaToR',
    'fan',
    'Fan',
    'FAN',
    'fAn',
    'admin',
    'moderator',
    '',
);

const userArb: fc.Arbitrary<MongoUserRecord> = fc.record({
    role: roleArb,
    createdAt: timestampArb,
});

// Duplicate-friendly creator id space so the distinct-count is genuinely
// exercised (a small pool means the same id recurs across payments).
const creatorIdArb: fc.Arbitrary<string> = fc.constantFrom('c1', 'c2', 'c3', 'c4', 'c5');

// Mixed payment statuses, including non-successful ones and case variants of
// 'succeeded' which the source treats as successful.
const statusArb: fc.Arbitrary<string> = fc.constantFrom(
    'succeeded',
    'Succeeded',
    'SUCCEEDED',
    'failed',
    'pending',
    'refunded',
    'canceled',
    '',
);

const paymentArb: fc.Arbitrary<MongoPaymentRecord> = fc.record({
    creatorId: creatorIdArb,
    status: statusArb,
    createdAt: timestampArb,
});

// minLength 0 so empty arrays (an important edge case) are generated.
const usersArb = fc.array(userArb, { minLength: 0, maxLength: 60 });
const paymentsArb = fc.array(paymentArb, { minLength: 0, maxLength: 60 });

// The three real UTC period boundaries relative to NOW, plus their labels.
const periodBoundaries: ReadonlyArray<{ label: string; start: Date }> = [
    { label: 'day', start: getStartOfDay(NOW) },
    { label: 'week', start: getStartOfWeek(NOW) },
    { label: 'month', start: getStartOfMonth(NOW) },
];

// --- Property 8: user count aggregation ------------------------------------

describe('Property 8: User count aggregation by role and time boundary (task 6.7)', () => {
    it('countUsersByRole equals the independent per-role match count (Req 4.1)', () => {
        fc.assert(
            fc.property(usersArb, (users) => {
                expect(countUsersByRole(users, CREATOR_ROLE)).toBe(
                    refCountByRole(users, CREATOR_ROLE),
                );
                expect(countUsersByRole(users, FAN_ROLE)).toBe(refCountByRole(users, FAN_ROLE));
            }),
            { numRuns: 200 },
        );
    });

    it('countNewUsersInPeriod equals matching-role records within [periodStart, now] (Req 4.2)', () => {
        fc.assert(
            fc.property(usersArb, (users) => {
                for (const { start } of periodBoundaries) {
                    expect(countNewUsersInPeriod(users, CREATOR_ROLE, start, NOW)).toBe(
                        refCountNewInPeriod(users, CREATOR_ROLE, start, NOW),
                    );
                    expect(countNewUsersInPeriod(users, FAN_ROLE, start, NOW)).toBe(
                        refCountNewInPeriod(users, FAN_ROLE, start, NOW),
                    );
                }
            }),
            { numRuns: 200 },
        );
    });

    it('buildUserGrowthMetrics totals and per-period new-counts match the reference (Req 4.1, 4.2)', () => {
        fc.assert(
            fc.property(usersArb, paymentsArb, (users, payments) => {
                const metrics = buildUserGrowthMetrics(users, payments, NOW);

                expect(metrics.totalCreators).toBe(refCountByRole(users, CREATOR_ROLE));
                expect(metrics.totalFans).toBe(refCountByRole(users, FAN_ROLE));

                const dayStart = getStartOfDay(NOW);
                const weekStart = getStartOfWeek(NOW);
                const monthStart = getStartOfMonth(NOW);

                expect(metrics.periods.day.newCreators).toBe(
                    refCountNewInPeriod(users, CREATOR_ROLE, dayStart, NOW),
                );
                expect(metrics.periods.day.newFans).toBe(
                    refCountNewInPeriod(users, FAN_ROLE, dayStart, NOW),
                );
                expect(metrics.periods.week.newCreators).toBe(
                    refCountNewInPeriod(users, CREATOR_ROLE, weekStart, NOW),
                );
                expect(metrics.periods.week.newFans).toBe(
                    refCountNewInPeriod(users, FAN_ROLE, weekStart, NOW),
                );
                expect(metrics.periods.month.newCreators).toBe(
                    refCountNewInPeriod(users, CREATOR_ROLE, monthStart, NOW),
                );
                expect(metrics.periods.month.newFans).toBe(
                    refCountNewInPeriod(users, FAN_ROLE, monthStart, NOW),
                );
            }),
            { numRuns: 200 },
        );
    });
});

// --- Property 9: active creator detection ----------------------------------

describe('Property 9: Active creator detection (task 6.8)', () => {
    it('countActiveCreatorsInPeriod equals distinct creators with an in-period successful payment (Req 4.3)', () => {
        fc.assert(
            fc.property(paymentsArb, (payments) => {
                for (const { start } of periodBoundaries) {
                    expect(countActiveCreatorsInPeriod(payments, start, NOW)).toBe(
                        refActiveCreators(payments, start, NOW),
                    );
                }
            }),
            { numRuns: 200 },
        );
    });

    it('never exceeds the number of distinct creatorIds present (distinct-count sanity)', () => {
        fc.assert(
            fc.property(paymentsArb, (payments) => {
                const distinctIds = new Set(payments.map((p) => p.creatorId)).size;
                for (const { start } of periodBoundaries) {
                    const active = countActiveCreatorsInPeriod(payments, start, NOW);
                    expect(active).toBeGreaterThanOrEqual(0);
                    expect(active).toBeLessThanOrEqual(distinctIds);
                }
            }),
            { numRuns: 200 },
        );
    });

    it('buildUserGrowthMetrics per-period activeCreators match the reference (Req 4.3)', () => {
        fc.assert(
            fc.property(usersArb, paymentsArb, (users, payments) => {
                const metrics = buildUserGrowthMetrics(users, payments, NOW);
                expect(metrics.periods.day.activeCreators).toBe(
                    refActiveCreators(payments, getStartOfDay(NOW), NOW),
                );
                expect(metrics.periods.week.activeCreators).toBe(
                    refActiveCreators(payments, getStartOfWeek(NOW), NOW),
                );
                expect(metrics.periods.month.activeCreators).toBe(
                    refActiveCreators(payments, getStartOfMonth(NOW), NOW),
                );
            }),
            { numRuns: 200 },
        );
    });
});
