// Pure relative-time helpers for widget chrome.
//
// Kept free of any DOM/React dependency so the "Last updated: X min ago"
// derivation (Requirement 5.7 / 8.2) can be unit-tested deterministically by
// passing an explicit `now` rather than relying on the system clock.

/** Milliseconds in one minute. */
export const MINUTE_MS = 60_000;

/**
 * Whole minutes elapsed between an ISO 8601 timestamp and `now` (a millisecond
 * epoch). Returns `null` when the timestamp is missing or unparseable. Future
 * timestamps (and sub-minute differences) clamp to 0 so the label reads
 * sensibly rather than showing a negative age.
 */
export function minutesAgo(
    isoTimestamp: string | null | undefined,
    now: number,
): number | null {
    if (!isoTimestamp) return null;
    const then = Date.parse(isoTimestamp);
    if (Number.isNaN(then)) return null;
    const diffMs = now - then;
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / MINUTE_MS);
}

/**
 * Format a whole-minute count as a short relative phrase, e.g. `just now`,
 * `1 min ago`, `5 min ago`.
 */
export function formatMinutesAgo(minutes: number): string {
    if (minutes <= 0) return 'just now';
    return `${minutes} min ago`;
}

/**
 * The stale-data label shown alongside the ⚠ indicator (Requirement 5.7):
 * `Last updated: X min ago`. Falls back to `Last updated: unknown` when the
 * timestamp is absent or unparseable.
 */
export function formatStaleLabel(
    isoTimestamp: string | null | undefined,
    now: number,
): string {
    const minutes = minutesAgo(isoTimestamp, now);
    if (minutes === null) return 'Last updated: unknown';
    return `Last updated: ${formatMinutesAgo(minutes)}`;
}

/**
 * Ordered time divisions used to pick the largest sensible unit for a relative
 * phrase. Each `amount` is how many of the current unit make up one of the
 * next. Seconds are intentionally omitted — anything under a minute reads as
 * "just now" for the transaction feed.
 */
const RELATIVE_DIVISIONS: ReadonlyArray<{
    amount: number;
    unit: Intl.RelativeTimeFormatUnit;
}> = [
        { amount: 60, unit: 'minute' },
        { amount: 24, unit: 'hour' },
        { amount: 7, unit: 'day' },
        { amount: 4.34524, unit: 'week' },
        { amount: 12, unit: 'month' },
        { amount: Number.POSITIVE_INFINITY, unit: 'year' },
    ];

/** Shared, reused relative-time formatter ("2 minutes ago", "1 hour ago"). */
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en', {
    numeric: 'always',
});

/**
 * Format an ISO 8601 timestamp as a short "<x> <unit> ago" phrase relative to
 * `now` (a millisecond epoch), e.g. `just now`, `5 minutes ago`, `3 hours ago`,
 * `2 days ago`. Chooses the largest unit for which the value is at least one.
 *
 * Returns an em dash when the timestamp is missing or unparseable, and clamps
 * future timestamps to `just now` so the label never reads negatively. Kept
 * pure (an explicit `now` is passed) so it can be unit-tested deterministically.
 */
export function formatRelativeTime(
    isoTimestamp: string | null | undefined,
    now: number,
): string {
    if (!isoTimestamp) return '—';
    const then = Date.parse(isoTimestamp);
    if (Number.isNaN(then)) return '—';

    const diffSeconds = Math.round((now - then) / 1000);
    // Sub-minute (and future) timestamps read as "just now".
    if (diffSeconds < 60) return 'just now';

    let duration = diffSeconds / 60; // start in minutes
    for (const division of RELATIVE_DIVISIONS) {
        if (duration < division.amount) {
            // Negative value => past => "… ago".
            return RELATIVE_TIME_FORMATTER.format(
                -Math.round(duration),
                division.unit,
            );
        }
        duration /= division.amount;
    }
    // Unreachable: the final division uses Infinity, but satisfy the type.
    return RELATIVE_TIME_FORMATTER.format(-Math.round(duration), 'year');
}

/**
 * Human-readable local time for the "last refreshed" timestamp (Requirement
 * 8.2). Returns an em dash when the value is absent or unparseable so the
 * chrome always renders something stable.
 */
export function formatTimestamp(isoTimestamp: string | null | undefined): string {
    if (!isoTimestamp) return '—';
    const parsed = new Date(isoTimestamp);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleTimeString();
}
