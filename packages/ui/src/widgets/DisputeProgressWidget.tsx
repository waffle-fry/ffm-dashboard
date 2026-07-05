// DisputeProgressWidget — per-dispute two-step progress indicator.
//
// For every open dispute the engine returns, this widget renders a two-step
// progress indicator so the ops team can see which part of the dispute process
// is still outstanding and coordinate work (Requirement 7.6).
//
// Requirement 7.6: display each open dispute with a two-step progress indicator
//   labelled exactly "Evidence Upload" and "Evidence Submission", showing
//   each step as either "Complete" or "Outstanding".
// Requirements 7.4 / 7.5: the completion of each step is decided by the engine
//   (S3 + Stripe status) and delivered as the `evidenceUploaded` /
//   `evidenceSubmitted` booleans on each `DisputeItem`. This widget purely
//   reflects those booleans — the Upload step mirrors `evidenceUploaded` and the
//   Submission step mirrors `evidenceSubmitted`.
//
// Data comes from `useMetrics<DisputeMetrics>('disputes')` (polls
// `/api/metrics/disputes`) and manual refresh is wired through
// `useRefresh().refreshWidget('disputes')`. The base `Widget` provides the
// shared chrome (title bar, last-refreshed timestamp, loading/error/stale
// indicators, refresh button).
//
// Brand note (Requirement 1.1): gold is reserved for highlights/alerts, so a
// "Complete" step uses the neutral/positive success green and an "Outstanding"
// step uses a subtle neutral-muted treatment — gold is intentionally not used
// here.
//
// Design: the mapping from a `DisputeItem` to its two rendered steps lives in
// the pure, DOM-free helper `disputeProgressSteps` (and its label constants) so
// it can be unit-tested directly without React or a DOM.

import type { DisputeItem, DisputeMetrics } from '@fans-fund-me/shared';
import Widget from '../components/Widget';
import { useMetrics } from '../hooks/useMetrics';
import { useRefresh } from '../hooks/useRefresh';

/** Exact label for the first (Evidence Upload) step (Requirement 7.6). */
export const EVIDENCE_UPLOAD_LABEL = 'Evidence Upload';
/** Exact label for the second (Evidence Submission) step (Requirement 7.6). */
export const EVIDENCE_SUBMISSION_LABEL = 'Evidence Submission';

/** The two literal status texts a step can display (Requirement 7.6). */
export type StepStatusLabel = 'Complete' | 'Outstanding';

/** A single rendered progress step. */
export interface ProgressStep {
    /** The exact, human-readable step label. */
    label: string;
    /** Whether this step is complete. */
    complete: boolean;
    /** The literal status text to show: "Complete" or "Outstanding". */
    statusLabel: StepStatusLabel;
}

/** Map a completion boolean to its literal status text (Requirement 7.6). */
export function stepStatusLabel(complete: boolean): StepStatusLabel {
    return complete ? 'Complete' : 'Outstanding';
}

/**
 * Build the two ordered progress steps for a dispute (Requirement 7.6).
 *
 * The Upload step reflects `evidenceUploaded` and the Submission step reflects
 * `evidenceSubmitted` — the booleans the engine computes per Requirements
 * 7.4/7.5. Order is always [Upload, Submission].
 */
export function disputeProgressSteps(dispute: DisputeItem): ProgressStep[] {
    return [
        {
            label: EVIDENCE_UPLOAD_LABEL,
            complete: dispute.evidenceUploaded,
            statusLabel: stepStatusLabel(dispute.evidenceUploaded),
        },
        {
            label: EVIDENCE_SUBMISSION_LABEL,
            complete: dispute.evidenceSubmitted,
            statusLabel: stepStatusLabel(dispute.evidenceSubmitted),
        },
    ];
}

/** Presentational badge for a single step's status. */
function StepBadge({ step }: { step: ProgressStep }): JSX.Element {
    // Complete -> positive/neutral green; Outstanding -> subtle muted neutral.
    // Gold stays reserved for alerts (Requirement 1.1), so it is not used here.
    const badgeClasses = step.complete
        ? 'border-success/40 bg-success/10 text-success'
        : 'border-border bg-surface-raised text-text-secondary';
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-text-primary">
                {step.label}
            </span>
            <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClasses}`}
            >
                {step.statusLabel}
            </span>
        </div>
    );
}

/** Progress card for a single dispute: identity + amount + its two steps. */
function DisputeProgressCard({
    dispute,
}: {
    dispute: DisputeItem;
}): JSX.Element {
    const steps = disputeProgressSteps(dispute);
    return (
        <li className="rounded-md border border-border bg-surface p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-mono font-medium text-text-primary">
                    {dispute.paymentId}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-text-primary">
                    ${dispute.amountUsd}
                </span>
            </div>
            <div className="flex flex-col gap-1.5">
                {steps.map((step) => (
                    <StepBadge key={step.label} step={step} />
                ))}
            </div>
            {dispute.evidenceUploaded && dispute.evidenceBatch !== null && (
                <div className="mt-2 text-xs text-text-secondary">
                    Evidence in batch #{dispute.evidenceBatch}
                </div>
            )}
        </li>
    );
}

/**
 * DisputeProgressWidget — renders a two-step progress indicator for every open
 * dispute returned by the engine (Requirement 7.6).
 */
export default function DisputeProgressWidget(): JSX.Element {
    const { data, lastRefreshed, error, isStale, isLoading, refetch } =
        useMetrics<DisputeMetrics>('disputes');
    const { refreshWidget } = useRefresh();

    const disputes = data?.disputes ?? [];
    const evidenceError = data?.evidenceError ?? null;

    const handleRefresh = (): void => {
        void refreshWidget('disputes').then(() => refetch());
    };

    return (
        <Widget
            title="Dispute Progress"
            lastRefreshed={lastRefreshed}
            isLoading={isLoading}
            error={error}
            isStale={isStale}
            onRefresh={handleRefresh}
        >
            {/* Non-fatal S3 evidence warning (Req 7): dispute amounts/deadlines
                still show, but the evidence (upload/batch) columns are
                unavailable — e.g. the engine lacks S3 read permissions. */}
            {evidenceError && (
                <div
                    role="alert"
                    className="mb-2 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
                >
                    <span aria-hidden="true">⚠</span>
                    <span className="min-w-0">
                        Evidence status unavailable (S3): {evidenceError}
                    </span>
                </div>
            )}
            {disputes.length === 0 ? (
                <p className="text-text-secondary">No open disputes</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {disputes.map((dispute) => (
                        <DisputeProgressCard
                            key={dispute.paymentId}
                            dispute={dispute}
                        />
                    ))}
                </ul>
            )}
        </Widget>
    );
}
