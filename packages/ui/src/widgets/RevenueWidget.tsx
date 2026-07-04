// RevenueWidget — displays gross / net / fees revenue for the current day,
// week and month (Requirement 3.1).
//
// The widget fetches the `revenue` metric (RevenueMetrics) via useMetrics and
// renders it inside the shared Widget chrome (title bar, last-refreshed
// timestamp, loading / error / stale indicators, manual refresh button). The
// manual refresh button asks the engine to refresh the `revenue` widget and
// then re-polls the endpoint.
//
// The backend already formats every monetary value to a USD string with two
// decimal places (PeriodMetrics.grossRevenue / netRevenue / totalFees), so the
// UI only prefixes the currency symbol — it never re-rounds or re-parses.
//
// Brand note (Requirement 1.1): the yellow/gold accent is reserved for
// highlights and alerts, so this purely-informational widget uses neutral text
// tones only.
//
// Design: the mapping from RevenueMetrics to displayable rows lives in the pure
// helpers `formatGbp` / `buildRevenueRows` so it can be unit-tested without a
// DOM, mirroring the pattern used by the hooks and time-format helpers.

import type { RevenueMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { formatCurrency } from '../components/currency';
import { periodDateLabels } from '../components/period-dates';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/**
 * Prefix a backend-formatted USD amount string (already 2dp, e.g. "1234.56")
 * with the business currency symbol. The value is displayed verbatim — never
 * re-rounded.
 */
export function formatUsd(value: string): string {
    return formatCurrency(value);
}

/** A single period's revenue figures, formatted for display. */
export interface RevenueRow {
    /** Human-readable period label ("Today" / "This Week" / "This Month"). */
    label: string;
    /** Gross revenue, USD with currency symbol. */
    gross: string;
    /** Net revenue, USD with currency symbol. */
    net: string;
    /** Total fees, USD with currency symbol. */
    fees: string;
}

/**
 * Map the three revenue periods (day / week / month) to display rows in a
 * stable order. Pure and DOM-free so it can be unit-tested directly.
 */
export function buildRevenueRows(data: RevenueMetrics): RevenueRow[] {
    const { day, week, month } = data.periods;
    return [
        {
            label: 'Today',
            gross: formatUsd(day.grossRevenue),
            net: formatUsd(day.netRevenue),
            fees: formatUsd(day.totalFees),
        },
        {
            label: 'This Week',
            gross: formatUsd(week.grossRevenue),
            net: formatUsd(week.netRevenue),
            fees: formatUsd(week.totalFees),
        },
        {
            label: 'This Month',
            gross: formatUsd(month.grossRevenue),
            net: formatUsd(month.netRevenue),
            fees: formatUsd(month.totalFees),
        },
    ];
}

export interface RevenueWidgetProps {
    /** Overridable title; defaults to "Revenue". */
    title?: string;
}

export default function RevenueWidget({
    title = 'Revenue',
}: RevenueWidgetProps): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<RevenueMetrics>('revenue');
    const { refreshWidget } = useRefresh();

    const handleRefresh = (): void => {
        // Ask the engine to refresh this widget's data, then re-poll so the UI
        // picks up the freshest cached values (Requirement 8.4).
        void refreshWidget('revenue').then(() => refetch());
    };

    const rows = data ? buildRevenueRows(data) : [];
    // Date range each period covers (UTC), in the same order as `rows`.
    const dates = periodDateLabels();
    const rowDates = [dates.day, dates.week, dates.month];

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
                <p className="text-text-secondary">No revenue data yet.</p>
            ) : (
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="text-left text-text-secondary">
                            <th className="py-1 pr-2 font-heading font-normal">
                                Period
                            </th>
                            <th className="py-1 pr-2 text-right font-heading font-normal">
                                Gross
                            </th>
                            <th className="py-1 pr-2 text-right font-heading font-normal">
                                Net
                            </th>
                            <th className="py-1 text-right font-heading font-normal">
                                Fees
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr
                                key={row.label}
                                className="border-t border-border"
                            >
                                <th
                                    scope="row"
                                    className="py-1.5 pr-2 text-left font-normal text-text-secondary"
                                >
                                    <span className="block text-text-primary">
                                        {row.label}
                                    </span>
                                    <span className="block text-xs text-text-secondary">
                                        {rowDates[i]}
                                    </span>
                                </th>
                                <td className="py-1.5 pr-2 text-right tabular-nums text-text-primary">
                                    {row.gross}
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums text-text-primary">
                                    {row.net}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-text-secondary">
                                    {row.fees}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Widget>
    );
}
