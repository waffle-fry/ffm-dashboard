// DisputeCountdownWidget — the dispute deadline tracking widget (Requirement 6).
//
// Renders the base Widget chrome (title, last-refreshed, loading/error/stale
// indicators, manual refresh) around a prominent nearest-deadline countdown and
// a list of all open disputes ordered by deadline (soonest first).
//
// The urgency/label rules (Requirements 6.4–6.7) are delegated to the pure,
// tested helpers in ./dispute-countdown so this file stays presentational.
//
// Requirement 6.2: the countdown is rendered prominently at >= 32px.
// Requirement 6.3: each dispute row shows the payment ID, GBP amount (2dp), and
//   days remaining, in the engine-provided order (already soonest-first).
// Requirement 6.6: "No open disputes" shows in the countdown area when empty.

import { useCallback } from 'react';
import type { DisputeMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';
import {
    describeCountdown,
    describeDisputeDays,
    formatDisputeAmount,
    formatOpenDisputesCount,
} from './dispute-countdown';

/** Minimum prominent countdown font size (Requirement 6.2): 40px >= 32px. */
const COUNTDOWN_FONT_SIZE = '2.5rem';

export default function DisputeCountdownWidget(): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<DisputeMetrics>('disputes');
    const { refreshWidget } = useRefresh();

    const handleRefresh = useCallback((): void => {
        // Ask the engine to refresh the dispute data, then re-poll for it.
        void refreshWidget('disputes').then(() => refetch());
    }, [refreshWidget, refetch]);

    const nearestDeadlineDays = data?.nearestDeadlineDays ?? null;
    const disputes = data?.disputes ?? [];
    const countdown = describeCountdown(nearestDeadlineDays);

    return (
        <Widget
            title="Dispute Deadlines"
            lastRefreshed={lastRefreshed}
            isLoading={isLoading}
            error={error}
            isStale={isStale}
            onRefresh={handleRefresh}
        >
            <div className="flex h-full flex-col gap-4">
                {/* Prominent nearest-deadline countdown (Req 6.2, 6.4–6.7). */}
                <div
                    className={`flex flex-col items-center text-center ${countdown.colorClass}`}
                    role="status"
                    aria-live="polite"
                >
                    <span
                        className="font-heading font-semibold leading-none"
                        style={{ fontSize: COUNTDOWN_FONT_SIZE }}
                    >
                        {countdown.primary}
                    </span>
                    {countdown.secondary && (
                        <span className="mt-1 text-sm">
                            {countdown.secondary}
                        </span>
                    )}
                </div>

                {/* Open disputes list, soonest-first (Req 6.3). Hidden when the
                    empty-state countdown already communicates "no disputes". */}
                {disputes.length > 0 && (
                    <div className="flex flex-col gap-1">
                        {/* Total open dispute count (Req 6.9). */}
                        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                            {formatOpenDisputesCount(disputes.length)}
                        </p>
                        <ul className="flex flex-col divide-y divide-border border-t border-border">
                            {disputes.map((dispute) => {
                                const days = describeDisputeDays(
                                    dispute.daysRemaining,
                                );
                                return (
                                    <li
                                        key={dispute.paymentId}
                                        className="flex items-center justify-between gap-3 py-2 text-sm"
                                    >
                                        <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">
                                            {dispute.paymentId}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-text-primary">
                                            {formatDisputeAmount(
                                                dispute.amountUsd,
                                            )}
                                        </span>
                                        <span
                                            className={`shrink-0 tabular-nums text-right ${days.colorClass}`}
                                        >
                                            {days.label}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </Widget>
    );
}
