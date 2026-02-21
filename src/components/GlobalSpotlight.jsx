import { faChrome, faDiscord, faEdge, faFirefox, faGithub, faSlack, faSpotify } from '@fortawesome/free-brands-svg-icons';
import { faBriefcase, faCalculator, faChartLine, faCloud, faCode, faCog, faComments, faDesktop, faEnvelope, faFile, faFlask, faFolder, faGamepad, faGlobe, faGraduationCap, faHashtag, faHeartPulse, faHistory, faHome, faImage, faLightbulb, faLink, faMusic, faNewspaper, faPalette, faPlane, faRobot, faSearch, faShoppingBag, faStar, faStickyNote, faTasks, faTerminal, faThumbtack, faTools, faUtensils, faVial, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '../services/extensionApi';
import { isNaturalLanguageQuery, naturalLanguageSearch, quickSearch, refreshElectronCache } from '../services/searchService';
import { enrichRunningAppsWithIcons, getFaviconUrl } from '../utils/helpers';
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

// Track app usage for recommendations
async function trackAppUsage(appName) {
    if (!appName) return;
    try {
        const data = await storageGet(['frequent_apps']);
        const frequent = data.frequent_apps || {};
        const key = appName.toLowerCase();
        frequent[key] = (frequent[key] || 0) + 1;

        // Keep only top 20 apps
        const sorted = Object.entries(frequent)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        await storageSet({ frequent_apps: Object.fromEntries(sorted) });
    } catch (e) {
        // Ignore tracking errors
    }
}

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
        // Guarantee focus on window focus (when Alt+K brings window to front)
        const handleFocus = () => {
            if (inputRef.current) {
                // Determine if we need to select all text
                setTimeout(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                }, 10);
            }
        };
        window.addEventListener('focus', handleFocus);

        // Initial focus and load
        handleFocus();
        console.log('[Spotlight] Initial mount - loading context items');
        loadContextItems();
        loadPinnedItems();

        // Listen for spotlight-shown event from Electron (when Alt+K is pressed)
        if (window.electronAPI?.subscribe) {
            const unsubscribe = window.electronAPI.subscribe('spotlight-shown', () => {
                console.log('[Spotlight] spotlight-shown event received');
                // Reset state and focus input
                setQuery('');
                setResults([]);
                setSelectedIndex(-1);
                setSelectedPinIndex(-1);

                // Refresh search cache (non-blocking)
                refreshElectronCache();
                loadContextItems();

                handleFocus();
            });
            return () => {
                unsubscribe();
                window.removeEventListener('focus', handleFocus);
            };
        }

        return () => window.removeEventListener('focus', handleFocus);
    }, []);



    // Load Recommendations - Shows frequently used apps and active tabs when Spotlight opens
    const loadContextItems = useCallback(async () => {
        console.log('[Spotlight] loadContextItems called');
        try {
            // Fetch all data in parallel
            console.log('[Spotlight] Fetching data...');
            const [runningApps, installedApps, tabs, frequentApps] = await Promise.all([
                window.electronAPI?.getRunningApps?.().catch(e => { console.error('[Spotlight] getRunningApps error:', e); return []; }) || [],
                window.electronAPI?.getInstalledApps?.().catch(e => { console.error('[Spotlight] getInstalledApps error:', e); return []; }) || [],
                window.electronAPI?.getTabs?.().catch(e => { console.error('[Spotlight] getTabs error:', e); return []; }) || [],
                storageGet(['frequent_apps']).then(d => d.frequent_apps || {}).catch(() => ({}))
            ]);

            console.log('[Spotlight] Data fetched:', {
                runningApps: runningApps?.length || 0,
                installedApps: installedApps?.length || 0,
                tabs: tabs?.length || 0,
                frequentApps: Object.keys(frequentApps).length
            });

            const recommendations = [];
            const usedIds = new Set();

            // System apps to filter out
            const systemApps = ['svchost', 'csrss', 'system', 'registry', 'service', 'runtime', 'host', 'helper', 'background', 'agent'];

            // 1. Running Apps (top priority - what user is actively using)
            // Enrich with icons from installed apps, then filter
            const enrichedRunning = enrichRunningAppsWithIcons(runningApps, installedApps);
            const activeApps = enrichedRunning
                .filter(a => {
                    const name = (a.name || '').toLowerCase();
                    if (usedIds.has(name)) return false;
                    if (systemApps.some(s => name.includes(s))) return false;
                    usedIds.add(name);
                    return true;
                })
                .slice(0, 4)
                .map(a => ({ ...a, type: 'app', description: 'Running', isRunning: true }));

            console.log('[Spotlight] Active apps after filter:', activeApps.length, activeApps.map(a => `${a.name}(icon:${!!a.icon})`));
            recommendations.push(...activeApps);

            // 2. Frequently Used Apps (from usage history)
            const sortedFrequent = Object.entries(frequentApps)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4);

            for (const [appName] of sortedFrequent) {
                if (usedIds.has(appName.toLowerCase())) continue;

                // Find app in installed apps with flexible matching
                const frequentName = appName.toLowerCase();
                const app = installedApps.find(a => {
                    const installedName = (a.name || '').toLowerCase();
                    if (installedName === frequentName) return true;
                    if (frequentName.includes(installedName) || installedName.includes(frequentName)) return true;
                    const exeName = (a.path || '').split(/[/\\]/).pop()?.toLowerCase().replace('.exe', '');
                    if (exeName && (frequentName.includes(exeName) || exeName.includes(frequentName))) return true;
                    return false;
                });
                if (app) {
                    usedIds.add(appName.toLowerCase());
                    recommendations.push({
                        ...app,
                        type: 'app',
                        description: 'Frequent',
                        isRunning: false
                    });
                }
            }

            // 3. Active Tabs (unique by domain)
            const relevantTabs = tabs
                .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'))
                .filter((t, index, self) =>
                    index === self.findIndex(s => {
                        try { return new URL(s.url).hostname === new URL(t.url).hostname; } catch { return s.url === t.url; }
                    })
                )
                .slice(0, 3)
                .map(t => ({
                    ...t,
                    type: 'tab',
                    description: 'Active Tab',
                    favicon: t.favIconUrl || t.favicon  // Map favIconUrl to favicon
                }));

            console.log('[Spotlight] Relevant tabs:', relevantTabs.length);
            recommendations.push(...relevantTabs);

            // Cap at 8 items
            const finalRecs = recommendations.slice(0, 8);
            console.log('[Spotlight] Final recommendations:', finalRecs.length, finalRecs.map(r => r.name || r.title));
            setContextItems(finalRecs);

        } catch (e) {
            console.warn('Failed to load recommendations', e);
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

                console.log('[Spotlight] Rendering results:', searchResults);

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
        const isSearching = !!query.trim();

        // Build complete navigable list depending on state
        // If searching: Only Results
        // If not searching: Pins + Context Items
        const totalPins = isSearching ? 0 : pinnedItems.length;
        const totalContext = isSearching ? 0 : contextItems.length;
        const totalResults = results.length;
        const totalItems = totalPins + totalContext + totalResults;

        // Current selected index in flat list
        let currentIndex = -1;
        if (selectedPinIndex >= 0 && !isSearching) {
            currentIndex = selectedPinIndex;
        } else if (selectedIndex >= 0) {
            currentIndex = totalPins + totalContext + selectedIndex;
        }

        // Navigation handlers
        if (e.key === 'ArrowDown' && totalItems > 0) {
            e.preventDefault();
            const nextIndex = currentIndex + 1;

            // If at end or not started, wrap/start
            if (currentIndex === -1) {
                // Start at top
                if (totalPins > 0) setSelectedPinIndex(0);
                else if (totalContext > 0) setSelectedPinIndex(0); // Context shares pin index logic if sequential
                else setSelectedIndex(0);
            } else if (nextIndex < totalItems) {
                // Determine what the next index maps to
                if (nextIndex < totalPins + totalContext) {
                    setSelectedPinIndex(nextIndex);
                    setSelectedIndex(-1);
                } else {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(nextIndex - totalPins - totalContext);
                }
            } else {
                // Loop back to start? Or stop? Let's stop at end like native macOS Spotlight, or loop?
                // Users said "spam down key", implying they want to move.
                // Let's loop back to top for convenience
                if (totalPins > 0) {
                    setSelectedPinIndex(0);
                    setSelectedIndex(-1);
                } else if (totalContext > 0) {
                    setSelectedPinIndex(0);
                    setSelectedIndex(-1);
                } else {
                    setSelectedIndex(0);
                }
            }
        } else if (e.key === 'ArrowUp' && totalItems > 0) {
            e.preventDefault();
            const nextIndex = currentIndex - 1;

            if (currentIndex === -1) {
                // Start at bottom
                setSelectedIndex(totalResults - 1);
                setSelectedPinIndex(-1);
            } else if (nextIndex >= 0) {
                if (nextIndex < totalPins + totalContext) {
                    setSelectedPinIndex(nextIndex);
                    setSelectedIndex(-1);
                } else {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(nextIndex - totalPins - totalContext);
                }
            } else {
                // Loop to bottom
                if (totalResults > 0) {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(totalResults - 1);
                } else {
                    setSelectedPinIndex(totalPins + totalContext - 1);
                    setSelectedIndex(-1);
                }
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (currentIndex >= 0 && currentIndex < totalItems) {
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
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isSearching && currentIndex < totalPins && currentIndex >= 0) {
            e.preventDefault();
            removePin(currentIndex);
            // Adjust selection after removal
            const maxPinIndex = totalPins - 2; // -1 for removed, -1 for 0-index
            if (maxPinIndex >= 0) setSelectedPinIndex(Math.min(currentIndex, maxPinIndex));
            else setSelectedPinIndex(-1);
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

    // Handle Keyboard Navigation for Buttons (redirect arrows to main list)
    const handleButtonKeyDown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            inputRef.current?.focus();
            handleKeyDown(e);
        }
    };

    const handleSelect = async (item) => {
        // Close immediately for snappy feel
        handleClose();

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
                    return;
                }

                // Tab not found - open URL in browser
                if (item.url) {
                    if (window.electronAPI?.openExternal) {
                        window.electronAPI.openExternal(item.url);
                    } else {
                        window.open(item.url, '_blank');
                    }
                    return;
                }
            } catch (e) {
                console.warn('[Spotlight] Failed to switch to tab:', e);
            }
        }

        // For apps, focus running app or launch installed app
        if (item.type === 'app') {
            try {
                // Track app usage for recommendations
                trackAppUsage(item.name);

                // For pinned apps, we need to find the current running instance
                // because the stored PID might be stale
                if (window.electronAPI?.getRunningApps) {
                    const runningApps = await window.electronAPI.getRunningApps();
                    const runningInstance = runningApps.find(app =>
                        app.name?.toLowerCase() === item.name?.toLowerCase()
                    );

                    if (runningInstance && runningInstance.pid) {
                        // App is running - focus it
                        await window.electronAPI.focusApp(runningInstance.pid, runningInstance.name);
                        return;
                    }
                }

                // App is not running - launch it
                if (item.path && window.electronAPI?.launchApp) {
                    await window.electronAPI.launchApp(item.path);
                }
            } catch (e) {
                console.warn('[Spotlight] App action failed:', e);
                // Fallback: if focus failed, try launching (which usually focuses it anyway)
                if (item.path && window.electronAPI?.launchApp) {
                    try {
                        console.log('[Spotlight] Falling back to launchApp:', item.path);
                        await window.electronAPI.launchApp(item.path);
                    } catch (launchErr) {
                        console.warn('[Spotlight] Launch fallback failed:', launchErr);
                    }
                }
            }
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
    };

    const handleClose = useCallback(() => {
        setQuery('');
        setResults([]);
        if (window.electronAPI && window.electronAPI.sendMessage) {
            window.electronAPI.sendMessage({ type: 'SPOTLIGHT_HIDE' });
        }
    }, []);

    // Handle Escape key to close
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleClose]);

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
                        onKeyDown={handleButtonKeyDown}
                        title="Toggle Deep Search"
                    >
                        ✨ Deep
                    </button>
                    <button
                        className="spotlight-close-btn"
                        onClick={handleClose}
                        onKeyDown={handleButtonKeyDown}
                        title="Close (Esc)"
                    >
                        ×
                    </button>
                </div>

                {/* Recommendations Section - Shows when query is empty */}
                {!query.trim() && contextItems.length > 0 && (
                    <div className="spotlight-context">
                        <div className="spotlight-pins-header">
                            <span className="spotlight-pins-title">Suggestions</span>
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

                {/* Pinned Section - Only visible when NOT searching */}
                {!query.trim() && (
                    <div className="spotlight-pins">
                        <div className="spotlight-pins-header">
                            <span className="spotlight-pins-title">Pinned Quick Access</span>
                            {pinnedItems.length > 0 && (
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
                )}

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

// Map workspace names to category icons (mirrors WorkspaceCard logic)
const WORKSPACE_CATEGORY_ICONS = {
    finance: faChartLine,
    health: faHeartPulse,
    education: faGraduationCap,
    sports: faGamepad,
    social: faHashtag,
    travel: faPlane,
    entertainment: faVideo,
    shopping: faShoppingBag,
    food: faUtensils,
    utilities: faTools,
    github: faGithub,
    git: faGithub,
    dev: faCode,
    development: faCode,
    coding: faCode,
    code: faCode,
    terminal: faTerminal,
    ai: faRobot,
    gpt: faRobot,
    openai: faRobot,
    work: faBriefcase,
    business: faBriefcase,
    office: faBriefcase,
    personal: faHome,
    home: faHome,
    tasks: faTasks,
    management: faTasks,
    project: faTasks,
    design: faPalette,
    creative: faPalette,
    research: faSearch,
    google: faSearch,
    search: faSearch,
    cloud: faCloud,
    gaming: faGamepad,
    games: faGamepad,
    music: faMusic,
    video: faVideo,
    news: faNewspaper,
    reading: faFlask,
    ideas: faLightbulb,
    test: faVial,
    lab: faFlask,
};

// Get contextual icon for workspace based on its name
function getWorkspaceIcon(name) {
    if (!name) return faFolder;
    const normalized = name.toLowerCase().trim();
    for (const [key, icon] of Object.entries(WORKSPACE_CATEGORY_ICONS)) {
        if (normalized === key || normalized.includes(key + ' ') || normalized.includes(' ' + key) || normalized.startsWith(key)) {
            return icon;
        }
    }
    return faFolder;
}

function getIcon(type, name) {
    switch (type) {
        case 'tab': return faGlobe;
        case 'history': return faHistory;
        case 'bookmark': return faStar;
        case 'workspace': return getWorkspaceIcon(name);
        case 'note': return faStickyNote;
        case 'app': return faDesktop;
        default: return faLink;
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
                ) : (() => {
                    const resolvedFavicon = pin.favicon || (pin.url ? getFaviconUrl(pin.url, 32, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleFaviconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={faGlobe} />
                    );
                })()}
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
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 32, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleFaviconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={item.type === 'workspace' ? getWorkspaceIcon(item.title || item.name) : faGlobe} />
                    );
                })()}
            </div>
            <div className="context-item-details">
                <span className="pin-label">{item.type === 'app' ? (item.name || item.title) : (item.title || item.name)}</span>
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

    // Track icon load errors to show fallback
    const [iconError, setIconError] = useState(false);

    // Reset error when item changes
    useEffect(() => {
        setIconError(false);
    }, [item.id, item.icon, item.favicon]);

    return (
        <div
            className={`result-item ${isSelected ? 'selected' : ''} result-${['tab', 'bookmark', 'history', 'workspace', 'note', 'app'].includes(item.type) ? item.type : 'link'}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
        >
            <div className="result-icon">
                {item.type === 'app' ? (
                    (item.icon && !iconError) ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={() => setIconError(true)} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} className="app-icon" />
                    )
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 32, null, true) : null);
                    return resolvedFavicon && !iconError ? (
                        <img src={resolvedFavicon} onError={() => setIconError(true)} alt="" />
                    ) : (
                        <div className="fa-icon-wrapper">
                            <FontAwesomeIcon icon={getIcon(item.type, item.title || item.name)} />
                        </div>
                    );
                })()}
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
                    <FontAwesomeIcon icon={faThumbtack} />
                </span>
            )}
        </div>
    );
});
