// useRefresh — manual data-refresh trigger with client-side duplicate prevention.
//
// Lets the UI ask the engine to refresh widget data, either for every widget
// (`POST /api/refresh`) or a single widget (`POST /api/refresh/:widget`).
//
// Requirement 8.4: the user can manually trigger a refresh for all widgets or an
//   individual widget, and duplicate refresh requests issued while one is
//   already in progress are ignored. The engine itself de-dupes on the backend,
//   but this hook additionally no-ops duplicate requests on the client (per
//   scope) so repeated button presses don't fire redundant network calls and
//   the UI can reflect the in-flight state.
//
// Design: the duplicate-prevention decision and URL construction live in the
// pure helpers `shouldStartRefresh` / `buildRefreshUrl` so they can be unit
// tested without React or a DOM. The hook tracks in-flight scopes in a ref
// (mutated synchronously so two calls in the same tick are correctly de-duped)
// mirrored into state for rendering, and guards against updating state after
// unmount.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricWidget } from './useMetrics';

/** A refresh target: every widget (`'all'`) or a single widget key. */
export type RefreshScope = 'all' | MetricWidget;

/** Body returned by the engine's refresh endpoints (see routes/refresh.ts). */
export interface RefreshResponse {
    triggered: boolean;
    alreadyInProgress: boolean;
    scope: string;
}

/** Outcome of a {@link useRefresh} trigger call. */
export type RefreshOutcome =
    | { kind: 'skipped' } // duplicate suppressed on the client
    | { kind: 'triggered'; response: RefreshResponse }
    | { kind: 'error'; message: string };

/** Result returned by {@link useRefresh}. */
export interface UseRefreshResult {
    /** Trigger a full refresh of all widgets (no-op if already in flight). */
    refreshAll: () => Promise<RefreshOutcome>;
    /** Trigger a refresh of a single widget (no-op if that widget is in flight). */
    refreshWidget: (widget: MetricWidget) => Promise<RefreshOutcome>;
    /** True when the given scope currently has a refresh request in flight. */
    isRefreshing: (scope?: RefreshScope) => boolean;
    /** The set of scopes with a refresh request currently in flight. */
    inFlight: ReadonlySet<RefreshScope>;
    /** Most recent refresh error, or null. */
    error: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free, React-free) — directly unit-testable.
// ---------------------------------------------------------------------------

/** Build the refresh endpoint URL for a scope. */
export function buildRefreshUrl(scope: RefreshScope): string {
    return scope === 'all' ? '/api/refresh' : `/api/refresh/${scope}`;
}

/**
 * Duplicate-prevention decision (Req 8.4): a refresh for `scope` should start
 * only when there is no refresh already in flight for that same scope.
 */
export function shouldStartRefresh(
    inFlight: ReadonlySet<RefreshScope>,
    scope: RefreshScope,
): boolean {
    return !inFlight.has(scope);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural validation for a {@link RefreshResponse}. */
export function isRefreshResponse(value: unknown): value is RefreshResponse {
    return (
        isPlainObject(value) &&
        typeof value.triggered === 'boolean' &&
        typeof value.alreadyInProgress === 'boolean' &&
        typeof value.scope === 'string'
    );
}

/**
 * POST a refresh request for a scope, normalising every failure mode into a
 * {@link RefreshOutcome}. Never throws. Note this issues the network call
 * unconditionally; client-side duplicate suppression is the hook's concern.
 */
export async function postRefresh(
    scope: RefreshScope,
): Promise<RefreshOutcome> {
    try {
        const res = await fetch(buildRefreshUrl(scope), {
            method: 'POST',
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            return {
                kind: 'error',
                message: `Refresh failed with status ${res.status}`,
            };
        }
        const json: unknown = await res.json();
        if (!isRefreshResponse(json)) {
            return { kind: 'error', message: 'Malformed refresh response' };
        }
        return { kind: 'triggered', response: json };
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Network error';
        return { kind: 'error', message };
    }
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

/**
 * Manual refresh trigger with per-scope duplicate prevention (Req 8.4). See the
 * module header for details.
 */
export function useRefresh(): UseRefreshResult {
    const [inFlight, setInFlight] = useState<ReadonlySet<RefreshScope>>(
        () => new Set<RefreshScope>(),
    );
    const [error, setError] = useState<string | null>(null);

    // Synchronous source of truth for in-flight scopes: a ref is mutated before
    // any await so two triggers for the same scope in the same tick are deduped
    // (the state Set is only for rendering and can lag a tick).
    const inFlightRef = useRef<Set<RefreshScope>>(new Set<RefreshScope>());
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const syncInFlight = useCallback((): void => {
        if (mountedRef.current) {
            setInFlight(new Set(inFlightRef.current));
        }
    }, []);

    const run = useCallback(
        async (scope: RefreshScope): Promise<RefreshOutcome> => {
            // No-op duplicate requests while one is in progress for this scope.
            if (!shouldStartRefresh(inFlightRef.current, scope)) {
                return { kind: 'skipped' };
            }
            inFlightRef.current.add(scope);
            syncInFlight();
            try {
                const outcome = await postRefresh(scope);
                if (mountedRef.current) {
                    setError(
                        outcome.kind === 'error' ? outcome.message : null,
                    );
                }
                return outcome;
            } finally {
                inFlightRef.current.delete(scope);
                syncInFlight();
            }
        },
        [syncInFlight],
    );

    const refreshAll = useCallback(() => run('all'), [run]);
    const refreshWidget = useCallback(
        (widget: MetricWidget) => run(widget),
        [run],
    );
    const isRefreshing = useCallback(
        (scope: RefreshScope = 'all'): boolean => inFlight.has(scope),
        [inFlight],
    );

    return { refreshAll, refreshWidget, isRefreshing, inFlight, error };
}
