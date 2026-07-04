// Property-based tests for the GrafanaCollector's pure health-derivation
// helpers.
//
// Feature: ops-dashboard, Property 10: Service health status classification
// Feature: ops-dashboard, Property 11: Uptime and rate metric calculations
//
// Task 6.10 / Property 10 (Validates Requirement 5.1): for any set of metric
// values, classifyServiceHealth SHALL return exactly one of ('healthy',
// 'degraded', 'down'), the result SHALL be deterministic (same inputs always
// produce the same output), and SHALL follow the documented threshold ordering
// (down when unreachable or uptime <= DOWN threshold; degraded when an alert is
// firing / uptime < DEGRADED threshold / error rate > threshold; healthy
// otherwise).
//
// Task 6.11 / Property 11 (Validates Requirements 5.2, 5.3): for any uptime
// measurements the percentage SHALL equal ((total - downtime) / total × 100)
// rounded to 2dp; the error rate SHALL equal (errors / minutes); and the
// average latency SHALL equal (sum / count) — each with a documented 0 fallback
// for the divide-by-zero edge cases (totalSeconds <= 0, windowMinutes <= 0,
// empty latency array).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    classifyServiceHealth,
    calculateUptimePercentage,
    calculateErrorRatePerMinute,
    calculateAverageLatencyMs,
    DOWN_UPTIME_THRESHOLD_PERCENT,
    DEGRADED_UPTIME_THRESHOLD_PERCENT,
    DEGRADED_ERROR_RATE_PER_MINUTE,
    type ServiceHealthClassificationInput,
} from './grafana-collector.js';
import type { ServiceHealth } from '@fans-fund-me/shared';

const ALLOWED_STATUSES: ReadonlyArray<ServiceHealth['status']> = [
    'healthy',
    'degraded',
    'down',
];

/**
 * Independent oracle mirroring the documented classification contract. Kept
 * deliberately separate from the implementation's control flow so the test
 * checks the specified thresholds rather than re-deriving via the same code.
 */
function expectedStatus(input: ServiceHealthClassificationInput): ServiceHealth['status'] {
    if (!input.reachable || input.uptime24hPercent <= DOWN_UPTIME_THRESHOLD_PERCENT) {
        return 'down';
    }
    if (
        input.alertFiring ||
        input.uptime24hPercent < DEGRADED_UPTIME_THRESHOLD_PERCENT ||
        input.errorRatePerMinute > DEGRADED_ERROR_RATE_PER_MINUTE
    ) {
        return 'degraded';
    }
    return 'healthy';
}

// A generator that spreads uptime percentages across the whole [0, 100] range
// and also lands squarely on the two thresholds so the boundary behaviour
// (<= DOWN, < DEGRADED) is exercised.
const uptimePercentArb = fc.oneof(
    { weight: 4, arbitrary: fc.double({ min: 0, max: 100, noNaN: true }) },
    {
        weight: 1,
        arbitrary: fc.constantFrom(
            0,
            DOWN_UPTIME_THRESHOLD_PERCENT,
            DOWN_UPTIME_THRESHOLD_PERCENT + 0.01,
            DEGRADED_UPTIME_THRESHOLD_PERCENT,
            DEGRADED_UPTIME_THRESHOLD_PERCENT - 0.01,
            DEGRADED_UPTIME_THRESHOLD_PERCENT + 0.01,
            100,
        ),
    },
);

// Error rates spanning below, at, and above the degraded threshold.
const errorRateArb = fc.oneof(
    { weight: 4, arbitrary: fc.double({ min: 0, max: 50, noNaN: true }) },
    {
        weight: 1,
        arbitrary: fc.constantFrom(
            0,
            DEGRADED_ERROR_RATE_PER_MINUTE,
            DEGRADED_ERROR_RATE_PER_MINUTE + 0.001,
        ),
    },
);

const classificationInputArb: fc.Arbitrary<ServiceHealthClassificationInput> = fc.record({
    reachable: fc.boolean(),
    alertFiring: fc.boolean(),
    uptime24hPercent: uptimePercentArb,
    errorRatePerMinute: errorRateArb,
});

describe('classifyServiceHealth (Property 10: Service health status classification)', () => {
    it('always returns exactly one of the three allowed statuses', () => {
        fc.assert(
            fc.property(classificationInputArb, (input) => {
                expect(ALLOWED_STATUSES).toContain(classifyServiceHealth(input));
            }),
            { numRuns: 100 },
        );
    });

    it('is deterministic — identical inputs always yield the same status', () => {
        fc.assert(
            fc.property(classificationInputArb, (input) => {
                const first = classifyServiceHealth(input);
                const second = classifyServiceHealth({ ...input });
                expect(second).toBe(first);
            }),
            { numRuns: 100 },
        );
    });

    it('follows the documented threshold ordering (down > degraded > healthy)', () => {
        fc.assert(
            fc.property(classificationInputArb, (input) => {
                expect(classifyServiceHealth(input)).toBe(expectedStatus(input));
            }),
            { numRuns: 100 },
        );
    });
});

// --- Property 11: uptime / rate / latency calculations ---------------------

/** Reconstructs the source's 2dp rounding (round half away from zero). */
function roundTo2dp(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Positive window widths (the non-edge case) plus finite downtime values.
const positiveTotalArb = fc.double({ min: 1, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
const downtimeArb = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

// Non-positive totals to confirm the documented 0 fallback (divide-by-zero).
const nonPositiveTotalArb = fc.double({
    min: -1_000_000,
    max: 0,
    noNaN: true,
    noDefaultInfinity: true,
});

describe('calculateUptimePercentage (Property 11: Uptime metric calculation)', () => {
    it('equals ((total - downtime) / total × 100) rounded to 2dp for a positive window', () => {
        fc.assert(
            fc.property(positiveTotalArb, downtimeArb, (totalSeconds, downtimeSeconds) => {
                const expected = roundTo2dp(
                    ((totalSeconds - downtimeSeconds) / totalSeconds) * 100,
                );
                expect(calculateUptimePercentage(totalSeconds, downtimeSeconds)).toBe(expected);
            }),
            { numRuns: 100 },
        );
    });

    it('returns 0 for a non-positive window (divide-by-zero fallback)', () => {
        fc.assert(
            fc.property(nonPositiveTotalArb, downtimeArb, (totalSeconds, downtimeSeconds) => {
                expect(calculateUptimePercentage(totalSeconds, downtimeSeconds)).toBe(0);
            }),
            { numRuns: 100 },
        );
    });
});

// Error counts and window widths.
const errorCountArb = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
const positiveWindowArb = fc.double({ min: 1, max: 1440, noNaN: true, noDefaultInfinity: true });
const nonPositiveWindowArb = fc.double({ min: -1440, max: 0, noNaN: true, noDefaultInfinity: true });

describe('calculateErrorRatePerMinute (Property 11: Error rate calculation)', () => {
    it('equals errorCount / windowMinutes for a positive window', () => {
        fc.assert(
            fc.property(errorCountArb, positiveWindowArb, (errorCount, windowMinutes) => {
                expect(calculateErrorRatePerMinute(errorCount, windowMinutes)).toBe(
                    errorCount / windowMinutes,
                );
            }),
            { numRuns: 100 },
        );
    });

    it('returns 0 for a non-positive window (divide-by-zero fallback)', () => {
        fc.assert(
            fc.property(errorCountArb, nonPositiveWindowArb, (errorCount, windowMinutes) => {
                expect(calculateErrorRatePerMinute(errorCount, windowMinutes)).toBe(0);
            }),
            { numRuns: 100 },
        );
    });
});

const latencyArb = fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true });

describe('calculateAverageLatencyMs (Property 11: Average latency calculation)', () => {
    it('equals sum / count for a non-empty sample set', () => {
        fc.assert(
            fc.property(
                fc.array(latencyArb, { minLength: 1, maxLength: 200 }),
                (latenciesMs) => {
                    const sum = latenciesMs.reduce((acc, latency) => acc + latency, 0);
                    // Reconstruct the average the same way the source does so any
                    // floating-point rounding matches exactly.
                    const expected = sum / latenciesMs.length;
                    expect(calculateAverageLatencyMs(latenciesMs)).toBe(expected);
                },
            ),
            { numRuns: 100 },
        );
    });

    it('returns 0 for an empty sample set (documented fallback)', () => {
        expect(calculateAverageLatencyMs([])).toBe(0);
    });
});
