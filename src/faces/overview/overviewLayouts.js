import { useCallback, useState } from 'react';
import { flushSync } from 'react-dom';
import { getWidget } from '../../data/widgetCatalog';
import { isCustomWidgetId, loadCustomWidgets } from '../../data/customWidgets';

const LAYOUT_KEY = 'cooldesk-overview-layout';
const VISIBLE_KEY = 'cooldesk-overview-visible';

// Same two columns (widget rail + activity feed) in every layout — only the
// arrangement changes, via data-layout on .overview-dashboard-grid (see the
// "Overview layouts" block in cooldesk.css). `cells` drives the mini preview:
// [x, y, w, h] in a 40×28 box, w = widgets, f = feed.
export const OVERVIEW_LAYOUTS = [
    { key: 'classic', label: 'Classic', hint: 'Widgets left, feed right', cells: { w: [2, 2, 13, 24], f: [17, 2, 21, 24] } },
    { key: 'mirror', label: 'Mirror', hint: 'Feed left, widgets right', cells: { f: [2, 2, 21, 24], w: [25, 2, 13, 24] } },
    { key: 'split', label: 'Split', hint: 'Two equal halves', cells: { w: [2, 2, 17, 24], f: [21, 2, 17, 24] } },
    { key: 'stacked', label: 'Stacked', hint: 'Widgets on top, feed below', cells: { w: [2, 2, 36, 9], f: [2, 13, 36, 13] } },
    { key: 'focus', label: 'Focus', hint: 'One centered column', cells: { w: [10, 2, 20, 8], f: [10, 12, 20, 14] } },
    // Not two columns: a free card grid the user builds (CardBoard.jsx). The
    // extra cells only make its preview read as "lots of cards".
    { key: 'custom', label: 'Custom', hint: 'Build your own from cards', cells: { w: [2, 2, 11, 11], f: [15, 2, 23, 11] }, extra: [[2, 15, 23, 11], [27, 15, 11, 11]] },
];

// Parts of the page that can be hidden. Turning all of them off leaves just
// the wallpaper (and the corner buttons, so the way back stays reachable).
export const OVERVIEW_PARTS = [
    { key: 'widgets', label: 'Widgets' },
    { key: 'summary', label: 'Activity summary' },
    { key: 'feed', label: 'Activity feed' },
];

// Inside the activity feed: the Favorites strip and each switcher tab. Keys
// match ActivityFeed's tab ids (extension set — no chats/apps there).
export const FEED_TABS = [
    { key: 'all', label: 'All' },
    { key: 'tabs', label: 'Browsing' },
    { key: 'local', label: 'Local' },
    { key: 'suites', label: 'Suites' },
    { key: 'search', label: 'Search' },
    { key: 'media', label: 'Media' },
];

export const DEFAULT_VISIBLE = { widgets: true, summary: true, feed: true, favorites: true, hiddenFeedTabs: [] };

const isLayout = (k) => OVERVIEW_LAYOUTS.some(l => l.key === k);

// Morph the columns into place where the View Transitions API exists; a
// plain swap elsewhere. The columns only carry their view-transition-name
// while .overview-morphing is on <html> (see cooldesk.css): a permanent name
// makes each column its own isolated layer, and Chrome then paints the
// column's backdrop blur into the square corners outside its border-radius.
function withTransition(apply) {
    if (!document.startViewTransition) {
        apply();
        return;
    }
    const root = document.documentElement;
    root.classList.add('overview-morphing');
    const t = document.startViewTransition(() => flushSync(apply));
    t.finished.finally(() => root.classList.remove('overview-morphing'));
}

function loadVisible() {
    try {
        const v = JSON.parse(localStorage.getItem(VISIBLE_KEY));
        if (!v || typeof v !== 'object') return DEFAULT_VISIBLE;
        const tabKeys = FEED_TABS.map(t => t.key);
        const hidden = Array.isArray(v.hiddenFeedTabs) ? v.hiddenFeedTabs.filter(k => tabKeys.includes(k)) : [];
        return {
            ...Object.fromEntries(
                [...OVERVIEW_PARTS.map(p => p.key), 'favorites'].map(k => [k, typeof v[k] === 'boolean' ? v[k] : true])
            ),
            // At least one tab always stays visible.
            hiddenFeedTabs: hidden.length < tabKeys.length ? hidden : [],
        };
    } catch {
        return DEFAULT_VISIBLE;
    }
}

export function useOverviewLayout() {
    const [layout, setLayout] = useState(() => {
        try {
            const v = localStorage.getItem(LAYOUT_KEY);
            return isLayout(v) ? v : 'classic';
        } catch {
            return 'classic';
        }
    });
    const update = useCallback((next) => {
        if (!isLayout(next)) return;
        try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* storage unavailable — won't persist */ }
        withTransition(() => setLayout(next));
    }, []);
    return [layout, update];
}

export function useOverviewVisibility() {
    const [visible, setVisible] = useState(loadVisible);
    const update = useCallback((next) => {
        try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(next)); } catch { /* storage unavailable — won't persist */ }
        withTransition(() => setVisible(next));
    }, []);
    return [visible, update];
}

// ── Custom layout: a grid of cards ──────────────────────────────────────────
// Every existing piece of the page as a card (no new functionality — just a
// free arrangement). Each widget from the store is its own card ('widget' +
// widgetId); the whole widget board is still available as one card too. Feed
// cards can show every tab or be pinned to one section; the rest are
// single-instance (a second board would just mirror the same board).
// Grid v2: small square cells (macOS widget proportions — small 2×2, medium
// 4×2, large 4×4) and as many columns as fit. v1 boards used 4 big columns
// with quarter-screen rows; they're converted once by doubling every
// coordinate (see loadCards).
const CARDS_KEY = 'cooldesk-overview-cards-v2';
const CARDS_KEY_V1 = 'cooldesk-overview-cards';
export const CARD_MAX = 6; // spans run 1..6 cells each way
const DESIGN_COLS = 12; // widest board a stored x is allowed to assume
export const DEFAULT_COLS = 8;

export const CARD_TYPES = [
    { type: 'widgets', label: 'Widget board', single: true },
    { type: 'summary', label: 'Activity summary', single: true },
    { type: 'favorites', label: 'Favorites', single: true },
    { type: 'feed', label: 'Activity feed', tab: null },
    ...FEED_TABS.filter(t => t.key !== 'all').map(t => ({ type: 'feed', label: t.label, tab: t.key })),
];

export const widgetName = (widgetId) => getWidget(widgetId)?.name
    || loadCustomWidgets().find(w => w.id === widgetId)?.name;

// Default card height for a widget: macOS "small" (2×2), or 3 rows for the
// tall ones (lists, calendars) so they open with room for content.
export const widgetRows = (widgetId) => {
    const h = getWidget(widgetId)?.h || loadCustomWidgets().find(w => w.id === widgetId)?.h || 150;
    return h >= 200 ? 3 : 2;
};

export const cardLabel = (card) => (card.type === 'widget'
    ? widgetName(card.widgetId)
    : card.type === 'feed' && card.tab
        ? FEED_TABS.find(t => t.key === card.tab)?.label
        : CARD_TYPES.find(c => c.type === card.type && !c.tab)?.label) || 'Card';

const newCardId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Free placement: every card has its own cell (x = column 0..3, y = row),
// laid out against the full 4-column board. Narrower boards re-flow through
// resolveLayout() without touching what's stored.
export const makeCard = ({ type, tab = null, widgetId = null, w = 2, h = 2, x = 0, y = 0 }) => ({
    id: newCardId(), type, tab, ...(widgetId ? { widgetId } : {}), w, h, x, y,
});

// 8 columns × 6 rows: a column of small widgets, the feed as a large card
// under a Favorites strip, and two tall cards on the right.
const DEFAULT_CARDS = [
    { id: 'w-clock', type: 'widget', widgetId: 'clock', tab: null, w: 2, h: 2, x: 0, y: 0 },
    { id: 'w-weather', type: 'widget', widgetId: 'weather', tab: null, w: 2, h: 2, x: 0, y: 2 },
    { id: 'w-todo', type: 'widget', widgetId: 'todo', tab: null, w: 2, h: 2, x: 0, y: 4 },
    { id: 'favorites', type: 'favorites', tab: null, w: 4, h: 1, x: 2, y: 0 },
    { id: 'feed', type: 'feed', tab: null, w: 4, h: 5, x: 2, y: 1 },
    { id: 'summary', type: 'summary', tab: null, w: 2, h: 3, x: 6, y: 0 },
    { id: 'local', type: 'feed', tab: 'local', w: 2, h: 3, x: 6, y: 3 },
];

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// First free cell (top-to-bottom, left-to-right) for a w×h card.
export function firstFreeCell(placed, w, h, cols = DEFAULT_COLS) {
    const cw = Math.min(w, cols);
    for (let y = 0; ; y++) {
        for (let x = 0; x + cw <= cols; x++) {
            if (!placed.some(p => overlaps(p, { x, y, w: cw, h }))) return { x, y };
        }
    }
}

// Final cells for a board `cols` wide. Cards keep their own spot; one that
// would overlap an already-placed card is pushed straight down until it's
// clear. `priorityId` (the card being dropped/resized) is placed first so it
// wins its spot and the others make room. Spans/columns are clamped to fit
// narrower boards. Returns id -> { x, y, w, h }.
export function resolveLayout(cards, cols, priorityId = null) {
    const items = cards.map(c => {
        const w = Math.min(c.w, cols);
        return { id: c.id, w, h: c.h, x: Math.min(Math.max(0, c.x), cols - w), y: Math.max(0, c.y) };
    });
    items.sort((a, b) => (a.id === priorityId ? -1 : b.id === priorityId ? 1 : a.y - b.y || a.x - b.x));
    const placed = [];
    for (const it of items) {
        while (placed.some(p => overlaps(p, it))) it.y++;
        placed.push(it);
    }
    return Object.fromEntries(placed.map(p => [p.id, p]));
}

const clampSpan = (n) => Math.min(CARD_MAX, Math.max(1, Math.round(Number(n) || 1)));
const tabKeys = FEED_TABS.map(t => t.key);

function loadCards() {
    try {
        let v = JSON.parse(localStorage.getItem(CARDS_KEY));
        if (!Array.isArray(v)) {
            // One-time upgrade from the 4-column grid: each old cell is 2×2
            // new cells, so the arrangement keeps its proportions.
            const v1 = JSON.parse(localStorage.getItem(CARDS_KEY_V1));
            if (!Array.isArray(v1)) return DEFAULT_CARDS;
            v = v1.map(c => ({
                ...c,
                w: (Number(c.w) || 1) * 2,
                h: (Number(c.h) || 1) * 2,
                ...(Number.isInteger(c.x) && Number.isInteger(c.y) ? { x: c.x * 2, y: c.y * 2 } : {}),
            }));
        }
        const placed = [];
        const validWidget = (c) => typeof c.widgetId === 'string' && (getWidget(c.widgetId) || isCustomWidgetId(c.widgetId));
        return v.filter(c => c && typeof c.id === 'string'
            && (c.type === 'widget' ? validWidget(c) : CARD_TYPES.some(t => t.type === c.type)))
            .map(c => {
                const w = clampSpan(c.w);
                const h = clampSpan(c.h);
                // Boards saved before free placement have no cells: give each
                // card the first free spot, in its saved order.
                const cell = Number.isInteger(c.x) && Number.isInteger(c.y)
                    ? { x: Math.min(Math.max(0, c.x), DESIGN_COLS - w), y: Math.max(0, c.y) }
                    : firstFreeCell(placed, w, h);
                placed.push({ ...cell, w, h });
                return {
                    id: c.id,
                    type: c.type,
                    tab: c.type === 'feed' && tabKeys.includes(c.tab) && c.tab !== 'all' ? c.tab : null,
                    ...(c.type === 'widget' ? { widgetId: c.widgetId } : {}),
                    w,
                    h,
                    ...cell,
                };
            });
    } catch {
        return DEFAULT_CARDS;
    }
}

export function useOverviewCards() {
    const [cards, setCards] = useState(loadCards);
    const update = useCallback((next) => {
        setCards(prev => {
            const value = typeof next === 'function' ? next(prev) : next;
            try { localStorage.setItem(CARDS_KEY, JSON.stringify(value)); } catch { /* storage unavailable — won't persist */ }
            return value;
        });
    }, []);
    const reset = useCallback(() => update(DEFAULT_CARDS), [update]);
    return [cards, update, reset];
}
