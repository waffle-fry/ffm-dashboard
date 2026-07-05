// SpotlightCollector — a focused panel for a single creator/user.
//
// Populates the `spotlight` cache entry with a {@link CreatorSpotlightMetrics}
// payload for one configured platform username: their profile basics, the
// count/value of payments they have received, and their Stripe (Connect)
// account balance.
//
// Data model (discovered from the live platform):
//   - Profile info lives in the `Profile` database, `Profile` collection, keyed
//     by `username`; its `_id` is the platform user id.
//   - The creator's Stripe account id lives in the `Payments` database,
//     `Customer` collection, keyed by that same `_id` (`stripeId`, e.g.
//     "acct_...").
//   - Payments received live in the `Payments` database, `Payments` collection,
//     keyed by `recipientId` (= the profile `_id`); monetary fields are in the
//     currency's MINOR units and `state` is the payment status ("succeeded",
//     "requires_payment_method", ...).
//   - The Stripe balance is read from the connected account.
//
// Dependency inversion: this collector depends only on the narrow
// {@link SpotlightSource} port, so the aggregation is unit-testable without
// Mongo/Stripe. The concrete adapter is wired in server.ts.

import type { CreatorSpotlightMetrics } from '@fans-fund-me/shared';
import type { CollectedMetrics, MetricCollector } from '../aggregator/scheduler.js';
import { formatMoney } from '../utils/formatting.js';

/** The payment state that counts as a completed, successful payment. */
export const SUCCEEDED_PAYMENT_STATE = 'succeeded';

/** Minor units per major unit (e.g. 100 pence per pound). */
const MINOR_UNITS_PER_MAJOR = 100;

/** Profile basics for the spotlighted user. */
export interface SpotlightProfile {
    /** Platform user id (`Profile._id`), used to look up payments/customer. */
    profileId: string;
    username: string;
    displayName: string | null;
    country: string | null;
    /** ISO 4217 currency code, e.g. "GBP". */
    currency: string | null;
    ffmStatus: string | null;
    acceptingPayments: boolean | null;
}

/** The creator's Stripe linkage from the Payments.Customer collection. */
export interface SpotlightCustomer {
    /** Stripe (Connect) account id, e.g. "acct_...", or null when unlinked. */
    stripeId: string | null;
    email: string | null;
    country: string | null;
}

/** A single received payment (only the fields the panel aggregates). */
export interface SpotlightPayment {
    /** Payment status, e.g. "succeeded". */
    state: string;
    /** Amount the recipient receives, in MINOR units. */
    recipientAmount: number;
    /** ISO 4217 currency code of the recipient amount. */
    recipientCurrency: string;
}

/** Available/pending balance for a Stripe account, in MINOR units. */
export interface SpotlightBalance {
    available: number;
    pending: number;
}

/**
 * Narrow port for the spotlight's reads. Each method targets one source; the
 * concrete adapter (server.ts) backs these with Mongo + Stripe.
 */
export interface SpotlightSource {
    /** The profile for `username`, or null when not found. */
    getProfileByUsername(username: string): Promise<SpotlightProfile | null>;
    /** The Stripe customer/linkage for a profile id, or null when absent. */
    getCustomer(profileId: string): Promise<SpotlightCustomer | null>;
    /** All payments received by the profile id (any state). */
    getReceivedPayments(profileId: string): Promise<SpotlightPayment[]>;
    /**
     * The Stripe balance for a connected account, in the given currency. Throws
     * when the balance cannot be read (e.g. missing `balance_read` permission);
     * the collector surfaces that as `balanceError`.
     */
    getBalance(stripeAccountId: string, currency: string): Promise<SpotlightBalance>;
}

/** Aggregated payment totals. Pure over the input. */
export interface PaymentTotals {
    succeededCount: number;
    totalCount: number;
    /** Sum of `recipientAmount` for succeeded payments, in MINOR units. */
    succeededMinor: number;
}

/**
 * Aggregates received payments into counts and the succeeded value (minor
 * units). Only 'succeeded' payments contribute to the value/count of completed
 * payments; `totalCount` includes every attempt.
 */
export function aggregatePayments(
    payments: readonly SpotlightPayment[],
): PaymentTotals {
    let succeededCount = 0;
    let succeededMinor = 0;
    for (const payment of payments) {
        if (payment.state === SUCCEEDED_PAYMENT_STATE) {
            succeededCount += 1;
            if (typeof payment.recipientAmount === 'number') {
                succeededMinor += payment.recipientAmount;
            }
        }
    }
    return { succeededCount, totalCount: payments.length, succeededMinor };
}

/** Converts an integer minor-unit amount to a formatted 2dp major-unit string. */
function minorToFormatted(minor: number): string {
    return formatMoney(minor / MINOR_UNITS_PER_MAJOR);
}

/** Construction options for {@link SpotlightCollector}. */
export interface SpotlightCollectorOptions {
    /** Platform username to spotlight. */
    username: string;
}

/**
 * Collects the single-creator spotlight metrics. Conforms to
 * {@link MetricCollector} so the DataAggregator schedules it like any other
 * source. Never throws for "expected" gaps (missing profile, unreadable
 * balance): those are reported on the payload so the widget can show a clear
 * indicator while still displaying whatever data is available.
 */
export class SpotlightCollector implements MetricCollector {
    readonly name = 'CreatorSpotlight';
    readonly metricKeys = ['spotlight'] as const;

    private readonly source: SpotlightSource;
    private readonly username: string;

    constructor(source: SpotlightSource, options: SpotlightCollectorOptions) {
        this.source = source;
        this.username = options.username;
    }

    async collect(): Promise<CollectedMetrics> {
        const now = new Date();
        const lastRefreshed = now.toISOString();
        const profile = await this.source.getProfileByUsername(this.username);

        if (profile === null) {
            const empty: CreatorSpotlightMetrics = {
                username: this.username,
                displayName: null,
                country: null,
                currency: 'GBP',
                ffmStatus: null,
                acceptingPayments: null,
                stripeAccountId: null,
                succeededPaymentCount: 0,
                totalPaymentCount: 0,
                succeededPaymentValue: formatMoney(0),
                balanceAvailable: null,
                balancePending: null,
                balanceError: null,
                profileError: `No profile found for username "${this.username}".`,
                lastRefreshed,
            };
            return { spotlight: empty };
        }

        const [customer, payments] = await Promise.all([
            this.source.getCustomer(profile.profileId),
            this.source.getReceivedPayments(profile.profileId),
        ]);

        const totals = aggregatePayments(payments);
        const currency =
            profile.currency ?? payments[0]?.recipientCurrency ?? 'GBP';

        // Balance is best-effort: surface a clear error (e.g. missing
        // `balance_read` permission) rather than failing the whole panel.
        let balanceAvailable: string | null = null;
        let balancePending: string | null = null;
        let balanceError: string | null = null;
        const stripeAccountId = customer?.stripeId ?? null;
        if (stripeAccountId === null) {
            balanceError = 'No Stripe account linked for this creator.';
        } else {
            try {
                const balance = await this.source.getBalance(stripeAccountId, currency);
                balanceAvailable = minorToFormatted(balance.available);
                balancePending = minorToFormatted(balance.pending);
            } catch (error) {
                balanceError =
                    error instanceof Error ? error.message : String(error);
            }
        }

        const metrics: CreatorSpotlightMetrics = {
            username: profile.username,
            displayName: profile.displayName,
            country: profile.country,
            currency,
            ffmStatus: profile.ffmStatus,
            acceptingPayments: profile.acceptingPayments,
            stripeAccountId,
            succeededPaymentCount: totals.succeededCount,
            totalPaymentCount: totals.totalCount,
            succeededPaymentValue: minorToFormatted(totals.succeededMinor),
            balanceAvailable,
            balancePending,
            balanceError,
            profileError: null,
            lastRefreshed,
        };
        return { spotlight: metrics };
    }
}
