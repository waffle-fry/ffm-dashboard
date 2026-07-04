// MongoCollector — user & creator growth metrics from MongoDB.
//
// Populates the `users` cache entry with a `UserGrowthMetrics` payload
// (Requirements 4.1, 4.2, 4.3, 4.5):
//   - total registered Creators and Fans (Req 4.1);
//   - new Creators / Fans registered in the current day / week / month, using
//     UTC period boundaries (Req 4.2);
//   - active Creators per period — distinct creators with at least one
//     successful payment whose timestamp falls inside the period (Req 4.3);
//   - every period metric is always present and defaults to 0 for empty
//     periods, never omitted (Req 4.5).
//
// Dependency inversion: this collector does NOT import the `mongodb` SDK.
// Instead it depends on a narrow, locally-defined {@link MongoClientPort} that
// describes only the two reads it needs (users and payments). The concrete
// `mongodb`-backed adapter is wired in later (task 8.1). This keeps the
// aggregation logic pure and unit-testable without a live database, and avoids
// a dependency/lockfile race with the sibling collector tasks.
//
// All period math reuses the shared UTC boundary helpers rather than
// reimplementing them.

import type { GrowthPeriod, UserGrowthMetrics } from '@fans-fund-me/shared';
import {
    getStartOfDay,
    getStartOfMonth,
    getStartOfWeek,
    isWithinPeriod,
} from '../utils/time-boundaries.js';
import type { CollectedMetrics, MetricCollector } from '../aggregator/scheduler.js';

/**
 * A user record as consumed by this collector — only the fields required to
 * count roles and detect new registrations within a period.
 */
export interface MongoUserRecord {
    /** Role discriminator; compared case-insensitively (see {@link CREATOR_ROLE}/{@link FAN_ROLE}). */
    role: string;
    /** ISO 8601 registration timestamp. */
    createdAt: string;
}

/**
 * A payment record as consumed by this collector — only the fields required to
 * detect active creators (Req 4.3).
 */
export interface MongoPaymentRecord {
    /** Identifier of the creator who received the payment. */
    creatorId: string;
    /** Payment status; only successful payments count towards active creators. */
    status: string;
    /** ISO 8601 timestamp the payment occurred. */
    createdAt: string;
}

/**
 * Narrow, injected MongoDB interface describing ONLY the queries this collector
 * consumes. The concrete driver-backed implementation is provided in task 8.1.
 */
export interface MongoClientPort {
    /**
     * Returns every user record with its role and registration timestamp, used
     * for total-per-role counts (Req 4.1) and new-per-period counts (Req 4.2).
     */
    getUsers(): Promise<MongoUserRecord[]>;

    /**
     * Returns payment records occurring at or after `since`, used to detect
     * active creators per period (Req 4.3). `since` is the earliest period
     * boundary the collector needs, so the driver can push the date filter down
     * to the query.
     */
    getPayments(since: Date): Promise<MongoPaymentRecord[]>;
}

/** Canonical (lower-case) role value for a Creator. */
export const CREATOR_ROLE = 'creator';

/** Canonical (lower-case) role value for a Fan. */
export const FAN_ROLE = 'fan';

/** Payment status that counts as a successful payment (Req 4.3). */
export const SUCCESSFUL_PAYMENT_STATUS = 'succeeded';

/** True when a user record's role matches `role`, compared case-insensitively. */
function hasRole(user: MongoUserRecord, role: string): boolean {
    return typeof user.role === 'string' && user.role.toLowerCase() === role;
}

/** True when a payment counts as successful for active-creator detection. */
function isSuccessfulPayment(payment: MongoPaymentRecord): boolean {
    return (
        typeof payment.status === 'string' &&
        payment.status.toLowerCase() === SUCCESSFUL_PAYMENT_STATUS
    );
}

/**
 * Counts users matching `role` (Req 4.1). Pure over the input array.
 */
export function countUsersByRole(users: readonly MongoUserRecord[], role: string): number {
    let count = 0;
    for (const user of users) {
        if (hasRole(user, role)) {
            count += 1;
        }
    }
    return count;
}

/**
 * Counts users matching `role` who registered within [periodStart, now] using
 * UTC boundaries (Req 4.2). Pure over the input array.
 */
export function countNewUsersInPeriod(
    users: readonly MongoUserRecord[],
    role: string,
    periodStart: Date,
    now: Date,
): number {
    let count = 0;
    for (const user of users) {
        if (hasRole(user, role) && isWithinPeriod(user.createdAt, periodStart, now)) {
            count += 1;
        }
    }
    return count;
}

/**
 * Counts DISTINCT creators with at least one successful payment inside
 * [periodStart, now] using UTC boundaries (Req 4.3). Pure over the input array.
 */
export function countActiveCreatorsInPeriod(
    payments: readonly MongoPaymentRecord[],
    periodStart: Date,
    now: Date,
): number {
    const activeCreatorIds = new Set<string>();
    for (const payment of payments) {
        if (isSuccessfulPayment(payment) && isWithinPeriod(payment.createdAt, periodStart, now)) {
            activeCreatorIds.add(payment.creatorId);
        }
    }
    return activeCreatorIds.size;
}

/**
 * Builds the {@link GrowthPeriod} metrics for a single period boundary. Every
 * field is always populated (defaulting to 0), so empty periods are reported as
 * zero rather than omitted (Req 4.5).
 */
function buildGrowthPeriod(
    users: readonly MongoUserRecord[],
    payments: readonly MongoPaymentRecord[],
    periodStart: Date,
    now: Date,
): GrowthPeriod {
    return {
        newCreators: countNewUsersInPeriod(users, CREATOR_ROLE, periodStart, now),
        newFans: countNewUsersInPeriod(users, FAN_ROLE, periodStart, now),
        activeCreators: countActiveCreatorsInPeriod(payments, periodStart, now),
    };
}

/**
 * Assembles the full {@link UserGrowthMetrics} payload from raw user and payment
 * records. Pure and deterministic given `now`, so it is directly unit- and
 * property-testable without a live database.
 */
export function buildUserGrowthMetrics(
    users: readonly MongoUserRecord[],
    payments: readonly MongoPaymentRecord[],
    now: Date,
): UserGrowthMetrics {
    const dayStart = getStartOfDay(now);
    const weekStart = getStartOfWeek(now);
    const monthStart = getStartOfMonth(now);

    return {
        totalCreators: countUsersByRole(users, CREATOR_ROLE),
        totalFans: countUsersByRole(users, FAN_ROLE),
        periods: {
            day: buildGrowthPeriod(users, payments, dayStart, now),
            week: buildGrowthPeriod(users, payments, weekStart, now),
            month: buildGrowthPeriod(users, payments, monthStart, now),
        },
        lastRefreshed: now.toISOString(),
    };
}

/**
 * The earliest period boundary the collector needs. The week can begin before
 * the month (e.g. early in a month whose 1st is not a Monday), so payments must
 * be fetched from the minimum of the three boundaries to correctly detect
 * active creators for every period.
 */
function earliestPeriodStart(now: Date): Date {
    const earliestMs = Math.min(
        getStartOfDay(now).getTime(),
        getStartOfWeek(now).getTime(),
        getStartOfMonth(now).getTime(),
    );
    return new Date(earliestMs);
}

/**
 * Collects user-growth metrics from MongoDB and feeds the `users` cache entry.
 * Conforms to the scheduler's {@link MetricCollector} contract so the
 * DataAggregator can run it alongside the other source collectors.
 */
export class MongoCollector implements MetricCollector {
    readonly name = 'MongoDB';
    readonly metricKeys = ['users'] as const;

    constructor(private readonly client: MongoClientPort) { }

    async collect(): Promise<CollectedMetrics> {
        const now = new Date();
        const [users, payments] = await Promise.all([
            this.client.getUsers(),
            this.client.getPayments(earliestPeriodStart(now)),
        ]);

        return { users: buildUserGrowthMetrics(users, payments, now) };
    }
}
