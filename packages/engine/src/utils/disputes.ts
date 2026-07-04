// Dispute calculation utilities.
//
// Pure helpers used by the StripeCollector (task 6.1) and the dispute widgets
// to derive countdown, urgency, and open/closed state from raw Stripe dispute
// data. All date arithmetic uses UTC calendar-day boundaries so results are
// stable regardless of the server's local timezone.

import type { DisputeStatus } from '@fans-fund-me/shared';

/**
 * Number of whole UTC calendar days from `now` to the evidence deadline.
 *
 * The comparison is made between the UTC calendar day of `now` and the UTC
 * calendar day of `evidenceDueBy` — the time-of-day components are discarded.
 * This means partial days never count: if the deadline is on a later UTC date
 * than today, at least one day remains no matter the clock time.
 *
 * Requirement 6.1. Returns a negative number when the deadline is in the past.
 *
 * @param evidenceDueBy ISO 8601 timestamp of the evidence deadline.
 * @param now Reference time, defaults to the current time.
 * @returns Signed count of calendar days remaining (negative = overdue).
 */
export function calculateDaysRemaining(evidenceDueBy: string, now: Date = new Date()): number {
    const due = new Date(evidenceDueBy);

    // Collapse both instants to their UTC midnight so only the calendar date
    // participates in the difference.
    const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((dueDay - nowDay) / msPerDay);
}

/** Urgency band derived from the days remaining on a dispute deadline. */
export type DisputeUrgency = 'overdue' | 'critical' | 'urgent' | 'normal';

/**
 * Classifies a dispute deadline into an urgency band.
 *
 * Requirements 6.4, 6.5, 6.7:
 * - `overdue`  — daysRemaining < 0
 * - `critical` — 0 <= daysRemaining <= 1
 * - `urgent`   — 1 < daysRemaining <= 3
 * - `normal`   — daysRemaining > 3
 */
export function classifyUrgency(daysRemaining: number): DisputeUrgency {
    if (daysRemaining < 0) {
        return 'overdue';
    }
    if (daysRemaining <= 1) {
        return 'critical';
    }
    if (daysRemaining <= 3) {
        return 'urgent';
    }
    return 'normal';
}

/**
 * Statuses that represent a dispute still requiring an (as-yet unmade) response
 * from the team. Requirement 7.7.
 *
 * Only the two "needs response" statuses count as open: these are disputes the
 * team has not yet responded to. Once evidence has been submitted the dispute
 * moves to a "under review" status (`warning_under_review` / `under_review`) —
 * it is then awaiting Stripe/the bank, not us, and its evidence deadline is in
 * the past, so it must NOT be shown as an actionable/overdue item.
 */
const OPEN_DISPUTE_STATUSES: ReadonlySet<DisputeStatus> = new Set([
    'warning_needs_response',
    'needs_response',
]);

/**
 * Predicate for whether a dispute is still open (unresponded-to and actionable).
 *
 * Requirement 7.7. Returns true only for 'warning_needs_response' and
 * 'needs_response' — the statuses that still require the team to submit a
 * response. Returns false for 'warning_under_review' and 'under_review'
 * (evidence already submitted, awaiting review), and for 'won', 'lost', and
 * 'charge_refunded' (resolved).
 */
export function isOpenDispute(status: DisputeStatus): boolean {
    return OPEN_DISPUTE_STATUSES.has(status);
}
