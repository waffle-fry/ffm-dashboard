// DataAggregator scheduler.
//
// Orchestrates periodic refresh of all widget data from the source collectors
// and writes the results into the MetricsCache. This is the write-side
// counterpart to the read-only cache the API layer serves from.
//
// Design goals (Requirements 8.1, 8.3, 8.4):
//   - Configurable polling interval, 1-60 minutes, default 5 (Req 8.1).
//   - Every source collector runs in parallel with its OWN timeout, so one slow
//     or failing source never blocks the others (Req 8.3). Collector timeouts
//     are handled independently: on success the fresh data is written via
//     `cache.set`; on failure/timeout the affected widgets are marked via
//     `cache.setError`, which retains the last-good data.
//   - Duplicate refresh prevention: while a refresh is in progress, additional
//     refresh requests piggyback on the in-flight run rather than starting a
//     second one, so exactly one refresh executes at a time (Req 8.4).
//
// The scheduler is written against the `MetricCollector` abstraction rather
// than concrete collectors (StripeCollector, MongoCollector, ...), which are
// implemented later (task 6.x). This keeps the scheduler independently testable
// with fake collectors.

import type { AggregatorConfig, MetricsStore } from '@fans-fund-me/shared';
import { MetricsCache, type MetricKey } from '../cache/metrics-cache.js';
import { silentLogger, type Logger } from '../utils/log.js';

/** Default polling interval in minutes (Req 8.1). */
export const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;

/** Smallest allowed polling interval in minutes (Req 8.1). */
export const MIN_REFRESH_INTERVAL_MINUTES = 1;

/** Largest allowed polling interval in minutes (Req 8.1). */
export const MAX_REFRESH_INTERVAL_MINUTES = 60;

/** Default per-source timeout in milliseconds (Req 8.3). */
export const DEFAULT_SOURCE_TIMEOUT_MS = 10_000;

/** Number of milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/**
 * Data a collector produces on success: a partial map from metric key to that
 * metric's data shape.
 *
 * A single external source can feed multiple widgets (e.g. Stripe populates
 * `revenue`, `disputes`, `transactions`, and `summary`), so a collector may
 * return several keys from one `collect()` call.
 */
export type CollectedMetrics = {
    [K in MetricKey]?: NonNullable<MetricsStore[K]['data']>;
};

/**
 * The scheduler-facing collector abstraction.
 *
 * Each collector represents one external data source. `metricKeys` declares
 * which cache entries (widgets) the collector is responsible for: on success
 * those keys are updated from the returned data, and on failure/timeout those
 * same keys receive an error indicator while retaining their last-good data.
 */
export interface MetricCollector {
    /** Human-readable source name, used in timeout/error messages. */
    readonly name: string;
    /** The cache entries this collector populates. */
    readonly metricKeys: readonly MetricKey[];
    /** Fetches and aggregates fresh data for this source. */
    collect(): Promise<CollectedMetrics>;
}

/**
 * Validates and clamps a refresh-interval value to the allowed range.
 *
 * Behavior (design Property 19):
 *   - non-numeric, non-finite, or undefined inputs default to 5;
 *   - values below 1 are clamped to 1;
 *   - values above 60 are clamped to 60;
 *   - in-range values are rounded to the nearest integer.
 *
 * Exported so the config route (task 8.1) and property tests (task 2.5) can
 * reuse the exact same clamping logic.
 */
export function clampRefreshInterval(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_REFRESH_INTERVAL_MINUTES;
    }
    if (value < MIN_REFRESH_INTERVAL_MINUTES) {
        return MIN_REFRESH_INTERVAL_MINUTES;
    }
    if (value > MAX_REFRESH_INTERVAL_MINUTES) {
        return MAX_REFRESH_INTERVAL_MINUTES;
    }
    return Math.round(value);
}

/**
 * Wraps a promise with an independent timeout.
 *
 * Resolves/rejects with the underlying promise if it settles first; otherwise
 * rejects with a timeout error after `timeoutMs`. The timer is always cleared
 * so it never keeps the event loop alive.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Source "${label}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        // Do not let a pending source timeout hold the process open.
        (timer as { unref?: () => void }).unref?.();

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

/**
 * Periodic data-refresh scheduler.
 *
 * Owns the polling timer and the in-flight refresh guard. Reads the collectors
 * it was constructed with and writes their results into the injected cache.
 */
export class DataAggregator {
    private readonly cache: MetricsCache;
    private readonly collectors: readonly MetricCollector[];
    private readonly sourceTimeoutMs: number;
    private readonly logger: Logger;
    private refreshIntervalMinutes: number;

    /** Active polling timer, or null when stopped. */
    private timer: ReturnType<typeof setInterval> | null = null;

    /** The currently running full refresh, or null when idle (duplicate guard). */
    private inFlight: Promise<void> | null = null;

    /**
     * In-flight single-widget refreshes, keyed by the requested metric key.
     *
     * Provides per-widget duplicate-refresh prevention (Req 8.4) for
     * {@link refreshWidget}: while a widget's refresh is running, further
     * requests for that same widget share the in-flight promise instead of
     * starting a second run.
     */
    private readonly inFlightWidgets = new Map<MetricKey, Promise<void>>();

    constructor(
        cache: MetricsCache,
        collectors: readonly MetricCollector[],
        config: Partial<AggregatorConfig> = {},
        logger: Logger = silentLogger,
    ) {
        this.cache = cache;
        this.collectors = collectors;
        this.logger = logger;
        this.refreshIntervalMinutes = clampRefreshInterval(config.refreshIntervalMinutes);
        this.sourceTimeoutMs =
            typeof config.sourceTimeoutMs === 'number' && Number.isFinite(config.sourceTimeoutMs) && config.sourceTimeoutMs > 0
                ? config.sourceTimeoutMs
                : DEFAULT_SOURCE_TIMEOUT_MS;
    }

    /** The current (validated) polling interval in minutes. */
    getRefreshIntervalMinutes(): number {
        return this.refreshIntervalMinutes;
    }

    /**
     * Returns the current aggregator configuration.
     *
     * Serves `GET /api/config`: exposes the validated polling interval and the
     * per-source timeout the scheduler is running with.
     */
    getConfig(): AggregatorConfig {
        return {
            refreshIntervalMinutes: this.refreshIntervalMinutes,
            sourceTimeoutMs: this.sourceTimeoutMs,
        };
    }

    /** True while a full refresh is currently executing. */
    isRefreshInProgress(): boolean {
        return this.inFlight !== null;
    }

    /** True while a single-widget refresh for `key` is currently executing. */
    isWidgetRefreshInProgress(key: MetricKey): boolean {
        return this.inFlightWidgets.has(key);
    }

    /** True while the polling timer is active. */
    isRunning(): boolean {
        return this.timer !== null;
    }

    /**
     * Updates the polling interval (clamped to [1, 60], default 5).
     *
     * If the scheduler is currently running, the timer is restarted with the
     * new interval without triggering an extra immediate refresh. Returns the
     * clamped value that was applied.
     */
    setRefreshInterval(minutes: unknown): number {
        this.refreshIntervalMinutes = clampRefreshInterval(minutes);
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.scheduleTimer();
        }
        return this.refreshIntervalMinutes;
    }

    /**
     * Starts periodic polling.
     *
     * Triggers one immediate refresh so data is available right away, then polls
     * at the configured interval. A no-op if already running.
     */
    start(): void {
        if (this.timer !== null) {
            return;
        }
        this.scheduleTimer();
        void this.refresh();
    }

    /** Stops periodic polling. A no-op if not running. An in-flight refresh is allowed to finish. */
    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Triggers a full refresh of all collectors.
     *
     * Duplicate-refresh prevention (Req 8.4): if a refresh is already running,
     * this returns the in-flight promise instead of starting a second refresh,
     * so exactly one refresh executes for any burst of concurrent requests. The
     * returned promise resolves when that single refresh completes.
     */
    refresh(): Promise<void> {
        if (this.inFlight !== null) {
            return this.inFlight;
        }
        const run = this.runRefresh().finally(() => {
            this.inFlight = null;
        });
        this.inFlight = run;
        return run;
    }

    /**
     * Triggers a refresh of a single widget (metric key).
     *
     * Runs only the collector(s) responsible for `key`. Because one source can
     * feed several widgets (e.g. Stripe populates revenue/disputes/transactions/
     * summary), running the responsible collector refreshes all of its metric
     * keys, not just the requested one.
     *
     * Per-widget duplicate prevention (Req 8.4): if a refresh for the same key
     * is already in progress, the in-flight promise is returned instead of
     * starting a second run. Resolves immediately if no collector serves `key`.
     */
    refreshWidget(key: MetricKey): Promise<void> {
        const existing = this.inFlightWidgets.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const relevant = this.collectors.filter((collector) =>
            collector.metricKeys.includes(key),
        );
        if (relevant.length === 0) {
            return Promise.resolve();
        }
        const run = this.runCollectors(relevant).finally(() => {
            this.inFlightWidgets.delete(key);
        });
        this.inFlightWidgets.set(key, run);
        return run;
    }

    /** Creates the polling timer and detaches it from the event-loop keep-alive. */
    private scheduleTimer(): void {
        const timer = setInterval(() => {
            void this.refresh();
        }, this.refreshIntervalMinutes * MS_PER_MINUTE);
        // Don't keep the process alive solely for the polling timer.
        (timer as { unref?: () => void }).unref?.();
        this.timer = timer;
    }

    /**
     * Runs every collector in parallel with independent timeouts and applies the
     * results to the cache. Never rejects: each collector's failure is isolated
     * and recorded on its own cache entries.
     */
    private async runRefresh(): Promise<void> {
        await this.runCollectors(this.collectors);
    }

    /**
     * Runs the given collectors in parallel with independent timeouts.
     *
     * Marks every affected widget as refreshing up front so the UI can show
     * loading indicators for all sources at once, then runs each collector via
     * {@link runCollector} (which isolates failures per source). Shared by the
     * full {@link refresh} and single-widget {@link refreshWidget} paths.
     */
    private async runCollectors(collectors: readonly MetricCollector[]): Promise<void> {
        for (const collector of collectors) {
            for (const key of collector.metricKeys) {
                this.cache.setRefreshing(key, true);
            }
        }

        const startedAt = Date.now();
        this.logger.info('refresh_cycle_start', {
            sources: collectors.map((c) => c.name),
        });

        const outcomes = await Promise.all(
            collectors.map((collector) => this.runCollector(collector)),
        );

        const failed = outcomes.filter((o) => !o.ok).length;
        this.logger.info('refresh_cycle_end', {
            sources: collectors.length,
            failed,
            durationMs: Date.now() - startedAt,
        });
    }

    /**
     * Runs a single collector with its own timeout and writes the outcome.
     *
     * On success, each returned metric key is stored via `cache.set` (which
     * clears any prior error) and a `source_refresh_ok` line is logged. On
     * timeout or failure, every key the collector is responsible for is marked
     * via `cache.setError` (which retains the last-good data, Req 8.3) and a
     * `source_refresh_failed` line is logged with the error message so failures
     * are visible in `kubectl logs`. Never rejects: returns an outcome flag so
     * the caller can summarise the cycle.
     */
    private async runCollector(
        collector: MetricCollector,
    ): Promise<{ ok: boolean }> {
        const startedAt = Date.now();
        try {
            const result = await withTimeout(
                collector.collect(),
                this.sourceTimeoutMs,
                collector.name,
            );
            this.applyResult(collector, result);
            this.logger.info('source_refresh_ok', {
                source: collector.name,
                keys: collector.metricKeys,
                durationMs: Date.now() - startedAt,
            });
            return { ok: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            for (const key of collector.metricKeys) {
                this.cache.setError(key, message);
            }
            this.logger.error('source_refresh_failed', {
                source: collector.name,
                keys: collector.metricKeys,
                durationMs: Date.now() - startedAt,
                error: message,
            });
            return { ok: false };
        }
    }

    /**
     * Writes a successful collector result to the cache.
     *
     * Any metric key the collector declared but did not return is treated as a
     * failure for that widget so a stale/error indicator is shown rather than
     * silently leaving the entry marked as refreshing.
     */
    private applyResult(collector: MetricCollector, result: CollectedMetrics): void {
        for (const key of collector.metricKeys) {
            const data = result[key];
            if (data === undefined) {
                this.cache.setError(
                    key,
                    `Source "${collector.name}" returned no data for "${key}".`,
                );
                continue;
            }
            // The cast bridges the per-key generic relationship that TypeScript
            // cannot infer when `key` is a runtime-iterated union of MetricKey;
            // CollectedMetrics guarantees the value matches the entry's data shape.
            this.cache.set(key, data as never);
        }
    }
}
