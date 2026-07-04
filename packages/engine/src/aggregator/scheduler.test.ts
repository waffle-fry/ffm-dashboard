// Unit tests for the DataAggregator scheduler.
//
// Covers interval clamping, duplicate-refresh prevention, parallel independent
// collector timeouts, and success/error cache writes. Property-based coverage
// for clamping (Property 19) and duplicate prevention (Property 20) lives in
// separate tasks (2.5, 2.6).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsCache } from '../cache/metrics-cache.js';
import {
    DataAggregator,
    clampRefreshInterval,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    DEFAULT_SOURCE_TIMEOUT_MS,
    type MetricCollector,
    type CollectedMetrics,
} from './scheduler.js';

/** Minimal RevenueMetrics payload for tests. */
function revenueData(gross: string): CollectedMetrics {
    return {
        revenue: {
            periods: {
                day: emptyPeriod(gross),
                week: emptyPeriod(gross),
                month: emptyPeriod(gross),
            },
            lastRefreshed: '2024-01-01T00:00:00.000Z',
        },
    };
}

function emptyPeriod(gross: string) {
    return {
        grossRevenue: gross,
        netRevenue: gross,
        totalFees: '0.00',
        successfulPayments: 0,
        failedPayments: 0,
        refunds: 0,
        averagePayment: null,
    };
}

describe('clampRefreshInterval', () => {
    it('defaults non-numeric and undefined inputs to 5', () => {
        expect(clampRefreshInterval(undefined)).toBe(DEFAULT_REFRESH_INTERVAL_MINUTES);
        expect(clampRefreshInterval('10')).toBe(5);
        expect(clampRefreshInterval(NaN)).toBe(5);
        expect(clampRefreshInterval(Infinity)).toBe(5);
        expect(clampRefreshInterval(null)).toBe(5);
    });

    it('clamps below-range values to 1', () => {
        expect(clampRefreshInterval(0)).toBe(1);
        expect(clampRefreshInterval(-42)).toBe(1);
        expect(clampRefreshInterval(0.4)).toBe(1);
    });

    it('clamps above-range values to 60', () => {
        expect(clampRefreshInterval(61)).toBe(60);
        expect(clampRefreshInterval(1000)).toBe(60);
    });

    it('rounds in-range values to the nearest integer', () => {
        expect(clampRefreshInterval(5)).toBe(5);
        expect(clampRefreshInterval(1.5)).toBe(2);
        expect(clampRefreshInterval(59.6)).toBe(60);
        expect(clampRefreshInterval(30.2)).toBe(30);
    });
});

describe('DataAggregator refresh', () => {
    let cache: MetricsCache;

    beforeEach(() => {
        cache = new MetricsCache();
    });

    it('defaults interval and timeout when config omitted', () => {
        const agg = new DataAggregator(cache, []);
        expect(agg.getRefreshIntervalMinutes()).toBe(DEFAULT_REFRESH_INTERVAL_MINUTES);
    });

    it('writes fresh data to the cache on collector success', async () => {
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => revenueData('123.45'),
        };
        const agg = new DataAggregator(cache, [collector]);

        await agg.refresh();

        const entry = cache.get('revenue');
        expect(entry.data?.periods.day.grossRevenue).toBe('123.45');
        expect(entry.lastError).toBeNull();
        expect(entry.isRefreshing).toBe(false);
    });

    it('records an error and retains last-good data on collector failure', async () => {
        let shouldFail = false;
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => {
                if (shouldFail) {
                    throw new Error('boom');
                }
                return revenueData('50.00');
            },
        };
        const agg = new DataAggregator(cache, [collector]);

        await agg.refresh(); // seeds last-good data
        shouldFail = true;
        await agg.refresh(); // now fails

        const entry = cache.get('revenue');
        expect(entry.lastError).toBe('boom');
        // last-good data retained
        expect(entry.data?.periods.day.grossRevenue).toBe('50.00');
        expect(entry.isRefreshing).toBe(false);
    });

    it('isolates failures: one failing source does not block others', async () => {
        const stripe: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => {
                throw new Error('stripe down');
            },
        };
        const mongo: MetricCollector = {
            name: 'mongo',
            metricKeys: ['users'],
            collect: async () => ({
                users: {
                    totalCreators: 3,
                    totalFans: 7,
                    periods: {
                        day: { newCreators: 0, newFans: 0, activeCreators: 0 },
                        week: { newCreators: 0, newFans: 0, activeCreators: 0 },
                        month: { newCreators: 0, newFans: 0, activeCreators: 0 },
                    },
                    lastRefreshed: '2024-01-01T00:00:00.000Z',
                },
            }),
        };
        const agg = new DataAggregator(cache, [stripe, mongo]);

        await agg.refresh();

        expect(cache.get('revenue').lastError).toBe('stripe down');
        expect(cache.get('users').lastError).toBeNull();
        expect(cache.get('users').data?.totalCreators).toBe(3);
    });

    it('times out a slow source independently and marks it errored', async () => {
        vi.useFakeTimers();
        try {
            const slow: MetricCollector = {
                name: 'grafana',
                metricKeys: ['health'],
                collect: () => new Promise<CollectedMetrics>(() => { }), // never resolves
            };
            const agg = new DataAggregator(cache, [slow], { sourceTimeoutMs: 100 });

            const refreshPromise = agg.refresh();
            await vi.advanceTimersByTimeAsync(150);
            await refreshPromise;

            const entry = cache.get('health');
            expect(entry.lastError).toContain('timed out');
            expect(entry.isRefreshing).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('prevents duplicate refreshes: exactly one runs while in progress', async () => {
        let calls = 0;
        let resolveCollect: (() => void) | null = null;
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: () =>
                new Promise<CollectedMetrics>((resolve) => {
                    calls += 1;
                    resolveCollect = () => resolve(revenueData('1.00'));
                }),
        };
        const agg = new DataAggregator(cache, [collector]);

        const first = agg.refresh();
        const second = agg.refresh();
        const third = agg.refresh();

        // All duplicate requests share the same in-flight promise.
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(agg.isRefreshInProgress()).toBe(true);

        resolveCollect!();
        await Promise.all([first, second, third]);

        expect(calls).toBe(1);
        expect(agg.isRefreshInProgress()).toBe(false);
    });

    it('allows a new refresh after the previous one completes', async () => {
        let calls = 0;
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => {
                calls += 1;
                return revenueData('2.00');
            },
        };
        const agg = new DataAggregator(cache, [collector]);

        await agg.refresh();
        await agg.refresh();

        expect(calls).toBe(2);
    });

    it('marks a declared-but-missing metric key as errored', async () => {
        const collector: MetricCollector = {
            name: 'stripe',
            // declares two keys but only returns one
            metricKeys: ['revenue', 'summary'],
            collect: async () => revenueData('9.99'),
        };
        const agg = new DataAggregator(cache, [collector]);

        await agg.refresh();

        expect(cache.get('revenue').data?.periods.day.grossRevenue).toBe('9.99');
        expect(cache.get('summary').lastError).toContain('returned no data');
    });
});

describe('DataAggregator polling lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('start triggers an immediate refresh and then polls at the interval', async () => {
        const cache = new MetricsCache();
        let calls = 0;
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => {
                calls += 1;
                return revenueData('1.00');
            },
        };
        const agg = new DataAggregator(cache, [collector], { refreshIntervalMinutes: 1 });

        agg.start();
        expect(agg.isRunning()).toBe(true);
        await vi.advanceTimersByTimeAsync(0); // let immediate refresh run
        expect(calls).toBe(1);

        await vi.advanceTimersByTimeAsync(60_000); // one interval
        expect(calls).toBe(2);

        agg.stop();
        expect(agg.isRunning()).toBe(false);

        await vi.advanceTimersByTimeAsync(120_000); // no further polls after stop
        expect(calls).toBe(2);
    });

    it('setRefreshInterval clamps and applies the new value', () => {
        const cache = new MetricsCache();
        const agg = new DataAggregator(cache, []);
        expect(agg.setRefreshInterval(90)).toBe(60);
        expect(agg.getRefreshIntervalMinutes()).toBe(60);
        expect(agg.setRefreshInterval(0)).toBe(1);
        expect(agg.setRefreshInterval('nope')).toBe(5);
    });
});
