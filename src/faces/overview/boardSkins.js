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
    MonoHeader,
    BrutalHeader,
    VaporHeader,
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
    // Looks with no workflow of their own — for any layout (looks.js).
    mono: { label: 'plain', header: MonoHeader, chrome: 60 },
    sakura: { label: null, theme: 'light' },
    ocean: { label: null },
    forest: { label: 'plain' },
    vapor: { label: 'plain', header: VaporHeader, chrome: 56 },
    brutal: { label: 'plain', header: BrutalHeader, chrome: 52, theme: 'light' },
    clay: { label: null, theme: 'light' },
    noir: { label: null },
};

// The Look picker's tiles: name, a swatch (background, ink, font). Order is
// the picker's order — calm first, loud last.
export const LOOKS = [
    { key: 'mono', label: 'Mono', bg: '#0a0a0a', ink: '#fff', font: 'Helvetica Neue, Arial, sans-serif' },
    { key: 'noir', label: 'Noir', bg: 'radial-gradient(circle at 30% 20%, #2a2a2a, #050505)', ink: '#e63946', font: 'Georgia, serif' },
    { key: 'paper', label: 'Paper', bg: '#ede7da', ink: '#2d2820', font: 'Georgia, serif' },
    { key: 'clay', label: 'Clay', bg: '#ebe2d6', ink: '#e07a4f', font: 'system-ui, sans-serif' },
    { key: 'sakura', label: 'Sakura', bg: 'linear-gradient(160deg, #ffe9f0, #ffd1df)', ink: '#c2416b', font: 'Georgia, serif' },
    { key: 'notebook', label: 'Notebook', bg: '#f8f6ef', ink: '#2b4a8b', font: '"Marker Felt", "Comic Sans MS", cursive' },
    { key: 'library', label: 'Library', bg: 'linear-gradient(180deg, #1d3a2c, #0b1914)', ink: '#e3c98a', font: 'Palatino, Georgia, serif' },
    { key: 'forest', label: 'Forest', bg: 'linear-gradient(180deg, #23361f, #0f1a0e)', ink: '#d9e8a8', font: 'Georgia, serif' },
    { key: 'ocean', label: 'Ocean', bg: 'linear-gradient(180deg, #0b4a5e, #04121f)', ink: '#5ff0e0', font: 'system-ui, sans-serif' },
    { key: 'planner', label: 'Planner', bg: 'linear-gradient(160deg, #2b3446, #121722)', ink: '#8ea3ff', font: 'system-ui, sans-serif' },
    { key: 'dash', label: 'Dashboard', bg: 'linear-gradient(160deg, #1a2350, #090d1a)', ink: '#a9b8ff', font: 'system-ui, sans-serif' },
    { key: 'canvas', label: 'Canvas', bg: '#1e1e1e', ink: '#0d99ff', font: 'Inter, system-ui, sans-serif' },
    { key: 'ide', label: 'Code', bg: '#1e1f24', ink: '#9cdcfe', font: 'Menlo, monospace' },
    { key: 'devtools', label: 'DevTools', bg: '#202124', ink: '#fdd663', font: 'Menlo, monospace' },
    { key: 'terminal', label: 'Terminal', bg: '#000', ink: '#ff9f1c', font: 'Menlo, monospace' },
    { key: 'mission', label: 'Mission', bg: 'radial-gradient(circle, #04140d, #000)', ink: '#5dffb3', font: 'Menlo, monospace' },
    { key: 'dawn', label: 'Dawn', bg: 'linear-gradient(180deg, #4b3570, #f08a6a 70%, #ffd29a)', ink: '#fff5ee', font: 'system-ui, sans-serif' },
    { key: 'dusk', label: 'Dusk', bg: 'linear-gradient(180deg, #0b0d24, #5d2a58 75%, #d9693f)', ink: '#efe8ff', font: 'system-ui, sans-serif' },
    { key: 'vapor', label: 'Vapor', bg: 'linear-gradient(180deg, #2b0b4f, #ff4fa3 120%)', ink: '#5ef2ff', font: 'system-ui, sans-serif' },
    { key: 'brutal', label: 'Brutal', bg: '#fff', ink: '#000', font: 'Arial Black, Arial, sans-serif', edge: '#ffe600' },
];

export const getSkin = (name) => (name && BOARD_SKINS[name]) || null;
