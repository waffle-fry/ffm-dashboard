import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RevenueMetrics } from '@fans-fund-me/shared';
import {
    buildMetricUrl,
    isMetricEnvelope,
    reduceMetricsState,
    initialMetricsState,
    computeIsStale,
    formatRelativeTime,
    pollIntervalFromMinutes,
    fetchMetric,
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_STALE_THRESHOLD_MS,
    type FetchOutcome,
    type MetricEnvelope,
    type MetricsState,
} from './useMetrics';

// A representative payload for the revenue widget.
const REVENUE: RevenueMetrics = {
    periods: {
        day: {
            grossRevenue: '10.00',
            netRevenue: '9.00',
            totalFees: '1.00',
            successfulPayments: 2,
            failedPayments: 0,
            refunds: 0,
            averagePayment: '5.00',
        },
        week: {
            grossRevenue: '20.00',
            netRevenue: '18.00',
            totalFees: '2.00',
            successfulPayments: 4,
            failedPayments: 1,
            refunds: 0,
            averagePayment: '5.00',
        },
        month: {
            grossRevenue: '40.00',
            netRevenue: '36.00',
            totalFees: '4.00',
            successfulPayments: 8,
            failedPayments: 1,
            refunds: 1,
            averagePayment: '5.00',
        },
    },
    lastRefreshed: '2024-01-01T00:00:00.000Z',
};

function envelope(
    overrides: Partial<MetricEnvelope<RevenueMetrics>> = {},
): MetricEnvelope<RevenueMetrics> {
    return {
        data: REVENUE,
        lastRefreshed: '2024-01-01T00:00:00.000Z',
        lastError: null,
        isRefreshing: false,
        isStale: false,
        ...overrides,
    };
}

describe('buildMetricUrl', () => {
    it('builds the /api/metrics/{widget} path for each widget', () => {
        expect(buildMetricUrl('revenue')).toBe('/api/metrics/revenue');
        expect(buildMetricUrl('users')).toBe('/api/metrics/users');
        expect(buildMetricUrl('summary')).toBe('/api/metrics/summary');
    });
});

describe('pollIntervalFromMinutes', () => {
    it('converts minutes to milliseconds', () => {
        expect(pollIntervalFromMinutes(5)).toBe(300_000);
        expect(pollIntervalFromMinutes(1)).toBe(60_000);
    });
    it('rounds fractional minutes to the nearest minute', () => {
        expect(pollIntervalFromMinutes(2.4)).toBe(120_000);
        expect(pollIntervalFromMinutes(2.6)).toBe(180_000);
    });
    it('falls back to the default for non-positive/non-finite values', () => {
        expect(pollIntervalFromMinutes(0)).toBe(DEFAULT_POLL_INTERVAL_MS);
        expect(pollIntervalFromMinutes(-3)).toBe(DEFAULT_POLL_INTERVAL_MS);
        expect(pollIntervalFromMinutes(Number.NaN)).toBe(
            DEFAULT_POLL_INTERVAL_MS,
        );
    });
});

describe('isMetricEnvelope', () => {
    it('accepts a well-formed envelope (data present, even when null)', () => {
        expect(isMetricEnvelope(envelope())).toBe(true);
        expect(isMetricEnvelope(envelope({ data: null }))).toBe(true);
        expect(
            isMetricEnvelope(
                envelope({ lastRefreshed: null, lastError: 'boom' }),
            ),
        ).toBe(true);
    });
    it('rejects non-objects and malformed envelopes', () => {
        expect(isMetricEnvelope(null)).toBe(false);
        expect(isMetricEnvelope(42)).toBe(false);
        expect(isMetricEnvelope([])).toBe(false);
        // missing data key
        expect(
            isMetricEnvelope({
                lastRefreshed: null,
                lastError: null,
                isRefreshing: false,
                isStale: false,
            }),
        ).toBe(false);
        // wrong types
        expect(
            isMetricEnvelope({
                data: null,
                lastRefreshed: 5,
                lastError: null,
                isRefreshing: false,
                isStale: false,
            }),
        ).toBe(false);
        expect(
            isMetricEnvelope({
                data: null,
                lastRefreshed: null,
                lastError: null,
                isRefreshing: 'no',
                isStale: false,
            }),
        ).toBe(false);
    });
});

describe('reduceMetricsState (Req 8.2, 8.3, 8.5)', () => {
    const prev: MetricsState<RevenueMetrics> = {
        data: REVENUE,
        lastRefreshed: '2024-01-01T00:00:00.000Z',
        error: null,
        isStale: false,
        isLoading: true,
    };

    it('adopts server data, lastRefreshed, isStale and reflects lastError on success', () => {
        const outcome: FetchOutcome<RevenueMetrics> = {
            kind: 'success',
            response: envelope({
                lastRefreshed: '2024-02-02T00:00:00.000Z',
                lastError: null,
                isStale: true,
                isRefreshing: false,
            }),
        };
        const next = reduceMetricsState(initialMetricsState(), outcome);
        expect(next.data).toEqual(REVENUE);
        expect(next.lastRefreshed).toBe('2024-02-02T00:00:00.000Z');
        expect(next.error).toBeNull();
        expect(next.isStale).toBe(true);
        expect(next.isLoading).toBe(false);
    });

    it('treats a backend isRefreshing flag as still loading (Req 8.5)', () => {
        const next = reduceMetricsState(initialMetricsState(), {
            kind: 'success',
            response: envelope({ isRefreshing: true }),
        });
        expect(next.isLoading).toBe(true);
    });

    it('surfaces a server-reported lastError while keeping the served data', () => {
        const next = reduceMetricsState(initialMetricsState(), {
            kind: 'success',
            response: envelope({ lastError: 'stripe down', isStale: true }),
        });
        expect(next.error).toBe('stripe down');
        expect(next.data).toEqual(REVENUE);
    });

    it('retains previous data on error and records the error (Req 8.3)', () => {
        const next = reduceMetricsState(prev, {
            kind: 'error',
            message: 'Network error',
        });
        expect(next.data).toEqual(REVENUE); // not cleared
        expect(next.lastRefreshed).toBe('2024-01-01T00:00:00.000Z'); // retained
        expect(next.error).toBe('Network error');
        expect(next.isStale).toBe(true);
        expect(next.isLoading).toBe(false);
    });

    it('clears a prior error on the next successful fetch (Req 8.3)', () => {
        const errored = reduceMetricsState(prev, {
            kind: 'error',
            message: 'boom',
        });
        expect(errored.error).toBe('boom');
        const recovered = reduceMetricsState(errored, {
            kind: 'success',
            response: envelope({ lastError: null }),
        });
        expect(recovered.error).toBeNull();
    });
});

describe('computeIsStale (120s threshold)', () => {
    const base = Date.parse('2024-01-01T00:00:00.000Z');
    it('is stale when never refreshed', () => {
        expect(computeIsStale(null, base)).toBe(true);
    });
    it('is stale for an unparseable timestamp', () => {
        expect(computeIsStale('not-a-date', base)).toBe(true);
    });
    it('is not stale within the threshold', () => {
        const t = new Date(base).toISOString();
        expect(computeIsStale(t, base + DEFAULT_STALE_THRESHOLD_MS)).toBe(false);
        expect(computeIsStale(t, base + 60_000)).toBe(false);
    });
    it('is stale just past the threshold', () => {
        const t = new Date(base).toISOString();
        expect(
            computeIsStale(t, base + DEFAULT_STALE_THRESHOLD_MS + 1),
        ).toBe(true);
    });
    it('honours a custom threshold', () => {
        const t = new Date(base).toISOString();
        expect(computeIsStale(t, base + 5_000, 10_000)).toBe(false);
        expect(computeIsStale(t, base + 11_000, 10_000)).toBe(true);
    });
});

describe('formatRelativeTime', () => {
    const base = Date.parse('2024-01-01T12:00:00.000Z');
    const ago = (ms: number) => new Date(base - ms).toISOString();
    it('returns "never" for null/invalid', () => {
        expect(formatRelativeTime(null, base)).toBe('never');
        expect(formatRelativeTime('nope', base)).toBe('never');
    });
    it('returns "just now" under a minute', () => {
        expect(formatRelativeTime(ago(30_000), base)).toBe('just now');
    });
    it('formats minutes, hours and days', () => {
        expect(formatRelativeTime(ago(5 * 60_000), base)).toBe('5 min ago');
        expect(formatRelativeTime(ago(3 * 3_600_000), base)).toBe('3 hr ago');
        expect(formatRelativeTime(ago(24 * 3_600_000), base)).toBe('1 day ago');
        expect(formatRelativeTime(ago(48 * 3_600_000), base)).toBe('2 days ago');
    });
});

describe('fetchMetric (global fetch)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns success with a valid envelope', async () => {
        const body = envelope();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => body,
            }),
        );
        const outcome = await fetchMetric<RevenueMetrics>('revenue');
        expect(outcome.kind).toBe('success');
        if (outcome.kind === 'success') {
            expect(outcome.response.data).toEqual(REVENUE);
        }
        expect(fetch).toHaveBeenCalledWith(
            '/api/metrics/revenue',
            expect.objectContaining({ headers: { Accept: 'application/json' } }),
        );
    });

    it('returns error on non-2xx status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: async () => ({}),
            }),
        );
        const outcome = await fetchMetric('health');
        expect(outcome).toEqual({
            kind: 'error',
            message: 'Request failed with status 500',
        });
    });

    it('returns error on a malformed body', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ nope: true }),
            }),
        );
        const outcome = await fetchMetric('users');
        expect(outcome).toEqual({
            kind: 'error',
            message: 'Malformed metrics response',
        });
    });

    it('returns error on a network failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('connection refused')),
        );
        const outcome = await fetchMetric('summary');
        expect(outcome).toEqual({
            kind: 'error',
            message: 'connection refused',
        });
    });

    it('returns a timeout error when the request aborts', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation((_url, init: RequestInit) => {
                return new Promise((_resolve, reject) => {
                    const signal = init.signal as AbortSignal;
                    signal.addEventListener('abort', () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                });
            }),
        );
        const outcome = await fetchMetric('disputes', 5);
        expect(outcome).toEqual({
            kind: 'error',
            message: 'Request timed out after 5ms',
        });
    });
});
