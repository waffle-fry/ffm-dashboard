// Widget registry — maps each WidgetType to its concrete widget component.
//
// Each concrete widget is self-contained: it owns its own data fetching
// (useMetrics/useRefresh) and renders the shared Widget chrome (border, title
// bar, refresh button, status rows). The registry is the single place the
// shell/grid uses to turn a WidgetType into a renderable component, replacing
// the earlier placeholder bodies.

import type { ComponentType } from 'react';
import type { WidgetType } from '@fans-fund-me/shared';

import RevenueWidget from './RevenueWidget';
import PaymentCountWidget from './PaymentCountWidget';
import UserGrowthWidget from './UserGrowthWidget';
import SystemHealthWidget from './SystemHealthWidget';
import DisputeCountdownWidget from './DisputeCountdownWidget';
import DisputeProgressWidget from './DisputeProgressWidget';
import TransactionFeedWidget from './TransactionFeedWidget';
import PlatformSummaryWidget from './PlatformSummaryWidget';
import CreatorSpotlightWidget from './CreatorSpotlightWidget';

/**
 * The concrete component for every widget type. Every {@link WidgetType} has an
 * entry, so `WIDGET_COMPONENTS[type]` is always defined.
 */
export const WIDGET_COMPONENTS: Record<WidgetType, ComponentType> = {
    revenue: RevenueWidget,
    'payment-counts': PaymentCountWidget,
    'user-growth': UserGrowthWidget,
    'system-health': SystemHealthWidget,
    'dispute-countdown': DisputeCountdownWidget,
    'dispute-progress': DisputeProgressWidget,
    'transaction-feed': TransactionFeedWidget,
    'platform-summary': PlatformSummaryWidget,
    'creator-spotlight': CreatorSpotlightWidget,
};

/**
 * Render the concrete widget for a given type. The returned element renders the
 * full Widget chrome on its own, so callers must NOT wrap it in additional card
 * borders or title bars.
 */
export function renderWidget(type: WidgetType): JSX.Element {
    const Component = WIDGET_COMPONENTS[type];
    return <Component />;
}
