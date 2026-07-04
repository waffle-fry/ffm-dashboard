// Human-readable widget titles, keyed by WidgetType.
//
// This is the single source of truth for the label shown for each widget type.
// It lives in its own DOM-free / React-free module so it can be shared by the
// DashboardShell (widget header labels) and the ConfigPanel (add/remove widget
// list) without either pulling the other's heavy dependency graph, and so it is
// trivially unit-testable.

import type { WidgetType } from '@fans-fund-me/shared';

/** Human-readable titles per widget type, shown in widget headers and config. */
export const WIDGET_TITLES: Record<WidgetType, string> = {
    revenue: 'Revenue',
    'payment-counts': 'Payments',
    'user-growth': 'User Growth',
    'system-health': 'System Health',
    'dispute-countdown': 'Dispute Countdown',
    'dispute-progress': 'Dispute Progress',
    'transaction-feed': 'Recent Transactions',
    'platform-summary': 'Platform Summary',
};
