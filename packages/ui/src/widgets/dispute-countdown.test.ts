import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    describeCountdown,
    describeDisputeDays,
    formatDisputeAmount,
    URGENCY_COLOR_CLASS,
} from './dispute-countdown';

const RED = URGENCY_COLOR_CLASS.critical; // 'text-danger' (also overdue)
const GOLD = URGENCY_COLOR_CLASS.warning; // 'text-accent'
const NORMAL = URGENCY_COLOR_CLASS.normal;
const MUTED = URGENCY_COLOR_CLASS.none;

describe('describeCountdown', () => {
    it('shows "No open disputes" for a null deadline (Req 6.6)', () => {
        const view = describeCountdown(null);
        expect(view.level).toBe('none');
        expect(view.primary).toBe('No open disputes');
        expect(view.secondary).toBeNull();
        expect(view.colorClass).toBe(MUTED);
    });

    it('shows "OVERDUE" in red with days past for negative days (Req 6.7)', () => {
        const view = describeCountdown(-3);
        expect(view.level).toBe('overdue');
        expect(view.primary).toBe('OVERDUE');
        expect(view.secondary).toBe('3 days past deadline');
        expect(view.colorClass).toBe(RED);
    });

    it('uses the singular day form for -1 day overdue', () => {
        expect(describeCountdown(-1).secondary).toBe('1 day past deadline');
    });

    it('shows red for 0 and 1 days remaining (Req 6.5)', () => {
        expect(describeCountdown(0).level).toBe('critical');
        expect(describeCountdown(0).colorClass).toBe(RED);
        expect(describeCountdown(0).primary).toBe('0 days');
        expect(describeCountdown(1).level).toBe('critical');
        expect(describeCountdown(1).colorClass).toBe(RED);
        expect(describeCountdown(1).primary).toBe('1 day');
    });

    it('shows gold accent for 2 and 3 days remaining (Req 6.4)', () => {
        expect(describeCountdown(2).level).toBe('warning');
        expect(describeCountdown(2).colorClass).toBe(GOLD);
        expect(describeCountdown(3).level).toBe('warning');
        expect(describeCountdown(3).colorClass).toBe(GOLD);
    });

    it('shows normal emphasis for more than 3 days remaining', () => {
        const view = describeCountdown(10);
        expect(view.level).toBe('normal');
        expect(view.colorClass).toBe(NORMAL);
        expect(view.primary).toBe('10 days');
    });

    // Validates: Requirements 6.4, 6.5, 6.7
    it('assigns urgency bands consistently across all integer day counts', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -1000, max: 1000 }),
                (days) => {
                    const view = describeCountdown(days);
                    if (days < 0) {
                        // Req 6.7: overdue is red and says OVERDUE.
                        expect(view.level).toBe('overdue');
                        expect(view.colorClass).toBe(RED);
                        expect(view.primary).toBe('OVERDUE');
                    } else if (days <= 1) {
                        // Req 6.5: critical is red.
                        expect(view.level).toBe('critical');
                        expect(view.colorClass).toBe(RED);
                    } else if (days <= 3) {
                        // Req 6.4: warning is the gold accent.
                        expect(view.level).toBe('warning');
                        expect(view.colorClass).toBe(GOLD);
                    } else {
                        expect(view.level).toBe('normal');
                        expect(view.colorClass).toBe(NORMAL);
                    }
                },
            ),
        );
    });

    // Validates: Requirement 6.5 (red band is strictly more urgent than gold)
    it('never colours a 3-or-fewer-day deadline as normal, and 1-or-fewer as gold', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 1000 }), (days) => {
                const view = describeCountdown(days);
                if (days <= 3) {
                    expect(view.colorClass).not.toBe(NORMAL);
                }
                if (days <= 1) {
                    // critical (red) must win over the gold warning band.
                    expect(view.colorClass).toBe(RED);
                }
            }),
        );
    });
});

describe('describeDisputeDays', () => {
    it('labels overdue rows in red', () => {
        const view = describeDisputeDays(-2);
        expect(view.colorClass).toBe(RED);
        expect(view.label).toBe('Overdue by 2 days');
    });

    it('labels near-deadline rows with matching urgency colours', () => {
        expect(describeDisputeDays(1).colorClass).toBe(RED);
        expect(describeDisputeDays(3).colorClass).toBe(GOLD);
        expect(describeDisputeDays(7).colorClass).toBe(NORMAL);
        expect(describeDisputeDays(7).label).toBe('7 days remaining');
    });
});

describe('formatDisputeAmount', () => {
    it('prefixes the already-2dp USD amount with $ (Req 6.3)', () => {
        expect(formatDisputeAmount('45.00')).toBe('$45.00');
        expect(formatDisputeAmount('1234.56')).toBe('$1234.56');
    });
});
