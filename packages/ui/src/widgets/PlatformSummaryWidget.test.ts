import { describe, it, expect } from 'vitest';
import type { PlatformSummaryMetrics } from '@fans-fund-me/shared';
import {
    formatGrossVolume,
    formatTakeRate,
    formatDisputeRate,
    buildSummaryStats,
    TAKE_RATE_UNAVAILABLE,
} from './PlatformSummaryWidget';

describe('formatGrossVolume (Req 10.1)', () => {
    it('prefixes the backend USD string with a dollar sign, verbatim', () => {
        expect(formatGrossVolume('1234.56')).toBe('$1234.56');
        expect(formatGrossVolume('0.00')).toBe('$0.00');
    });

    it('does not re-round or reformat the value', () => {
        expect(formatGrossVolume('9999999.99')).toBe('$9999999.99');
    });
});

describe('formatTakeRate (Req 10.2)', () => {
    it('returns "N/A" when the take rate is null (gross volume is zero)', () => {
        expect(formatTakeRate(null)).toBe('N/A');
        expect(formatTakeRate(null)).toBe(TAKE_RATE_UNAVAILABLE);
    });

    it('suffixes a present rate with a percent sign, verbatim', () => {
        expect(formatTakeRate('12.34')).toBe('12.34%');
        expect(formatTakeRate('5.00')).toBe('5.00%');
    });

    it('treats a zero rate as a value, not as "N/A"', () => {
        expect(formatTakeRate('0.00')).toBe('0.00%');
    });
});

describe('formatDisputeRate (Req 10.3)', () => {
    it('suffixes the backend percentage string with a percent sign', () => {
        expect(formatDisputeRate('0.15')).toBe('0.15%');
        expect(formatDisputeRate('0.00')).toBe('0.00%');
    });
});

describe('buildSummaryStats (Req 10.1–10.4)', () => {
    const base: PlatformSummaryMetrics = {
        monthlyGrossVolume: '1234.56',
        monthlyTakeRate: '12.34',
        openDisputes: 3,
        monthlyDisputeRate: '0.15',
        monthlyPaymentCount: 42,
        lastRefreshed: '2024-01-01T00:00:00.000Z',
    };

    it('produces the five figures in a stable order with correct affixes', () => {
        const stats = buildSummaryStats(base);
        expect(stats).toEqual([
            { label: 'Gross Volume (This Month)', value: '$1234.56' },
            { label: 'Take Rate (This Month)', value: '12.34%' },
            { label: 'Open Disputes', value: '3' },
            { label: 'Dispute Rate (This Month)', value: '0.15%' },
            { label: 'Payments (This Month)', value: '42' },
        ]);
    });

    it('renders "N/A" for a null take rate (gross volume zero)', () => {
        const stats = buildSummaryStats({ ...base, monthlyTakeRate: null });
        expect(stats[1]).toEqual({
            label: 'Take Rate (This Month)',
            value: 'N/A',
        });
    });

    it('renders zero counts and a "0.00%" dispute rate verbatim', () => {
        const stats = buildSummaryStats({
            ...base,
            openDisputes: 0,
            monthlyDisputeRate: '0.00',
            monthlyPaymentCount: 0,
        });
        expect(stats[2]).toEqual({ label: 'Open Disputes', value: '0' });
        expect(stats[3]).toEqual({
            label: 'Dispute Rate (This Month)',
            value: '0.00%',
        });
        expect(stats[4]).toEqual({
            label: 'Payments (This Month)',
            value: '0',
        });
    });
});
