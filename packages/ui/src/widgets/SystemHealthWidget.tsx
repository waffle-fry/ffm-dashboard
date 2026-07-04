// SystemHealthWidget — concrete widget rendering Grafana-sourced service health.
//
// It shows, per monitored service: the current status (healthy / degraded /
// down), the 24h and 7d uptime percentages, and — once for the platform API —
// the error rate (errors/min) and average latency (ms). It wraps the shared
// `Widget` chrome and feeds it data from `useMetrics<SystemHealthMetrics>('health')`.
//
// Requirement 5.1: display current status for each monitored service.
// Requirement 5.2: display 24h and 7d uptime percentages (2dp) per service.
// Requirement 5.3: display platform API error rate (errors/min) + avg latency (ms).
// Requirement 5.4: when a service's Grafana alert is firing (`alertFiring`),
//   highlight that service using the yellow/gold accent color.
// Requirement 5.7: when metric data is stale (> 120s old) show a stale-data
//   indicator. The base `Widget` renders the widget-level ⚠ indicator from the
//   hook's `isStale`; we additionally flag any individual service whose own
//   `lastUpdated` timestamp is older than the 120s threshold.
//
// Brand note (Requirement 1.1 / 5.4): the yellow/gold accent is reserved for
// highlights and alerts. Here it marks a firing alert (row border + badge) and
// the "degraded" attention status; healthy uses success green and down uses
// danger red so the two unhealthy states stay visually distinct.

import { computeIsStale, useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';
import Widget from '../components/Widget';
import type { ServiceHealth, SystemHealthMetrics } from '@fans-fund-me/shared';

// ---------------------------------------------------------------------------
// Pure, DOM-free presentation helpers — directly unit-testable.
// ---------------------------------------------------------------------------

/** Human-facing label for a service status. */
export function statusLabel(status: ServiceHealth['status']): string {
    switch (status) {
        case 'healthy':
            return 'Healthy';
        case 'degraded':
            return 'Degraded';
        case 'down':
            return 'Down';
    }
}

/**
 * Text colour class for a service status (Requirement 5.1). Healthy is success
 * green, degraded uses the gold accent (an attention/warning state), and down
 * uses danger red so the two unhealthy states remain visually distinct.
 */
export function statusColorClass(status: ServiceHealth['status']): string {
    switch (status) {
        case 'healthy':
            return 'text-success';
        case 'degraded':
            return 'text-accent';
        case 'down':
            return 'text-danger';
    }
}

/**
 * Container classes for a single service card. When the service's Grafana alert
 * is firing, highlight it with the yellow/gold accent border + subtle fill
 * (Requirement 5.4); otherwise use the neutral border.
 */
export function serviceCardClass(alertFiring: boolean): string {
    const base = 'rounded-md border p-3';
    return alertFiring
        ? `${base} border-accent bg-accent/10`
        : `${base} border-border`;
}

/** Format an uptime percentage string (already 2dp, e.g. "99.95") with a `%`. */
export function formatUptime(value: string): string {
    return `${value}%`;
}

/** Format the platform error rate as "N errors/min". */
export function formatErrorRate(errorsPerMinute: number): string {
    return `${errorsPerMinute} errors/min`;
}

/** Format the platform average latency as "N ms". */
export function formatLatency(avgLatencyMs: number): string {
    return `${avgLatencyMs} ms`;
}

/**
 * Whether an individual service's data is stale (> 120s since its own
 * `lastUpdated`), so a per-service stale indicator can be shown (Requirement
 * 5.7). Delegates to the shared `computeIsStale` (120s threshold) used by the
 * polling hook and base widget.
 */
export function isServiceStale(
    service: ServiceHealth,
    now: number = Date.now(),
): boolean {
    return computeIsStale(service.lastUpdated, now);
}

// ---------------------------------------------------------------------------
// Sub-components.
// ---------------------------------------------------------------------------

function ServiceRow({ service }: { service: ServiceHealth }): JSX.Element {
    const stale = isServiceStale(service);
    return (
        <li className={serviceCardClass(service.alertFiring)}>
            <div className="flex items-center justify-between gap-2">
                <span className="truncate font-heading text-text-primary">
                    {service.name}
                </span>
                <span
                    className={`shrink-0 font-medium ${statusColorClass(
                        service.status,
                    )}`}
                >
                    {statusLabel(service.status)}
                </span>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-body text-text-secondary">
                <dt>Uptime (24h)</dt>
                <dd className="text-right text-text-primary">
                    {formatUptime(service.uptime24h)}
                </dd>
                <dt>Uptime (7d)</dt>
                <dd className="text-right text-text-primary">
                    {formatUptime(service.uptime7d)}
                </dd>
            </dl>

            {service.alertFiring && (
                <p
                    role="status"
                    className="mt-2 flex items-center gap-1 text-body text-accent"
                >
                    <span aria-hidden="true">⚠</span>
                    <span>Alert firing</span>
                </p>
            )}

            {stale && (
                <p
                    role="status"
                    className="mt-1 flex items-center gap-1 text-body text-accent"
                >
                    <span aria-hidden="true">⚠</span>
                    <span>Stale data</span>
                </p>
            )}
        </li>
    );
}

// ---------------------------------------------------------------------------
// The widget.
// ---------------------------------------------------------------------------

export default function SystemHealthWidget(): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<SystemHealthMetrics>('health');
    const { refreshWidget } = useRefresh();

    const handleRefresh = (): void => {
        void refreshWidget('health').then(() => refetch());
    };

    return (
        <Widget
            title="System Health"
            lastRefreshed={lastRefreshed}
            isLoading={isLoading}
            error={error}
            isStale={isStale}
            onRefresh={handleRefresh}
        >
            {data === null ? (
                <p className="text-body text-text-secondary">
                    No health data available.
                </p>
            ) : (
                <div className="flex flex-col gap-3">
                    <ul className="flex flex-col gap-2">
                        {data.services.map((service) => (
                            <ServiceRow key={service.name} service={service} />
                        ))}
                    </ul>

                    {/* Platform-wide API metrics (Requirement 5.3). */}
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-body text-text-secondary">
                        <dt>Error rate</dt>
                        <dd className="text-right text-text-primary">
                            {formatErrorRate(
                                data.apiMetrics.errorRatePerMinute,
                            )}
                        </dd>
                        <dt>Avg latency</dt>
                        <dd className="text-right text-text-primary">
                            {formatLatency(data.apiMetrics.avgLatencyMs)}
                        </dd>
                    </dl>
                </div>
            )}
        </Widget>
    );
}
