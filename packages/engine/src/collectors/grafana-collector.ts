// GrafanaCollector.
//
// Populates the `health` cache entry (SystemHealthMetrics) from Grafana. It
// derives, per monitored service, a health classification ('healthy' |
// 'degraded' | 'down'), 24h/7d uptime percentages, and whether an alert is
// firing; and for the platform API it derives the error rate (errors/minute)
// and average response latency (ms) over the last 5 minutes.
//
// Requirements: 5.1 (status), 5.2 (uptime %), 5.3 (error rate + latency),
// 5.4 (alertFiring highlight source), 5.5 (status-change freshness — served via
// the scheduler's poll cadence).
//
// Design notes:
//   - HTTP wiring is deliberately NOT done here. The collector depends only on
//     a narrow, injected `GrafanaClientPort` describing the exact calls it
//     consumes (per-service metrics + platform API samples). The concrete
//     `fetch`-based client that talks to the Grafana HTTP API is wired up later
//     (task 8.1). This keeps the collector fully unit-testable with a fake
//     client and free of any runtime dependency.
//   - The collector conforms to the scheduler's `MetricCollector` interface
//     (`name`, `metricKeys`, `collect()`), returning the single `health` key so
//     the DataAggregator can drive it alongside the other source collectors.
//   - All health-derivation logic (classification, uptime %, error rate, avg
//     latency) is implemented as deterministic pure functions (design
//     Properties 10 & 11) so the property tests (tasks 6.10, 6.11) can exercise
//     them directly without constructing a collector.

import type { SystemHealthMetrics, ServiceHealth } from '@fans-fund-me/shared';
import type { CollectedMetrics, MetricCollector } from '../aggregator/scheduler.js';
import type { MetricKey } from '../cache/metrics-cache.js';
import { formatMoney } from '../utils/formatting.js';

// --- Injected Grafana client port ------------------------------------------

/**
 * A single uptime measurement window for a service.
 *
 * `totalSeconds` is the length of the window (e.g. 86 400 for 24h) and
 * `downtimeSeconds` is how much of that window the service was unavailable.
 */
export interface UptimeWindow {
    totalSeconds: number;
    downtimeSeconds: number;
}

/**
 * Raw per-service metrics as read from Grafana.
 *
 * This is intentionally the *input* to health derivation — the collector turns
 * it into a {@link ServiceHealth} by computing uptime percentages and a status
 * classification. Keeping it raw lets the classification remain a pure function
 * of measurable inputs (design Property 10).
 */
export interface GrafanaServiceMetrics {
    /** Service name as reported by Grafana. */
    name: string;
    /**
     * Whether Grafana currently considers the service reachable/up (e.g. its
     * health probe is passing). A false value forces a 'down' classification.
     */
    reachable: boolean;
    /** Uptime measurement over the last 24 hours (Requirement 5.2). */
    uptime24h: UptimeWindow;
    /** Uptime measurement over the last 7 days (Requirement 5.2). */
    uptime7d: UptimeWindow;
    /** Number of errors observed for this service over the last 5 minutes. */
    errorCountLast5m: number;
    /** Whether a Grafana alert is currently firing for this service (Req 5.4). */
    alertFiring: boolean;
}

/**
 * Platform-API error and latency samples over a measurement window.
 *
 * `windowMinutes` is the width of the sampling window (5 for the last 5
 * minutes, per Requirement 5.3); `errorCount` is the total number of errors in
 * that window; `latenciesMs` are the individual response-latency samples.
 */
export interface GrafanaApiSamples {
    windowMinutes: number;
    errorCount: number;
    latenciesMs: number[];
}

/**
 * The narrow slice of the Grafana HTTP API this collector consumes.
 *
 * The concrete implementation (task 8.1) uses native `fetch` against the
 * Grafana `/api/health`, `/api/alerts`, and datasource-proxy endpoints; here we
 * depend only on the two shaped calls we actually need.
 */
export interface GrafanaClientPort {
    /** Per-service health, uptime, error, and alert state. */
    getServiceMetrics(): Promise<GrafanaServiceMetrics[]>;
    /** Platform-API error and latency samples over the last 5 minutes. */
    getApiSamples(): Promise<GrafanaApiSamples>;
}

// --- Classification thresholds ---------------------------------------------

/**
 * Width of the short-term error window, in minutes (Requirement 5.3). Used both
 * for the platform API error rate and for per-service error-rate classification
 * when the client reports a raw 5-minute error count.
 */
export const ERROR_WINDOW_MINUTES = 5;

/**
 * At or below this 24h uptime percentage a service is classified 'down'.
 * A sustained availability this low indicates the service is effectively out.
 */
export const DOWN_UPTIME_THRESHOLD_PERCENT = 90;

/**
 * Below this 24h uptime percentage (but at/above the down threshold) a service
 * is classified 'degraded'.
 */
export const DEGRADED_UPTIME_THRESHOLD_PERCENT = 99.5;

/**
 * Above this per-minute error rate a reachable service is classified
 * 'degraded'.
 */
export const DEGRADED_ERROR_RATE_PER_MINUTE = 1;

// --- Pure derivation helpers -----------------------------------------------

/** Rounds a number to two decimal places (round half away from zero). */
function roundTo2dp(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Uptime percentage for a measurement window (design Property 11).
 *
 * Computes `((total - downtime) / total × 100)` rounded to two decimal places.
 * When `totalSeconds` is zero or negative there is no window to measure, so the
 * function returns 0 rather than dividing by zero.
 */
export function calculateUptimePercentage(totalSeconds: number, downtimeSeconds: number): number {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return 0;
    }
    const percentage = ((totalSeconds - downtimeSeconds) / totalSeconds) * 100;
    return roundTo2dp(percentage);
}

/**
 * Error rate in errors-per-minute (design Property 11).
 *
 * Computes `errorCount / windowMinutes`. Returns 0 when the window is zero or
 * negative (no meaningful rate). The result is intentionally not rounded so it
 * matches the exact `errorCount / minutes` relationship.
 */
export function calculateErrorRatePerMinute(errorCount: number, windowMinutes: number): number {
    if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
        return 0;
    }
    return errorCount / windowMinutes;
}

/**
 * Average latency in milliseconds (design Property 11).
 *
 * Computes `sum(latencies) / count`. Returns 0 for an empty sample set (no
 * measurements). The result is intentionally not rounded so it matches the
 * exact `sum / count` relationship.
 */
export function calculateAverageLatencyMs(latenciesMs: readonly number[]): number {
    if (latenciesMs.length === 0) {
        return 0;
    }
    const sum = latenciesMs.reduce((acc, latency) => acc + latency, 0);
    return sum / latenciesMs.length;
}

/** Inputs to the deterministic service-health classifier. */
export interface ServiceHealthClassificationInput {
    /** Whether Grafana considers the service reachable/up. */
    reachable: boolean;
    /** Whether an alert is currently firing for the service. */
    alertFiring: boolean;
    /** 24h uptime percentage (as produced by {@link calculateUptimePercentage}). */
    uptime24hPercent: number;
    /** Short-term error rate in errors-per-minute. */
    errorRatePerMinute: number;
}

/**
 * Classifies a service as 'healthy', 'degraded', or 'down' (design Property 10,
 * Requirement 5.1).
 *
 * The classification is a deterministic pure function of its inputs — the same
 * inputs always yield the same output — and always returns exactly one of the
 * three states, evaluated in order of severity:
 *
 *   1. `down`     — the service is unreachable, OR 24h uptime is at/below
 *                   {@link DOWN_UPTIME_THRESHOLD_PERCENT}.
 *   2. `degraded` — an alert is firing, OR 24h uptime is below
 *                   {@link DEGRADED_UPTIME_THRESHOLD_PERCENT}, OR the error rate
 *                   exceeds {@link DEGRADED_ERROR_RATE_PER_MINUTE}.
 *   3. `healthy`  — none of the above.
 */
export function classifyServiceHealth(
    input: ServiceHealthClassificationInput,
): ServiceHealth['status'] {
    const { reachable, alertFiring, uptime24hPercent, errorRatePerMinute } = input;

    if (!reachable || uptime24hPercent <= DOWN_UPTIME_THRESHOLD_PERCENT) {
        return 'down';
    }
    if (
        alertFiring ||
        uptime24hPercent < DEGRADED_UPTIME_THRESHOLD_PERCENT ||
        errorRatePerMinute > DEGRADED_ERROR_RATE_PER_MINUTE
    ) {
        return 'degraded';
    }
    return 'healthy';
}

/**
 * Derives a {@link ServiceHealth} record from raw Grafana service metrics.
 *
 * Uptime percentages are formatted as fixed 2-decimal strings via
 * {@link formatMoney} (the model types `uptime24h`/`uptime7d` as strings), while
 * the classification uses the numeric percentages and error rate. `lastUpdated`
 * is stamped with the supplied ISO 8601 timestamp (Requirement 5.4/5.5).
 */
export function toServiceHealth(metrics: GrafanaServiceMetrics, nowIso: string): ServiceHealth {
    const uptime24hPercent = calculateUptimePercentage(
        metrics.uptime24h.totalSeconds,
        metrics.uptime24h.downtimeSeconds,
    );
    const uptime7dPercent = calculateUptimePercentage(
        metrics.uptime7d.totalSeconds,
        metrics.uptime7d.downtimeSeconds,
    );
    const errorRatePerMinute = calculateErrorRatePerMinute(
        metrics.errorCountLast5m,
        ERROR_WINDOW_MINUTES,
    );

    return {
        name: metrics.name,
        status: classifyServiceHealth({
            reachable: metrics.reachable,
            alertFiring: metrics.alertFiring,
            uptime24hPercent,
            errorRatePerMinute,
        }),
        uptime24h: formatMoney(uptime24hPercent),
        uptime7d: formatMoney(uptime7dPercent),
        alertFiring: metrics.alertFiring,
        lastUpdated: nowIso,
    };
}

// --- Collector -------------------------------------------------------------

/**
 * Collects system-health metrics from Grafana into the `health` cache entry.
 *
 * Conforms to the scheduler's {@link MetricCollector} contract so the
 * DataAggregator (task 8.1) can run it in parallel with the other source
 * collectors. It owns no I/O itself — all Grafana access goes through the
 * injected {@link GrafanaClientPort}.
 */
export class GrafanaCollector implements MetricCollector {
    /** Human-readable source name (used by the scheduler in error messages). */
    readonly name = 'Grafana';

    /** This collector populates only the `health` cache entry. */
    readonly metricKeys: readonly MetricKey[] = ['health'];

    private readonly client: GrafanaClientPort;
    private readonly now: () => Date;

    /**
     * @param client Injected Grafana client (narrow port; HTTP wiring done in 8.1).
     * @param now Clock function, injectable for deterministic tests.
     */
    constructor(client: GrafanaClientPort, now: () => Date = () => new Date()) {
        this.client = client;
        this.now = now;
    }

    /**
     * Fetches service and platform-API metrics from Grafana and assembles a
     * {@link SystemHealthMetrics} snapshot for the `health` cache entry.
     */
    async collect(): Promise<CollectedMetrics> {
        const nowIso = this.now().toISOString();

        const [serviceMetrics, apiSamples] = await Promise.all([
            this.client.getServiceMetrics(),
            this.client.getApiSamples(),
        ]);

        const services: ServiceHealth[] = serviceMetrics.map((metrics) =>
            toServiceHealth(metrics, nowIso),
        );

        const health: SystemHealthMetrics = {
            services,
            apiMetrics: {
                errorRatePerMinute: calculateErrorRatePerMinute(
                    apiSamples.errorCount,
                    apiSamples.windowMinutes,
                ),
                avgLatencyMs: calculateAverageLatencyMs(apiSamples.latenciesMs),
            },
            lastRefreshed: nowIso,
        };

        return { health };
    }
}
