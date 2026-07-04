import { describe, it, expect } from 'vitest';
import type { DisputeStatus } from '@fans-fund-me/shared';
import {
    calculateDaysRemaining,
    classifyUrgency,
    isOpenDispute,
} from './disputes.js';

describe('calculateDaysRemaining', () => {
    it('returns 0 when the deadline is later the same UTC calendar day', () => {
        const now = new Date('2024-03-15T08:00:00.000Z');
        expect(calculateDaysRemaining('2024-03-15T23:00:00.000Z', now)).toBe(0);
    });

    it('counts calendar days regardless of clock time within the day', () => {
        // Late on the 15th to early on the 18th is still 3 calendar days.
        const now = new Date('2024-03-15T23:59:00.000Z');
        expect(calculateDaysRemaining('2024-03-18T00:01:00.000Z', now)).toBe(3);
    });

    it('returns a positive count for a future deadline', () => {
        const now = new Date('2024-03-15T12:00:00.000Z');
        expect(calculateDaysRemaining('2024-03-20T12:00:00.000Z', now)).toBe(5);
    });

    it('returns a negative count when the deadline is in the past', () => {
        const now = new Date('2024-03-15T12:00:00.000Z');
        expect(calculateDaysRemaining('2024-03-13T12:00:00.000Z', now)).toBe(-2);
    });

    it('uses UTC dates, not local time, at day boundaries', () => {
        const now = new Date('2024-03-15T23:30:00.000Z');
        // Deadline is the very next UTC day -> exactly 1 calendar day.
        expect(calculateDaysRemaining('2024-03-16T00:30:00.000Z', now)).toBe(1);
    });

    it('handles month/year rollover', () => {
        const now = new Date('2023-12-31T10:00:00.000Z');
        expect(calculateDaysRemaining('2024-01-02T10:00:00.000Z', now)).toBe(2);
    });

    it('treats equivalent offset timestamps as the same UTC day', () => {
        const now = new Date('2024-03-15T12:00:00.000Z');
        // 2024-03-16T00:00:00+01:00 == 2024-03-15T23:00:00Z -> same day, 0.
        expect(calculateDaysRemaining('2024-03-16T00:00:00.000+01:00', now)).toBe(0);
    });
});

describe('classifyUrgency', () => {
    it('classifies negative days as overdue', () => {
        expect(classifyUrgency(-1)).toBe('overdue');
        expect(classifyUrgency(-100)).toBe('overdue');
    });

    it('classifies 0 and 1 days as critical', () => {
        expect(classifyUrgency(0)).toBe('critical');
        expect(classifyUrgency(1)).toBe('critical');
    });

    it('classifies 2 and 3 days as urgent', () => {
        expect(classifyUrgency(2)).toBe('urgent');
        expect(classifyUrgency(3)).toBe('urgent');
    });

    it('classifies more than 3 days as normal', () => {
        expect(classifyUrgency(4)).toBe('normal');
        expect(classifyUrgency(30)).toBe('normal');
    });
});

describe('isOpenDispute', () => {
    const open: DisputeStatus[] = [
        'warning_needs_response',
        'needs_response',
    ];
    const closed: DisputeStatus[] = [
        'warning_under_review',
        'under_review',
        'won',
        'lost',
        'charge_refunded',
    ];

    it.each(open)('returns true for open status %s', (status) => {
        expect(isOpenDispute(status)).toBe(true);
    });

    it.each(closed)('returns false for closed status %s', (status) => {
        expect(isOpenDispute(status)).toBe(false);
    });
});
