import { useEffect, useMemo, useRef, useState } from 'react';
import { FEED_TABS, OVERVIEW_PARTS, isBoardLayout, isStageLayout } from './overviewLayouts';
import { LayoutBrowser, LayoutPreview } from './LayoutPicker';
import { layoutOption } from './layoutOptions';
import { useQuickSettings } from './useQuickSettings';
import { FEATURED_WALLPAPERS, moreWallpapers } from '../../shared/data/wallpapers';
import { THEME_PRESETS, applyTheme, currentTheme } from '../../shared/data/themePresets';
import { fontFamilies, fontSizes, getCurrentFontFamily, setAndSaveFontFamily } from '../../utils/fontUtils';
import ExportData from '../../shared/components/ExportData';

// Everything about the new tab, in one panel behind the bottom-right
// Customize button — three tabs, no other windows:
//   Layout    pick a layout (the full browser: groups, search, shuffle) and
//             what's shown on it
//   Look      wallpaper or gradient, brightness, rotation, font, text size
//   Settings  the extension's few real settings: tab grouping, session
//             tracking, desktop sync, export/import, updates
// Everything applies instantly. The desktop app keeps its own Settings window
// (it has many more settings); this panel is the extension's only one.

const TABS = [
    { key: 'layout', label: 'Layout' },
    { key: 'look', label: 'Look' },
    { key: 'settings', label: 'Settings' },
];
const TAB_KEY = 'cooldesk-customize-tab';

const ALL_WALLPAPERS = [...FEATURED_WALLPAPERS, ...moreWallpapers()];

function Check({ checked, onChange, children, disabled }) {
    return (
        <label className={`cz-check ${disabled ? 'is-disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
            <span className="cz-box" aria-hidden="true" />
            <span className="cz-text">{children}</span>
        </label>
    );
}

function Switch({ checked, onChange, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            className={`cz-switch ${checked ? 'on' : ''}`}
            onClick={() => onChange(!checked)}
        />
    );
}

function Row({ title, hint, children }) {
    return (
        <div className="cz-row">
            <div className="cz-row-text">
                <div className="cz-row-title">{title}</div>
                {hint && <div className="cz-row-hint">{hint}</div>}
            </div>
            {children}
        </div>
    );
}

// Thumbnail strips scroll sideways; let a plain vertical wheel do that too.
const wheelSideways = (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
};

function LayoutTab({ layout, onLayoutChange, visible, onVisibleChange, onCustomizeCards, closePanel }) {
    const current = layoutOption(layout);
    const isBoard = isBoardLayout(layout);
    const isColumns = !isBoard && !isStageLayout(layout);
    const hiddenTabs = visible.hiddenFeedTabs || [];
    const setPart = (key, on) => onVisibleChange({ ...visible, [key]: on });
    const setFeedTab = (key, on) => {
        const next = on ? hiddenTabs.filter(k => k !== key) : [...hiddenTabs, key];
        if (next.length >= FEED_TABS.length) return; // keep at least one tab
        onVisibleChange({ ...visible, hiddenFeedTabs: next });
    };

    return (
        <>
            <LayoutBrowser layout={layout} onChange={onLayoutChange} visible={visible} />
            <div className="cz-current">
                <span className="cz-current-name">{current.label}</span>
                <span className="cz-current-hint">{current.hint}</span>
            </div>
            {isBoard && onCustomizeCards && (
                <button type="button" className="cz-btn cz-wide" onClick={() => { closePanel(); onCustomizeCards(); }}>
                    Customize cards — move, resize, add
                </button>
            )}
            {isColumns && (
                <div className="cz-show">
                    <div className="cz-heading">Show</div>
                    <div className="cz-checks">
                        {OVERVIEW_PARTS.map(p => (
                            <Check key={p.key} checked={!!visible[p.key]} onChange={on => setPart(p.key, on)}>{p.label}</Check>
                        ))}
                        <Check checked={visible.favorites !== false} disabled={!visible.feed} onChange={on => setPart('favorites', on)}>Favorites</Check>
                    </div>
                    {visible.feed && (
                        <div className="cz-chips" role="group" aria-label="Feed tabs">
                            {FEED_TABS.map(t => {
                                const on = !hiddenTabs.includes(t.key);
                                return (
                                    <button
                                        key={t.key}
                                        type="button"
                                        className={`cz-chip ${on ? 'on' : ''}`}
                                        aria-pressed={on}
                                        disabled={on && hiddenTabs.length === FEED_TABS.length - 1}
                                        onClick={() => setFeedTab(t.key, !on)}
                                    >
                                        {t.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

function LookTab({ wallpaper, onWallpaperChange, fontSize, onFontSizeChange }) {
    const [theme, setTheme] = useState(currentTheme);
    const [font, setFont] = useState(getCurrentFontFamily);
    const [urlOpen, setUrlOpen] = useState(false);
    const [url, setUrl] = useState('');
    const urlOk = /^https?:\/\/\S+$/i.test(url.trim());

    useEffect(() => {
        const sync = () => setTheme(currentTheme());
        window.addEventListener('cooldesk-theme-changed', sync);
        return () => window.removeEventListener('cooldesk-theme-changed', sync);
    }, []);

    const fontGroups = useMemo(() => {
        const by = {};
        fontFamilies.forEach(f => { (by[f.category] ||= []).push(f); });
        return Object.entries(by);
    }, []);

    const pickWallpaper = (wallUrl) => onWallpaperChange({ enabled: true, url: wallUrl });
    const pickTheme = (id) => {
        applyTheme(id);
        setTheme(id);
        onWallpaperChange({ enabled: false });
    };
    const submitUrl = (e) => {
        e.preventDefault();
        if (!urlOk) return;
        pickWallpaper(url.trim());
        setUrl('');
        setUrlOpen(false);
    };

    return (
        <>
            <div className="cz-heading">Wallpaper</div>
            <div className="cz-strip" role="listbox" aria-label="Wallpapers" onWheel={wheelSideways}>
                <button
                    type="button"
                    className={`cz-tile cz-add ${urlOpen ? 'on' : ''}`}
                    onClick={() => setUrlOpen(o => !o)}
                    title="Use an image from a URL"
                    aria-label="Use an image from a URL"
                >
                    +
                </button>
                {ALL_WALLPAPERS.map(w => (
                    <button
                        key={w.id}
                        type="button"
                        role="option"
                        aria-selected={wallpaper.enabled && wallpaper.url === w.url}
                        className={`cz-tile ${wallpaper.enabled && wallpaper.url === w.url ? 'on' : ''}`}
                        style={{ backgroundImage: `url("${w.thumbnail}")` }}
                        title={w.name}
                        onClick={() => pickWallpaper(w.url)}
                    />
                ))}
            </div>
            {urlOpen && (
                <form className="cz-url" onSubmit={submitUrl}>
                    <input
                        autoFocus
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="Paste an image URL (https://…)"
                        aria-label="Image URL"
                        spellCheck={false}
                    />
                    <button type="submit" className="cz-btn" disabled={!urlOk}>Use</button>
                </form>
            )}

            <div className="cz-heading">Gradient</div>
            <div className="cz-strip" role="listbox" aria-label="Gradient themes" onWheel={wheelSideways}>
                {THEME_PRESETS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={!wallpaper.enabled && theme === t.id}
                        className={`cz-tile cz-swatch ${!wallpaper.enabled && theme === t.id ? 'on' : ''}`}
                        style={{ background: t.preview }}
                        title={t.name}
                        onClick={() => pickTheme(t.id)}
                    />
                ))}
            </div>

            {wallpaper.enabled && (
                <>
                    <label className="cz-range">
                        <span className="cz-range-label">Brightness</span>
                        <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={wallpaper.opacity}
                            onChange={e => onWallpaperChange({ opacity: parseFloat(e.target.value) })}
                        />
                        <span className="cz-range-value">{Math.round(wallpaper.opacity * 100)}%</span>
                    </label>
                    <Check checked={wallpaper.autoRotate} onChange={on => onWallpaperChange({ autoRotate: on })}>
                        New wallpaper with each tab
                    </Check>
                </>
            )}

            <div className="cz-heading">Text</div>
            <div className="cz-text-row">
                <select
                    className="cz-select"
                    value={font}
                    onChange={e => { setFont(e.target.value); setAndSaveFontFamily(e.target.value); }}
                    aria-label="Font"
                >
                    {fontGroups.map(([cat, list]) => (
                        <optgroup key={cat} label={cat}>
                            {list.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </optgroup>
                    ))}
                </select>
                <div className="cz-seg" role="radiogroup" aria-label="Text size">
                    {fontSizes.map(s => (
                        <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={fontSize === s.id}
                            className={fontSize === s.id ? 'on' : ''}
                            title={s.name}
                            style={{ fontSize: s.size }}
                            onClick={() => onFontSizeChange(s.id)}
                        >
                            A
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}

function SettingsTab({ onStartTour, closePanel }) {
    const s = useQuickSettings();
    const syncHint = !s.hostSync
        ? 'Off'
        : s.hostAvailable === null ? 'Checking…'
            : s.hostAvailable ? 'Connected to the desktop app' : 'Desktop app not found';
    return (
        <>
            <Row title="Auto-group tabs" hint="Group new tabs by site">
                <Switch checked={s.autoGroup} onChange={s.setAutoGroup} label="Auto-group tabs" />
            </Row>
            <Row title="Session tracking" hint="Remember what you worked on, for Resume">
                <Switch checked={s.sessionTracking} onChange={s.setSessionTracking} label="Session tracking" />
            </Row>
            <Row
                title="Desktop sync"
                hint={(
                    <>
                        <i className={`cz-dot ${!s.hostSync ? '' : s.hostAvailable ? 'ok' : s.hostAvailable === false ? 'bad' : 'wait'}`} />
                        {syncHint}
                        {s.hostSync && s.hostAvailable === false && (
                            <button type="button" className="cz-link" onClick={s.retryHost}>Retry</button>
                        )}
                    </>
                )}
            >
                <Switch checked={s.hostSync} onChange={s.setHostSync} label="Desktop sync" />
            </Row>
            <Row
                title={`Version ${s.version || ''}`}
                hint={s.update ? `v${s.update.latest} is available` : 'Auto-update when no CoolDesk tab is open'}
            >
                {s.update
                    ? <button type="button" className="cz-btn cz-accent" onClick={s.installUpdate}>Install</button>
                    : <Switch checked={s.autoUpdate} onChange={s.setAutoUpdate} label="Auto-update" />}
            </Row>
            <div className="cz-data">
                <ExportData compact />
            </div>
            {onStartTour && (
                <button type="button" className="cz-link cz-tour" onClick={() => { closePanel(); onStartTour(); }}>
                    Replay the welcome tour
                </button>
            )}
        </>
    );
}

export function CustomizeMenu({
    layout,
    onLayoutChange,
    visible,
    onVisibleChange,
    onCustomizeCards,
    onStartTour,
    wallpaper,
    onWallpaperChange,
    fontSize,
    onFontSizeChange,
}) {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState(() => {
        try { return TABS.some(t => t.key === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'layout'; } catch { return 'layout'; }
    });
    const rootRef = useRef(null);

    const pickTab = (key) => {
        setTab(key);
        try { localStorage.setItem(TAB_KEY, key); } catch { /* won't persist */ }
    };

    useEffect(() => {
        if (!open) return;
        const dismiss = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', dismiss);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', dismiss);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const current = layoutOption(layout);
    const show = { w: visible.widgets || visible.summary, f: visible.feed };
    const close = () => setOpen(false);

    return (
        <div className="cz" ref={rootRef}>
            {open && (
                <div className="cz-panel" role="dialog" aria-label="Customize this page">
                    <div className="cz-tabs" role="tablist">
                        {TABS.map(t => (
                            <button
                                key={t.key}
                                type="button"
                                role="tab"
                                aria-selected={tab === t.key}
                                className={`cz-tab ${tab === t.key ? 'on' : ''}`}
                                onClick={() => pickTab(t.key)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div className="cz-body">
                        {tab === 'layout' && (
                            <LayoutTab
                                layout={layout}
                                onLayoutChange={onLayoutChange}
                                visible={visible}
                                onVisibleChange={onVisibleChange}
                                onCustomizeCards={onCustomizeCards}
                                closePanel={close}
                            />
                        )}
                        {tab === 'look' && (
                            <LookTab
                                wallpaper={wallpaper}
                                onWallpaperChange={onWallpaperChange}
                                fontSize={fontSize}
                                onFontSizeChange={onFontSizeChange}
                            />
                        )}
                        {tab === 'settings' && <SettingsTab onStartTour={onStartTour} closePanel={close} />}
                    </div>
                </div>
            )}

            <button
                type="button"
                className={`cz-trigger ${open ? 'on' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-label="Customize this page"
                title={`Layout: ${current.label}`}
            >
                <span className="cz-trigger-thumb">
                    <LayoutPreview cells={current.cells} extra={current.extra} rects={current.rects} show={current.rects || current.key === 'custom' ? undefined : show} />
                </span>
                <span>Customize</span>
            </button>
        </div>
    );
}
