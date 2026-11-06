/* global chrome */
import { useEffect, useRef, useState } from 'react';
import { quickSearch } from '../../../services/searchService';
import { getFaviconUrl } from '../../../utils/helpers.js';
import { useT } from '../../../shared/i18n';

// The Search vibe's centerpiece (also addable as a "Search bar" card): one big
// pill, engine chips under it, and an omnibox-style suggestion panel while
// typing. Searches run in this tab, like the omnibox; Cmd/Ctrl+Enter opens a
// new tab. "Default" hands the query to the browser's own search engine
// (chrome.search), so it follows the user's Chrome setting.
//
// Suggestions, in order:
//   1. exactly what was typed — "Search … for x" / "Go to x". It's selected by
//      default, so a plain Enter never opens a fuzzy match nobody picked.
//   2. web query suggestions from the chosen engine's suggest endpoint
//      (Google for Default/YouTube/GitHub — those have no public one).
//   3. open tabs, bookmarks, history, saved workspace links — the spotlight's
//      own index (searchService.quickSearch). An open tab switches to it.
const ENGINES = [
    { key: 'default', label: 'Default', suggest: 'google' },
    { key: 'google', label: 'Google', url: 'https://www.google.com/search?q=', suggest: 'google' },
    { key: 'ddg', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', suggest: 'ddg' },
    { key: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=', suggest: 'bing' },
    { key: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/results?search_query=', suggest: 'youtube' },
    { key: 'github', label: 'GitHub', url: 'https://github.com/search?q=', suggest: 'google' },
];
const ENGINE_KEY = 'cooldesk-search-engine';

// Each returns OpenSearch-style JSON: [query, [suggestion, …], …]. Their
// hosts are in the manifest's connect-src.
const SUGGEST_URL = {
    google: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`,
    youtube: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&ds=yt&q=${encodeURIComponent(q)}`,
    ddg: (q) => `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`,
    bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
};

const MAX_WEB = 5;
const MAX_LOCAL = 5;
const DEBOUNCE_MS = 110;
const LOCAL_TYPES = new Set(['tab', 'bookmark', 'history', 'workspace-url']);
const LOCAL_LABEL = { tab: 'Switch to tab', bookmark: 'Bookmark', history: 'History', 'workspace-url': 'Saved link' };

const hasChromeSearch = () => typeof chrome !== 'undefined' && !!chrome.search?.query;

// "example.com", "localhost:3000", "https://…" → go there instead of searching.
function asUrl(q) {
    if (/\s/.test(q)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q)) return q;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(q)) return `http://${q}`;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(q) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(q)) return `https://${q}`;
    return null;
}

const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

async function fetchWebSuggestions(engine, q, signal) {
    const make = SUGGEST_URL[engine.suggest];
    if (!make) return [];
    try {
        const res = await fetch(make(q), { signal, credentials: 'omit' });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data?.[1]) ? data[1] : [];
        return list.filter(s => typeof s === 'string' && s.toLowerCase() !== q.toLowerCase()).slice(0, MAX_WEB);
    } catch {
        return [];
    }
}

async function fetchLocal(q) {
    try {
        const rs = await quickSearch(q, 20);
        const seen = new Set();
        const out = [];
        for (const r of rs) {
            if (!LOCAL_TYPES.has(r.type) || !r.url || seen.has(r.url)) continue;
            seen.add(r.url);
            out.push(r);
            if (out.length >= MAX_LOCAL) break;
        }
        return out;
    } catch {
        return [];
    }
}

// Bring an already-open tab forward and drop this new-tab page, as the
// omnibox's "Switch to this tab" does.
async function switchToTab(tabId, url) {
    try {
        const tab = await chrome.tabs.update(tabId, { active: true });
        if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        const self = await chrome.tabs.getCurrent();
        if (self?.id != null && self.id !== tabId) chrome.tabs.remove(self.id);
    } catch {
        window.location.href = url; // tab is gone — just open the page
    }
}

function engineFor(key) {
    return ENGINES.find(e => e.key === key) || ENGINES[1];
}

export function SearchHero() {
    const t = useT();
    const [engineKey, setEngineKey] = useState(() => {
        try {
            const v = localStorage.getItem(ENGINE_KEY);
            if (ENGINES.some(e => e.key === v) && (v !== 'default' || hasChromeSearch())) return v;
        } catch { /* storage unavailable */ }
        return hasChromeSearch() ? 'default' : 'google';
    });
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [web, setWeb] = useState([]);
    const [local, setLocal] = useState([]);
    const [selected, setSelected] = useState(0);
    const inputRef = useRef(null);
    const panelRef = useRef(null);

    const engine = engineFor(engineKey);
    const engines = ENGINES.filter(e => e.key !== 'default' || hasChromeSearch());
    const term = q.trim();

    useEffect(() => { inputRef.current?.focus(); }, []);

    // Fetch suggestions for the current text (debounced; stale answers dropped).
    useEffect(() => {
        if (!term) {
            setWeb([]);
            setLocal([]);
            return;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => {
            fetchWebSuggestions(engine, term, ctrl.signal).then(list => { if (!ctrl.signal.aborted) setWeb(list); });
            fetchLocal(term).then(list => { if (!ctrl.signal.aborted) setLocal(list); });
        }, DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            ctrl.abort();
        };
    }, [term, engine]);

    // New text → the typed row is the selection again.
    useEffect(() => { setSelected(0); }, [term]);

    const typedUrl = term ? asUrl(term) : null;
    const searchLabel = engine.key === 'default' ? 'Search' : `Search ${engine.label}`;
    const items = !term ? [] : [
        typedUrl
            ? { kind: 'go', id: 'typed', text: term, url: typedUrl, title: term, sub: 'Go to site' }
            : { kind: 'search', id: 'typed', text: term, title: term, sub: `${searchLabel}` },
        // Google also suggests sites ("https://www.youtube.com/") — those
        // open the site rather than searching for the URL text.
        ...web.map(s => {
            const url = asUrl(s);
            return url
                ? { kind: 'go', id: `web:${s}`, url, title: hostOf(url), sub: 'Go to site' }
                : { kind: 'search', id: `web:${s}`, text: s, title: s, sub: null };
        }),
        ...local.map(r => ({
            kind: r.type === 'tab' && r.tabId != null ? 'tab' : 'link',
            id: `local:${r.url}`,
            url: r.url,
            tabId: r.tabId,
            title: r.title || hostOf(r.url),
            sub: `${LOCAL_LABEL[r.type] || 'Link'} · ${hostOf(r.url)}`,
            icon: getFaviconUrl(r.url, 32, r.favicon),
        })),
    ];
    const firstLocal = items.findIndex(i => i.kind === 'tab' || i.kind === 'link');
    const showPanel = open && items.length > 0;

    // Keyboard selection keeps its row in view by scrolling the panel only —
    // scrollIntoView would also scroll the page under a short window.
    useEffect(() => {
        const panel = panelRef.current;
        const row = panel?.querySelector('.search-hero-item.selected');
        if (!panel || !row) return;
        const top = row.offsetTop - panel.scrollTop;
        if (top < 0) panel.scrollTop = row.offsetTop - 6;
        else if (top + row.offsetHeight > panel.clientHeight) panel.scrollTop = row.offsetTop + row.offsetHeight - panel.clientHeight + 6;
    }, [selected]);

    const go = (url, newTab) => {
        if (newTab) window.open(url, '_blank', 'noopener');
        else window.location.href = url;
    };

    const runSearch = (text, newTab) => {
        if (engine.key === 'default' && hasChromeSearch()) {
            chrome.search.query({ text, disposition: newTab ? 'NEW_TAB' : 'CURRENT_TAB' });
            return;
        }
        go(`${engine.url || ENGINES[1].url}${encodeURIComponent(text)}`, newTab);
    };

    const activate = (item, newTab = false) => {
        if (!item) return;
        setOpen(false);
        if (item.kind === 'search') runSearch(item.text, newTab);
        else if (item.kind === 'tab' && !newTab) switchToTab(item.tabId, item.url);
        else go(item.url, newTab);
    };

    const onSubmit = (e) => {
        e.preventDefault();
        if (term) activate(items[selected] || items[0]);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setOpen(true);
            setSelected(s => (s + 1) % items.length);
        } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setOpen(true);
            setSelected(s => (s - 1 + items.length) % items.length);
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            activate(items[selected] || items[0], true);
        } else if (e.key === 'Escape') {
            if (showPanel) setOpen(false);
            else setQ('');
        }
    };

    const pickEngine = (key) => {
        setEngineKey(key);
        try { localStorage.setItem(ENGINE_KEY, key); } catch { /* won't persist */ }
        inputRef.current?.focus();
    };

    return (
        <form className={`search-hero ${showPanel ? 'is-open' : ''}`} onSubmit={onSubmit} role="search">
            <div className="search-hero-box">
                <div className="search-hero-pill">
                    <svg className="search-hero-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                        ref={inputRef}
                        className="search-hero-input"
                        value={q}
                        onChange={e => { setQ(e.target.value); setOpen(true); }}
                        onFocus={() => setOpen(true)}
                        onBlur={() => setOpen(false)}
                        onKeyDown={onKeyDown}
                        placeholder={engine.key === 'default' ? t('search.placeholder') : t('search.placeholderEngine', { engine: engine.label })}
                        autoComplete="off"
                        spellCheck={false}
                        role="combobox"
                        aria-expanded={showPanel}
                        aria-controls="search-hero-list"
                        aria-activedescendant={showPanel ? `search-hero-opt-${selected}` : undefined}
                        aria-label={t('search.label')}
                    />
                    {q && (
                        <button
                            type="button"
                            className="search-hero-clear"
                            aria-label={t('search.clear')}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setQ(''); inputRef.current?.focus(); }}
                        >
                            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                        </button>
                    )}
                </div>

                {showPanel && (
                    <div
                        className="search-hero-panel"
                        id="search-hero-list"
                        role="listbox"
                        ref={panelRef}
                        onMouseDown={e => e.preventDefault() /* keep focus in the input */}
                    >
                        {items.map((item, i) => (
                            <div key={item.id}>
                                {i === firstLocal && <div className="search-hero-group">From your browser</div>}
                                <button
                                    type="button"
                                    id={`search-hero-opt-${i}`}
                                    role="option"
                                    aria-selected={i === selected}
                                    className={`search-hero-item ${i === selected ? 'selected' : ''}`}
                                    onClick={e => activate(item, e.metaKey || e.ctrlKey)}
                                    title={item.url || item.title}
                                >
                                    <span className="search-hero-item-icon" aria-hidden="true">
                                        {item.icon ? (
                                            <img src={item.icon} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                                        ) : item.kind === 'go' ? (
                                            <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                                        )}
                                    </span>
                                    <span className="search-hero-item-text">
                                        <span className="search-hero-item-title">{item.title}</span>
                                        {item.sub && <span className="search-hero-item-sub">{item.sub}</span>}
                                    </span>
                                    {i === selected && <kbd className="search-hero-enter">↵</kbd>}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="search-hero-engines" role="radiogroup" aria-label={t('search.engine')}>
                {engines.map(e => (
                    <button
                        key={e.key}
                        type="button"
                        role="radio"
                        aria-checked={e.key === engine.key}
                        className={`search-hero-chip ${e.key === engine.key ? 'active' : ''}`}
                        onMouseDown={ev => ev.preventDefault()}
                        onClick={() => pickEngine(e.key)}
                    >
                        {e.label}
                    </button>
                ))}
            </div>
        </form>
    );
}
