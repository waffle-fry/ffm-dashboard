import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { UserGrowthMetrics } from '@fans-fund-me/shared';
import { buildUserGrowthView, formatCount } from './UserGrowthWidget';

const sampleMetrics = (
    overrides: Partial<UserGrowthMetrics> = {},
): UserGrowthMetrics => ({
    totalCreators: 120,
    totalFans: 3400,
    periods: {
        day: { newCreators: 2, newFans: 15, activeCreators: 5 },
        week: { newCreators: 9, newFans: 80, activeCreators: 30 },
        month: { newCreators: 40, newFans: 300, activeCreators: 95 },
    },
    lastRefreshed: '2024-01-01T12:00:00.000Z',
    ...overrides,
});

describe('buildUserGrowthView', () => {
    it('maps totals and every period in day/week/month order (Req 4.1-4.3)', () => {
        const view = buildUserGrowthView(sampleMetrics());

        expect(view.totalCreators).toBe(120);
        expect(view.totalFans).toBe(3400);
        expect(view.periods.map((p) => p.key)).toEqual([
            'day',
            'week',
            'month',
        ]);
        expect(view.periods.map((p) => p.label)).toEqual([
            'Today',
            'This Week',
            'This Month',
        ]);

        const [day, week, month] = view.periods;
        expect(day).toMatchObject({
            newCreators: 2,
            newFans: 15,
            activeCreators: 5,
        });
        expect(week).toMatchObject({
            newCreators: 9,
            newFans: 80,
            activeCreators: 30,
        });
        expect(month).toMatchObject({
            newCreators: 40,
            newFans: 300,
            activeCreators: 95,
        });
    });

    it('coerces a null payload to zeros for every field (Req 4.5)', () => {
        const view = buildUserGrowthView(null);

        expect(view.totalCreators).toBe(0);
        expect(view.totalFans).toBe(0);
        expect(view.periods).toHaveLength(3);
        for (const period of view.periods) {
            expect(period.newCreators).toBe(0);
            expect(period.newFans).toBe(0);
            expect(period.activeCreators).toBe(0);
        }
    });

    it('renders explicit zeros for empty periods rather than omitting them (Req 4.5)', () => {
        const view = buildUserGrowthView(
            sampleMetrics({
                periods: {
                    day: { newCreators: 0, newFans: 0, activeCreators: 0 },
                    week: { newCreators: 0, newFans: 0, activeCreators: 0 },
                    month: { newCreators: 5, newFans: 0, activeCreators: 2 },
                },
            }),
        );

        expect(view.periods).toHaveLength(3);
        expect(view.periods[0]).toMatchObject({
            newCreators: 0,
            newFans: 0,
            activeCreators: 0,
        });
        expect(view.periods[2]).toMatchObject({
            newCreators: 5,
            newFans: 0,
            activeCreators: 2,
        });
    });

    it('always returns three periods in fixed order for arbitrary counts', () => {
        const nonNeg = fc.nat({ max: 1_000_000 });
        const period = fc.record({
            newCreators: nonNeg,
            newFans: nonNeg,
            activeCreators: nonNeg,
        });
        fc.assert(
            fc.property(
                nonNeg,
                nonNeg,
                period,
                period,
                period,
                (
                    totalCreators,
                    totalFans,
                    day,
                    week,
                    month,
                ) => {
                    const view = buildUserGrowthView({
                        totalCreators,
                        totalFans,
                        periods: { day, week, month },
                        lastRefreshed: '2024-01-01T00:00:00.000Z',
                    });
                    expect(view.periods.map((p) => p.key)).toEqual([
                        'day',
                        'week',
                        'month',
                    ]);
                    expect(view.totalCreators).toBe(totalCreators);
                    expect(view.totalFans).toBe(totalFans);
                    expect(view.periods[0].activeCreators).toBe(
                        day.activeCreators,
                    );
                    expect(view.periods[1].newFans).toBe(week.newFans);
                    expect(view.periods[2].newCreators).toBe(month.newCreators);
                },
            ),
        );
    });
});

describe('formatCount', () => {
    it('formats whole numbers with locale grouping', () => {
        expect(formatCount(0)).toBe('0');
        expect(formatCount(15)).toBe('15');
        expect(formatCount(1234)).toBe('1,234');
        expect(formatCount(3400000)).toBe('3,400,000');
    });

    it('falls back to "0" for non-finite input', () => {
        expect(formatCount(Number.NaN)).toBe('0');
        expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
    });
});
