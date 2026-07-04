// Property-based tests for the dashboard config persistence logic
// (`parseStoredConfig`) in the ops-dashboard UI.
//
// These cover the DOM-free, pure parse/validate/prune contract exposed by
// `useWidgetConfig.ts`, exercised directly (no React / no DOM) with fast-check.
//
// Feature: ops-dashboard, Property 1 (task 9.4): Dashboard configuration
//   round-trip. Validates Requirements 2.2.
// Feature: ops-dashboard, Property 2 (task 9.5): Invalid widget type removal
//   preserves valid widgets. Validates Requirements 2.5.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { DashboardConfig, LayoutItem, WidgetInstance } from '@fans-fund-me/shared';
import { KNOWN_WIDGET_TYPES, parseStoredConfig } from './useWidgetConfig';

const NUM_RUNS = 100;
const KNOWN_WIDGET_TYPE_SET = new Set<string>(KNOWN_WIDGET_TYPES);

// Silence the intentional console.warn calls on any fall-back path so the test
// output stays clean (reused from the unit-test style). The valid configs
// these properties generate should never trigger a warn, but we keep the spy
// to match the existing suite and guard against noisy output.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

// Any widget type the UI knows how to render.
const knownWidgetTypeArb = fc.constantFrom(...KNOWN_WIDGET_TYPES);

// A string guaranteed NOT to be a known widget type (still structurally a
// string, so it passes the widget-shape check but is pruned as unavailable).
const unknownWidgetTypeArb = fc
    .string()
    .filter((s) => !KNOWN_WIDGET_TYPE_SET.has(s));

// Finite grid coordinates/sizes. Integers keep the values JSON-stable and
// realistic for a grid layout while still spanning a wide range.
const coordArb = fc.integer({ min: -1000, max: 1000 });
const optionalCoordArb = fc.option(fc.integer({ min: 0, max: 1000 }), {
    nil: undefined,
});

// Build a canonical LayoutItem for a given id: exactly the fields
// `parseStoredConfig` preserves (i,x,y,w,h and minW/minH only when present),
// so a serialize -> parse round-trip is an identity on this shape.
function buildLayoutItem(
    id: string,
    parts: {
        x: number;
        y: number;
        w: number;
        h: number;
        minW: number | undefined;
        minH: number | undefined;
    },
): LayoutItem {
    const item: LayoutItem = {
        i: id,
        x: parts.x,
        y: parts.y,
        w: parts.w,
        h: parts.h,
    };
    if (parts.minW !== undefined) item.minW = parts.minW;
    if (parts.minH !== undefined) item.minH = parts.minH;
    return item;
}

// Per-widget spec used to build both a widget instance and its layout entry.
const layoutPartsArb = fc.record({
    x: coordArb,
    y: coordArb,
    w: coordArb,
    h: coordArb,
    minW: optionalCoordArb,
    minH: optionalCoordArb,
});

// ---------------------------------------------------------------------------
// Property 1 (task 9.4): Dashboard configuration round-trip
// ---------------------------------------------------------------------------

// A fully valid config already in the canonical shape `parseStoredConfig`
// preserves: every widget has a known type, and there is exactly one layout
// entry per widget with a matching id. Nothing is pruned, so parse is an
// identity after JSON serialization.
const validConfigArb: fc.Arbitrary<DashboardConfig> = fc
    .record({
        version: fc.integer({ min: 0, max: 1_000_000 }),
        refreshIntervalMinutes: fc.integer({ min: 0, max: 1440 }),
        // Per-widget specs; ids are assigned by index below to guarantee
        // uniqueness and a 1:1 widget <-> layout pairing.
        specs: fc.array(
            fc.record({
                type: knownWidgetTypeArb,
                visible: fc.boolean(),
                layout: layoutPartsArb,
            }),
            { minLength: 0, maxLength: 8 },
        ),
    })
    .map(({ version, refreshIntervalMinutes, specs }) => {
        const widgets: WidgetInstance[] = [];
        const layout: LayoutItem[] = [];
        specs.forEach((spec, idx) => {
            const id = `widget-${idx}`;
            widgets.push({ id, type: spec.type, visible: spec.visible });
            layout.push(buildLayoutItem(id, spec.layout));
        });
        return { version, refreshIntervalMinutes, layout, widgets };
    });

describe('Feature: ops-dashboard, Property 1 (task 9.4) — dashboard config round-trip (Requirement 2.2)', () => {
    it('serialize -> parse yields an object deeply equal to the original valid config', () => {
        fc.assert(
            fc.property(validConfigArb, (config) => {
                const roundTripped = parseStoredConfig(JSON.stringify(config));
                expect(roundTripped).toEqual(config);
            }),
            { numRuns: NUM_RUNS },
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2 (task 9.5): Invalid widget type removal preserves valid widgets
// ---------------------------------------------------------------------------

// A config containing a mix of valid (known type) and invalid (unknown type)
// widgets. Each widget gets a matching layout entry. We also compute the
// expected post-parse widgets/layout: the valid widgets in their original
// relative order, and the layout entries not keyed to a removed widget.
const mixedConfigArb = fc
    .record({
        version: fc.integer({ min: 0, max: 1_000_000 }),
        refreshIntervalMinutes: fc.integer({ min: 0, max: 1440 }),
        specs: fc.array(
            fc.record({
                isValid: fc.boolean(),
                validType: knownWidgetTypeArb,
                invalidType: unknownWidgetTypeArb,
                visible: fc.boolean(),
                layout: layoutPartsArb,
            }),
            { minLength: 0, maxLength: 12 },
        ),
    })
    .map(({ version, refreshIntervalMinutes, specs }) => {
        const widgets: WidgetInstance[] = [];
        const layout: LayoutItem[] = [];
        const expectedWidgets: WidgetInstance[] = [];
        const expectedLayout: LayoutItem[] = [];
        const removedIds: string[] = [];

        specs.forEach((spec, idx) => {
            const id = `widget-${idx}`;
            const type = spec.isValid
                ? spec.validType
                : (spec.invalidType as WidgetInstance['type']);
            const widget: WidgetInstance = { id, type, visible: spec.visible };
            const item = buildLayoutItem(id, spec.layout);

            widgets.push(widget);
            layout.push(item);

            if (spec.isValid) {
                expectedWidgets.push({ ...widget });
                expectedLayout.push({ ...item });
            } else {
                removedIds.push(id);
            }
        });

        const config: DashboardConfig = {
            version,
            refreshIntervalMinutes,
            layout,
            widgets,
        };
        return { config, expectedWidgets, expectedLayout, removedIds };
    });

describe('Feature: ops-dashboard, Property 2 (task 9.5) — invalid widget type removal (Requirement 2.5)', () => {
    it('prunes unavailable widget types and their layout entries while preserving valid widgets in order/position', () => {
        fc.assert(
            fc.property(mixedConfigArb, (scenario) => {
                const { config, expectedWidgets, expectedLayout, removedIds } =
                    scenario;
                const result = parseStoredConfig(JSON.stringify(config));

                // Valid widgets survive, exactly, in their original relative
                // order; invalid ones are gone.
                expect(result.widgets).toEqual(expectedWidgets);
                // Every surviving widget has a known type.
                for (const widget of result.widgets) {
                    expect(KNOWN_WIDGET_TYPE_SET.has(widget.type)).toBe(true);
                }

                // Valid widgets keep their original layout entries/positions;
                // entries keyed to removed widgets are gone.
                expect(result.layout).toEqual(expectedLayout);
                const removed = new Set(removedIds);
                for (const item of result.layout) {
                    expect(removed.has(item.i)).toBe(false);
                }

                // Numeric metadata is preserved.
                expect(result.version).toBe(config.version);
                expect(result.refreshIntervalMinutes).toBe(
                    config.refreshIntervalMinutes,
                );
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
