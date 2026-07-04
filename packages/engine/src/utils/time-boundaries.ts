// UTC time-boundary utilities.
//
// The dashboard aggregates revenue and user-growth metrics for the current day,
// week, and month (Requirements 3.1, 3.2, 4.2, 4.3). All boundaries are computed
// in UTC so that results are independent of the server's local timezone, and the
// week is defined to start on Monday (ISO-8601 style) at 00:00:00.000 UTC.
//
// Every function accepts an optional `now` parameter (defaulting to `new Date()`)
// so callers and tests can pin the "current" moment deterministically.

/**
 * Returns the UTC start of the current day: midnight (00:00:00.000) UTC on the
 * same calendar date as `now`.
 */
export function getStartOfDay(now: Date = new Date()): Date {
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
}

/**
 * Returns the UTC start of the current week, where weeks start on Monday at
 * 00:00:00.000 UTC.
 *
 * `getUTCDay()` numbers days Sunday=0..Saturday=6, so Monday is 1. To find how
 * many days to subtract to reach the most recent Monday we compute
 * `(day + 6) % 7`: Monday(1) -> 0, Tuesday(2) -> 1, ..., Sunday(0) -> 6, which
 * correctly maps Sunday back to the previous Monday.
 */
export function getStartOfWeek(now: Date = new Date()): Date {
    const day = now.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - daysSinceMonday,
        ),
    );
}

/**
 * Returns the UTC start of the current month: the 1st at 00:00:00.000 UTC in the
 * same year/month as `now`.
 */
export function getStartOfMonth(now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Returns true if the given ISO 8601 `timestamp` falls within the inclusive
 * range [periodStart, now]. All comparisons are done on absolute instants (UTC),
 * so the result is timezone-independent.
 *
 * An unparseable timestamp yields false rather than throwing, so a single bad
 * record cannot break an aggregation over many records.
 */
export function isWithinPeriod(
    timestamp: string,
    periodStart: Date,
    now: Date = new Date(),
): boolean {
    const ts = Date.parse(timestamp);
    if (Number.isNaN(ts)) {
        return false;
    }
    return ts >= periodStart.getTime() && ts <= now.getTime();
}
