// Currency presentation helpers.
//
// The platform's business/settlement currency is USD, so every monetary figure
// the engine emits (revenue, fees, dispute amounts, gross volume, average
// payment) is a USD major-unit amount already formatted to 2dp. The UI adds the
// currency symbol here, in one place, so the symbol/code never drift between
// widgets.
//
// Note: this is the DASHBOARD currency for the platform's own aggregate figures.
// The per-transaction feed shows each charge's own ISO 4217 currency code
// verbatim (a charge can be in any currency), so it does not use this helper.

/** The platform's business currency symbol. */
export const CURRENCY_SYMBOL = '$';

/** The platform's business currency ISO 4217 code. */
export const CURRENCY_CODE = 'USD';

/**
 * Prefix an already-formatted 2dp amount string (e.g. "1234.56") with the
 * business currency symbol. The value is shown verbatim — never re-rounded or
 * re-parsed.
 */
export function formatCurrency(value: string): string {
    return `${CURRENCY_SYMBOL}${value}`;
}
