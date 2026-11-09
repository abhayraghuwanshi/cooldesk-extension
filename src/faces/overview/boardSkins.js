import {
    IdeHeader,
    IdeFooter,
    DevtoolsHeader,
    DevtoolsFooter,
    MissionHeader,
    DashHeader,
    LibraryHeader,
    PlannerHeader,
    NotebookHeader,
    TickerHeader,
    TickerFooter,
    PaperHeader,
    CanvasHeader,
    DawnHeader,
    DuskHeader,
} from './boardSkinFrames.jsx';

// The Workflow skins' config + card labels; the frames themselves are in
// boardSkinFrames.jsx, the styles under "Workflow skins" in cooldesk.css.

// ── Card labels ─────────────────────────────────────────────────────────────
const FEED_FILES = { local: 'servers.log', tabs: 'tabs.ts', search: 'engines.json', suites: 'suites.md', media: 'media.m3u' };
const FEED_NAMES = { local: 'Dev servers', tabs: 'Open tabs', search: 'Search engines', suites: 'Suites', media: 'Media' };
const TICKERS = { 'world-clock': 'SESS', crypto: 'CRYP', currency: 'FX', countdown: 'BELL', calendar: 'CAL', notes: 'NOTE', converter: 'CNV' };

function baseName(card, fallback) {
    if (card.type === 'feed') return card.tab ? FEED_NAMES[card.tab] : 'Activity';
    if (card.type === 'summary') return 'Activity';
    if (card.type === 'favorites') return 'Favorites';
    return fallback;
}

function fileName(card) {
    if (card.type === 'feed') return FEED_FILES[card.tab] || 'activity.log';
    if (card.type === 'summary') return 'activity.json';
    if (card.type === 'favorites') return 'favorites.yml';
    return `${card.widgetId}.tsx`;
}

// → { text, ext? } or null (no label). `name` is the card's readable label.
export function skinLabel(style, card, name, i) {
    if (card.type === 'searchbar' || card.widgetId === 'search') return null;
    const base = baseName(card, name);
    switch (style) {
        case 'file': {
            const f = fileName(card);
            return { text: f, ext: f.split('.').pop() };
        }
        case 'hud':
            return { text: `${String(i + 1).padStart(2, '0')} · ${base.toUpperCase()}` };
        case 'ticker':
            return { text: `${(card.type === 'widget' ? TICKERS[card.widgetId] : card.tab) || base.slice(0, 4)}`.toUpperCase(), sub: `${base} <GO>` };
        case 'frame':
            return { text: base, sub: '#' };
        case 'plain':
            return { text: base };
        default:
            return null;
    }
}

// name → config. `label`: skinLabel style. `chrome`: px the frame takes from
// the board's height budget (CardBoard subtracts it before sizing cells).
export const BOARD_SKINS = {
    ide: { label: 'file', header: IdeHeader, footer: IdeFooter, chrome: 76 },
    devtools: { label: 'file', header: DevtoolsHeader, footer: DevtoolsFooter, chrome: 76 },
    mission: { label: 'hud', header: MissionHeader, chrome: 48 },
    dash: { label: 'plain', header: DashHeader, chrome: 78 },
    library: { label: 'plain', header: LibraryHeader, chrome: 64 },
    planner: { label: null, header: PlannerHeader, chrome: 74 },
    notebook: { label: 'plain', header: NotebookHeader, chrome: 56, theme: 'light' },
    terminal: { label: 'ticker', header: TickerHeader, footer: TickerFooter, chrome: 64 },
    paper: { label: null, header: PaperHeader, chrome: 56, theme: 'light' },
    canvas: { label: 'frame', header: CanvasHeader, chrome: 56 },
    dawn: { label: null, header: DawnHeader, chrome: 64 },
    dusk: { label: null, header: DuskHeader, chrome: 64 },
};

export const getSkin = (name) => (name && BOARD_SKINS[name]) || null;
