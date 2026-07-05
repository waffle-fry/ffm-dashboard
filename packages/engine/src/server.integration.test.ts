// Integration tests for the Dashboard Engine HTTP API (spec task 8.2).
//
// These exercise the real Express app produced by `createApp`, wired to a real
// MetricsCache and a real DataAggregator driven by in-memory fake collectors
// (no external SDKs / network). Requests go over the loopback interface on an
// ephemeral port using the global `fetch`, and every server is closed in
// teardown so no handles leak.
//
// Coverage:
//   - Metrics endpoints return the { data, lastRefreshed, lastError,
//     isRefreshing, isStale } envelope with the cached payload (Req 3.1, 4.1,
//     5.1, 6.1, 9.1, 10.1).
//   - Config endpoints expose the AggregatorConfig and clamp the interval to
//     [1, 60] (Req 8.1).
//   - Refresh endpoints trigger the aggregator (202), refresh a single widget,
//     and reject an unknown widget (400).
//   - Error states retain last-good data with the error surfaced.

import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type {
    RevenueMetrics,
    UserGrowthMetrics,
    SystemHealthMetrics,
    DisputeMetrics,
    TransactionFeedMetrics,
    PlatformSummaryMetrics,
} from '@fans-fund-me/shared';
import { createApp } from './server.js';
import { MetricsCache } from './cache/metrics-cache.js';
import {
    DataAggregator,
    type MetricCollector,
    type CollectedMetrics,
} from './aggregator/scheduler.js';

// ---------------------------------------------------------------------------
// Minimal valid payloads for each metric shape.
// ---------------------------------------------------------------------------

const ISO = '2024-01-01T00:00:00.000Z';

function revenuePayload(): RevenueMetrics {
    const period = {
        grossRevenue: '1234.56',
        netRevenue: '1000.00',
        totalFees: '234.56',
        successfulPayments: 10,
        failedPayments: 1,
        refunds: 0,
        averagePayment: '123.45',
    };
    return {
        periods: { day: period, week: period, month: period },
        lastRefreshed: ISO,
    };
}

function usersPayload(): UserGrowthMetrics {
    const period = { newCreators: 2, newFans: 5, activeCreators: 3 };
    return {
        totalCreators: 42,
        totalFans: 100,
        periods: { day: period, week: period, month: period },
        lastRefreshed: ISO,
    };
}

function healthPayload(): SystemHealthMetrics {
    return {
        services: [
            {
                name: 'api',
                status: 'healthy',
                uptime24h: '99.95',
                uptime7d: '99.90',
                alertFiring: false,
                lastUpdated: ISO,
            },
        ],
        apiMetrics: { errorRatePerMinute: 0, avgLatencyMs: 120 },
        lastRefreshed: ISO,
    };
}

function disputesPayload(): DisputeMetrics {
    return {
        nearestDeadlineDays: 3,
        disputes: [
            {
                paymentId: 'pi_123',
                amountUsd: '45.00',
                daysRemaining: 3,
                evidenceUploaded: true,
                evidenceSubmitted: false,
                evidenceBatch: 7,
                status: 'needs_response',
            },
        ],
        evidenceError: null,
        lastRefreshed: ISO,
    };
}

function transactionsPayload(): TransactionFeedMetrics {
    return {
        transactions: [
            {
                idSuffix: '…d4f3',
                amount: '19.99',
                currency: 'GBP',
                timestamp: ISO,
            },
        ],
        lastRefreshed: ISO,
    };
}

function summaryPayload(): PlatformSummaryMetrics {
    return {
        monthlyGrossVolume: '987654.32',
        monthlyTakeRate: '12.50',
        monthlyDisputeRate: '0.15',
        monthlyPaymentCount: 320,
        stripeBalanceUsd: '761.44',
        stripeBalanceError: null,
        mercuryBalanceUsd: '12000.00',
        mercuryBalanceError: null,
        totalBalanceUsd: '12761.44',
        totalBalanceGbp: '9554.00',
        lastRefreshed: ISO,
    };
}

// ---------------------------------------------------------------------------
// Test server + fetch helpers.
// ---------------------------------------------------------------------------

interface Harness {
    cache: MetricsCache;
    aggregator: DataAggregator;
    baseUrl: string;
    server: Server;
}

const openServers: Server[] = [];

/** Starts the real app on an ephemeral port and returns a request harness. */
function startHarness(collectors: readonly MetricCollector[] = []): Harness {
    const cache = new MetricsCache();
    const aggregator = new DataAggregator(cache, collectors);
    const app = createApp({ cache, aggregator });
    const server = app.listen(0);
    openServers.push(server);
    const { port } = server.address() as AddressInfo;
    return { cache, aggregator, server, baseUrl: `http://127.0.0.1:${port}` };
}

/** Closes a single server, resolving once the handle is fully released. */
function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
}

afterEach(async () => {
    // Close every server started during the test so no handle leaks.
    await Promise.all(openServers.splice(0).map(closeServer));
});

// ---------------------------------------------------------------------------
// Metrics endpoints (Req 3.1, 4.1, 5.1, 6.1, 9.1, 10.1).
// ---------------------------------------------------------------------------

describe('GET /api/metrics/:widget', () => {
    const cases = [
        { key: 'revenue', payload: revenuePayload() },
        { key: 'users', payload: usersPayload() },
        { key: 'health', payload: healthPayload() },
        { key: 'disputes', payload: disputesPayload() },
        { key: 'transactions', payload: transactionsPayload() },
        { key: 'summary', payload: summaryPayload() },
    ] as const;

    for (const { key, payload } of cases) {
        it(`returns the ${key} envelope with populated data`, async () => {
            const h = startHarness();
            h.cache.set(key, payload as never);

            const res = await fetch(`${h.baseUrl}/api/metrics/${key}`);
            expect(res.status).toBe(200);

            const body = await res.json();
            // Envelope shape.
            expect(Object.keys(body).sort()).toEqual(
                ['data', 'isRefreshing', 'isStale', 'lastError', 'lastRefreshed'].sort(),
            );
            // Data is exactly what was cached.
            expect(body.data).toEqual(payload);
            expect(body.lastError).toBeNull();
            expect(body.isRefreshing).toBe(false);
            expect(typeof body.lastRefreshed).toBe('string');
            // Just-set data is fresh, not stale.
            expect(body.isStale).toBe(false);
        });
    }

    it('returns an empty envelope (data null, stale) before population', async () => {
        const h = startHarness();

        const res = await fetch(`${h.baseUrl}/api/metrics/revenue`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toBeNull();
        expect(body.lastRefreshed).toBeNull();
        expect(body.isStale).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Config endpoints (Req 8.1).
// ---------------------------------------------------------------------------

describe('config endpoints', () => {
    it('GET /api/config returns the current AggregatorConfig', async () => {
        const h = startHarness();

        const res = await fetch(`${h.baseUrl}/api/config`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toEqual(h.aggregator.getConfig());
        expect(typeof body.refreshIntervalMinutes).toBe('number');
        expect(typeof body.sourceTimeoutMs).toBe('number');
    });

    it('PUT /api/config clamps a below-range interval to 1', async () => {
        const h = startHarness();

        const res = await fetch(`${h.baseUrl}/api/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshIntervalMinutes: 0 }),
        });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.refreshIntervalMinutes).toBe(1);
        expect(h.aggregator.getRefreshIntervalMinutes()).toBe(1);
    });

    it('PUT /api/config clamps an above-range interval to 60', async () => {
        const h = startHarness();

        const res = await fetch(`${h.baseUrl}/api/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshIntervalMinutes: 999 }),
        });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.refreshIntervalMinutes).toBe(60);
    });

    it('PUT /api/config applies a valid in-range interval', async () => {
        const h = startHarness();

        const put = await fetch(`${h.baseUrl}/api/config`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshIntervalMinutes: 15 }),
        });
        expect(put.status).toBe(200);
        expect((await put.json()).refreshIntervalMinutes).toBe(15);

        // Follow-up GET reflects the applied value.
        const get = await fetch(`${h.baseUrl}/api/config`);
        expect((await get.json()).refreshIntervalMinutes).toBe(15);
    });
});

// ---------------------------------------------------------------------------
// Refresh endpoints.
// ---------------------------------------------------------------------------

describe('refresh endpoints', () => {
    it('POST /api/refresh triggers the aggregator and returns 202', async () => {
        let calls = 0;
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => {
                calls += 1;
                return { revenue: revenuePayload() };
            },
        };
        const h = startHarness([collector]);

        const res = await fetch(`${h.baseUrl}/api/refresh`, { method: 'POST' });
        expect(res.status).toBe(202);

        const body = await res.json();
        expect(body.triggered).toBe(true);
        expect(body.alreadyInProgress).toBe(false);
        expect(body.scope).toBe('all');

        // The fire-and-forget refresh runs the collector and updates the cache.
        await h.aggregator.refresh();
        expect(calls).toBeGreaterThanOrEqual(1);
        expect(h.cache.get('revenue').data).toEqual(revenuePayload());
    });

    it('POST /api/refresh/:widget triggers a single-widget refresh (202)', async () => {
        let revenueCalls = 0;
        let usersCalls = 0;
        const stripe: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async () => {
                revenueCalls += 1;
                return { revenue: revenuePayload() };
            },
        };
        const mongo: MetricCollector = {
            name: 'mongo',
            metricKeys: ['users'],
            collect: async () => {
                usersCalls += 1;
                return { users: usersPayload() };
            },
        };
        const h = startHarness([stripe, mongo]);

        const res = await fetch(`${h.baseUrl}/api/refresh/revenue`, { method: 'POST' });
        expect(res.status).toBe(202);

        const body = await res.json();
        expect(body.triggered).toBe(true);
        expect(body.scope).toBe('revenue');

        // Only the revenue collector runs for a revenue-scoped refresh.
        await h.aggregator.refreshWidget('revenue');
        expect(revenueCalls).toBeGreaterThanOrEqual(1);
        expect(usersCalls).toBe(0);
        expect(h.cache.get('revenue').data).toEqual(revenuePayload());
    });

    it('POST /api/refresh/:widget returns 400 for an unknown widget', async () => {
        const h = startHarness();

        const res = await fetch(`${h.baseUrl}/api/refresh/not-a-widget`, {
            method: 'POST',
        });
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toBe('unknown_widget');
        expect(body.validWidgets).toContain('revenue');
    });

    it('POST /api/refresh reports alreadyInProgress for a duplicate request', async () => {
        // A deferred collector keeps the first refresh in-flight so the second
        // request observes it as already running.
        let release: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const collector: MetricCollector = {
            name: 'stripe',
            metricKeys: ['revenue'],
            collect: async (): Promise<CollectedMetrics> => {
                await gate;
                return { revenue: revenuePayload() };
            },
        };
        const h = startHarness([collector]);

        // Start a refresh directly and hold it open (route is fire-and-forget).
        const inFlight = h.aggregator.refresh();
        expect(h.aggregator.isRefreshInProgress()).toBe(true);

        const res = await fetch(`${h.baseUrl}/api/refresh`, { method: 'POST' });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body.triggered).toBe(false);
        expect(body.alreadyInProgress).toBe(true);

        // Let the held refresh finish and settle.
        release!();
        await inFlight;
    });
});

// ---------------------------------------------------------------------------
// Error state: last-good data retained with the error surfaced.
// ---------------------------------------------------------------------------

describe('error state', () => {
    it('retains last-good data and surfaces the error indicator', async () => {
        const h = startHarness();
        // Seed good data, then record a collection failure.
        h.cache.set('revenue', revenuePayload() as never);
        h.cache.setError('revenue', 'stripe timed out');

        const res = await fetch(`${h.baseUrl}/api/metrics/revenue`);
        expect(res.status).toBe(200);

        const body = await res.json();
        // Last-good data is still served.
        expect(body.data).toEqual(revenuePayload());
        // The error is surfaced alongside it.
        expect(body.lastError).toBe('stripe timed out');
        expect(body.lastRefreshed).not.toBeNull();
        expect(body.isRefreshing).toBe(false);
    });
});
