import { describe, it, expect } from 'vitest';
import type { DashboardConfig, WidgetType } from '@fans-fund-me/shared';
import { createDefaultConfig } from '../hooks/useWidgetConfig';
import {
    addWidget,
    clampRefreshIntervalMinutes,
    DEFAULT_ADDED_WIDGET_H,
    DEFAULT_ADDED_WIDGET_MIN_H,
    DEFAULT_ADDED_WIDGET_MIN_W,
    DEFAULT_ADDED_WIDGET_W,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    isWidgetPresent,
    MAX_REFRESH_INTERVAL_MINUTES,
    MIN_REFRESH_INTERVAL_MINUTES,
    presentWidgetTypes,
    removeWidget,
    setRefreshIntervalMinutes,
} from './ConfigPanel';

/** An empty-but-valid config for tests that need a clean slate. */
function emptyConfig(): DashboardConfig {
    return {
        version: 1,
        refreshIntervalMinutes: 5,
        layout: [],
        widgets: [],
    };
}

describe('clampRefreshIntervalMinutes (Requirement 8.1, mirrors Property 19)', () => {
    it('clamps values below the minimum up to 1', () => {
        expect(clampRefreshIntervalMinutes(0)).toBe(MIN_REFRESH_INTERVAL_MINUTES);
        expect(clampRefreshIntervalMinutes(-17)).toBe(
            MIN_REFRESH_INTERVAL_MINUTES,
        );
    });

    it('clamps values above the maximum down to 60', () => {
        expect(clampRefreshIntervalMinutes(61)).toBe(
            MAX_REFRESH_INTERVAL_MINUTES,
        );
        expect(clampRefreshIntervalMinutes(10_000)).toBe(
            MAX_REFRESH_INTERVAL_MINUTES,
        );
    });

    it('rounds in-range values to the nearest integer', () => {
        expect(clampRefreshIntervalMinutes(5)).toBe(5);
        expect(clampRefreshIntervalMinutes(12.4)).toBe(12);
        expect(clampRefreshIntervalMinutes(12.6)).toBe(13);
    });

    it('keeps the exact boundary values', () => {
        expect(clampRefreshIntervalMinutes(1)).toBe(1);
        expect(clampRefreshIntervalMinutes(60)).toBe(60);
    });

    it('defaults non-finite / non-numeric input to 5', () => {
        expect(clampRefreshIntervalMinutes(Number.NaN)).toBe(
            DEFAULT_REFRESH_INTERVAL_MINUTES,
        );
        expect(clampRefreshIntervalMinutes(Number.POSITIVE_INFINITY)).toBe(
            DEFAULT_REFRESH_INTERVAL_MINUTES,
        );
        expect(clampRefreshIntervalMinutes('30')).toBe(
            DEFAULT_REFRESH_INTERVAL_MINUTES,
        );
        expect(clampRefreshIntervalMinutes(undefined)).toBe(
            DEFAULT_REFRESH_INTERVAL_MINUTES,
        );
        expect(clampRefreshIntervalMinutes(null)).toBe(
            DEFAULT_REFRESH_INTERVAL_MINUTES,
        );
    });
});

describe('isWidgetPresent / presentWidgetTypes', () => {
    it('reports presence based on widget type', () => {
        const config = createDefaultConfig();
        expect(isWidgetPresent(config, 'revenue')).toBe(true);
        const removed = removeWidget(config, 'revenue');
        expect(isWidgetPresent(removed, 'revenue')).toBe(false);
    });

    it('returns the set of present widget types', () => {
        const config = emptyConfig();
        const withRevenue = addWidget(config, 'revenue');
        const types = presentWidgetTypes(withRevenue);
        expect(types.has('revenue')).toBe(true);
        expect(types.size).toBe(1);
    });
});

describe('addWidget (Requirement 2.1)', () => {
    it('inserts both a WidgetInstance and a LayoutItem for the type', () => {
        const config = emptyConfig();
        const next = addWidget(config, 'revenue');

        expect(next.widgets).toHaveLength(1);
        expect(next.widgets[0]).toEqual({
            id: 'revenue',
            type: 'revenue',
            visible: true,
        });

        expect(next.layout).toHaveLength(1);
        expect(next.layout[0]).toMatchObject({
            i: 'revenue',
            w: DEFAULT_ADDED_WIDGET_W,
            h: DEFAULT_ADDED_WIDGET_H,
            minW: DEFAULT_ADDED_WIDGET_MIN_W,
            minH: DEFAULT_ADDED_WIDGET_MIN_H,
        });
    });

    it('appends the new widget below existing layout items', () => {
        const config: DashboardConfig = {
            ...emptyConfig(),
            widgets: [{ id: 'revenue', type: 'revenue', visible: true }],
            layout: [{ i: 'revenue', x: 0, y: 0, w: 4, h: 4 }],
        };
        const next = addWidget(config, 'system-health');
        const added = next.layout.find((l) => l.i === 'system-health');
        expect(added).toBeDefined();
        // Below the existing item (which ends at y = 0 + 4 = 4).
        expect(added?.y).toBe(4);
    });

    it('is a no-op when the widget type is already present', () => {
        const config = addWidget(emptyConfig(), 'revenue');
        const again = addWidget(config, 'revenue');
        expect(again).toBe(config);
        expect(again.widgets).toHaveLength(1);
        expect(again.layout).toHaveLength(1);
    });

    it('does not mutate the input config', () => {
        const config = emptyConfig();
        addWidget(config, 'revenue');
        expect(config.widgets).toHaveLength(0);
        expect(config.layout).toHaveLength(0);
    });
});

describe('removeWidget (Requirement 2.1)', () => {
    it('drops both the WidgetInstance and its LayoutItem', () => {
        const config = createDefaultConfig();
        const next = removeWidget(config, 'revenue');
        expect(next.widgets.some((w) => w.type === 'revenue')).toBe(false);
        expect(next.layout.some((l) => l.i === 'revenue')).toBe(false);
        // Other widgets are untouched.
        expect(next.widgets).toHaveLength(config.widgets.length - 1);
        expect(next.layout).toHaveLength(config.layout.length - 1);
    });

    it('is a no-op when the widget type is not present', () => {
        const config = emptyConfig();
        const next = removeWidget(config, 'revenue');
        expect(next).toBe(config);
    });

    it('does not mutate the input config', () => {
        const config = createDefaultConfig();
        const originalWidgetCount = config.widgets.length;
        removeWidget(config, 'revenue');
        expect(config.widgets).toHaveLength(originalWidgetCount);
    });
});

describe('add then remove round-trips cleanly', () => {
    it('returns to an equivalent empty state', () => {
        const config = emptyConfig();
        const added = addWidget(config, 'transaction-feed');
        const removed = removeWidget(added, 'transaction-feed');
        expect(removed.widgets).toHaveLength(0);
        expect(removed.layout).toHaveLength(0);
    });

    it('supports every known widget type as an add target', () => {
        const types: WidgetType[] = [
            'revenue',
            'payment-counts',
            'user-growth',
            'system-health',
            'dispute-countdown',
            'dispute-progress',
            'transaction-feed',
            'platform-summary',
        ];
        let config = emptyConfig();
        for (const type of types) {
            config = addWidget(config, type);
        }
        expect(config.widgets).toHaveLength(types.length);
        expect(config.layout).toHaveLength(types.length);
    });
});

describe('setRefreshIntervalMinutes (Requirement 8.1)', () => {
    it('updates the interval with a clamped value', () => {
        const config = emptyConfig();
        expect(setRefreshIntervalMinutes(config, 100).refreshIntervalMinutes).toBe(
            60,
        );
        expect(setRefreshIntervalMinutes(config, 0).refreshIntervalMinutes).toBe(
            1,
        );
        expect(setRefreshIntervalMinutes(config, 15).refreshIntervalMinutes).toBe(
            15,
        );
    });

    it('leaves the rest of the config untouched and does not mutate the input', () => {
        const config = createDefaultConfig();
        const next = setRefreshIntervalMinutes(config, 30);
        expect(next.widgets).toEqual(config.widgets);
        expect(next.layout).toEqual(config.layout);
        expect(config.refreshIntervalMinutes).toBe(5);
    });
});
