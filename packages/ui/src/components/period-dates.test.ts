import { describe, it, expect } from 'vitest';
import {
    utcStartOfDay,
    utcStartOfWeek,
    utcStartOfMonth,
    formatRange,
    periodDateLabels,
} from './period-dates';

// A Wednesday: 2026-07-15T12:34:00Z.
const NOW = new Date('2026-07-15T12:34:00.000Z');

describe('UTC period boundaries', () => {
    it('utcStartOfDay is midnight UTC of the same date', () => {
        expect(utcStartOfDay(NOW).toISOString()).toBe('2026-07-15T00:00:00.000Z');
    });

    it('utcStartOfWeek is the Monday 00:00 UTC of the week', () => {
        expect(utcStartOfWeek(NOW).toISOString()).toBe('2026-07-13T00:00:00.000Z');
    });

    it('utcStartOfWeek handles Sunday (rolls back to the previous Monday)', () => {
        const sunday = new Date('2026-07-19T09:00:00.000Z'); // Sunday
        expect(utcStartOfWeek(sunday).toISOString()).toBe(
            '2026-07-13T00:00:00.000Z',
        );
    });

    it('utcStartOfMonth is the 1st 00:00 UTC', () => {
        expect(utcStartOfMonth(NOW).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });
});

describe('formatRange', () => {
    it('collapses to a single label when start and end are the same day', () => {
        const d = new Date('2026-07-15T00:00:00.000Z');
        expect(formatRange(d, d)).toBe('15 Jul');
    });

    it('shows a dash-separated range across days', () => {
        expect(
            formatRange(
                new Date('2026-06-30T00:00:00.000Z'),
                new Date('2026-07-15T00:00:00.000Z'),
            ),
        ).toBe('30 Jun – 15 Jul');
    });
});

describe('periodDateLabels', () => {
    it('produces day/week/month UTC labels relative to now', () => {
        const labels = periodDateLabels(NOW);
        expect(labels.day).toBe('15 Jul');
        expect(labels.week).toBe('13 Jul – 15 Jul');
        expect(labels.month).toBe('1 Jul – 15 Jul');
    });
});
