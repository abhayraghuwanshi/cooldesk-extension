/**
 * Catalog of the widgets hosted in the CoolDesk widget store
 * (cool-desk.com/widgets). Mirrors the store's curated list; each widget is a
 * self-contained page embedded via iframe, themed with ?theme= and versioned
 * with ?v=.
 *
 * `h` is the tile height in px the board gives the widget — the board
 * converts it to grid rows. Widget pages are 100vh flex layouts, so these run
 * deliberately tighter than the store's roomy preview heights.
 */

export const WIDGET_STORE_ORIGIN = 'https://cool-desk.com';
export const WIDGET_STORE_URL = `${WIDGET_STORE_ORIGIN}/widgets`;
const WIDGET_VERSION = '5';

export const WIDGET_CATEGORIES = ['CoolDesk', 'Time & Focus', 'Productivity', 'Data & Life', 'Dev Tools'];

export const WIDGET_CATALOG = [
    { id: 'spotlight', name: 'Spotlight', desc: 'The CoolDesk search bar in miniature.', category: 'CoolDesk', h: 240, powered: true },
    { id: 'workspaces', name: 'Project Workspaces', desc: 'Your projects with tab/app counts and last activity.', category: 'CoolDesk', h: 240, powered: true },
    { id: 'session', name: 'Resume Session', desc: "Yesterday's working context behind one button.", category: 'CoolDesk', h: 190, powered: true },
    { id: 'tab-stats', name: 'Tab Pulse', desc: 'Open tabs, duplicates, oldest tab and top domains.', category: 'CoolDesk', h: 210, powered: true },
    { id: 'clock', name: 'Clock', desc: 'Big digital clock with date, timezone and 12/24h.', category: 'Time & Focus', h: 120 },
    { id: 'focus', name: 'Daily Focus', desc: 'One main thing per day. Resets each morning.', category: 'Time & Focus', h: 140, sandbox: 'allow-forms' },
    { id: 'search', name: 'Web Search', desc: 'One bar for Google, DuckDuckGo, Bing, YouTube, GitHub.', category: 'Productivity', h: 100, sandbox: 'allow-popups allow-popups-to-escape-sandbox allow-forms' },
    { id: 'todo', name: 'Tasks', desc: 'Quick task list — add, check off, clear.', category: 'Productivity', h: 220, sandbox: 'allow-forms' },
    { id: 'weather', name: 'Weather', desc: 'Current conditions via Open-Meteo.', category: 'Data & Life', h: 120 },
    { id: 'pomodoro', name: 'Pomodoro', desc: '25/5 focus timer with sessions.', category: 'Time & Focus', h: 200 },
    { id: 'notes', name: 'Scratchpad', desc: 'A plain autosaving textarea.', category: 'Productivity', h: 200 },
    { id: 'calendar', name: 'Calendar', desc: 'Month at a glance, today highlighted.', category: 'Time & Focus', h: 250 },
    { id: 'quick-links', name: 'Quick Links', desc: 'Favorite sites as a tile grid.', category: 'Productivity', h: 190, sandbox: 'allow-popups allow-popups-to-escape-sandbox allow-forms' },
    { id: 'world-clock', name: 'World Clock', desc: 'Five cities, one glance.', category: 'Time & Focus', h: 180 },
    { id: 'habits', name: 'Habit Tracker', desc: 'Weekly dot grid per habit.', category: 'Productivity', h: 210, sandbox: 'allow-forms' },
    { id: 'timer', name: 'Timer & Stopwatch', desc: 'Presets, custom minutes, stopwatch.', category: 'Time & Focus', h: 210 },
    { id: 'countdown', name: 'Countdown', desc: 'Days–hours–minutes–seconds to any date.', category: 'Time & Focus', h: 130 },
    { id: 'quotes', name: 'Quotes', desc: 'A stable quote of the day; click for another.', category: 'Data & Life', h: 150 },
    { id: 'today', name: 'Today', desc: 'Weekday, date, ISO week, day progress.', category: 'Time & Focus', h: 150 },
    { id: 'crypto', name: 'Crypto Ticker', desc: 'BTC/ETH/SOL with 24h change, via CoinGecko.', category: 'Data & Life', h: 170 },
    { id: 'year-progress', name: 'Year Progress', desc: 'The year as a progress bar.', category: 'Time & Focus', h: 120 },
    { id: 'currency', name: 'Currency', desc: 'Live conversion via ECB rates.', category: 'Data & Life', h: 180 },
    { id: 'converter', name: 'Unit Converter', desc: 'Length, weight, data, speed, temperature.', category: 'Data & Life', h: 180 },
    { id: 'github', name: 'GitHub Graph', desc: "Any user's contribution graph.", category: 'Data & Life', h: 160, sandbox: 'allow-forms' },
    { id: 'breathe', name: 'Breathe', desc: 'Box breathing with a slow animated orb.', category: 'Data & Life', h: 220 },
    { id: 'water', name: 'Water Tracker', desc: 'Glasses per day with a visual fill.', category: 'Data & Life', h: 160 },
    { id: 'streak', name: 'Streak Counter', desc: 'Days since anything — a habit kept, a quit.', category: 'Data & Life', h: 160, sandbox: 'allow-forms' },
    { id: 'moon', name: 'Moon Phase', desc: "Tonight's phase and days to full.", category: 'Data & Life', h: 130 },
    { id: 'sun', name: 'Sunrise & Sunset', desc: "Today's sun times and daylight progress.", category: 'Data & Life', h: 160 },
    { id: 'on-this-day', name: 'On This Day', desc: "A historical event for today's date.", category: 'Data & Life', h: 170 },
    { id: 'picker', name: 'Decision Maker', desc: 'Type options and let fate pick.', category: 'Data & Life', h: 190, sandbox: 'allow-forms' },
    { id: 'password', name: 'Password Generator', desc: 'Strong local passwords, never leave the page.', category: 'Dev Tools', h: 180 },
    { id: 'palette', name: 'Color Palette', desc: 'Harmonized five-color palettes, click to copy.', category: 'Dev Tools', h: 170 },
    { id: 'json', name: 'JSON Formatter', desc: 'Paste, format or minify, copy. Fully local.', category: 'Dev Tools', h: 280 },
    { id: 'shortcuts', name: 'Shortcut of the Day', desc: 'One keyboard shortcut a day.', category: 'Productivity', h: 170 },
    { id: 'snippets', name: 'Snippets', desc: 'Your most-pasted text, one click to copy.', category: 'Productivity', h: 210, sandbox: 'allow-forms' },
    { id: 'year-dots', name: 'Year in Dots', desc: 'The whole year as a dot grid.', category: 'Time & Focus', h: 150 },
    { id: 'wpm', name: 'Typing Sprint', desc: 'A 15-second typing test with best-score memory.', category: 'Dev Tools', h: 190 },
    { id: 'regex', name: 'Regex Tester', desc: 'Live pattern matching, highlighted results.', category: 'Dev Tools', h: 260 },
];

const byId = new Map(WIDGET_CATALOG.map(w => [w.id, w]));

export function getWidget(id) {
    return byId.get(id) || null;
}

// Widgets are bundled WITH the app (public/widgets/) and served from the app's
// OWN origin, not from cool-desk.com. Same-origin means the host talks to them
// directly, they update with the app (no deploy-to-cool-desk.com loop), and — if
// ever needed — the host can style them without the cross-origin wall. The public
// store page (WIDGET_STORE_URL, above) still lives on cool-desk.com for browsing.
//
// Widgets paint their own OPAQUE surface. Do not send `embed=host` (transparent
// widget, host tile paints the card): the iframe canvas renders opaque white in
// this app — verified twice — so a transparent widget is white-on-white, and a
// translucent one is the grey slab that white shows through. Nothing the host
// draws behind the frame is ever visible.
//
// `tint` is how the per-tile accent reaches the widget: the page mixes it into
// its own surface and --accent (see public/widgets/cooldesk.js + base.css).
function widgetBase() {
    // Resolve against the running document so it's correct in dev (the Vite
    // server origin), the Tauri build (the app origin), and Electron (file://).
    try { return new URL('widgets/', document.baseURI); }
    catch { return new URL('widgets/', location.href); }
}

export function widgetEmbedUrl(id, theme, tint) {
    const t = typeof tint === 'string' ? tint.replace(/^#/, '') : '';
    const tintParam = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t) ? `&tint=${t}` : '';
    const query = `?theme=${theme === 'light' ? 'light' : 'dark'}${tintParam}&v=${WIDGET_VERSION}`;
    return new URL(`${id}.html${query}`, widgetBase()).href;
}

// Origin to target when postMessage-ing the host bridge into a widget iframe.
// Widgets are same-origin now, so it's the app's own origin; fall back to '*'
// for opaque origins (file://) where a concrete origin string isn't usable.
export function widgetEmbedOrigin() {
    try {
        const o = new URL(widgetBase()).origin;
        return o && o !== 'null' ? o : '*';
    } catch { return '*'; }
}

export function widgetSandbox(widget) {
    return `allow-scripts allow-same-origin${widget.sandbox ? ` ${widget.sandbox}` : ''}`;
}
