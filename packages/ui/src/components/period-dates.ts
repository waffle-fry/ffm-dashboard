// Period date labels for the day/week/month metrics.
//
// The engine aggregates every period on UTC calendar boundaries (day = midnight
// UTC, week = Monday 00:00 UTC, month = 1st 00:00 UTC). These helpers produce
// short, human-readable UTC date ranges so each metric shows exactly which
// dates it covers — e.g. day "4 Jul", week "30 Jun – 4 Jul", month "1 – 4 Jul".
//
// Pure and DOM-free (uses Intl with an explicit UTC timezone) so it can be
// unit-tested deterministically.

/** UTC midnight of the day containing `now`. */
export function utcStartOfDay(now: Date): Date {
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
}

/** UTC Monday 00:00 of the week containing `now` (weeks start Monday). */
export function utcStartOfWeek(now: Date): Date {
    const day = utcStartOfDay(now);
    // getUTCDay: 0=Sun..6=Sat. Days since Monday: Sun -> 6, else day-1.
    const dow = day.getUTCDay();
    const daysSinceMonday = dow === 0 ? 6 : dow - 1;
    return new Date(day.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

/** UTC 1st-of-month 00:00 of the month containing `now`. */
export function utcStartOfMonth(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const DAY_MONTH_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
});

/** Formats a date as e.g. "4 Jul" in UTC. */
export function formatDayMonth(date: Date): string {
    return DAY_MONTH_FMT.format(date);
}

/** Formats a `[start, end]` UTC range, collapsing to one label when equal. */
export function formatRange(start: Date, end: Date): string {
    const s = formatDayMonth(start);
    const e = formatDayMonth(end);
    return s === e ? s : `${s} – ${e}`;
}

/** Date labels for the day/week/month periods, all in UTC. */
export interface PeriodDateLabels {
    day: string;
    week: string;
    month: string;
}

/**
 * Compute the UTC date-range labels for the three reporting periods relative to
 * `now` (defaults to the current time). Each range runs from the period start
 * to the current UTC day (month-to-date / week-to-date).
 */
export function periodDateLabels(now: Date = new Date()): PeriodDateLabels {
    const today = utcStartOfDay(now);
    return {
        day: formatDayMonth(today),
        week: formatRange(utcStartOfWeek(now), today),
        month: formatRange(utcStartOfMonth(now), today),
    };
}
