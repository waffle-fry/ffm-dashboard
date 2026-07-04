import { describe, it, expect } from 'vitest';
import {
    getStartOfDay,
    getStartOfWeek,
    getStartOfMonth,
    isWithinPeriod,
} from './time-boundaries.js';

describe('getStartOfDay', () => {
    it('returns midnight UTC of the same calendar day', () => {
        const now = new Date('2024-03-15T13:47:29.512Z');
        expect(getStartOfDay(now).toISOString()).toBe('2024-03-15T00:00:00.000Z');
    });

    it('is idempotent when already at start of day', () => {
        const midnight = new Date('2024-03-15T00:00:00.000Z');
        expect(getStartOfDay(midnight).toISOString()).toBe('2024-03-15T00:00:00.000Z');
    });

    it('uses UTC date, not local, near a UTC day boundary', () => {
        const now = new Date('2024-03-15T23:59:59.999Z');
        expect(getStartOfDay(now).toISOString()).toBe('2024-03-15T00:00:00.000Z');
    });
});

describe('getStartOfWeek', () => {
    it('returns the same day when now is a Monday', () => {
        // 2024-03-11 is a Monday.
        const monday = new Date('2024-03-11T09:00:00.000Z');
        expect(getStartOfWeek(monday).toISOString()).toBe('2024-03-11T00:00:00.000Z');
    });

    it('maps a mid-week day back to Monday', () => {
        // 2024-03-14 is a Thursday.
        const thursday = new Date('2024-03-14T18:30:00.000Z');
        expect(getStartOfWeek(thursday).toISOString()).toBe('2024-03-11T00:00:00.000Z');
    });

    it('maps Sunday back to the previous Monday', () => {
        // 2024-03-17 is a Sunday.
        const sunday = new Date('2024-03-17T23:00:00.000Z');
        expect(getStartOfWeek(sunday).toISOString()).toBe('2024-03-11T00:00:00.000Z');
    });

    it('handles month/year rollover correctly', () => {
        // 2024-01-01 is a Monday; 2023-12-31 is a Sunday -> previous Monday 2023-12-25.
        const sunday = new Date('2023-12-31T12:00:00.000Z');
        expect(getStartOfWeek(sunday).toISOString()).toBe('2023-12-25T00:00:00.000Z');
    });
});

describe('getStartOfMonth', () => {
    it('returns the 1st at midnight UTC', () => {
        const now = new Date('2024-03-15T13:47:29.512Z');
        expect(getStartOfMonth(now).toISOString()).toBe('2024-03-01T00:00:00.000Z');
    });

    it('is idempotent on the 1st at midnight', () => {
        const first = new Date('2024-03-01T00:00:00.000Z');
        expect(getStartOfMonth(first).toISOString()).toBe('2024-03-01T00:00:00.000Z');
    });
});

describe('isWithinPeriod', () => {
    const now = new Date('2024-03-15T12:00:00.000Z');
    const start = new Date('2024-03-15T00:00:00.000Z');

    it('returns true for a timestamp inside the range', () => {
        expect(isWithinPeriod('2024-03-15T06:00:00.000Z', start, now)).toBe(true);
    });

    it('is inclusive of the period start boundary', () => {
        expect(isWithinPeriod('2024-03-15T00:00:00.000Z', start, now)).toBe(true);
    });

    it('is inclusive of the now boundary', () => {
        expect(isWithinPeriod('2024-03-15T12:00:00.000Z', start, now)).toBe(true);
    });

    it('returns false for a timestamp before the start', () => {
        expect(isWithinPeriod('2024-03-14T23:59:59.999Z', start, now)).toBe(false);
    });

    it('returns false for a timestamp after now', () => {
        expect(isWithinPeriod('2024-03-15T12:00:00.001Z', start, now)).toBe(false);
    });

    it('returns false for an unparseable timestamp', () => {
        expect(isWithinPeriod('not-a-date', start, now)).toBe(false);
    });

    it('treats equivalent offset timestamps as the same instant', () => {
        // 01:00+01:00 == 00:00Z, exactly the start boundary.
        expect(isWithinPeriod('2024-03-15T01:00:00.000+01:00', start, now)).toBe(true);
    });
});
