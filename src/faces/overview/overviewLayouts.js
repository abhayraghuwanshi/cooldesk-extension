import { useCallback, useState } from 'react';
import { flushSync } from 'react-dom';

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
