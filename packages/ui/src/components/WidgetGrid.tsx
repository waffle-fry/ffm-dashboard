// WidgetGrid — wraps react-grid-layout to manage widget positioning,
// drag-and-drop, and resize.
//
// The grid renders on a SINGLE fixed column count ({@link GRID_COLUMNS}) at
// every viewport width. We measure the container's real pixel size ourselves
// (via ResizeObserver) and pass it to react-grid-layout as an explicit `width`,
// rather than relying on the library's WidthProvider HOC. WidthProvider was the
// source of the "everything collapses into one narrow column" bug: it can paint
// once at a placeholder/zero width before it has measured, and each grid unit is
// then computed from that bad width. By measuring ourselves and refusing to
// render the grid until we have a real (> 0) width, every column is always the
// correct fraction of the container, filling the whole screen width.
//
// Interaction model (Requirement 2.1):
//   - Dragging a card reorders the grid: the cards it moves over slide out of
//     the way and it drops into a tidy slot. `compactType="vertical"` keeps the
//     grid packed so cards never overlap and never get pushed off-screen, and
//     `preventCollision={false}` lets a dragged/resized card displace others so
//     they flow around it.
//   - Resizing behaves the same way: growing a card pushes its neighbours.
//   - `isBounded` keeps every card inside the grid.
//
// Requirement 1.2: no horizontal overflow from 1024px to 5120px — a fixed
//   column count scaled to the measured width always fits exactly.
// Requirement 1.3: fills the viewport at 1920×1080 without scrolling — the row
//   height is computed from the measured container height so DEFAULT_MAX_ROWS
//   rows exactly fill the available space.
// Requirement 2.4: layout updates within 500ms without a page reload — the
//   layout change is handed back to the parent synchronously on drag/resize
//   stop (no reload, no network round-trip).

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import GridLayout from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import type { LayoutItem, WidgetType } from '@fans-fund-me/shared';

// react-grid-layout's own styles + the resize-handle styles it depends on.
// Without these the drag placeholder and resize handles are invisible.
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import {
    computeRowHeight,
    constrainLayout,
    DEFAULT_MAX_ROWS,
    GRID_COLUMNS,
    GRID_CONTAINER_PADDING,
    GRID_MARGIN,
    toLayoutItems,
} from './grid-config';

/**
 * A renderable widget for the grid. `id` MUST match the `i` of a
 * {@link LayoutItem}; only widgets with a matching layout entry are rendered.
 */
export interface WidgetDefinition {
    id: string;
    type: WidgetType;
    /**
     * Accessible label for the drag handle. The concrete widget renders its own
     * visible title, so this is NOT shown as text — it only names the handle.
     */
    title?: string;
    /**
     * Widget body content. Concrete widgets render their own full card chrome
     * (border + title bar + refresh), so the grid cell must not add another.
     */
    content: ReactNode;
}

export interface WidgetGridProps {
    layout: LayoutItem[];
    widgets: WidgetDefinition[];
    onLayoutChange: (layout: LayoutItem[]) => void;
    /** Number of rows the grid should fill vertically. */
    maxRows?: number;
}

/** Class on each widget's header that acts as the drag handle. */
const DRAG_HANDLE_CLASS = 'widget-drag-handle';
/** Class on interactive controls that must not initiate a drag (e.g. refresh). */
const DRAG_CANCEL_CLASS = 'widget-no-drag';

/**
 * Generous vertical row cap used only to bound layout sanitisation. It is far
 * larger than the visible row count so cards can be placed below the fold (the
 * grid scrolls) rather than being clamped back up — while horizontal bounds
 * (columns) are still strictly enforced to prevent right-edge overflow.
 */
const GROW_ROWS = 1000;

/** Measured size of an element. */
interface Size {
    width: number;
    height: number;
}

/**
 * Observe an element's content-box size and keep it in React state. Returns
 * `[ref, size]`. Falls back gracefully when ResizeObserver is unavailable
 * (e.g. non-browser test environments), in which case size stays at 0×0.
 */
function useMeasuredSize(): [React.RefObject<HTMLDivElement>, Size] {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<Size>({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;

        const measure = (): void => {
            setSize({ width: el.clientWidth, height: el.clientHeight });
        };

        // Seed immediately with the current size.
        measure();

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return [ref, size];
}

export default function WidgetGrid({
    layout,
    widgets,
    onLayoutChange,
    maxRows = DEFAULT_MAX_ROWS,
}: WidgetGridProps): JSX.Element {
    const [containerRef, { width, height }] = useMeasuredSize();

    // Row height so `maxRows` rows fill the measured height (Requirement 1.3).
    const rowHeight = useMemo(
        () => computeRowHeight(height, maxRows),
        [height, maxRows],
    );

    // A single layout, clamped horizontally to the fixed column count so no
    // card can extend past the right edge. Vertically we use a generous cap
    // (not the visible `maxRows`) so cards are free to sit below the fold and
    // the grid can grow/scroll during rearrangement instead of snapping cards
    // back up. Row height (below) still targets `maxRows` so the DEFAULT layout
    // fills the viewport with no scroll.
    const constrained = useMemo(
        () => constrainLayout(layout, GRID_COLUMNS, GROW_ROWS),
        [layout],
    );

    // Only render widgets that have a corresponding layout entry.
    const layoutIds = useMemo(
        () => new Set(layout.map((item) => item.i)),
        [layout],
    );
    const visibleWidgets = useMemo(
        () => widgets.filter((w) => layoutIds.has(w.id)),
        [widgets, layoutIds],
    );

    // Persist the layout when an interaction finishes (drag/resize stop). The
    // callback receives the FULL post-compaction layout — including any cards
    // that were pushed out of the way — so their new positions are saved too.
    const persistLayout = (current: Layout[]): void => {
        onLayoutChange(toLayoutItems(current));
    };

    return (
        <div ref={containerRef} className="h-full w-full overflow-x-hidden overflow-y-auto">
            {width > 0 && (
                <GridLayout
                    // Explicit measured width — never a guessed/placeholder one.
                    width={width}
                    layout={constrained}
                    cols={GRID_COLUMNS}
                    margin={GRID_MARGIN}
                    containerPadding={GRID_CONTAINER_PADDING}
                    rowHeight={rowHeight}
                    // The whole widget header is the drag handle; interactive
                    // controls inside it are cancelled so clicks still work.
                    draggableHandle={`.${DRAG_HANDLE_CLASS}`}
                    draggableCancel={`.${DRAG_CANCEL_CLASS}`}
                    isDraggable
                    isResizable
                    // Free placement: a dropped/resized card stays where the user
                    // leaves it (no gravity), and preventCollision=false lets it
                    // push the cards it overlaps out of the way. The grid is NOT
                    // height-capped (no maxRows) and its container scrolls
                    // vertically, so displaced cards always have somewhere to go
                    // instead of being crushed off-screen or snapping back — the
                    // default layout still fills the viewport with no scroll.
                    compactType={null}
                    preventCollision={false}
                    useCSSTransforms
                    onDragStop={persistLayout}
                    onResizeStop={persistLayout}
                >
                    {visibleWidgets.map((widget) => (
                        // Bare cell: the concrete widget fills it entirely and
                        // supplies its own card + title bar (whose header is the
                        // drag handle). No extra chrome, so exactly one card and
                        // one title per widget.
                        <div key={widget.id} className="h-full w-full">
                            {widget.content}
                        </div>
                    ))}
                </GridLayout>
            )}
        </div>
    );
}
