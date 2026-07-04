// Widget — the base component providing common chrome shared by every
// concrete dashboard widget (task 12 specialises the body via `children`).
//
// It renders: a title bar, a last-refreshed timestamp, a loading spinner, an
// error indicator, a stale-data indicator (⚠ + "Last updated: X min ago"), and
// a manual refresh button. It is purely presentational — data fetching lives in
// the hooks from task 11.2 and is passed in through props.
//
// Requirement 8.2: always show when the widget's data was last refreshed.
// Requirement 8.3: when `error` is set, show an error indicator AND keep the
//   last-refreshed time + last-known data (children) visible; the indicator
//   clears automatically once `error` is null again.
// Requirement 8.5: while `isLoading`, show a visual loading spinner.
// Requirement 5.6: surface a generic error/unavailable indicator on the widget.
// Requirement 5.7: when `isStale`, show a ⚠ icon plus "Last updated: X min ago"
//   derived from `lastRefreshed`.
//
// Brand note (Requirement 1.1): the yellow/gold accent is reserved for
// highlights and alerts, so it is used only for the stale indicator. The
// loading spinner uses neutral text tones and errors use the danger red.

import { useMemo } from 'react';
import { formatStaleLabel, formatTimestamp } from './time-format';

export interface WidgetProps {
    title: string;
    /** ISO 8601 timestamp of the last successful refresh, or null if never. */
    lastRefreshed: string | null;
    isLoading: boolean;
    /** Error message to surface, or null when healthy. */
    error: string | null;
    isStale: boolean;
    onRefresh: () => void;
    children: React.ReactNode;
}

/** Small inline spinner. Neutral-toned so gold stays reserved for alerts. */
function LoadingSpinner(): JSX.Element {
    return (
        <span
            role="status"
            aria-label="Loading"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-text-secondary"
        />
    );
}

export default function Widget({
    title,
    lastRefreshed,
    isLoading,
    error,
    isStale,
    onRefresh,
    children,
}: WidgetProps): JSX.Element {
    // Derived once per render against the current wall clock; the concrete
    // relative-time logic is unit-tested in time-format.test.ts.
    const staleLabel = useMemo(
        () => (isStale ? formatStaleLabel(lastRefreshed, Date.now()) : null),
        [isStale, lastRefreshed],
    );
    const refreshedAt = formatTimestamp(lastRefreshed);

    return (
        <section
            className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-text-primary"
            aria-busy={isLoading}
        >
            {/* Title bar. In the dashboard grid this whole bar is the drag
                handle (`widget-drag-handle`), so the entire header is a large,
                obvious grab target — much easier than a tiny grip. Interactive
                controls inside it are marked `widget-no-drag` so clicks (e.g.
                refresh) are never swallowed by a drag. */}
            <header className="widget-drag-handle flex cursor-move items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        aria-hidden="true"
                        className="select-none text-text-secondary"
                        title="Drag to move"
                    >
                        ⠿
                    </span>
                    <h2 className="truncate font-heading text-text-primary">
                        {title}
                    </h2>
                    {isLoading && <LoadingSpinner />}
                </div>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isLoading}
                    aria-label={`Refresh ${title}`}
                    title="Refresh"
                    className="widget-no-drag shrink-0 cursor-pointer rounded border border-border px-2 py-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <span aria-hidden="true">⟳</span>
                </button>
            </header>

            {/* Status row: last-refreshed timestamp + error / stale indicators.
                Kept visible even during errors so last-known context stays put
                (Requirement 8.3). */}
            <div className="flex flex-col gap-1 border-b border-border px-3 py-1.5 text-xs">
                <span className="text-text-secondary">
                    Last refreshed: {refreshedAt}
                </span>

                {isStale && staleLabel && (
                    <span
                        role="status"
                        className="flex items-center gap-1 text-accent"
                    >
                        <span aria-hidden="true">⚠</span>
                        <span>{staleLabel}</span>
                    </span>
                )}

                {error && (
                    <span
                        role="alert"
                        className="flex items-center gap-1 text-danger"
                    >
                        <span aria-hidden="true">⚠</span>
                        <span>Data unavailable: {error}</span>
                    </span>
                )}
            </div>

            {/* Widget-specific content. Last-known data remains visible during
                errors and refreshes (Requirements 8.3 / 8.5). */}
            <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </section>
    );
}
