import { describe, it, expect } from 'vitest';
import type { DashboardConfig } from '@fans-fund-me/shared';
import { reconcileConfig, createDefaultConfig } from './useWidgetConfig';

function config(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
    return {
        version: 1,
        refreshIntervalMinutes: 5,
        layout: [],
        widgets: [],
        ...overrides,
    };
}

describe('reconcileConfig', () => {
    it('synthesizes a layout entry for a visible widget that has none', () => {
        // The bug that hid "on" widgets: a visible widget with no layout entry.
        const c = config({
            widgets: [
                { id: 'revenue', type: 'revenue', visible: true },
                { id: 'payment-counts', type: 'payment-counts', visible: true },
            ],
            layout: [{ i: 'revenue', x: 0, y: 0, w: 4, h: 4 }],
        });

        const result = reconcileConfig(c);

        const ids = result.layout.map((l) => l.i).sort();
        expect(ids).toEqual(['payment-counts', 'revenue']);
        // The synthesized entry sits below the existing content (no overlap).
        const added = result.layout.find((l) => l.i === 'payment-counts');
        expect(added?.y).toBeGreaterThanOrEqual(4);
    });

    it('drops orphan layout entries with no matching widget', () => {
        const c = config({
            widgets: [{ id: 'revenue', type: 'revenue', visible: true }],
            layout: [
                { i: 'revenue', x: 0, y: 0, w: 4, h: 4 },
                { i: 'ghost', x: 4, y: 0, w: 4, h: 4 },
            ],
        });
        const result = reconcileConfig(c);
        expect(result.layout.map((l) => l.i)).toEqual(['revenue']);
    });

    it('does not add a layout entry for a hidden (visible:false) widget', () => {
        const c = config({
            widgets: [{ id: 'revenue', type: 'revenue', visible: false }],
            layout: [],
        });
        expect(reconcileConfig(c).layout).toEqual([]);
    });

    it('is a no-op when layout and widgets already correspond 1:1', () => {
        const c = createDefaultConfig();
        expect(reconcileConfig(c)).toEqual(c);
    });
});
