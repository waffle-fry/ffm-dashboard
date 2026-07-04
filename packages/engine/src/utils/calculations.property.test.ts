// Property-based tests for the average and rate calculation utilities.
//
// Covers three properties for the ops-dashboard engine's calculation helpers:
//   - Feature: ops-dashboard, Property 7  (task 4.9)  -> calculateAverage
//   - Feature: ops-dashboard, Property 24 (task 4.10) -> calculateTakeRate
//   - Feature: ops-dashboard, Property 25 (task 4.11) -> calculateDisputeRate
//
// Each property asserts the documented contract from calculations.ts:
//   * a numeric portion matching /^\d+\.\d{2}$/ (rounded to exactly 2 dp), and
//   * the division-by-zero sentinel (null for average/take rate, "0.00%" for
//     dispute rate).
//
// Rounding correctness is checked with a numeric-tolerance oracle rather than by
// re-deriving the rounded string. formatMoney rounds half away from zero, so a
// correctly rounded result must sit within half a cent of the true ratio
// (plus a small floating-point slack that scales with magnitude). This validates
// "rounded to 2 decimal places" without depending on the exact half-rounding
// implementation.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    calculateAverage,
    calculateTakeRate,
    calculateDisputeRate,
} from './calculations.js';

// The numeric contract shared by every result: integer part, dot, exactly two
// fractional digits. Never scientific notation, never thousands separators.
const TWO_DP_PATTERN = /^\d+\.\d{2}$/;

// Non-negative money-like value. fc.oneof biases coverage toward the required
// edge cases: exactly zero, small fractional values, and large values — while
// excluding NaN/Infinity (the callers below never produce non-finite ratios).
const nonNegativeMoneyArb = fc.oneof(
    fc.constant(0),
    fc.constant(0.005), // a rounding half-boundary
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true }),
);

// Non-negative integer counts (payment / dispute counts), including zero.
const nonNegativeCountArb = fc.nat({ max: 5_000_000 });

// Strictly positive integer counts (the denominator > 0 branch).
const positiveCountArb = fc.integer({ min: 1, max: 5_000_000 });

// Strictly positive money-like denominator (the volume > 0 branch). Floored at
// one cent so the ratio stays finite and the test exercises a meaningful,
// realistic monetary range while still including fractional and large values.
const positiveVolumeArb = fc.oneof(
    fc.constant(0.01),
    fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 1, max: 1e9, noNaN: true, noDefaultInfinity: true }),
);

// Half-a-cent plus a magnitude-scaled floating-point slack. A value rounded to
// two decimals (round half away from zero) can differ from the true ratio by at
// most 0.005; the extra term absorbs binary64 representation error at scale.
function roundingTolerance(value: number): number {
    return 0.005 + Math.abs(value) * 1e-9;
}

// Feature: ops-dashboard, Property 7 (task 4.9): Average payment amount.
// Validates Requirements 3.3.
//
// For any non-negative gross and count: calculateAverage returns gross / count
// rounded to 2 decimal places (matching /^\d+\.\d{2}$/) when count > 0, and null
// when count === 0.
describe('calculateAverage (Feature: ops-dashboard, Property 7)', () => {
    it('returns gross / count rounded to 2dp when count > 0', () => {
        fc.assert(
            fc.property(
                nonNegativeMoneyArb,
                positiveCountArb,
                (gross, count) => {
                    const result = calculateAverage(gross, count);

                    expect(result).not.toBeNull();
                    expect(result as string).toMatch(TWO_DP_PATTERN);

                    const expected = gross / count;
                    expect(
                        Math.abs(parseFloat(result as string) - expected),
                    ).toBeLessThanOrEqual(roundingTolerance(expected));
                },
            ),
            { numRuns: 200 },
        );
    });

    it('returns null when count === 0', () => {
        fc.assert(
            fc.property(nonNegativeMoneyArb, (gross) => {
                expect(calculateAverage(gross, 0)).toBeNull();
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: ops-dashboard, Property 24 (task 4.10): Platform take rate.
// Validates Requirements 10.2.
//
// For any non-negative fees and volume: calculateTakeRate returns
// (fees / volume) * 100 rounded to 2dp (numeric portion, no trailing %) when
// volume > 0, and null when volume === 0.
describe('calculateTakeRate (Feature: ops-dashboard, Property 24)', () => {
    it('returns (fees / volume) * 100 rounded to 2dp when volume > 0', () => {
        fc.assert(
            fc.property(
                nonNegativeMoneyArb,
                positiveVolumeArb,
                (fees, volume) => {
                    const result = calculateTakeRate(fees, volume);

                    expect(result).not.toBeNull();
                    // No trailing '%' for the take rate (unlike the dispute rate).
                    expect(result as string).toMatch(TWO_DP_PATTERN);

                    const expected = (fees / volume) * 100;
                    expect(
                        Math.abs(parseFloat(result as string) - expected),
                    ).toBeLessThanOrEqual(roundingTolerance(expected));
                },
            ),
            { numRuns: 200 },
        );
    });

    it('returns null when volume === 0', () => {
        fc.assert(
            fc.property(nonNegativeMoneyArb, (fees) => {
                expect(calculateTakeRate(fees, 0)).toBeNull();
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: ops-dashboard, Property 25 (task 4.11): Monthly dispute rate.
// Validates Requirements 10.3.
//
// For any non-negative disputes and payments: calculateDisputeRate returns
// (disputes / payments) * 100 rounded to 2dp with a trailing '%' when
// payments > 0, and exactly "0.00%" when payments === 0.
describe('calculateDisputeRate (Feature: ops-dashboard, Property 25)', () => {
    it('returns (disputes / payments) * 100 rounded to 2dp with a trailing % when payments > 0', () => {
        fc.assert(
            fc.property(
                nonNegativeCountArb,
                positiveCountArb,
                (disputes, payments) => {
                    const result = calculateDisputeRate(disputes, payments);

                    // Contract: percentage string ending in '%'.
                    expect(result.endsWith('%')).toBe(true);

                    const numericPortion = result.slice(0, -1);
                    expect(numericPortion).toMatch(TWO_DP_PATTERN);

                    const expected = (disputes / payments) * 100;
                    expect(
                        Math.abs(parseFloat(numericPortion) - expected),
                    ).toBeLessThanOrEqual(roundingTolerance(expected));
                },
            ),
            { numRuns: 200 },
        );
    });

    it('returns "0.00%" when payments === 0', () => {
        fc.assert(
            fc.property(nonNegativeCountArb, (disputes) => {
                expect(calculateDisputeRate(disputes, 0)).toBe('0.00%');
            }),
            { numRuns: 100 },
        );
    });
});
