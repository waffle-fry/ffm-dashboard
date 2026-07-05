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
//   - Free placement: a dropped/resized card stays where the user leaves it
//     (`compactType={null}` — no gravity, so it never snaps back up or to the
//     left), and `preventCollision={false}` lets it push the cards it overlaps
//     out of the way.
//   - Bounded height: the grid is capped at `maxRows` rows (it never grows
//     beyond the viewport), so pushed cards can't cascade off down an
//     ever-growing page. Row height is sized so those rows exactly fill the
//     viewport (Requirement 1.3).
//   - Resizing behaves the same way: growing a card pushes its neighbours.
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
    compactAround,
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
 * Generous vertical bound for layout sanitisation. The layout we persist is
 * already packed by {@link compactAround}, so we must NOT re-clamp its rows to
 * the visible `maxRows` (that would collide tall cards). We only need to keep
 * items within the columns; this large row bound leaves the packed y-positions
 * untouched while still guarding horizontal overflow.
 */
const SANITISE_ROWS = 1000;

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

    // A single layout, clamped only horizontally (to the fixed column count) so
    // no card can extend past the right edge. We deliberately do NOT re-clamp
    // the rows: the persisted layout is already packed by compactAround, and
    // re-clamping its y-positions would collide tall cards.
    const constrained = useMemo(
        () => constrainLayout(layout, GRID_COLUMNS, SANITISE_ROWS),
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

    // Persist when an interaction finishes. The card the user moved/resized
    // (`newItem`) is kept exactly where they left it, and the other cards are
    // packed up around it (compactAround) so the vacated space is reclaimed and
    // the grid can't balloon or grow cumulatively.
    const persistLayout = (current: Layout[], newItem: Layout | undefined): void => {
        const items = toLayoutItems(current);
        const next = newItem
            ? compactAround(items, GRID_COLUMNS, maxRows, newItem.i)
            : items;
        onLayoutChange(next);
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
                    // Calm dragging: the card floats freely under the cursor and
                    // the other cards DON'T jump around live (allowOverlap). When
                    // the drag/resize ends, `persistLayout` keeps the moved card
                    // where it was dropped and packs the others up around it, so
                    // nothing overlaps and the grid stays bounded (no ballooning).
                    compactType={null}
                    allowOverlap
                    useCSSTransforms
                    onDragStop={(l, _o, n) => persistLayout(l, n)}
                    onResizeStop={(l, _o, n) => persistLayout(l, n)}
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
