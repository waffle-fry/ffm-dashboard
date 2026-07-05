// Pure, DOM-free presentation logic for the Dispute Countdown widget.
//
// The urgency classification and label rules from Requirement 6 live here so
// they can be unit- and property-tested without React or a DOM. The widget
// component (DisputeCountdownWidget.tsx) is a thin presentational wrapper over
// these helpers.
//
// Requirement 6.2: the nearest-deadline countdown is shown prominently (the
//   component renders `primary` at >= 32px).
// Requirement 6.4: a deadline 3 or fewer days away is shown in the yellow/gold
//   accent colour to signal urgency.
// Requirement 6.5: a deadline 1 or fewer days away is shown in red (critical).
// Requirement 6.6: when there are no open disputes, show "No open disputes".
// Requirement 6.7: an already-passed deadline (negative days) shows "OVERDUE"
//   in red together with the number of days past the deadline.

import type { DisputeItem } from '@fans-fund-me/shared';

/** Urgency classification for the nearest deadline. */
export type UrgencyLevel =
    | 'none' // no open disputes
    | 'normal' // more than 3 days away
    | 'warning' // 2-3 days away (yellow/gold)
    | 'critical' // 0-1 days away (red)
    | 'overdue'; // deadline passed (red)

/** Tailwind text-colour classes for each urgency level (brand tokens). */
export const URGENCY_COLOR_CLASS: Record<UrgencyLevel, string> = {
    none: 'text-text-secondary',
    normal: 'text-text-primary',
    warning: 'text-accent',
    critical: 'text-danger',
    overdue: 'text-danger',
};

/** A fully-resolved view model for the prominent countdown display. */
export interface CountdownView {
    level: UrgencyLevel;
    /** Tailwind text-colour class for `primary`/`secondary`. */
    colorClass: string;
    /** The large, prominent line (a day count, "OVERDUE", or the empty state). */
    primary: string;
    /** A smaller supporting line, or null when none is needed. */
    secondary: string | null;
}

function pluralizeDays(count: number): string {
    return count === 1 ? '1 day' : `${count} days`;
}

/**
 * Classify the nearest deadline and produce the countdown view model.
 *
 * @param nearestDeadlineDays calendar days until the nearest dispute deadline;
 *   negative means overdue, null means there are no open disputes.
 */
export function describeCountdown(
    nearestDeadlineDays: number | null,
): CountdownView {
    // Requirement 6.6: no open disputes.
    if (nearestDeadlineDays === null) {
        return {
            level: 'none',
            colorClass: URGENCY_COLOR_CLASS.none,
            primary: 'No open disputes',
            secondary: null,
        };
    }

    // Requirement 6.7: overdue — "OVERDUE" in red with days past the deadline.
    if (nearestDeadlineDays < 0) {
        const daysPast = Math.abs(nearestDeadlineDays);
        return {
            level: 'overdue',
            colorClass: URGENCY_COLOR_CLASS.overdue,
            primary: 'OVERDUE',
            secondary: `${pluralizeDays(daysPast)} past deadline`,
        };
    }

    // Requirement 6.5: 1 or fewer days away — red (critical). Checked before
    // the 3-day rule so the more urgent band wins.
    if (nearestDeadlineDays <= 1) {
        return {
            level: 'critical',
            colorClass: URGENCY_COLOR_CLASS.critical,
            primary: pluralizeDays(nearestDeadlineDays),
            secondary: 'remaining',
        };
    }

    // Requirement 6.4: 3 or fewer days away — yellow/gold accent (warning).
    if (nearestDeadlineDays <= 3) {
        return {
            level: 'warning',
            colorClass: URGENCY_COLOR_CLASS.warning,
            primary: pluralizeDays(nearestDeadlineDays),
            secondary: 'remaining',
        };
    }

    // More than 3 days away — normal emphasis.
    return {
        level: 'normal',
        colorClass: URGENCY_COLOR_CLASS.normal,
        primary: pluralizeDays(nearestDeadlineDays),
        secondary: 'remaining',
    };
}

/** A resolved view model for a single dispute row's "days remaining" cell. */
export interface DisputeDaysView {
    colorClass: string;
    label: string;
}

/**
 * Describe the per-row "days remaining" cell, mirroring the countdown urgency
 * bands so an overdue/near-deadline row is coloured consistently.
 */
export function describeDisputeDays(daysRemaining: number): DisputeDaysView {
    if (daysRemaining < 0) {
        const daysPast = Math.abs(daysRemaining);
        return {
            colorClass: URGENCY_COLOR_CLASS.overdue,
            label: `Overdue by ${pluralizeDays(daysPast)}`,
        };
    }
    if (daysRemaining <= 1) {
        return {
            colorClass: URGENCY_COLOR_CLASS.critical,
            label: `${pluralizeDays(daysRemaining)} remaining`,
        };
    }
    if (daysRemaining <= 3) {
        return {
            colorClass: URGENCY_COLOR_CLASS.warning,
            label: `${pluralizeDays(daysRemaining)} remaining`,
        };
    }
    return {
        colorClass: URGENCY_COLOR_CLASS.normal,
        label: `${pluralizeDays(daysRemaining)} remaining`,
    };
}

/**
 * Format a dispute's already-2dp USD amount with a "$" prefix (Requirement
 * 6.3). `amountUsd` is expected to already be a 2dp string from the engine.
 */
export function formatDisputeAmount(amountUsd: DisputeItem['amountUsd']): string {
    return `$${amountUsd}`;
}

/**
 * Format the open-disputes count for the Dispute Deadlines widget header,
 * pluralised (Requirement 6.9): "1 open dispute" / "N open disputes". Zero is
 * handled for completeness, though the widget shows the "No open disputes"
 * countdown empty-state instead of this header when the count is zero.
 */
export function formatOpenDisputesCount(count: number): string {
    return count === 1 ? '1 open dispute' : `${count} open disputes`;
}
