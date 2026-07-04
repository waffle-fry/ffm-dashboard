// Property-based tests for MetricsCache stale-data detection.
//
// Feature: ops-dashboard, Property 12: Stale data detection
//
// Task 2.3 / Property 12 (Validates Requirements 5.7):
//   For any cache entry with a `lastRefreshed` timestamp and any current time,
//   `isStale(key, thresholdMs)` returns true if and only if the elapsed time
//   since the last refresh exceeds the threshold (design default: 120s).
//
// Contract confirmed against ./metrics-cache.ts:
//   - Signature: isStale(key, thresholdMs = DEFAULT_STALE_THRESHOLD_MS): boolean
//   - "now" is read from Date.now(); there is no injectable clock, so we drive
//     time deterministically with Vitest fake timers.
//   - Boundary is STRICT: `elapsedMs > thresholdMs`. Therefore elapsed == threshold
//     is NOT stale; only elapsed == threshold + 1 is stale.
//   - A never-refreshed entry (lastRefreshed === null) is treated as stale.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { MetricsCache, DEFAULT_STALE_THRESHOLD_MS, type MetricKey } from './metrics-cache.js';

// Fixed base timestamp so `set` stamps a known lastRefreshed value under fake timers.
const BASE_TIME = Date.parse('2024-01-01T00:00:00.000Z');

// Design's Property 12 threshold: 120 seconds.
const THRESHOLD_MS = DEFAULT_STALE_THRESHOLD_MS; // 120_000

describe('MetricsCache.isStale (Feature: ops-dashboard, Property 12: Stale data detection)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Property 12 (Validates Requirements 5.7)
    // Populate an entry with a known lastRefreshed, then for arbitrary elapsed
    // offsets assert isStale is true iff elapsed exceeds the 120s threshold.
    // The generator mixes broad random offsets with the exact boundary values
    // (threshold - 1, threshold, threshold + 1) so the strict `>` edge is hit.
    it('is stale iff elapsed since lastRefreshed exceeds the 120s threshold', () => {
        const elapsedArb = fc.oneof(
            // Broad range spanning well below and well above the threshold.
            fc.integer({ min: 0, max: 10_000_000 }),
            // Exact boundary values around the strict `>` comparison.
            fc.constantFrom(
                THRESHOLD_MS - 1, // just under  -> NOT stale
                THRESHOLD_MS, //     exactly    -> NOT stale (strict boundary)
                THRESHOLD_MS + 1, // just over   -> stale
            ),
        );

        fc.assert(
            fc.property(elapsedArb, (elapsedMs) => {
                vi.setSystemTime(BASE_TIME);
                const cache = new MetricsCache();
                // `set` stamps lastRefreshed with the current (fake) time.
                // isStale ignores `data`, so a null payload is sufficient.
                cache.set('health', null);

                // Advance the clock so that now - lastRefreshed === elapsedMs.
                vi.setSystemTime(BASE_TIME + elapsedMs);

                expect(cache.isStale('health', THRESHOLD_MS)).toBe(elapsedMs > THRESHOLD_MS);
            }),
            { numRuns: 300 },
        );
    });

    // Same property but exercising arbitrary thresholds too, to prove the
    // strict `>` relationship holds for any (elapsed, threshold) pair and for
    // the default-threshold overload.
    it('is stale iff elapsed exceeds an arbitrary threshold (default overload included)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 10_000_000 }),
                fc.integer({ min: 0, max: 10_000_000 }),
                fc.boolean(),
                (elapsedMs, thresholdMs, useDefault) => {
                    vi.setSystemTime(BASE_TIME);
                    const cache = new MetricsCache();
                    cache.set('revenue', null);
                    vi.setSystemTime(BASE_TIME + elapsedMs);

                    if (useDefault) {
                        expect(cache.isStale('revenue')).toBe(elapsedMs > DEFAULT_STALE_THRESHOLD_MS);
                    } else {
                        expect(cache.isStale('revenue', thresholdMs)).toBe(elapsedMs > thresholdMs);
                    }
                },
            ),
            { numRuns: 300 },
        );
    });

    // Explicit, non-random assertions for the exact strict-boundary values,
    // documenting the `>` (not `>=`) contract for each metric key.
    it('treats elapsed == threshold as fresh and threshold + 1 as stale (strict boundary)', () => {
        const keys: readonly MetricKey[] = [
            'revenue',
            'users',
            'health',
            'disputes',
            'transactions',
            'summary',
        ];

        for (const key of keys) {
            // threshold - 1 -> fresh
            vi.setSystemTime(BASE_TIME);
            let cache = new MetricsCache();
            cache.set(key, null);
            vi.setSystemTime(BASE_TIME + (THRESHOLD_MS - 1));
            expect(cache.isStale(key, THRESHOLD_MS)).toBe(false);

            // threshold exactly -> fresh (strict `>`)
            vi.setSystemTime(BASE_TIME);
            cache = new MetricsCache();
            cache.set(key, null);
            vi.setSystemTime(BASE_TIME + THRESHOLD_MS);
            expect(cache.isStale(key, THRESHOLD_MS)).toBe(false);

            // threshold + 1 -> stale
            vi.setSystemTime(BASE_TIME);
            cache = new MetricsCache();
            cache.set(key, null);
            vi.setSystemTime(BASE_TIME + (THRESHOLD_MS + 1));
            expect(cache.isStale(key, THRESHOLD_MS)).toBe(true);
        }
    });

    // A never-refreshed entry (lastRefreshed === null) is stale for any threshold.
    it('treats a never-refreshed entry as stale for any threshold', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 10_000_000 }), (thresholdMs) => {
                const cache = new MetricsCache();
                // No `set` call -> lastRefreshed is null.
                expect(cache.isStale('summary', thresholdMs)).toBe(true);
                expect(cache.isStale('summary')).toBe(true);
            }),
            { numRuns: 100 },
        );
    });
});
