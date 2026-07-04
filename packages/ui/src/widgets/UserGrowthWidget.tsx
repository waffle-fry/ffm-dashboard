// UserGrowthWidget — user and creator growth metrics (Requirement 4).
//
// Renders, inside the shared `Widget` chrome:
//   - Total registered Creators and total registered Fans (Requirement 4.1).
//   - New Creators and new Fans registered in the current day / week / month
//     (Requirement 4.2).
//   - Active Creators (received >= 1 successful payment) per period
//     (Requirement 4.3).
//
// The data is served under the `users` metric key; polling, staleness, error
// retention and last-refreshed tracking are handled by `useMetrics` (task 11.2)
// and manual refresh by `useRefresh` (Requirement 8.4). Errors never clear the
// last-known data, which stays visible beneath the error indicator.
//
// Requirement 4.5: empty periods display 0 rather than being omitted. The
// backend already returns explicit 0s, so we render the numeric values
// directly; `buildUserGrowthView` additionally coerces any missing payload to
// zeros so a not-yet-loaded widget still shows the full metric structure.
//
// Brand note (Requirement 1.1): counts use neutral/light text; the yellow/gold
// accent is reserved for highlights and alerts and is not used for ordinary
// values here. The shared `Widget` owns the stale/error accenting.

import type { UserGrowthMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { periodDateLabels } from '../components/period-dates';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/** The three reporting periods, in display order. */
export type GrowthPeriodKey = 'day' | 'week' | 'month';

/** A single period's row in the view model. */
export interface GrowthPeriodRow {
    key: GrowthPeriodKey;
    /** Human-readable label for the period column. */
    label: string;
    newCreators: number;
    newFans: number;
    activeCreators: number;
}

/** Presentation-ready view model derived from `UserGrowthMetrics`. */
export interface UserGrowthView {
    totalCreators: number;
    totalFans: number;
    periods: GrowthPeriodRow[];
}

const PERIOD_LABELS: Record<GrowthPeriodKey, string> = {
    day: 'Today',
    week: 'This Week',
    month: 'This Month',
};

const PERIOD_ORDER: readonly GrowthPeriodKey[] = ['day', 'week', 'month'];

/**
 * Pure mapping from the metrics payload to a render-ready view model.
 *
 * Coerces a null/absent payload (and any absent period figures) to explicit
 * zeros so every period is always shown with a number rather than omitted
 * (Requirement 4.5). Periods are always returned in day/week/month order.
 */
export function buildUserGrowthView(
    metrics: UserGrowthMetrics | null,
): UserGrowthView {
    const periods = PERIOD_ORDER.map((key): GrowthPeriodRow => {
        const period = metrics?.periods?.[key];
        return {
            key,
            label: PERIOD_LABELS[key],
            newCreators: period?.newCreators ?? 0,
            newFans: period?.newFans ?? 0,
            activeCreators: period?.activeCreators ?? 0,
        };
    });

    return {
        totalCreators: metrics?.totalCreators ?? 0,
        totalFans: metrics?.totalFans ?? 0,
        periods,
    };
}

/** Format a whole-number count with locale grouping (e.g. 1234 -> "1,234"). */
export function formatCount(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return new Intl.NumberFormat('en-GB').format(value);
}

/** A single large total (Creators or Fans). */
function TotalStat({
    label,
    value,
}: {
    label: string;
    value: number;
}): JSX.Element {
    return (
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-surface-raised px-3 py-2">
            <span className="text-xs uppercase tracking-wide text-text-secondary">
                {label}
            </span>
            <span className="font-heading text-2xl text-text-primary">
                {formatCount(value)}
            </span>
        </div>
    );
}

export default function UserGrowthWidget(): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<UserGrowthMetrics>('users');
    const { refreshWidget } = useRefresh();

    const view = buildUserGrowthView(data);
    const dates = periodDateLabels();

    const handleRefresh = (): void => {
        void refreshWidget('users');
        void refetch();
    };

    return (
        <Widget
            title="User Growth"
            lastRefreshed={lastRefreshed}
            isLoading={isLoading}
            error={error}
            isStale={isStale}
            onRefresh={handleRefresh}
        >
            <div className="flex flex-col gap-4">
                {/* Totals (Requirement 4.1) */}
                <div className="grid grid-cols-2 gap-3">
                    <TotalStat
                        label="Total Creators"
                        value={view.totalCreators}
                    />
                    <TotalStat label="Total Fans" value={view.totalFans} />
                </div>

                {/* Per-period breakdown (Requirements 4.2 & 4.3) */}
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-text-secondary">
                            <th scope="col" className="py-1 pr-2 font-medium">
                                Period
                            </th>
                            <th
                                scope="col"
                                className="py-1 px-2 text-right font-medium"
                            >
                                New Creators
                            </th>
                            <th
                                scope="col"
                                className="py-1 px-2 text-right font-medium"
                            >
                                New Fans
                            </th>
                            <th
                                scope="col"
                                className="py-1 pl-2 text-right font-medium"
                            >
                                Active Creators
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {view.periods.map((period) => (
                            <tr
                                key={period.key}
                                className="border-t border-border"
                            >
                                <th
                                    scope="row"
                                    className="py-1.5 pr-2 text-left font-normal text-text-primary"
                                >
                                    <span className="block">{period.label}</span>
                                    <span className="block text-xs text-text-secondary">
                                        {dates[period.key]}
                                    </span>
                                </th>
                                <td className="py-1.5 px-2 text-right tabular-nums text-text-primary">
                                    {formatCount(period.newCreators)}
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-text-primary">
                                    {formatCount(period.newFans)}
                                </td>
                                <td className="py-1.5 pl-2 text-right tabular-nums text-text-primary">
                                    {formatCount(period.activeCreators)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Widget>
    );
}
