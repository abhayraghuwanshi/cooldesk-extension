import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/cooldesk.css';
import { ActivityFeed } from './parts/ActivityFeed';
import { ActivityOverview } from '../../features/activity/ActivityOverview';
import { WidgetBoard } from '../../features/widgets/WidgetBoard';
import { AccentColorPicker } from '../../shared/components/AccentColorPicker.jsx';

const LEFT_COLOR_KEY = 'cooldesk-overview-left-color';
const ACTIVITY_COLOR_KEY = 'cooldesk-overview-activity-color';

const isHex6 = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');

function loadAccent(key) {
    try {
        const v = localStorage.getItem(key);
        return isHex6(v) ? v : null;
    } catch {
        return null;
    }
}

function saveAccent(key, color) {
    try {
        if (color) localStorage.setItem(key, color);
        else localStorage.removeItem(key);
    } catch { /* storage unavailable — accent just won't persist */ }
}

function useColumnAccent(storageKey) {
    const [color, setColor] = useState(() => loadAccent(storageKey));
    const update = useCallback((next) => {
        setColor(next);
        saveAccent(storageKey, next);
    }, [storageKey]);
    return [color, update];
}

// Hover-revealed "card color" chip + portaled swatch popover — same grammar
// as the per-widget accent chip (WidgetBoard's ◍), but for a whole column
// card instead of a repeating tile. Portaled to <body> because both columns
// use backdrop-filter, which makes them a containing block for
// position:fixed descendants (see WidgetBoard.jsx's picker-overlay comment).
function ColumnColorChip({ color, onChange }) {
    const [menu, setMenu] = useState(null);

    useEffect(() => {
        if (!menu) return;
        const dismiss = (e) => {
            if (e.target?.closest?.('.workspace-context-menu')) return;
            setMenu(null);
        };
        const raf = requestAnimationFrame(() => {
            window.addEventListener('click', dismiss);
            window.addEventListener('contextmenu', dismiss);
        });
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('click', dismiss);
            window.removeEventListener('contextmenu', dismiss);
        };
    }, [menu]);

    return (
        <div className="overview-column-controls">
            <button
                type="button"
                className={`overview-column-color-chip ${color ? 'active' : ''}`}
                title="Card color"
                style={color ? { color } : undefined}
                onClick={e => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.right - 4, y: r.bottom + 4 });
                }}
            >
                ◍
            </button>
            {menu && createPortal(
                <div
                    className="workspace-context-menu"
                    style={{ top: menu.y, left: menu.x }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}
                >
                    <div className="context-menu-label">Card color</div>
                    <AccentColorPicker
                        className="context-menu-swatches"
                        value={color}
                        onSelect={(next, source) => {
                            onChange(next);
                            if (source !== 'custom') setMenu(null);
                        }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
}

// Thin composition layer: widget board (clock/date live there as widgets now)
// + the shared ActivityOverview (same component the Knowledge Graph modal's
// Overview tab renders) + ActivityFeed.
//
// Everything imports statically on purpose: these ARE the page. Lazy chunks
// here just staged the mount (board after activity, feed after both) and
// produced ~0.7 CLS as each arrival re-laid the grid. The bundle loads from
// disk, so splitting it saved no network.
const OverviewDashboard = memo(function OverviewDashboard() {
    const [leftColor, setLeftColor] = useColumnAccent(LEFT_COLOR_KEY);
    const [activityColor, setActivityColor] = useColumnAccent(ACTIVITY_COLOR_KEY);

    return (
        // .overview-scope establishes the container-query context; the grid
        // inside responds to this width, not the viewport.
        <div className="overview-scope">
            <div className="overview-dashboard-grid">
                {/* Left: widget board + shared activity overview */}
                <div
                    className={`overview-left-column ${leftColor ? 'has-accent' : ''}`}
                    style={leftColor ? { '--card-accent': leftColor } : undefined}
                >
                    <ColumnColorChip color={leftColor} onChange={setLeftColor} />
                    <WidgetBoard />
                    <ActivityOverview embedded hideWhenEmpty />
                </div>

                {/* Right: Activity Feed */}
                <div
                    className={`overview-activity-column ${activityColor ? 'has-accent' : ''}`}
                    style={activityColor ? { '--card-accent': activityColor } : undefined}
                >
                    <ColumnColorChip color={activityColor} onChange={setActivityColor} />
                    <ActivityFeed />
                </div>
            </div>
        </div>
    );
});

export { OverviewDashboard };
