// Unit tests for SystemHealthWidget's pure presentation helpers.
//
// The widget's React rendering is intentionally thin; the requirement-bearing
// logic (status colour mapping, alert highlight, uptime/API formatting, and
// per-service staleness) lives in DOM-free helpers so it can be tested directly
// without a DOM environment.

import { describe, expect, it } from 'vitest';
import type { ServiceHealth } from '@fans-fund-me/shared';
import {
    formatErrorRate,
    formatLatency,
    formatUptime,
    isServiceStale,
    serviceCardClass,
    statusColorClass,
    statusLabel,
} from './SystemHealthWidget';

function makeService(overrides: Partial<ServiceHealth> = {}): ServiceHealth {
    return {
        name: 'api',
        status: 'healthy',
        uptime24h: '99.95',
        uptime7d: '99.90',
        alertFiring: false,
        lastUpdated: new Date().toISOString(),
        ...overrides,
    };
}

describe('statusLabel', () => {
    it('maps each status to a human label', () => {
        expect(statusLabel('healthy')).toBe('Healthy');
        expect(statusLabel('degraded')).toBe('Degraded');
        expect(statusLabel('down')).toBe('Down');
    });
});

describe('statusColorClass (Req 5.1)', () => {
    it('uses success green for healthy', () => {
        expect(statusColorClass('healthy')).toBe('text-success');
    });

    it('uses the gold accent for degraded and danger red for down, keeping them distinct', () => {
        const degraded = statusColorClass('degraded');
        const down = statusColorClass('down');
        expect(degraded).toBe('text-accent');
        expect(down).toBe('text-danger');
        expect(degraded).not.toBe(down);
    });
});

describe('serviceCardClass (Req 5.4)', () => {
    it('applies the gold accent highlight when an alert is firing', () => {
        const highlighted = serviceCardClass(true);
        expect(highlighted).toContain('border-accent');
        expect(highlighted).toContain('bg-accent/10');
    });

    it('uses the neutral border when no alert is firing', () => {
        const normal = serviceCardClass(false);
        expect(normal).toContain('border-border');
        expect(normal).not.toContain('border-accent');
    });
});

describe('uptime and API metric formatting (Req 5.2, 5.3)', () => {
    it('appends a percent sign to uptime strings', () => {
        expect(formatUptime('99.95')).toBe('99.95%');
        expect(formatUptime('100.00')).toBe('100.00%');
    });

    it('formats error rate as errors/min', () => {
        expect(formatErrorRate(0)).toBe('0 errors/min');
        expect(formatErrorRate(3.5)).toBe('3.5 errors/min');
    });

    it('formats latency in ms', () => {
        expect(formatLatency(0)).toBe('0 ms');
        expect(formatLatency(125)).toBe('125 ms');
    });
});

describe('isServiceStale (Req 5.7)', () => {
    const now = Date.parse('2024-01-01T00:02:00.000Z');

    it('is not stale at exactly the 120s threshold', () => {
        const service = makeService({
            lastUpdated: '2024-01-01T00:00:00.000Z',
        });
        // 120s elapsed — the threshold is exclusive (> 120s).
        expect(isServiceStale(service, now)).toBe(false);
    });

    it('is stale once data is older than 120s', () => {
        const service = makeService({
            lastUpdated: '2023-12-31T23:59:59.000Z',
        });
        // 121s elapsed.
        expect(isServiceStale(service, now)).toBe(true);
    });

    it('treats a missing/invalid timestamp as stale', () => {
        const service = makeService({ lastUpdated: 'not-a-date' });
        expect(isServiceStale(service, now)).toBe(true);
    });
});
