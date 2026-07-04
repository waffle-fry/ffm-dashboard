// Pure, DOM-free presentation logic for the Recent Transactions feed widget
// (Requirement 9).
//
// The transaction feed displays a scrollable list of the most recent successful
// payments. The engine has already done the safety-sensitive work:
//   - Requirement 9.1: truncated the payment ID to "…XXXX" (last 4 chars), and
//     formatted the amount to two decimal places in its original currency;
//   - Requirement 9.2: sorted the list most-recent-first and limited it to 20;
//   - Requirement 9.4: stripped all PII — TransactionItem only carries the
//     truncated id suffix, amount, currency and timestamp.
//
// So this module is purely presentational: it maps each already-safe
// TransactionItem to a display row, deriving nothing new and, critically,
// surfacing only the four safe fields. Keeping the mapping here (rather than in
// the .tsx) lets it be unit- and property-tested without React or a DOM,
// mirroring the pattern used by the other widgets' helpers.

import type { TransactionItem } from '@fans-fund-me/shared';

/**
 * The maximum number of transactions the feed renders (Requirement 9.2). The
 * engine already limits its payload to 20, but the widget defends the cap so a
 * larger payload can never blow out the list.
 */
export const MAX_TRANSACTIONS = 20;

/** A single transaction formatted for display. */
export interface TransactionRow {
    /** Stable key for React — the already-truncated id suffix ("…XXXX"). */
    key: string;
    /** Truncated transaction identifier, e.g. "…4242" (Requirement 9.1). */
    idSuffix: string;
    /** Amount with its currency, e.g. "12.34 USD" (Requirement 9.1). */
    amount: string;
    /** ISO 8601 timestamp with timezone (machine-readable; rendered relative). */
    timestamp: string;
}

/**
 * Format a single transaction's amount and currency for display. The amount is
 * already a 2dp string from the engine and is shown verbatim (never re-rounded)
 * followed by the ISO 4217 currency code, e.g. "12.34 USD".
 */
export function formatTransactionAmount(
    amount: TransactionItem['amount'],
    currency: TransactionItem['currency'],
): string {
    return `${amount} ${currency}`;
}

/**
 * Map a single already-safe TransactionItem to its display row, surfacing only
 * the four PII-free fields (Requirement 9.4). Indexed by position so rows with
 * an identical id suffix still get distinct React keys.
 */
function toRow(item: TransactionItem, index: number): TransactionRow {
    return {
        key: `${index}:${item.idSuffix}`,
        idSuffix: item.idSuffix,
        amount: formatTransactionAmount(item.amount, item.currency),
        timestamp: item.timestamp,
    };
}

/**
 * Build the display rows for the transaction feed.
 *
 * The engine already sorts the transactions most-recent-first and limits them
 * to 20, so the order is preserved as given (Requirement 9.2); this helper only
 * defends the {@link MAX_TRANSACTIONS} cap and maps each item to a PII-free row.
 */
export function buildTransactionRows(
    transactions: readonly TransactionItem[],
): TransactionRow[] {
    return transactions.slice(0, MAX_TRANSACTIONS).map(toRow);
}
