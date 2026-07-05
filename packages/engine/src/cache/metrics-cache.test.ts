// Property-based tests for MetricsCache stale detection.
//
// Feature: ops-dashboard, Property 12: Stale data detection
//
// Task 2.3 / Property 12 (Validates Requirement 5.7): for any cache entry with
// a lastRefreshed timestamp and any current time, `isStale` returns true if and
// only if the elapsed time since lastRefreshed exceeds the threshold (default
// 120s). `isStale` reads the wall clock via Date.now(), so we drive time with
// Vitest fake timers and vary the elapsed offset + threshold with fast-check.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
    MetricsCache,
    DEFAULT_STALE_THRESHOLD_MS,
    STALE_GRACE_MS,
    staleThresholdMs,
} from './metrics-cache.js';

const BASE_TIME = Date.parse('2024-01-01T00:00:00.000Z');

describe('MetricsCache.isStale (Property 12: Stale data detection)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('is stale iff elapsed since lastRefreshed exceeds the threshold', () => {
        fc.assert(
            fc.property(
                // Elapsed time since the last successful refresh.
                fc.integer({ min: 0, max: 10_000_000 }),
                // Arbitrary staleness threshold.
                fc.integer({ min: 0, max: 10_000_000 }),
                (elapsedMs, thresholdMs) => {
                    vi.setSystemTime(BASE_TIME);
                    const cache = new MetricsCache();
                    // `set` stamps lastRefreshed with the current (fake) time.
                    // isStale ignores `data`, so a null payload is sufficient.
                    cache.set('health', null);

                    // Advance the clock so `now - lastRefreshed === elapsedMs`.
                    vi.setSystemTime(BASE_TIME + elapsedMs);

                    expect(cache.isStale('health', thresholdMs)).toBe(elapsedMs > thresholdMs);
                },
            ),
            { numRuns: 200 },
        );
    });

    it('uses the 120s default threshold when none is provided', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 10_000_000 }), (elapsedMs) => {
                vi.setSystemTime(BASE_TIME);
                const cache = new MetricsCache();
                cache.set('revenue', null);
                vi.setSystemTime(BASE_TIME + elapsedMs);

                expect(cache.isStale('revenue')).toBe(elapsedMs > DEFAULT_STALE_THRESHOLD_MS);
            }),
            { numRuns: 200 },
        );
    });

    it('treats a never-refreshed entry as stale for any threshold', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 10_000_000 }), (thresholdMs) => {
                const cache = new MetricsCache();
                expect(cache.isStale('summary', thresholdMs)).toBe(true);
            }),
            { numRuns: 100 },
        );
    });
});

describe('staleThresholdMs (interval-derived staleness threshold)', () => {
    it('is the refresh interval in ms plus the grace margin', () => {
        expect(staleThresholdMs(5)).toBe(5 * 60_000 + STALE_GRACE_MS);
        expect(staleThresholdMs(1)).toBe(1 * 60_000 + STALE_GRACE_MS);
        expect(staleThresholdMs(60)).toBe(60 * 60_000 + STALE_GRACE_MS);
    });

    it('never flags on-cadence data: elapsed up to one full interval stays fresh', () => {
        // Data at most `interval` old (just before the next poll) is not stale.
        const minutes = 5;
        const threshold = staleThresholdMs(minutes);
        expect(minutes * 60_000).toBeLessThan(threshold);
    });
});
