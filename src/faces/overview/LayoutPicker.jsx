import { useMemo, useState } from 'react';
import { DEFAULT_VISIBLE } from './overviewLayouts';
import { ALL_OPTIONS, GROUPS, groupOf } from './layoutOptions';

// The layout chooser, as it sits inside the Customize panel's Layout tab:
// group chips (one group at a time), a search that spans every group, Shuffle,
// and a compact grid that scrolls within the tab. Picking applies instantly and
// keeps the panel open, so clicking through is a live preview.

// `show` dims the cells for hidden columns, so a column layout's thumbnail
// reflects what's actually on the page. `rects`: a vibe / start page's own
// thumbnail, drawn as-is instead of two columns.
export function LayoutPreview({ cells, extra, rects, show = { w: true, f: true } }) {
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

export function LayoutBrowser({ layout, onChange, visible = DEFAULT_VISIBLE }) {
    const [tab, setTab] = useState(() => groupOf(layout));
    const [query, setQuery] = useState('');
    const show = { w: visible.widgets || visible.summary, f: visible.feed };

    const q = query.trim().toLowerCase();
    const options = useMemo(() => (q
        ? ALL_OPTIONS.filter(o => o.label.toLowerCase().includes(q) || (o.hint || '').toLowerCase().includes(q))
        : ALL_OPTIONS.filter(o => o.group === tab)), [q, tab]);

    const shuffle = () => {
        const pool = options.filter(o => o.key !== layout);
        if (pool.length) onChange(pool[Math.floor(Math.random() * pool.length)].key);
    };

    return (
        <div className="lb">
            <div className="lb-groups" role="tablist">
                {GROUPS.map(g => (
                    <button
                        key={g.key}
                        type="button"
                        role="tab"
                        aria-selected={!q && tab === g.key}
                        className={`lb-group ${!q && tab === g.key ? 'on' : ''} ${groupOf(layout) === g.key ? 'has-current' : ''}`}
                        onClick={() => { setTab(g.key); setQuery(''); }}
                    >
                        {g.label}
                    </button>
                ))}
            </div>
            <div className="lb-tools">
                <label className="lb-search">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
                        placeholder={`Search all ${ALL_OPTIONS.length} layouts`}
                        aria-label="Search layouts"
                        spellCheck={false}
                    />
                </label>
                <button type="button" className="lb-shuffle" onClick={shuffle} title="Random layout" aria-label="Random layout">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
                </button>
            </div>
            <div className="lb-grid" role="radiogroup" aria-label="Layouts">
                {options.map(o => (
                    <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={o.key === layout}
                        className={`lb-option ${o.key === layout ? 'on' : ''}`}
                        title={o.hint}
                        onClick={() => onChange(o.key)}
                    >
                        <LayoutPreview cells={o.cells} extra={o.extra} rects={o.rects} show={o.key === 'custom' || o.rects ? undefined : show} />
                        <span className="lb-label">{o.label}</span>
                    </button>
                ))}
                {options.length === 0 && <div className="lb-empty">No layouts match “{query}”.</div>}
            </div>
        </div>
    );
}
