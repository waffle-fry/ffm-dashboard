// DashboardShell — the root layout component.
//
// Owns the full-viewport chrome (header + grid area) and bridges the grid's
// layout changes back to the caller as DashboardConfig updates.
//
// Requirement 1.3: the shell is exactly one viewport tall (`h-screen`) with the
//   grid area flexing to fill the space below the header and `overflow-hidden`
//   so the default configuration never introduces scrolling at 1920×1080.
// Requirement 2.4: onLayoutChange produces a new config and calls
//   onConfigChange synchronously — no full page reload, well under 500ms.

import { useCallback, useMemo, useState } from 'react';
import type {
    DashboardConfig,
    LayoutItem,
    WidgetInstance,
} from '@fans-fund-me/shared';
import WidgetGrid, { type WidgetDefinition } from './WidgetGrid';
import { renderWidget } from '../widgets/registry';
import ConfigPanel from './ConfigPanel';
import Logo from './Logo';
import HeaderStatus from './HeaderStatus';
import { WIDGET_TITLES } from './widget-titles';

export interface DashboardShellProps {
    config: DashboardConfig;
    onConfigChange: (config: DashboardConfig) => void;
}

/**
 * Map visible widget instances to renderable grid widget definitions. The
 * content is the concrete widget component from the registry, which renders its
 * own full card chrome (border + title bar + refresh). The `title` is kept only
 * as an accessible label for the grid's drag handle — the grid must NOT render
 * a second visible title, to avoid the double-chrome problem.
 */
function buildWidgetDefinitions(
    widgets: WidgetInstance[],
): WidgetDefinition[] {
    return widgets
        .filter((w) => w.visible)
        .map((w) => ({
            id: w.id,
            type: w.type,
            title: WIDGET_TITLES[w.type],
            content: renderWidget(w.type),
        }));
}

export default function DashboardShell({
    config,
    onConfigChange,
}: DashboardShellProps): JSX.Element {
    const widgets = useMemo(
        () => buildWidgetDefinitions(config.widgets),
        [config.widgets],
    );

    const handleLayoutChange = useCallback(
        (layout: LayoutItem[]) => {
            onConfigChange({ ...config, layout });
        },
        [config, onConfigChange],
    );

    // The config panel overlays the dashboard; its open state is local UI state.
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const openConfig = useCallback(() => setIsConfigOpen(true), []);
    const closeConfig = useCallback(() => setIsConfigOpen(false), []);

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-body text-text-primary">
            <header className="flex items-center justify-between border-b border-border px-6 py-3">
                <Logo height={36} className="text-text-primary" />
                <div className="flex items-center gap-4">
                    <HeaderStatus />
                    <button
                        type="button"
                        onClick={openConfig}
                        aria-label="Configure dashboard"
                        aria-haspopup="dialog"
                        aria-expanded={isConfigOpen}
                        title="Configure dashboard"
                        className="shrink-0 rounded border border-border px-3 py-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                    >
                        <span aria-hidden="true">⚙</span>
                        <span className="ml-2">Configure</span>
                    </button>
                </div>
            </header>
            <main className="min-h-0 flex-1 overflow-hidden">
                <WidgetGrid
                    layout={config.layout}
                    widgets={widgets}
                    onLayoutChange={handleLayoutChange}
                />
            </main>
            <ConfigPanel
                config={config}
                onConfigChange={onConfigChange}
                isOpen={isConfigOpen}
                onClose={closeConfig}
            />
        </div>
    );
}
