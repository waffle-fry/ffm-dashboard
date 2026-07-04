import { describe, it, expect } from 'vitest';
import type { RevenueMetrics, PeriodMetrics } from '@fans-fund-me/shared';
import { formatUsd, buildRevenueRows } from './RevenueWidget';

function period(overrides: Partial<PeriodMetrics> = {}): PeriodMetrics {
    return {
        grossRevenue: '0.00',
        netRevenue: '0.00',
        totalFees: '0.00',
        successfulPayments: 0,
        failedPayments: 0,
        refunds: 0,
        averagePayment: null,
        ...overrides,
    };
}

function metrics(): RevenueMetrics {
    return {
        periods: {
            day: period({
                grossRevenue: '10.00',
                netRevenue: '9.00',
                totalFees: '1.00',
            }),
            week: period({
                grossRevenue: '250.50',
                netRevenue: '240.25',
                totalFees: '10.25',
            }),
            month: period({
                grossRevenue: '1234.56',
                netRevenue: '1180.00',
                totalFees: '54.56',
            }),
        },
        lastRefreshed: '2024-01-01T00:00:00.000Z',
    };
}

describe('formatGbp', () => {
    it('prefixes the backend-formatted amount with a dollar sign', () => {
        expect(formatUsd('1234.56')).toBe('$1234.56');
        expect(formatUsd('0.00')).toBe('$0.00');
    });

    it('displays the value verbatim without re-rounding', () => {
        // Even a value with unexpected precision is passed through untouched;
        // rounding is the backend's responsibility.
        expect(formatUsd('9.999')).toBe('$9.999');
    });
});

describe('buildRevenueRows', () => {
    it('produces day/week/month rows in order with $-prefixed values', () => {
        const rows = buildRevenueRows(metrics());
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.label)).toEqual([
            'Today',
            'This Week',
            'This Month',
        ]);
        expect(rows[0]).toEqual({
            label: 'Today',
            gross: '$10.00',
            net: '$9.00',
            fees: '$1.00',
        });
        expect(rows[2]).toEqual({
            label: 'This Month',
            gross: '$1234.56',
            net: '$1180.00',
            fees: '$54.56',
        });
    });

    it('renders zero-valued periods as $0.00 (never omitted)', () => {
        const zero: RevenueMetrics = {
            periods: { day: period(), week: period(), month: period() },
            lastRefreshed: '2024-01-01T00:00:00.000Z',
        };
        const rows = buildRevenueRows(zero);
        for (const row of rows) {
            expect(row.gross).toBe('$0.00');
            expect(row.net).toBe('$0.00');
            expect(row.fees).toBe('$0.00');
        }
    });
});
