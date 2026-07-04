import { describe, it, expect } from 'vitest';
import type { LayoutItem } from '@fans-fund-me/shared';
import {
    BREAKPOINT_NAMES,
    buildBreakpointLayouts,
    clampLayoutItem,
    computeRowHeight,
    constrainLayout,
    DEFAULT_MAX_ROWS,
    FALLBACK_ROW_HEIGHT,
    GRID_BREAKPOINTS,
    GRID_COLS,
    GRID_MARGIN,
    GRID_CONTAINER_PADDING,
    MIN_WIDGET_H,
    MIN_WIDGET_W,
    toLayoutItems,
} from './grid-config';

/**
 * Mirror of react-grid-layout's breakpoint selection: the chosen breakpoint is
 * the largest one whose threshold is strictly less than the width, defaulting
 * to the smallest breakpoint.
 */
function breakpointFromWidth(width: number): string {
    const sorted = [...BREAKPOINT_NAMES].sort(
        (a, b) => GRID_BREAKPOINTS[a] - GRID_BREAKPOINTS[b],
    );
    let matching = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        if (width > GRID_BREAKPOINTS[sorted[i]]) matching = sorted[i];
    }
    return matching;
}

describe('grid breakpoints (Requirement 1.2)', () => {
    it('includes a zero-threshold breakpoint so widths below 1024px are covered', () => {
        expect(Math.min(...Object.values(GRID_BREAKPOINTS))).toBe(0);
    });

    it('defines a column count of at least 1 for every breakpoint', () => {
        for (const name of BREAKPOINT_NAMES) {
            expect(GRID_COLS[name]).toBeGreaterThanOrEqual(1);
        }
    });

    it('assigns a valid breakpoint with columns across the 1024px–5120px range', () => {
        for (const width of [1024, 1200, 1920, 2560, 3840, 5120]) {
            const bp = breakpointFromWidth(width);
            expect(BREAKPOINT_NAMES).toContain(bp);
            expect(GRID_COLS[bp as keyof typeof GRID_COLS]).toBeGreaterThanOrEqual(
                1,
            );
        }
    });

    it('gives wider viewports at least as many columns as narrower ones', () => {
        const widths = [1024, 1440, 1920, 2560, 3840, 5120];
        let prevCols = 0;
        for (const width of widths) {
            const bp = breakpointFromWidth(width) as keyof typeof GRID_COLS;
            expect(GRID_COLS[bp]).toBeGreaterThanOrEqual(prevCols);
            prevCols = GRID_COLS[bp];
        }
    });
});

describe('computeRowHeight (Requirement 1.3)', () => {
    it('returns the fallback height when the container has not been measured', () => {
        expect(computeRowHeight(0)).toBe(FALLBACK_ROW_HEIGHT);
        expect(computeRowHeight(-10)).toBe(FALLBACK_ROW_HEIGHT);
    });

    it('sizes rows so that maxRows rows plus gaps fit within the container height', () => {
        const height = 1031; // ~1080 viewport minus a header
        const rh = computeRowHeight(height, DEFAULT_MAX_ROWS);
        const [, marginY] = GRID_MARGIN;
        const [, paddingY] = GRID_CONTAINER_PADDING;
        const consumed =
            rh * DEFAULT_MAX_ROWS +
            (DEFAULT_MAX_ROWS - 1) * marginY +
            2 * paddingY;
        // All rows fit (no vertical scroll)...
        expect(consumed).toBeLessThanOrEqual(height);
        // ...and we don't waste more than one row's worth of space.
        expect(height - consumed).toBeLessThan(rh + marginY);
    });

    it('never returns a non-positive row height', () => {
        expect(computeRowHeight(10, 12)).toBeGreaterThan(0);
    });
});

describe('clampLayoutItem (Requirement 2.1)', () => {
    it('enforces a minimum size of 1x1', () => {
        const item: LayoutItem = { i: 'a', x: 0, y: 0, w: 0, h: -3 };
        const clamped = clampLayoutItem(item, 12);
        expect(clamped.w).toBeGreaterThanOrEqual(MIN_WIDGET_W);
        expect(clamped.h).toBeGreaterThanOrEqual(MIN_WIDGET_H);
    });

    it('caps size to the full-grid maximum (cols x maxRows)', () => {
        const item: LayoutItem = { i: 'a', x: 0, y: 0, w: 999, h: 999 };
        const clamped = clampLayoutItem(item, 8, DEFAULT_MAX_ROWS);
        expect(clamped.w).toBe(8);
        expect(clamped.h).toBe(DEFAULT_MAX_ROWS);
    });

    it('keeps the item within the grid boundaries (x + w <= cols)', () => {
        const item: LayoutItem = { i: 'a', x: 20, y: 0, w: 4, h: 2 };
        const clamped = clampLayoutItem(item, 8);
        expect(clamped.x + clamped.w).toBeLessThanOrEqual(8);
        expect(clamped.x).toBeGreaterThanOrEqual(0);
    });

    it('preserves and clamps optional min constraints', () => {
        const item: LayoutItem = {
            i: 'a',
            x: 0,
            y: 0,
            w: 3,
            h: 3,
            minW: 2,
            minH: 99,
        };
        const clamped = clampLayoutItem(item, 6, 12);
        expect(clamped.minW).toBe(2);
        expect(clamped.minH).toBe(12);
    });
});

describe('buildBreakpointLayouts (Requirement 1.2)', () => {
    const layout: LayoutItem[] = [
        { i: 'a', x: 0, y: 0, w: 6, h: 4 },
        { i: 'b', x: 6, y: 0, w: 10, h: 4 },
        { i: 'c', x: 0, y: 4, w: 16, h: 8 },
    ];

    it('produces a layout for every breakpoint', () => {
        const layouts = buildBreakpointLayouts(layout);
        for (const name of BREAKPOINT_NAMES) {
            expect(layouts[name]).toBeDefined();
            expect(layouts[name].length).toBe(layout.length);
        }
    });

    it('ensures no item exceeds its breakpoint columns (no horizontal overflow)', () => {
        const layouts = buildBreakpointLayouts(layout);
        for (const name of BREAKPOINT_NAMES) {
            const cols = GRID_COLS[name];
            for (const item of layouts[name]) {
                expect(item.x + item.w).toBeLessThanOrEqual(cols);
                expect(item.w).toBeLessThanOrEqual(cols);
                expect(item.w).toBeGreaterThanOrEqual(MIN_WIDGET_W);
            }
        }
    });
});

describe('constrainLayout / toLayoutItems', () => {
    it('constrains every item in a layout', () => {
        const layout: LayoutItem[] = [
            { i: 'a', x: 0, y: 0, w: 99, h: 99 },
            { i: 'b', x: 50, y: 50, w: 3, h: 3 },
        ];
        const result = constrainLayout(layout, 8, 10);
        for (const item of result) {
            expect(item.x + item.w).toBeLessThanOrEqual(8);
            expect(item.h).toBeLessThanOrEqual(10);
        }
    });

    it('projects a react-grid-layout Layout down to the persisted shape', () => {
        const rglLayout = [
            {
                i: 'a',
                x: 1,
                y: 2,
                w: 3,
                h: 4,
                minW: 1,
                minH: 2,
                moved: true,
                static: false,
            },
        ];
        const items = toLayoutItems(rglLayout);
        expect(items[0]).toEqual({
            i: 'a',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            minW: 1,
            minH: 2,
        });
        expect('moved' in items[0]).toBe(false);
        expect('static' in items[0]).toBe(false);
    });
});
