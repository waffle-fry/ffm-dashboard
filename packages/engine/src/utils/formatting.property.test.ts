// Property-based tests for monetary and percentage formatting utilities.
//
// Feature: ops-dashboard, Property 4: Monetary value formatting
//
// Task 4.2 / Property 4 (Validates Requirements 3.1, 6.3, 9.1, 10.1, 10.3):
// for any numeric value (including zero, fractional pennies, and large values),
// formatMoney SHALL return a string with exactly two decimal places matching
// `/^\d+\.\d{2}$/` — an integer part, a dot, then exactly two fractional digits,
// with no scientific notation, no thousands separators, and no leading currency
// symbol.
//
// Contract note on negatives: the source (formatting.ts) documents the
// `/^\d+\.\d{2}$/` guarantee for NON-NEGATIVE, finite input only. It delegates
// to Intl.NumberFormat, which renders a negative value with a leading '-'
// (e.g. "-45.10") that would not match that pattern. Every caller of formatMoney
// in this engine feeds it non-negative monetary/percentage magnitudes (totals,
// volumes, rates), so the generators below are deliberately constrained to
// non-negative finite values to assert the ACTUAL documented contract. Non-finite
// input (NaN/Infinity) has its own coercion contract ("0.00") verified in the
// unit tests (formatting.test.ts) and is therefore excluded from these
// generators.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatMoney, formatPercentage } from './formatting.js';

const MONEY_PATTERN = /^\d+\.\d{2}$/;
const PERCENTAGE_PATTERN = /^\d+\.\d{2}%$/;

// Explicit edge cases called out by Property 4. These are drawn alongside the
// random generators so every run reliably exercises them.
//   - zero
//   - fractional pennies that straddle rounding boundaries (round half away
//     from zero): 0.005 -> "0.01", 0.994 -> "0.99", 0.995 -> "1.00"
//   - large values, including magnitudes >= 1e21 where Number.prototype.toFixed
//     would switch to scientific notation (the reason the source uses Intl)
const edgeCaseArb = fc.constantFrom(
    0,
    0.001,
    0.004,
    0.005,
    0.006,
    0.994,
    0.995,
    0.999,
    1.005,
    45.124,
    45.125,
    45.126,
    1234.5,
    1234567.89,
    1e12,
    1e15,
    1e21,
    999999999999.994,
    999999999999.995,
);

// Fractional pennies in [0, 1): stresses the two-decimal rounding logic.
const fractionalPennyArb = fc.double({
    min: 0,
    max: 1,
    noNaN: true,
    noDefaultInfinity: true,
});

// "Ordinary" monetary magnitudes up to ~1e13.
const ordinaryArb = fc.double({
    min: 0,
    max: 1e13,
    noNaN: true,
    noDefaultInfinity: true,
});

// Large lifetime-volume magnitudes up to ~1e21 (past the point where toFixed
// would emit scientific notation).
const largeArb = fc.double({
    min: 1e12,
    max: 1e21,
    noNaN: true,
    noDefaultInfinity: true,
});

// The full non-negative, finite input space for Property 4.
const moneyValueArb = fc.oneof(
    edgeCaseArb,
    fractionalPennyArb,
    ordinaryArb,
    largeArb,
);

describe('formatMoney (Property 4: Monetary value formatting)', () => {
    it('always renders exactly two decimal places matching /^\\d+\\.\\d{2}$/', () => {
        fc.assert(
            fc.property(moneyValueArb, (value) => {
                const result = formatMoney(value);

                // Core requirement: exact 2-decimal-place format.
                expect(result).toMatch(MONEY_PATTERN);
                // No scientific notation and no thousands separators.
                expect(result).not.toContain('e');
                expect(result).not.toContain('E');
                expect(result).not.toContain(',');
                // No leading currency symbol (the pattern already implies this,
                // but assert explicitly against the most common one).
                expect(result.startsWith('$')).toBe(false);
            }),
            { numRuns: 300 },
        );
    });

    it('rounds to a value within a penny (plus magnitude slack) of the input', () => {
        fc.assert(
            fc.property(moneyValueArb, (value) => {
                const parsed = Number.parseFloat(formatMoney(value));

                // Oracle: the rendered value is the input rounded to 2dp, so it
                // must lie within half a penny. For very large doubles the
                // representable spacing (ULP) exceeds a penny, so add slack
                // proportional to magnitude to stay above floating-point noise.
                const tolerance = 0.005 + Math.abs(value) * 1e-9;
                expect(Math.abs(parsed - value)).toBeLessThanOrEqual(tolerance);
            }),
            { numRuns: 300 },
        );
    });
});

describe('formatPercentage (Property 4: percentage variant)', () => {
    it('always renders two decimals with a trailing % matching /^\\d+\\.\\d{2}%$/', () => {
        fc.assert(
            fc.property(moneyValueArb, (value) => {
                const result = formatPercentage(value);

                expect(result).toMatch(PERCENTAGE_PATTERN);
                expect(result).not.toContain('e');
                expect(result).not.toContain(',');
                // The numeric portion (everything before the trailing '%') must
                // itself satisfy the money contract.
                expect(result.slice(0, -1)).toMatch(MONEY_PATTERN);
            }),
            { numRuns: 100 },
        );
    });
});
