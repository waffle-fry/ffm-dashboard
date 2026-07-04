// PlatformSummaryWidget — high-level platform summary numbers at a glance
// (Requirement 10).
//
// The widget fetches the `summary` metric (PlatformSummaryMetrics) via
// useMetrics and renders it inside the shared Widget chrome (title bar,
// last-refreshed timestamp, loading / error / stale indicators, manual refresh
// button). The manual refresh button asks the engine to refresh the `summary`
// widget and then re-polls the endpoint.
//
// The backend already formats every figure (gross volume as a USD 2dp string;
// take rate / dispute rate as percentage strings), so the UI only adds the
// currency symbol or "%" affix — it never re-rounds or re-parses the value.
//
// Requirement 10.1: gross volume processed month-to-date, in USD, displayed
//   verbatim with the currency symbol.
// Requirement 10.2: monthly take rate as a percentage; the backend sends null
//   when gross volume is zero, which the UI renders as "N/A".
// Requirement 10.3: open disputes count and the monthly dispute rate percentage
//   (the backend sends "0.00" when there are no payments).
// Requirement 10.4: count of payments processed in the current month.
//
// Brand note (Requirement 1.1): the yellow/gold accent stays reserved for
// highlights and alerts, so this purely-informational widget uses neutral text
// tones only.
//
// Design: the mapping from PlatformSummaryMetrics to displayable stats lives in
// the pure helpers `formatTakeRate` / `formatDisputeRate` / `buildSummaryStats`
// so it can be unit-tested without a DOM, mirroring the sibling widgets.

import type { PlatformSummaryMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { formatCurrency } from '../components/currency';
import { periodDateLabels } from '../components/period-dates';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/** Sentinel shown when the take rate is unavailable (gross volume is zero). */
export const TAKE_RATE_UNAVAILABLE = 'N/A';

/**
 * Prefix a backend-formatted USD amount string (already 2dp, e.g. "1234.56")
 * with the business currency symbol. Displayed verbatim — never re-rounded
 * (Requirement 10.1).
 */
export function formatGrossVolume(value: string): string {
    return formatCurrency(value);
}

/**
 * Format the monthly take rate for display: "N/A" when the backend reports null
 * (gross volume is zero), otherwise the backend-formatted percentage string
 * suffixed with "%". Displayed verbatim — never re-rounded (Requirement 10.2).
 */
export function formatTakeRate(value: string | null): string {
    return value === null ? TAKE_RATE_UNAVAILABLE : `${value}%`;
}

/**
 * Format the monthly dispute rate for display: the backend-formatted percentage
 * string (e.g. "0.15", or "0.00" when there are no payments) suffixed with "%".
 * Displayed verbatim — never re-rounded (Requirement 10.3).
 */
export function formatDisputeRate(value: string): string {
    return `${value}%`;
}

/** A single labelled summary figure, formatted for display. */
export interface SummaryStat {
    /** Human-readable label. */
    label: string;
    /** Display-ready value (already affixed with "$" / "%" where relevant). */
    value: string;
}

/**
 * Map PlatformSummaryMetrics to the five display stats in a stable order. Pure
 * and DOM-free so it can be unit-tested directly (Requirements 10.1–10.4).
 */
export function buildSummaryStats(data: PlatformSummaryMetrics): SummaryStat[] {
    return [
        {
            label: 'Gross Volume (This Month)',
            value: formatGrossVolume(data.monthlyGrossVolume),
        },
        {
            label: 'Take Rate (This Month)',
            value: formatTakeRate(data.monthlyTakeRate),
        },
        {
            label: 'Open Disputes',
            value: String(data.openDisputes),
        },
        {
            label: 'Dispute Rate (This Month)',
            value: formatDisputeRate(data.monthlyDisputeRate),
        },
        {
            label: 'Payments (This Month)',
            value: String(data.monthlyPaymentCount),
        },
    ];
}

export interface PlatformSummaryWidgetProps {
    /** Overridable title; defaults to "Platform Summary". */
    title?: string;
}

export default function PlatformSummaryWidget({
    title = 'Platform Summary',
}: PlatformSummaryWidgetProps): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<PlatformSummaryMetrics>('summary');
    const { refreshWidget } = useRefresh();

    const handleRefresh = (): void => {
        // Ask the engine to refresh this widget's data, then re-poll so the UI
        // picks up the freshest cached values (Requirement 8.4).
        void refreshWidget('summary').then(() => refetch());
    };

    const stats = data ? buildSummaryStats(data) : [];

    return (
        <Widget
            title={title}
            lastRefreshed={lastRefreshed}
            isLoading={isLoading}
            error={error}
            isStale={isStale}
            onRefresh={handleRefresh}
        >
            {stats.length === 0 ? (
                <p className="text-text-secondary">No summary data yet.</p>
            ) : (
                <div className="flex flex-col gap-2">
                    <p className="text-xs text-text-secondary">
                        Month to date: {periodDateLabels().month} (UTC)
                    </p>
                    <dl className="grid grid-cols-2 gap-3">
                        {stats.map((stat) => (
                            <div
                                key={stat.label}
                                className="flex flex-col gap-1 rounded border border-border bg-surface-raised px-3 py-2"
                            >
                                <dt className="text-xs text-text-secondary">
                                    {stat.label}
                                </dt>
                                <dd className="font-heading text-lg tabular-nums text-text-primary">
                                    {stat.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </Widget>
    );
}
