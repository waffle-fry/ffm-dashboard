// Property-based tests for the platform-balance helpers (Requirement 11).
//
// Feature: ops-dashboard
//   Property 26: Currency conversion
//   Property 27: Total platform balance summation

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { convertViaRates, sumUsdBalances } from './balances.js';

/** Rounds to 2dp the same way the helpers do, for the test oracle. */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

const CURRENCIES = ['USD', 'GBP', 'EUR', 'JPY', 'AUD', 'CAD'] as const;

// A rates map keyed by uppercase ISO code -> positive units-per-USD rate.
const ratesArb: fc.Arbitrary<Map<string, number>> = fc
    .dictionary(
        fc.constantFrom(...CURRENCIES),
        fc.double({ min: 0.0001, max: 1000, noNaN: true, noDefaultInfinity: true }),
    )
    .map((obj) => {
        const map = new Map<string, number>();
        for (const [code, rate] of Object.entries(obj)) {
            map.set(code.toUpperCase(), rate);
        }
        map.set('USD', 1); // USD is always the base.
        return map;
    });

const amountArb = fc.double({
    min: 0,
    max: 1_000_000,
    noNaN: true,
    noDefaultInfinity: true,
});

describe('Feature: ops-dashboard, Property 26: Currency conversion', () => {
    it('is an identity (2dp) when source and target currencies are equal', () => {
        fc.assert(
            fc.property(amountArb, fc.constantFrom(...CURRENCIES), ratesArb, (amount, code, rates) => {
                // Same currency needs no rate at all.
                expect(convertViaRates(amount, code, code, rates)).toBe(round2(amount));
                // Case-insensitive: lower/upper are the same currency.
                expect(convertViaRates(amount, code.toLowerCase(), code, rates)).toBe(
                    round2(amount),
                );
            }),
            { numRuns: 100 },
        );
    });

    it('returns amount × (toRate / fromRate) rounded to 2dp when both rates exist', () => {
        fc.assert(
            fc.property(
                amountArb,
                fc.constantFrom(...CURRENCIES),
                fc.constantFrom(...CURRENCIES),
                ratesArb,
                (amount, from, to, rates) => {
                    const result = convertViaRates(amount, from, to, rates);
                    const fromRate = rates.get(from);
                    const toRate = rates.get(to);
                    if (from.toUpperCase() === to.toUpperCase()) {
                        expect(result).toBe(round2(amount));
                    } else if (
                        fromRate !== undefined &&
                        toRate !== undefined &&
                        fromRate !== 0
                    ) {
                        expect(result).toBe(round2(amount * (toRate / fromRate)));
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    it('returns null when a required rate is missing', () => {
        const rates = new Map<string, number>([['USD', 1]]);
        // GBP is absent from the table.
        expect(convertViaRates(100, 'GBP', 'USD', rates)).toBeNull();
        expect(convertViaRates(100, 'USD', 'GBP', rates)).toBeNull();
    });
});

describe('Feature: ops-dashboard, Property 27: Total platform balance summation', () => {
    it('sums exactly the available balances, rounded to 2dp', () => {
        fc.assert(
            fc.property(
                fc.array(fc.oneof(amountArb, fc.constant(null)), { maxLength: 6 }),
                (parts) => {
                    const present = parts.filter((p): p is number => p !== null);
                    const result = sumUsdBalances(parts);
                    if (present.length === 0) {
                        expect(result).toBeNull();
                    } else {
                        expect(result).toBe(
                            round2(present.reduce((a, b) => a + b, 0)),
                        );
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    it('is null when no balance is available', () => {
        expect(sumUsdBalances([])).toBeNull();
        expect(sumUsdBalances([null, null])).toBeNull();
    });

    it('equals the single available balance when only one source is present', () => {
        expect(sumUsdBalances([761.44, null])).toBe(761.44);
        expect(sumUsdBalances([null, 12000])).toBe(12000);
    });
});
