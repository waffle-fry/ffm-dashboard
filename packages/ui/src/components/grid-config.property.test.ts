// Property-based tests for the dashboard grid layout constraint logic.
//
// Feature: ops-dashboard, Property 3: Widget operations maintain grid constraints
//
// Task 9.6 / Property 3 (Validates Requirement 2.1): for any sequence of
// add/remove/reorder/resize operations applied to a grid layout — modelled here
// as arbitrary LayoutItems (including wild, out-of-range values) fed through the
// real enforcement helpers clampLayoutItem / constrainLayout / buildBreakpointLayouts —
// every resulting widget SHALL have a size within [1×1, cols×maxRows] and sit
// within the grid boundaries. Concretely, the source guarantees:
//   1 <= w <= cols, 1 <= h <= maxRows,
//   x >= 0 and x + w <= cols,
//   y >= 0 and y + h <= maxRows.
// These are exactly the bounds clampLayoutItem enforces (x is clamped to
// [0, cols - w] and y to [0, max(0, maxRows - h)]), and constrainLayout /
// buildBreakpointLayouts apply that same guarantee to every item at each
// breakpoint's column count (the no-horizontal-overflow guarantee of
// Requirement 1.2 / 2.1).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { LayoutItem } from '@fans-fund-me/shared';
import {
    BREAKPOINT_NAMES,
    buildBreakpointLayouts,
    clampLayoutItem,
    constrainLayout,
    DEFAULT_MAX_ROWS,
    GRID_COLS,
    MIN_WIDGET_H,
    MIN_WIDGET_W,
} from './grid-config';

// A "wild" numeric value covering negatives, zero, fractional and huge values,
// so items routinely fall outside the grid before clamping. Kept finite because
// the persisted LayoutItem shape only ever carries finite numbers.
const wildCoord = fc.oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    fc.constantFrom(0, -1, 1),
);

// An arbitrary LayoutItem with unconstrained geometry. minW/minH are optional
// (matching the shape) and equally wild when present.
const layoutItemArb: fc.Arbitrary<LayoutItem> = fc.record(
    {
        i: fc.string({ minLength: 1, maxLength: 8 }),
        x: wildCoord,
        y: wildCoord,
        w: wildCoord,
        h: wildCoord,
        minW: fc.option(wildCoord, { nil: undefined }),
        minH: fc.option(wildCoord, { nil: undefined }),
    },
    { requiredKeys: ['i', 'x', 'y', 'w', 'h'] },
);

// Column counts spanning small grids up to the widest breakpoint, plus messy
// (fractional / sub-1) values to exercise the `Math.max(1, floor(cols))` guard.
const colsArb = fc.oneof(
    fc.integer({ min: 1, max: 30 }),
    fc.double({ min: -5, max: 30, noNaN: true }),
);

// Row caps, similarly including messy values to exercise the row guard.
const maxRowsArb = fc.oneof(
    fc.integer({ min: 1, max: 30 }),
    fc.double({ min: -5, max: 30, noNaN: true }),
);

/** The effective bounds the source derives from raw cols/maxRows inputs. */
function effectiveBounds(cols: number, maxRows: number) {
    return {
        maxCols: Math.max(1, Math.floor(cols)),
        maxR: Math.max(1, Math.floor(maxRows)),
    };
}

/** Assert a single clamped item satisfies every grid constraint. */
function assertWithinGrid(item: LayoutItem, maxCols: number, maxR: number) {
    // Size within [1×1, cols×maxRows].
    expect(item.w).toBeGreaterThanOrEqual(MIN_WIDGET_W);
    expect(item.w).toBeLessThanOrEqual(maxCols);
    expect(item.h).toBeGreaterThanOrEqual(MIN_WIDGET_H);
    expect(item.h).toBeLessThanOrEqual(maxR);

    // Positioned within the grid boundaries.
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.x + item.w).toBeLessThanOrEqual(maxCols);
    expect(item.y + item.h).toBeLessThanOrEqual(maxR);

    // Integer grid units (clamping rounds to whole cells).
    expect(Number.isInteger(item.x)).toBe(true);
    expect(Number.isInteger(item.y)).toBe(true);
    expect(Number.isInteger(item.w)).toBe(true);
    expect(Number.isInteger(item.h)).toBe(true);
}

describe('grid constraints (Property 3: Widget operations maintain grid constraints)', () => {
    it('clampLayoutItem keeps any single item within [1×1, cols×maxRows] and grid bounds', () => {
        fc.assert(
            fc.property(layoutItemArb, colsArb, maxRowsArb, (item, cols, maxRows) => {
                const { maxCols, maxR } = effectiveBounds(cols, maxRows);
                const clamped = clampLayoutItem(item, cols, maxRows);
                assertWithinGrid(clamped, maxCols, maxR);
                // Identity is preserved through clamping.
                expect(clamped.i).toBe(item.i);
            }),
            { numRuns: 200 },
        );
    });

    it('constrainLayout keeps every item within bounds after add/remove/reorder/resize', () => {
        fc.assert(
            fc.property(
                fc.array(layoutItemArb, { maxLength: 12 }),
                // A sequence of edits over the layout: each op is applied in order
                // to model add/remove/reorder/resize before the final constrain.
                fc.array(
                    fc.oneof(
                        // add
                        fc.record({ kind: fc.constant('add' as const), item: layoutItemArb }),
                        // remove by index
                        fc.record({
                            kind: fc.constant('remove' as const),
                            at: fc.nat(),
                        }),
                        // reorder: move item at `from` to `to`
                        fc.record({
                            kind: fc.constant('reorder' as const),
                            from: fc.nat(),
                            to: fc.nat(),
                        }),
                        // resize item at index to wild w/h
                        fc.record({
                            kind: fc.constant('resize' as const),
                            at: fc.nat(),
                            w: wildCoord,
                            h: wildCoord,
                        }),
                    ),
                    { maxLength: 20 },
                ),
                colsArb,
                maxRowsArb,
                (initial, ops, cols, maxRows) => {
                    // Apply the operation sequence to build the "current" layout.
                    let layout: LayoutItem[] = [...initial];
                    for (const op of ops) {
                        if (op.kind === 'add') {
                            layout.push(op.item);
                        } else if (layout.length > 0 && op.kind === 'remove') {
                            layout.splice(op.at % layout.length, 1);
                        } else if (layout.length > 0 && op.kind === 'reorder') {
                            const from = op.from % layout.length;
                            const to = op.to % layout.length;
                            const [moved] = layout.splice(from, 1);
                            layout.splice(to, 0, moved);
                        } else if (layout.length > 0 && op.kind === 'resize') {
                            const at = op.at % layout.length;
                            layout[at] = { ...layout[at], w: op.w, h: op.h };
                        }
                    }

                    const { maxCols, maxR } = effectiveBounds(cols, maxRows);
                    const result = constrainLayout(layout, cols, maxRows);

                    // Constraining never drops or invents widgets.
                    expect(result.length).toBe(layout.length);
                    for (const item of result) {
                        assertWithinGrid(item, maxCols, maxR);
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    it('buildBreakpointLayouts keeps every item within each breakpoint column count', () => {
        fc.assert(
            fc.property(
                fc.array(layoutItemArb, { maxLength: 12 }),
                maxRowsArb,
                (layout, maxRows) => {
                    const { maxR } = effectiveBounds(GRID_COLS.xxl, maxRows);
                    const layouts = buildBreakpointLayouts(layout, maxRows);

                    for (const name of BREAKPOINT_NAMES) {
                        const cols = GRID_COLS[name];
                        const bp = layouts[name];
                        expect(bp).toBeDefined();
                        // Every item is present at every breakpoint...
                        expect(bp.length).toBe(layout.length);
                        for (const item of bp) {
                            // ...and fits within that breakpoint's columns (no
                            // horizontal overflow, Requirement 1.2 / 2.1).
                            assertWithinGrid(item as LayoutItem, cols, maxR);
                        }
                    }
                },
            ),
            { numRuns: 200 },
        );
    });
});
