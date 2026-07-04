// Monetary and percentage formatting utilities.
//
// The dashboard represents every monetary and percentage value as a string with
// exactly two decimal places (Requirements 3.1, 6.3, 9.1, 10.1, 10.2, 10.3).
// Using strings avoids floating-point display artifacts (e.g. "45.1" instead of
// "45.10") and gives the UI a stable, ready-to-render value.
//
// Formatting guarantees for non-negative input:
//   - Output always matches the pattern /^\d+\.\d{2}$/ (integer part, a dot,
//     then exactly two fractional digits).
//   - Values are rounded to 2 decimal places (round half away from zero).
//   - Large values are rendered in full decimal notation: never scientific
//     notation (e.g. "1e+21") and never with thousands separators (e.g. no
//     "1,234.56").
//
// We use Intl.NumberFormat rather than Number.prototype.toFixed because toFixed
// switches to exponential notation for magnitudes >= 1e21, which would break the
// /^\d+\.\d{2}$/ contract for large lifetime-volume figures. Intl renders those
// values in full and uses round-half-away-from-zero ("halfExpand") by default.

/**
 * Shared formatter: exactly two fraction digits, no grouping separators.
 *
 * Reused across calls to avoid reconstructing the (relatively expensive)
 * Intl.NumberFormat instance on every invocation.
 */
const TWO_DP_FORMATTER = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
});

/**
 * Formats a numeric monetary value as a fixed 2-decimal string.
 *
 * For any non-negative, finite `value` the result matches `/^\d+\.\d{2}$/`.
 * Examples: `0 -> "0.00"`, `1234.5 -> "1234.50"`, `45.126 -> "45.13"`.
 *
 * Non-finite input (NaN, Infinity) is coerced to `"0.00"` so callers always
 * receive a renderable value rather than a literal "NaN"/"Infinity" string.
 */
export function formatMoney(value: number): string {
    if (!Number.isFinite(value)) {
        return '0.00';
    }
    return TWO_DP_FORMATTER.format(value);
}

/**
 * Formats a numeric percentage value as a fixed 2-decimal string with a
 * trailing `%`.
 *
 * Examples: `0 -> "0.00%"`, `15.5 -> "15.50%"`, `0.153 -> "0.15%"`.
 * The numeric portion follows the same rules as {@link formatMoney}.
 */
export function formatPercentage(value: number): string {
    return `${formatMoney(value)}%`;
}
