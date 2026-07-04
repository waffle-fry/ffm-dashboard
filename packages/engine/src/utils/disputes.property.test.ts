// Property-based tests for dispute deadline calculations.
//
// Feature: ops-dashboard, Property 13: Dispute days remaining calculation
//
// Task 4.5 / Property 13 (Validates Requirement 6.1): for any dispute with an
// evidence_due_by UTC timestamp and any current UTC time, calculateDaysRemaining
// SHALL equal the number of whole calendar days from the current UTC date to the
// due UTC date (negative when past due), using UTC date boundaries for counting.
// The time-of-day components of both instants must never affect the result.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateDaysRemaining, classifyUrgency } from './disputes.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_DAY_MINUS_ONE = MS_PER_DAY - 1;

// Whole days since the Unix epoch, kept in a range that maps to valid, sane
// UTC calendar dates (roughly 1970 through the year ~2790).
const dayIndexArb = fc.integer({ min: 0, max: 300_000 });

// A calendar-day offset spanning well into the past (overdue) and future.
const dayOffsetArb = fc.integer({ min: -1000, max: 1000 });

// Any time of day within a UTC calendar day, including both boundaries
// (00:00:00.000 and 23:59:59.999) so partial-day edges are exercised.
const timeOfDayArb = fc.integer({ min: 0, max: MS_PER_DAY_MINUS_ONE });

describe('calculateDaysRemaining (Property 13: Dispute days remaining calculation)', () => {
    it('equals the signed UTC calendar-day gap regardless of time-of-day', () => {
        fc.assert(
            fc.property(
                dayIndexArb,
                dayOffsetArb,
                timeOfDayArb,
                timeOfDayArb,
                (nowDay, dayOffset, nowTimeOfDay, dueTimeOfDay) => {
                    const dueDay = nowDay + dayOffset;

                    // `now` sits somewhere within its UTC calendar day.
                    const now = new Date(nowDay * MS_PER_DAY + nowTimeOfDay);
                    // The deadline sits somewhere within a UTC day `dayOffset`
                    // days away — the exact clock time must not change the count.
                    const evidenceDueBy = new Date(
                        dueDay * MS_PER_DAY + dueTimeOfDay,
                    ).toISOString();

                    const result = calculateDaysRemaining(evidenceDueBy, now);

                    // The signed calendar-day gap, independent of times of day.
                    expect(result).toBe(dayOffset);

                    // Sign contract: overdue is strictly negative, a later or
                    // same UTC date is non-negative.
                    if (dayOffset < 0) {
                        expect(result).toBeLessThan(0);
                    } else {
                        expect(result).toBeGreaterThanOrEqual(0);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: ops-dashboard, Property 14: Dispute urgency classification
//
// Task 4.6 / Property 14 (Validates Requirements 6.4, 6.5, 6.7): for any
// integer daysRemaining, classifyUrgency SHALL return exactly the band defined
// by the boundaries — 'overdue' when < 0, 'critical' when 0 <= d <= 1,
// 'urgent' when 1 < d <= 3, and 'normal' when d > 3.

// Integers spanning well past every boundary in both directions.
const daysRemainingArb = fc.integer({ min: -1000, max: 1000 });

describe('classifyUrgency (Property 14: Dispute urgency classification)', () => {
    it('assigns the urgency band defined by the daysRemaining boundaries', () => {
        fc.assert(
            fc.property(daysRemainingArb, (daysRemaining) => {
                const result = classifyUrgency(daysRemaining);

                // Independent, mutually exclusive derivation of the expected band.
                let expected: 'overdue' | 'critical' | 'urgent' | 'normal';
                if (daysRemaining < 0) {
                    expected = 'overdue';
                } else if (daysRemaining >= 0 && daysRemaining <= 1) {
                    expected = 'critical';
                } else if (daysRemaining > 1 && daysRemaining <= 3) {
                    expected = 'urgent';
                } else {
                    expected = 'normal';
                }

                expect(result).toBe(expected);
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: ops-dashboard, Property 18: Open dispute status filter
//
// Task 4.7 / Property 18 (Validates Requirement 7.7): for any DisputeStatus
// value, isOpenDispute SHALL return true for exactly 'warning_needs_response'
// and 'needs_response' (the unresponded-to statuses), and false for every other
// status ('warning_under_review', 'under_review', 'won', 'lost',
// 'charge_refunded').

import { isOpenDispute } from './disputes.js';
import type { DisputeStatus } from '@fans-fund-me/shared';

// The statuses that represent an open, unresponded-to (actionable) dispute.
const OPEN_STATUSES: readonly DisputeStatus[] = [
    'warning_needs_response',
    'needs_response',
];

// The statuses that represent a resolved or non-actionable (awaiting-review)
// dispute.
const CLOSED_STATUSES: readonly DisputeStatus[] = [
    'warning_under_review',
    'under_review',
    'won',
    'lost',
    'charge_refunded',
];

// Draw from the full DisputeStatus domain so every case is exercised.
const disputeStatusArb: fc.Arbitrary<DisputeStatus> = fc.constantFrom(
    ...OPEN_STATUSES,
    ...CLOSED_STATUSES,
);

describe('isOpenDispute (Property 18: Open dispute status filter)', () => {
    it('returns true only for the open statuses and false for all others', () => {
        const openSet = new Set<DisputeStatus>(OPEN_STATUSES);

        fc.assert(
            fc.property(disputeStatusArb, (status) => {
                // Independent oracle: open iff the status is one of the three
                // actionable statuses.
                expect(isOpenDispute(status)).toBe(openSet.has(status));
            }),
            { numRuns: 100 },
        );
    });
});
