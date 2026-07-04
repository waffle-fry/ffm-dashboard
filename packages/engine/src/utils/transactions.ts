// Transaction formatting utilities for the ops-dashboard transaction feed.
//
// The upstream payment records contain personally identifiable information
// (PII) such as fan/creator names, emails and billing addresses. The dashboard
// must never expose these (Requirement 9.4). These helpers strip PII down to
// the fields we keep and truncate the payment id so only a non-identifying
// suffix is surfaced (Requirement 9.1).

import type { TransactionItem } from '@fans-fund-me/shared';
import { formatMoney } from './formatting.js';

/**
 * A raw payment record as received from the payments provider. It carries PII
 * fields alongside the fields the dashboard retains. Only the non-PII fields
 * are propagated into a {@link TransactionItem} by {@link stripPii}.
 */
export interface RawTransaction {
    /** Full payment id (potentially identifying); truncated before display. */
    id: string;
    /** Monetary amount in the original currency's major units, e.g. 12.34. */
    amount: number;
    /** ISO 4217 currency code, e.g. "GBP", "USD". */
    currency: string;
    /** ISO 8601 timestamp with timezone. */
    timestamp: string;
    // PII fields — never surfaced to the dashboard.
    fanName?: string;
    creatorName?: string;
    email?: string;
    billingAddress?: string;
}

/**
 * Truncate a payment id to a non-identifying suffix: the horizontal ellipsis
 * character (U+2026, "…") followed by the last 4 characters of the id.
 *
 * For ids of length >= 4 the result is "…" + the last 4 characters.
 *
 * For ids shorter than 4 characters there are fewer than 4 trailing characters
 * to keep, so we return "…" + the whole id (String.prototype.slice(-4) yields
 * the entire string when it is shorter than 4). This is a sensible, lossless
 * fallback: short ids are already non-identifying, and callers still get the
 * consistent ellipsis-prefixed shape the UI expects.
 */
export function truncatePaymentId(id: string): string {
    return '\u2026' + id.slice(-4);
}

/**
 * Strip PII from a raw payment record, returning only the fields the dashboard
 * retains: a truncated id suffix, the amount formatted to exactly 2 decimal
 * places in its original currency, the currency code and the timestamp.
 *
 * The returned object never contains any PII field values (Requirement 9.4).
 */
export function stripPii(transaction: RawTransaction): TransactionItem {
    return {
        idSuffix: truncatePaymentId(transaction.id),
        amount: formatMoney(transaction.amount),
        currency: transaction.currency,
        timestamp: transaction.timestamp,
    };
}
