// In-memory metrics cache with stale detection.
//
// Holds the aggregated metrics for each widget keyed by metric type. The cache
// is the single source of truth the API layer reads from, and is written to by
// the DataAggregator scheduler (task 2.4) as source collectors complete.
//
// Resilience contract (Requirements 5.6, 6.8, 9.5): cached data is NEVER
// cleared on error. `setError` only records the error message and clears the
// refreshing flag, leaving the last-good `data` and `lastRefreshed` intact so
// the UI can keep showing the most recent successful values with a stale/error
// indicator. The only path that overwrites `data` is `set`, which is called on
// a successful collection.

import type { CacheEntry, MetricsStore } from '@fans-fund-me/shared';

/** The six metric keys tracked by the store. */
export type MetricKey = keyof MetricsStore;

/**
 * The canonical list of metric keys, in a stable order.
 *
 * Exposed so the API layer can map incoming route parameters (e.g.
 * `/api/refresh/:widget`) to a validated {@link MetricKey} without duplicating
 * the string literals. Declared `as const` so it doubles as a runtime
 * membership check and a compile-time exhaustiveness guard against
 * {@link MetricsStore}.
 */
export const METRIC_KEYS = [
    'revenue',
    'users',
    'health',
    'disputes',
    'transactions',
    'summary',
    'spotlight',
] as const satisfies readonly MetricKey[];

/** Runtime type guard: true when `value` is one of the known metric keys. */
export function isMetricKey(value: unknown): value is MetricKey {
    return typeof value === 'string' && (METRIC_KEYS as readonly string[]).includes(value);
}

/**
 * Default staleness threshold in milliseconds (120 seconds).
 *
 * Retained as the default for {@link MetricsCache.isStale} when no explicit
 * threshold is supplied. In production the metrics route derives the threshold
 * from the live refresh interval instead (see {@link staleThresholdMs}), so a
 * widget is only "stale" when a poll has actually been missed rather than
 * merely between two on-schedule polls.
 */
export const DEFAULT_STALE_THRESHOLD_MS = 120_000;

/**
 * Grace margin (ms) added to the poll interval before data is considered stale.
 *
 * Absorbs the time a refresh cycle itself takes plus scheduler jitter, so
 * data that arrives on the normal cadence is never flagged stale. Only a
 * genuinely missed poll (elapsed > interval + grace) trips the indicator.
 */
export const STALE_GRACE_MS = 60_000;

/**
 * Staleness threshold derived from the polling interval (Requirement 5.7):
 * `refreshIntervalMinutes` converted to ms, plus {@link STALE_GRACE_MS}. Pure
 * and side-effect-free for direct unit testing.
 */
export function staleThresholdMs(refreshIntervalMinutes: number): number {
    return refreshIntervalMinutes * 60_000 + STALE_GRACE_MS;
}

/** Builds a fresh, empty cache entry (no data yet). */
function emptyEntry<T>(): CacheEntry<T> {
    return {
        data: null,
        lastRefreshed: null,
        lastError: null,
        isRefreshing: false,
    };
}

/**
 * In-memory implementation of the {@link MetricsStore} contract.
 *
 * All six entries are initialized empty on construction. Reads are type-safe:
 * `get('revenue')` returns a `CacheEntry<RevenueMetrics>`, `get('users')` a
 * `CacheEntry<UserGrowthMetrics>`, and so on.
 */
export class MetricsCache {
    private readonly store: MetricsStore;

    constructor() {
        this.store = {
            revenue: emptyEntry(),
            users: emptyEntry(),
            health: emptyEntry(),
            disputes: emptyEntry(),
            transactions: emptyEntry(),
            summary: emptyEntry(),
            spotlight: emptyEntry(),
        };
    }

    /** Returns the cache entry for the given metric key (typed to that metric). */
    get<K extends MetricKey>(key: K): MetricsStore[K] {
        return this.store[key];
    }

    /**
     * Stores fresh data for a metric after a successful collection.
     *
     * Sets `lastRefreshed` to the current ISO 8601 timestamp, clears any prior
     * error, and marks the entry as no longer refreshing. This is the ONLY
     * method that overwrites `data`.
     */
    set<K extends MetricKey>(key: K, data: MetricsStore[K]['data']): void {
        const entry = this.store[key];
        entry.data = data;
        entry.lastRefreshed = new Date().toISOString();
        entry.lastError = null;
        entry.isRefreshing = false;
    }

    /**
     * Records a collection failure for a metric.
     *
     * Sets `lastError` and clears the refreshing flag, but deliberately leaves
     * `data` and `lastRefreshed` untouched so the last-good values are retained
     * (Requirements 5.6, 6.8, 9.5).
     */
    setError<K extends MetricKey>(key: K, error: string): void {
        const entry = this.store[key];
        entry.lastError = error;
        entry.isRefreshing = false;
    }

    /** Sets the in-progress refresh flag for a metric. */
    setRefreshing<K extends MetricKey>(key: K, isRefreshing: boolean): void {
        this.store[key].isRefreshing = isRefreshing;
    }

    /**
     * Returns true iff the entry's data is considered stale.
     *
     * Staleness is a pure function of (lastRefreshed, now, thresholdMs): the
     * entry is stale when it has a `lastRefreshed` timestamp AND the elapsed
     * time since then exceeds `thresholdMs`.
     *
     * Design choice for a null timestamp: an entry that has never been
     * successfully refreshed has no meaningful "last good" data, so it is
     * treated as stale (returns true). Callers that only want to flag
     * previously-populated data can check `data`/`lastRefreshed` separately.
     */
    isStale<K extends MetricKey>(
        key: K,
        thresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
    ): boolean {
        const { lastRefreshed } = this.store[key];
        // Never refreshed -> treat as stale (no fresh data has ever been stored).
        if (lastRefreshed === null) {
            return true;
        }
        const elapsedMs = Date.now() - Date.parse(lastRefreshed);
        return elapsedMs > thresholdMs;
    }

    /**
     * Returns the full metrics store snapshot.
     *
     * Useful for the API layer / debugging endpoints that need every entry at
     * once. Returns the live store object (entries are mutated in place by the
     * cache), so callers should treat it as read-only.
     */
    snapshot(): MetricsStore {
        return this.store;
    }
}
