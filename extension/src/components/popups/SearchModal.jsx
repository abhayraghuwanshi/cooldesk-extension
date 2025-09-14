import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUIState, saveUIState } from '../../db/index.js';
import { getHostTabs } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils.js';

export function SearchModal({
    isOpen,
    onClose,
    search,
    setSearch,
    openInSidePanel
}) {
    console.log('[SearchModal] Component rendered, isOpen:', isOpen);

    const [recent, setRecent] = useState([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [contentMatches, setContentMatches] = useState([]);
    const inputRef = useRef(null);
    const dataRef = useRef({ list: [] });

    const engines = [
        { id: 'google', name: 'Google', color: '#4285F4', icon: 'G', favicon: getFaviconUrl('https://www.google.com'), buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`, supportsQuery: true },
        { id: 'perplexity', name: 'Perplexity', color: '#6B5BFF', icon: '🌀', favicon: getFaviconUrl('https://www.perplexity.ai'), buildUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`, supportsQuery: true },
        { id: 'chatgpt', name: 'ChatGPT', color: '#10A37F', icon: '🤖', favicon: getFaviconUrl('https://chat.openai.com'), buildUrl: (q) => `https://chat.openai.com/?q=${encodeURIComponent(q)}`, supportsQuery: false },
        { id: 'grok', name: 'Grok', color: '#000000', icon: '𝕏', favicon: getFaviconUrl('https://grok.com'), buildUrl: (q) => `https://grok.com/?q=${encodeURIComponent(q)}`, supportsQuery: true },
    ];

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current.focus(), 100);
        }
    }, [isOpen]);

    // Load recent searches
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const ui = await getUIState();
                const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
                setRecent(rs.slice(0, 10));
            } catch { }
        })();
    }, [isOpen]);

    // Load bookmark/history data and current tabs
    useEffect(() => {
        if (!isOpen) return;
        console.log('[SearchModal] Effect triggered - loading data');
        (async () => {
            try {
                const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
                const bookmarks = dashboardData?.bookmarks || [];
                const history = dashboardData?.history || [];
                const all = [];

                // Add bookmarks
                for (const b of bookmarks) {
                    if (!b) continue;
                    all.push({ type: 'bookmark', title: b.title || b.name || b.url || '', url: b.url || '' });
                }

                // Add history
                for (const h of history) {
                    if (!h) continue;
                    all.push({ type: 'history', title: h.title || h.url || '', url: h.url || '' });
                }

                console.log('[SearchModal] About to load current tabs');
                console.log('[SearchModal] Chrome object available:', typeof chrome !== 'undefined');
                console.log('[SearchModal] Chrome.tabs available:', typeof chrome !== 'undefined' && !!chrome?.tabs);
                console.log('[SearchModal] Chrome.tabs.query available:', typeof chrome !== 'undefined' && !!chrome?.tabs?.query);

                // Add current tabs
                try {
                    let currentTabs = [];
                    const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;

                    console.log('[SearchModal] Loading current tabs, hasTabsQuery:', hasTabsQuery);

                    if (hasTabsQuery) {
                        // Chrome extension context
                        currentTabs = await new Promise((resolve, reject) => {
                            chrome.tabs.query({}, (list) => {
                                const lastErr = chrome.runtime?.lastError;
                                if (lastErr) {
                                    console.error('[SearchModal] Chrome tabs query error:', lastErr);
                                    reject(new Error(lastErr.message));
                                    return;
                                }
                                console.log('[SearchModal] Chrome tabs loaded:', list?.length || 0, 'tabs');
                                resolve(Array.isArray(list) ? list : []);
                            });
                        });
                    } else {
                        // Electron/host context
                        const res = await getHostTabs();
                        console.log('[SearchModal] Host tabs response:', res);
                        if (res.ok) {
                            currentTabs = res.tabs || [];
                            console.log('[SearchModal] Host tabs loaded:', currentTabs.length, 'tabs');
                        }
                    }

                    console.log('[SearchModal] Processing', currentTabs.length, 'tabs for search');

                    // Add current tabs to search data
                    for (const tab of currentTabs) {
                        if (!tab?.url) {
                            console.log('[SearchModal] Skipping tab without URL:', tab);
                            continue;
                        }
                        const tabItem = {
                            type: 'tab',
                            title: tab.title || tab.url || '',
                            url: tab.url,
                            tabId: tab.id,
                            windowId: tab.windowId,
                            favicon: tab.favIconUrl
                        };
                        all.push(tabItem);
                        console.log('[SearchModal] Added tab to search:', tabItem.title, tabItem.url);
                    }

                    console.log('[SearchModal] Total search items after adding tabs:', all.length);
                } catch (e) {
                    // Ignore tab loading errors to keep search working
                    console.error('[SearchModal] Failed to load current tabs for search:', e);
                }

                dataRef.current.list = all;
            } catch { }
        })();
    }, [isOpen]);

    // Compute content matches when typing
    useEffect(() => {
        if (!isOpen) return;
        const q = (search || '').trim().toLowerCase();
        if (!q) {
            setContentMatches([]);
            return;
        }

        console.log('[SearchModal] Searching for:', q);
        console.log('[SearchModal] Total items to search:', dataRef.current.list.length);

        // Debug: Show breakdown of item types
        const itemTypes = {};
        dataRef.current.list.forEach(item => {
            itemTypes[item.type] = (itemTypes[item.type] || 0) + 1;
        });
        console.log('[SearchModal] Item types in search data:', itemTypes);

        // Debug: Show first few tabs if any exist
        const tabItems = dataRef.current.list.filter(item => item.type === 'tab');
        console.log('[SearchModal] Found', tabItems.length, 'tabs in search data');
        if (tabItems.length > 0) {
            console.log('[SearchModal] First few tabs:', tabItems.slice(0, 3).map(t => ({ title: t.title, url: t.url })));
        }

        // Separate matches by priority: tabs first, then others
        const tabMatches = [];
        const otherMatches = [];

        for (const item of dataRef.current.list) {
            const inTitle = (item.title || '').toLowerCase().includes(q);
            const inUrl = (item.url || '').toLowerCase().includes(q);

            // Debug tab matching specifically
            if (item.type === 'tab') {
                console.log('[SearchModal] Checking tab:', item.title, '| URL:', item.url, '| Title match:', inTitle, '| URL match:', inUrl);
            }

            if (inTitle || inUrl) {
                console.log('[SearchModal] Match found:', item.type, item.title, item.url);

                if (item.type === 'tab') {
                    tabMatches.push(item);
                } else {
                    otherMatches.push(item);
                }
            }
        }

        // Combine results: tabs first, then others, limit to 12 total
        const out = [...tabMatches, ...otherMatches].slice(0, 12);

        console.log('[SearchModal] Total matches found:', out.length);
        console.log('[SearchModal] Tab matches:', out.filter(item => item.type === 'tab').length);
        setContentMatches(out);
    }, [search, isOpen]);

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
        onClose();
    };

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
        onClose();
    };

    const onKeyDown = (e) => {
        const lower = (search || '').toLowerCase();
        const recentFiltered = lower ? recent.filter(r => r.toLowerCase().includes(lower)) : recent;

        // Build all navigable items in order
        const allItems = [];

        // Add main search option if there's a query
        if (search?.trim()) {
            allItems.push({ type: 'search', value: search.trim() });
        }

        // Add search engines if there's a query
        if (search?.trim()) {
            engines.forEach(engine => {
                allItems.push({ type: 'engine', value: engine.id, engine });
            });
        }

        // Add recent searches
        recentFiltered.forEach(item => {
            allItems.push({ type: 'recent', value: item });
        });

        // Add content matches
        contentMatches.forEach(item => {
            allItems.push({ type: 'content', value: item });
        });

        if (e.key === 'ArrowDown') {
            if (allItems.length === 0) return;
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % allItems.length);
        } else if (e.key === 'ArrowUp') {
            if (allItems.length === 0) return;
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? allItems.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && activeIndex < allItems.length) {
                const selectedItem = allItems[activeIndex];
                switch (selectedItem.type) {
                    case 'search':
                        runSearch(selectedItem.value);
                        break;
                    case 'engine':
                        openWithEngine(selectedItem.value, search);
                        break;
                    case 'recent':
                        runSearch(selectedItem.value);
                        break;
                    case 'content':
                        try {
                            const item = selectedItem.value;
                            if (item.type === 'tab' && item.tabId) {
                                // Focus existing tab
                                const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                                if (hasTabsUpdate) {
                                    chrome.tabs.update(item.tabId, { active: true });
                                    if (item.windowId != null && chrome?.windows?.update) {
                                        chrome.windows.update(item.windowId, { focused: true });
                                    }
                                } else {
                                    // Fallback: open URL
                                    if (chrome?.tabs?.create) chrome.tabs.create({ url: item.url });
                                }
                            } else {
                                // Open bookmark/history item in new tab
                                if (chrome?.tabs?.create) chrome.tabs.create({ url: item.url });
                            }
                        } catch { }
                        onClose();
                        break;
                }
            } else if (search?.trim()) {
                runSearch(search.trim());
            }
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    const filtered = (search ? recent.filter(r => r.toLowerCase().includes((search || '').toLowerCase())) : recent);

    if (!isOpen) return null;

    const modal = (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'var(--modal-overlay, rgba(0, 0, 0, 0.7))',
                backdropFilter: 'blur(12px)',
                zIndex: 2147483647,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div style={{
                width: '60vw',
                height: '60vh',
                background: 'var(--background-secondary, rgba(20, 20, 30, 0.95))',
                backdropFilter: 'blur(20px)',
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-subtle, rgba(255, 255, 255, 0.05))',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Search Input */}
                <div style={{
                    padding: '20px',
                    borderBottom: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary, rgba(255, 255, 255, 0.6))">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                    </svg>
                    <input
                        ref={inputRef}
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setActiveIndex(-1); }}
                        onKeyDown={onKeyDown}
                        type="text"
                        placeholder="Portal"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'transparent',
                            outline: 'none',
                            fontSize: '18px',
                            color: 'var(--text-primary, rgba(255, 255, 255, 0.9))',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                            fontWeight: '400'
                        }}
                    />
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-dim, rgba(255, 255, 255, 0.5))',
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '4px',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}
                        onMouseEnter={(e) => e.target.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.8))'}
                        onMouseLeave={(e) => e.target.style.color = 'var(--text-dim, rgba(255, 255, 255, 0.5))'}
                    >
                        ESC
                    </button>
                </div>

                {/* Search Results */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    minHeight: 0
                }}>
                    {recent.length === 0 && !search && (
                        <div style={{
                            padding: '40px 20px',
                            textAlign: 'center',
                            color: 'var(--text-dim, rgba(255, 255, 255, 0.4))',
                            fontSize: '16px'
                        }}>
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                            <div>Start typing to search...</div>
                        </div>
                    )}

                    {!!search && (
                        <div
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => runSearch(search)}
                            style={{
                                padding: '16px 20px',
                                cursor: 'pointer',
                                borderBottom: (filtered.length || contentMatches.length) ? '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))' : 'none',
                                color: 'var(--text-primary, rgba(255, 255, 255, 0.9))',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                transition: 'background 0.1s ease',
                                background: activeIndex === 0 ? 'var(--surface-1, rgba(255, 255, 255, 0.05))' : 'transparent'
                            }}
                            onMouseEnter={(e) => e.target.style.background = 'var(--surface-1, rgba(255, 255, 255, 0.05))'}
                            onMouseLeave={(e) => e.target.style.background = activeIndex === 0 ? 'var(--surface-1, rgba(255, 255, 255, 0.05))' : 'transparent'}
                        >
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: 'rgba(66, 133, 244, 0.2)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="#4285F4">
                                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                </svg>
                            </div>
                            <div>
                                <div style={{ fontSize: '16px', fontWeight: '500' }}>Search Google</div>
                                <div style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.5)' }}>"{search}"</div>
                            </div>
                        </div>
                    )}

                    {!!search && (
                        <div style={{
                            padding: '0 20px',
                            borderBottom: (filtered.length || contentMatches.length) ? '1px solid rgba(255, 255, 255, 0.1)' : 'none'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--text-dim, rgba(255, 255, 255, 0.5))',
                                padding: '16px 0 12px 0',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '1px'
                            }}>
                                Search Engines
                            </div>
                            <div style={{
                                display: 'flex',
                                gap: '8px',
                                paddingBottom: '16px',
                                flexWrap: 'wrap'
                            }}>
                                {engines.map((e, idx) => {
                                    // Calculate this engine's position in the active index
                                    const engineIndex = search?.trim() ? 1 + idx : -1; // +1 for main search option
                                    const isActive = activeIndex === engineIndex;

                                    return (
                                        <div
                                            key={e.id}
                                            onMouseDown={(ev) => ev.preventDefault()}
                                            onClick={() => openWithEngine(e.id, search)}
                                            title={`Search in ${e.name}`}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                padding: '8px',
                                                cursor: 'pointer',
                                                background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                                                borderRadius: '8px',
                                                border: `1px solid ${isActive ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)'}`,
                                                transition: 'all 0.1s ease',
                                                width: '40px',
                                                height: '40px'
                                            }}
                                            onMouseEnter={(ev) => {
                                                ev.target.style.background = 'rgba(255, 255, 255, 0.08)';
                                                ev.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                            }}
                                            onMouseLeave={(ev) => {
                                                ev.target.style.background = isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)';
                                                ev.target.style.borderColor = isActive ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)';
                                            }}
                                        >
                                            <img
                                                src={e.favicon}
                                                alt={e.name}
                                                style={{
                                                    width: '24px',
                                                    height: '24px',
                                                    objectFit: 'contain',
                                                    borderRadius: '4px'
                                                }}
                                                onError={(ev) => {
                                                    // Fallback to colored background with icon text
                                                    const fallback = document.createElement('div');
                                                    fallback.style.cssText = `
                                                        width: 24px;
                                                        height: 24px;
                                                        border-radius: 4px;
                                                        background: ${e.color};
                                                        display: flex;
                                                        align-items: center;
                                                        justify-content: center;
                                                        font-size: 12px;
                                                        color: white;
                                                        font-weight: 600;
                                                    `;
                                                    fallback.textContent = e.icon;
                                                    ev.target.parentNode.replaceChild(fallback, ev.target);
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Recent Searches */}
                    {filtered.length > 0 && (
                        <div style={{ padding: '0 20px' }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'rgba(255, 255, 255, 0.5)',
                                padding: '16px 0 12px 0',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '1px'
                            }}>
                                Recent Searches
                            </div>
                            {filtered.map((item, idx) => (
                                <div
                                    key={item}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => runSearch(item)}
                                    style={{
                                        padding: '12px 0',
                                        cursor: 'pointer',
                                        background: idx === activeIndex ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                        color: 'rgba(255, 255, 255, 0.8)',
                                        borderRadius: '6px',
                                        marginBottom: '4px',
                                        paddingLeft: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255, 255, 255, 0.4)">
                                        <path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z" />
                                    </svg>
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Content Matches */}
                    {contentMatches.length > 0 && (
                        <div style={{
                            borderTop: filtered.length > 0 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                            padding: '0 20px'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'rgba(255, 255, 255, 0.5)',
                                padding: '16px 0 12px 0',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '1px'
                            }}>
                                Tabs, Bookmarks & History
                            </div>
                            {contentMatches.map((m, i) => {
                                // Calculate this item's position in the active index
                                const enginesCount = search?.trim() ? engines.length : 0;
                                const searchCount = search?.trim() ? 1 : 0;
                                const recentCount = filtered.length;
                                const contentIndex = searchCount + enginesCount + recentCount + i;
                                const isActive = activeIndex === contentIndex;

                                return (
                                    <div
                                        key={`${m.url}-${i}`}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            try {
                                                if (m.type === 'tab' && m.tabId) {
                                                    // Focus existing tab
                                                    const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                                                    if (hasTabsUpdate) {
                                                        chrome.tabs.update(m.tabId, { active: true });
                                                        if (m.windowId != null && chrome?.windows?.update) {
                                                            chrome.windows.update(m.windowId, { focused: true });
                                                        }
                                                    } else {
                                                        // Fallback: open URL
                                                        if (chrome?.tabs?.create) chrome.tabs.create({ url: m.url });
                                                    }
                                                } else {
                                                    // Open bookmark/history item in new tab
                                                    if (chrome?.tabs?.create) chrome.tabs.create({ url: m.url });
                                                }
                                            } catch { }
                                            onClose();
                                        }}
                                        style={{
                                            padding: '12px',
                                            cursor: 'pointer',
                                            color: 'rgba(255, 255, 255, 0.8)',
                                            borderRadius: '8px',
                                            marginBottom: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            transition: 'all 0.1s ease',
                                            background: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                            // Visual styling based on type
                                            border: m.type === 'tab' ? '1px solid rgba(0, 122, 255, 0.3)' :
                                                   m.type === 'bookmark' ? '1px solid rgba(255, 149, 0, 0.3)' :
                                                   '1px solid rgba(128, 128, 128, 0.2)',
                                            borderLeft: m.type === 'tab' ? '3px solid #007AFF' :
                                                      m.type === 'bookmark' ? '3px solid #FF9500' :
                                                      '3px solid #8E8E93'
                                        }}
                                        title={`${m.type === 'tab' ? 'Switch to tab' : m.type === 'bookmark' ? 'Open bookmark' : 'Open from history'}: ${m.url}`}
                                        onMouseEnter={(e) => {
                                            e.target.style.background = m.type === 'tab' ? 'rgba(0, 122, 255, 0.08)' :
                                                                       m.type === 'bookmark' ? 'rgba(255, 149, 0, 0.08)' :
                                                                       'rgba(255, 255, 255, 0.05)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.background = isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent';
                                        }}
                                    >
                                        <img
                                            src={m.favicon || getFaviconUrl(m.url)}
                                            alt="favicon"
                                            style={{
                                                width: '24px',
                                                height: '24px',
                                                objectFit: 'contain',
                                                borderRadius: '4px',
                                                flexShrink: 0
                                            }}
                                            onError={(ev) => {
                                                // Try fallback favicon from origin
                                                try {
                                                    const u = new URL(m.url);
                                                    const originFavicon = `${u.origin}/favicon.ico`;
                                                    if (ev.target.src !== originFavicon) {
                                                        ev.target.src = originFavicon;
                                                        return;
                                                    }
                                                } catch { }
                                                // If all favicon attempts fail, hide the image
                                                ev.target.style.opacity = '0.3';
                                            }}
                                        />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                {m.title || m.url}
                                                <span style={{
                                                    fontSize: '10px',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    fontWeight: '600',
                                                    textTransform: 'uppercase',
                                                    background: m.type === 'tab' ? 'rgba(0, 122, 255, 0.2)' :
                                                               m.type === 'bookmark' ? 'rgba(255, 149, 0, 0.2)' :
                                                               'rgba(128, 128, 128, 0.2)',
                                                    color: m.type === 'tab' ? '#007AFF' :
                                                          m.type === 'bookmark' ? '#FF9500' :
                                                          '#8E8E93'
                                                }}>
                                                    {m.type === 'tab' ? 'TAB' : m.type === 'bookmark' ? 'BOOKMARK' : 'HISTORY'}
                                                </span>
                                            </div>
                                            <div style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                fontSize: '12px',
                                                color: 'rgba(255, 255, 255, 0.4)',
                                                marginTop: '2px'
                                            }}>
                                                {m.url}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}