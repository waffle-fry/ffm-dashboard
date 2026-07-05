// Unit tests for the average and rate calculation utilities.

import { describe, it, expect } from 'vitest';
import {
    calculateAverage,
    calculateTakeRate,
    calculateDisputeRate,
} from './calculations.js';

const TWO_DP_PATTERN = /^\d+\.\d{2}$/;

describe('calculateAverage', () => {
    it('returns gross / count rounded to 2 decimal places', () => {
        expect(calculateAverage(100, 4)).toBe('25.00');
        expect(calculateAverage(10, 3)).toBe('3.33');
    });

    it('rounds half away from zero', () => {
        expect(calculateAverage(45.125, 1)).toBe('45.13');
    });

    it('always matches the 2dp pattern when count > 0', () => {
        expect(calculateAverage(1234.5, 1)).toMatch(TWO_DP_PATTERN);
        expect(calculateAverage(0, 5)).toMatch(TWO_DP_PATTERN);
    });

    it('returns null when count is 0', () => {
        expect(calculateAverage(100, 0)).toBeNull();
    });
});

describe('calculateTakeRate', () => {
    it('returns (fees / volume) * 100 rounded to 2 decimal places without %', () => {
        expect(calculateTakeRate(10, 100)).toBe('10.00');
        expect(calculateTakeRate(1, 3)).toBe('33.33');
    });

    it('always matches the 2dp pattern when volume > 0', () => {
        expect(calculateTakeRate(5, 200)).toMatch(TWO_DP_PATTERN);
        expect(calculateTakeRate(0, 200)).toMatch(TWO_DP_PATTERN);
    });

    it('returns null when volume is 0', () => {
        expect(calculateTakeRate(50, 0)).toBeNull();
    });
});

describe('calculateDisputeRate', () => {
    it('returns (disputes / payments) * 100 rounded to 2dp without % (UI adds it)', () => {
        expect(calculateDisputeRate(15, 10000)).toBe('0.15');
        expect(calculateDisputeRate(1, 4)).toBe('25.00');
    });

    it('always matches the 2dp pattern when payments > 0', () => {
        expect(calculateDisputeRate(3, 200)).toMatch(TWO_DP_PATTERN);
        expect(calculateDisputeRate(0, 200)).toMatch(TWO_DP_PATTERN);
    });

    it('returns "0.00" when payments is 0', () => {
        expect(calculateDisputeRate(5, 0)).toBe('0.00');
    });
});
