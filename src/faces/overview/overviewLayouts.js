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

// ── Vibes ──────────────────────────────────────────────────────────────────
// Ready-made card boards for a mood: same CardBoard as Custom, but each vibe
// keeps its own stored board (seeded from `cards` below), so picking one never
// overwrites the user's Custom board, and tweaks to a vibe stick to that vibe.
// Reset in Customize returns a vibe to these defaults. Cards start at x = 0:
// the board centers on the columns it uses. `center` vertically centers the
// board (sparse vibes would otherwise hang from the top).
const vibeCard = (id, widgetId, w, h, x, y) => ({ id, type: 'widget', widgetId, tab: null, w, h, x, y });
// A page piece rather than a widget: searchbar / summary / favorites, or a
// feed card pinned to one tab (local, tabs, search, suites, media).
const pageCard = (id, type, tab, w, h, x, y) => ({ id, type, tab, w, h, x, y });

export const OVERVIEW_VIBES = [
    {
        key: 'vibe-search', label: 'Search', hint: 'Just a search bar — nothing else', center: true,
        cards: [{ id: 'v-searchbar', type: 'searchbar', tab: null, w: 6, h: 1, x: 0, y: 0 }],
    },
    {
        // Bare on the wallpaper — no card glass — so it's a stage, not a board.
        key: 'vibe-zen', label: 'Zen', hint: 'Clock, a slow breath, a quote — nothing boxed in',
        preview: [[12, 4, 16, 7], [17, 13, 6, 6], [10, 23, 20, 2]],
        stage: {
            center: [
                { kind: 'widget', id: 'clock', w: 620, h: 260 },
                { kind: 'widget', id: 'breathe', w: 280, h: 240 },
            ],
            bottom: [{ kind: 'widget', id: 'quotes', w: 640, h: 120 }],
        },
    },
    {
        key: 'vibe-deep', label: 'Deep work', hint: 'One focus, a timer, tasks and notes', center: true,
        cards: [
            vibeCard('v-focus', 'focus', 6, 1, 0, 0),
            vibeCard('v-pomodoro', 'pomodoro', 2, 3, 0, 1),
            vibeCard('v-todo', 'todo', 2, 3, 2, 1),
            vibeCard('v-notes', 'notes', 2, 3, 4, 1),
        ],
    },
    {
        key: 'vibe-fun', label: 'Fun', hint: 'Typing sprints, fate picks, trivia', center: true,
        cards: [
            vibeCard('v-wpm', 'wpm', 2, 2, 0, 0),
            vibeCard('v-picker', 'picker', 2, 2, 2, 0),
            vibeCard('v-onthisday', 'on-this-day', 2, 2, 4, 0),
            vibeCard('v-moon', 'moon', 2, 2, 0, 2),
            vibeCard('v-water', 'water', 2, 2, 2, 2),
            vibeCard('v-quotes', 'quotes', 2, 2, 4, 2),
        ],
    },
    {
        key: 'vibe-morning', label: 'Morning', hint: 'Weather, sun, calendar, today\'s tasks', center: true,
        cards: [
            vibeCard('v-today', 'today', 2, 2, 0, 0),
            vibeCard('v-weather', 'weather', 2, 2, 2, 0),
            vibeCard('v-sun', 'sun', 2, 2, 4, 0),
            vibeCard('v-calendar', 'calendar', 3, 3, 0, 2),
            vibeCard('v-todo', 'todo', 3, 3, 3, 2),
        ],
    },
    {
        key: 'vibe-dev', label: 'Dev', hint: 'JSON, regex, passwords, contributions', center: true,
        cards: [
            vibeCard('v-github', 'github', 4, 2, 0, 0),
            vibeCard('v-password', 'password', 2, 2, 4, 0),
            vibeCard('v-json', 'json', 3, 3, 0, 2),
            vibeCard('v-regex', 'regex', 3, 3, 3, 2),
        ],
    },

    // ── Start pages ── the arrangements of well-known new-tab pages, made of
    // the same pieces. `stage` ones render in StageBoard.jsx (regions: top
    // corners, a centered stack, a bottom line; sizes are max px); `preview`
    // is their picker thumbnail as [x, y, w, h] in the 40×28 box.
    {
        key: 'start-greeting', group: 'start', label: 'Greeting', hint: 'Big clock, a greeting, today\'s focus, a quote',
        preview: [[29, 3, 8, 3], [12, 8, 16, 7], [14, 16, 12, 2], [13, 19, 14, 2], [10, 24, 20, 2]],
        stage: {
            topRight: [{ kind: 'widget', id: 'weather', w: 230, h: 96 }],
            center: [
                { kind: 'widget', id: 'clock', w: 600, h: 260 },
                { kind: 'greeting' },
                { kind: 'widget', id: 'focus', w: 460, h: 150 },
            ],
            bottom: [{ kind: 'widget', id: 'quotes', w: 620, h: 130 }],
        },
    },
    {
        key: 'start-shortcuts', group: 'start', label: 'Shortcuts', hint: 'A search bar over your shortcut tiles',
        preview: [[8, 9, 24, 4], [9, 16, 4, 4], [15, 16, 4, 4], [21, 16, 4, 4], [27, 16, 4, 4]],
        stage: {
            center: [
                { kind: 'searchbar', w: 640 },
                { kind: 'shortcuts', size: 'md', w: 680 },
            ],
        },
    },
    {
        key: 'start-page', group: 'start', label: 'Start Page', hint: 'Favorites, recently visited and your activity in one column',
        preview: [[8, 3, 24, 2], [8, 6, 5, 5], [14, 6, 5, 5], [20, 6, 5, 5], [26, 6, 5, 5], [8, 13, 24, 7], [8, 21, 24, 5]],
        stage: {
            align: 'top',
            center: [
                { kind: 'shortcuts', size: 'lg', title: 'Favorites', w: 820 },
                { kind: 'feed', tab: 'tabs', title: 'Recently visited', w: 820, h: 340 },
                { kind: 'summary', title: 'Your activity', w: 820 },
            ],
        },
    },
    {
        key: 'start-minimal', group: 'start', label: 'Minimal', hint: 'Clock, weather and a search bar — nothing else',
        preview: [[13, 6, 14, 7], [16, 14, 8, 3], [10, 19, 20, 3]],
        stage: {
            center: [
                { kind: 'widget', id: 'clock', w: 460, h: 200 },
                { kind: 'widget', id: 'weather', w: 260, h: 100 },
                { kind: 'searchbar', w: 560 },
            ],
        },
    },
    {
        key: 'start-launchpad', group: 'start', label: 'Launchpad', hint: 'Search plus a big grid of app-style icons',
        preview: [[10, 3, 20, 3], [6, 9, 5, 5], [13, 9, 5, 5], [20, 9, 5, 5], [27, 9, 5, 5], [6, 16, 5, 5], [13, 16, 5, 5], [20, 16, 5, 5], [27, 16, 5, 5]],
        stage: {
            center: [
                { kind: 'searchbar', w: 600 },
                { kind: 'shortcuts', size: 'xl', w: 920 },
            ],
        },
    },
    {
        key: 'start-columns', group: 'start', label: 'Columns', hint: 'Browsing, search engines and suites side by side',
        cards: [
            // Browsing rows carry time + tab chips: 2 cells (~300px) is too
            // narrow for them, so it gets the wide column.
            { id: 'col-tabs', type: 'feed', tab: 'tabs', w: 4, h: 5, x: 0, y: 0 },
            { id: 'col-search', type: 'feed', tab: 'search', w: 2, h: 5, x: 4, y: 0 },
            { id: 'col-suites', type: 'feed', tab: 'suites', w: 2, h: 5, x: 6, y: 0 },
        ],
    },

    // ── Workflows ── boards built around a job, not a mood: what a person in
    // that role actually keeps open (dev servers next to tabs, the activity
    // summary next to tab pulse, time zones next to a timer). Card boards, so
    // each one is a starting point the user can rearrange; 8 columns max.
    // No ⚡ powered widgets (session, workspaces, tab-stats): the extension
    // doesn't answer their bridge calls, so they'd only show demo data.
    // `skin` dresses the board as the place that job happens (an IDE, a
    // trading terminal, a notebook…) — see boardSkins.jsx.
    {
        key: 'work-localdev', group: 'work', skin: 'ide', label: 'Local Dev', hint: 'Dev servers, open tabs, snippets and a scratchpad', center: true,
        cards: [
            pageCard('d-search', 'searchbar', null, 6, 1, 0, 0),
            vibeCard('d-snippets', 'snippets', 2, 2, 6, 0),
            pageCard('d-local', 'feed', 'local', 3, 4, 0, 1),
            pageCard('d-tabs', 'feed', 'tabs', 3, 4, 3, 1),
            vibeCard('d-notes', 'notes', 2, 3, 6, 2),
        ],
    },
    {
        key: 'work-debug', group: 'work', skin: 'devtools', label: 'Debugging', hint: 'Servers, JSON, regex, a timer and notes for chasing a bug', center: true,
        cards: [
            pageCard('g-local', 'feed', 'local', 2, 3, 0, 0),
            vibeCard('g-json', 'json', 3, 3, 2, 0),
            vibeCard('g-regex', 'regex', 3, 3, 5, 0),
            vibeCard('g-notes', 'notes', 4, 2, 0, 3),
            vibeCard('g-timer', 'timer', 2, 2, 4, 3),
            vibeCard('g-password', 'password', 2, 2, 6, 3),
        ],
    },
    {
        key: 'work-oncall', group: 'work', skin: 'mission', label: 'On-call', hint: 'Mission control: servers, time zones, a timer, a runbook', center: true,
        cards: [
            vibeCard('o-world', 'world-clock', 2, 2, 0, 0),
            pageCard('o-local', 'feed', 'local', 4, 4, 2, 0),
            vibeCard('o-timer', 'timer', 2, 2, 6, 0),
            vibeCard('o-runbook', 'todo', 2, 3, 0, 2),
            vibeCard('o-notes', 'notes', 2, 3, 6, 2),
            pageCard('o-search', 'searchbar', null, 4, 1, 2, 4),
        ],
    },
    {
        key: 'work-analytics', group: 'work', skin: 'dash', label: 'Analytics', hint: 'Your browsing in numbers: activity, progress, habits, streaks', center: true,
        cards: [
            pageCard('a-summary', 'summary', null, 4, 4, 0, 0),
            vibeCard('a-habits', 'habits', 2, 2, 4, 0),
            vibeCard('a-year', 'year-progress', 2, 1, 6, 0),
            vibeCard('a-today', 'today', 2, 2, 6, 1),
            vibeCard('a-dots', 'year-dots', 2, 2, 4, 2),
            vibeCard('a-streak', 'streak', 2, 2, 6, 3),
            pageCard('a-search', 'feed', 'search', 4, 2, 0, 4),
            vibeCard('a-converter', 'converter', 2, 2, 4, 4),
        ],
    },
    {
        key: 'work-research', group: 'work', skin: 'library', label: 'Research', hint: 'Search engines, open tabs and notes side by side', center: true,
        cards: [
            pageCard('r-searchbar', 'searchbar', null, 8, 1, 0, 0),
            pageCard('r-search', 'feed', 'search', 2, 4, 0, 1),
            pageCard('r-tabs', 'feed', 'tabs', 3, 4, 2, 1),
            vibeCard('r-question', 'focus', 3, 1, 5, 1),
            vibeCard('r-notes', 'notes', 3, 3, 5, 2),
        ],
    },
    {
        key: 'work-manager', group: 'work', skin: 'planner', label: 'Manager', hint: 'Calendar, time zones, priorities and your work suites', center: true,
        cards: [
            vibeCard('m-calendar', 'calendar', 2, 3, 0, 0),
            vibeCard('m-focus', 'focus', 4, 1, 2, 0),
            pageCard('m-suites', 'feed', 'suites', 2, 5, 6, 0),
            vibeCard('m-world', 'world-clock', 2, 2, 2, 1),
            vibeCard('m-todo', 'todo', 2, 4, 4, 1),
            vibeCard('m-countdown', 'countdown', 2, 1, 0, 3),
            vibeCard('m-notes', 'notes', 2, 2, 2, 3),
        ],
    },
    {
        key: 'work-student', group: 'work', skin: 'notebook', label: 'Student', hint: 'Pomodoro, exam countdown, calendar, habits and tasks', center: true,
        cards: [
            vibeCard('s-pomodoro', 'pomodoro', 2, 3, 0, 0),
            vibeCard('s-countdown', 'countdown', 4, 1, 2, 0),
            vibeCard('s-calendar', 'calendar', 2, 3, 6, 0),
            vibeCard('s-todo', 'todo', 2, 2, 2, 1),
            vibeCard('s-habits', 'habits', 2, 2, 4, 1),
            vibeCard('s-notes', 'notes', 4, 2, 0, 3),
            vibeCard('s-dots', 'year-dots', 2, 2, 4, 3),
            vibeCard('s-quotes', 'quotes', 2, 2, 6, 3),
        ],
    },
    {
        key: 'work-markets', group: 'work', skin: 'terminal', label: 'Markets', hint: 'Crypto, currencies, market hours across the world', center: true,
        cards: [
            vibeCard('k-world', 'world-clock', 4, 2, 0, 0),
            vibeCard('k-crypto', 'crypto', 2, 3, 4, 0),
            vibeCard('k-currency', 'currency', 2, 3, 6, 0),
            vibeCard('k-countdown', 'countdown', 2, 1, 0, 2),
            vibeCard('k-calendar', 'calendar', 2, 3, 2, 2),
            vibeCard('k-notes', 'notes', 2, 2, 0, 3),
            pageCard('k-search', 'feed', 'search', 4, 2, 4, 3),
        ],
    },
    {
        key: 'work-writer', group: 'work', skin: 'paper', label: 'Writer', hint: 'One focus, a big scratchpad, a timer and typing sprints', center: true,
        cards: [
            vibeCard('w-focus', 'focus', 6, 1, 0, 0),
            vibeCard('w-notes', 'notes', 4, 4, 0, 1),
            vibeCard('w-pomodoro', 'pomodoro', 2, 2, 4, 1),
            vibeCard('w-wpm', 'wpm', 2, 2, 4, 3),
            vibeCard('w-quotes', 'quotes', 6, 1, 0, 5),
        ],
    },
    {
        key: 'work-designer', group: 'work', skin: 'canvas', label: 'Designer', hint: 'Palettes, media, references and a tie-breaker', center: true,
        cards: [
            vibeCard('x-palette', 'palette', 4, 2, 0, 0),
            pageCard('x-media', 'feed', 'media', 4, 4, 4, 0),
            vibeCard('x-notes', 'notes', 2, 2, 0, 2),
            vibeCard('x-picker', 'picker', 2, 2, 2, 2),
            pageCard('x-favorites', 'favorites', null, 8, 1, 0, 4),
        ],
    },
    {
        key: 'work-resume', group: 'work', skin: 'dawn', label: 'Resume', hint: 'Pick up where you left off: favorites, open tabs, dev servers', center: true,
        cards: [
            pageCard('u-favorites', 'favorites', null, 6, 2, 0, 0),
            vibeCard('u-today', 'today', 2, 2, 6, 0),
            pageCard('u-tabs', 'feed', 'tabs', 4, 4, 0, 2),
            vibeCard('u-todo', 'todo', 2, 4, 4, 2),
            pageCard('u-local', 'feed', 'local', 2, 4, 6, 2),
        ],
    },
    {
        key: 'work-wrapup', group: 'work', skin: 'dusk', label: 'Wrap-up', hint: 'End of day: what you did, what\'s next, a streak to keep', center: true,
        cards: [
            pageCard('e-summary', 'summary', null, 4, 4, 0, 0),
            vibeCard('e-streak', 'streak', 2, 2, 4, 0),
            vibeCard('e-sun', 'sun', 2, 2, 6, 0),
            vibeCard('e-todo', 'todo', 2, 3, 4, 2),
            vibeCard('e-notes', 'notes', 2, 3, 6, 2),
            vibeCard('e-quotes', 'quotes', 4, 1, 0, 4),
        ],
    },

    // ── Just for fun ── the wilder new-tab ideas out there, same pieces.
    {
        key: 'fun-poster', group: 'fun', label: 'Poster', hint: 'One giant clock, like a print on the wall',
        preview: [[4, 7, 32, 12], [12, 21, 16, 2]],
        stage: { center: [{ kind: 'time', size: 'poster' }, { kind: 'date', className: 'is-poster' }] },
    },
    {
        key: 'fun-orbit', group: 'fun', label: 'Orbit', hint: 'Your shortcuts slowly orbiting the clock',
        preview: [[16, 11, 8, 6], [18, 2, 4, 4], [28, 6, 4, 4], [28, 18, 4, 4], [18, 22, 4, 4], [8, 18, 4, 4], [8, 6, 4, 4]],
        stage: { center: [{ kind: 'shortcuts', variant: 'orbit', radius: 250, max: 12 }] },
    },
    {
        key: 'fun-desktop', group: 'fun', label: 'Desktop', hint: 'Clock and search, shortcuts in a magnifying dock',
        preview: [[12, 6, 16, 6], [10, 14, 20, 3], [8, 22, 24, 4]],
        stage: {
            center: [
                { kind: 'time', size: 'xl' },
                { kind: 'date' },
                { kind: 'searchbar', w: 560 },
            ],
            bottom: [{ kind: 'shortcuts', variant: 'dock', max: 12 }],
        },
    },
    {
        key: 'fun-terminal', group: 'fun', label: 'Terminal', hint: 'Green-screen hacker mode',
        preview: [[4, 4, 14, 2], [4, 8, 20, 6], [4, 16, 26, 2], [4, 19, 12, 1], [4, 21, 12, 1], [4, 23, 12, 1]],
        stage: {
            align: 'top',
            center: [{
                kind: 'group', className: 'term-screen', w: 860, pieces: [
                    { kind: 'text', text: 'guest@cooldesk:~$ date', className: 'term-prompt' },
                    { kind: 'time', size: 'term', seconds: true },
                    { kind: 'date', long: true, className: 'term-dim' },
                    { kind: 'text', text: 'guest@cooldesk:~$ search', className: 'term-prompt' },
                    { kind: 'searchbar' },
                    { kind: 'text', text: 'guest@cooldesk:~$ ls ~/shortcuts', className: 'term-prompt' },
                    { kind: 'shortcuts', variant: 'list' },
                    { kind: 'text', text: 'guest@cooldesk:~$ ', className: 'term-prompt term-cursor' },
                ],
            }],
        },
    },
    {
        key: 'fun-paper', group: 'fun', label: 'Newspaper', hint: 'The morning edition: headline, quote, weather',
        preview: [[6, 2, 28, 24], [9, 4, 22, 3], [9, 9, 22, 1], [9, 12, 13, 11], [24, 12, 7, 5], [24, 18, 7, 5]],
        stage: {
            align: 'top',
            center: [{
                kind: 'group', className: 'paper-sheet', w: 980, pieces: [
                    { kind: 'text', text: 'The Daily Tab', className: 'paper-masthead' },
                    { kind: 'date', long: true, className: 'paper-dateline' },
                    {
                        kind: 'group', dir: 'row', className: 'paper-cols', pieces: [
                            {
                                kind: 'group', className: 'paper-lead', pieces: [
                                    { kind: 'text', text: 'Top story', className: 'paper-kicker' },
                                    { kind: 'widget', id: 'on-this-day', theme: 'light', align: 'left', h: 200 },
                                ],
                            },
                            {
                                kind: 'group', className: 'paper-side', pieces: [
                                    { kind: 'text', text: 'Weather', className: 'paper-kicker' },
                                    { kind: 'widget', id: 'weather', theme: 'light', h: 110 },
                                    { kind: 'text', text: 'Words to live by', className: 'paper-kicker' },
                                    { kind: 'widget', id: 'quotes', theme: 'light', h: 150 },
                                ],
                            },
                        ],
                    },
                ],
            }],
        },
    },
    {
        key: 'fun-scrapbook', group: 'fun', label: 'Scrapbook', hint: 'Widgets taped to a corkboard, a little crooked',
        preview: [[4, 4, 10, 9], [16, 3, 9, 10], [27, 5, 9, 8], [6, 15, 11, 9], [20, 15, 12, 9]],
        stage: {
            center: [{
                kind: 'group', dir: 'row', className: 'scrap-board', w: 1000, pieces: [
                    { kind: 'widget', id: 'today', glass: true, w: 250, h: 170, className: 'scrap' },
                    { kind: 'widget', id: 'quotes', glass: true, w: 300, h: 190, className: 'scrap' },
                    { kind: 'widget', id: 'moon', glass: true, align: 'left', w: 260, h: 160, className: 'scrap' },
                    { kind: 'widget', id: 'todo', glass: true, align: 'left', w: 270, h: 250, className: 'scrap' },
                    { kind: 'widget', id: 'picker', glass: true, align: 'left', w: 270, h: 230, className: 'scrap' },
                    { kind: 'widget', id: 'water', glass: true, align: 'left', w: 250, h: 170, className: 'scrap' },
                ],
            }],
        },
    },
    {
        key: 'fun-night', group: 'fun', label: 'Night', hint: 'A starry sky, the moon and the clock',
        preview: [[15, 4, 10, 8], [10, 14, 20, 6], [14, 22, 12, 3]],
        stage: {
            center: [
                { kind: 'widget', id: 'moon', align: 'left', w: 290, h: 150 },
                { kind: 'time', size: 'xl' },
                { kind: 'date' },
            ],
            bottom: [{ kind: 'widget', id: 'sun', w: 420, h: 150 }],
        },
    },
    {
        key: 'fun-corners', group: 'fun', label: 'Corners', hint: 'A widget in every corner, the middle left free',
        preview: [[2, 2, 10, 6], [28, 2, 10, 5], [2, 20, 14, 6], [28, 18, 10, 8]],
        stage: {
            topLeft: [{ kind: 'widget', id: 'clock', align: 'left', w: 300, h: 150 }],
            topRight: [{ kind: 'widget', id: 'weather', w: 250, h: 104 }],
            center: [],
            bottomLeft: [{ kind: 'widget', id: 'quotes', align: 'left', w: 420, h: 130 }],
            bottomRight: [{ kind: 'widget', id: 'todo', glass: true, align: 'left', w: 290, h: 250 }],
        },
    },
    {
        key: 'fun-sidebar', group: 'fun', label: 'Sidebar', hint: 'A shortcut rail on the left, search and tabs on the right',
        preview: [[2, 2, 7, 24], [12, 3, 24, 3], [12, 9, 24, 16]],
        stage: {
            align: 'top',
            left: [{ kind: 'shortcuts', variant: 'rail', max: 14 }],
            center: [
                { kind: 'greeting' },
                { kind: 'searchbar', w: 760 },
                { kind: 'feed', tab: 'tabs', title: 'Open now', w: 760, h: 420 },
            ],
        },
    },
    {
        key: 'fun-bento', group: 'fun', label: 'Bento', hint: 'An Apple-style bento grid of mixed sizes', center: true,
        cards: [
            vibeCard('b-clock', 'clock', 4, 2, 0, 0),
            vibeCard('b-weather', 'weather', 2, 2, 4, 0),
            vibeCard('b-calendar', 'calendar', 2, 3, 6, 0),
            vibeCard('b-todo', 'todo', 2, 3, 0, 2),
            vibeCard('b-quotes', 'quotes', 4, 1, 2, 2),
            vibeCard('b-pomodoro', 'pomodoro', 2, 2, 2, 3),
            vibeCard('b-moon', 'moon', 2, 2, 4, 3),
            vibeCard('b-year', 'year-progress', 2, 1, 6, 3),
            vibeCard('b-sun', 'sun', 2, 1, 6, 4),
        ],
    },
    {
        key: 'fun-cockpit', group: 'fun', label: 'Cockpit', hint: 'Every gauge at once — a dense dashboard', center: true,
        cards: [
            vibeCard('k-world', 'world-clock', 2, 2, 0, 0),
            vibeCard('k-crypto', 'crypto', 2, 2, 2, 0),
            vibeCard('k-currency', 'currency', 2, 2, 4, 0),
            vibeCard('k-weather', 'weather', 2, 2, 6, 0),
            vibeCard('k-year', 'year-progress', 2, 1, 0, 2),
            vibeCard('k-countdown', 'countdown', 2, 1, 2, 2),
            vibeCard('k-sun', 'sun', 2, 2, 4, 2),
            vibeCard('k-moon', 'moon', 2, 2, 6, 2),
            vibeCard('k-today', 'today', 2, 2, 0, 3),
            vibeCard('k-converter', 'converter', 2, 2, 2, 3),
            vibeCard('k-quotes', 'quotes', 4, 1, 4, 4),
        ],
    },

    // ── Designs ── less widget, more design: the time drawn a dozen ways and
    // the page dressed as an object, a movement, an era. Mostly CSS skins
    // (data-stage in cooldesk.css) over text pieces + drawn clocks.
    {
        key: 'design-wordclock', group: 'design', label: 'Word Clock', hint: 'The time spelled out in a grid of letters',
        preview: [[6, 4, 28, 2], [6, 8, 28, 2], [6, 12, 28, 2], [6, 16, 28, 2], [6, 20, 28, 2]],
        stage: { bg: 'wordclock', center: [{ kind: 'wordclock' }] },
    },
    {
        key: 'design-analog', group: 'design', label: 'Analog', hint: 'A quiet clock face',
        preview: [[11, 3, 18, 18], [15, 23, 10, 2]],
        stage: { center: [{ kind: 'analog' }, { kind: 'date', className: 'is-spaced' }] },
    },
    {
        key: 'design-flip', group: 'design', label: 'Flip Clock', hint: 'Split-flap cards that flip each second',
        preview: [[4, 9, 6, 10], [11, 9, 6, 10], [19, 9, 6, 10], [26, 9, 6, 10], [33, 11, 4, 6]],
        stage: { center: [{ kind: 'flip' }, { kind: 'date', className: 'is-spaced' }] },
    },
    {
        key: 'design-binary', group: 'design', label: 'Binary', hint: 'Hours, minutes and seconds in glowing bits',
        preview: [[7, 12, 3, 3], [12, 7, 3, 3], [12, 17, 3, 3], [19, 12, 3, 3], [24, 7, 3, 3], [30, 17, 3, 3]],
        stage: { bg: 'binary', center: [{ kind: 'binary' }, { kind: 'text', text: 'read each column top-down: 8 · 4 · 2 · 1', className: 'binary-hint' }] },
    },
    {
        key: 'design-tree', group: 'design', label: 'Tree', hint: 'The classic ~/startpage: shortcuts as a file tree',
        preview: [[8, 4, 24, 20], [10, 6, 8, 2], [10, 10, 12, 4], [10, 16, 10, 1], [10, 18, 10, 1], [10, 20, 10, 1]],
        stage: {
            bg: 'mocha',
            center: [{
                kind: 'group', className: 'tree-box', w: 620, pieces: [
                    { kind: 'text', text: '~/startpage', className: 'tree-title' },
                    { kind: 'time', size: 'md', h24: true },
                    { kind: 'date', format: 'iso', className: 'tree-dim' },
                    { kind: 'searchbar' },
                    { kind: 'text', text: '.', className: 'tree-root' },
                    { kind: 'shortcuts', variant: 'tree' },
                ],
            }],
        },
    },
    {
        key: 'design-coderain', group: 'design', label: 'Code Rain', hint: 'Falling green glyphs behind the clock',
        preview: [[4, 2, 1, 10], [9, 6, 1, 14], [15, 1, 1, 8], [27, 4, 1, 16], [34, 2, 1, 12], [12, 11, 16, 6]],
        stage: {
            bg: 'coderain',
            center: [
                { kind: 'time', size: 'xl', h24: true },
                { kind: 'text', text: 'system online', className: 'term-prompt term-cursor rain-caption' },
            ],
        },
    },
    {
        key: 'design-synthwave', group: 'design', label: 'Synthwave', hint: 'Neon sun, chrome numbers, an endless grid',
        preview: [[13, 5, 14, 12], [2, 19, 36, 7], [10, 8, 20, 6]],
        stage: { bg: 'synth', align: 'top', center: [{ kind: 'time', size: 'xl' }, { kind: 'date', className: 'is-spaced' }] },
    },
    {
        key: 'design-retro', group: 'design', label: 'Retro OS', hint: 'A 90s desktop: icons, a window, a taskbar',
        preview: [[2, 2, 4, 4], [2, 8, 4, 4], [2, 14, 4, 4], [11, 6, 22, 14], [0, 25, 40, 3]],
        stage: {
            bg: 'retro',
            left: [{ kind: 'shortcuts', variant: 'icons' }],
            center: [{
                kind: 'group', className: 'r95-window', pieces: [
                    { kind: 'text', text: 'Welcome.exe', className: 'r95-title' },
                    {
                        kind: 'group', className: 'r95-body', pieces: [
                            { kind: 'greeting' },
                            { kind: 'time', size: 'lg' },
                            { kind: 'date' },
                            { kind: 'searchbar' },
                        ],
                    },
                ],
            }],
            bottom: [{
                kind: 'group', dir: 'row', className: 'r95-taskbar', pieces: [
                    { kind: 'text', text: 'Start', className: 'r95-start' },
                    { kind: 'time', size: 'sm' },
                ],
            }],
        },
    },
    {
        key: 'design-neon', group: 'design', label: 'Neon', hint: 'Glowing tubes on a brick wall',
        preview: [[15, 4, 10, 3], [8, 9, 24, 9], [12, 20, 16, 3]],
        stage: {
            bg: 'brick',
            center: [
                { kind: 'text', text: 'OPEN', className: 'neon-open' },
                { kind: 'time', size: 'xl' },
                { kind: 'greeting' },
            ],
        },
    },
    {
        key: 'design-swiss', group: 'design', label: 'Swiss', hint: 'International typographic style: a red bar and big grotesk numerals',
        preview: [[4, 3, 2, 22], [8, 4, 6, 1], [8, 7, 26, 12], [8, 21, 8, 1], [20, 21, 8, 1]],
        stage: {
            bg: 'swiss',
            center: [{
                kind: 'group', className: 'swiss-poster', pieces: [
                    { kind: 'text', text: 'zeit / time', className: 'swiss-label' },
                    { kind: 'time', size: 'xl', h24: true },
                    {
                        kind: 'group', dir: 'row', className: 'swiss-meta', pieces: [
                            { kind: 'date', format: 'week' },
                            { kind: 'date', format: 'iso' },
                            { kind: 'date' },
                        ],
                    },
                    { kind: 'text', text: 'Neue Registerkarte. Form follows function.', className: 'swiss-caption' },
                ],
            }],
        },
    },
    {
        key: 'design-bauhaus', group: 'design', label: 'Bauhaus', hint: 'Circle, square, triangle — primary colours',
        preview: [[4, 3, 12, 12], [28, 16, 9, 9], [26, 3, 9, 9], [11, 15, 18, 6]],
        stage: { bg: 'bauhaus', center: [{ kind: 'time', size: 'xl', h24: true }, { kind: 'date', className: 'is-spaced' }] },
    },
    {
        key: 'design-brutalist', group: 'design', label: 'Brutalist', hint: 'Raw HTML energy: huge type, hard borders',
        preview: [[3, 3, 34, 11], [3, 15, 14, 2], [3, 19, 24, 3], [3, 24, 8, 1], [13, 24, 8, 1]],
        stage: {
            bg: 'brutal', align: 'top',
            center: [{
                kind: 'group', className: 'brutal', pieces: [
                    { kind: 'time', size: 'xl', h24: true },
                    { kind: 'date', long: true },
                    { kind: 'searchbar' },
                    { kind: 'shortcuts', variant: 'links' },
                ],
            }],
        },
    },
    {
        key: 'design-blueprint', group: 'design', label: 'Blueprint', hint: 'The time as a technical drawing',
        preview: [[5, 4, 30, 20], [9, 7, 22, 9], [9, 17, 22, 1], [5, 20, 30, 4]],
        stage: {
            bg: 'blueprint',
            center: [{
                kind: 'group', className: 'bp-sheet', pieces: [
                    { kind: 'text', text: 'Detail A — Current time (elevation)', className: 'bp-label' },
                    { kind: 'time', size: 'xl', h24: true },
                    { kind: 'text', text: '1 day = 1440 min', className: 'bp-dim' },
                    {
                        kind: 'group', dir: 'row', className: 'bp-titleblock', pieces: [
                            { kind: 'text', text: 'Project: New Tab' },
                            { kind: 'date', format: 'iso' },
                            { kind: 'text', text: 'Scale 1:1' },
                            { kind: 'text', text: 'Sheet 1 of 1' },
                        ],
                    },
                ],
            }],
        },
    },
    {
        key: 'design-chalk', group: 'design', label: 'Chalkboard', hint: "Today's lesson, written in chalk",
        preview: [[3, 3, 34, 22], [8, 6, 12, 2], [8, 10, 22, 7], [8, 19, 16, 2]],
        stage: {
            bg: 'chalk',
            center: [{
                kind: 'group', className: 'chalk-board', pieces: [
                    { kind: 'text', text: "Today's lesson:", className: 'chalk-title' },
                    { kind: 'greeting' },
                    { kind: 'time', size: 'xl' },
                    { kind: 'date' },
                    { kind: 'text', text: '★ drink water   ★ ship it   ★ go outside', className: 'chalk-doodle' },
                ],
            }],
        },
    },
    {
        key: 'design-receipt', group: 'design', label: 'Receipt', hint: 'Your shortcuts, itemised. Total: the time.',
        preview: [[13, 1, 14, 26], [15, 3, 10, 2], [15, 7, 10, 1], [15, 9, 10, 1], [15, 11, 10, 1], [15, 16, 10, 2], [15, 21, 10, 3]],
        stage: {
            center: [{
                kind: 'group', className: 'receipt', pieces: [
                    { kind: 'text', text: 'COOLDESK MARKET', className: 'rcpt-head' },
                    { kind: 'text', text: 'open 24/7 · aisle 42 · no refunds', className: 'rcpt-sub' },
                    { kind: 'date', long: true, className: 'rcpt-sub' },
                    { kind: 'deco', className: 'rcpt-rule' },
                    { kind: 'shortcuts', variant: 'receipt' },
                    { kind: 'deco', className: 'rcpt-rule' },
                    {
                        kind: 'group', dir: 'row', className: 'rcpt-total', pieces: [
                            { kind: 'text', text: 'TOTAL TIME' },
                            { kind: 'time', size: 'sm', h24: true },
                        ],
                    },
                    { kind: 'deco', className: 'barcode' },
                    { kind: 'text', text: '* thank you for browsing *', className: 'rcpt-sub' },
                ],
            }],
        },
    },
    {
        key: 'design-boarding', group: 'design', label: 'Boarding Pass', hint: 'Departing Home, arriving The Internet',
        preview: [[3, 7, 26, 14], [29, 7, 8, 14], [6, 10, 6, 4], [21, 10, 6, 4], [6, 16, 20, 2]],
        stage: {
            center: [{
                kind: 'group', dir: 'row', className: 'ticket', pieces: [
                    {
                        kind: 'group', className: 'ticket-main', pieces: [
                            { kind: 'text', text: 'COOLDESK AIR · BOARDING PASS', className: 'ticket-airline' },
                            {
                                kind: 'group', dir: 'row', className: 'ticket-route', pieces: [
                                    { kind: 'group', className: 'ticket-cell', pieces: [{ kind: 'text', text: 'HME', className: 'ticket-code' }, { kind: 'text', text: 'Home', className: 'ticket-k' }] },
                                    { kind: 'text', text: '- - - ✈ - - -', className: 'ticket-plane' },
                                    { kind: 'group', className: 'ticket-cell is-end', pieces: [{ kind: 'text', text: 'WWW', className: 'ticket-code' }, { kind: 'text', text: 'The Internet', className: 'ticket-k' }] },
                                ],
                            },
                            {
                                kind: 'group', dir: 'row', className: 'ticket-meta', pieces: [
                                    { kind: 'group', className: 'ticket-cell', pieces: [{ kind: 'text', text: 'Departs', className: 'ticket-k' }, { kind: 'time', size: 'sm' }] },
                                    { kind: 'group', className: 'ticket-cell', pieces: [{ kind: 'text', text: 'Date', className: 'ticket-k' }, { kind: 'date', format: 'dm' }] },
                                    { kind: 'group', className: 'ticket-cell', pieces: [{ kind: 'text', text: 'Gate', className: 'ticket-k' }, { kind: 'text', text: 'T1', className: 'ticket-v' }] },
                                    { kind: 'group', className: 'ticket-cell', pieces: [{ kind: 'text', text: 'Seat', className: 'ticket-k' }, { kind: 'text', text: '42A', className: 'ticket-v' }] },
                                ],
                            },
                        ],
                    },
                    {
                        kind: 'group', className: 'ticket-stub', pieces: [
                            { kind: 'text', text: 'BOARDING', className: 'ticket-airline' },
                            { kind: 'text', text: 'HME → WWW', className: 'ticket-v' },
                            { kind: 'time', size: 'sm' },
                            { kind: 'deco', className: 'barcode' },
                        ],
                    },
                ],
            }],
        },
    },
    {
        key: 'design-aurora', group: 'design', label: 'Aurora', hint: 'Slow drifting northern lights',
        preview: [[2, 2, 18, 12], [20, 14, 18, 12], [12, 10, 16, 6]],
        stage: { bg: 'aurora', center: [{ kind: 'time', size: 'xl' }, { kind: 'greeting' }] },
    },
    {
        key: 'design-sky', group: 'design', label: 'Day Cycle', hint: 'The sky follows the clock; the sun (or moon) rides an arc',
        preview: [[6, 6, 28, 12], [24, 7, 4, 4], [12, 19, 16, 5]],
        stage: { bg: 'sky', center: [{ kind: 'skyarc' }, { kind: 'time', size: 'xl' }, { kind: 'date' }] },
    },
    {
        key: 'design-ink', group: 'design', label: 'Ink', hint: 'Washi paper, a vertical date, a red seal',
        preview: [[14, 3, 4, 22], [22, 4, 6, 6], [21, 14, 8, 2]],
        stage: {
            bg: 'washi',
            center: [{
                kind: 'group', dir: 'row', className: 'ink', pieces: [
                    { kind: 'date', format: 'ja', className: 'ink-vertical' },
                    {
                        kind: 'group', className: 'ink-side', pieces: [
                            { kind: 'text', text: '今', className: 'hanko' },
                            { kind: 'time', size: 'md', h24: true },
                        ],
                    },
                ],
            }],
        },
    },
    {
        key: 'design-progress', group: 'design', label: 'Progress', hint: 'How much of the day, week, month and year is gone',
        preview: [[8, 4, 24, 3], [8, 10, 24, 2], [8, 14, 24, 2], [8, 18, 24, 2], [8, 22, 24, 2]],
        stage: { center: [{ kind: 'time', size: 'lg' }, { kind: 'progress' }] },
    },
];

export const getVibe = (k) => OVERVIEW_VIBES.find(v => v.key === k) || null;

// Layouts rendered as a card board (Custom + every card-based vibe) —
// editable with "Customize cards". Stage start pages are fixed.
export const isBoardLayout = (k) => k === 'custom' || !!getVibe(k)?.cards;
export const isStageLayout = (k) => !!getVibe(k)?.stage;

// Picker thumbnail rects for any vibe / start page.
export const vibePreview = (v) => v.preview || cardsPreview(v.cards || []);

// Mini preview rects for a card board, scaled into the picker's 40×28 box.
export function cardsPreview(cards) {
    const cols = Math.max(1, ...cards.map(c => c.x + c.w));
    const rows = Math.max(1, ...cards.map(c => c.y + c.h));
    const unit = Math.min(36 / cols, 24 / rows);
    const ox = (40 - cols * unit) / 2;
    const oy = (28 - rows * unit) / 2;
    const gap = Math.min(1.5, unit * 0.2);
    return cards.map(c => [ox + c.x * unit + gap / 2, oy + c.y * unit + gap / 2, c.w * unit - gap, c.h * unit - gap]);
}

const isLayout = (k) => OVERVIEW_LAYOUTS.some(l => l.key === k) || !!getVibe(k);

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
    { type: 'searchbar', label: 'Search bar', single: true },
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

function loadCards(key = CARDS_KEY, defaults = DEFAULT_CARDS) {
    try {
        let v = JSON.parse(localStorage.getItem(key));
        if (!Array.isArray(v) && key !== CARDS_KEY) return defaults;
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
                    // Card colour from the ◍ chip: a hex accent or 'transparent'
                    // (Colorless), plus Colorless's darkness (0–1).
                    ...(c.color === 'transparent' || /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? { color: c.color } : {}),
                    ...(Number.isFinite(c.opacity) && c.opacity >= 0 && c.opacity <= 1 ? { opacity: c.opacity } : {}),
                };
            });
    } catch {
        return defaults;
    }
}

// `board` is 'custom' or a vibe key; each has its own stored cards.
// (CardBoard is keyed by board, so these never change for a mounted hook.)
export function useOverviewCards(board = 'custom') {
    const vibe = getVibe(board);
    const key = vibe ? `cooldesk-overview-vibe-${vibe.key.replace(/^(vibe|start|fun|design)-/, '')}` : CARDS_KEY;
    const defaults = vibe ? vibe.cards : DEFAULT_CARDS;
    const [cards, setCards] = useState(() => loadCards(key, defaults));
    const update = useCallback((next) => {
        setCards(prev => {
            const value = typeof next === 'function' ? next(prev) : next;
            try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable — won't persist */ }
            return value;
        });
    }, [key]);
    const reset = useCallback(() => update(defaults), [update, defaults]);
    return [cards, update, reset];
}
