import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AccentColorPicker } from '../../shared/components/AccentColorPicker.jsx';
import {
    WIDGET_CATALOG,
    WIDGET_CATEGORIES,
    WIDGET_STORE_URL,
    getWidget,
    widgetEmbedUrl,
    widgetEmbedOrigin,
} from '../../data/widgetCatalog';
import {
    CUSTOM_WIDGET_PROMPT,
    deleteCustomWidget,
    isCustomWidgetId,
    loadCustomWidgets,
    saveCustomWidget,
} from '../../data/customWidgets';
import { attachWidgetHostBridge } from '../../services/widgetHostBridge';
import './WidgetBoard.css';

// Every widget iframe gets the host bridge on load: widget data mirrors into
// the extension's own IndexedDB. Widgets are now served same-origin (bundled in
// public/widgets/), so the bridge targets the app's own origin.
// The 'loaded' class fades the frame in — boxes are pre-sized, so late paint
// is an opacity change, never a layout shift.
const bridgeOnLoad = (e) => {
    e.currentTarget.classList.add('loaded');
    attachWidgetHostBridge(e.currentTarget, widgetEmbedOrigin());
};

// User-authored widgets render in the extension's sandboxed page: opaque
// origin, no chrome APIs, inline scripts allowed by the sandbox CSP. The
// pasted HTML and theme are handed over post-load; storage is relayed over
// the same bridge protocol, namespaced per widget.
function CustomWidgetFrame({ widget, theme, className, style }) {
    const onLoad = (e) => {
        const frame = e.currentTarget;
        frame.classList.add('loaded');
        attachWidgetHostBridge(frame, '*', `c:${widget.id}:`);
        try {
            frame.contentWindow.postMessage(
                { type: 'cooldesk:custom-widget', html: widget.html, theme },
                '*'
            );
        } catch { /* frame gone */ }
    };
    return (
        <iframe
            className={className}
            src="widget-sandbox.html"
            title={widget.name}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            style={style}
            onLoad={onLoad}
        />
    );
}

const STORAGE_KEY_V1 = 'cooldesk-widget-board';   // single-board era
const STORAGE_KEY = 'cooldesk-widget-layouts';    // { active, layouts: { name: tiles[] } }

// Apple-style size classes: small = half-width, medium = full-width,
// large = full-width with extra vertical room.
const SIZES = ['s', 'm', 'l'];
const SIZE_LABELS = { s: 'S', m: 'M', l: 'L' };

// Fine-grained masonry rows: a tile spanning n rows is 18n - 10 px tall
// (8px rows + 10px gap), so tiles land within ~8px of the widget's designed
// height instead of stretching to a coarse row multiple.
const GRID_ROW = 8;
const GRID_GAP = 10;

const DEFAULT_BOARD = [
    { id: 'clock', size: 's' },
    { id: 'weather', size: 's' },
    { id: 'todo', size: 's' },
    { id: 'quotes', size: 'm' },
];

const isHex6 = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');

function sanitizeTiles(arr) {
    // Custom ids pass through here; whether they still exist is checked at
    // render time against the custom-widget store.
    return arr.filter(t => t && (getWidget(t.id) || isCustomWidgetId(t.id))).map(t => ({
        id: t.id,
        size: SIZES.includes(t.size) ? t.size : 's',
        // Accent is optional; drop anything that isn't a plain hex so a bad
        // value can never end up inside a color-mix().
        ...(isHex6(t.color) ? { color: t.color } : {}),
    }));
}

function loadLayouts(storageKey, defaultBoard, migrateV1) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            const s = JSON.parse(raw);
            if (s && s.layouts && typeof s.layouts === 'object') {
                const layouts = {};
                for (const [name, tiles] of Object.entries(s.layouts)) {
                    if (Array.isArray(tiles)) layouts[name] = sanitizeTiles(tiles);
                }
                if (Object.keys(layouts).length > 0) {
                    return { active: layouts[s.active] ? s.active : Object.keys(layouts)[0], layouts };
                }
            }
        }
        // Migrate the single-board era in place (main board only).
        if (migrateV1) {
            const v1 = JSON.parse(localStorage.getItem(STORAGE_KEY_V1) || 'null');
            if (Array.isArray(v1)) return { active: 'Home', layouts: { Home: sanitizeTiles(v1) } };
        }
    } catch { /* fall through to default */ }
    return { active: 'Home', layouts: { Home: defaultBoard } };
}

// A category-seeded layout starts with that category's first four widgets.
function seedForCategory(category) {
    return WIDGET_CATALOG.filter(w => w.category === category).slice(0, 4)
        .map(w => ({ id: w.id, size: 's' }));
}

function tileSpans(widget, size) {
    const rows = Math.ceil((widget.h + GRID_GAP) / (GRID_ROW + GRID_GAP));
    return {
        cols: size === 's' ? 1 : 2,
        rows: size === 'l' ? rows + 5 : rows, // large: ~+80px of extra room
    };
}

function currentTheme() {
    try {
        return localStorage.getItem('cooldesk-theme') === 'white-cred' ? 'light' : 'dark';
    } catch {
        return 'dark';
    }
}

// Must be reactive, not read once. Widgets are embedded with ?embed=host, so
// the tile paints the surface and the iframe paints only the text — a stale
// theme here means the tile flips (its .bg-white-cred ancestor class is live)
// while the iframe doesn't, which is exactly the white-on-white that got the
// host-owned surface reverted last time.
function useWidgetTheme() {
    const [theme, setTheme] = useState(currentTheme);
    useEffect(() => {
        const sync = () => setTheme(currentTheme());
        // In-page switch (Settings / onboarding) and other-window switch.
        window.addEventListener('cooldesk-theme-changed', sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener('cooldesk-theme-changed', sync);
            window.removeEventListener('storage', sync);
        };
    }, []);
    return theme;
}

const WidgetTile = memo(function WidgetTile({ tile, widget, theme, dragging, onResize, onRemove, onRecolor, onDragStart, onDragEnter, onDragEnd }) {
    const [menu, setMenu] = useState(null);

    // Dismiss on outside click. The menu is portaled out of the tile, so its
    // own React handlers can't stop these native listeners — skip clicks that
    // land inside it, or opening the native color picker closes it instantly.
    useEffect(() => {
        if (!menu) return;
        const dismiss = (e) => {
            if (e.target?.closest?.('.workspace-context-menu')) return;
            setMenu(null);
        };
        // Attached on the next frame, never in this one: React 18 flushes this
        // effect while the opening click is still in flight, so attaching now
        // would let that event dismiss the menu it just opened.
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

    if (!widget) return null;
    const { cols, rows } = tileSpans(widget, tile.size);

    // keepOpen for the live picker: closing unmounts the <input> mid-selection.
    const applyColor = (color, keepOpen) => {
        onRecolor(tile.id, color);
        if (!keepOpen) setMenu(null);
    };

    return (
        <div
            className={`wgb-tile ${dragging ? 'wgb-tile-dragging' : ''} ${tile.color ? 'has-accent' : ''}`}
            style={{
                gridColumn: `span ${cols}`,
                gridRow: `span ${rows}`,
                ...(tile.color ? { '--tile-accent': tile.color } : {}),
            }}
            onDragOver={e => e.preventDefault()}
            onDragEnter={() => onDragEnter(tile.id)}
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY });
            }}
        >
            {widget.custom ? (
                <CustomWidgetFrame widget={widget} theme={theme} className="wgb-frame" />
            ) : (
                <iframe
                    className="wgb-frame"
                    src={widgetEmbedUrl(widget.id, theme, tile.color)}
                    title={widget.name}
                    onLoad={bridgeOnLoad}
                />
            )}
            <div className="wgb-tile-controls">
                <span
                    className="wgb-chip wgb-chip-grip"
                    title="Drag to reorder"
                    draggable
                    onDragStart={e => {
                        e.dataTransfer.effectAllowed = 'move';
                        try { e.dataTransfer.setData('text/plain', tile.id); } catch { /* ignore */ }
                        onDragStart(tile.id);
                    }}
                    onDragEnd={onDragEnd}
                >
                    ⠿
                </span>
                {/* The iframe swallows contextmenu, so the tile's own right-click
                    only fires on its edges — this chip is the dependable way in. */}
                <button
                    className={`wgb-chip wgb-chip-color ${tile.color ? 'active' : ''}`}
                    title="Widget color"
                    style={tile.color ? { color: tile.color } : undefined}
                    onClick={e => {
                        // Must stop here: React's listener sits on the root
                        // container, so without this the very same native click
                        // carries on up to the window dismiss listener the menu
                        // just installed and closes it in the same tick.
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu({ x: r.left, y: r.bottom + 4 });
                    }}
                >
                    ◍
                </button>
                {SIZES.map(s => (
                    <button
                        key={s}
                        className={`wgb-chip ${tile.size === s ? 'active' : ''}`}
                        title={s === 's' ? 'Small' : s === 'm' ? 'Medium' : 'Large'}
                        onClick={() => onResize(tile.id, s)}
                    >
                        {SIZE_LABELS[s]}
                    </button>
                ))}
                <button className="wgb-chip wgb-chip-remove" title="Remove widget" onClick={() => onRemove(tile.id)}>
                    ✕
                </button>
            </div>

            {/* Portaled so the tile's overflow:hidden and the board's stacking
                context can't clip it — same pattern as the workspace card. */}
            {menu && createPortal(
                <div
                    className="workspace-context-menu"
                    style={{ top: menu.y, left: menu.x }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}
                >
                    <div className="context-menu-label">Widget color</div>
                    <AccentColorPicker
                        className="context-menu-swatches"
                        value={tile.color || null}
                        onSelect={(color, source) => applyColor(color, source === 'custom')}
                    />
                    <div className="context-menu-divider" />
                    <button
                        className="context-menu-item"
                        onClick={() => { onRemove(tile.id); setMenu(null); }}
                    >
                        Remove widget
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
});

// "Create your own" form: copy the AI prompt, paste the HTML the AI returns.
function CustomWidgetForm({ onCreate }) {
    const [name, setName] = useState('');
    const [height, setHeight] = useState('180');
    const [html, setHtml] = useState('');
    const [copied, setCopied] = useState(false);

    const copyPrompt = () => {
        navigator.clipboard.writeText(CUSTOM_WIDGET_PROMPT).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => { });
    };

    return (
        <div className="wgb-custom-form">
            <p className="wgb-custom-hint">
                1 — Copy the prompt and give it to any AI chat, describing your widget.<br />
                2 — Paste the HTML file it returns below.
            </p>
            <button className="wgb-pill wgb-custom-copy" onClick={copyPrompt}>
                {copied ? 'Prompt copied ✓' : '⧉ Copy AI prompt'}
            </button>
            <div className="wgb-custom-fields">
                <input
                    className="wgb-picker-search wgb-custom-name"
                    type="text"
                    placeholder="Widget name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />
                <input
                    className="wgb-picker-search wgb-custom-height"
                    type="number"
                    min="80"
                    max="480"
                    title="Tile height in px"
                    value={height}
                    onChange={e => setHeight(e.target.value)}
                />
            </div>
            <textarea
                className="wgb-custom-html"
                placeholder="<!doctype html>… paste the whole file here"
                value={html}
                onChange={e => setHtml(e.target.value)}
                spellCheck={false}
            />
            <button
                className="wgb-pill wgb-preview-add"
                disabled={!html.trim()}
                onClick={() => onCreate({ name, h: Number(height), html })}
            >
                ＋ Save & add to board
            </button>
        </div>
    );
}

const NEW_CUSTOM = '::new-custom';

function WidgetPicker({ board, theme, customs, onAdd, onRemove, onClose, onCreateCustom, onDeleteCustom }) {
    const [category, setCategory] = useState('All');
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(WIDGET_CATALOG[0].id);
    const onBoard = useMemo(() => new Set(board.map(t => t.id)), [board]);

    const list = useMemo(() => {
        const q = query.trim().toLowerCase();
        const pool = category === 'Custom' ? customs
            : category === 'All' ? [...WIDGET_CATALOG, ...customs]
                : WIDGET_CATALOG.filter(w => w.category === category);
        return pool.filter(w =>
            !q || w.name.toLowerCase().includes(q) || w.desc.toLowerCase().includes(q));
    }, [category, query, customs]);

    // Keep the preview pointed at something visible in the current list.
    const creating = selectedId === NEW_CUSTOM;
    const selected = creating ? null : (list.find(w => w.id === selectedId) || list[0] || null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const selectedAdded = selected ? onBoard.has(selected.id) : false;

    // Portal to <body>: the overlay is position:fixed, but an ancestor
    // (.overview-left-column) uses backdrop-filter, which makes it the
    // containing block for fixed descendants — without the portal the modal is
    // clipped to that column instead of covering the viewport.
    return createPortal(
        <div className="wgb-overlay" onMouseDown={onClose}>
            <div className="wgb-picker" onMouseDown={e => e.stopPropagation()}>
                <div className="wgb-picker-head">
                    <span className="wgb-picker-title">Widget store</span>
                    <input
                        className="wgb-picker-search"
                        type="text"
                        placeholder="Search widgets…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                    <a className="wgb-store-link" href={WIDGET_STORE_URL} target="_blank" rel="noopener noreferrer">
                        cool-desk.com/widgets ↗
                    </a>
                    <button className="wgb-chip wgb-picker-close" title="Close" onClick={onClose}>✕</button>
                </div>
                <div className="wgb-picker-cats">
                    {['All', ...WIDGET_CATEGORIES].map(c => (
                        <button
                            key={c}
                            className={`wgb-pill ${category === c ? 'active' : ''}`}
                            onClick={() => setCategory(c)}
                        >
                            {c}
                        </button>
                    ))}
                </div>
                <div className="wgb-picker-body">
                    <div className="wgb-picker-list">
                        {list.map(w => {
                            const added = onBoard.has(w.id);
                            const active = selected && selected.id === w.id;
                            return (
                                <div
                                    key={w.id}
                                    className={`wgb-picker-row ${active ? 'active' : ''}`}
                                    onClick={() => setSelectedId(w.id)}
                                    onMouseEnter={() => setSelectedId(w.id)}
                                >
                                    <span className="wgb-picker-name">
                                        {w.name}
                                        {w.powered && <span className="wgb-powered" title="Live data inside CoolDesk">⚡</span>}
                                    </span>
                                    <button
                                        className={`wgb-chip wgb-picker-quick ${added ? 'added' : ''}`}
                                        title={added ? 'Remove from board' : 'Add to board'}
                                        onClick={e => {
                                            e.stopPropagation();
                                            added ? onRemove(w.id) : onAdd(w.id);
                                        }}
                                    >
                                        {added ? '✓' : '＋'}
                                    </button>
                                </div>
                            );
                        })}
                        {list.length === 0 && (
                            <div className="wgb-picker-none">
                                {query.trim()
                                    ? `No widgets match “${query.trim()}”`
                                    : 'Nothing here yet.'}
                            </div>
                        )}
                    </div>
                    {creating ? (
                        <div className="wgb-picker-preview">
                            <CustomWidgetForm
                                onCreate={(spec) => {
                                    const entry = onCreateCustom(spec);
                                    if (entry) {
                                        setCategory('Custom');
                                        setSelectedId(entry.id);
                                    }
                                }}
                            />
                        </div>
                    ) : selected && (
                        <div className="wgb-picker-preview">
                            <div className="wgb-preview-stage">
                                {/* Live and interactive — try the widget before adding it. */}
                                {selected.custom ? (
                                    <CustomWidgetFrame
                                        key={selected.id}
                                        widget={selected}
                                        theme={theme}
                                        className="wgb-preview-frame"
                                        style={{ height: selected.h }}
                                    />
                                ) : (
                                    <iframe
                                        key={selected.id}
                                        className="wgb-preview-frame"
                                        src={widgetEmbedUrl(selected.id, theme)}
                                        title={`${selected.name} preview`}
                                        style={{ height: selected.h }}
                                        onLoad={bridgeOnLoad}
                                    />
                                )}
                            </div>
                            <div className="wgb-preview-meta">
                                <div className="wgb-preview-title-row">
                                    <span className="wgb-preview-name">{selected.name}</span>
                                    <span className="wgb-picker-cat">{selected.category}</span>
                                </div>
                                <p className="wgb-preview-desc">{selected.desc}</p>
                                {selected.powered && (
                                    <p className="wgb-preview-powered">⚡ Demo data here — live data from CoolDesk on your board</p>
                                )}
                                <button
                                    className={`wgb-pill wgb-preview-add ${selectedAdded ? 'added' : ''}`}
                                    onClick={() => (selectedAdded ? onRemove(selected.id) : onAdd(selected.id))}
                                >
                                    {selectedAdded ? 'On your board ✓ — remove' : '＋ Add to board'}
                                </button>
                                {selected.custom && (
                                    <button
                                        className="wgb-pill wgb-custom-delete"
                                        onClick={() => onDeleteCustom(selected.id)}
                                    >
                                        Delete this custom widget
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

// `storageArea` gives a surface (e.g. the Tabs page) its own independently
// saved board; omitted = the original overview board. `compact` renders the
// strip variant: no layout tabs, collapsible, responsive columns — for
// reserving a widget area at the top of another view.
const WidgetBoard = memo(function WidgetBoard({ storageArea, compact = false, defaultBoard = DEFAULT_BOARD }) {
    const storageKey = storageArea ? `${STORAGE_KEY}:${storageArea}` : STORAGE_KEY;
    const collapseKey = `${storageKey}:collapsed`;
    const [state, setState] = useState(() => loadLayouts(storageKey, defaultBoard, !storageArea));
    const [customs, setCustoms] = useState(loadCustomWidgets);
    const [showPicker, setShowPicker] = useState(false);
    const [showLayoutMenu, setShowLayoutMenu] = useState(false);
    const [newLayoutName, setNewLayoutName] = useState('');
    const [draggingId, setDraggingId] = useState(null);
    const [collapsed, setCollapsed] = useState(() => {
        try { return compact && localStorage.getItem(collapseKey) === '1'; } catch { return false; }
    });
    const theme = useWidgetTheme();

    const toggleCollapsed = useCallback(() => {
        setCollapsed(prev => {
            try { localStorage.setItem(collapseKey, prev ? '0' : '1'); } catch { /* ignore */ }
            return !prev;
        });
    }, [collapseKey]);

    const board = state.layouts[state.active] || [];
    const layoutNames = Object.keys(state.layouts);
    const resolveWidget = useCallback(
        (id) => getWidget(id) || customs.find(c => c.id === id) || null,
        [customs]
    );

    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
            if (!storageArea) localStorage.removeItem(STORAGE_KEY_V1);
        } catch { /* storage unavailable */ }
    }, [state, storageKey, storageArea]);

    // All tile mutations operate on the active layout inside the map.
    const setBoard = useCallback((updater) => {
        setState(prev => ({
            ...prev,
            layouts: { ...prev.layouts, [prev.active]: updater(prev.layouts[prev.active] || []) },
        }));
    }, []);

    const addWidget = useCallback((id) => {
        setBoard(prev => (prev.some(t => t.id === id) ? prev : [...prev, { id, size: 's' }]));
    }, [setBoard]);

    const removeWidget = useCallback((id) => {
        setBoard(prev => prev.filter(t => t.id !== id));
    }, [setBoard]);

    const resizeWidget = useCallback((id, size) => {
        setBoard(prev => prev.map(t => (t.id === id ? { ...t, size } : t)));
    }, [setBoard]);

    // null clears the accent back to the default plate.
    const recolorWidget = useCallback((id, color) => {
        setBoard(prev => prev.map(t => {
            if (t.id !== id) return t;
            const next = { ...t };
            if (color) next.color = color; else delete next.color;
            return next;
        }));
    }, [setBoard]);

    const switchLayout = useCallback((name) => {
        setState(prev => (prev.layouts[name] ? { ...prev, active: name } : prev));
    }, []);

    const createLayout = useCallback((name, tiles) => {
        const clean = name.trim();
        if (!clean) return;
        setState(prev => {
            if (prev.layouts[clean]) return { ...prev, active: clean };
            return { active: clean, layouts: { ...prev.layouts, [clean]: tiles } };
        });
        setShowLayoutMenu(false);
        setNewLayoutName('');
    }, []);

    const deleteLayout = useCallback((name) => {
        setState(prev => {
            const names = Object.keys(prev.layouts);
            if (names.length <= 1) return prev;
            const layouts = { ...prev.layouts };
            delete layouts[name];
            const remaining = Object.keys(layouts);
            return { active: prev.active === name ? remaining[0] : prev.active, layouts };
        });
    }, []);

    const closePicker = useCallback(() => setShowPicker(false), []);

    const createCustom = useCallback((spec) => {
        if (!spec || !spec.html || !spec.html.trim()) return null;
        const entry = saveCustomWidget(spec);
        setCustoms(loadCustomWidgets());
        setBoard(prev => [...prev, { id: entry.id, size: 's' }]);
        return entry;
    }, [setBoard]);

    const removeCustom = useCallback((id) => {
        deleteCustomWidget(id);
        setCustoms(loadCustomWidgets());
        // Pull it off every layout, not just the active one.
        setState(prev => {
            const layouts = {};
            for (const [name, tiles] of Object.entries(prev.layouts)) {
                layouts[name] = tiles.filter(t => t.id !== id);
            }
            return { ...prev, layouts };
        });
    }, []);

    const handleDragStart = useCallback((id) => setDraggingId(id), []);
    const handleDragEnd = useCallback(() => setDraggingId(null), []);

    // Live reorder: while dragging, entering another tile moves the dragged
    // tile to that tile's slot.
    const handleDragEnter = useCallback((overId) => {
        setDraggingId(current => {
            if (current && current !== overId) {
                setBoard(prev => {
                    const from = prev.findIndex(t => t.id === current);
                    const to = prev.findIndex(t => t.id === overId);
                    if (from === -1 || to === -1) return prev;
                    const next = [...prev];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    return next;
                });
            }
            return current;
        });
    }, [setBoard]);

    const unusedCategories = WIDGET_CATEGORIES.filter(c => !state.layouts[c]);

    return (
        <div className={`wgb-root ${compact ? 'wgb-root-compact' : ''}`}>
            <div className="wgb-head">
                <span className="wgb-title">Widgets</span>
                <div className="wgb-head-actions">
                    <button className="wgb-pill wgb-add-btn" onClick={() => setShowPicker(true)}>
                        ＋ Add widget
                    </button>
                    {compact && (
                        <button
                            className="wgb-pill wgb-collapse-btn"
                            title={collapsed ? 'Show widgets' : 'Hide widgets'}
                            onClick={toggleCollapsed}
                        >
                            {collapsed ? '▾' : '▴'}
                        </button>
                    )}
                </div>
            </div>

            {/* Layout tabs: each is an independently saved board (full board only). */}
            {!compact && (
            <div className="wgb-layouts">
                {layoutNames.map(name => (
                    <span key={name} className={`wgb-pill wgb-layout-pill ${state.active === name ? 'active' : ''}`}
                        onClick={() => switchLayout(name)}>
                        {name}
                        {state.active === name && layoutNames.length > 1 && (
                            <button
                                className="wgb-layout-del"
                                title={`Delete "${name}" layout`}
                                onClick={e => { e.stopPropagation(); deleteLayout(name); }}
                            >
                                ✕
                            </button>
                        )}
                    </span>
                ))}
                <button className="wgb-pill wgb-layout-new" title="New layout" onClick={() => setShowLayoutMenu(v => !v)}>
                    ＋
                </button>
                {showLayoutMenu && (
                    <>
                        <div className="wgb-layout-backdrop" onMouseDown={() => setShowLayoutMenu(false)} />
                        <div className="wgb-layout-menu">
                            {unusedCategories.length > 0 && (
                                <div className="wgb-layout-menu-label">Start from a category</div>
                            )}
                            {unusedCategories.map(c => (
                                <button key={c} className="wgb-layout-menu-item" onClick={() => createLayout(c, seedForCategory(c))}>
                                    {c}
                                </button>
                            ))}
                            <div className="wgb-layout-menu-label">Or empty</div>
                            <input
                                className="wgb-picker-search wgb-layout-name-input"
                                type="text"
                                placeholder="Layout name ⏎"
                                value={newLayoutName}
                                onChange={e => setNewLayoutName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') createLayout(newLayoutName, []); }}
                                autoFocus
                            />
                        </div>
                    </>
                )}
            </div>
            )}

            {collapsed ? null : board.length === 0 ? (
                <button className="wgb-empty" onClick={() => setShowPicker(true)}>
                    ＋ Add widgets from the store
                </button>
            ) : (
                <div className={`wgb-grid ${compact ? 'wgb-grid-strip' : ''} ${draggingId ? 'wgb-grid-dragging' : ''}`}>
                    {board.map(tile => (
                        <WidgetTile
                            key={tile.id}
                            tile={tile}
                            widget={resolveWidget(tile.id)}
                            theme={theme}
                            dragging={tile.id === draggingId}
                            onResize={resizeWidget}
                            onRemove={removeWidget}
                            onRecolor={recolorWidget}
                            onDragStart={handleDragStart}
                            onDragEnter={handleDragEnter}
                            onDragEnd={handleDragEnd}
                        />
                    ))}
                </div>
            )}

            {showPicker && (
                <WidgetPicker
                    board={board}
                    theme={theme}
                    customs={customs}
                    onAdd={addWidget}
                    onRemove={removeWidget}
                    onClose={closePicker}
                    onCreateCustom={createCustom}
                    onDeleteCustom={removeCustom}
                />
            )}
        </div>
    );
});

export { WidgetBoard };
