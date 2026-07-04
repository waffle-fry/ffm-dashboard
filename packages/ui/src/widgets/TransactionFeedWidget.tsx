// TransactionFeedWidget — the recent transactions feed widget (Requirement 9).
//
// Fetches the `transactions` metric (TransactionFeedMetrics) via useMetrics and
// renders it inside the shared Widget chrome (title bar, last-refreshed
// timestamp, loading / error / stale indicators, manual refresh button). The
// manual refresh button asks the engine to refresh the `transactions` widget
// and then re-polls the endpoint (Requirement 8.4).
//
// The engine has already done all the safety-sensitive work — truncating the
// payment ID to "…XXXX", formatting the amount to 2dp in its original currency,
// sorting most-recent-first, limiting to 20, and stripping all PII (Reqs
// 9.1 / 9.2 / 9.4). This widget is purely presentational: it renders only the
// four PII-free fields carried by each TransactionItem.
//
// Requirement 9.2: the transactions render in a scrollable list, most-recent
//   first, showing all available transactions when fewer than 20 exist. The
//   shared Widget body is already an `overflow-auto` container, so the list
//   scrolls within the widget as the feed grows.
//
// Brand note (Requirement 1.1): the yellow/gold accent is reserved for
// highlights and alerts, so this purely-informational widget uses neutral text
// tones only.
//
// Design: the mapping from TransactionFeedMetrics to displayable rows lives in
// the pure helpers in ./transaction-feed so it can be unit-tested without a
// DOM, mirroring the pattern used by the other widgets' helpers.

import { useCallback } from 'react';
import type { TransactionFeedMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { formatRelativeTime } from '../components/time-format';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';
import { buildTransactionRows } from './transaction-feed';

export interface TransactionFeedWidgetProps {
    /** Overridable title; defaults to "Recent Transactions". */
    title?: string;
}

export default function TransactionFeedWidget({
    title = 'Recent Transactions',
}: TransactionFeedWidgetProps): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<TransactionFeedMetrics>('transactions');
    const { refreshWidget } = useRefresh();

    const handleRefresh = useCallback((): void => {
        // Ask the engine to refresh this widget's data, then re-poll so the UI
        // picks up the freshest cached values (Requirement 8.4).
        void refreshWidget('transactions').then(() => refetch());
    }, [refreshWidget, refetch]);

    const rows = buildTransactionRows(data?.transactions ?? []);
    // Relative "… ago" labels are derived at render time; the feed re-polls on
    // the metrics interval, so the labels stay current without extra timers.
    const now = Date.now();

    return (
        <Widget
            title={title}
            lastRefreshed={lastRefreshed}
            isLoading={isLoading}
            error={error}
            isStale={isStale}
            onRefresh={handleRefresh}
        >
            {rows.length === 0 ? (
                <p className="text-text-secondary">No transactions yet.</p>
            ) : (
                // The list is rendered most-recent-first in the order provided
                // by the engine (Requirement 9.2). The surrounding Widget body
                // already scrolls (overflow-auto), so long feeds stay contained.
                <ul className="flex flex-col divide-y divide-border">
                    {rows.map((row) => (
                        <li
                            key={row.key}
                            className="flex items-center justify-between gap-3 py-2 text-sm"
                        >
                            <span className="shrink-0 font-mono text-text-secondary">
                                {row.idSuffix}
                            </span>
                            <span className="shrink-0 tabular-nums text-text-primary">
                                {row.amount}
                            </span>
                            <time
                                dateTime={row.timestamp}
                                title={row.timestamp}
                                className="min-w-0 flex-1 truncate text-right tabular-nums text-text-secondary"
                            >
                                {formatRelativeTime(row.timestamp, now)}
                            </time>
                        </li>
                    ))}
                </ul>
            )}
        </Widget>
    );
}
