// Average and rate calculation utilities.
//
// These helpers derive the "computed" numbers shown across the revenue and
// platform-summary widgets: average payment amount, monthly take rate, and
// monthly dispute rate (Requirements 3.3, 10.2, 10.3).
//
// Every result is a string with exactly two decimal places to match the rest of
// the dashboard's value contract and avoid floating-point display artifacts.
// Formatting is delegated to `formatMoney`/`formatPercentage` in ./formatting,
// which round to 2dp (round half away from zero) and render large magnitudes in
// full decimal notation rather than scientific notation.
//
// Division-by-zero handling differs per requirement and is deliberate:
//   - calculateAverage   -> null      when count is 0   (UI renders "N/A")
//   - calculateTakeRate  -> null      when volume is 0  (UI renders "N/A")
//   - calculateDisputeRate -> "0.00%" when payments is 0 (a rate of zero)

import { formatMoney, formatPercentage } from './formatting.js';

/**
 * Calculates the average payment amount for a period.
 *
 * Returns `gross / count` formatted to exactly two decimal places (matching
 * `/^\d+\.\d{2}$/`) when `count > 0`. Returns `null` when `count` is 0 so the
 * UI can display "N/A" for periods with no successful payments (Requirement 3.3).
 */
export function calculateAverage(gross: number, count: number): string | null {
    if (count <= 0) {
        return null;
    }
    return formatMoney(gross / count);
}

/**
 * Calculates the platform take rate as a percentage.
 *
 * Returns `(fees / volume) * 100` formatted to exactly two decimal places
 * (without a trailing `%`) when `volume > 0`. Returns `null` when `volume` is 0
 * so the UI can display "N/A" (Requirement 10.2).
 */
export function calculateTakeRate(fees: number, volume: number): string | null {
    if (volume <= 0) {
        return null;
    }
    return formatMoney((fees / volume) * 100);
}

/**
 * Calculates the dispute rate as a percentage string.
 *
 * Returns `(disputes / payments) * 100` formatted to exactly two decimal places
 * with a trailing `%` (e.g. "0.15%") when `payments > 0`. Returns "0.00%" when
 * `payments` is 0 (Requirement 10.3).
 */
export function calculateDisputeRate(disputes: number, payments: number): string {
    if (payments <= 0) {
        return '0.00%';
    }
    return formatPercentage((disputes / payments) * 100);
}
