// Grid configuration and pure layout helpers for the dashboard grid.
//
// This module holds the responsive breakpoint/column configuration and the
// pure (DOM-free, React-free) helper functions used by WidgetGrid. Keeping the
// logic here — separate from the React component — lets it be unit-tested in a
// plain Node environment and reused by the property tests in tasks 9.4–9.6.
//
// Requirement 1.2: no horizontal scrollbar / no content overflow at any
// viewport width from 1024px to 5120px — the breakpoints below span that range
// and columns are redistributed per breakpoint so widgets always fit.
// Requirement 2.1: widgets have a minimum size of 1×1 and a maximum size equal
// to the full grid — the clamping helpers enforce those bounds.

import type { LayoutItem } from '@fans-fund-me/shared';
import type { Layout, Layouts } from 'react-grid-layout';

/**
 * Responsive breakpoints as `{ name: minWidthPx }`. react-grid-layout selects
 * the breakpoint with the largest `minWidthPx` that is `<= containerWidth`, so
 * the smallest breakpoint MUST be `0` to cover everything below it (including
 * the 1024px lower bound of the supported range). The named thresholds span
 * 1024px → 5120px (Requirement 1.2).
 */
export const GRID_BREAKPOINTS = {
    xxl: 3840, // 4K/5K ultra-wide (up to 5120px)
    xl: 2560, // 1440p / QHD
    lg: 1920, // 1080p (the primary 25" kiosk display)
    md: 1440,
    sm: 1024, // lower bound of the supported range
    xs: 0, // anything narrower than sm (defensive; not a target width)
} as const;

export type BreakpointName = keyof typeof GRID_BREAKPOINTS;

/**
 * Column count per breakpoint. Wider viewports get more columns so widgets
 * redistribute and stay readable instead of stretching (Requirement 1.2).
 */
export const GRID_COLS: Record<BreakpointName, number> = {
    xxl: 24,
    xl: 20,
    lg: 16,
    md: 12,
    sm: 8,
    xs: 6,
};

/**
 * The single, fixed column count the dashboard grid renders on at EVERY
 * viewport width.
 *
 * We deliberately do NOT switch column counts by breakpoint for the live grid.
 * `WidthProvider` scales the pixel width of each column to the container, so a
 * fixed 16-column grid fills any width from 1024px to 5120px with no horizontal
 * overflow (Requirement 1.2) while keeping every card's position and proportion
 * stable. Switching column counts per breakpoint (the old approach) re-clamped
 * the 16-column design into narrower grids on sub-1920px windows, which made
 * wide cards span the whole screen and made positions drift on every resize.
 *
 * 16 matches the default layout's design grid (see DEFAULT_DASHBOARD_CONFIG).
 */
export const GRID_COLUMNS = GRID_COLS.lg;

/** Gap between grid items `[x, y]` in px. */
export const GRID_MARGIN: [number, number] = [12, 12];
/** Padding inside the grid container `[x, y]` in px. */
export const GRID_CONTAINER_PADDING: [number, number] = [12, 12];

/**
 * Default number of visible rows. The grid computes a row height so that this
 * many rows exactly fill the available height, giving a full-viewport layout
 * with no vertical scrolling at 1920×1080 for the default config
 * (Requirement 1.3).
 */
export const DEFAULT_MAX_ROWS = 12;

/** Minimum widget size in grid units (Requirement 2.1). */
export const MIN_WIDGET_W = 1;
export const MIN_WIDGET_H = 1;

/** Fallback row height (px) used before the container has been measured. */
export const FALLBACK_ROW_HEIGHT = 80;

/** Ordered list of breakpoint names, largest threshold first. */
export const BREAKPOINT_NAMES = (
    Object.keys(GRID_BREAKPOINTS) as BreakpointName[]
).sort((a, b) => GRID_BREAKPOINTS[b] - GRID_BREAKPOINTS[a]);

function clampInt(value: number, min: number, max: number): number {
    const rounded = Math.round(Number.isFinite(value) ? value : min);
    if (rounded < min) return min;
    if (rounded > max) return max;
    return rounded;
}

/**
 * Compute the row height (px) so that `maxRows` rows plus their margins and the
 * container padding exactly fill `containerHeight`. Returns a positive integer;
 * falls back to {@link FALLBACK_ROW_HEIGHT} when the height is not yet known.
 *
 * Layout math: total = maxRows·rowHeight + (maxRows-1)·marginY + 2·paddingY.
 */
export function computeRowHeight(
    containerHeight: number,
    maxRows: number = DEFAULT_MAX_ROWS,
    marginY: number = GRID_MARGIN[1],
    paddingY: number = GRID_CONTAINER_PADDING[1],
): number {
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
        return FALLBACK_ROW_HEIGHT;
    }
    const rows = Math.max(1, Math.floor(maxRows));
    const usable = containerHeight - (rows - 1) * marginY - 2 * paddingY;
    const rowHeight = Math.floor(usable / rows);
    return rowHeight > 0 ? rowHeight : 1;
}

/**
 * Clamp a single layout item so its size is within `[1×1, cols×maxRows]` and it
 * sits inside the grid boundaries (Requirement 2.1). Width is capped at the
 * column count (full-grid maximum) and the item is nudged left/up as needed so
 * `x + w <= cols` and `y + h <= maxRows`, preventing horizontal overflow at any
 * breakpoint (Requirement 1.2).
 */
export function clampLayoutItem(
    item: LayoutItem,
    cols: number,
    maxRows: number = DEFAULT_MAX_ROWS,
): LayoutItem {
    const maxCols = Math.max(1, Math.floor(cols));
    const maxR = Math.max(1, Math.floor(maxRows));

    const w = clampInt(item.w, MIN_WIDGET_W, maxCols);
    const h = clampInt(item.h, MIN_WIDGET_H, maxR);
    const x = clampInt(item.x, 0, maxCols - w);
    const y = clampInt(item.y, 0, Math.max(0, maxR - h));

    const clamped: LayoutItem = { i: item.i, x, y, w, h };
    if (item.minW !== undefined) {
        clamped.minW = clampInt(item.minW, MIN_WIDGET_W, maxCols);
    }
    if (item.minH !== undefined) {
        clamped.minH = clampInt(item.minH, MIN_WIDGET_H, maxR);
    }
    return clamped;
}

/** Clamp every item in a layout to the given column/row bounds. */
export function constrainLayout(
    layout: LayoutItem[],
    cols: number,
    maxRows: number = DEFAULT_MAX_ROWS,
): LayoutItem[] {
    return layout.map((item) => clampLayoutItem(item, cols, maxRows));
}

/**
 * Build a react-grid-layout `Layouts` map from a single source layout by
 * clamping the layout to each breakpoint's column count. Because every item is
 * guaranteed to fit within that breakpoint's columns, the grid never overflows
 * horizontally at any supported width (Requirement 1.2).
 */
export function buildBreakpointLayouts(
    layout: LayoutItem[],
    maxRows: number = DEFAULT_MAX_ROWS,
): Layouts {
    const layouts: Layouts = {};
    for (const name of BREAKPOINT_NAMES) {
        layouts[name] = constrainLayout(
            layout,
            GRID_COLS[name],
            maxRows,
        ) as Layout[];
    }
    return layouts;
}

/**
 * Project a react-grid-layout `Layout[]` (which may carry extra runtime fields
 * such as `moved`/`static`) down to the persisted {@link LayoutItem} shape,
 * keeping only the fields the dashboard config stores.
 */
export function toLayoutItems(layout: Layout[]): LayoutItem[] {
    return layout.map((item) => {
        const result: LayoutItem = {
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
        };
        if (item.minW !== undefined) result.minW = item.minW;
        if (item.minH !== undefined) result.minH = item.minH;
        return result;
    });
}

/** True when two layout items overlap on both axes. */
function itemsOverlap(a: LayoutItem, b: LayoutItem): boolean {
    return (
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h
    );
}

/**
 * Lowest (smallest) `y >= 0` at which `item` can sit without overlapping any of
 * `placed`, keeping its `x`/`w`. Cards are packed upward, so this finds the
 * highest resting position given the already-placed cards.
 */
function settleY(item: LayoutItem, placed: readonly LayoutItem[]): number {
    let y = 0;
    let moved = true;
    while (moved) {
        moved = false;
        for (const p of placed) {
            const xOverlap = item.x < p.x + p.w && p.x < item.x + item.w;
            if (!xOverlap) continue;
            // If the item at its current y would overlap p, drop it just below p.
            if (y < p.y + p.h && p.y < y + item.h) {
                y = p.y + p.h;
                moved = true;
            }
        }
    }
    return y;
}

/**
 * Re-pack a layout after a drag/resize so the grid stays bounded WITHOUT
 * snapping the card the user just moved.
 *
 * The card identified by `anchorId` is treated as fixed — it keeps the position
 * the user dropped it at (only clamped into the grid bounds) — and every OTHER
 * card is packed upward around it. This reclaims the space the moved card
 * vacated (so the page can't balloon or grow cumulatively) while leaving the
 * moved card exactly where the user put it. The result is overlap-free and, as
 * long as the content fits, stays within `maxRows`.
 *
 * Pure and DOM-free so it can be unit-tested directly.
 *
 * @param layout   The post-interaction layout (may contain overlaps).
 * @param cols     Column count of the grid.
 * @param maxRows  Row cap the anchor is clamped into.
 * @param anchorId `i` of the card to keep fixed (the dragged/resized card).
 */
export function compactAround(
    layout: readonly LayoutItem[],
    cols: number,
    maxRows: number,
    anchorId: string,
): LayoutItem[] {
    const anchorSource = layout.find((item) => item.i === anchorId);
    // No anchor (shouldn't happen) → fall back to a plain upward pack.
    const anchor = anchorSource
        ? clampLayoutItem(anchorSource, cols, maxRows)
        : null;

    // Others packed in reading order (top-to-bottom, then left-to-right) so the
    // pack is stable and deterministic.
    const others = layout
        .filter((item) => item.i !== anchorId)
        .map((item) => clampLayoutItem(item, cols, maxRows))
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const placed: LayoutItem[] = [];
    if (anchor) placed.push(anchor);

    for (const item of others) {
        const y = settleY(item, placed);
        placed.push({ ...item, y });
    }

    // Return in the original order so React keys / persistence stay stable.
    const byId = new Map(placed.map((item) => [item.i, item]));
    return layout.map((item) => byId.get(item.i) ?? item);
}
