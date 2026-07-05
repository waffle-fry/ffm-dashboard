// S3Collector — dispute evidence checks.
//
// Responsible for the AWS S3 side of dispute-process progress tracking
// (Requirement 7). For each open dispute it inspects the dispute-docs bucket to
// decide whether evidence documents have been uploaded, then classifies the two
// progress steps ("Evidence Upload" and "Evidence Submission") as
// complete or outstanding.
//
// Data-flow / independence notes:
//   - The full `DisputeMetrics` shape (nearest deadline, per-dispute amount in
//     GBP, days remaining, ...) is owned by the Stripe side (StripeCollector,
//     sibling task) and is assembled together with these evidence flags in the
//     wiring task (8.1). To stay independent from the Stripe collector, this
//     collector does NOT fetch disputes itself: it accepts the set of open
//     disputes to check as an injected input (`{ paymentId, status }[]`) and
//     produces a per-dispute evidence/progress result.
//   - Because the S3 side cannot produce a complete `DisputeMetrics` on its own,
//     `metricKeys` is intentionally empty and `collect()` performs the evidence
//     lookup for its own side-effect/telemetry only. The real integration point
//     is the public {@link S3Collector.checkEvidence} method, which task 8.1
//     calls with the Stripe dispute list and merges into the `disputes` metric.
//   - The S3 SDK (`@aws-sdk/client-s3`) is deliberately NOT imported here. This
//     collector depends only on the minimal {@link S3ClientPort} interface below
//     so it stays unit-testable and free of extra dependencies; the concrete
//     `ListObjectsV2` wiring is done later in task 8.1.

import type { DisputeStatus, DisputeItem } from '@fans-fund-me/shared';
import { isOpenDispute } from '../utils/disputes.js';
import type {
    CollectedMetrics,
    MetricCollector,
} from '../aggregator/scheduler.js';
import type { MetricKey } from '../cache/metrics-cache.js';

/** The S3 bucket that holds dispute evidence documents (Requirement 7.1). */
export const DISPUTE_DOCS_BUCKET = 'fans-fund-me-core-dispute-docs';

/** Top-level key prefix under which numbered dispute batches live. */
export const BATCHES_PREFIX = 'batches/';

/**
 * Minimal summary of a single S3 object, modelling the fields of a
 * `ListObjectsV2` result entry that this collector needs. `size` is the object
 * size in bytes (S3's `Size`).
 */
export interface S3ObjectSummary {
    /** The full object key, e.g. `batches/7/pi_abc123/evidence.pdf`. */
    key: string;
    /** Object size in bytes. */
    size: number;
}

/**
 * Narrow S3 client port.
 *
 * Models a `ListObjectsV2`-style call: given a key prefix, return the objects
 * beneath it (each with a byte size). The concrete `@aws-sdk/client-s3`
 * implementation is provided by the wiring task (8.1); tests inject a fake.
 */
export interface S3ClientPort {
    /** Lists all objects whose key begins with `prefix`. */
    listObjects(prefix: string): Promise<S3ObjectSummary[]>;
}

/** The subset of dispute data the S3 side needs to classify progress. */
export interface OpenDisputeInput {
    /** Stripe payment id the dispute is attached to (the S3 subfolder name). */
    paymentId: string;
    /** Current Stripe dispute status. */
    status: DisputeStatus;
}

/**
 * Per-dispute evidence/progress result.
 *
 * `evidenceUploaded` and `evidenceSubmitted` mirror the same-named fields on
 * {@link DisputeItem} and represent whether each of the two progress steps is
 * COMPLETE (true) or OUTSTANDING (false).
 */
export interface DisputeProgress {
    /** The dispute's Stripe payment id (echoed from the input). */
    paymentId: string;
    /** The dispute's Stripe status (echoed from the input). */
    status: DisputeStatus;
    /** True when the Evidence_Upload step is complete. */
    evidenceUploaded: boolean;
    /** True when the Evidence_Submission step is complete. */
    evidenceSubmitted: boolean;
    /**
     * The most-recent batch folder number that holds this dispute's evidence,
     * or null when no evidence was found in S3. Mirrors {@link DisputeItem.evidenceBatch}.
     */
    batchNumber: number | null;
}

// Type-level guarantee that DisputeProgress carries the two flags DisputeItem
// exposes; if the shared model changes, this line fails to compile.
type _EvidenceFlagsMatchDisputeItem = [
    DisputeProgress['evidenceUploaded'],
    DisputeProgress['evidenceSubmitted'],
] extends [DisputeItem['evidenceUploaded'], DisputeItem['evidenceSubmitted']]
    ? true
    : never;
const _evidenceFlagsMatch: _EvidenceFlagsMatchDisputeItem = true;
void _evidenceFlagsMatch;

/**
 * Statuses for which BOTH progress steps are considered complete.
 *
 * Requirement 7.5: once a dispute is under review, won, or lost, the evidence
 * has necessarily been uploaded and submitted, so both steps are complete
 * regardless of what S3 currently shows.
 */
const BOTH_STEPS_COMPLETE_STATUSES: ReadonlySet<DisputeStatus> = new Set([
    'under_review',
    'won',
    'lost',
]);

/**
 * Evidence upload detection (design Property 16; Requirements 7.1, 7.2, 7.3).
 *
 * Evidence is considered uploaded IF AND ONLY IF at least one listed object has
 * a size greater than zero bytes. Empty listings and listings that contain only
 * zero-byte objects therefore count as "not uploaded".
 *
 * @param objects Objects found under the dispute's batch/payment prefix.
 */
export function isEvidenceUploaded(objects: readonly S3ObjectSummary[]): boolean {
    return objects.some((object) => object.size > 0);
}

/**
 * Builds the S3 key prefix for a dispute's evidence within a specific batch:
 * `batches/<number>/<payment-id>/` (Requirement 7.1).
 */
export function buildEvidencePrefix(batchNumber: number, paymentId: string): string {
    return `${BATCHES_PREFIX}${batchNumber}/${paymentId}/`;
}

/**
 * Extracts the batch number for `paymentId` from an object key, or null when
 * the key does not belong to that payment's evidence folder.
 *
 * A key qualifies only when it has the shape `batches/<digits>/<paymentId>/…`,
 * i.e. there is at least one file segment beneath the payment-id folder.
 */
function batchNumberForKey(key: string, paymentId: string): number | null {
    if (!key.startsWith(BATCHES_PREFIX)) {
        return null;
    }
    const segments = key.slice(BATCHES_PREFIX.length).split('/');
    // Need: <number> / <paymentId> / <file...>
    if (segments.length < 3) {
        return null;
    }
    const [numberSegment, paymentSegment] = segments;
    if (paymentSegment !== paymentId) {
        return null;
    }
    if (!/^\d+$/.test(numberSegment)) {
        return null;
    }
    return Number(numberSegment);
}

/**
 * Selects the objects belonging to the MOST RECENT batch folder that contains a
 * subfolder for `paymentId` (Requirement 7.1).
 *
 * "Most recent" is defined as the highest numeric batch folder — batches are
 * created with monotonically increasing numbers, so the largest number is the
 * newest. Returns null when no batch contains evidence for the payment id.
 *
 * @param objects A flat listing of objects under {@link BATCHES_PREFIX}.
 * @param paymentId The dispute's payment id (the subfolder name to match).
 */
export function selectMostRecentBatchObjects(
    objects: readonly S3ObjectSummary[],
    paymentId: string,
): { batchNumber: number; objects: S3ObjectSummary[] } | null {
    let latestBatch: number | null = null;
    for (const object of objects) {
        const batchNumber = batchNumberForKey(object.key, paymentId);
        if (batchNumber === null) {
            continue;
        }
        if (latestBatch === null || batchNumber > latestBatch) {
            latestBatch = batchNumber;
        }
    }
    if (latestBatch === null) {
        return null;
    }
    return {
        batchNumber: latestBatch,
        objects: objects.filter(
            (object) => batchNumberForKey(object.key, paymentId) === latestBatch,
        ),
    };
}

/**
 * Dispute progress step classification (design Property 17; Requirements 7.4, 7.5).
 *
 * Given whether evidence was found in S3 and the Stripe dispute status, decides
 * whether each of the two steps is complete:
 *
 *   - Both steps are complete when the status is 'under_review', 'won', or
 *     'lost' (Requirement 7.5).
 *   - Otherwise Evidence_Submission is outstanding (it only completes once the
 *     dispute moves to one of the statuses above). In particular, when evidence
 *     has been uploaded and the status is 'needs_response' /
 *     'warning_needs_response', submission is the outstanding step
 *     (Requirement 7.4).
 *   - Evidence_Upload is outstanding IF AND ONLY IF no evidence was uploaded and
 *     the dispute is still open (reuses {@link isOpenDispute}); for any other
 *     state the upload step is treated as complete.
 *
 * Pure function: same inputs always produce the same output.
 */
export function classifyDisputeProgress(
    evidenceUploaded: boolean,
    status: DisputeStatus,
): { evidenceUploaded: boolean; evidenceSubmitted: boolean } {
    if (BOTH_STEPS_COMPLETE_STATUSES.has(status)) {
        return { evidenceUploaded: true, evidenceSubmitted: true };
    }

    // Evidence_Upload is only "outstanding" for an open dispute that has no
    // uploaded evidence; otherwise the step counts as complete.
    const uploadOutstanding = isOpenDispute(status) && !evidenceUploaded;

    return {
        evidenceUploaded: !uploadOutstanding,
        // Evidence_Submission completes only via the both-complete statuses
        // handled above; for every open/unresolved status it is outstanding.
        evidenceSubmitted: false,
    };
}

/** Construction options for {@link S3Collector}. */
export interface S3CollectorOptions {
    /** Bucket holding evidence docs. Defaults to {@link DISPUTE_DOCS_BUCKET}. */
    bucket?: string;
    /**
     * Supplies the set of open disputes to check. Injected so this collector
     * stays independent of the Stripe collector; the wiring task (8.1) provides
     * a function backed by the latest Stripe dispute data.
     */
    getOpenDisputes: () => OpenDisputeInput[] | Promise<OpenDisputeInput[]>;
}

/**
 * Collector that enriches open disputes with S3 evidence flags.
 *
 * Conforms to {@link MetricCollector} so the scheduler can run it, but its
 * `metricKeys` is empty: the S3 side cannot assemble a full `DisputeMetrics`
 * (which needs Stripe-sourced deadlines and amounts), so it exposes
 * {@link checkEvidence} as the integration point for task 8.1 instead of writing
 * a cache entry directly.
 */
export class S3Collector implements MetricCollector {
    readonly name = 'S3';

    /**
     * Empty by design: the disputes cache entry is assembled by the wiring task
     * (8.1) from the Stripe dispute list merged with {@link checkEvidence}'s
     * output. See the module header for the integration notes.
     */
    readonly metricKeys: readonly MetricKey[] = [];

    private readonly client: S3ClientPort;
    private readonly bucket: string;
    private readonly getOpenDisputes: () => OpenDisputeInput[] | Promise<OpenDisputeInput[]>;

    constructor(client: S3ClientPort, options: S3CollectorOptions) {
        this.client = client;
        this.bucket = options.bucket ?? DISPUTE_DOCS_BUCKET;
        this.getOpenDisputes = options.getOpenDisputes;
    }

    /** The evidence-docs bucket this collector inspects. */
    getBucket(): string {
        return this.bucket;
    }

    /**
     * Determines evidence/progress for each supplied open dispute.
     *
     * Lists the objects under {@link BATCHES_PREFIX} once, then for every dispute
     * selects the most recent batch folder containing that payment id
     * (Requirement 7.1), decides upload status from the listed object sizes
     * (Property 16), and classifies the two progress steps (Property 17).
     *
     * This is the method the wiring task (8.1) calls with the Stripe dispute list
     * to populate `DisputeItem.evidenceUploaded` / `.evidenceSubmitted`.
     */
    async checkEvidence(
        disputes: readonly OpenDisputeInput[],
    ): Promise<DisputeProgress[]> {
        // A single listing under `batches/` is reused for every dispute so we
        // make one S3 round-trip regardless of dispute count.
        const objects = await this.client.listObjects(BATCHES_PREFIX);

        return disputes.map((dispute) => {
            const batch = selectMostRecentBatchObjects(objects, dispute.paymentId);
            const uploaded = isEvidenceUploaded(batch?.objects ?? []);
            const progress = classifyDisputeProgress(uploaded, dispute.status);
            return {
                paymentId: dispute.paymentId,
                status: dispute.status,
                evidenceUploaded: progress.evidenceUploaded,
                evidenceSubmitted: progress.evidenceSubmitted,
                // Surface the batch number only when evidence was actually found
                // in S3; a batch folder with no non-empty objects does not count.
                batchNumber: uploaded && batch !== null ? batch.batchNumber : null,
            };
        });
    }

    /**
     * Scheduler entry point. Performs the evidence lookup for the current open
     * disputes so failures/timeouts surface through the scheduler, but returns
     * an empty result set: the `disputes` cache entry is assembled by the wiring
     * task (8.1), not by this collector alone. See the module header.
     */
    async collect(): Promise<CollectedMetrics> {
        const disputes = await this.getOpenDisputes();
        await this.checkEvidence(disputes);
        return {};
    }
}
