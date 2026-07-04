// Property-based tests for the S3Collector's pure evidence/progress helpers.
//
// Feature: ops-dashboard, Property 16: Evidence upload detection
// Feature: ops-dashboard, Property 17: Dispute progress step classification
//
// Task 6.13 / Property 16 (Validates Requirements 7.1, 7.2, 7.3): for any S3
// listing — empty, zero-byte-only, or containing at least one file > 0 bytes —
// isEvidenceUploaded returns true if and only if at least one listed object has
// a size strictly greater than zero bytes.
//
// Task 6.14 / Property 17 (Validates Requirements 7.4, 7.5): for any
// (evidenceUploaded, disputeStatus) pair, classifyDisputeProgress classifies the
// two progress steps per the documented rules — both complete for the resolved
// statuses, Evidence_Submission outstanding while a dispute is still open, and
// Evidence_Upload outstanding only when no evidence was uploaded on an open
// dispute.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { DisputeStatus } from '@fans-fund-me/shared';
import { isOpenDispute } from '../utils/disputes.js';
import {
    isEvidenceUploaded,
    classifyDisputeProgress,
    selectMostRecentBatchObjects,
    buildEvidencePrefix,
    BATCHES_PREFIX,
    type S3ObjectSummary,
} from './s3-collector.js';

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

// Non-negative object sizes in bytes, deliberately including 0 so zero-byte
// files (which must NOT count as uploaded) are exercised.
const sizeArb = fc.nat({ max: 10_000_000 });

// A single S3 object summary with an arbitrary key and a non-negative size.
const objectArb: fc.Arbitrary<S3ObjectSummary> = fc.record({
    key: fc.string(),
    size: sizeArb,
});

// A listing of objects, including empty listings.
const objectsArb: fc.Arbitrary<S3ObjectSummary[]> = fc.array(objectArb, {
    maxLength: 20,
});

// The full DisputeStatus union — every case must be covered.
const OPEN_STATUSES: readonly DisputeStatus[] = [
    'warning_needs_response',
    'needs_response',
];
const CLOSED_STATUSES: readonly DisputeStatus[] = [
    'warning_under_review',
    'under_review',
    'won',
    'lost',
    'charge_refunded',
];
const disputeStatusArb: fc.Arbitrary<DisputeStatus> = fc.constantFrom(
    ...OPEN_STATUSES,
    ...CLOSED_STATUSES,
);

// Statuses for which BOTH steps are complete (design Requirement 7.5).
const BOTH_STEPS_COMPLETE = new Set<DisputeStatus>(['under_review', 'won', 'lost']);

// ---------------------------------------------------------------------------
// Property 16: Evidence upload detection
// ---------------------------------------------------------------------------

describe('isEvidenceUploaded (Property 16: Evidence upload detection)', () => {
    it('is true iff at least one listed object has size > 0 bytes', () => {
        fc.assert(
            fc.property(objectsArb, (objects) => {
                // Independent oracle: uploaded iff any positive-size file exists.
                const expected = objects.some((o) => o.size > 0);
                expect(isEvidenceUploaded(objects)).toBe(expected);
            }),
            { numRuns: 100 },
        );
    });

    it('treats empty listings as not uploaded', () => {
        expect(isEvidenceUploaded([])).toBe(false);
    });

    it('treats zero-byte-only listings as not uploaded', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({ key: fc.string(), size: fc.constant(0) }),
                    { minLength: 1, maxLength: 20 },
                ),
                (zeroByteObjects) => {
                    expect(isEvidenceUploaded(zeroByteObjects)).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('detects upload when at least one positive-size file is present', () => {
        fc.assert(
            fc.property(
                objectsArb,
                fc.integer({ min: 1, max: 10_000_000 }),
                (objects, positiveSize) => {
                    // Inserting any strictly-positive file forces the answer true.
                    const withUpload = [...objects, { key: 'evidence.pdf', size: positiveSize }];
                    expect(isEvidenceUploaded(withUpload)).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Property 17: Dispute progress step classification
// ---------------------------------------------------------------------------

describe('classifyDisputeProgress (Property 17: Dispute progress step classification)', () => {
    it('classifies both steps per the documented rules for every status/flag pair', () => {
        fc.assert(
            fc.property(fc.boolean(), disputeStatusArb, (evidenceUploaded, status) => {
                const result = classifyDisputeProgress(evidenceUploaded, status);

                // Independent oracle mirroring the documented behaviour.
                let expectedUploaded: boolean;
                let expectedSubmitted: boolean;
                if (BOTH_STEPS_COMPLETE.has(status)) {
                    // Requirement 7.5: resolved/under-review => both complete.
                    expectedUploaded = true;
                    expectedSubmitted = true;
                } else {
                    // Evidence_Upload is outstanding only for an open dispute
                    // with no uploaded evidence; otherwise it counts complete.
                    const uploadOutstanding = isOpenDispute(status) && !evidenceUploaded;
                    expectedUploaded = !uploadOutstanding;
                    // Evidence_Submission only completes via the both-complete
                    // statuses above; it is outstanding for every other status.
                    expectedSubmitted = false;
                }

                expect(result).toEqual({
                    evidenceUploaded: expectedUploaded,
                    evidenceSubmitted: expectedSubmitted,
                });
            }),
            { numRuns: 100 },
        );
    });

    it('marks both steps complete for under_review, won, and lost', () => {
        fc.assert(
            fc.property(
                fc.boolean(),
                fc.constantFrom<DisputeStatus>('under_review', 'won', 'lost'),
                (evidenceUploaded, status) => {
                    expect(classifyDisputeProgress(evidenceUploaded, status)).toEqual({
                        evidenceUploaded: true,
                        evidenceSubmitted: true,
                    });
                },
            ),
            { numRuns: 100 },
        );
    });

    it('leaves Evidence_Submission outstanding when evidence uploaded on a needs-response status', () => {
        fc.assert(
            fc.property(
                fc.constantFrom<DisputeStatus>('needs_response', 'warning_needs_response'),
                (status) => {
                    const result = classifyDisputeProgress(true, status);
                    // Upload step complete (evidence present), submission still pending.
                    expect(result.evidenceUploaded).toBe(true);
                    expect(result.evidenceSubmitted).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('marks Evidence_Upload outstanding when no evidence and dispute is open', () => {
        fc.assert(
            fc.property(disputeStatusArb, (status) => {
                const result = classifyDisputeProgress(false, status);
                if (isOpenDispute(status)) {
                    // Open + not uploaded => upload step outstanding.
                    expect(result.evidenceUploaded).toBe(false);
                    expect(result.evidenceSubmitted).toBe(false);
                }
            }),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Light property: most-recent batch selection
// ---------------------------------------------------------------------------

describe('selectMostRecentBatchObjects (most-recent batch selection)', () => {
    // Payment ids constrained away from '/' so keys stay well-formed.
    const paymentIdArb = fc
        .string({ minLength: 1, maxLength: 8 })
        .filter((s) => !s.includes('/'));

    it('selects the highest batch number containing the paymentId, or null when none match', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 12 }),
                paymentIdArb,
                (batchNumbers, paymentId) => {
                    // Build a well-formed evidence object for each batch number,
                    // each with a single file segment beneath the payment folder.
                    const objects: S3ObjectSummary[] = batchNumbers.map((n, i) => ({
                        key: `${buildEvidencePrefix(n, paymentId)}file-${i}.pdf`,
                        size: 1,
                    }));

                    const result = selectMostRecentBatchObjects(objects, paymentId);

                    if (batchNumbers.length === 0) {
                        expect(result).toBeNull();
                        return;
                    }

                    const expectedBatch = Math.max(...batchNumbers);
                    expect(result).not.toBeNull();
                    expect(result!.batchNumber).toBe(expectedBatch);
                    // Every returned object must belong to the selected batch.
                    for (const object of result!.objects) {
                        expect(object.key.startsWith(buildEvidencePrefix(expectedBatch, paymentId))).toBe(
                            true,
                        );
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it('returns null when the listing has no batch for the paymentId', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 8 }),
                paymentIdArb,
                (batchNumbers, paymentId) => {
                    // Objects for a DIFFERENT payment id must never match.
                    const otherId = `other-${paymentId}`;
                    const objects: S3ObjectSummary[] = batchNumbers.map((n, i) => ({
                        key: `${BATCHES_PREFIX}${n}/${otherId}/file-${i}.pdf`,
                        size: 1,
                    }));
                    expect(selectMostRecentBatchObjects(objects, paymentId)).toBeNull();
                },
            ),
            { numRuns: 100 },
        );
    });
});
