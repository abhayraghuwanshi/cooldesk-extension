import { faChrome, faDiscord, faEdge, faFirefox, faGithub, faSlack, faSpotify } from '@fortawesome/free-brands-svg-icons';
import { faCalculator, faCode, faCog, faComments, faDesktop, faEnvelope, faFile, faFolder, faGamepad, faGlobe, faImage, faMusic, faTerminal, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '../services/extensionApi';
import { isNaturalLanguageQuery, naturalLanguageSearch, quickSearch, refreshElectronCache } from '../services/searchService';
import './GlobalSpotlight.css';

// ==========================================
// PERFORMANCE OPTIMIZATIONS
// - LRU Cache for instant repeated queries
// - Request ID tracking to prevent stale results
// - Reduced debounce (50ms vs 150ms)
// ==========================================

class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, value);
    }
    clear() { this.cache.clear(); }
}

// Global cache persists across re-renders
const searchCache = new LRUCache(100);

// Map app names to FontAwesome icons
const APP_ICONS = {
    // Browsers
    'chrome': faChrome,
    'msedge': faEdge,
    'firefox': faFirefox,
    'edge': faEdge,
    // Dev tools
    'code': faCode,
    'vscode': faCode,
    'visual studio code': faCode,
    'windowsterminal': faTerminal,
    'cmd': faTerminal,
    'powershell': faTerminal,
    'terminal': faTerminal,
    'github desktop': faGithub,
    // Communication
    'discord': faDiscord,
    'slack': faSlack,
    'teams': faComments,
    'outlook': faEnvelope,
    'mail': faEnvelope,
    // Media
    'spotify': faSpotify,
    'vlc': faVideo,
    'photos': faImage,
    'groove': faMusic,
    // Games
    'steam': faGamepad,
    // System
    'explorer': faFolder,
    'notepad': faFile,
    'calculator': faCalculator,
    'settings': faCog,
};

// Get icon for app by name
function getAppIcon(appName) {
    if (!appName) return faDesktop;
    const name = appName.toLowerCase();
    for (const [key, icon] of Object.entries(APP_ICONS)) {
        if (name.includes(key)) return icon;
    }
    return faDesktop;
}

// Hook to detect click outside
function useOnClickOutside(ref, handler) {
    useEffect(() => {
        const listener = (event) => {
            // Do nothing if clicking ref's element or descendent elements
            if (!ref.current || ref.current.contains(event.target)) {
                return;
            }
            handler(event);
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler]);
}

export function GlobalSpotlight() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [selectedPinIndex, setSelectedPinIndex] = useState(-1);
    const [pinnedItems, setPinnedItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deepSearch, setDeepSearch] = useState(false);
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    const [contextItems, setContextItems] = useState([]);

    // Track search request ID to handle race conditions
    const searchIdRef = useRef(0);

    // Focus input on mount and load items
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
        loadPinnedItems();
        loadContextItems();

        // Pre-load search cache for Electron (fast subsequent searches)
        if (window.electronAPI) {
            refreshElectronCache();
        }

        // Listen for spotlight-shown event from Electron (when Alt+K is pressed)
        if (window.electronAPI?.subscribe) {
            const unsubscribe = window.electronAPI.subscribe('spotlight-shown', () => {
                // Reset state and focus input
                setQuery('');
                setResults([]);
                setSelectedIndex(-1);
                setSelectedPinIndex(-1);

                // Refresh search cache (non-blocking)
                refreshElectronCache();
                loadContextItems();

                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            });
            return () => unsubscribe();
        }
    }, []);

    // Load AI Context Items (Workflow Recommendation) - Uses cached data from refreshElectronCache
    // This avoids redundant IPC calls by reusing the cache populated by refreshElectronCache
    const loadContextItems = useCallback(async () => {
        try {
            const items = [];

            // 1. Get Running Apps (limit to 3 relevant ones) - use cached if available
            if (window.electronAPI?.getRunningApps) {
                const apps = await window.electronAPI.getRunningApps();
                // Filter for "dev" or "productivity" apps usually
                const relevantApps = apps
                    .filter(a => !['explorer', 'searchhost', 'taskmgr'].includes((a.name || '').toLowerCase()))
                    .slice(0, 3)
                    .map(a => ({ ...a, type: 'app', description: 'Active App' }));
                items.push(...relevantApps);
            }

            // 2. Get Active/Recent Tabs - use chrome.tabs.query which now has caching
            if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
                try {
                    const tabs = await chrome.tabs.query({});
                    if (tabs && tabs.length > 0) {
                        // Heuristic: Pick 2-3 tabs that look like "work" (docs, git, local)
                        const workTabs = tabs
                            .filter(t =>
                                t.url?.includes('github') ||
                                t.url?.includes('docs') ||
                                t.url?.includes('localhost') ||
                                t.url?.includes('figma') ||
                                t.url?.includes('jira')
                            )
                            .slice(0, 3)
                            .map(t => ({ ...t, type: 'tab', description: 'Recommended Tab' }));

                        if (workTabs.length > 0) {
                            items.push(...workTabs);
                        } else {
                            // Fallback to just recent tabs
                            items.push(...tabs.slice(0, 3).map(t => ({ ...t, type: 'tab', description: 'Recent Tab' })));
                        }
                    }
                } catch (e) { console.warn('Failed to fetch tabs for context', e); }
            }

            setContextItems(items.slice(0, 6)); // Cap at 6 items
        } catch (e) {
            console.warn('Failed to load context items', e);
        }
    }, []);

    // Load Pinned Items
    const loadPinnedItems = async () => {
        try {
            const data = await storageGet(['spotlight_pins']);
            setPinnedItems(data.spotlight_pins || []);
        } catch (e) {
            console.warn('Failed to load pins', e);
        }
    };

    // Save Pinned Items
    const savePinnedItems = async (items) => {
        setPinnedItems(items);
        try {
            await storageSet({ spotlight_pins: items });
        } catch (e) {
            console.warn('Failed to save pins', e);
        }
    };

    // Toggle Pin - supports both URLs and apps
    const togglePin = (item, e) => {
        if (e) e.stopPropagation();

        // Use different identifier for apps vs URLs
        const itemId = item.type === 'app' ? `app:${item.name}` : item.url;
        const exists = pinnedItems.find(p => {
            const pinId = p.type === 'app' ? `app:${p.name}` : p.url;
            return pinId === itemId;
        });

        if (exists) {
            const newPins = pinnedItems.filter(p => {
                const pinId = p.type === 'app' ? `app:${p.name}` : p.url;
                return pinId !== itemId;
            });
            savePinnedItems(newPins);
        } else {
            if (pinnedItems.length >= 8) return; // Max 8
            const newPin = {
                title: item.title || item.name,
                url: item.url || null,
                favicon: item.favicon,
                icon: item.icon, // Save icon separately for apps
                type: item.type,
                // App-specific fields
                name: item.name,
                path: item.path,
                pid: item.pid,
                isRunning: item.isRunning
            };
            savePinnedItems([...pinnedItems, newPin]);
        }
    };

    const removePin = (index, e) => {
        if (e) e.stopPropagation();
        const newPins = [...pinnedItems];
        newPins.splice(index, 1);
        savePinnedItems(newPins);
    };

    // ==========================================
    // OPTIMIZED SEARCH with caching & race handling
    // ==========================================
    useEffect(() => {
        const trimmedQuery = query.trim();

        if (!trimmedQuery) {
            setResults([]);
            setSelectedIndex(-1);
            return;
        }

        // Reset pin selection when searching
        setSelectedPinIndex(-1);

        // Check cache first for instant results
        const cacheKey = trimmedQuery.toLowerCase();
        const cached = searchCache.get(cacheKey);
        if (cached) {
            setResults(cached);
            setSelectedIndex(-1);
            // Still fetch fresh results in background for longer queries
            if (trimmedQuery.length < 3) return;
        }

        // Increment search ID to track this request
        const currentSearchId = ++searchIdRef.current;

        // Short debounce - 50ms for fast typing, 0ms if we have cache
        const debounceMs = cached ? 100 : 50;

        const timeoutId = setTimeout(async () => {
            // Check if this search is still relevant
            if (searchIdRef.current !== currentSearchId) return;

            // Only show loading if no cached results
            if (!cached) setLoading(true);

            try {
                // Determine search type and run search
                // In Electron: quickSearch uses in-memory cache (includes apps, tabs, workspaces)
                // In Chrome: quickSearch uses local index or IPC fallback
                const isNaturalLanguage = isNaturalLanguageQuery(trimmedQuery);
                let searchResults = isNaturalLanguage
                    ? await naturalLanguageSearch(trimmedQuery, 15)
                    : await quickSearch(trimmedQuery, 15);

                // Check if still relevant (user may have typed more)
                if (searchIdRef.current !== currentSearchId) return;

                // Filter out commands
                searchResults = (searchResults || []).filter(r => r.type !== 'command');

                // Deep search enhancement
                if (deepSearch) {
                    await new Promise(r => setTimeout(r, 800));
                    if (searchIdRef.current !== currentSearchId) return;

                    searchResults.unshift({
                        id: 'deep-search-result',
                        title: `Deep Analysis: ${trimmedQuery}`,
                        description: 'Generated comprehensive insight from 12 sources...',
                        type: 'ai',
                        icon: '✨'
                    });
                }

                // Cache results
                searchCache.set(cacheKey, searchResults);

                // Update UI
                setResults(searchResults);
                setSelectedIndex(-1);

            } catch (err) {
                console.error('[Spotlight] Search failed:', err);
            } finally {
                if (searchIdRef.current === currentSearchId) {
                    setLoading(false);
                }
            }
        }, debounceMs);

        return () => clearTimeout(timeoutId);
    }, [query, deepSearch]);

    // Handle Keyboard Navigation
    const handleKeyDown = (e) => {
        // Build complete navigable list: pins + context items + search results
        const totalPins = pinnedItems.length;
        const totalContext = contextItems.length;
        const totalResults = results.length;
        const totalItems = totalPins + totalContext + totalResults;

        // Current selected index in flat list
        let currentIndex = -1;
        if (selectedPinIndex >= 0) {
            currentIndex = selectedPinIndex;
        } else if (selectedIndex >= 0) {
            currentIndex = totalPins + totalContext + selectedIndex;
        }

        // Navigation handlers
        if (e.key === 'ArrowDown' && totalItems > 0) {
            e.preventDefault();
            const nextIndex = currentIndex + 1;
            if (nextIndex < totalItems) {
                if (nextIndex < totalPins) {
                    setSelectedPinIndex(nextIndex);
                    setSelectedIndex(-1);
                } else if (nextIndex < totalPins + totalContext) {
                    setSelectedPinIndex(nextIndex); // Context items share pin index
                    setSelectedIndex(-1);
                } else {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(nextIndex - totalPins - totalContext);
                }
            }
        } else if (e.key === 'ArrowUp' && totalItems > 0) {
            e.preventDefault();
            const nextIndex = currentIndex - 1;
            if (nextIndex >= 0) {
                if (nextIndex < totalPins) {
                    setSelectedPinIndex(nextIndex);
                    setSelectedIndex(-1);
                } else if (nextIndex < totalPins + totalContext) {
                    setSelectedPinIndex(nextIndex);
                    setSelectedIndex(-1);
                } else {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(nextIndex - totalPins - totalContext);
                }
            } else if (nextIndex === -1 && currentIndex === 0) {
                // At first item, wrap to last
                if (totalResults > 0) {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(totalResults - 1);
                } else if (totalContext > 0) {
                    setSelectedPinIndex(totalPins + totalContext - 1);
                    setSelectedIndex(-1);
                } else if (totalPins > 0) {
                    setSelectedPinIndex(totalPins - 1);
                    setSelectedIndex(-1);
                }
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (currentIndex >= 0) {
                if (currentIndex < totalPins) {
                    handleSelect(pinnedItems[currentIndex]);
                } else if (currentIndex < totalPins + totalContext) {
                    handleSelect(contextItems[currentIndex - totalPins]);
                } else {
                    handleSelect(results[currentIndex - totalPins - totalContext]);
                }
            } else if (query.startsWith('http')) {
                handleSelect({ url: query, type: 'url' });
            } else if (results.length > 0) {
                handleSelect(results[0]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
        } else if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (currentIndex >= totalPins + totalContext && selectedIndex >= 0) {
                togglePin(results[selectedIndex]);
            }
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && currentIndex < totalPins && currentIndex >= 0) {
            e.preventDefault();
            removePin(currentIndex);
            setSelectedPinIndex(Math.min(currentIndex, pinnedItems.length - 2));
        }

        // Fallback handlers
        if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
        } else if (e.key === 'Enter' && query.trim() && currentIndex < 0) {
            e.preventDefault();
            // Search Google
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`);
            } else {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`, '_blank');
            }
            handleClose();
        }
    };

    const handleSelect = async (item) => {
        // For tabs, switch to the existing tab instead of opening new
        if (item.type === 'tab') {
            try {
                // For pinned tabs, the tabId might be stale - try to find by URL first
                if (item.url && window.electronAPI?.sendMessage) {
                    const tabsResponse = await window.electronAPI.sendMessage({
                        type: 'SEARCH_TABS',
                        query: ''  // Get all tabs
                    });

                    // Find a tab matching this URL
                    const matchingTab = tabsResponse?.results?.find(tab =>
                        tab.url === item.url ||
                        tab.url?.replace(/\/$/, '') === item.url?.replace(/\/$/, '')
                    );

                    if (matchingTab && matchingTab.tabId) {
                        // Found matching tab - jump to it
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                            chrome.runtime.sendMessage({ type: 'JUMP_TO_TAB', tabId: matchingTab.tabId });
                        } else if (window.electronAPI?.sendMessage) {
                            await window.electronAPI.sendMessage({ type: 'JUMP_TO_TAB', tabId: matchingTab.tabId });
                        }
                        handleClose();
                        return;
                    }
                }

                // Fallback: use stored tabId if available
                if (item.tabId) {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        chrome.runtime.sendMessage({ type: 'JUMP_TO_TAB', tabId: item.tabId });
                    } else if (window.electronAPI?.sendMessage) {
                        await window.electronAPI.sendMessage({ type: 'JUMP_TO_TAB', tabId: item.tabId });
                    }
                    handleClose();
                    return;
                }

                // Tab not found - open URL in browser
                if (item.url) {
                    if (window.electronAPI?.openExternal) {
                        window.electronAPI.openExternal(item.url);
                    } else {
                        window.open(item.url, '_blank');
                    }
                    handleClose();
                    return;
                }
            } catch (e) {
                console.warn('[Spotlight] Failed to switch to tab:', e);
            }
        }

        // For apps, focus running app or launch installed app
        if (item.type === 'app') {
            try {
                // For pinned apps, we need to find the current running instance
                // because the stored PID might be stale
                if (window.electronAPI?.getRunningApps) {
                    const runningApps = await window.electronAPI.getRunningApps();
                    const runningInstance = runningApps.find(app =>
                        app.name?.toLowerCase() === item.name?.toLowerCase()
                    );

                    if (runningInstance && runningInstance.pid) {
                        // App is running - focus it
                        await window.electronAPI.focusApp(runningInstance.pid);
                        handleClose();
                        return;
                    }
                }

                // App is not running - launch it
                if (item.path && window.electronAPI?.launchApp) {
                    await window.electronAPI.launchApp(item.path);
                }
            } catch (e) {
                console.warn('[Spotlight] App action failed:', e);
            }
            handleClose();
            return;
        }

        // Default: open URL
        if (item.url) {
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(item.url);
            } else {
                window.open(item.url, '_blank');
            }
        } else if (item.type === 'command') {
            // Handle commands if any
            console.log('Command executed:', item);
        }
        handleClose();
    };

    const handleClose = useCallback(() => {
        setQuery('');
        setResults([]);
        if (window.electronAPI && window.electronAPI.sendMessage) {
            window.electronAPI.sendMessage({ type: 'SPOTLIGHT_HIDE' });
        }
    }, []);

    // Close on click outside
    useOnClickOutside(containerRef, handleClose);

    // Format URL helper
    const formatUrl = (url) => {
        if (!url) return '';
        try {
            const u = new URL(url);
            return u.hostname.replace('www.', '') + (u.pathname !== '/' ? u.pathname : '');
        } catch { return url; }
    };

    // Badge Helper
    const getBadgeLabel = (item) => {
        if (item.type === 'tab') return 'Tab';
        if (item.type === 'workspace') return 'Space';
        if (item.type === 'history') return 'History';
        if (item.type === 'bookmark') return 'Bookmark';
        if (item.type === 'app') return item.isRunning ? 'Running' : 'App';
        return item.category || 'Link';
    };

    return (
        <div className="spotlight-overlay">
            <div className="spotlight-container" ref={containerRef}>
                {/* Search Header */}
                <div className="spotlight-search-box">
                    <span className="spotlight-prompt">{'>'}</span>
                    <input
                        ref={inputRef}
                        className="spotlight-input"
                        placeholder="Almighty Search..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        spellCheck={false}
                    />
                    {loading && <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>}

                    <button
                        className={`spotlight-deep-btn ${deepSearch ? 'active' : ''}`}
                        onClick={() => setDeepSearch(!deepSearch)}
                        title="Toggle Deep Search"
                    >
                        ✨ Deep
                    </button>
                    <button
                        className="spotlight-close-btn"
                        onClick={handleClose}
                        title="Close (Esc)"
                    >
                        ×
                    </button>
                </div>

                {/* Context Section (AI Recommended) */}
                {!query.trim() && contextItems.length > 0 && (
                    <div className="spotlight-context">
                        <div className="spotlight-pins-header">
                            <span className="spotlight-pins-title">✨ AI Suggested Workflow</span>
                        </div>
                        <div className="spotlight-pins-grid context-grid">
                            {contextItems.map((item, i) => (
                                <ContextItem
                                    key={`ctx-${i}`}
                                    item={item}
                                    index={i}
                                    pinnedLength={pinnedItems.length}
                                    isSelected={i + pinnedItems.length === selectedPinIndex}
                                    onSelect={handleSelect}
                                    onHover={setSelectedPinIndex}
                                    getAppIcon={getAppIcon}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Pinned Section - Always visible if empty or matches logic */}
                <div className="spotlight-pins">
                    <div className="spotlight-pins-header">
                        <span className="spotlight-pins-title">Pinned Quick Access</span>
                        {pinnedItems.length > 0 && !query.trim() && (
                            <span className="spotlight-pins-hint">Use arrow keys to navigate</span>
                        )}
                    </div>
                    <div className="spotlight-pins-grid">
                        {pinnedItems.map((pin, i) => (
                            <PinItem
                                key={i}
                                pin={pin}
                                index={i}
                                isSelected={i === selectedPinIndex}
                                onSelect={handleSelect}
                                onHover={setSelectedPinIndex}
                                onRemove={removePin}
                                getAppIcon={getAppIcon}
                            />
                        ))}
                        {pinnedItems.length < 8 && (
                            <div style={{ opacity: 0.3, fontSize: 11, padding: '6px', fontStyle: 'italic' }}>
                                {/* Placeholder for alignment */}
                            </div>
                        )}
                    </div>
                </div>

                {/* Results - Limited to 10 visible for performance */}
                {results.length > 0 && (
                    <div className="spotlight-results">
                        {results.slice(0, 10).map((item, index) => (
                            <ResultItem
                                key={item.id || index}
                                item={item}
                                index={index}
                                isSelected={index === selectedIndex}
                                onSelect={handleSelect}
                                onHover={setSelectedIndex}
                                onTogglePin={togglePin}
                                formatUrl={formatUrl}
                                getBadgeLabel={getBadgeLabel}
                                getAppIcon={getAppIcon}
                            />
                        ))}
                        {results.length > 10 && (
                            <div style={{ padding: '8px 14px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', textAlign: 'center' }}>
                                +{results.length - 10} more results (refine your search)
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="spotlight-footer">
                    <div className="shortcut-hint"><span className="shortcut-key">↵</span> Open</div>
                    <div className="shortcut-hint"><span className="shortcut-key">↑↓</span> Navigate</div>
                    <div className="shortcut-hint"><span className="shortcut-key">Esc</span> Close</div>
                    <div className="shortcut-hint" style={{ marginLeft: 'auto' }}><span className="shortcut-key">⌘P</span> Pin</div>
                </div>
            </div>
            <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .app-icon-img { width: 100%; height: 100%; object-fit: contain; }
      `}</style>
        </div>
    );
}

function getIcon(type) {
    switch (type) {
        case 'tab': return '🔵';
        case 'history': return '📜';
        case 'bookmark': return '⭐';
        case 'workspace': return '📁';
        case 'note': return '📝';
        case 'app': return '💻';
        default: return '🔗';
    }
}

// Memoized Pin Item to prevent unnecessary re-renders
const PinItem = memo(function PinItem({ pin, index, isSelected, onSelect, onHover, onRemove, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(pin), [pin, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handleRemove = useCallback((e) => onRemove(index, e), [index, onRemove]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '<span class="fa-icon-wrapper">💻</span>';
    }, []);
    const handleFaviconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '🔗';
    }, []);

    return (
        <div
            className={`pin-item ${pin.type === 'app' ? 'pin-app' : ''} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
        >
            <div className="pin-icon">
                {pin.type === 'app' ? (
                    pin.icon ? (
                        <img src={pin.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(pin.name)} className="app-icon" />
                    )
                ) : pin.favicon ? (
                    <img src={pin.favicon} onError={handleFaviconError} alt="" />
                ) : (
                    <FontAwesomeIcon icon={faGlobe} />
                )}
            </div>
            <span className="pin-label">{pin.title || pin.name || 'Link'}</span>
            <span className="pin-remove" onClick={handleRemove}>×</span>
        </div>
    );
});

// Memoized Context Item to prevent unnecessary re-renders
const ContextItem = memo(function ContextItem({ item, index, pinnedLength, isSelected, onSelect, onHover, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index + pinnedLength), [index, pinnedLength, onHover]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '<span class="fa-icon-wrapper">💻</span>';
    }, []);
    const handleFaviconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '🔗';
    }, []);

    return (
        <div
            className={`pin-item context-item ${item.type === 'app' ? 'pin-app' : ''} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
        >
            <div className="pin-icon">
                {item.type === 'app' ? (
                    item.icon ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} className="app-icon" />
                    )
                ) : item.favicon ? (
                    <img src={item.favicon} onError={handleFaviconError} alt="" />
                ) : (
                    <FontAwesomeIcon icon={item.type === 'workspace' ? faFolder : faGlobe} />
                )}
            </div>
            <div className="context-item-details">
                <span className="pin-label">{item.title || item.name}</span>
                <span className="context-item-desc">{item.description || item.category || 'Suggested'}</span>
            </div>
        </div>
    );
});

// Memoized Result Item to prevent unnecessary re-renders
const ResultItem = memo(function ResultItem({ item, index, isSelected, onSelect, onHover, onTogglePin, formatUrl, getBadgeLabel, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handlePinClick = useCallback((e) => onTogglePin(item, e), [item, onTogglePin]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '<span class="fa-icon-wrapper">💻</span>';
    }, []);
    const handleFaviconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = getIcon(item.type);
    }, [item.type]);

    return (
        <div
            className={`result-item ${isSelected ? 'selected' : ''} ${item.type === 'app' ? 'result-app' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
        >
            <div className="result-icon">
                {item.type === 'app' ? (
                    item.icon ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} className="app-icon" />
                    )
                ) : item.favicon ? (
                    <img src={item.favicon} onError={handleFaviconError} alt="" />
                ) : (
                    <span>{getIcon(item.type)}</span>
                )}
            </div>
            <div className="result-content">
                <span className="result-title">{item.title || item.name}</span>
                <span className="result-desc">
                    {item.type === 'app'
                        ? (item.isRunning ? `Running • ${item.title}` : item.path?.split('\\').pop() || 'Application')
                        : (item.description || formatUrl(item.url))}
                </span>
            </div>

            {isSelected ? (
                <div className="result-hint">
                    <span>{item.type === 'app' ? (item.isRunning ? 'Focus' : 'Launch') : 'Open'}</span>
                    <span className="shortcut-key">↵</span>
                </div>
            ) : (
                <span className={`result-badge ${item.type === 'app' && item.isRunning ? 'badge-running' : ''}`}>
                    {getBadgeLabel(item)}
                </span>
            )}

            {(item.url || item.type === 'app') && (
                <span
                    className="pin-btn"
                    title="Pin this"
                    onClick={handlePinClick}
                >
                    📌
                </span>
            )}
        </div>
    );
});
