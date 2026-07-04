// ConfigPanel — a slide-out panel for managing the dashboard configuration.
//
// It lets the ops team add/remove metric widgets (Requirement 2.1) and adjust
// the automatic refresh interval (Requirement 8.1). All persisted state lives
// in the DashboardConfig owned by `useWidgetConfig` (via localStorage); this
// panel mutates it only through the injected `onConfigChange` callback so the
// changes are persisted for free.
//
// Requirement 2.1: adding a widget inserts a WidgetInstance AND a LayoutItem so
//   it renders in the grid; removing a widget drops both. The pure config
//   transforms (`addWidget`, `removeWidget`) enforce this and are unit-tested.
// Requirement 8.1: the refresh interval is validated/clamped to [1, 60] in the
//   UI (`clampRefreshIntervalMinutes`, mirroring the engine's Property 19),
//   written back to the local config, AND sent to the engine via PUT /api/config
//   so the scheduler picks up the new cadence. A failed PUT is swallowed so the
//   local config still updates and the UI never crashes.
//
// The panel overlays the dashboard (fixed position + backdrop) rather than
// pushing the layout, so the shell's full-viewport / no-scroll behavior
// (Requirement 1.3) stays intact.
//
// Design: the config-transform and clamping logic is extracted into the pure,
// DOM-free exported helpers below so it can be unit-tested without React.

import { useCallback, useEffect, useState } from 'react';
import type {
    DashboardConfig,
    LayoutItem,
    WidgetInstance,
    WidgetType,
} from '@fans-fund-me/shared';
import { KNOWN_WIDGET_TYPES } from '../hooks/useWidgetConfig';
import { WIDGET_TITLES } from './widget-titles';

// ---------------------------------------------------------------------------
// Refresh-interval validation (mirrors engine Property 19, kept simple/local).
// ---------------------------------------------------------------------------

/** Smallest allowed refresh interval in minutes (Requirement 8.1). */
export const MIN_REFRESH_INTERVAL_MINUTES = 1;
/** Largest allowed refresh interval in minutes (Requirement 8.1). */
export const MAX_REFRESH_INTERVAL_MINUTES = 60;
/** Default refresh interval in minutes when input is not a finite number. */
export const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;

/**
 * Validate and clamp a refresh-interval value to [1, 60].
 *
 * Non-numeric / non-finite input defaults to 5; values below 1 clamp to 1,
 * above 60 clamp to 60, and in-range values are rounded to the nearest integer.
 * This mirrors the engine's `clampRefreshInterval` (design Property 19) so the
 * UI and the scheduler agree on what a given input means.
 */
export function clampRefreshIntervalMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_REFRESH_INTERVAL_MINUTES;
    }
    if (value < MIN_REFRESH_INTERVAL_MINUTES) {
        return MIN_REFRESH_INTERVAL_MINUTES;
    }
    if (value > MAX_REFRESH_INTERVAL_MINUTES) {
        return MAX_REFRESH_INTERVAL_MINUTES;
    }
    return Math.round(value);
}

// ---------------------------------------------------------------------------
// Default geometry for a newly-added widget.
// ---------------------------------------------------------------------------

/**
 * Default size for a widget added from the panel. Matches the size/constraints
 * of the summary widgets in DEFAULT_DASHBOARD_CONFIG so an added widget looks
 * consistent with the default layout.
 */
export const DEFAULT_ADDED_WIDGET_W = 4;
export const DEFAULT_ADDED_WIDGET_H = 4;
export const DEFAULT_ADDED_WIDGET_MIN_W = 2;
export const DEFAULT_ADDED_WIDGET_MIN_H = 2;

// ---------------------------------------------------------------------------
// Pure config transforms (DOM-free, React-free) — directly unit-testable.
// ---------------------------------------------------------------------------

/** True when the config already contains an instance of the given widget type. */
export function isWidgetPresent(
    config: DashboardConfig,
    type: WidgetType,
): boolean {
    return config.widgets.some((w) => w.type === type);
}

/** The set of widget types currently present in the config. */
export function presentWidgetTypes(config: DashboardConfig): Set<WidgetType> {
    return new Set(config.widgets.map((w) => w.type));
}

/**
 * Compute the y-coordinate for a widget appended at the bottom of the grid: the
 * largest `y + h` across existing layout items, or 0 when the layout is empty.
 */
function nextLayoutRow(layout: LayoutItem[]): number {
    return layout.reduce((maxBottom, item) => {
        const bottom = item.y + item.h;
        return bottom > maxBottom ? bottom : maxBottom;
    }, 0);
}

/**
 * Add a widget of `type` to the config (Requirement 2.1).
 *
 * Inserts a visible WidgetInstance AND a LayoutItem (appended at the bottom of
 * the grid with a sensible default size) so the widget actually renders. The
 * widget id equals its type — there is at most one instance per type in this
 * present/absent model, which keeps ids stable and unique. Returns the config
 * unchanged when a widget of that type is already present.
 */
export function addWidget(
    config: DashboardConfig,
    type: WidgetType,
): DashboardConfig {
    if (isWidgetPresent(config, type)) {
        return config;
    }
    const id = type;
    const instance: WidgetInstance = { id, type, visible: true };
    const layoutItem: LayoutItem = {
        i: id,
        x: 0,
        y: nextLayoutRow(config.layout),
        w: DEFAULT_ADDED_WIDGET_W,
        h: DEFAULT_ADDED_WIDGET_H,
        minW: DEFAULT_ADDED_WIDGET_MIN_W,
        minH: DEFAULT_ADDED_WIDGET_MIN_H,
    };
    return {
        ...config,
        widgets: [...config.widgets, instance],
        layout: [...config.layout, layoutItem],
    };
}

/**
 * Remove every widget of `type` from the config (Requirement 2.1).
 *
 * Drops both the matching WidgetInstance(s) and their corresponding LayoutItem
 * entries (matched by widget id) so nothing dangles in the grid. Returns the
 * config unchanged when no widget of that type is present.
 */
export function removeWidget(
    config: DashboardConfig,
    type: WidgetType,
): DashboardConfig {
    if (!isWidgetPresent(config, type)) {
        return config;
    }
    const removedIds = new Set(
        config.widgets.filter((w) => w.type === type).map((w) => w.id),
    );
    return {
        ...config,
        widgets: config.widgets.filter((w) => w.type !== type),
        layout: config.layout.filter((item) => !removedIds.has(item.i)),
    };
}

/**
 * Return a new config with the refresh interval validated/clamped to [1, 60]
 * (Requirement 8.1). The rest of the config is left untouched.
 */
export function setRefreshIntervalMinutes(
    config: DashboardConfig,
    value: unknown,
): DashboardConfig {
    return {
        ...config,
        refreshIntervalMinutes: clampRefreshIntervalMinutes(value),
    };
}

// ---------------------------------------------------------------------------
// Engine sync.
// ---------------------------------------------------------------------------

/** Endpoint the engine exposes for updating the aggregator refresh interval. */
export const CONFIG_ENDPOINT = '/api/config';

/**
 * Send the new refresh interval to the engine via PUT /api/config so the
 * scheduler updates its cadence (Requirement 8.1). Never throws: any network
 * or HTTP failure resolves to `false` so the caller's local config update is
 * unaffected and the UI does not crash.
 */
export async function putRefreshInterval(minutes: number): Promise<boolean> {
    try {
        const res = await fetch(CONFIG_ENDPOINT, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshIntervalMinutes: minutes }),
        });
        return res.ok;
    } catch {
        // Swallow: the local config still updates; the engine will reconcile on
        // its next config read / the user can retry.
        return false;
    }
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface ConfigPanelProps {
    config: DashboardConfig;
    onConfigChange: (config: DashboardConfig) => void;
    /** Whether the panel is currently open (slid in). */
    isOpen: boolean;
    /** Called when the user dismisses the panel (close button or backdrop). */
    onClose: () => void;
}

const REFRESH_INPUT_ID = 'config-refresh-interval';

export default function ConfigPanel({
    config,
    onConfigChange,
    isOpen,
    onClose,
}: ConfigPanelProps): JSX.Element {
    // Local buffer for the interval input so the user can type freely (e.g.
    // clear the field) without the value being clamped mid-edit. Re-synced
    // whenever the persisted interval changes.
    const [intervalInput, setIntervalInput] = useState<string>(
        String(config.refreshIntervalMinutes),
    );
    useEffect(() => {
        setIntervalInput(String(config.refreshIntervalMinutes));
    }, [config.refreshIntervalMinutes]);

    const present = presentWidgetTypes(config);

    const handleToggleWidget = useCallback(
        (type: WidgetType) => {
            const next = isWidgetPresent(config, type)
                ? removeWidget(config, type)
                : addWidget(config, type);
            onConfigChange(next);
        },
        [config, onConfigChange],
    );

    /** Clamp + commit the interval: update local config and sync the engine. */
    const commitInterval = useCallback(
        (raw: string) => {
            const parsed = Number(raw);
            if (raw.trim() === '' || Number.isNaN(parsed)) {
                // Not a usable number yet — leave the persisted value as-is and
                // wait for a valid entry (normalized on blur).
                return;
            }
            const clamped = clampRefreshIntervalMinutes(parsed);
            if (clamped !== config.refreshIntervalMinutes) {
                onConfigChange(setRefreshIntervalMinutes(config, clamped));
            }
            // Fire-and-forget; failures are handled inside putRefreshInterval.
            void putRefreshInterval(clamped);
        },
        [config, onConfigChange],
    );

    const handleIntervalChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const raw = event.target.value;
            setIntervalInput(raw);
            commitInterval(raw);
        },
        [commitInterval],
    );

    const handleIntervalBlur = useCallback(() => {
        // Normalize the visible value to the clamped, persisted interval.
        setIntervalInput(String(config.refreshIntervalMinutes));
    }, [config.refreshIntervalMinutes]);

    return (
        <>
            {/* Backdrop — click to dismiss. Non-interactive when closed. */}
            <div
                aria-hidden="true"
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ${isOpen
                        ? 'opacity-100'
                        : 'pointer-events-none opacity-0'
                    }`}
            />

            {/* Slide-out panel. Overlays (fixed) so the grid layout is untouched. */}
            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Dashboard configuration"
                aria-hidden={!isOpen}
                className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-full flex-col border-l border-border bg-surface text-text-primary shadow-2xl transition-transform duration-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <header className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="font-heading text-text-primary">
                        Configure Dashboard
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close configuration panel"
                        title="Close"
                        className="shrink-0 rounded border border-border px-2 py-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                    >
                        <span aria-hidden="true">✕</span>
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                    {/* Refresh interval (Requirement 8.1). */}
                    <section className="mb-6">
                        <label
                            htmlFor={REFRESH_INPUT_ID}
                            className="mb-1 block font-heading text-text-primary"
                        >
                            Refresh interval
                        </label>
                        <p className="mb-2 text-xs text-text-secondary">
                            How often widgets refresh, in minutes (
                            {MIN_REFRESH_INTERVAL_MINUTES}–
                            {MAX_REFRESH_INTERVAL_MINUTES}).
                        </p>
                        <div className="flex items-center gap-2">
                            <input
                                id={REFRESH_INPUT_ID}
                                type="number"
                                inputMode="numeric"
                                min={MIN_REFRESH_INTERVAL_MINUTES}
                                max={MAX_REFRESH_INTERVAL_MINUTES}
                                step={1}
                                value={intervalInput}
                                onChange={handleIntervalChange}
                                onBlur={handleIntervalBlur}
                                className="w-24 rounded border border-border bg-background px-2 py-1 text-text-primary focus:border-accent focus:outline-none"
                            />
                            <span className="text-sm text-text-secondary">
                                minutes
                            </span>
                        </div>
                    </section>

                    {/* Widget add/remove (Requirement 2.1). */}
                    <section>
                        <h3 className="mb-1 font-heading text-text-primary">
                            Widgets
                        </h3>
                        <p className="mb-2 text-xs text-text-secondary">
                            Choose which widgets appear on the dashboard.
                        </p>
                        <ul className="flex flex-col gap-1">
                            {KNOWN_WIDGET_TYPES.map((type) => {
                                const checked = present.has(type);
                                return (
                                    <li key={type}>
                                        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-surface-raised">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() =>
                                                    handleToggleWidget(type)
                                                }
                                                className="h-4 w-4 accent-accent"
                                            />
                                            <span className="text-text-primary">
                                                {WIDGET_TITLES[type]}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                </div>
            </aside>
        </>
    );
}
