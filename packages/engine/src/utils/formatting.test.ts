// Unit tests for monetary and percentage formatting utilities.
//
// Covers the specific examples and edge cases called out in task 4.1: zero,
// trailing-zero padding, fractional-penny rounding, and large values (which
// must not use scientific notation or thousands separators). Property-based
// coverage of the /^\d+\.\d{2}$/ contract lives in the separate task 4.2.

import { describe, it, expect } from 'vitest';
import { formatMoney, formatPercentage } from './formatting.js';

const MONEY_PATTERN = /^\d+\.\d{2}$/;

describe('formatMoney', () => {
    it('formats zero with two decimals', () => {
        expect(formatMoney(0)).toBe('0.00');
    });

    it('pads a single-decimal value to two places', () => {
        expect(formatMoney(1234.5)).toBe('1234.50');
    });

    it('rounds fractional pennies to two decimal places', () => {
        expect(formatMoney(45.126)).toBe('45.13');
        expect(formatMoney(45.124)).toBe('45.12');
    });

    it('renders large values without scientific notation or separators', () => {
        const result = formatMoney(1e21);
        expect(result).toMatch(MONEY_PATTERN);
        expect(result).not.toContain('e');
        expect(result).not.toContain(',');
    });

    it('does not use thousands separators for ordinary large values', () => {
        expect(formatMoney(1234567.89)).toBe('1234567.89');
    });

    it('coerces non-finite input to a renderable value', () => {
        expect(formatMoney(Number.NaN)).toBe('0.00');
        expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('0.00');
    });
});

describe('formatPercentage', () => {
    it('formats zero as a percentage', () => {
        expect(formatPercentage(0)).toBe('0.00%');
    });

    it('pads and appends a percent sign', () => {
        expect(formatPercentage(15.5)).toBe('15.50%');
    });

    it('rounds fractional percentages to two places', () => {
        expect(formatPercentage(0.153)).toBe('0.15%');
    });
});
