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
import { formatCurrency, formatCurrencyAmount } from '../components/currency';
import { periodDateLabels } from '../components/period-dates';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/** Sentinel shown when the take rate is unavailable (gross volume is zero). */
export const TAKE_RATE_UNAVAILABLE = 'N/A';

/** Shown on a balance tile when the figure could not be produced. */
export const BALANCE_UNAVAILABLE = 'Unavailable';

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
 * Map PlatformSummaryMetrics to the four month-to-date display stats in a
 * stable order. Pure and DOM-free so it can be unit-tested directly
 * (Requirements 10.1–10.4). The open-disputes count now lives on the Dispute
 * Deadlines widget (Requirement 6.9), so it is intentionally not shown here.
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
            label: 'Dispute Rate (This Month)',
            value: formatDisputeRate(data.monthlyDisputeRate),
        },
        {
            label: 'Payments (This Month)',
            value: String(data.monthlyPaymentCount),
        },
    ];
}

/** A single platform-balance tile, with an optional per-tile error. */
export interface BalanceStat {
    /** Human-readable label. */
    label: string;
    /** Display-ready value, or {@link BALANCE_UNAVAILABLE} when not available. */
    value: string;
    /** Non-fatal error message for this tile, or null. */
    error: string | null;
}

/**
 * Map the platform-balance fields of PlatformSummaryMetrics to the four balance
 * tiles in a stable order (Requirement 11.6): Stripe (USD), Mercury (USD), total
 * (USD), and total (GBP). USD figures use the business currency symbol; the GBP
 * total uses the pound symbol. Amounts are shown verbatim — never re-rounded.
 * Pure and DOM-free for direct unit testing.
 */
export function buildBalanceStats(data: PlatformSummaryMetrics): BalanceStat[] {
    return [
        {
            label: 'Stripe Balance (USD)',
            value:
                data.stripeBalanceUsd === null
                    ? BALANCE_UNAVAILABLE
                    : formatCurrency(data.stripeBalanceUsd),
            error: data.stripeBalanceError,
        },
        {
            label: 'Mercury Balance (USD)',
            value:
                data.mercuryBalanceUsd === null
                    ? BALANCE_UNAVAILABLE
                    : formatCurrency(data.mercuryBalanceUsd),
            error: data.mercuryBalanceError,
        },
        {
            label: 'Total Balance (USD)',
            value:
                data.totalBalanceUsd === null
                    ? BALANCE_UNAVAILABLE
                    : formatCurrency(data.totalBalanceUsd),
            error: null,
        },
        {
            label: 'Total Balance (GBP)',
            value:
                data.totalBalanceGbp === null
                    ? BALANCE_UNAVAILABLE
                    : formatCurrencyAmount(data.totalBalanceGbp, 'GBP'),
            error: null,
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
    const balanceStats = data ? buildBalanceStats(data) : [];

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

                    <p className="mt-1 text-xs text-text-secondary">
                        Platform balances
                    </p>
                    <dl className="grid grid-cols-2 gap-3">
                        {balanceStats.map((stat) => (
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
                                {stat.error !== null && (
                                    <p
                                        className="text-xs text-danger"
                                        title={stat.error}
                                    >
                                        ⚠ Unavailable
                                    </p>
                                )}
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </Widget>
    );
}
