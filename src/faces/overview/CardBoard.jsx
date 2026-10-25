import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityFeed } from './parts/ActivityFeed';
import { ActivityOverview } from '../../features/activity/ActivityOverview';
import { WidgetBoard, WidgetEmbed } from '../../features/widgets/WidgetBoard';
import { WIDGET_CATALOG } from '../../data/widgetCatalog';
import { loadCustomWidgets } from '../../data/customWidgets';
import { CARD_MAX, CARD_TYPES, cardLabel, firstFreeCell, makeCard, resolveLayout, useOverviewCards, widgetRows } from './overviewLayouts';

// Custom layout: the page as a free grid of cards (macOS-desktop-widget
// style). Each card is one existing piece of the page, spanning 1–6 cells each
// way, and sits on its own cell: drop it anywhere (empty space is fine) and it
// stays; cards it lands on are pushed down (resolveLayout). Cells are small
// squares sized to the screen (macOS proportions: small 2×2, medium 4×2,
// large 4×4); as many columns fit as the width allows, and the board centers.
const NO_TABS = ['all', 'tabs', 'local', 'suites', 'search', 'media'];

const GAP = 16;

// Cell size tracks the board width (≈ 1/10.5 of it, 124–168px). It may also
// shrink a little so `rows` rows fit the available height — but only ~10%
// and never under 124px: a board taller than that scrolls the page rather
// than shrinking every card (that made 1×1 cards tiny on tall boards).
// Columns are however many cells fit, 2..12.
function gridFor(width, height = Infinity, rows = 6) {
    const byWidth = Math.min(168, Math.max(124, width / 10.5));
    const byHeight = (height - (rows - 1) * GAP) / rows;
    const cell = Math.round(Math.max(124, byWidth * 0.9, Math.min(byWidth, byHeight)));
    const cols = Math.max(2, Math.min(12, Math.floor((width + GAP) / (cell + GAP))));
    return { cell, cols };
}

// pinnedTabs: sections that already have their own card. The all-tabs feed
// card drops those from its tab bar so nothing shows twice.
function CardContent({ card, pinnedTabs }) {
    switch (card.type) {
        case 'widgets':
            return <WidgetBoard />;
        case 'widget':
            return <WidgetEmbed widgetId={card.widgetId} />;
        case 'summary':
            return <ActivityOverview embedded />;
        case 'favorites':
            return <ActivityFeed showList={false} />;
        case 'feed':
            return (
                <ActivityFeed
                    showFavorites={false}
                    hiddenTabs={card.tab ? NO_TABS.filter(t => t !== card.tab) : pinnedTabs}
                />
            );
        default:
            return null;
    }
}

// 4×4 cell picker: hover to preview a size, click to apply.
function SizePicker({ anchor, w, h, onPick, onClose }) {
    const [hover, setHover] = useState(null);
    const ref = useRef(null);
    useEffect(() => {
        const dismiss = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('mousedown', dismiss);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', dismiss);
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);
    const shown = hover || { w, h };
    return createPortal(
        <div ref={ref} className="ocb-size-picker" style={{ top: anchor.top, left: anchor.left }}>
            <div className="ocb-size-grid" onMouseLeave={() => setHover(null)}>
                {Array.from({ length: CARD_MAX * CARD_MAX }, (_, i) => {
                    const cw = (i % CARD_MAX) + 1;
                    const ch = Math.floor(i / CARD_MAX) + 1;
                    const on = cw <= shown.w && ch <= shown.h;
                    return (
                        <button
                            key={i}
                            type="button"
                            className={`ocb-size-cell ${on ? 'on' : ''}`}
                            aria-label={`${cw} by ${ch}`}
                            onMouseEnter={() => setHover({ w: cw, h: ch })}
                            onClick={() => onPick(cw, ch)}
                        />
                    );
                })}
            </div>
            <div className="ocb-size-label">{shown.w} × {shown.h}</div>
        </div>,
        document.body
    );
}

// Two parts: the page's own pieces, then every widget (store + your custom
// ones) as its own card, searchable.
function AddMenu({ cards, onAdd }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const dismiss = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        window.addEventListener('mousedown', dismiss);
        return () => window.removeEventListener('mousedown', dismiss);
    }, [open]);
    const widgets = useMemo(() => {
        if (!open) return [];
        const q = query.trim().toLowerCase();
        return [...WIDGET_CATALOG, ...loadCustomWidgets()]
            .filter(w => !q || w.name.toLowerCase().includes(q) || (w.category || '').toLowerCase().includes(q));
    }, [open, query]);
    const pick = (t) => {
        onAdd(t);
        setOpen(false);
        setQuery('');
    };
    return (
        <div className="ocb-add" ref={ref}>
            <button type="button" className="ocb-bar-btn" onClick={() => setOpen(o => !o)}>+ Add card</button>
            {open && (
                <div className="ocb-add-menu">
                    <div className="ocb-add-label">Page</div>
                    {CARD_TYPES.map(t => {
                        const taken = t.single && cards.some(c => c.type === t.type);
                        return (
                            <button
                                key={`${t.type}-${t.tab || ''}`}
                                type="button"
                                className="ocb-add-item"
                                disabled={taken}
                                title={taken ? 'Already on the board' : undefined}
                                onClick={() => pick(t)}
                            >
                                {t.tab ? `Feed · ${t.label}` : t.label}
                            </button>
                        );
                    })}
                    <div className="ocb-add-label">Widgets</div>
                    <input
                        className="ocb-add-search"
                        placeholder="Search widgets…"
                        value={query}
                        autoFocus
                        onChange={e => setQuery(e.target.value)}
                    />
                    <div className="ocb-add-widgets">
                        {widgets.map(w => (
                            <button
                                key={w.id}
                                type="button"
                                className="ocb-add-item"
                                onClick={() => pick({ type: 'widget', widgetId: w.id })}
                            >
                                {w.name}
                                <span className="ocb-add-meta">{w.category}</span>
                            </button>
                        ))}
                        {widgets.length === 0 && <div className="ocb-add-none">No widgets match</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

const CardBoard = memo(function CardBoard({ editing = false, onDone }) {
    const [cards, setCards, resetCards] = useOverviewCards();
    const [{ cell, cols }, setGrid] = useState(() => gridFor(window.innerWidth * 0.9, window.innerHeight - 110));
    // Rows the stored board spans — what the cell size must fit vertically.
    const storedRows = useMemo(() => cards.reduce((m, c) => Math.max(m, c.y + c.h), 1), [cards]);
    // drag: { id, grabX, grabY, colW, rowH, gap, dx, dy, target: {x, y} }
    const [drag, setDrag] = useState(null);
    const [sizing, setSizing] = useState(null); // { id, top, left }
    const gridRef = useRef(null);
    const boardRef = useRef(null);

    // Measure the board's available width (not the grid's — the grid is sized
    // from the result and centered inside it).
    // Height available = window minus the board's own top/bottom margins (the
    // frame space under the corner buttons). Re-measured on width changes
    // (ResizeObserver) and window resizes (height-only changes).
    useLayoutEffect(() => {
        const el = boardRef.current;
        if (!el) return;
        const measure = () => {
            const cs = getComputedStyle(el);
            const height = window.innerHeight - parseFloat(cs.marginTop) - parseFloat(cs.marginBottom) - 2;
            const next = gridFor(el.clientWidth, height, storedRows);
            setGrid(prev => (prev.cell === next.cell && prev.cols === next.cols ? prev : next));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        window.addEventListener('resize', measure);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [storedRows]);

    // Esc finishes editing (unless the size picker is open — Esc closes that).
    useEffect(() => {
        if (!editing) return;
        const onKey = (e) => {
            if (e.key === 'Escape' && !sizing && !drag) onDone?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editing, sizing, drag, onDone]);

    // Stored cells, re-flowed for the current column count. While dragging,
    // the preview places the dragged card at its target first so the others
    // visibly make room before you let go.
    const layout = useMemo(() => {
        if (!drag) return resolveLayout(cards, cols);
        return resolveLayout(cards.map(c => (c.id === drag.id ? { ...c, ...drag.target } : c)), cols, drag.id);
    }, [cards, cols, drag]);

    // Commit a layout: store every card's resolved cell.
    const commit = (nextCards, priorityId) => {
        const placed = resolveLayout(nextCards, cols, priorityId);
        setCards(nextCards.map(c => ({ ...c, x: placed[c.id].x, y: placed[c.id].y })));
    };

    const resize = (id, w, h) => commit(cards.map(c => (c.id === id ? { ...c, w, h } : c)), id);
    const remove = (id) => setCards(prev => prev.filter(c => c.id !== id));
    const add = (t) => {
        // macOS-ish starting sizes: widgets small (2×2, tall ones 2×3), the
        // Favorites strip 4×1, everything else a 4×4 large card (summary 2×3).
        const w = t.type === 'widget' || t.type === 'summary' ? 2 : 4;
        const h = t.type === 'widget' ? widgetRows(t.widgetId)
            : t.type === 'favorites' ? 1
                : t.type === 'summary' ? 3 : 4;
        const cell = firstFreeCell(Object.values(layout), w, h, cols);
        setCards(prev => [...prev, makeCard({ type: t.type, tab: t.tab, widgetId: t.widgetId, w, h, x: cell.x, y: cell.y })]);
    };

    // Pointer drag (edit mode). The card follows the pointer; the target cell
    // is wherever its top-left corner is nearest to.
    const onPointerDown = (e, card) => {
        if (!editing || e.button !== 0 || e.target.closest('button')) return;
        const r = e.currentTarget.getBoundingClientRect();
        const cell = layout[card.id];
        const gap = parseFloat(getComputedStyle(gridRef.current).rowGap) || 0;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({
            id: card.id,
            startX: e.clientX,
            startY: e.clientY,
            grabX: e.clientX - r.left,
            grabY: e.clientY - r.top,
            colW: (r.width - (cell.w - 1) * gap) / cell.w,
            rowH: (r.height - (cell.h - 1) * gap) / cell.h,
            gap,
            dx: 0,
            dy: 0,
            // The dragged card stays anchored on the cell it started from and
            // follows the pointer via transform; the ghost shows the target.
            origin: { x: cell.x, y: cell.y },
            target: { x: cell.x, y: cell.y },
        });
    };

    const onPointerMove = (e) => {
        if (!drag) return;
        const g = gridRef.current.getBoundingClientRect();
        const cell = layout[drag.id];
        const left = e.clientX - drag.grabX - g.left;
        const top = e.clientY - drag.grabY - g.top;
        const x = Math.min(Math.max(0, Math.round(left / (drag.colW + drag.gap))), cols - cell.w);
        const y = Math.max(0, Math.round(top / (drag.rowH + drag.gap)));
        setDrag(d => ({
            ...d,
            dx: e.clientX - d.startX,
            dy: e.clientY - d.startY,
            target: d.target.x === x && d.target.y === y ? d.target : { x, y },
        }));
    };

    const onPointerUp = () => {
        if (!drag) return;
        commit(cards.map(c => (c.id === drag.id ? { ...c, ...drag.target } : c)), drag.id);
        setDrag(null);
    };

    const sizingCard = sizing && cards.find(c => c.id === sizing.id);
    const pinnedTabs = useMemo(
        () => [...new Set(cards.filter(c => c.type === 'feed' && c.tab).map(c => c.tab))],
        [cards]
    );
    // Room below the lowest card while editing, so cards can be dropped lower.
    const bottom = Object.values(layout).reduce((m, p) => Math.max(m, p.y + p.h), 0);
    // Outside edit mode the grid is only as wide as the cards reach, so the
    // board centers on what's there instead of trailing empty columns.
    const usedCols = Object.values(layout).reduce((m, p) => Math.max(m, p.x + p.w), 0);
    const shownCols = editing ? cols : Math.max(1, Math.min(cols, usedCols || cols));
    const draggedCell = drag && layout[drag.id];

    return (
        <div ref={boardRef} className={`ocb ${editing ? 'is-editing' : ''}`}>
            <div ref={gridRef} className="ocb-grid" style={{ '--ocb-cols': shownCols, '--ocb-cell': `${cell}px`, '--ocb-gap': `${GAP}px` }}>
                {cards.map(card => {
                    const isDragged = drag?.id === card.id;
                    const cell = layout[card.id];
                    const at = isDragged ? { ...cell, ...drag.origin } : cell;
                    return (
                    <div
                        key={card.id}
                        className={`ocb-card ocb-card-${card.type} ${isDragged ? 'is-dragging' : ''}`}
                        data-w={cell.w}
                        style={{
                            gridColumn: `${at.x + 1} / span ${cell.w}`,
                            gridRow: `${at.y + 1} / span ${cell.h}`,
                            ...(isDragged ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}),
                        }}
                        onPointerDown={e => onPointerDown(e, card)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                    >
                        <div className="ocb-card-body">
                            <CardContent card={card} pinnedTabs={pinnedTabs} />
                        </div>
                        {editing && (
                            <div className="ocb-card-edit">
                                <button
                                    type="button"
                                    className="ocb-remove"
                                    title="Remove card"
                                    aria-label={`Remove ${cardLabel(card)}`}
                                    onClick={() => remove(card.id)}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
                                </button>
                                <span className="ocb-card-title">{cardLabel(card)}</span>
                                <button
                                    type="button"
                                    className="ocb-resize"
                                    title="Resize"
                                    onClick={e => {
                                        const r = e.currentTarget.getBoundingClientRect();
                                        setSizing({ id: card.id, top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 190) });
                                    }}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden="true">
                                        <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
                                    </svg>
                                    {card.w}×{card.h}
                                </button>
                            </div>
                        )}
                    </div>
                    );
                })}
                {/* Drop target while dragging. */}
                {draggedCell && (
                    <div
                        className="ocb-ghost"
                        style={{
                            gridColumn: `${draggedCell.x + 1} / span ${draggedCell.w}`,
                            gridRow: `${draggedCell.y + 1} / span ${draggedCell.h}`,
                        }}
                    />
                )}
                {/* Two spare rows under the lowest card in edit mode, so a card
                    can be dropped lower than everything else. */}
                {editing && (
                    <div className="ocb-spacer" style={{ gridColumn: '1 / -1', gridRow: `${bottom + 1} / span 2` }} />
                )}
                {cards.length === 0 && (
                    <div className="ocb-empty">No cards yet — open Layout → Customize cards to add some.</div>
                )}
            </div>

            {editing && (
                <div className="ocb-bar">
                    <AddMenu cards={cards} onAdd={add} />
                    <button type="button" className="ocb-bar-btn ocb-bar-ghost" onClick={resetCards}>Reset</button>
                    <button type="button" className="ocb-bar-btn ocb-bar-done" onClick={onDone}>Done</button>
                </div>
            )}

            {sizingCard && (
                <SizePicker
                    anchor={sizing}
                    w={sizingCard.w}
                    h={sizingCard.h}
                    onPick={(w, h) => {
                        resize(sizingCard.id, w, h);
                        setSizing(null);
                    }}
                    onClose={() => setSizing(null)}
                />
            )}
        </div>
    );
});

export { CardBoard };
