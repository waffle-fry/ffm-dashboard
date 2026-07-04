// Property-based tests for the transaction PII/formatting utilities.
//
// Source under test: ./transactions.ts
//   - truncatePaymentId(id) === '\u2026' + id.slice(-4)   (Requirement 9.1)
//   - stripPii(raw) copies only { idSuffix, amount, currency, timestamp } and
//     never propagates any PII field value                (Requirement 9.4)
//
// The implementation truncates on UTF-16 code units (String.prototype.slice),
// so every oracle here is derived the same way and each property is asserted
// against the implementation's real contract (read from the source), not an
// assumed one.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
    truncatePaymentId,
    stripPii,
    type RawTransaction,
} from './transactions.js';
import { formatMoney } from './formatting.js';

// The exact prefix the source uses: U+2026 HORIZONTAL ELLIPSIS ("…"), a single
// UTF-16 code unit. Confirmed against ./transactions.ts (`'\u2026' + id.slice(-4)`).
const ELLIPSIS = '\u2026';

// ---------------------------------------------------------------------------
// Feature: ops-dashboard, Property 21: Transaction ID truncation
//
// Task 4.13 / Property 21 (Validates Requirements 9.1): for any string of
// length >= 4, truncatePaymentId returns "…" concatenated with the last 4
// characters of the id and contains none of the other (dropped) characters.
// ---------------------------------------------------------------------------

// Payment ids of length >= 4. We mix a plain string generator with a full
// unicode one so surrogate-pair inputs are exercised. Because the source uses
// `slice(-4)` on UTF-16 code units, the oracle below slices the same way, so
// surrogate pairs straddling the 4-code-unit boundary are handled identically
// by both sides (whatever the implementation does, the oracle mirrors it).
const paymentIdArb = fc.oneof(
    fc.string({ minLength: 4 }),
    fc.fullUnicodeString({ minLength: 4 }),
);

describe('truncatePaymentId (Property 21: Transaction ID truncation)', () => {
    it('returns "…" + the last 4 code units and no other original characters', () => {
        fc.assert(
            fc.property(paymentIdArb, (id) => {
                const result = truncatePaymentId(id);

                // Independent oracle: ellipsis + the trailing 4 UTF-16 code units.
                const suffix = id.slice(-4);
                expect(result).toBe(ELLIPSIS + suffix);

                // Shape: single ellipsis prefix, then exactly the last 4 units.
                expect(result.startsWith(ELLIPSIS)).toBe(true);
                expect(result.slice(1)).toBe(suffix);

                // "contains none of the other original characters": every code
                // unit that was dropped (and does not also occur in the kept
                // suffix) must be absent from the surfaced suffix `body`. We
                // check against `body` (result without our added ellipsis) so a
                // literal U+2026 inside the original id cannot be confused with
                // the prefix we prepend.
                const body = result.slice(1);
                const dropped = id.slice(0, -4);
                const suffixUnits = new Set<string>();
                for (let i = 0; i < suffix.length; i += 1) {
                    suffixUnits.add(suffix[i]);
                }
                for (let i = 0; i < dropped.length; i += 1) {
                    const unit = dropped[i];
                    if (!suffixUnits.has(unit)) {
                        expect(body.includes(unit)).toBe(false);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });

    // Documents the real fallback behaviour for ids shorter than 4 characters.
    // The property statement only constrains length >= 4, but confirming the
    // sub-4 contract guards against silent changes: slice(-4) returns the whole
    // string, so the result is "…" + the entire id.
    it('for ids shorter than 4 characters returns "…" + the whole id (documented fallback)', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 3 }), (id) => {
                expect(truncatePaymentId(id)).toBe(ELLIPSIS + id);
            }),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Feature: ops-dashboard, Property 23: No PII in transaction output
//
// Task 4.14 / Property 23 (Validates Requirements 9.4): for any payment record
// carrying PII fields (fan name, creator name, email, billing address, and the
// full payment id) alongside the safe fields, stripPii produces a
// TransactionItem containing only the truncated id, formatted amount, currency
// and timestamp — and none of the PII field values appear anywhere in the
// output.
// ---------------------------------------------------------------------------

// Safe-field alphabets are deliberately restricted to uppercase letters, digits
// and ISO-8601 punctuation so the entire produced output (values + JSON keys +
// JSON punctuation) contains no lowercase ASCII letters and no SENTINEL char.
const UPPER_ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Full payment id: >= 5 code units so the full id is never surfaced (only its
// last 4 code units appear, prefixed by the ellipsis). Uppercase/digits only.
const paymentIdSafeArb = fc
    .array(fc.constantFrom(...UPPER_ALNUM), { minLength: 5, maxLength: 40 })
    .map((chars) => chars.join(''));

const currencyArb = fc.constantFrom(
    'GBP',
    'USD',
    'EUR',
    'JPY',
    'AUD',
    'CAD',
    'NZD',
    'CHF',
);

// ISO 8601 timestamps with timezone (…T…Z): digits + 'T'/'Z'/'-'/':'/'.', all
// uppercase/punctuation, no lowercase letters.
const timestampArb = fc
    .date({
        min: new Date('2000-01-01T00:00:00.000Z'),
        max: new Date('2100-01-01T00:00:00.000Z'),
    })
    .map((d) => d.toISOString());

const amountArb = fc.double({
    min: 0,
    max: 1_000_000_000,
    noNaN: true,
    noDefaultInfinity: true,
});

// A char guaranteed to be absent from the output alphabet (uppercase letters,
// digits, ISO punctuation, the ellipsis, and the JSON key/punctuation set).
// Prepending it to every PII value guarantees the *whole* PII value can never
// be a substring of the serialized output, so the substring oracle can never
// yield a false positive from a coincidental collision with a safe field value
// or a JSON key. The rest of each PII value is drawn from the full unicode
// range to keep the values realistic and varied, and every value is non-empty.
const SENTINEL = '\u2603'; // ☃ SNOWMAN
const piiValueArb = fc.fullUnicodeString().map((s) => SENTINEL + s);

const rawTransactionArb = fc.record({
    id: paymentIdSafeArb,
    amount: amountArb,
    currency: currencyArb,
    timestamp: timestampArb,
    fanName: piiValueArb,
    creatorName: piiValueArb,
    email: piiValueArb,
    billingAddress: piiValueArb,
});

describe('stripPii (Property 23: No PII in transaction output)', () => {
    it('keeps only the four safe fields and leaks no PII value', () => {
        fc.assert(
            fc.property(rawTransactionArb, (raw: RawTransaction) => {
                const output = stripPii(raw);

                // Only the four safe fields exist on the output.
                expect(Object.keys(output).sort()).toEqual([
                    'amount',
                    'currency',
                    'idSuffix',
                    'timestamp',
                ]);

                // Each safe field matches its independently-derived value.
                expect(output.idSuffix).toBe(truncatePaymentId(raw.id));
                expect(output.amount).toBe(formatMoney(raw.amount));
                expect(output.currency).toBe(raw.currency);
                expect(output.timestamp).toBe(raw.timestamp);

                const serialized = JSON.stringify(output);

                // The full (untruncated) payment id must not survive: only its
                // last 4 code units appear, prefixed by the ellipsis.
                expect(serialized.includes(raw.id)).toBe(false);

                // No PII field value appears anywhere in the output — neither as
                // a substring of the serialized form nor equal to any field.
                // RawTransaction types the PII fields as optional, so narrow to
                // the defined string values (the generator always supplies them).
                const piiValues: string[] = [
                    raw.fanName,
                    raw.creatorName,
                    raw.email,
                    raw.billingAddress,
                ].filter((v): v is string => typeof v === 'string');
                const outputFieldValues = [
                    output.idSuffix,
                    output.amount,
                    output.currency,
                    output.timestamp,
                ];
                for (const pii of piiValues) {
                    // Non-empty, so the substring check is meaningful.
                    expect(pii.length).toBeGreaterThan(0);
                    expect(serialized.includes(pii)).toBe(false);
                    for (const fieldValue of outputFieldValues) {
                        expect(fieldValue).not.toBe(pii);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });
});
