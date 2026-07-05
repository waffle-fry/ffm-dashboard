// CreatorSpotlightWidget — a focused panel for a single creator/user.
//
// Shows the spotlighted creator's identity, the count and value of payments
// they have received, and their Stripe (Connect) account balance. Data comes
// from `useMetrics<CreatorSpotlightMetrics>('spotlight')`.
//
// Resilience: the Stripe balance and the profile lookup can each fail
// independently (e.g. the API key lacks `balance_read`, or the profile is
// missing). Those are delivered as `balanceError` / `profileError` on the
// payload and rendered as inline warnings so the rest of the panel still shows.

import type { CreatorSpotlightMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { formatCurrencyAmount } from '../components/currency';
import { formatRelativeTime } from '../components/time-format';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/** Human-readable label for a raw payment state. */
const STATE_LABELS: Record<string, string> = {
    succeeded: 'Succeeded',
    requires_payment_method: 'Incomplete',
    requires_action: 'Pending',
    processing: 'Processing',
    canceled: 'Canceled',
};

/** Prettify a raw payment state for display. */
function stateLabel(state: string): string {
    return STATE_LABELS[state] ?? state.replace(/_/g, ' ');
}

/** Brand colour class for a payment state (green ok, red canceled, else muted). */
function stateClass(state: string): string {
    if (state === 'succeeded') return 'text-success';
    if (state === 'canceled') return 'text-danger';
    return 'text-text-secondary';
}

/** A single labelled stat. */
function Stat({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="flex flex-col gap-0.5 rounded border border-border bg-surface-raised px-3 py-2">
            <span className="text-xs text-text-secondary">{label}</span>
            <span className="font-heading text-lg tabular-nums text-text-primary">
                {value}
            </span>
        </div>
    );
}

/** Small inline warning row (non-fatal). */
function Warning({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
            <span aria-hidden="true">⚠</span>
            <span className="min-w-0">{children}</span>
        </div>
    );
}

export interface CreatorSpotlightWidgetProps {
    /** Overridable title; defaults to "Creator Spotlight". */
    title?: string;
}

export default function CreatorSpotlightWidget({
    title = 'Creator Spotlight',
}: CreatorSpotlightWidgetProps): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<CreatorSpotlightMetrics>('spotlight');
    const { refreshWidget } = useRefresh();

    const handleRefresh = (): void => {
        void refreshWidget('spotlight').then(() => refetch());
    };

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
            {data === null ? (
                <p className="text-text-secondary">No data yet.</p>
            ) : data.profileError ? (
                <Warning>{data.profileError}</Warning>
            ) : (
                <div className="flex h-full flex-col gap-3">
                    {/* Identity */}
                    <div className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0">
                            <div className="truncate font-heading text-text-primary">
                                {data.displayName || data.username}
                            </div>
                            <div className="truncate font-mono text-xs text-text-secondary">
                                @{data.username}
                            </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-text-secondary">
                            {data.country && <div>{data.country}</div>}
                            {data.ffmStatus && (
                                <div className="uppercase tracking-wide">
                                    {data.ffmStatus}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Payments received */}
                    <div className="grid grid-cols-2 gap-2">
                        <Stat
                            label="Payments (succeeded)"
                            value={String(data.succeededPaymentCount)}
                        />
                        <Stat
                            label="Value received"
                            value={formatCurrencyAmount(
                                data.succeededPaymentValue,
                                data.currency,
                            )}
                        />
                    </div>

                    {/* Today's activity (since 00:00 UTC) */}
                    <div className="grid grid-cols-2 gap-2">
                        <Stat
                            label="Payments (today)"
                            value={String(data.dayPaymentCount)}
                        />
                        <Stat
                            label="Received (today)"
                            value={formatCurrencyAmount(
                                data.dayPaymentValue,
                                data.currency,
                            )}
                        />
                    </div>

                    {/* Stripe balance */}
                    <div>
                        {data.balanceError ? (
                            <Warning>
                                Stripe balance unavailable: {data.balanceError}
                            </Warning>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                <Stat
                                    label="Balance (available)"
                                    value={formatCurrencyAmount(
                                        data.balanceAvailable ?? '0.00',
                                        data.currency,
                                    )}
                                />
                                <Stat
                                    label="Balance (pending)"
                                    value={formatCurrencyAmount(
                                        data.balancePending ?? '0.00',
                                        data.currency,
                                    )}
                                />
                            </div>
                        )}
                    </div>

                    {/* Recent payments (newest first) with status + relative time. */}
                    <div className="flex min-h-0 flex-col">
                        <div className="mb-1 text-xs uppercase tracking-wide text-text-secondary">
                            Recent payments
                        </div>
                        {data.recentPayments.length === 0 ? (
                            <p className="text-sm text-text-secondary">
                                No payments yet.
                            </p>
                        ) : (
                            <ul className="flex flex-col divide-y divide-border">
                                {data.recentPayments.map((p, i) => (
                                    <li
                                        key={`${p.timestamp}-${i}`}
                                        className="flex items-center justify-between gap-2 py-1.5 text-sm"
                                    >
                                        <span className="w-20 shrink-0 tabular-nums text-text-primary">
                                            {formatCurrencyAmount(p.amount, p.currency)}
                                        </span>
                                        <span
                                            className={`flex-1 truncate text-xs ${stateClass(p.state)}`}
                                        >
                                            {stateLabel(p.state)}
                                        </span>
                                        <span className="shrink-0 text-xs text-text-secondary">
                                            {formatRelativeTime(p.timestamp, now)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Only surface the not-accepting-payments flag when set. */}
                    {data.acceptingPayments === false && (
                        <div className="text-xs text-danger">
                            Not accepting payments
                        </div>
                    )}
                </div>
            )}
        </Widget>
    );
}
