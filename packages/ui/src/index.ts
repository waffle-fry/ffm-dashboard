// Dashboard UI package entry point.
//
// The runtime entry for the app is `src/main.tsx` (bootstrapped by Vite via
// index.html). This module re-exports the brand design tokens so they can be
// consumed as a library surface and unit-tested.
export * from './styles/tokens';
export { installFontLoadingTimeout } from './styles/fonts';
export { default as Widget, type WidgetProps } from './components/Widget';
export {
    default as ConfigPanel,
    type ConfigPanelProps,
    clampRefreshIntervalMinutes,
    isWidgetPresent,
    presentWidgetTypes,
    addWidget,
    removeWidget,
    setRefreshIntervalMinutes,
    putRefreshInterval,
    CONFIG_ENDPOINT,
    MIN_REFRESH_INTERVAL_MINUTES,
    MAX_REFRESH_INTERVAL_MINUTES,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
} from './components/ConfigPanel';
export { WIDGET_TITLES } from './components/widget-titles';
export {
    minutesAgo,
    formatMinutesAgo,
    formatStaleLabel,
    formatTimestamp,
    MINUTE_MS,
} from './components/time-format';
export {
    useWidgetConfig,
    parseStoredConfig,
    loadStoredConfig,
    createDefaultConfig,
    reconcileConfig,
    DEFAULT_DASHBOARD_CONFIG,
    KNOWN_WIDGET_TYPES,
    WIDGET_CONFIG_STORAGE_KEY,
    DASHBOARD_CONFIG_VERSION,
} from './hooks/useWidgetConfig';
export {
    useMetrics,
    fetchMetric,
    buildMetricUrl,
    isMetricEnvelope,
    reduceMetricsState,
    initialMetricsState,
    computeIsStale,
    formatRelativeTime,
    pollIntervalFromMinutes,
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_FETCH_TIMEOUT_MS,
    DEFAULT_STALE_THRESHOLD_MS,
} from './hooks/useMetrics';
export type {
    MetricWidget,
    MetricEnvelope,
    MetricsState,
    UseMetricsResult,
    UseMetricsOptions,
    FetchOutcome,
} from './hooks/useMetrics';
export {
    useRefresh,
    postRefresh,
    buildRefreshUrl,
    shouldStartRefresh,
    isRefreshResponse,
} from './hooks/useRefresh';
export type {
    RefreshScope,
    RefreshResponse,
    RefreshOutcome,
    UseRefreshResult,
} from './hooks/useRefresh';

// Concrete widgets + the registry that maps each WidgetType to its component.
export { default as RevenueWidget } from './widgets/RevenueWidget';
export { default as PaymentCountWidget } from './widgets/PaymentCountWidget';
export { default as UserGrowthWidget } from './widgets/UserGrowthWidget';
export { default as SystemHealthWidget } from './widgets/SystemHealthWidget';
export { default as DisputeCountdownWidget } from './widgets/DisputeCountdownWidget';
export { default as DisputeProgressWidget } from './widgets/DisputeProgressWidget';
export { default as TransactionFeedWidget } from './widgets/TransactionFeedWidget';
export { default as PlatformSummaryWidget } from './widgets/PlatformSummaryWidget';
export { WIDGET_COMPONENTS, renderWidget } from './widgets/registry';
