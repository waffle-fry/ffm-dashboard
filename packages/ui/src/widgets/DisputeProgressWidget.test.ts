import { describe, it, expect } from 'vitest';
import type { DisputeItem } from '@fans-fund-me/shared';
import {
    EVIDENCE_UPLOAD_LABEL,
    EVIDENCE_SUBMISSION_LABEL,
    stepStatusLabel,
    disputeProgressSteps,
} from './DisputeProgressWidget';

function dispute(overrides: Partial<DisputeItem> = {}): DisputeItem {
    return {
        paymentId: 'pi_1234567890',
        amountUsd: '45.00',
        daysRemaining: 3,
        evidenceUploaded: false,
        evidenceSubmitted: false,
        evidenceBatch: null,
        status: 'needs_response',
        ...overrides,
    };
}

describe('stepStatusLabel (Req 7.6)', () => {
    it('maps true -> "Complete"', () => {
        expect(stepStatusLabel(true)).toBe('Complete');
    });
    it('maps false -> "Outstanding"', () => {
        expect(stepStatusLabel(false)).toBe('Outstanding');
    });
});

describe('disputeProgressSteps (Req 7.4, 7.5, 7.6)', () => {
    it('uses the exact step labels in [Upload, Submission] order', () => {
        const steps = disputeProgressSteps(dispute());
        expect(steps).toHaveLength(2);
        expect(steps[0].label).toBe(EVIDENCE_UPLOAD_LABEL);
        expect(steps[0].label).toBe('Evidence Upload (Andy)');
        expect(steps[1].label).toBe(EVIDENCE_SUBMISSION_LABEL);
        expect(steps[1].label).toBe('Evidence Submission');
    });

    it('maps evidenceUploaded to the Upload step and evidenceSubmitted to the Submission step', () => {
        const steps = disputeProgressSteps(
            dispute({ evidenceUploaded: true, evidenceSubmitted: false }),
        );
        expect(steps[0].complete).toBe(true);
        expect(steps[0].statusLabel).toBe('Complete');
        expect(steps[1].complete).toBe(false);
        expect(steps[1].statusLabel).toBe('Outstanding');
    });

    it('renders both Outstanding when neither step is done', () => {
        const steps = disputeProgressSteps(
            dispute({ evidenceUploaded: false, evidenceSubmitted: false }),
        );
        expect(steps.map((s) => s.statusLabel)).toEqual([
            'Outstanding',
            'Outstanding',
        ]);
    });

    it('renders both Complete when both steps are done', () => {
        const steps = disputeProgressSteps(
            dispute({ evidenceUploaded: true, evidenceSubmitted: true }),
        );
        expect(steps.map((s) => s.statusLabel)).toEqual([
            'Complete',
            'Complete',
        ]);
    });

    it('does not couple the two steps (upload done, submission outstanding)', () => {
        const steps = disputeProgressSteps(
            dispute({ evidenceUploaded: true, evidenceSubmitted: false }),
        );
        expect(steps[0].statusLabel).toBe('Complete');
        expect(steps[1].statusLabel).toBe('Outstanding');
    });
});
