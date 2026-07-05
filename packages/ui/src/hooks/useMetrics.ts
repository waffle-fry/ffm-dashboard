// useMetrics — generic, per-widget metrics polling hook.
//
// Polls `GET /api/metrics/{widget}` on an interval (and once on mount), tracking
// the loading, error and stale state each widget needs to render its chrome.
//
// Requirement 8.2: the server response carries `lastRefreshed`; the hook
//   surfaces it so the widget can display when its data was last refreshed.
// Requirement 8.3: on a fetch failure/timeout the hook keeps the last
//   successfully fetched `data` (it is never cleared on error) and exposes an
//   `error`; the error is cleared on the next successful fetch. The
//   server-provided `lastError`/`isStale` are reflected on success too.
// Requirement 8.5: `isLoading` is exposed so the widget can show a loading
//   indicator while a fetch is in flight (or while the backend is refreshing).
//
// Per-widget error isolation: each `useMetrics` call owns its own React state,
// so one widget's error/loading/stale state can never bleed into another's.
//
// Design: the decision logic that satisfies the requirements above lives in the
// pure, DOM-free helpers below (`buildMetricUrl`, `isMetricEnvelope`,
// `reduceMetricsState`, `computeIsStale`, `formatRelativeTime`) so it can be
// unit-tested directly without React or a DOM. The hook is a thin wrapper that
// wires those helpers to `useState`/`useEffect`, `fetch` and a polling timer,
// guarding against setting state after unmount.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The widget/metric keys served by `GET /api/metrics/{widget}`. Mirrors the
 * engine's `METRIC_KEYS` (see packages/engine/src/cache/metrics-cache.ts).
 */
export type MetricWidget =
    | 'revenue'
    | 'users'
    | 'health'
    | 'disputes'
    | 'transactions'
    | 'summary'
    | 'spotlight';

/**
 * The JSON envelope returned by every metrics endpoint, generic over the widget
 * payload type `T` (e.g. `RevenueMetrics`, `UserGrowthMetrics`, ...). Mirrors
 * the engine's `MetricResponse` (packages/engine/src/routes/metrics.ts): the
 * API always responds 200 and serves the last-good `data` alongside indicators.
 */
export interface MetricEnvelope<T> {
    data: T | null;
    lastRefreshed: string | null;
    lastError: string | null;
    isRefreshing: boolean;
    isStale: boolean;
}

/** The state a widget consumes to render its data + chrome. */
export interface MetricsState<T> {
    /** Last successfully fetched payload; retained across errors (Req 8.3). */
    data: T | null;
    /** ISO 8601 timestamp of the last successful collection (Req 8.2). */
    lastRefreshed: string | null;
    /** Client fetch error or server-reported `lastError`; null when healthy. */
    error: string | null;
    /** True when the data is considered stale. */
    isStale: boolean;
    /** True while a fetch is in flight or the backend is refreshing (Req 8.5). */
    isLoading: boolean;
}

/** Result returned by {@link useMetrics}: current state plus a manual refetch. */
export interface UseMetricsResult<T> extends MetricsState<T> {
    /** Re-poll this widget's endpoint immediately (does not clear prior data). */
    refetch: () => Promise<void>;
}

/** Options controlling polling cadence and request behaviour. */
export interface UseMetricsOptions {
    /** Poll interval in milliseconds. Defaults to {@link DEFAULT_POLL_INTERVAL_MS}. */
    intervalMs?: number;
    /** Per-request timeout in milliseconds. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}. */
    fetchTimeoutMs?: number;
    /** When false, no fetching or polling occurs (data stays at its initial state). */
    enabled?: boolean;
}

/** Default poll interval: 5 minutes (matches the engine's default refresh). */
export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Default per-request timeout: 10 seconds (matches the engine source timeout). */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Default staleness threshold: 120 seconds (Requirement 5.7). */
export const DEFAULT_STALE_THRESHOLD_MS = 120_000;

/** Convert a dashboard refresh interval (minutes) into a poll interval (ms). */
export function pollIntervalFromMinutes(minutes: number): number {
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return DEFAULT_POLL_INTERVAL_MS;
    }
    return Math.round(minutes) * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free, React-free) — directly unit-testable.
// ---------------------------------------------------------------------------

/** Build the metrics endpoint URL for a widget. */
export function buildMetricUrl(widget: MetricWidget): string {
    return `/api/metrics/${widget}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural validation for a {@link MetricEnvelope}. `data` may be any shape
 * (including null) — only the envelope's metadata fields are validated, so this
 * guard is safe to reuse for every widget payload type `T`.
 */
export function isMetricEnvelope<T>(value: unknown): value is MetricEnvelope<T> {
    if (!isPlainObject(value)) return false;
    const hasData = 'data' in value;
    const lastRefreshedOk =
        value.lastRefreshed === null || typeof value.lastRefreshed === 'string';
    const lastErrorOk =
        value.lastError === null || typeof value.lastError === 'string';
    return (
        hasData &&
        lastRefreshedOk &&
        lastErrorOk &&
        typeof value.isRefreshing === 'boolean' &&
        typeof value.isStale === 'boolean'
    );
}

/** The outcome of a single fetch attempt against a metrics endpoint. */
export type FetchOutcome<T> =
    | { kind: 'success'; response: MetricEnvelope<T> }
    | { kind: 'error'; message: string };

/** Initial state before the first fetch resolves. */
export function initialMetricsState<T>(): MetricsState<T> {
    return {
        data: null,
        lastRefreshed: null,
        error: null,
        isStale: false,
        isLoading: false,
    };
}

/**
 * Pure reducer mapping (previous state, fetch outcome) -> next state.
 *
 * - On success: adopt the server's `data`, `lastRefreshed`, `isStale`, reflect
 *   the server `lastError`, and treat the backend `isRefreshing` flag as still
 *   loading. This clears any prior client error (Req 8.3) and surfaces
 *   `lastRefreshed` (Req 8.2).
 * - On error: retain the previous `data` and `lastRefreshed` (never cleared —
 *   Req 8.3), record the error message, mark the data stale, and stop loading.
 */
export function reduceMetricsState<T>(
    prev: MetricsState<T>,
    outcome: FetchOutcome<T>,
): MetricsState<T> {
    if (outcome.kind === 'success') {
        const r = outcome.response;
        return {
            data: r.data,
            lastRefreshed: r.lastRefreshed,
            error: r.lastError,
            isStale: r.isStale,
            isLoading: r.isRefreshing,
        };
    }
    return {
        data: prev.data,
        lastRefreshed: prev.lastRefreshed,
        error: outcome.message,
        isStale: true,
        isLoading: false,
    };
}

/**
 * Pure staleness check: true iff `lastRefreshed` is absent, or the elapsed time
 * since it exceeds `thresholdMs`. Mirrors the engine's cache semantics so the
 * UI can independently re-evaluate staleness between polls.
 */
export function computeIsStale(
    lastRefreshed: string | null,
    now: number = Date.now(),
    thresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): boolean {
    if (lastRefreshed === null) return true;
    const refreshedAt = Date.parse(lastRefreshed);
    if (Number.isNaN(refreshedAt)) return true;
    return now - refreshedAt > thresholdMs;
}

/**
 * Format an ISO 8601 timestamp as a short relative time for the "Last updated:
 * X ago" indicator. Returns "never" for a null/invalid timestamp, "just now"
 * within the last minute, then "N min ago" / "N hr ago" / "N day(s) ago".
 */
export function formatRelativeTime(
    lastRefreshed: string | null,
    now: number = Date.now(),
): string {
    if (lastRefreshed === null) return 'never';
    const refreshedAt = Date.parse(lastRefreshed);
    if (Number.isNaN(refreshedAt)) return 'never';
    const elapsedMs = Math.max(0, now - refreshedAt);
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * Perform a single fetch of a widget's metrics endpoint with a timeout,
 * normalising every failure mode (non-2xx, malformed body, network error,
 * timeout/abort) into a {@link FetchOutcome}. Never throws.
 */
export async function fetchMetric<T>(
    widget: MetricWidget,
    timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<FetchOutcome<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(buildMetricUrl(widget), {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            return {
                kind: 'error',
                message: `Request failed with status ${res.status}`,
            };
        }
        const json: unknown = await res.json();
        if (!isMetricEnvelope<T>(json)) {
            return { kind: 'error', message: 'Malformed metrics response' };
        }
        return { kind: 'success', response: json };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return {
                kind: 'error',
                message: `Request timed out after ${timeoutMs}ms`,
            };
        }
        const message =
            error instanceof Error ? error.message : 'Network error';
        return { kind: 'error', message };
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

/**
 * Poll `GET /api/metrics/{widget}` on an interval, exposing per-widget data,
 * loading, error and stale state. See the module header for the requirement
 * mapping. Each call owns isolated state (per-widget error isolation).
 */
export function useMetrics<T>(
    widget: MetricWidget,
    options: UseMetricsOptions = {},
): UseMetricsResult<T> {
    const {
        intervalMs = DEFAULT_POLL_INTERVAL_MS,
        fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
        enabled = true,
    } = options;

    const [state, setState] = useState<MetricsState<T>>(initialMetricsState<T>);
    const mountedRef = useRef(true);

    const refetch = useCallback(async (): Promise<void> => {
        if (!enabled) return;
        // Optimistically flag loading so widgets can show an indicator (Req 8.5)
        // without disturbing the retained data/error.
        if (mountedRef.current) {
            setState((prev) => ({ ...prev, isLoading: true }));
        }
        const outcome = await fetchMetric<T>(widget, fetchTimeoutMs);
        if (!mountedRef.current) return;
        setState((prev) => reduceMetricsState(prev, outcome));
    }, [widget, fetchTimeoutMs, enabled]);

    useEffect(() => {
        mountedRef.current = true;
        if (!enabled) {
            return () => {
                mountedRef.current = false;
            };
        }
        // Fetch immediately on mount, then poll on the configured interval.
        void refetch();
        const timerId = setInterval(() => {
            void refetch();
        }, intervalMs);
        return () => {
            mountedRef.current = false;
            clearInterval(timerId);
        };
    }, [refetch, intervalMs, enabled]);

    return { ...state, refetch };
}
