// API response interfaces for the ops-dashboard metrics

// Revenue & Payment Metrics (Req 3)
export interface RevenueMetrics {
    periods: {
        day: PeriodMetrics;
        week: PeriodMetrics;
        month: PeriodMetrics;
    };
    lastRefreshed: string;
}

export interface PeriodMetrics {
    grossRevenue: string; // GBP, 2dp e.g. "1234.56"
    netRevenue: string;
    totalFees: string;
    successfulPayments: number;
    failedPayments: number;
    refunds: number;
    averagePayment: string | null; // null = "N/A"
}

// User Growth Metrics (Req 4)
export interface UserGrowthMetrics {
    totalCreators: number;
    totalFans: number;
    periods: {
        day: GrowthPeriod;
        week: GrowthPeriod;
        month: GrowthPeriod;
    };
    lastRefreshed: string;
}

export interface GrowthPeriod {
    newCreators: number;
    newFans: number;
    activeCreators: number;
}

// System Health Metrics (Req 5)
export interface SystemHealthMetrics {
    services: ServiceHealth[];
    apiMetrics: {
        errorRatePerMinute: number;
        avgLatencyMs: number;
    };
    lastRefreshed: string;
}

export interface ServiceHealth {
    name: string;
    status: 'healthy' | 'degraded' | 'down';
    uptime24h: string; // percentage "99.95"
    uptime7d: string;
    alertFiring: boolean;
    lastUpdated: string; // ISO 8601
}

// Dispute Metrics (Req 6 & 7)
export interface DisputeMetrics {
    nearestDeadlineDays: number | null; // null = no open disputes
    disputes: DisputeItem[];
    lastRefreshed: string;
}

export interface DisputeItem {
    paymentId: string;
    amountUsd: string; // "45.00" (USD, the platform's business currency)
    daysRemaining: number; // negative = overdue
    evidenceUploaded: boolean;
    evidenceSubmitted: boolean;
    /**
     * The most-recent S3 batch folder number that holds this dispute's uploaded
     * evidence, or null when no evidence has been uploaded (or the S3 check was
     * unavailable). Populated by merging the S3 evidence check into the Stripe
     * dispute list.
     */
    evidenceBatch: number | null;
    status: DisputeStatus;
}

export type DisputeStatus =
    | 'warning_needs_response'
    | 'warning_under_review'
    | 'needs_response'
    | 'under_review'
    | 'won'
    | 'lost'
    | 'charge_refunded';

// Transaction Feed (Req 9)
export interface TransactionFeedMetrics {
    transactions: TransactionItem[];
    lastRefreshed: string;
}

export interface TransactionItem {
    idSuffix: string; // last 4 chars prefixed with "…"
    amount: string; // original currency, 2dp
    currency: string; // ISO 4217
    timestamp: string; // ISO 8601 with timezone
}

// Platform Summary (Req 10)
export interface PlatformSummaryMetrics {
    monthlyGrossVolume: string; // GBP, 2dp — gross volume processed month-to-date
    monthlyTakeRate: string | null; // percentage or null for "N/A"
    openDisputes: number;
    monthlyDisputeRate: string; // percentage "0.15"
    monthlyPaymentCount: number;
    lastRefreshed: string;
}
