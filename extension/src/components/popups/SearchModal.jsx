import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUIState, listNotes, listWorkspaces, saveUIState } from '../../db/index.js';
import { getHostTabs } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils.js';
import { fuzzySearch } from '../../utils/searchUtils.js';
import appstoreData from '../../data/appstore.json';

const SearchModalComponent = function SearchModal({
    isOpen,
    onClose,
    search,
    setSearch,
    openInSidePanel
}) {
    // Only log when modal is actually open to reduce noise
    if (isOpen) {
        console.log('[SearchModal] Component rendered, isOpen:', isOpen);
    }

    const [recent, setRecent] = useState([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [contentMatches, setContentMatches] = useState([]);
    const [notesMatches, setNotesMatches] = useState([]);
    const [dailyNotesMatches, setDailyNotesMatches] = useState([]);
    const [workspaceMatches, setWorkspaceMatches] = useState([]);
    const [appStoreMatches, setAppStoreMatches] = useState([]);
    const inputRef = useRef(null);
    const dataRef = useRef({ list: [] });
    const notesRef = useRef({ notes: [], dailyNotes: [] });
    const workspacesRef = useRef([]);

    const engines = [
        { id: 'google', name: 'Google', color: '#4285F4', icon: 'G', favicon: getFaviconUrl('https://www.google.com'), buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`, supportsQuery: true },
        { id: 'perplexity', name: 'Perplexity', color: '#6B5BFF', icon: '🌀', favicon: getFaviconUrl('https://www.perplexity.ai'), buildUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`, supportsQuery: true },
        { id: 'chatgpt', name: 'ChatGPT', color: '#10A37F', icon: '🤖', favicon: getFaviconUrl('https://chat.openai.com'), buildUrl: () => 'https://chat.openai.com/', supportsQuery: false },
        { id: 'grok', name: 'Grok', color: '#000000', icon: '𝕏', favicon: getFaviconUrl('https://grok.com'), buildUrl: (q) => `https://grok.com/?q=${encodeURIComponent(q)}`, supportsQuery: true },
    ];

    const appStoreCatalog = useMemo(() => {
        const entries = [];
        if (appstoreData && typeof appstoreData === 'object') {
            for (const [category, domains] of Object.entries(appstoreData)) {
                if (!Array.isArray(domains)) continue;
                domains.forEach((domain) => {
                    if (!domain) return;
                    entries.push({
                        category,
                        domain,
                        label: `${domain} (${category})`,
                        favicon: getFaviconUrl(`https://${domain}`)
                    });
                });
            }
        }
        return entries;
    }, []);

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            // Force immediate focus without delay, then retry with delay for safety
            inputRef.current.focus();
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }, 200);
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

    // Load notes and daily notes data
    useEffect(() => {
        if (!isOpen) {
            // Reset data when modal closes to prevent stale data
            notesRef.current = { notes: [], dailyNotes: [] };
            return;
        }
        console.log('[SearchModal] Loading notes and daily notes data');
        (async () => {
            try {
                // Load regular notes
                const notesResult = await listNotes();
                console.log('[SearchModal] listNotes() returned:', notesResult);
                console.log('[SearchModal] Type of result:', typeof notesResult);
                console.log('[SearchModal] Is array:', Array.isArray(notesResult));

                // Handle different possible return formats (same pattern as NotesSection)
                const notesData = notesResult?.data || notesResult || [];
                const notes = Array.isArray(notesData) ? notesData : [];

                console.log('[SearchModal] Processed notes array:', notes);
                console.log('[SearchModal] Loaded', notes?.length || 0, 'notes');
                if (notes.length > 0) {
                    console.log('[SearchModal] First few notes:', notes.slice(0, 3).map(n => ({
                        id: n.id,
                        type: n.type,
                        text: n.text?.substring(0, 50) + '...',
                        content: n.content?.substring(0, 50) + '...'
                    })));
                }

                // Load daily notes via background script (get recent notes from last 30 days)
                const timeoutMs = 5000; // 5 second timeout
                const maxRetries = 1; // Retry once if it fails
                let retries = 0;
                let lastError = null;
                let dailyNotesResponse = { ok: false, recentNotes: [] };

                while (retries <= maxRetries) {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => {
                        controller.abort();
                        console.warn('[SearchModal] Timeout waiting for daily notes data from background script');
                    }, timeoutMs);

                    dailyNotesResponse = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ type: 'getDailyNotes', limit: 30 }, (response) => {
                            clearTimeout(timeoutId);
                            if (chrome.runtime.lastError) {
                                console.error('[SearchModal] Failed to load daily notes:', chrome.runtime.lastError);
                                resolve({ ok: false, recentNotes: [] });
                            } else {
                                resolve(response || { ok: false, recentNotes: [] });
                            }
                        });
                    }).catch(error => {
                        clearTimeout(timeoutId);
                        return { ok: false, recentNotes: [], error: error.message };
                    });

                    if (dailyNotesResponse.ok) {
                        break; // Success, exit the loop
                    } else if (dailyNotesResponse.error) {
                        console.warn('[SearchModal] Failed to load daily notes (attempt ' + (retries + 1) + ' of ' + (maxRetries + 1) + '):', dailyNotesResponse.error);
                        lastError = dailyNotesResponse.error;
                        retries++;
                        // Wait a bit before retrying
                        await new Promise(resolve => setTimeout(resolve, 500 * retries));
                    } else {
                        console.warn('[SearchModal] Unexpected response format for daily notes:', dailyNotesResponse);
                        lastError = 'Unexpected response format';
                        break; // Don't retry on unexpected response
                    }
                }

                if (!dailyNotesResponse.ok) {
                    console.error('[SearchModal] Failed to load daily notes after ' + retries + ' retries:', lastError);
                }

                const dailyNotes = dailyNotesResponse.ok ? dailyNotesResponse.recentNotes || [] : [];
                console.log('[SearchModal] Loaded', dailyNotes.length, 'daily notes');

                notesRef.current = {
                    notes: notes,
                    dailyNotes: Array.isArray(dailyNotes) ? dailyNotes : []
                };
            } catch (error) {
                console.error('[SearchModal] Failed to load notes data:', error);
                notesRef.current = { notes: [], dailyNotes: [] };
            }
        })();
    }, [isOpen]);

    // Load workspaces data
    useEffect(() => {
        if (!isOpen) {
            workspacesRef.current = [];
            return;
        }
        console.log('[SearchModal] Loading workspaces data');
        (async () => {
            try {
                const workspacesResult = await listWorkspaces();
                const workspaces = Array.isArray(workspacesResult) ? workspacesResult : [];
                console.log('[SearchModal] Loaded', workspaces.length, 'workspaces');
                workspacesRef.current = workspaces;
            } catch (error) {
                console.error('[SearchModal] Failed to load workspaces:', error);
                workspacesRef.current = [];
            }
        })();
    }, [isOpen]);

    const persistRecentSearch = async (query) => {
        if (!query) return;
        try {
            const ui = await getUIState();
            const recentSearches = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
            const normalized = query.toLowerCase();
            const withoutDuplicates = recentSearches.filter((item) => typeof item === 'string' && item.toLowerCase() !== normalized);
            const updated = [query, ...withoutDuplicates].slice(0, 20);
            await saveUIState({ ...(ui || {}), recentSearches: updated });
            setRecent(updated.slice(0, 10));
        } catch (error) {
            console.error('[SearchModal] Failed to persist recent search:', error);
        }
    };

    const openWithEngine = async (engineId, query, options = {}) => {
        const engine = engines.find((item) => item.id === engineId);
        if (!engine) return;

        const trimmed = (query || '').trim();

        if (trimmed && options.persistRecent !== false) {
            await persistRecentSearch(trimmed);
            try {
                await navigator.clipboard.writeText(trimmed);
            } catch {
                // Clipboard access can fail silently; ignore.
            }
        }

        let url = '';
        try {
            if (engine.supportsQuery) {
                url = engine.buildUrl(trimmed);
            } else {
                url = engine.buildUrl();
            }
        } catch (error) {
            console.error('[SearchModal] Failed to build engine URL:', error);
            return;
        }

        try {
            if (chrome?.tabs?.update) {
                chrome.tabs.update({ url });
            } else if (chrome?.tabs?.create) {
                chrome.tabs.create({ url });
            } else {
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('[SearchModal] Failed to open engine URL:', error);
        }

        if (options.closeModal !== false) {
            onClose();
        }
    };

    const runSearch = async (query) => {
        const trimmed = (query || '').trim();
        if (!trimmed) return;
        await persistRecentSearch(trimmed);
        await openWithEngine('google', trimmed, { persistRecent: false });
    };

    // Compute matches when typing
    useEffect(() => {
        if (!isOpen) {
            setContentMatches([]);
            setNotesMatches([]);
            setDailyNotesMatches([]);
            setWorkspaceMatches([]);
            setAppStoreMatches([]);
            return;
        }

        const q = (search || '').trim();
        if (!q) {
            setContentMatches([]);
            setNotesMatches([]);
            setDailyNotesMatches([]);
            setWorkspaceMatches([]);
            setAppStoreMatches([]);
            return;
        }

        const lower = q.toLowerCase();

        const contentItems = Array.isArray(dataRef.current.list) ? dataRef.current.list : [];
        const contentResults = fuzzySearch(contentItems, q, ['title', 'url']);
        const tabMatches = contentResults.filter(item => item?.type === 'tab');
        const otherMatches = contentResults.filter(item => item?.type !== 'tab');
        const contentOut = [...tabMatches, ...otherMatches].slice(0, 12);

        const notes = Array.isArray(notesRef.current.notes) ? notesRef.current.notes : [];
        const notesOut = notes.filter((note) => {
            if (!note) return false;
            const fields = [note.title, note.text, note.content];
            return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(lower));
        }).slice(0, 8);

        const dailyNotes = Array.isArray(notesRef.current.dailyNotes) ? notesRef.current.dailyNotes : [];
        const dailyOut = dailyNotes.filter((dailyNote) => {
            if (!dailyNote) return false;
            const selections = Array.isArray(dailyNote.selections) ? dailyNote.selections : [];
            const selectionMatch = selections.some((sel) => {
                const fields = [sel?.text, sel?.title, sel?.content];
                return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(lower));
            });
            const contentMatch = typeof dailyNote.content === 'string' && dailyNote.content.toLowerCase().includes(lower);
            const dateMatch = typeof dailyNote.date === 'string' && dailyNote.date.toLowerCase().includes(lower);
            return selectionMatch || contentMatch || dateMatch;
        }).slice(0, 5);

        const workspaces = Array.isArray(workspacesRef.current) ? workspacesRef.current : [];
        const workspaceOut = workspaces.filter((workspace) => {
            if (!workspace) return false;
            const fields = [
                workspace.name,
                workspace.description,
                Array.isArray(workspace.matchedDomains) ? workspace.matchedDomains.join(' ') : '',
                Array.isArray(workspace.tags) ? workspace.tags.join(' ') : ''
            ];
            return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(lower));
        }).slice(0, 8);

        const appStoreOut = appStoreCatalog
            .filter((entry) => entry && (
                entry.domain.toLowerCase().includes(lower) ||
                entry.label.toLowerCase().includes(lower) ||
                entry.category.toLowerCase().includes(lower)
            ))
            .slice(0, 8);

        setContentMatches(contentOut);
        setNotesMatches(notesOut);
        setDailyNotesMatches(dailyOut);
        setWorkspaceMatches(workspaceOut);
        setAppStoreMatches(appStoreOut);
    }, [isOpen, search, appStoreCatalog]);

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

    // Add notes matches
    notesMatches.forEach(item => {
        allItems.push({ type: 'note', value: item });
    });

    // Add daily notes matches
    dailyNotesMatches.forEach(item => {
        allItems.push({ type: 'dailyNote', value: item });
    });

    // Add workspace matches
    workspaceMatches.forEach(value => {
        allItems.push({ type: 'workspace', value });
    });

    // Add app store matches
    appStoreMatches.forEach(value => {
        allItems.push({ type: 'appStore', value });
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
                case 'note':
                    try {
                        const note = selectedItem.value;
                        // Open note URL if available, otherwise focus side panel
                        if (note.url && chrome?.tabs?.create) {
                            chrome.tabs.create({ url: note.url });
                        } else {
                            // Focus side panel or show note content somehow
                            console.log('Selected note:', note.title, note.content);
                        }
                    } catch { }
                    onClose();
                    break;
                case 'dailyNote':
                    try {
                        const dailyNote = selectedItem.value;
                        // Open side panel to show daily note for that date
                        console.log('Selected daily note for date:', dailyNote.date);
                        // Could potentially open side panel and navigate to that date
                    } catch { }
                    onClose();
                    break;
                case 'workspace':
                    try {
                        const workspace = selectedItem.value;
                        // Open side panel and switch to workspace
                        console.log('Selected workspace:', workspace.name);
                        if (openInSidePanel) {
                            openInSidePanel(workspace.name);
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
            background: 'rgba(0, 0, 0, 0.75)',
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
        <div className="ai-card" style={{
            width: '90vw',
            maxWidth: '1200px',
            height: '70vh',
            background: 'linear-gradient(180deg, var(--surface-1) 0%, var(--surface-2) 100%)',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid var(--border-primary)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Search Input */}
            <div style={{
                padding: '20px',
                borderBottom: '1px solid var(--border-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                background: 'var(--surface-0)'
            }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary)">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                <input
                    ref={inputRef}
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setActiveIndex(-1); }}
                    onKeyDown={onKeyDown}
                    type="text"
                    placeholder="Almighty Search "
                    style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'transparent',
                        outline: 'none',
                        fontSize: '18px',
                        color: 'var(--text)',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                        fontWeight: '400'
                    }}
                />
                <button
                    onClick={onClose}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontWeight: '500',
                        transition: 'color 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.target.style.color = 'var(--text-secondary)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
                >
                    ESC
                </button>
            </div>

            {/* Search Results - Two Column Layout */}
            <div style={{
                flex: 1,
                display: 'flex',
                minHeight: 0
            }}>
                {/* Main Search Results Column */}
                <div style={{
                    flex: (notesMatches.length > 0 || dailyNotesMatches.length > 0) ? '1' : '1',
                    overflowY: 'auto',
                    borderRight: (notesMatches.length > 0 || dailyNotesMatches.length > 0) ? '1px solid var(--border-primary)' : 'none',
                    background: 'var(--surface-1)'
                }}>
                    {recent.length === 0 && !search && (
                        <div style={{
                            padding: '40px 20px',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
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
                                borderBottom: (filtered.length || contentMatches.length) ? '1px solid var(--border-primary)' : 'none',
                                color: 'var(--text)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                transition: 'background 0.2s ease',
                                background: activeIndex === 0 ? 'var(--interactive-hover)' : 'transparent'
                            }}
                            onMouseEnter={(e) => e.target.style.background = 'var(--interactive-hover)'}
                            onMouseLeave={(e) => e.target.style.background = activeIndex === 0 ? 'var(--interactive-hover)' : 'transparent'}
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
                            borderBottom: (filtered.length || contentMatches.length) ? '1px solid var(--border-primary)' : 'none'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
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
                                                background: isActive ? 'var(--interactive-hover)' : 'var(--surface-2)',
                                                borderRadius: '8px',
                                                border: `1px solid ${isActive ? 'var(--border-primary)' : 'var(--border-secondary)'}`,
                                                transition: 'all 0.2s ease',
                                                width: '40px',
                                                height: '40px'
                                            }}
                                            onMouseEnter={(ev) => {
                                                ev.target.style.background = 'var(--interactive-hover)';
                                                ev.target.style.borderColor = 'var(--border-primary)';
                                            }}
                                            onMouseLeave={(ev) => {
                                                ev.target.style.background = isActive ? 'var(--interactive-hover)' : 'var(--surface-2)';
                                                ev.target.style.borderColor = isActive ? 'var(--border-primary)' : 'var(--border-secondary)';
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
                                color: 'var(--text-muted)',
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
                                        background: idx === activeIndex ? 'var(--interactive-hover)' : 'transparent',
                                        color: 'var(--text-secondary)',
                                        borderRadius: '6px',
                                        marginBottom: '4px',
                                        paddingLeft: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        transition: 'background 0.2s ease'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--text-muted)">
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
                            borderTop: filtered.length > 0 ? '1px solid var(--border-primary)' : 'none',
                            padding: '0 20px'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
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
                                            color: 'var(--text-secondary)',
                                            borderRadius: '8px',
                                            marginBottom: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            transition: 'all 0.2s ease',
                                            background: isActive ? 'var(--interactive-hover)' : 'transparent',
                                            // Visual styling based on type using theme colors
                                            border: m.type === 'tab' ? '1px solid var(--accent-blue)' :
                                                m.type === 'bookmark' ? '1px solid var(--accent-warning)' :
                                                    '1px solid var(--border-primary)',
                                            borderLeft: m.type === 'tab' ? '3px solid var(--accent-blue)' :
                                                m.type === 'bookmark' ? '3px solid var(--accent-warning)' :
                                                    '3px solid var(--text-muted)'
                                        }}
                                        title={`${m.type === 'tab' ? 'Switch to tab' : m.type === 'bookmark' ? 'Open bookmark' : 'Open from history'}: ${m.url}`}
                                        onMouseEnter={(e) => {
                                            e.target.style.background = 'var(--interactive-hover)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.background = isActive ? 'var(--interactive-hover)' : 'transparent';
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
                                                    background: m.type === 'tab' ? 'rgba(96, 165, 250, 0.2)' :
                                                        m.type === 'bookmark' ? 'rgba(251, 191, 36, 0.2)' :
                                                            'var(--surface-3)',
                                                    color: m.type === 'tab' ? 'var(--accent-blue)' :
                                                        m.type === 'bookmark' ? 'var(--accent-warning)' :
                                                            'var(--text-muted)'
                                                }}>
                                                    {m.type === 'tab' ? 'TAB' : m.type === 'bookmark' ? 'BOOKMARK' : 'HISTORY'}
                                                </span>
                                            </div>
                                            <div style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                fontSize: '12px',
                                                color: 'var(--text-muted)',
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


                    {/* Workspace Matches */}
                    {workspaceMatches.length > 0 && (
                        <div style={{
                            borderTop: (filtered.length > 0 || contentMatches.length > 0) ? '1px solid var(--border-primary)' : 'none',
                            padding: '0 20px'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                                padding: '16px 0 12px 0',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '1px'
                            }}>
                                Workspaces
                            </div>
                            {workspaceMatches.map((workspace, i) => {
                                const enginesCount = search?.trim() ? engines.length : 0;
                                const searchCount = search?.trim() ? 1 : 0;
                                const recentCount = filtered.length;
                                const contentCount = contentMatches.length;
                                const workspaceIndex = searchCount + enginesCount + recentCount + contentCount + i;
                                const isActive = activeIndex === workspaceIndex;

                                return (
                                    <div
                                        key={`workspace-${workspace.id || workspace.name}-${i}`}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            console.log('Selected workspace:', workspace.name);
                                            if (openInSidePanel) {
                                                openInSidePanel(workspace.name);
                                            }
                                            onClose();
                                        }}
                                        style={{
                                            padding: '12px',
                                            cursor: 'pointer',
                                            color: 'var(--text-secondary)',
                                            borderRadius: '8px',
                                            marginBottom: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            transition: 'all 0.2s ease',
                                            background: isActive ? 'var(--interactive-hover)' : 'transparent',
                                            border: '1px solid var(--border-secondary)',
                                            borderLeft: '3px solid var(--accent-primary)'
                                        }}
                                        title={`Open workspace: ${workspace.name}`}
                                        onMouseEnter={(e) => {
                                            e.target.style.background = 'var(--interactive-hover)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.background = isActive ? 'var(--interactive-hover)' : 'transparent';
                                        }}
                                    >
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            background: 'var(--accent-primary)',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '12px',
                                            color: 'white',
                                            fontWeight: '600',
                                            flexShrink: 0
                                        }}>
                                            {workspace.gridType === 'ProjectGrid' ? '📂' : '🔗'}
                                        </div>
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
                                                {workspace.name}
                                                <span style={{
                                                    fontSize: '10px',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    fontWeight: '600',
                                                    textTransform: 'uppercase',
                                                    background: 'rgba(52, 199, 89, 0.2)',
                                                    color: 'var(--accent-primary)'
                                                }}>
                                                    {workspace.gridType === 'ProjectGrid' ? 'PROJECT' : 'WORKSPACE'}
                                                </span>
                                            </div>
                                            <div style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                fontSize: '12px',
                                                color: 'var(--text-muted)',
                                                marginTop: '2px'
                                            }}>
                                                {workspace.matchedDomains && workspace.matchedDomains.length > 0
                                                    ? `Contains: ${workspace.matchedDomains.slice(0, 2).join(', ')}${workspace.matchedDomains.length > 2 ? ` +${workspace.matchedDomains.length - 2} more` : ''}`
                                                    : workspace.description || `${workspace.itemCount} items`}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* App Store Matches */}
                    {appStoreMatches.length > 0 && (
                        <div style={{
                            borderTop: (filtered.length > 0 || contentMatches.length > 0 || workspaceMatches.length > 0) ? '1px solid var(--border-primary)' : 'none',
                            padding: '0 20px'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                                padding: '16px 0 12px 0',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '1px'
                            }}>
                                App Store Domains
                            </div>
                            {appStoreMatches.map((entry, i) => {
                                const enginesCount = search?.trim() ? engines.length : 0;
                                const searchCount = search?.trim() ? 1 : 0;
                                const recentCount = filtered.length;
                                const contentCount = contentMatches.length;
                                const notesCount = notesMatches.length;
                                const dailyCount = dailyNotesMatches.length;
                                const workspaceCount = workspaceMatches.length;
                                const appStoreIndex = searchCount + enginesCount + recentCount + contentCount + notesCount + dailyCount + workspaceCount + i;
                                const isActive = activeIndex === appStoreIndex;

                                const href = entry.domain.startsWith('http') ? entry.domain : `https://${entry.domain}`;

                                return (
                                    <div
                                        key={`appstore-${entry.domain}-${entry.category}-${i}`}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            try {
                                                if (chrome?.tabs?.create) {
                                                    chrome.tabs.create({ url: href });
                                                } else {
                                                    window.open(href, '_blank');
                                                }
                                            } catch { }
                                            onClose();
                                        }}
                                        style={{
                                            padding: '12px',
                                            cursor: 'pointer',
                                            color: 'var(--text-secondary)',
                                            borderRadius: '8px',
                                            marginBottom: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            transition: 'all 0.2s ease',
                                            background: isActive ? 'var(--interactive-hover)' : 'transparent',
                                            border: '1px solid var(--border-secondary)',
                                            borderLeft: '3px solid var(--accent-blue)'
                                        }}
                                        title={`Open ${entry.domain}`}
                                        onMouseEnter={(e) => {
                                            e.target.style.background = 'var(--interactive-hover)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.background = isActive ? 'var(--interactive-hover)' : 'transparent';
                                        }}
                                    >
                                        <img
                                            src={entry.favicon}
                                            alt="favicon"
                                            style={{
                                                width: '20px',
                                                height: '20px',
                                                borderRadius: '4px',
                                                objectFit: 'cover'
                                            }}
                                            onError={(ev) => {
                                                ev.target.style.display = 'none';
                                            }}
                                        />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                fontSize: '14px',
                                                fontWeight: '500'
                                            }}>
                                                {entry.domain}
                                            </div>
                                            <div style={{
                                                fontSize: '12px',
                                                color: 'var(--text-muted)'
                                            }}>
                                                Category: {entry.category}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Notes Side Panel */}
                {(notesMatches.length > 0 || dailyNotesMatches.length > 0) && (
                    <div className="ai-card" style={{
                        width: '380px',
                        flexShrink: 0,
                        overflowY: 'auto',
                        background: 'linear-gradient(180deg, var(--surface-2) 0%, var(--surface-3) 100%)',
                        borderRadius: '0 16px 16px 0',
                        borderLeft: '1px solid var(--border-primary)'
                    }}>
                        <div style={{
                            padding: '20px 16px 12px 16px',
                            borderBottom: '1px solid var(--border-primary)',
                            position: 'sticky',
                            top: 0,
                            background: 'var(--surface-1)',
                            backdropFilter: 'blur(10px)',
                            zIndex: 1
                        }}>
                            <div style={{
                                fontSize: '14px',
                                fontWeight: '600',
                                color: 'var(--text)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                                </svg>
                                Notes & Daily Notes
                                <span style={{
                                    fontSize: '12px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: 'var(--surface-3)',
                                    color: 'var(--text-secondary)'
                                }}>
                                    {notesMatches.length + dailyNotesMatches.length}
                                </span>
                            </div>
                        </div>

                        <div style={{ padding: '8px' }}>
                            {/* Notes Matches */}
                            {notesMatches.length > 0 && (
                                <div style={{ marginBottom: '16px' }}>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--text-muted)',
                                        padding: '12px 12px 8px 12px',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px'
                                    }}>
                                        Notes ({notesMatches.length})
                                    </div>
                                    {notesMatches.map((note, i) => {
                                        const enginesCount = search?.trim() ? engines.length : 0;
                                        const searchCount = search?.trim() ? 1 : 0;
                                        const recentCount = filtered.length;
                                        const contentCount = contentMatches.length;
                                        const noteIndex = searchCount + enginesCount + recentCount + contentCount + i;
                                        const isActive = activeIndex === noteIndex;

                                        return (
                                            <div
                                                key={`note-${note.id}-${i}`}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => {
                                                    try {
                                                        if (note.url && chrome?.tabs?.create) {
                                                            chrome.tabs.create({ url: note.url });
                                                        }
                                                    } catch { }
                                                    onClose();
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    margin: '4px 8px',
                                                    cursor: 'pointer',
                                                    color: 'var(--text)',
                                                    borderRadius: '6px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '6px',
                                                    transition: 'all 0.2s ease',
                                                    background: isActive ? 'var(--interactive-hover)' : 'var(--surface-4)',
                                                    border: '1px solid var(--border-secondary)',
                                                    borderLeft: '3px solid var(--accent-warning)'
                                                }}
                                                title={`Open note: ${note.title}`}
                                                onMouseEnter={(e) => {
                                                    e.target.style.background = 'var(--interactive-hover)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.background = isActive ? 'var(--interactive-hover)' : 'var(--surface-4)';
                                                }}
                                            >
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <span style={{ fontSize: '14px' }}>
                                                        {note.noteType === 'voice' || note.noteType === 'voice-text' ? '🎤' : '📝'}
                                                    </span>
                                                    <div style={{
                                                        fontSize: '13px',
                                                        fontWeight: '500',
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                        {note.title}
                                                    </div>
                                                </div>
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'var(--text-secondary)',
                                                    lineHeight: '1.4',
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden'
                                                }}>
                                                    {note.content}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Daily Notes Matches */}
                            {dailyNotesMatches.length > 0 && (
                                <div>
                                    <div style={{
                                        fontSize: '11px',
                                        color: 'var(--text-muted)',
                                        padding: '12px 12px 8px 12px',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px'
                                    }}>
                                        Daily Notes ({dailyNotesMatches.length})
                                    </div>
                                    {dailyNotesMatches.map((dailyNote, i) => {
                                        const enginesCount = search?.trim() ? engines.length : 0;
                                        const searchCount = search?.trim() ? 1 : 0;
                                        const recentCount = filtered.length;
                                        const contentCount = contentMatches.length;
                                        const notesCount = notesMatches.length;
                                        const dailyNoteIndex = searchCount + enginesCount + recentCount + contentCount + notesCount + i;
                                        const isActive = activeIndex === dailyNoteIndex;

                                        return (
                                            <div
                                                key={`daily-note-${dailyNote.date}-${i}`}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => {
                                                    console.log('Opening daily note for date:', dailyNote.date);
                                                    onClose();
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    margin: '4px 8px',
                                                    cursor: 'pointer',
                                                    color: 'var(--text)',
                                                    borderRadius: '6px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '6px',
                                                    transition: 'all 0.2s ease',
                                                    background: isActive ? 'var(--interactive-hover)' : 'var(--surface-4)',
                                                    border: '1px solid var(--border-secondary)',
                                                    borderLeft: '3px solid var(--accent-primary)'
                                                }}
                                                title={`Open daily note for ${dailyNote.date}`}
                                                onMouseEnter={(e) => {
                                                    e.target.style.background = 'var(--interactive-hover)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.background = isActive ? 'var(--interactive-hover)' : 'var(--surface-4)';
                                                }}
                                            >
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <span style={{ fontSize: '14px' }}>📅</span>
                                                    <div style={{
                                                        fontSize: '13px',
                                                        fontWeight: '500',
                                                        flex: 1
                                                    }}>
                                                        {dailyNote.date}
                                                    </div>
                                                </div>
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'var(--text-secondary)',
                                                    lineHeight: '1.4'
                                                }}>
                                                    {dailyNote.selections?.length ? `${dailyNote.selections.length} selections` : 'No selections'}
                                                    {dailyNote.content && ` • ${dailyNote.content.length > 40 ? dailyNote.content.substring(0, 40) + '...' : dailyNote.content}`}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    </div>
);

return createPortal(modal, document.body);
};

// Memoize the component to prevent unnecessary re-renders
export const SearchModal = React.memo(SearchModalComponent, (prevProps, nextProps) => {
    // Only re-render if these specific props change
    return (
        prevProps.isOpen === nextProps.isOpen &&
        prevProps.search === nextProps.search &&
        prevProps.onClose === nextProps.onClose &&
        prevProps.setSearch === nextProps.setSearch &&
        prevProps.openInSidePanel === nextProps.openInSidePanel
    );
});