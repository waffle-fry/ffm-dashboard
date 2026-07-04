// Root application component.
//
// The dashboard configuration (widget selection, order, position, size) is
// owned by `useWidgetConfig`, which loads it from localStorage on mount —
// falling back to the canonical default layout with all widgets when nothing
// is stored or the stored value is corrupt (Requirements 2.2, 2.3, 2.5) — and
// re-persists it on every change.

import DashboardShell from './components/DashboardShell';
import { useWidgetConfig } from './hooks/useWidgetConfig';

export default function App(): JSX.Element {
    const [config, setConfig] = useWidgetConfig();
    return <DashboardShell config={config} onConfigChange={setConfig} />;
}
