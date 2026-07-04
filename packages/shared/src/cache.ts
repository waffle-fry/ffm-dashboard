// Cache and metrics store type definitions

import type {
    DisputeMetrics,
    RevenueMetrics,
    SystemHealthMetrics,
    TransactionFeedMetrics,
    UserGrowthMetrics,
    PlatformSummaryMetrics,
} from './models.js';

export interface CacheEntry<T> {
    data: T | null;
    lastRefreshed: string | null;
    lastError: string | null;
    isRefreshing: boolean;
}

export interface MetricsStore {
    revenue: CacheEntry<RevenueMetrics>;
    users: CacheEntry<UserGrowthMetrics>;
    health: CacheEntry<SystemHealthMetrics>;
    disputes: CacheEntry<DisputeMetrics>;
    transactions: CacheEntry<TransactionFeedMetrics>;
    summary: CacheEntry<PlatformSummaryMetrics>;
}
