import { describe, it, expect } from 'vitest';
import type { RevenueMetrics, PeriodMetrics } from '@fans-fund-me/shared';
import {
    formatAveragePayment,
    buildPaymentRows,
    AVERAGE_UNAVAILABLE,
} from './PaymentCountWidget';

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

describe('formatAveragePayment (Req 3.3)', () => {
    it('returns "N/A" when the average is null (no successful payments)', () => {
        expect(formatAveragePayment(null)).toBe('N/A');
        expect(formatAveragePayment(null)).toBe(AVERAGE_UNAVAILABLE);
    });

    it('prefixes a present average with a dollar sign, verbatim', () => {
        expect(formatAveragePayment('5.00')).toBe('$5.00');
        expect(formatAveragePayment('12.34')).toBe('$12.34');
    });

    it('treats a zero average as a value, not as "N/A"', () => {
        expect(formatAveragePayment('0.00')).toBe('$0.00');
    });
});

describe('buildPaymentRows (Req 3.2, 3.3)', () => {
    it('produces day/week/month rows with counts and formatted averages', () => {
        const data: RevenueMetrics = {
            periods: {
                day: period({
                    successfulPayments: 3,
                    failedPayments: 1,
                    refunds: 0,
                    averagePayment: '5.00',
                }),
                week: period({
                    successfulPayments: 10,
                    failedPayments: 2,
                    refunds: 1,
                    averagePayment: '7.50',
                }),
                month: period({
                    successfulPayments: 0,
                    failedPayments: 0,
                    refunds: 0,
                    averagePayment: null,
                }),
            },
            lastRefreshed: '2024-01-01T00:00:00.000Z',
        };
        const rows = buildPaymentRows(data);
        expect(rows.map((r) => r.label)).toEqual([
            'Today',
            'This Week',
            'This Month',
        ]);
        expect(rows[0]).toEqual({
            label: 'Today',
            successful: 3,
            failed: 1,
            refunds: 0,
            average: '$5.00',
        });
        // Month has no successful payments -> average "N/A" (Req 3.3).
        expect(rows[2]).toEqual({
            label: 'This Month',
            successful: 0,
            failed: 0,
            refunds: 0,
            average: 'N/A',
        });
    });
});
