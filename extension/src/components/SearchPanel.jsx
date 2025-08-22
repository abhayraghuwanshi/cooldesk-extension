import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUIState, saveUIState } from '../db';

export function SearchBox({ search, setSearch, openInSidePanel, focusSignal }) {
    const [open, setOpen] = useState(false);
    const [recent, setRecent] = useState([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [contentMatches, setContentMatches] = useState([]);
    const [portalPos, setPortalPos] = useState({ left: 0, top: 0, width: 0 });
    const wrapRef = useRef(null);
    const inputRef = useRef(null);
    const dataRef = useRef({ list: [] });

    // Focus the input when focusSignal changes (e.g., from a keyboard command)
    useEffect(() => {
        if (!inputRef.current) return;
        try { inputRef.current.focus(); inputRef.current.select?.(); } catch { }
        setOpen(true);
    }, [focusSignal]);

    useLayoutEffect(() => {
        if (!open) return undefined;
        const update = () => {
            const r = wrapRef.current ? wrapRef.current.getBoundingClientRect() : null;
            if (r) setPortalPos({ left: r.left, top: r.bottom, width: r.width });
        };
        update();
        const opts = { passive: true };
        window.addEventListener('resize', update, opts);
        window.addEventListener('scroll', update, opts);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update);
        };
    }, [open]);

    const engines = [
        {
            id: 'google',
            name: 'Google',
            color: '#4285F4',
            icon: 'G',
            buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
            supportsQuery: true,
        },
        {
            id: 'perplexity',
            name: 'Perplexity',
            color: '#6B5BFF',
            icon: '🌀',
            buildUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
            supportsQuery: true,
        },
        {
            id: 'chatgpt',
            name: 'ChatGPT',
            color: '#10A37F',
            icon: '🤖',
            buildUrl: (q) => `https://chat.openai.com/?q=${encodeURIComponent(q)}`,
            supportsQuery: false, // may not auto-fill; user might paste
        },
        {
            id: 'grok',
            name: 'Grok',
            color: '#000000',
            icon: '𝕏',
            buildUrl: (q) => `https://grok.com/?q=${encodeURIComponent(q)}`,
            supportsQuery: true,
        },
    ];

    useEffect(() => {
        (async () => {
            try {
                const ui = await getUIState();
                const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
                setRecent(rs.slice(0, 10));
            } catch { }
        })();
    }, []);

    // Load dashboardData once for content-based suggestions
    useEffect(() => {
        (async () => {
            try {
                const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
                const bookmarks = dashboardData?.bookmarks || [];
                const history = dashboardData?.history || [];
                const all = [];
                for (const b of bookmarks) {
                    if (!b) continue;
                    all.push({ type: 'bookmark', title: b.title || b.name || b.url || '', url: b.url || '' });
                }
                for (const h of history) {
                    if (!h) continue;
                    all.push({ type: 'history', title: h.title || h.url || '', url: h.url || '' });
                }
                dataRef.current.list = all;
            } catch { }
        })();
    }, []);

    useEffect(() => {
        const onClick = (e) => {
            if (!wrapRef.current) return;
            if (!wrapRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, []);

    const runSearch = async (q) => {
        const query = (q || '').trim();
        if (!query) return;
        // Save recent
        try {
            const ui = await getUIState();
            const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
            const next = [query, ...rs.filter((x) => x !== query)].slice(0, 10);
            await saveUIState({ ...ui, recentSearches: next });
            setRecent(next);
        } catch { }
        // Open in extension side panel
        try {
            await openInSidePanel(query);
        } catch (err) {
            console.error('Open in side panel failed:', err);
            // Fallback to Google
            try {
                if (chrome?.tabs?.create) {
                    chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
                }
            } catch { }
        }
        setOpen(false);
    };

    // Open a specific engine with the current query.
    // If the engine doesn't support query params, copy to clipboard first.
    const openWithEngine = async (engineId, q) => {
        const engine = engines.find(e => e.id === engineId);
        if (!engine) return;
        const query = (q || '').trim();
        if (!query) return;
        if (!engine.supportsQuery) {
            try { await navigator.clipboard.writeText(query); } catch { }
        }
        const url = engine.supportsQuery ? engine.buildUrl(query) : engine.buildUrl();
        try {
            if (chrome?.tabs?.create) chrome.tabs.create({ url });
        } catch { }
        setOpen(false);
    };

    const onKeyDown = (e) => {
        const lower = (search || '').toLowerCase();
        const list = lower ? recent.filter(r => r.toLowerCase().includes(lower)) : recent;
        if (e.key === 'ArrowDown') {
            if (list.length === 0) return;
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => (i + 1) % list.length);
        } else if (e.key === 'ArrowUp') {
            if (list.length === 0) return;
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const choice = (activeIndex >= 0 && activeIndex < list.length) ? list[activeIndex] : search;
            runSearch(choice);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    const showList = open && (search || recent.length > 0);
    const filtered = (search ? recent.filter(r => r.toLowerCase().includes((search || '').toLowerCase())) : recent);

    // Compute content matches when typing
    useEffect(() => {
        const q = (search || '').trim().toLowerCase();
        if (!q) { setContentMatches([]); return; }
        const out = [];
        for (const item of dataRef.current.list) {
            const inTitle = (item.title || '').toLowerCase().includes(q);
            const inUrl = (item.url || '').toLowerCase().includes(q);
            if (inTitle || inUrl) {
                out.push(item);
                if (out.length >= 8) break;
            }
        }
        setContentMatches(out);
    }, [search]);

    return (
        <div ref={wrapRef} style={{ width: '100%' }}>
            <input
                ref={inputRef}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOpen(true); setActiveIndex(-1); }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                type="text"
                placeholder="Search Everything..."
                className="ai-input"
            />
            {showList && (() => {
                const dropdown = (
                    <div
                        className="search-suggestions top"
                        style={{
                            position: 'fixed',
                            left: `${portalPos.left}px`,
                            top: `${portalPos.top - 50}px`,
                            width: `${portalPos.width}px`,
                            zIndex: 2147483647,
                        }}
                    >
                        {recent.length === 0 && !search && (
                            <div style={{ padding: 8, opacity: 0.7, fontSize: 12 }}>No recent searches</div>
                        )}
                        {!!search && (
                            <div
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => runSearch(search)}
                                style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: filtered.length ? '1px solid #273043' : 'none' }}
                            >
                                Search Google for "{search}"
                            </div>
                        )}
                        {!!search && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, padding: 8, borderBottom: filtered.length || contentMatches.length ? '1px solid #273043' : 'none' }}>
                                {engines.map((e) => (
                                    <div
                                        key={e.id}
                                        onMouseDown={(ev) => ev.preventDefault()}
                                        onClick={() => openWithEngine(e.id, search)}
                                        title={`Search in ${e.name}`}
                                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', background: '#0f1522', borderRadius: 6, border: '1px solid #273043' }}
                                    >
                                        <div style={{ width: 20, height: 20, borderRadius: 4, background: e.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                                            <span>{e.icon}</span>
                                        </div>
                                        <div style={{ fontSize: 12 }}>Search in {e.name}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {filtered.map((item, idx) => (
                            <div
                                key={item}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => runSearch(item)}
                                className="suggestion-item"
                                style={{
                                    padding: '8px 10px', cursor: 'pointer',
                                    background: idx === activeIndex ? '#1b2331' : 'transparent'
                                }}
                            >
                                {item}
                            </div>
                        ))}
                        {contentMatches.length > 0 && (
                            <div style={{ borderTop: '1px solid #273043' }}>
                                {contentMatches.map((m, i) => (
                                    <div
                                        key={`${m.url}-${i}`}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            try {
                                                if (chrome?.tabs?.create) chrome.tabs.create({ url: m.url });
                                            } catch { }
                                            setOpen(false);
                                        }}
                                        style={{ padding: '8px 10px', cursor: 'pointer' }}
                                        title={m.url}
                                    >
                                        <span style={{ opacity: 0.7, marginRight: 6 }}>{m.type === 'bookmark' ? '🔖' : '🕘'}</span>
                                        <span>{m.title || m.url}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
                return createPortal(dropdown, document.body);
            })()}
        </div>
    );
}
