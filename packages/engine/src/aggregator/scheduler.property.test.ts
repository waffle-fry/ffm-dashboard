// Property-based tests for the DataAggregator scheduler.
//
// Feature: ops-dashboard, Property 19: Refresh interval clamping
// Feature: ops-dashboard, Property 20: Duplicate refresh prevention
//
// Task 2.5 / Property 19 (Validates Requirement 8.1): for any numeric input the
// validated interval is clamped to [1, 60] and rounded to the nearest integer;
// non-numeric / non-finite inputs default to 5.
//
// Task 2.6 / Property 20 (Validates Requirement 8.4): for any burst of refresh
// requests issued while one refresh is in progress, exactly one refresh
// operation executes and all duplicates share the in-flight result.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MetricsCache } from '../cache/metrics-cache.js';
import {
    DataAggregator,
    clampRefreshInterval,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    MIN_REFRESH_INTERVAL_MINUTES,
    MAX_REFRESH_INTERVAL_MINUTES,
    type MetricCollector,
    type CollectedMetrics,
} from './scheduler.js';

/** Minimal valid RevenueMetrics payload. */
function revenueData(gross: string): CollectedMetrics {
    const period = {
        grossRevenue: gross,
        netRevenue: gross,
        totalFees: '0.00',
        successfulPayments: 0,
        failedPayments: 0,
        refunds: 0,
        averagePayment: null,
    };
    return {
        revenue: {
            periods: { day: period, week: period, month: period },
            lastRefreshed: '2024-01-01T00:00:00.000Z',
        },
    };
}

describe('clampRefreshInterval (Property 19: Refresh interval clamping)', () => {
    it('clamps any finite number to [1, 60] and rounds to nearest integer', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
                (value) => {
                    const result = clampRefreshInterval(value);

                    // Always within the allowed range.
                    expect(result).toBeGreaterThanOrEqual(MIN_REFRESH_INTERVAL_MINUTES);
                    expect(result).toBeLessThanOrEqual(MAX_REFRESH_INTERVAL_MINUTES);
                    expect(Number.isInteger(result)).toBe(true);

                    if (value < MIN_REFRESH_INTERVAL_MINUTES) {
                        expect(result).toBe(MIN_REFRESH_INTERVAL_MINUTES);
                    } else if (value > MAX_REFRESH_INTERVAL_MINUTES) {
                        expect(result).toBe(MAX_REFRESH_INTERVAL_MINUTES);
                    } else {
                        expect(result).toBe(Math.round(value));
                    }
                },
            ),
            { numRuns: 300 },
        );
    });

    it('defaults non-numeric or non-finite inputs to 5', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.string(),
                    fc.boolean(),
                    fc.constant(null),
                    fc.constant(undefined),
                    fc.constant(NaN),
                    fc.constant(Infinity),
                    fc.constant(-Infinity),
                    fc.object(),
                    fc.array(fc.anything()),
                ),
                (value) => {
                    expect(clampRefreshInterval(value)).toBe(DEFAULT_REFRESH_INTERVAL_MINUTES);
                },
            ),
            { numRuns: 200 },
        );
    });
});

describe('DataAggregator.refresh (Property 20: Duplicate refresh prevention)', () => {
    it('executes exactly one refresh for any burst of concurrent requests', async () => {
        await fc.assert(
            fc.asyncProperty(fc.integer({ min: 1, max: 25 }), async (requestCount) => {
                const cache = new MetricsCache();
                let collectCalls = 0;
                let release: (() => void) | null = null;

                const collector: MetricCollector = {
                    name: 'stripe',
                    metricKeys: ['revenue'],
                    collect: () =>
                        new Promise<CollectedMetrics>((resolve) => {
                            collectCalls += 1;
                            release = () => resolve(revenueData('1.00'));
                        }),
                };
                const agg = new DataAggregator(cache, [collector]);

                // Fire a burst of refresh requests while the first is in flight.
                const promises = Array.from({ length: requestCount }, () => agg.refresh());

                // Every duplicate request shares the single in-flight promise.
                for (const p of promises) {
                    expect(p).toBe(promises[0]);
                }
                expect(agg.isRefreshInProgress()).toBe(true);

                // Let the single collect resolve, then drain.
                release!();
                await Promise.all(promises);

                expect(collectCalls).toBe(1);
                expect(agg.isRefreshInProgress()).toBe(false);
            }),
            { numRuns: 100 },
        );
    });
});
