import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    MINUTE_MS,
    minutesAgo,
    formatMinutesAgo,
    formatRelativeTime,
    formatStaleLabel,
    formatTimestamp,
} from './time-format';

const BASE = Date.parse('2024-01-01T12:00:00.000Z');

describe('minutesAgo', () => {
    it('returns null for missing or unparseable timestamps', () => {
        expect(minutesAgo(null, BASE)).toBeNull();
        expect(minutesAgo(undefined, BASE)).toBeNull();
        expect(minutesAgo('', BASE)).toBeNull();
        expect(minutesAgo('not-a-date', BASE)).toBeNull();
    });

    it('clamps sub-minute and future timestamps to 0', () => {
        expect(minutesAgo('2024-01-01T12:00:00.000Z', BASE)).toBe(0);
        expect(minutesAgo('2024-01-01T11:59:30.000Z', BASE)).toBe(0); // 30s ago
        expect(minutesAgo('2024-01-01T12:05:00.000Z', BASE)).toBe(0); // future
    });

    it('floors elapsed whole minutes', () => {
        expect(minutesAgo('2024-01-01T11:59:00.000Z', BASE)).toBe(1);
        expect(minutesAgo('2024-01-01T11:58:30.000Z', BASE)).toBe(1); // 90s -> 1
        expect(minutesAgo('2024-01-01T11:55:00.000Z', BASE)).toBe(5);
        expect(minutesAgo('2024-01-01T11:00:00.000Z', BASE)).toBe(60);
    });

    // Validates: Requirements 5.7 (relative age never negative, matches floor)
    it('never returns a negative age for any timestamp/now pair', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 4_000_000_000_000 }),
                fc.integer({ min: 0, max: 4_000_000_000_000 }),
                (thenMs, now) => {
                    const iso = new Date(thenMs).toISOString();
                    const result = minutesAgo(iso, now);
                    expect(result).not.toBeNull();
                    const minutes = result as number;
                    expect(minutes).toBeGreaterThanOrEqual(0);
                    if (now - thenMs <= 0) {
                        expect(minutes).toBe(0);
                    } else {
                        expect(minutes).toBe(Math.floor((now - thenMs) / MINUTE_MS));
                    }
                },
            ),
        );
    });
});

describe('formatMinutesAgo', () => {
    it('reads "just now" at or below zero minutes', () => {
        expect(formatMinutesAgo(0)).toBe('just now');
        expect(formatMinutesAgo(-3)).toBe('just now');
    });

    it('formats positive minutes as "X min ago"', () => {
        expect(formatMinutesAgo(1)).toBe('1 min ago');
        expect(formatMinutesAgo(42)).toBe('42 min ago');
    });
});

describe('formatStaleLabel', () => {
    it('produces the "Last updated: X min ago" indicator text', () => {
        expect(formatStaleLabel('2024-01-01T11:55:00.000Z', BASE)).toBe(
            'Last updated: 5 min ago',
        );
        expect(formatStaleLabel('2024-01-01T12:00:00.000Z', BASE)).toBe(
            'Last updated: just now',
        );
    });

    it('falls back to "unknown" when the timestamp is missing/invalid', () => {
        expect(formatStaleLabel(null, BASE)).toBe('Last updated: unknown');
        expect(formatStaleLabel('nope', BASE)).toBe('Last updated: unknown');
    });
});

describe('formatRelativeTime', () => {
    const iso = (ms: number): string => new Date(BASE - ms).toISOString();

    it('returns an em dash for missing or unparseable timestamps', () => {
        expect(formatRelativeTime(null, BASE)).toBe('—');
        expect(formatRelativeTime(undefined, BASE)).toBe('—');
        expect(formatRelativeTime('', BASE)).toBe('—');
        expect(formatRelativeTime('not-a-date', BASE)).toBe('—');
    });

    it('reads "just now" for sub-minute and future timestamps', () => {
        expect(formatRelativeTime(iso(0), BASE)).toBe('just now');
        expect(formatRelativeTime(iso(30_000), BASE)).toBe('just now'); // 30s
        expect(
            formatRelativeTime(new Date(BASE + 60_000).toISOString(), BASE),
        ).toBe('just now'); // future
    });

    it('formats minutes / hours / days / weeks ago', () => {
        expect(formatRelativeTime(iso(5 * 60_000), BASE)).toBe('5 minutes ago');
        expect(formatRelativeTime(iso(60 * 60_000), BASE)).toBe('1 hour ago');
        expect(formatRelativeTime(iso(3 * 60 * 60_000), BASE)).toBe(
            '3 hours ago',
        );
        expect(formatRelativeTime(iso(24 * 60 * 60_000), BASE)).toBe(
            '1 day ago',
        );
        expect(formatRelativeTime(iso(2 * 24 * 60 * 60_000), BASE)).toBe(
            '2 days ago',
        );
        expect(formatRelativeTime(iso(14 * 24 * 60 * 60_000), BASE)).toBe(
            '2 weeks ago',
        );
    });

    it('uses the singular unit form for exactly one', () => {
        expect(formatRelativeTime(iso(60_000), BASE)).toBe('1 minute ago');
    });
});

describe('formatTimestamp', () => {
    it('returns an em dash for missing or invalid timestamps', () => {
        expect(formatTimestamp(null)).toBe('—');
        expect(formatTimestamp('')).toBe('—');
        expect(formatTimestamp('not-a-date')).toBe('—');
    });

    it('returns a non-empty formatted string for a valid timestamp', () => {
        const out = formatTimestamp('2024-01-01T12:00:00.000Z');
        expect(typeof out).toBe('string');
        expect(out).not.toBe('—');
        expect(out.length).toBeGreaterThan(0);
    });
});
