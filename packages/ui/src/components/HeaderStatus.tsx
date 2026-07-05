// HeaderStatus — the single, global "last updated" indicator for the dashboard.
//
// All widgets refresh on the same aggregator cycle, so the last-refreshed time
// and stale indicator are shown once here in the header rather than repeated on
// every card. It also offers a "Refresh all" control that triggers a full
// backend refresh.
//
// The timestamp is derived from a representative metric (`summary`); since every
// source refreshes together, its `lastRefreshed`/`isStale` reflect the whole
// dashboard. When stale (Requirement 5.7) the label switches to the gold accent
// with a ⚠. Relative-time formatting reuses the tested helpers in ./time-format.

import type { PlatformSummaryMetrics } from '@fans-fund-me/shared';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';
import { formatMinutesAgo, minutesAgo } from './time-format';

export default function HeaderStatus(): JSX.Element {
    const { lastRefreshed, isStale, isLoading, refetch } =
        useMetrics<PlatformSummaryMetrics>('summary');
    const { refreshAll, isRefreshing } = useRefresh();

    const minutes = minutesAgo(lastRefreshed, Date.now());
    const label =
        minutes === null ? 'Awaiting data' : `Updated ${formatMinutesAgo(minutes)}`;
    const busy = isLoading || isRefreshing('all');

    const handleRefreshAll = (): void => {
        void refreshAll().then(() => refetch());
    };

    return (
        <div className="flex items-center gap-3 text-xs">
            <span
                role="status"
                className={
                    isStale
                        ? 'flex items-center gap-1 text-accent'
                        : 'text-text-secondary'
                }
            >
                {isStale && <span aria-hidden="true">⚠</span>}
                <span>{label}</span>
            </span>
            <button
                type="button"
                onClick={handleRefreshAll}
                disabled={busy}
                aria-label="Refresh all widgets"
                title="Refresh all"
                className="shrink-0 rounded border border-border px-2 py-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
                <span aria-hidden="true">⟳</span>
                <span className="ml-1">Refresh</span>
            </button>
        </div>
    );
}
