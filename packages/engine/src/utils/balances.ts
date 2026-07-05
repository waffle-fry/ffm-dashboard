// Pure helpers for the platform account balances (Requirement 11).
//
// These are DOM-free and side-effect-free so they can be unit- and
// property-tested directly (design Properties 26 & 27). The Mongo-backed
// exchange-rate lookup and the Stripe/Mercury reads live in the adapters
// (source-clients.ts); this module only does the arithmetic once the rates and
// amounts are in hand.

/**
 * The `Payments.ExchangeRates` collection stores, per ISO 4217 currency code,
 * the number of units of that currency per 1 USD (USD itself is 1). So to
 * convert `amount` from currency `from` to currency `to`:
 *
 *   amount_to = amount_from × rate[to] / rate[from]
 *
 * (Converting to USD divides by rate[from] since rate[USD] = 1; converting USD
 * to another currency multiplies by rate[to].)
 *
 * Returns the converted amount rounded to 2 decimal places, or `null` when a
 * required rate is missing (or the source rate is zero) so callers can mark the
 * figure unavailable rather than fabricate one. A same-currency conversion is
 * an identity (rounded to 2dp) and never needs a rate.
 *
 * Rates are matched case-insensitively (Stripe reports lowercase currency
 * codes, the collection uses uppercase).
 */
export function convertViaRates(
    amount: number,
    from: string,
    to: string,
    rates: ReadonlyMap<string, number>,
): number | null {
    const fromCode = from.toUpperCase();
    const toCode = to.toUpperCase();
    if (fromCode === toCode) {
        return round2(amount);
    }
    const fromRate = rates.get(fromCode);
    const toRate = rates.get(toCode);
    if (fromRate === undefined || toRate === undefined || fromRate === 0) {
        return null;
    }
    return round2(amount * (toRate / fromRate));
}

/**
 * Sums the available account balances, in USD, ignoring any that are
 * unavailable (`null`). Returns the total rounded to 2 decimal places, or
 * `null` when none of the balances are available — so the UI shows the total as
 * unavailable rather than as a misleading $0.00 (Requirement 11.9).
 */
export function sumUsdBalances(parts: readonly (number | null)[]): number | null {
    const present = parts.filter((part): part is number => part !== null);
    if (present.length === 0) {
        return null;
    }
    return round2(present.reduce((sum, part) => sum + part, 0));
}

/** Rounds to 2 decimal places (half-up on the scaled integer). */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
