/* global chrome */
// The web search engines CoolDesk can search with and pull query suggestions
// from. Shared by the new tab's search box (SearchHero), the spotlight, and
// the Settings windows, so the engine picked in one place is used everywhere
// that reads the same storage (the extension's pages share one origin, the
// desktop app's windows share another).
//
// Every suggest endpoint returns OpenSearch-style JSON: [query, [suggestion, …]].
// In the desktop app they're fetched by the `web_suggest` Tauri command (none
// of them send CORS headers); the extension fetches them itself — their hosts
// are in the manifest's connect-src. Keep the `suggest` keys in step with the
// match in web_suggest (src-tauri/src/lib.rs).

export const SEARCH_ENGINES = [
    // Hands the query to the browser's own engine (chrome.search) — extension only.
    { key: 'default', label: 'Default', suggest: 'google' },
    { key: 'google', label: 'Google', url: 'https://www.google.com/search?q=', suggest: 'google' },
    { key: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=', suggest: 'bing' },
    { key: 'ddg', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', suggest: 'ddg' },
    { key: 'brave', label: 'Brave', url: 'https://search.brave.com/search?q=', suggest: 'brave' },
    { key: 'ecosia', label: 'Ecosia', url: 'https://www.ecosia.org/search?q=', suggest: 'ecosia' },
    { key: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/results?search_query=', suggest: 'youtube' },
    // GitHub has no public suggest endpoint — Google's is close enough.
    { key: 'github', label: 'GitHub', url: 'https://github.com/search?q=', suggest: 'google' },
];

const SUGGEST_URL = {
    google: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`,
    youtube: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&ds=yt&q=${encodeURIComponent(q)}`,
    bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
    ddg: (q) => `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`,
    brave: (q) => `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`,
    ecosia: (q) => `https://ac.ecosia.org/autocomplete?type=list&q=${encodeURIComponent(q)}`,
};

const ENGINE_KEY = 'cooldesk-search-engine';
const SUGGEST_ENABLED_KEY = 'cooldesk-web-suggestions';

const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
export const hasChromeSearch = () => typeof chrome !== 'undefined' && !!chrome.search?.query;

const fallbackEngineKey = () => (hasChromeSearch() ? 'default' : 'google');

/** Engines that work here ("Default" needs chrome.search). */
export function availableEngines() {
    return SEARCH_ENGINES.filter(e => e.key !== 'default' || hasChromeSearch());
}

export function engineFor(key) {
    return availableEngines().find(e => e.key === key)
        || SEARCH_ENGINES.find(e => e.key === fallbackEngineKey());
}

export function getEngineKey() {
    try {
        const v = localStorage.getItem(ENGINE_KEY);
        if (availableEngines().some(e => e.key === v)) return v;
    } catch { /* storage unavailable */ }
    return fallbackEngineKey();
}

export function setEngineKey(key) {
    try { localStorage.setItem(ENGINE_KEY, key); } catch { /* won't persist */ }
}

/** Whether to fetch suggestions while typing. On unless turned off. */
export function getWebSuggestEnabled() {
    try { return localStorage.getItem(SUGGEST_ENABLED_KEY) !== 'off'; } catch { return true; }
}

export function setWebSuggestEnabled(on) {
    try { localStorage.setItem(SUGGEST_ENABLED_KEY, on ? 'on' : 'off'); } catch { /* won't persist */ }
}

/** The engine's results page for `q`; "Default" with no chrome.search → Google. */
export function searchUrl(engineKey, q) {
    const engine = engineFor(engineKey);
    const base = engine.url || SEARCH_ENGINES.find(e => e.key === 'google').url;
    return `${base}${encodeURIComponent(q)}`;
}

/**
 * Query suggestions for `q` from the engine's suggest feed, minus the query
 * itself. Best-effort: an error, a timeout or an abort is just [].
 */
export async function fetchWebSuggestions(engineKey, q, { signal, max = 5 } = {}) {
    const term = (q || '').trim();
    const suggest = engineFor(engineKey).suggest;
    if (!term || !SUGGEST_URL[suggest]) return [];
    try {
        let list;
        if (isTauri()) {
            const { invoke } = await import('@tauri-apps/api/core');
            list = await invoke('web_suggest', { query: term, engine: suggest });
        } else {
            const res = await fetch(SUGGEST_URL[suggest](term), { signal, credentials: 'omit' });
            if (!res.ok) return [];
            const data = await res.json();
            list = data?.[1];
        }
        if (signal?.aborted || !Array.isArray(list)) return [];
        const lower = term.toLowerCase();
        return list.filter(s => typeof s === 'string' && s.toLowerCase() !== lower).slice(0, max);
    } catch {
        return [];
    }
}
