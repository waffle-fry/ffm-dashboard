// Metrics API routes.
//
// These endpoints serve cached, aggregated metrics to the Dashboard UI. Each
// route reads its entry from the MetricsCache and returns the last-good data
// alongside the metadata the UI needs to render loading / error / stale
// indicators:
//   - `data`         — the aggregated metric payload (null until first success)
//   - `lastRefreshed`— ISO 8601 timestamp of the last successful collection
//   - `lastError`    — most recent collection error, or null
//   - `isRefreshing` — true while a refresh is in progress (loading indicator)
//   - `isStale`      — true when the data is older than the staleness threshold
//
// Responses always use 200: per the resilience design (Requirements 5.6, 6.8,
// 9.5) the API keeps serving the last successfully retrieved values with an
// error/stale indicator rather than failing the request.

import { Router, type Request, type Response } from 'express';
import type { MetricsStore } from '@fans-fund-me/shared';
import {
    MetricsCache,
    METRIC_KEYS,
    type MetricKey,
} from '../cache/metrics-cache.js';

/** Shape returned by every metrics endpoint. */
export interface MetricResponse<K extends MetricKey> {
    data: MetricsStore[K]['data'];
    lastRefreshed: string | null;
    lastError: string | null;
    isRefreshing: boolean;
    isStale: boolean;
}

/** Builds the JSON body for a single metric entry from the cache. */
function toMetricResponse<K extends MetricKey>(
    cache: MetricsCache,
    key: K,
): MetricResponse<K> {
    const entry = cache.get(key);
    return {
        data: entry.data,
        lastRefreshed: entry.lastRefreshed,
        lastError: entry.lastError,
        isRefreshing: entry.isRefreshing,
        isStale: cache.isStale(key),
    };
}

/**
 * Creates the router mounted at `/api/metrics`.
 *
 * Endpoints (one per widget/metric key):
 *   GET /api/metrics/revenue
 *   GET /api/metrics/users
 *   GET /api/metrics/health
 *   GET /api/metrics/disputes
 *   GET /api/metrics/transactions
 *   GET /api/metrics/summary
 */
export function createMetricsRouter(cache: MetricsCache): Router {
    const router = Router();

    for (const key of METRIC_KEYS) {
        router.get(`/${key}`, (_req: Request, res: Response): void => {
            res.status(200).json(toMetricResponse(cache, key));
        });
    }

    return router;
}
