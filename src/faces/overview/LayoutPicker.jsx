import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VISIBLE, FEED_TABS, OVERVIEW_LAYOUTS, OVERVIEW_PARTS, OVERVIEW_VIBES, isBoardLayout, isStageLayout, vibePreview } from './overviewLayouts';

// Layout switcher for the extension's new tab. ~50 layouts in five groups, so
// one group shows at a time (tabs), in a wide grid that fits without
// scrolling; search filters across every group, and Shuffle picks a random
// one from the open tab. The panel stays open while you click through, so it
// doubles as a live preview. The footer carries whatever applies to the
// current layout: show/hide chips (column layouts), Customize (card boards).

const GROUPS = [
    { key: 'layout', label: 'Layouts' },
    { key: 'vibe', label: 'Vibes' },
    { key: 'start', label: 'Start pages' },
    { key: 'fun', label: 'Fun' },
    { key: 'design', label: 'Designs' },
];

// Every option as { key, label, hint, group, preview props }.
const ALL_OPTIONS = [
    ...OVERVIEW_LAYOUTS.map(l => ({ key: l.key, label: l.label, hint: l.hint, group: 'layout', cells: l.cells, extra: l.extra })),
    ...OVERVIEW_VIBES.map(v => ({ key: v.key, label: v.label, hint: v.hint, group: v.group || 'vibe', rects: vibePreview(v) })),
];

const groupOf = (key) => ALL_OPTIONS.find(o => o.key === key)?.group || 'layout';

// `show` dims the cells for hidden columns, so the corner button's icon
// reflects what's actually on the page. `rects`: a vibe / start page's own
// thumbnail, drawn as-is instead of two columns.
function LayoutPreview({ cells, extra, rects, show = { w: true, f: true } }) {
    if (rects) {
        return (
            <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true">
                <rect x="0.5" y="0.5" width="39" height="27" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.25" />
                {rects.map(([x, y, w, h], i) => (
                    <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" fillOpacity={i % 2 ? 0.4 : 0.65} />
                ))}
            </svg>
        );
    }
    return (
        <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true">
            <rect x="0.5" y="0.5" width="39" height="27" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.25" />
            <rect x={cells.w[0]} y={cells.w[1]} width={cells.w[2]} height={cells.w[3]} rx="2" fill="currentColor" fillOpacity={show.w ? 0.35 : 0.06} />
            <rect x={cells.f[0]} y={cells.f[1]} width={cells.f[2]} height={cells.f[3]} rx="2" fill="currentColor" fillOpacity={show.f ? 0.75 : 0.06} />
            {extra?.map(([x, y, w, h], i) => (
                <rect key={i} x={x} y={y} width={w} height={h} rx="2" fill="currentColor" fillOpacity={i % 2 ? 0.35 : 0.55} />
            ))}
        </svg>
    );
}

function Chip({ on, onClick, children, title, disabled }) {
    return (
        <button
            type="button"
            className={`lp-chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            title={title}
            disabled={disabled}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function LayoutPicker({ layout, onChange, visible = DEFAULT_VISIBLE, onVisibleChange, onCustomize }) {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState(() => groupOf(layout));
    const [query, setQuery] = useState('');
    const rootRef = useRef(null);

    // Each opening starts on the current layout's tab, search cleared.
    const toggle = () => {
        if (!open) {
            setTab(groupOf(layout));
            setQuery('');
        }
        setOpen(o => !o);
    };

    useEffect(() => {
        if (!open) return;
        const dismiss = (e) => {
            if (rootRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            // Esc clears the search first, then closes.
            if (query) setQuery('');
            else setOpen(false);
        };
        window.addEventListener('mousedown', dismiss);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', dismiss);
            window.removeEventListener('keydown', onKey);
        };
    }, [open, query]);

    const current = ALL_OPTIONS.find(o => o.key === layout) || ALL_OPTIONS[0];
    const isBoard = isBoardLayout(layout);
    const isColumns = !isBoard && !isStageLayout(layout);
    const show = { w: visible.widgets || visible.summary, f: visible.feed };
    const allHidden = OVERVIEW_PARTS.every(p => !visible[p.key]);
    const hiddenTabs = visible.hiddenFeedTabs || [];

    const q = query.trim().toLowerCase();
    const options = useMemo(() => (q
        ? ALL_OPTIONS.filter(o => o.label.toLowerCase().includes(q) || (o.hint || '').toLowerCase().includes(q))
        : ALL_OPTIONS.filter(o => o.group === tab)), [q, tab]);

    const shuffle = () => {
        const pool = (q ? options : ALL_OPTIONS.filter(o => o.group === tab)).filter(o => o.key !== layout);
        if (pool.length) onChange(pool[Math.floor(Math.random() * pool.length)].key);
    };

    const setPart = (key, on) => onVisibleChange({ ...visible, [key]: on });
    const toggleFeedTab = (key) => {
        const next = hiddenTabs.includes(key) ? hiddenTabs.filter(k => k !== key) : [...hiddenTabs, key];
        if (next.length >= FEED_TABS.length) return; // keep at least one tab
        onVisibleChange({ ...visible, hiddenFeedTabs: next });
    };
    const setAll = (on) => onVisibleChange({ ...visible, ...Object.fromEntries(OVERVIEW_PARTS.map(p => [p.key, on])) });

    return (
        <div className="overview-layout-picker" ref={rootRef}>
            <button
                className={`cooldesk-settings-btn ${open ? 'active' : ''}`}
                onClick={toggle}
                title={`Layout: ${current.label}`}
                aria-label="Change layout"
                aria-expanded={open}
            >
                {current.rects
                    ? <LayoutPreview rects={current.rects} />
                    : <LayoutPreview cells={current.cells} extra={current.extra} show={current.key === 'custom' ? undefined : show} />}
            </button>

            {open && (
                <div className="lp-panel" role="dialog" aria-label="Choose a layout">
                    <div className="lp-head">
                        <div className="lp-tabs" role="tablist">
                            {GROUPS.map(g => (
                                <button
                                    key={g.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={!q && tab === g.key}
                                    className={`lp-tab ${!q && tab === g.key ? 'on' : ''} ${groupOf(layout) === g.key ? 'has-current' : ''}`}
                                    onClick={() => { setTab(g.key); setQuery(''); }}
                                >
                                    {g.label}
                                    <span className="lp-count">{ALL_OPTIONS.filter(o => o.group === g.key).length}</span>
                                </button>
                            ))}
                        </div>
                        <div className="lp-tools">
                            <label className="lp-search">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="Search layouts"
                                    aria-label="Search layouts"
                                    spellCheck={false}
                                />
                            </label>
                            <button type="button" className="lp-shuffle" onClick={shuffle} title="Random layout from this tab" aria-label="Random layout">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div className="lp-grid" role="radiogroup" aria-label="Layouts">
                        {options.map(o => (
                            <button
                                key={o.key}
                                type="button"
                                role="radio"
                                aria-checked={o.key === layout}
                                className={`lp-option ${o.key === layout ? 'on' : ''}`}
                                title={o.hint}
                                onClick={() => onChange(o.key)}
                            >
                                <LayoutPreview cells={o.cells} extra={o.extra} rects={o.rects} show={o.key === 'custom' || o.rects ? undefined : show} />
                                <span className="lp-label">{o.label}</span>
                                {q && <span className="lp-group">{GROUPS.find(g => g.key === o.group)?.label}</span>}
                            </button>
                        ))}
                        {options.length === 0 && <div className="lp-empty">No layouts match “{query}”.</div>}
                    </div>

                    <div className="lp-foot">
                        <div className="lp-current">
                            <span className="lp-current-name">{current.label}</span>
                            {current.hint && <span className="lp-current-hint">{current.hint}</span>}
                        </div>

                        {isBoard && onCustomize && (
                            <button
                                type="button"
                                className="lp-action"
                                onClick={() => {
                                    onCustomize();
                                    setOpen(false);
                                }}
                            >
                                Customize cards
                            </button>
                        )}

                        {isColumns && onVisibleChange && (
                            <div className="lp-show">
                                <div className="lp-row">
                                    <span className="lp-row-label">Show</span>
                                    {OVERVIEW_PARTS.map(p => (
                                        <Chip key={p.key} on={visible[p.key]} onClick={() => setPart(p.key, !visible[p.key])}>{p.label}</Chip>
                                    ))}
                                    {visible.feed && (
                                        <Chip on={visible.favorites !== false} onClick={() => setPart('favorites', visible.favorites === false)}>Favorites</Chip>
                                    )}
                                    <Chip on={allHidden} onClick={() => setAll(allHidden)} title="Hide everything but the wallpaper">
                                        {allHidden ? 'Show all' : 'Wallpaper only'}
                                    </Chip>
                                </div>
                                {visible.feed && (
                                    <div className="lp-row">
                                        <span className="lp-row-label">Feed tabs</span>
                                        {FEED_TABS.map(t => {
                                            const on = !hiddenTabs.includes(t.key);
                                            return (
                                                <Chip
                                                    key={t.key}
                                                    on={on}
                                                    title={on ? `Hide ${t.label} tab` : `Show ${t.label} tab`}
                                                    disabled={on && hiddenTabs.length === FEED_TABS.length - 1}
                                                    onClick={() => toggleFeedTab(t.key)}
                                                >
                                                    {t.label}
                                                </Chip>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
