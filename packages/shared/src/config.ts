// Dashboard configuration type definitions

export interface DashboardConfig {
    version: number;
    refreshIntervalMinutes: number;
    layout: LayoutItem[];
    widgets: WidgetInstance[];
}

export interface LayoutItem {
    i: string; // widget instance ID
    x: number; // grid column
    y: number; // grid row
    w: number; // width in grid units
    h: number; // height in grid units
    minW?: number;
    minH?: number;
}

export interface WidgetInstance {
    id: string;
    type: WidgetType;
    visible: boolean;
}

export type WidgetType =
    | 'revenue'
    | 'payment-counts'
    | 'user-growth'
    | 'system-health'
    | 'dispute-countdown'
    | 'dispute-progress'
    | 'transaction-feed'
    | 'platform-summary';

export interface AggregatorConfig {
    refreshIntervalMinutes: number; // 1-60, default 5
    sourceTimeoutMs: number; // default 10000
}
