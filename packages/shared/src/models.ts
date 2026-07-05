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
    /**
     * Error message when the S3 evidence lookup failed (e.g. missing S3
     * permissions), or null when it succeeded / was not attempted. Dispute
     * amounts and deadlines still come through from Stripe; only the evidence
     * (upload/batch) columns are unavailable, so the UI surfaces this as a
     * non-fatal warning on the dispute widget rather than failing the widget.
     */
    evidenceError: string | null;
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

// Creator Spotlight (a focused panel for a single creator/user).

/** A single recent payment received by the spotlighted creator. */
export interface CreatorPayment {
    /** Recipient amount, 2dp in the creator's currency (what they received). */
    amount: string;
    /** ISO 4217 currency code of the amount (e.g. "GBP"). */
    currency: string;
    /** Raw payment state, e.g. "succeeded", "requires_payment_method". */
    state: string;
    /** ISO 8601 timestamp the payment was created (for a relative "… ago"). */
    timestamp: string;
}

export interface CreatorSpotlightMetrics {
    /** Platform username being spotlighted. */
    username: string;
    /** Display name, or null when unavailable. */
    displayName: string | null;
    /** ISO country code (e.g. "GB"), or null. */
    country: string | null;
    /** The creator's ISO 4217 currency code (e.g. "GBP"); drives the symbol. */
    currency: string;
    /** FFM onboarding/approval status (e.g. "APPROVED"), or null. */
    ffmStatus: string | null;
    /** Whether the creator is currently accepting payments, or null if unknown. */
    acceptingPayments: boolean | null;
    /** The creator's Stripe (Connect) account id, or null when not linked. */
    stripeAccountId: string | null;

    /** Count of successful payments received by the creator. */
    succeededPaymentCount: number;
    /** Count of all payment attempts (any state) received by the creator. */
    totalPaymentCount: number;
    /** Total value of successful payments received, 2dp in the creator's currency. */
    succeededPaymentValue: string;

    /** The creator's most recent payments (newest first), with state + timestamp. */
    recentPayments: CreatorPayment[];

    /** Available Stripe balance (2dp, creator currency), or null when unavailable. */
    balanceAvailable: string | null;
    /** Pending Stripe balance (2dp, creator currency), or null when unavailable. */
    balancePending: string | null;
    /**
     * Error message when the Stripe balance could not be read (e.g. the API key
     * lacks `balance_read` permission), or null when it was read successfully.
     * Payment counts/values still show; only the balance is affected.
     */
    balanceError: string | null;
    /** Error message when the creator profile/customer could not be found, or null. */
    profileError: string | null;

    lastRefreshed: string;
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
