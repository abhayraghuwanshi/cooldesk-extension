import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUIState, saveUIState } from '../../db/index.js';
import { getFaviconUrl } from '../../utils';
import VoiceNavigation from './VoiceNavigation';

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
                    const faviconUrl = (() => {
                        try {
                            if (!b.url) return '';

                            // First try the stored favicon if it exists and is valid
                            if (b.favicon && typeof b.favicon === 'string' && /^https?:\/\//i.test(b.favicon)) {
                                return b.favicon;
                            }

                            // Generate favicon URL using utility function
                            const generated = getFaviconUrl(b.url, 16);
                            if (generated) {
                                return generated;
                            }

                            // Fallback to domain favicon.ico
                            const u = new URL(b.url);
                            return `${u.protocol}//${u.hostname}/favicon.ico`;
                        } catch (error) {
                            console.warn('Bookmark favicon error:', { url: b.url, error });
                            return '';
                        }
                    })();
                    all.push({
                        type: 'bookmark',
                        title: b.title || b.name || b.url || '',
                        url: b.url || '',
                        favicon: faviconUrl
                    });
                }
                for (const h of history) {
                    if (!h) continue;
                    const faviconUrl = (() => {
                        try {
                            if (!h.url) return '';

                            // First try the stored favicon if it exists and is valid
                            if (h.favicon && typeof h.favicon === 'string' && /^https?:\/\//i.test(h.favicon)) {
                                return h.favicon;
                            }

                            // Generate favicon URL using utility function
                            const generated = getFaviconUrl(h.url, 16);
                            if (generated) {
                                return generated;
                            }

                            // Fallback to domain favicon.ico
                            const u = new URL(h.url);
                            return `${u.protocol}//${u.hostname}/favicon.ico`;
                        } catch (error) {
                            console.warn('History favicon error:', { url: h.url, error });
                            return '';
                        }
                    })();
                    all.push({
                        type: 'history',
                        title: h.title || h.url || '',
                        url: h.url || '',
                        favicon: faviconUrl
                    });
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
        // Open Google search in new tab
        try {
            if (chrome?.tabs?.create) {
                chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
            }
        } catch (err) {
            console.error('Open in new tab failed:', err);
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
        <div>
            <div ref={wrapRef} style={{ width: '100%', maxWidth: '584px', margin: '0 auto' }}>
                <div style={{
                    position: 'relative',
                    background: '#fff',
                    border: '1px solid #dfe1e5',
                    borderRadius: '24px',
                    padding: '0',
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: '44px',
                    boxShadow: open ? '0 2px 5px 1px rgba(64,60,67,.16)' : 'none',
                    transition: 'box-shadow 0.2s ease'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '16px',
                        color: '#9aa0a6',
                        minWidth: '20px'
                    }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                        </svg>
                    </div>
                    <input
                        ref={inputRef}
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setOpen(true); setActiveIndex(-1); }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onKeyDown}
                        type="text"
                        placeholder="Search Google or type a URL"
                        style={{
                            flex: 1,
                            border: 'none',
                            outline: 'none',
                            fontSize: '16px',
                            padding: '10px 8px',
                            background: 'transparent',
                            color: '#202124',
                            fontFamily: 'arial,sans-serif'
                        }}
                    />
                    {search && (
                        <button
                            onClick={() => { setSearch(''); inputRef.current?.focus(); }}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '8px',
                                cursor: 'pointer',
                                color: '#70757a',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                            title="Clear"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                        </button>
                    )}
                    <div style={{
                        borderLeft: '1px solid #dadce0',
                        height: '24px',
                        margin: '0 12px'
                    }}></div>
                    <button
                        onClick={() => runSearch(search)}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '8px 16px 8px 8px',
                            cursor: 'pointer',
                            color: '#4285f4',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}
                        title="Google Search"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '4px' }}>
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                    </button>
                </div>
                {showList && (() => {
                    const dropdown = (
                        <div
                            style={{
                                position: 'fixed',
                                left: `${portalPos.left}px`,
                                top: `${portalPos.top + 8}px`,
                                width: `${portalPos.width}px`,
                                zIndex: 2147483647,
                                background: '#fff',
                                borderRadius: '0 0 24px 24px',
                                boxShadow: '0 2px 5px 1px rgba(64,60,67,.16)',
                                border: '1px solid #dfe1e5',
                                borderTop: 'none',
                                maxHeight: '400px',
                                overflowY: 'auto'
                            }}
                        >
                            {recent.length === 0 && !search && (
                                <div style={{
                                    padding: '16px',
                                    color: '#70757a',
                                    fontSize: '14px',
                                    textAlign: 'center',
                                    fontFamily: 'arial,sans-serif'
                                }}>
                                    No recent searches
                                </div>
                            )}
                            {!!search && (
                                <div
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => runSearch(search)}
                                    style={{
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        borderBottom: (filtered.length || contentMatches.length) ? '1px solid #e8eaed' : 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        fontSize: '16px',
                                        color: '#202124',
                                        fontFamily: 'arial,sans-serif',
                                        transition: 'background-color 0.1s ease'
                                    }}
                                    onMouseEnter={(e) => e.target.style.background = '#f8f9fa'}
                                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#9aa0a6">
                                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                    </svg>
                                    <span>{search}</span>
                                </div>
                            )}
                            {!!search && (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                    gap: 8,
                                    padding: 12,
                                    borderBottom: filtered.length || contentMatches.length ? '1px solid #e8eaed' : 'none'
                                }}>
                                    {engines.map((e) => (
                                        <div
                                            key={e.id}
                                            onMouseDown={(ev) => ev.preventDefault()}
                                            onClick={() => openWithEngine(e.id, search)}
                                            title={`Search in ${e.name}`}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '10px 12px',
                                                cursor: 'pointer',
                                                background: '#f8f9fa',
                                                borderRadius: 8,
                                                border: '1px solid #e8eaed',
                                                transition: 'all 0.1s ease'
                                            }}
                                            onMouseEnter={(ev) => {
                                                ev.currentTarget.style.background = '#e8f0fe';
                                                ev.currentTarget.style.borderColor = '#1a73e8';
                                            }}
                                            onMouseLeave={(ev) => {
                                                ev.currentTarget.style.background = '#f8f9fa';
                                                ev.currentTarget.style.borderColor = '#e8eaed';
                                            }}
                                        >
                                            <div style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: 4,
                                                background: e.color,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: 12,
                                                color: 'white',
                                                fontWeight: '500'
                                            }}>
                                                <span>{e.icon}</span>
                                            </div>
                                            <div style={{
                                                fontSize: 13,
                                                color: '#202124',
                                                fontWeight: '400',
                                                fontFamily: 'arial,sans-serif'
                                            }}>
                                                Search in {e.name}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {filtered.map((item, idx) => (
                                <div
                                    key={item}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => runSearch(item)}
                                    style={{
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        background: idx === activeIndex ? '#f8f9fa' : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        fontSize: '16px',
                                        color: '#202124',
                                        fontFamily: 'arial,sans-serif',
                                        transition: 'background-color 0.1s ease'
                                    }}
                                    onMouseEnter={(e) => e.target.style.background = '#f8f9fa'}
                                    onMouseLeave={(e) => e.target.style.background = idx === activeIndex ? '#f8f9fa' : 'transparent'}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#70757a">
                                        <path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z" />
                                    </svg>
                                    <span>{item}</span>
                                </div>
                            ))}
                            {contentMatches.length > 0 && (
                                <div style={{
                                    borderTop: '1px solid #e8eaed',
                                    paddingTop: '8px'
                                }}>
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
                                            style={{
                                                padding: '12px 16px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                fontSize: '16px',
                                                color: '#202124',
                                                fontFamily: 'arial,sans-serif',
                                                transition: 'background-color 0.1s ease'
                                            }}
                                            title={m.url}
                                            onMouseEnter={(e) => e.target.style.background = '#f8f9fa'}
                                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                        >
                                            <div style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: 4,
                                                background: '#f8f9fa',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                border: '1px solid #e8eaed'
                                            }}>
                                                {m.favicon ? (
                                                    <img
                                                        src={m.favicon}
                                                        alt=""
                                                        width={16}
                                                        height={16}
                                                        style={{ borderRadius: 2 }}
                                                        onError={(e) => {
                                                            e.target.style.display = 'none';
                                                            e.target.parentElement.innerHTML = m.type === 'bookmark' ? '🔖' : '🕘';
                                                        }}
                                                    />
                                                ) : (
                                                    <span style={{ fontSize: '12px', color: '#5f6368' }}>
                                                        {m.type === 'bookmark' ? '🔖' : '🕘'}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '16px',
                                                    color: '#1a0dab'
                                                }}>
                                                    {m.title || m.url}
                                                </div>
                                                <div style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '14px',
                                                    color: '#5f6368',
                                                    marginTop: '2px'
                                                }}>
                                                    {m.url}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                    return createPortal(dropdown, document.body);
                })()}
            </div>
            <div style={{ marginTop: '20px', width: '100%', maxWidth: '584px', margin: '20px auto 0' }}>
                <VoiceNavigation />
            </div>
        </div>
    );
}
