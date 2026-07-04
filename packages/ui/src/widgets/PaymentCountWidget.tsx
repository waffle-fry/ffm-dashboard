// PaymentCountWidget — displays successful / failed / refund payment counts for
// the current day, week and month, plus the average payment amount per period
// (Requirements 3.2, 3.3).
//
// The widget consumes the same `revenue` metric (RevenueMetrics) as
// RevenueWidget — the engine serves revenue and payment-count data under one
// key. It renders inside the shared Widget chrome and wires manual refresh to
// the `revenue` widget.
//
// Requirement 3.3: the average payment is displayed verbatim from the backend
// (already a USD 2dp string) with the currency symbol, or "N/A" when the backend
// reports null (no successful payments in the period). The UI never computes or
// re-rounds the average.
//
// Brand note (Requirement 1.1): neutral text tones only — the yellow/gold
// accent stays reserved for highlights and alerts.
//
// Design: the display mapping lives in the pure helpers `formatAveragePayment`
// / `buildPaymentRows` so it can be unit-tested without a DOM.

import type { RevenueMetrics, PeriodMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { formatCurrency } from '../components/currency';
import { periodDateLabels } from '../components/period-dates';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/** Sentinel shown when a period has no successful payments (Requirement 3.3). */
export const AVERAGE_UNAVAILABLE = 'N/A';

/**
 * Format a period's average payment for display: "N/A" when the backend reports
 * null, otherwise the backend-formatted USD string prefixed with the currency
 * symbol. The value is displayed verbatim — never re-rounded (Requirement 3.3).
 */
export function formatAveragePayment(value: string | null): string {
    return value === null ? AVERAGE_UNAVAILABLE : formatCurrency(value);
}

/** A single period's payment figures, formatted for display. */
export interface PaymentRow {
    /** Human-readable period label ("Today" / "This Week" / "This Month"). */
    label: string;
    successful: number;
    failed: number;
    refunds: number;
    /** Average payment, currency-prefixed, or "N/A". */
    average: string;
}

function toRow(label: string, period: PeriodMetrics): PaymentRow {
    return {
        label,
        successful: period.successfulPayments,
        failed: period.failedPayments,
        refunds: period.refunds,
        average: formatAveragePayment(period.averagePayment),
    };
}

/**
 * Map the three periods (day / week / month) to payment display rows in a
 * stable order. Pure and DOM-free so it can be unit-tested directly.
 */
export function buildPaymentRows(data: RevenueMetrics): PaymentRow[] {
    const { day, week, month } = data.periods;
    return [
        toRow('Today', day),
        toRow('This Week', week),
        toRow('This Month', month),
    ];
}

export interface PaymentCountWidgetProps {
    /** Overridable title; defaults to "Payments". */
    title?: string;
}

export default function PaymentCountWidget({
    title = 'Payments',
}: PaymentCountWidgetProps): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<RevenueMetrics>('revenue');
    const { refreshWidget } = useRefresh();

    const handleRefresh = (): void => {
        void refreshWidget('revenue').then(() => refetch());
    };

    const rows = data ? buildPaymentRows(data) : [];
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
                <p className="text-text-secondary">No payment data yet.</p>
            ) : (
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="text-left text-text-secondary">
                            <th className="py-1 pr-2 font-heading font-normal">
                                Period
                            </th>
                            <th className="py-1 pr-2 text-right font-heading font-normal">
                                Success
                            </th>
                            <th className="py-1 pr-2 text-right font-heading font-normal">
                                Failed
                            </th>
                            <th className="py-1 pr-2 text-right font-heading font-normal">
                                Refunds
                            </th>
                            <th className="py-1 text-right font-heading font-normal">
                                Avg
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
                                    {row.successful}
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums text-text-primary">
                                    {row.failed}
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums text-text-primary">
                                    {row.refunds}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-text-secondary">
                                    {row.average}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Widget>
    );
}
