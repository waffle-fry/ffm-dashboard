// Widget — the base component providing common chrome shared by every
// concrete dashboard widget (task 12 specialises the body via `children`).
//
// It renders: a title bar, a loading spinner, an error indicator, and a manual
// refresh button. It is purely presentational — data fetching lives in the
// hooks from task 11.2 and is passed in through props.
//
// The "last refreshed" timestamp and stale indicator are shown ONCE, globally,
// in the dashboard header (all widgets refresh on the same aggregator cycle),
// rather than repeated on every card. The per-card error indicator remains
// because errors are source-specific (Requirement 8.3): when `error` is set we
// show it AND keep the last-known data (children) visible.
//
// Requirement 8.5: while `isLoading`, show a visual loading spinner.
// Requirement 5.6: surface a generic error/unavailable indicator on the widget.
//
// Brand note (Requirement 1.1): the yellow/gold accent is reserved for
// highlights and alerts; errors use the danger red and the spinner is neutral.

export interface WidgetProps {
    title: string;
    /** ISO 8601 timestamp of the last successful refresh (shown in the header). */
    lastRefreshed: string | null;
    isLoading: boolean;
    /** Error message to surface, or null when healthy. */
    error: string | null;
    /** Stale flag (surfaced globally in the header, not per card). */
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
    isLoading,
    error,
    onRefresh,
    children,
}: WidgetProps): JSX.Element {
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

            {/* Per-widget error indicator (source-specific). Only shown on
                error; last-known data stays visible below (Requirement 8.3). */}
            {error && (
                <div className="border-b border-border px-3 py-1.5 text-xs">
                    <span
                        role="alert"
                        className="flex items-center gap-1 text-danger"
                    >
                        <span aria-hidden="true">⚠</span>
                        <span>Data unavailable: {error}</span>
                    </span>
                </div>
            )}

            {/* Widget-specific content. Last-known data remains visible during
                errors and refreshes (Requirements 8.3 / 8.5). */}
            <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </section>
    );
}
