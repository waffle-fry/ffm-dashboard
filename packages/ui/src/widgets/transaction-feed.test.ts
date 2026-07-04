import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { TransactionItem } from '@fans-fund-me/shared';
import {
    buildTransactionRows,
    formatTransactionAmount,
    MAX_TRANSACTIONS,
} from './transaction-feed';

/** A fast-check arbitrary for an already-safe TransactionItem. */
const transactionItemArb: fc.Arbitrary<TransactionItem> = fc.record({
    idSuffix: fc
        .string({ minLength: 4, maxLength: 4 })
        .map((s) => `…${s}`),
    amount: fc
        .float({ min: 0, max: 1_000_000, noNaN: true })
        .map((n) => n.toFixed(2)),
    currency: fc.constantFrom('GBP', 'USD', 'EUR', 'JPY', 'AUD'),
    timestamp: fc
        .date({
            min: new Date('2000-01-01T00:00:00Z'),
            max: new Date('2100-01-01T00:00:00Z'),
        })
        .map((d) => d.toISOString()),
});

describe('formatTransactionAmount', () => {
    it('renders the 2dp amount followed by the ISO 4217 currency (Req 9.1)', () => {
        expect(formatTransactionAmount('12.34', 'USD')).toBe('12.34 USD');
        expect(formatTransactionAmount('0.00', 'GBP')).toBe('0.00 GBP');
        expect(formatTransactionAmount('1000000.00', 'EUR')).toBe(
            '1000000.00 EUR',
        );
    });

    it('shows the amount verbatim without re-rounding', () => {
        // The engine already formats to 2dp; the widget must not alter it.
        expect(formatTransactionAmount('45.5', 'USD')).toBe('45.5 USD');
    });
});

describe('buildTransactionRows', () => {
    it('returns an empty list for no transactions', () => {
        expect(buildTransactionRows([])).toEqual([]);
    });

    it('maps each item to id suffix, amount+currency and timestamp (Req 9.1)', () => {
        const items: TransactionItem[] = [
            {
                idSuffix: '…4242',
                amount: '12.34',
                currency: 'USD',
                timestamp: '2024-01-02T03:04:05.000Z',
            },
        ];
        const rows = buildTransactionRows(items);
        expect(rows).toHaveLength(1);
        expect(rows[0].idSuffix).toBe('…4242');
        expect(rows[0].amount).toBe('12.34 USD');
        expect(rows[0].timestamp).toBe('2024-01-02T03:04:05.000Z');
    });

    it('preserves the engine-provided (most-recent-first) order (Req 9.2)', () => {
        const items: TransactionItem[] = [
            {
                idSuffix: '…0001',
                amount: '1.00',
                currency: 'GBP',
                timestamp: '2024-03-03T00:00:00.000Z',
            },
            {
                idSuffix: '…0002',
                amount: '2.00',
                currency: 'GBP',
                timestamp: '2024-02-02T00:00:00.000Z',
            },
            {
                idSuffix: '…0003',
                amount: '3.00',
                currency: 'GBP',
                timestamp: '2024-01-01T00:00:00.000Z',
            },
        ];
        const rows = buildTransactionRows(items);
        expect(rows.map((r) => r.idSuffix)).toEqual([
            '…0001',
            '…0002',
            '…0003',
        ]);
    });

    it('assigns distinct keys even when id suffixes collide', () => {
        const items: TransactionItem[] = [
            {
                idSuffix: '…4242',
                amount: '1.00',
                currency: 'GBP',
                timestamp: '2024-01-02T00:00:00.000Z',
            },
            {
                idSuffix: '…4242',
                amount: '2.00',
                currency: 'GBP',
                timestamp: '2024-01-01T00:00:00.000Z',
            },
        ];
        const rows = buildTransactionRows(items);
        expect(rows[0].key).not.toBe(rows[1].key);
    });

    // Validates: Requirements 9.2 (limit to 20, preserve order)
    it('caps the list at 20 items in the given order', () => {
        fc.assert(
            fc.property(
                fc.array(transactionItemArb, { minLength: 0, maxLength: 60 }),
                (items) => {
                    const rows = buildTransactionRows(items);
                    // Never renders more than 20 (Req 9.2).
                    expect(rows.length).toBeLessThanOrEqual(MAX_TRANSACTIONS);
                    expect(rows.length).toBe(
                        Math.min(items.length, MAX_TRANSACTIONS),
                    );
                    // Order preserved and content faithfully mapped.
                    rows.forEach((row, i) => {
                        expect(row.idSuffix).toBe(items[i].idSuffix);
                        expect(row.amount).toBe(
                            `${items[i].amount} ${items[i].currency}`,
                        );
                        expect(row.timestamp).toBe(items[i].timestamp);
                    });
                },
            ),
        );
    });

    // Validates: Requirement 9.4 (no PII surfaced)
    it('surfaces only the four PII-free fields for every item', () => {
        fc.assert(
            fc.property(
                fc.array(transactionItemArb, { minLength: 0, maxLength: 25 }),
                (items) => {
                    const rows = buildTransactionRows(items);
                    rows.forEach((row) => {
                        // A row only ever exposes these keys — nothing else can
                        // leak through even if an item carried extra fields.
                        expect(Object.keys(row).sort()).toEqual(
                            ['amount', 'idSuffix', 'key', 'timestamp'].sort(),
                        );
                    });
                },
            ),
        );
    });
});
