import { useEffect, useRef, useState } from 'react';
import { DEFAULT_VISIBLE, FEED_TABS, OVERVIEW_LAYOUTS, OVERVIEW_PARTS } from './overviewLayouts';

// `show` dims the cells for hidden columns, so the corner button's icon
// reflects what's actually on the page.
function LayoutPreview({ cells, show = { w: true, f: true } }) {
    return (
        <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden="true">
            <rect x="0.5" y="0.5" width="39" height="27" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.25" />
            <rect x={cells.w[0]} y={cells.w[1]} width={cells.w[2]} height={cells.w[3]} rx="2" fill="currentColor" fillOpacity={show.w ? 0.35 : 0.06} />
            <rect x={cells.f[0]} y={cells.f[1]} width={cells.f[2]} height={cells.f[3]} rx="2" fill="currentColor" fillOpacity={show.f ? 0.75 : 0.06} />
        </svg>
    );
}

export function LayoutPicker({ layout, onChange, visible = DEFAULT_VISIBLE, onVisibleChange }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const dismiss = (e) => {
            if (rootRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', dismiss);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', dismiss);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const current = OVERVIEW_LAYOUTS.find(l => l.key === layout) || OVERVIEW_LAYOUTS[0];
    const show = { w: visible.widgets || visible.summary, f: visible.feed };
    const allHidden = OVERVIEW_PARTS.every(p => !visible[p.key]);
    const hiddenTabs = visible.hiddenFeedTabs || [];
    const toggleFeedTab = (key) => {
        const next = hiddenTabs.includes(key) ? hiddenTabs.filter(k => k !== key) : [...hiddenTabs, key];
        if (next.length >= FEED_TABS.length) return; // keep at least one tab
        onVisibleChange({ ...visible, hiddenFeedTabs: next });
    };

    return (
        <div className="overview-layout-picker" ref={rootRef}>
            <button
                className={`cooldesk-settings-btn ${open ? 'active' : ''}`}
                onClick={() => setOpen(o => !o)}
                title={`Layout: ${current.label}`}
                aria-label="Change layout"
                aria-expanded={open}
            >
                <LayoutPreview cells={current.cells} show={show} />
            </button>
            {open && (
                <div className="overview-layout-menu" role="menu">
                    <div className="context-menu-label">Layout</div>
                    <div className="overview-layout-options">
                        {OVERVIEW_LAYOUTS.map(l => (
                            <button
                                key={l.key}
                                role="menuitemradio"
                                aria-checked={l.key === layout}
                                className={`overview-layout-option ${l.key === layout ? 'active' : ''}`}
                                title={l.hint}
                                onClick={() => onChange(l.key)}
                            >
                                <LayoutPreview cells={l.cells} show={show} />
                                <span>{l.label}</span>
                            </button>
                        ))}
                    </div>

                    {onVisibleChange && (
                        <>
                            <div className="context-menu-divider" />
                            <div className="context-menu-label">Show</div>
                            <div className="overview-layout-toggles">
                                {OVERVIEW_PARTS.map(p => (
                                    <label key={p.key} className="overview-layout-toggle">
                                        <span>{p.label}</span>
                                        <input
                                            type="checkbox"
                                            checked={visible[p.key]}
                                            onChange={e => onVisibleChange({ ...visible, [p.key]: e.target.checked })}
                                        />
                                        <span className="overview-layout-switch" aria-hidden="true" />
                                    </label>
                                ))}
                            </div>
                            {visible.feed && (
                                <>
                                    <div className="context-menu-divider" />
                                    <div className="context-menu-label">Feed</div>
                                    <div className="overview-layout-toggles">
                                        <label className="overview-layout-toggle">
                                            <span>Favorites</span>
                                            <input
                                                type="checkbox"
                                                checked={visible.favorites !== false}
                                                onChange={e => onVisibleChange({ ...visible, favorites: e.target.checked })}
                                            />
                                            <span className="overview-layout-switch" aria-hidden="true" />
                                        </label>
                                    </div>
                                    <div className="overview-layout-pills">
                                        {FEED_TABS.map(t => {
                                            const on = !hiddenTabs.includes(t.key);
                                            return (
                                                <button
                                                    key={t.key}
                                                    className={`overview-layout-pill ${on ? 'active' : ''}`}
                                                    aria-pressed={on}
                                                    title={on ? `Hide ${t.label} tab` : `Show ${t.label} tab`}
                                                    disabled={on && hiddenTabs.length === FEED_TABS.length - 1}
                                                    onClick={() => toggleFeedTab(t.key)}
                                                >
                                                    {t.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                            <button
                                className={`overview-layout-zen ${allHidden ? 'active' : ''}`}
                                onClick={() => onVisibleChange(allHidden
                                    ? { ...visible, ...Object.fromEntries(OVERVIEW_PARTS.map(p => [p.key, true])) }
                                    : { ...visible, ...Object.fromEntries(OVERVIEW_PARTS.map(p => [p.key, false])) })}
                            >
                                {allHidden ? 'Show everything' : 'Zen — wallpaper only'}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
