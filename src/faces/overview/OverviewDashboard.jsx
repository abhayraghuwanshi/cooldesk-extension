import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/cooldesk.css';
import { ActivityFeed } from './parts/ActivityFeed';
import { ActivityOverview } from '../../features/activity/ActivityOverview';
import { WidgetBoard } from '../../features/widgets/WidgetBoard';
import { AccentColorPicker, TRANSPARENT_ACCENT } from '../../shared/components/AccentColorPicker.jsx';

const LEFT_COLOR_KEY = 'cooldesk-overview-left-color';
const ACTIVITY_COLOR_KEY = 'cooldesk-overview-activity-color';
const LEFT_OPACITY_KEY = 'cooldesk-overview-left-colorless-opacity';
const ACTIVITY_OPACITY_KEY = 'cooldesk-overview-activity-colorless-opacity';

// Matches the --colorless-opacity fallback in cooldesk.css's .is-colorless
// rules, so a column with no saved slider value looks identical to one that
// has never touched Colorless at all.
const DEFAULT_COLORLESS_OPACITY = 0.55;

const isHex6 = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
const isStoredAccent = (c) => c === TRANSPARENT_ACCENT || isHex6(c);

function loadAccent(key) {
    try {
        const v = localStorage.getItem(key);
        return isStoredAccent(v) ? v : null;
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

function loadOpacity(key) {
    try {
        const v = parseFloat(localStorage.getItem(key));
        return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_COLORLESS_OPACITY;
    } catch {
        return DEFAULT_COLORLESS_OPACITY;
    }
}

// How dark the Colorless card color sits under its blur — readability vs.
// how much wallpaper shows through is a taste + per-wallpaper call (a calm
// gradient can run much lighter than a busy photo), so it's a user-set knob
// rather than one fixed value baked into the CSS.
function useColumnOpacity(storageKey) {
    const [opacity, setOpacity] = useState(() => loadOpacity(storageKey));
    const update = useCallback((next) => {
        setOpacity(next);
        try { localStorage.setItem(storageKey, String(next)); } catch { /* storage unavailable — won't persist */ }
    }, [storageKey]);
    return [opacity, update];
}

// Hover-revealed "card color" chip + portaled swatch popover — same grammar
// as the per-widget accent chip (WidgetBoard's ◍), but for a whole column
// card instead of a repeating tile. Portaled to <body> because both columns
// use backdrop-filter, which makes them a containing block for
// position:fixed descendants (see WidgetBoard.jsx's picker-overlay comment).
function ColumnColorChip({ color, onChange, opacity, onOpacityChange }) {
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
                style={color && color !== TRANSPARENT_ACCENT ? { color } : undefined}
                onClick={e => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    // Anchor from the viewport's right edge, not the button's
                    // right edge — the chip sits at the column's top-right
                    // corner (right: 10px), so opening the menu rightward
                    // (left: r.right) pushed it straight off-screen on the
                    // activity column. Right-anchoring makes it open leftward
                    // into the visible column instead, same as it would if
                    // built with a native <details>/menu.
                    setMenu({ top: r.bottom + 4, right: window.innerWidth - r.right });
                }}
            >
                ◍
            </button>
            {menu && createPortal(
                <div
                    className="workspace-context-menu"
                    style={{ top: menu.top, right: menu.right }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}
                >
                    <div className="context-menu-label">Card color</div>
                    <AccentColorPicker
                        className="context-menu-swatches"
                        value={color}
                        allowTransparent
                        onSelect={(next, source) => {
                            onChange(next);
                            if (source !== 'custom') setMenu(null);
                        }}
                    />
                    {color === TRANSPARENT_ACCENT && (
                        <div className="context-menu-opacity">
                            <span className="context-menu-opacity-label">Darkness</span>
                            <input
                                type="range"
                                min={0.15}
                                max={0.85}
                                step={0.05}
                                value={opacity}
                                onClick={e => e.stopPropagation()}
                                onChange={e => onOpacityChange(parseFloat(e.target.value))}
                                title={`${Math.round(opacity * 100)}% — lower shows more wallpaper, higher stays legible over busier ones`}
                            />
                        </div>
                    )}
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
    const [leftOpacity, setLeftOpacity] = useColumnOpacity(LEFT_OPACITY_KEY);
    const [activityOpacity, setActivityOpacity] = useColumnOpacity(ACTIVITY_OPACITY_KEY);

    return (
        // .overview-scope establishes the container-query context; the grid
        // inside responds to this width, not the viewport.
        <div className="overview-scope">
            <div className="overview-dashboard-grid">
                {/* Left: widget board + shared activity overview */}
                <div
                    className={`overview-left-column ${leftColor === TRANSPARENT_ACCENT ? 'is-colorless' : leftColor ? 'has-accent' : ''}`}
                    style={
                        leftColor === TRANSPARENT_ACCENT ? { '--colorless-opacity': leftOpacity }
                            : leftColor ? { '--card-accent': leftColor }
                                : undefined
                    }
                >
                    <ColumnColorChip
                        color={leftColor}
                        onChange={setLeftColor}
                        opacity={leftOpacity}
                        onOpacityChange={setLeftOpacity}
                    />
                    <WidgetBoard />
                    <ActivityOverview embedded hideWhenEmpty />
                </div>

                {/* Right: Activity Feed */}
                <div
                    className={`overview-activity-column ${activityColor === TRANSPARENT_ACCENT ? 'is-colorless' : activityColor ? 'has-accent' : ''}`}
                    style={
                        activityColor === TRANSPARENT_ACCENT ? { '--colorless-opacity': activityOpacity }
                            : activityColor ? { '--card-accent': activityColor }
                                : undefined
                    }
                >
                    <ColumnColorChip
                        color={activityColor}
                        onChange={setActivityColor}
                        opacity={activityOpacity}
                        onOpacityChange={setActivityOpacity}
                    />
                    <ActivityFeed />
                </div>
            </div>
        </div>
    );
});

export { OverviewDashboard };
