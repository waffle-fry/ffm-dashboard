import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DashboardConfig } from '@fans-fund-me/shared';
import {
    createDefaultConfig,
    DEFAULT_DASHBOARD_CONFIG,
    DASHBOARD_CONFIG_VERSION,
    KNOWN_WIDGET_TYPES,
    migrateConfig,
    parseStoredConfig,
    WIDGET_CONFIG_STORAGE_KEY,
} from './useWidgetConfig';

// Silence the intentional console.warn calls during fall-back paths so test
// output stays clean, while still allowing assertions on when they fire.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    warnSpy.mockRestore();
});

describe('migrateConfig (adds newly-introduced default widgets)', () => {
    it('adds missing default widgets (e.g. creator-spotlight) to a pre-version config', () => {
        const old: DashboardConfig = {
            version: 1,
            refreshIntervalMinutes: 5,
            layout: [{ i: 'revenue', x: 0, y: 0, w: 4, h: 4 }],
            widgets: [{ id: 'revenue', type: 'revenue', visible: true }],
        };
        const migrated = migrateConfig(old);
        expect(migrated.version).toBe(DASHBOARD_CONFIG_VERSION);
        // The creator-spotlight widget is now present...
        expect(migrated.widgets.some((w) => w.type === 'creator-spotlight')).toBe(
            true,
        );
        // ...with a layout entry placed BELOW the existing content (no overlap).
        const spot = migrated.layout.find((l) => l.i === 'creator-spotlight');
        expect(spot).toBeDefined();
        expect(spot!.y).toBeGreaterThanOrEqual(4);
        // The original widget is preserved.
        expect(migrated.widgets.some((w) => w.id === 'revenue')).toBe(true);
    });

    it('is a no-op for a config already at the current version', () => {
        const current = createDefaultConfig();
        expect(migrateConfig(current)).toBe(current);
    });

    it('does not duplicate widgets that already exist', () => {
        const migrated = migrateConfig({
            ...createDefaultConfig(),
            version: 1,
        });
        const ids = migrated.widgets.map((w) => w.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('WIDGET_CONFIG_STORAGE_KEY', () => {
    it('is a stable, non-empty key', () => {
        expect(typeof WIDGET_CONFIG_STORAGE_KEY).toBe('string');
        expect(WIDGET_CONFIG_STORAGE_KEY.length).toBeGreaterThan(0);
    });
});

describe('DEFAULT_DASHBOARD_CONFIG (Requirement 2.3)', () => {
    it('includes every known widget type, all visible', () => {
        const types = DEFAULT_DASHBOARD_CONFIG.widgets.map((w) => w.type).sort();
        expect(types).toEqual([...KNOWN_WIDGET_TYPES].sort());
        expect(DEFAULT_DASHBOARD_CONFIG.widgets.every((w) => w.visible)).toBe(
            true,
        );
    });

    it('has a layout entry for every widget', () => {
        const layoutIds = new Set(
            DEFAULT_DASHBOARD_CONFIG.layout.map((l) => l.i),
        );
        for (const widget of DEFAULT_DASHBOARD_CONFIG.widgets) {
            expect(layoutIds.has(widget.id)).toBe(true);
        }
        expect(DEFAULT_DASHBOARD_CONFIG.layout.length).toBe(
            DEFAULT_DASHBOARD_CONFIG.widgets.length,
        );
    });

    it('fills the 16-column / 12-row lg grid without overflow (Requirement 1.3)', () => {
        for (const item of DEFAULT_DASHBOARD_CONFIG.layout) {
            expect(item.x).toBeGreaterThanOrEqual(0);
            expect(item.y).toBeGreaterThanOrEqual(0);
            expect(item.x + item.w).toBeLessThanOrEqual(16);
            expect(item.y + item.h).toBeLessThanOrEqual(12);
        }
        // Every column and every row is covered by at least one widget.
        const columnsCovered = new Set<number>();
        const rowsCovered = new Set<number>();
        for (const item of DEFAULT_DASHBOARD_CONFIG.layout) {
            for (let c = item.x; c < item.x + item.w; c++) columnsCovered.add(c);
            for (let r = item.y; r < item.y + item.h; r++) rowsCovered.add(r);
        }
        expect(columnsCovered.size).toBe(16);
        expect(rowsCovered.size).toBe(12);
    });
});

describe('createDefaultConfig', () => {
    it('returns a deep copy that does not mutate the frozen canonical config', () => {
        const a = createDefaultConfig();
        const b = createDefaultConfig();
        expect(a).toEqual(DEFAULT_DASHBOARD_CONFIG);
        expect(a).not.toBe(DEFAULT_DASHBOARD_CONFIG);
        a.layout[0].x = 99;
        a.widgets[0].visible = false;
        // The other copy and the canonical constant are untouched.
        expect(b).toEqual(DEFAULT_DASHBOARD_CONFIG);
        expect(DEFAULT_DASHBOARD_CONFIG.layout[0].x).not.toBe(99);
    });
});

describe('parseStoredConfig fall-backs (Requirement 2.3)', () => {
    it('returns the default config when the stored value is null', () => {
        expect(parseStoredConfig(null)).toEqual(DEFAULT_DASHBOARD_CONFIG);
    });

    it('returns the default config when the stored value is empty', () => {
        expect(parseStoredConfig('')).toEqual(DEFAULT_DASHBOARD_CONFIG);
    });

    it('returns the default config on invalid JSON and warns', () => {
        expect(parseStoredConfig('{not json')).toEqual(
            DEFAULT_DASHBOARD_CONFIG,
        );
        expect(warnSpy).toHaveBeenCalled();
    });

    it('returns the default config for non-object shapes', () => {
        expect(parseStoredConfig('42')).toEqual(DEFAULT_DASHBOARD_CONFIG);
        expect(parseStoredConfig('"a string"')).toEqual(
            DEFAULT_DASHBOARD_CONFIG,
        );
        expect(parseStoredConfig('null')).toEqual(DEFAULT_DASHBOARD_CONFIG);
        expect(parseStoredConfig('[1,2,3]')).toEqual(DEFAULT_DASHBOARD_CONFIG);
    });

    it('returns the default config when widgets/layout are not arrays', () => {
        expect(
            parseStoredConfig(
                JSON.stringify({ version: 1, refreshIntervalMinutes: 5 }),
            ),
        ).toEqual(DEFAULT_DASHBOARD_CONFIG);
        expect(
            parseStoredConfig(
                JSON.stringify({ layout: [], widgets: 'nope' }),
            ),
        ).toEqual(DEFAULT_DASHBOARD_CONFIG);
    });
});

describe('parseStoredConfig round-trip (Requirement 2.2)', () => {
    it('preserves a valid config exactly through serialize -> parse', () => {
        const config: DashboardConfig = {
            version: 3,
            refreshIntervalMinutes: 12,
            layout: [
                { i: 'w1', x: 0, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
                { i: 'w2', x: 4, y: 0, w: 4, h: 4 },
            ],
            widgets: [
                { id: 'w1', type: 'revenue', visible: true },
                { id: 'w2', type: 'system-health', visible: false },
            ],
        };
        expect(parseStoredConfig(JSON.stringify(config))).toEqual(config);
    });

    it('round-trips the default config', () => {
        expect(
            parseStoredConfig(JSON.stringify(DEFAULT_DASHBOARD_CONFIG)),
        ).toEqual(DEFAULT_DASHBOARD_CONFIG);
    });
});

describe('parseStoredConfig invalid widget removal (Requirement 2.5)', () => {
    it('removes unavailable widget types and their layout entries, preserving valid widgets in position', () => {
        const stored = {
            version: 1,
            refreshIntervalMinutes: 5,
            layout: [
                { i: 'keep-1', x: 0, y: 0, w: 4, h: 4 },
                { i: 'gone', x: 4, y: 0, w: 4, h: 4 },
                { i: 'keep-2', x: 8, y: 0, w: 4, h: 4 },
            ],
            widgets: [
                { id: 'keep-1', type: 'revenue', visible: true },
                { id: 'gone', type: 'legacy-widget', visible: true },
                { id: 'keep-2', type: 'transaction-feed', visible: true },
            ],
        };
        const result = parseStoredConfig(JSON.stringify(stored));

        expect(result.widgets).toEqual([
            { id: 'keep-1', type: 'revenue', visible: true },
            { id: 'keep-2', type: 'transaction-feed', visible: true },
        ]);
        // Valid widgets keep their original layout entries/positions.
        expect(result.layout).toEqual([
            { i: 'keep-1', x: 0, y: 0, w: 4, h: 4 },
            { i: 'keep-2', x: 8, y: 0, w: 4, h: 4 },
        ]);
        // No trace of the unavailable widget remains.
        expect(result.layout.some((l) => l.i === 'gone')).toBe(false);
    });

    it('yields an empty layout/widgets when every widget type is unavailable', () => {
        const stored = {
            version: 1,
            refreshIntervalMinutes: 5,
            layout: [{ i: 'x', x: 0, y: 0, w: 2, h: 2 }],
            widgets: [{ id: 'x', type: 'nope', visible: true }],
        };
        const result = parseStoredConfig(JSON.stringify(stored));
        expect(result.widgets).toEqual([]);
        expect(result.layout).toEqual([]);
    });
});
