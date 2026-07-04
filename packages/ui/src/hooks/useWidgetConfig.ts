// useWidgetConfig — localStorage-backed source of truth for the dashboard's
// DashboardConfig.
//
// Requirement 2.2: widget configuration (selection, order, position, size) is
//   persisted to browser localStorage so it survives sessions. The hook
//   serializes on every config change via an effect.
// Requirement 2.3: when no saved config exists, load a canonical default
//   config containing all available metric widgets arranged in the grid.
// Requirement 2.5: when a saved config references a widget type that is no
//   longer available, remove that widget (and its layout entry) while
//   preserving the remaining valid widgets in their original positions.
//
// Design: the pure parse + validate + prune + fall-back logic lives in the
// DOM-free `parseStoredConfig` function so the property tests (tasks 9.4/9.5)
// can exercise it directly without React or a DOM. The hook is a thin wrapper
// that wires that logic to `useState`/`useEffect` and localStorage, guarding
// every localStorage access so a disabled/throwing store falls back cleanly.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    DashboardConfig,
    LayoutItem,
    WidgetInstance,
    WidgetType,
} from '@fans-fund-me/shared';

/** localStorage key under which the serialized DashboardConfig is stored. */
export const WIDGET_CONFIG_STORAGE_KEY = 'fansfund.ops-dashboard.config';

/** Config schema version written by this build. */
export const DASHBOARD_CONFIG_VERSION = 1;

/** Default refresh interval in minutes (Requirement 8.1 default). */
const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;

/**
 * The complete set of widget types the UI knows how to render. Any widget in a
 * loaded config whose type is not in this set is treated as unavailable and
 * pruned (Requirement 2.5). Kept in sync with the `WidgetType` union in
 * `@fans-fund-me/shared`.
 */
export const KNOWN_WIDGET_TYPES: readonly WidgetType[] = [
    'revenue',
    'payment-counts',
    'user-growth',
    'system-health',
    'dispute-countdown',
    'dispute-progress',
    'transaction-feed',
    'platform-summary',
];

const KNOWN_WIDGET_TYPE_SET: ReadonlySet<string> = new Set(KNOWN_WIDGET_TYPES);

/**
 * Canonical default dashboard configuration (Requirement 2.3): every available
 * widget, visible, arranged across the 16-column / 12-row `lg` (1920×1080)
 * grid so the layout fills the kiosk viewport with no scrolling (Requirement
 * 1.3). Exported (frozen) so other code and tests can reference the canonical
 * shape; use {@link createDefaultConfig} to obtain a mutable deep copy.
 */
export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = Object.freeze({
    version: DASHBOARD_CONFIG_VERSION,
    refreshIntervalMinutes: DEFAULT_REFRESH_INTERVAL_MINUTES,
    layout: [
        // Top band: four summary widgets across the full 16 columns.
        { i: 'revenue', x: 0, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
        { i: 'payment-counts', x: 4, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
        { i: 'user-growth', x: 8, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
        { i: 'platform-summary', x: 12, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
        // Middle/bottom left: system health then the two dispute widgets.
        { i: 'system-health', x: 0, y: 4, w: 8, h: 4, minW: 2, minH: 2 },
        { i: 'dispute-countdown', x: 0, y: 8, w: 4, h: 4, minW: 2, minH: 2 },
        { i: 'dispute-progress', x: 4, y: 8, w: 4, h: 4, minW: 2, minH: 2 },
        // Right column: the tall transaction feed spanning both lower bands.
        { i: 'transaction-feed', x: 8, y: 4, w: 8, h: 8, minW: 2, minH: 2 },
    ],
    widgets: [
        { id: 'revenue', type: 'revenue', visible: true },
        { id: 'payment-counts', type: 'payment-counts', visible: true },
        { id: 'user-growth', type: 'user-growth', visible: true },
        { id: 'platform-summary', type: 'platform-summary', visible: true },
        { id: 'system-health', type: 'system-health', visible: true },
        { id: 'dispute-countdown', type: 'dispute-countdown', visible: true },
        { id: 'dispute-progress', type: 'dispute-progress', visible: true },
        { id: 'transaction-feed', type: 'transaction-feed', visible: true },
    ],
} satisfies DashboardConfig);

/** Return a fresh, deeply-cloned copy of the canonical default config. */
export function createDefaultConfig(): DashboardConfig {
    return {
        version: DEFAULT_DASHBOARD_CONFIG.version,
        refreshIntervalMinutes: DEFAULT_DASHBOARD_CONFIG.refreshIntervalMinutes,
        layout: DEFAULT_DASHBOARD_CONFIG.layout.map((item) => ({ ...item })),
        widgets: DEFAULT_DASHBOARD_CONFIG.widgets.map((w) => ({ ...w })),
    };
}

/** Default footprint for a synthesized/added widget (grid units). */
export const DEFAULT_WIDGET_LAYOUT = { w: 4, h: 4, minW: 2, minH: 2 } as const;

/** The lowest free row (largest `y + h`) in a layout, or 0 when empty. */
function nextFreeRow(layout: readonly LayoutItem[]): number {
    return layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/**
 * Reconcile a config so the layout and the widget set are consistent:
 *   - drop layout entries with no corresponding widget instance (orphans);
 *   - synthesize a layout entry (appended at the bottom of the grid) for every
 *     VISIBLE widget that is missing one.
 *
 * This self-heals configs that have drifted — e.g. a visible widget with no
 * layout entry, which `WidgetGrid` would otherwise never render (a widget that
 * is "on" in the config panel but invisible on the dashboard). It is a no-op
 * for a config whose layout and widgets already correspond 1:1, so serialize →
 * parse round-trips are preserved.
 */
export function reconcileConfig(config: DashboardConfig): DashboardConfig {
    const widgetIds = new Set(config.widgets.map((w) => w.id));

    // Keep only layout entries that still map to a widget instance.
    const layout = config.layout.filter((item) => widgetIds.has(item.i));

    // Add a default entry for any visible widget that lacks one, stacking them
    // below the existing content so nothing overlaps.
    const haveLayout = new Set(layout.map((item) => item.i));
    let y = nextFreeRow(layout);
    for (const widget of config.widgets) {
        if (widget.visible && !haveLayout.has(widget.id)) {
            layout.push({ i: widget.id, x: 0, y, ...DEFAULT_WIDGET_LAYOUT });
            haveLayout.add(widget.id);
            y += DEFAULT_WIDGET_LAYOUT.h;
        }
    }

    return { ...config, layout };
}

// ---------------------------------------------------------------------------
// Pure parse / validate / prune logic (DOM-free, React-free).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isKnownWidgetType(value: unknown): value is WidgetType {
    return typeof value === 'string' && KNOWN_WIDGET_TYPE_SET.has(value);
}

/** Structural check for a widget instance (type may still be unavailable). */
function isWidgetInstanceShape(
    value: unknown,
): value is { id: string; type: string; visible: boolean } {
    return (
        isPlainObject(value) &&
        typeof value.id === 'string' &&
        typeof value.type === 'string' &&
        typeof value.visible === 'boolean'
    );
}

/** Structural check for a layout item. */
function isLayoutItemShape(value: unknown): value is LayoutItem {
    return (
        isPlainObject(value) &&
        typeof value.i === 'string' &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.w) &&
        isFiniteNumber(value.h) &&
        (value.minW === undefined || isFiniteNumber(value.minW)) &&
        (value.minH === undefined || isFiniteNumber(value.minH))
    );
}

/** Rebuild a layout item keeping only the persisted fields (drop extras). */
function reconstructLayoutItem(item: LayoutItem): LayoutItem {
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
}

/**
 * Validate and sanitize an already-parsed value into a DashboardConfig.
 *
 * - Non-object shapes, or a missing/non-array `widgets`/`layout`, are treated
 *   as corrupt and fall back to the default config.
 * - Widgets with an unavailable type are pruned, and any layout entry keyed to
 *   a pruned widget is removed as well (Requirement 2.5). The remaining valid
 *   widgets keep their original order and positions.
 * - `version`/`refreshIntervalMinutes` fall back to defaults when not numeric.
 */
function sanitizeConfig(value: unknown): DashboardConfig {
    if (!isPlainObject(value)) {
        console.warn(
            '[useWidgetConfig] Stored config is not an object; using default config.',
        );
        return createDefaultConfig();
    }

    const { widgets: rawWidgets, layout: rawLayout } = value;
    if (!Array.isArray(rawWidgets) || !Array.isArray(rawLayout)) {
        console.warn(
            '[useWidgetConfig] Stored config is missing a valid widgets/layout array; using default config.',
        );
        return createDefaultConfig();
    }

    // Keep structurally-valid widgets with a known type; track the ids of
    // widgets pruned for having an unavailable type so their layout entries
    // can be removed too.
    const widgets: WidgetInstance[] = [];
    const unavailableWidgetIds = new Set<string>();
    for (const candidate of rawWidgets) {
        if (!isWidgetInstanceShape(candidate)) continue;
        if (isKnownWidgetType(candidate.type)) {
            widgets.push({
                id: candidate.id,
                type: candidate.type,
                visible: candidate.visible,
            });
        } else {
            unavailableWidgetIds.add(candidate.id);
        }
    }

    // Keep structurally-valid layout items, dropping those tied to a pruned
    // (unavailable) widget while preserving the rest in their original order.
    const layout: LayoutItem[] = [];
    for (const candidate of rawLayout) {
        if (!isLayoutItemShape(candidate)) continue;
        if (unavailableWidgetIds.has(candidate.i)) continue;
        layout.push(reconstructLayoutItem(candidate));
    }

    const version = isFiniteNumber(value.version)
        ? value.version
        : DEFAULT_DASHBOARD_CONFIG.version;
    const refreshIntervalMinutes = isFiniteNumber(value.refreshIntervalMinutes)
        ? value.refreshIntervalMinutes
        : DEFAULT_DASHBOARD_CONFIG.refreshIntervalMinutes;

    return { version, refreshIntervalMinutes, layout, widgets };
}

/**
 * Parse a raw localStorage string into a DashboardConfig, falling back to the
 * default config on any problem (null/empty, JSON parse error, or corrupt
 * shape) and pruning unavailable widget types from otherwise-valid configs.
 *
 * This is the pure, DOM-free entry point exercised directly by the property
 * tests in tasks 9.4 (round-trip) and 9.5 (invalid widget type removal).
 */
export function parseStoredConfig(raw: string | null): DashboardConfig {
    if (raw === null || raw === '') {
        return createDefaultConfig();
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        console.warn(
            '[useWidgetConfig] Stored config is not valid JSON; using default config.',
        );
        return createDefaultConfig();
    }
    // Sanitize (drop unavailable widget types) then reconcile so every visible
    // widget is guaranteed a layout entry and no orphan entries remain.
    return reconcileConfig(sanitizeConfig(parsed));
}

// ---------------------------------------------------------------------------
// localStorage access wrappers (guard against disabled/throwing storage).
// ---------------------------------------------------------------------------

function readRawConfig(): string | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(WIDGET_CONFIG_STORAGE_KEY);
    } catch (error) {
        console.warn(
            '[useWidgetConfig] Unable to read from localStorage; using default config.',
            error,
        );
        return null;
    }
}

function writeRawConfig(config: DashboardConfig): void {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(
            WIDGET_CONFIG_STORAGE_KEY,
            JSON.stringify(config),
        );
    } catch (error) {
        console.warn(
            '[useWidgetConfig] Unable to persist config to localStorage.',
            error,
        );
    }
}

/** Load and sanitize the persisted config (or the default) from localStorage. */
export function loadStoredConfig(): DashboardConfig {
    return parseStoredConfig(readRawConfig());
}

/**
 * React hook exposing the dashboard config as the single source of truth.
 * Loads (and prunes) from localStorage on mount, and re-serializes to
 * localStorage on every config change so the layout survives sessions
 * (Requirement 2.2).
 *
 * Returns a `[config, setConfig]` tuple; `setConfig` is stable and intended to
 * be passed straight to `DashboardShell`'s `onConfigChange`.
 */
export function useWidgetConfig(): [
    DashboardConfig,
    (config: DashboardConfig) => void,
] {
    const [config, setConfigState] = useState<DashboardConfig>(loadStoredConfig);

    // Skip persisting the value we just loaded on the very first render; only
    // write once a real change has been applied (Requirement 2.2).
    const isFirstRender = useRef(true);
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        writeRawConfig(config);
    }, [config]);

    const setConfig = useCallback((next: DashboardConfig) => {
        setConfigState(next);
    }, []);

    return [config, setConfig];
}
