import { faChrome, faDiscord, faEdge, faFirefox, faGithub, faSlack, faSpotify } from '@fortawesome/free-brands-svg-icons';
import { faBriefcase, faCalculator, faChartLine, faCloud, faCode, faCog, faComments, faDesktop, faEnvelope, faFile, faFlask, faFolder, faGamepad, faGlobe, faGraduationCap, faHashtag, faHeartPulse, faHistory, faHome, faImage, faLightbulb, faLink, faMusic, faNewspaper, faPalette, faPlane, faRobot, faSearch, faShoppingBag, faStar, faStickyNote, faTasks, faTerminal, faThumbtack, faTools, faUtensils, faVial, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '../services/extensionApi';
import { recordSearchSelection } from '../services/feedbackService';
import * as LocalAI from '../services/localAIService';
import { runningAppsService } from '../services/runningAppsService';
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
    'cmd.exe': faTerminal,
    'command prompt': faTerminal,
    'powershell': faTerminal,
    'pwsh': faTerminal,
    'terminal': faTerminal,
    'wt': faTerminal,
    'bash': faTerminal,
    'mintty': faTerminal,
    'conemu': faTerminal,
    'alacritty': faTerminal,
    'hyper': faTerminal,
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
    const [showAllResults, setShowAllResults] = useState(false);
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    const [contextItems, setContextItems] = useState([]);

    // AI/Model command states
    const [commandMode, setCommandMode] = useState(null); // null, 'ai', 'model'
    const [aiMessages, setAiMessages] = useState([]);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [currentModel, setCurrentModel] = useState(null);

    // Track search request ID to handle race conditions
    const searchIdRef = useRef(0);

    // Track when results were displayed (for response time feedback)
    const resultsDisplayedAtRef = useRef(null);

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
        // Pre-warm the search cache so history/workspace results are ready for first search
        refreshElectronCache().catch(() => { });

        // Subscribe to tabs-updated events (like TabManagement does)
        let unsubscribeTabs = null;
        if (window.electronAPI?.subscribe) {
            unsubscribeTabs = window.electronAPI.subscribe('tabs-updated', (updatedTabs) => {
                console.log('[Spotlight] tabs-updated event received:', updatedTabs?.length);
                // Reload context items when tabs change
                loadContextItems();
            });
        }

        // Subscribe to running apps updates (like TabManagement does)
        let unsubscribeApps = null;
        if (window.electronAPI?.getRunningApps) {
            unsubscribeApps = runningAppsService.subscribe(({ runningApps, installedApps }) => {
                console.log('[Spotlight] runningApps updated:', runningApps?.length);
                // Reload context items when apps change
                loadContextItems();
            });
        }

        // Listen for spotlight-shown event from Electron (when Alt+K is pressed)
        let unsubscribeSpotlight = null;
        if (window.electronAPI?.subscribe) {
            unsubscribeSpotlight = window.electronAPI.subscribe('spotlight-shown', () => {
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
        }

        return () => {
            window.removeEventListener('focus', handleFocus);
            if (unsubscribeTabs) unsubscribeTabs();
            if (unsubscribeApps) unsubscribeApps();
            if (unsubscribeSpotlight) unsubscribeSpotlight();
        };
    }, []);



    // Load Recommendations - Shows frequently used apps and active tabs when Spotlight opens
    const loadContextItems = useCallback(async () => {
        console.log('[Spotlight] loadContextItems called');
        try {
            // Fetch all data in parallel (use cached running apps service)
            console.log('[Spotlight] Fetching data...');

            // Helper to get tabs from either Electron/Tauri or Chrome extension
            const fetchTabs = async () => {
                console.log('[Spotlight] fetchTabs called');
                console.log('[Spotlight] window.electronAPI exists:', !!window.electronAPI);
                console.log('[Spotlight] window.electronAPI.getTabs exists:', !!window.electronAPI?.getTabs);
                console.log('[Spotlight] chrome exists:', typeof chrome !== 'undefined');
                console.log('[Spotlight] chrome.tabs exists:', typeof chrome !== 'undefined' && !!chrome?.tabs);
                console.log('[Spotlight] chrome.tabs.query exists:', typeof chrome !== 'undefined' && !!chrome?.tabs?.query);

                try {
                    // Try Electron/Tauri API first (desktop app)
                    if (window.electronAPI?.getTabs) {
                        console.log('[Spotlight] Using electronAPI.getTabs');
                        const tabs = await window.electronAPI.getTabs();
                        console.log('[Spotlight] electronAPI.getTabs returned:', tabs?.length, 'tabs', tabs);
                        return Array.isArray(tabs) ? tabs : []; // Guard: IPC may return null if handler was missing
                    }
                    // Fallback to Chrome extension API
                    if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
                        console.log('[Spotlight] Using chrome.tabs.query fallback');
                        const rawTabs = await chrome.tabs.query({});
                        console.log('[Spotlight] chrome.tabs.query returned:', rawTabs?.length, 'tabs', rawTabs);
                        return rawTabs.map(tab => ({
                            ...tab,
                            tabId: tab.id,
                            favicon: tab.favIconUrl
                        }));
                    }
                    console.log('[Spotlight] No tab API available, returning empty array');
                    return [];
                } catch (e) {
                    console.error('[Spotlight] getTabs error:', e);
                    return [];
                }
            };

            const [{ runningApps, installedApps }, tabs, frequentApps] = await Promise.all([
                runningAppsService.getApps(),
                fetchTabs(),
                storageGet(['frequent_apps']).then(d => d.frequent_apps || {}).catch(() => ({}))
            ]);

            // Guard: ensure tabs is always an array — avoids TypeError that would silently kill all recommendations
            const safeTabs = Array.isArray(tabs) ? tabs : [];

            console.log('[Spotlight] Data fetched:', {
                runningApps: runningApps?.length || 0,
                installedApps: installedApps?.length || 0,
                tabs: safeTabs.length,
                frequentApps: Object.keys(frequentApps).length
            });

            const recommendations = [];
            const usedIds = new Set();

            // 1. Running Apps (top priority - what user is actively using)
            // Enrich with icons from installed apps, then filter
            const enrichedRunning = enrichRunningAppsWithIcons(runningApps, installedApps);

            // Exact process names that are pure system noise (no user value)
            const systemExactNames = new Set([
                // Windows system processes
                'svchost', 'csrss', 'smss', 'wininit', 'winlogon', 'services', 'lsass',
                'registry', 'system', 'idle', 'dwm', 'conhost', 'ctfmon', 'spoolsv',
                'taskhostw', 'sihost', 'runtimebroker', 'applicationframehost',
                'searchindexer', 'searchhost', 'securityhealthsystray',
                // macOS system UI processes
                'windowserver', 'dock', 'controlcenter', 'notificationcenter',
                'spotlight', 'loginwindow', 'textinputswitcher', 'accessibilityuiserver',
                'cursoruiviewservice', 'nsattributedstringagent', 'webthumbnailextension',
                'linkednotesuitservice', 'securityprivacyextension',
            ]);
            // macOS system process patterns — filter by name prefix/content
            const isMacSystemProcess = (name) =>
                name.startsWith('com.apple.') ||   // reverse-DNS = system XPC service
                name.includes('.xpc.') ||           // XPC helper process
                (name.endsWith('helper') && !name.includes(' ')) ||  // bare lowercase helpers
                (name.endsWith('agent') && !name.includes(' '));     // bare lowercase agents
            // Browser keywords — matched via substring so macOS full names like
            // "Google Chrome", "Brave Browser", "Microsoft Edge" are also caught.
            const browserKeywords = [
                'chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'vivaldi',
                'iexplore', 'chromium', 'safari', 'waterfox', 'librewolf', 'thorium',
                'arc', 'floorp', 'zen'
            ];
            const isBrowserApp = (name) => browserKeywords.some(k => name.includes(k));
            // CoolDesk app names to exclude (we are the app, don't show ourselves)
            const coolDeskNames = new Set([
                'cooldesk', 'cool desk', 'cool-desk', 'tauri', 'webview', 'wry'
            ]);

            const activeApps = enrichedRunning
                .filter(a => {
                    const name = (a.name || '').toLowerCase().replace(/\.exe$/i, '');
                    const title = (a.title || '').toLowerCase();

                    if (usedIds.has(name)) return false;

                    // Skip known system noise processes (exact name match or macOS patterns)
                    if (systemExactNames.has(name)) return false;
                    if (isMacSystemProcess(name)) return false;

                    // Skip browsers (tabs are shown separately)
                    if (isBrowserApp(name)) return false;

                    // Filter the spotlight/cooldesk app itself
                    if (coolDeskNames.has(name)) return false;
                    // Also check partial matches for cooldesk variants
                    if (name.includes('cooldesk') || name.includes('cool-desk') || name.includes('tauri')) return false;

                    // Filter tray/background windows.
                    // Windows: cloaked===2 means "on another virtual desktop" — keep those.
                    // macOS:   cloaked is always 0, so treat any running app as showable
                    //          regardless of isVisible (many macOS apps sit in background).
                    const isMacStyle = a.source === 'applications' || a.source === 'system_applications' || a.source === 'user_applications';
                    if (a.isVisible === false && !isMacStyle && (a.cloaked || 0) !== 2) return false;

                    // Filter obvious noise: log windows, tray windows
                    if (title.endsWith(' log') || title === 'temp window' || title.endsWith('trayiconwindow')) return false;

                    usedIds.add(name);
                    return true;
                })
                // Sort by usage frequency — most-used apps appear first
                .sort((a, b) => {
                    const freqA = frequentApps[(a.name || '').toLowerCase()] || 0;
                    const freqB = frequentApps[(b.name || '').toLowerCase()] || 0;
                    return freqB - freqA;
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

                // Skip browsers (they're shown as tabs instead) and cooldesk
                const appNameLower = appName.toLowerCase().replace(/\.exe$/i, '');
                if (isBrowserApp(appNameLower) || systemExactNames.has(appNameLower) || coolDeskNames.has(appNameLower)) continue;
                if (appNameLower.includes('cooldesk') || appNameLower.includes('tauri')) continue;

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
                    // Skip if this app's name is a system process, browser, or cooldesk
                    const installedExe = (app.path || '').split(/[\/\\]/).pop()?.toLowerCase().replace(/\.exe$/i, '') || '';
                    if (isBrowserApp(installedExe) || systemExactNames.has(installedExe) || coolDeskNames.has(installedExe)) continue;
                    if (installedExe.includes('cooldesk') || installedExe.includes('tauri')) continue;

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
            console.log('[Spotlight] Processing tabs, raw count:', safeTabs.length);
            console.log('[Spotlight] Raw tabs data:', JSON.stringify(safeTabs.slice(0, 3), null, 2));

            const afterUrlFilter = safeTabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));
            console.log('[Spotlight] After URL filter:', afterUrlFilter.length);

            const relevantTabs = afterUrlFilter
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

            console.log('[Spotlight] Relevant tabs after dedup:', relevantTabs.length, relevantTabs.map(t => ({ title: t.title, url: t.url, type: t.type })));
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
    // COMMAND MODE DETECTION (/ai, /model)
    // ==========================================
    useEffect(() => {
        const trimmedQuery = query.trim().toLowerCase();

        // Detect /ai command
        if (trimmedQuery === '/ai' || trimmedQuery.startsWith('/ai ')) {
            if (commandMode !== 'ai') {
                setCommandMode('ai');
                setResults([]);
            }
            return;
        }

        // Detect /model command
        if (trimmedQuery === '/model' || trimmedQuery.startsWith('/model ')) {
            if (commandMode !== 'model') {
                setCommandMode('model');
                setResults([]);
                // Fetch available models
                fetchAvailableModels();
            }
            return;
        }

        // Clear command mode if not a command
        if (commandMode) {
            setCommandMode(null);
            setAiMessages([]);
        }
    }, [query]);

    // Fetch available models for /model command
    const fetchAvailableModels = async () => {
        try {
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
                setAvailableModels([{
                    name: 'error',
                    title: 'Desktop App Not Running',
                    description: 'Please start the CoolDesk desktop app to use AI',
                    disabled: true
                }]);
                return;
            }

            const status = await LocalAI.getStatus();
            setCurrentModel(status.currentModel || null);

            const modelsResult = await LocalAI.getModels();
            const modelFilenames = Object.keys(modelsResult || {}).filter(
                name => modelsResult[name]?.downloaded
            );

            if (modelFilenames.length === 0) {
                setAvailableModels([{
                    name: 'error',
                    title: 'No Models Downloaded',
                    description: 'Go to Settings → Local AI to download models',
                    disabled: true
                }]);
                return;
            }

            const models = modelFilenames.map(name => {
                const modelInfo = modelsResult[name];
                const isLoaded = status.currentModel === name;
                return {
                    name,
                    title: modelInfo?.displayName || name,
                    description: isLoaded ? '✓ Currently loaded' : `Click to load • ${modelInfo?.size || ''}`,
                    isLoaded,
                    disabled: false
                };
            }).sort((a, b) => {
                if (a.isLoaded && !b.isLoaded) return -1;
                if (!a.isLoaded && b.isLoaded) return 1;
                return 0;
            });

            setAvailableModels(models);
        } catch (error) {
            console.error('[Spotlight] Failed to fetch models:', error);
            setAvailableModels([{
                name: 'error',
                title: 'Error Loading Models',
                description: error.message || 'Failed to connect to AI service',
                disabled: true
            }]);
        }
    };

    // Load a model
    const loadModel = async (modelName) => {
        if (isModelLoading) return;

        try {
            setIsModelLoading(true);
            await LocalAI.loadModel(modelName);
            setCurrentModel(modelName);
            // Refresh the list
            await fetchAvailableModels();
            // Show success briefly then close
            setTimeout(() => {
                handleClose();
            }, 500);
        } catch (error) {
            console.error('[Spotlight] Failed to load model:', error);
        } finally {
            setIsModelLoading(false);
        }
    };

    // Send AI message
    const sendAiMessage = async (prompt) => {
        if (!prompt.trim() || isAiLoading) return;

        const userMessage = { role: 'user', content: prompt };
        setAiMessages(prev => [...prev, userMessage]);
        setIsAiLoading(true);

        try {
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
                setAiMessages(prev => [...prev, {
                    role: 'error',
                    content: 'Local AI not available. Ensure the CoolDesk desktop app is running.'
                }]);
                setIsAiLoading(false);
                return;
            }

            // Check if model is loaded
            const status = await LocalAI.getStatus();
            if (!status.modelLoaded) {
                setAiMessages(prev => [...prev, {
                    role: 'system',
                    content: 'No model loaded. Use /model to select one first.'
                }]);
                setIsAiLoading(false);
                return;
            }

            const response = await LocalAI.chat(prompt);
            setAiMessages(prev => [...prev, {
                role: 'assistant',
                content: response || 'No response received'
            }]);
        } catch (error) {
            console.error('[Spotlight] AI chat error:', error);
            setAiMessages(prev => [...prev, {
                role: 'error',
                content: error.message || 'Failed to get response'
            }]);
        } finally {
            setIsAiLoading(false);
        }
    };

    // ==========================================
    // OPTIMIZED SEARCH with caching & race handling
    // ==========================================
    useEffect(() => {
        const trimmedQuery = query.trim();

        // Skip search if in command mode
        if (commandMode) {
            return;
        }

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
            if (trimmedQuery.length < 1) return;
        }

        // Reset pagination on new query
        setShowAllResults(false);
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
                
                const searchPromise = isNaturalLanguage
                    ? naturalLanguageSearch(trimmedQuery, 15)
                    : quickSearch(trimmedQuery, 15);
                    
                const filesPromise = window.electronAPI?.searchFiles
                    ? window.electronAPI.searchFiles(trimmedQuery)
                    : Promise.resolve([]);

                let [searchResults, osFiles] = await Promise.all([searchPromise, filesPromise]);

                const mappedFiles = (osFiles || []).map(file => {
                    const filePath = typeof file === 'string' ? file : (file.path || '');
                    if (!filePath) return null;
                    const fileDate = file.date ? ` • ${file.date}` : '';
                    const parentFolder = filePath.split(/[/\\]/).slice(0, -1).pop() || '';
                    return {
                        id: `file:${filePath}`,
                        type: 'file',
                        title: filePath.split(/[/\\]/).pop(),
                        description: `${parentFolder}${fileDate}`,
                        path: filePath,
                        icon: 'file'
                    };
                }).filter(Boolean);
                
                searchResults = [...(searchResults || []), ...mappedFiles];

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
                resultsDisplayedAtRef.current = Date.now(); // Track for feedback response time

            } catch (err) {
                console.error('[Spotlight] Search failed:', err);
            } finally {
                if (searchIdRef.current === currentSearchId) {
                    setLoading(false);
                }
            }
        }, debounceMs);

        return () => clearTimeout(timeoutId);
    }, [query, deepSearch, commandMode]);

    // Handle Keyboard Navigation
    const handleKeyDown = (e) => {
        // Handle command modes first
        if (commandMode === 'ai') {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const prompt = query.replace(/^\/ai\s*/i, '').trim();
                if (prompt) {
                    sendAiMessage(prompt);
                    setQuery('/ai '); // Reset to just the command
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setCommandMode(null);
                setAiMessages([]);
                setQuery('');
                return;
            }
            return; // Don't process other keys in AI mode
        }

        if (commandMode === 'model') {
            const filterQuery = query.replace(/^\/model\s*/i, '').trim().toLowerCase();
            const filteredModels = availableModels.filter(m =>
                !m.disabled && m.title.toLowerCase().includes(filterQuery)
            );

            if (e.key === 'ArrowDown' && filteredModels.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % filteredModels.length);
                return;
            }
            if (e.key === 'ArrowUp' && filteredModels.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => prev <= 0 ? filteredModels.length - 1 : prev - 1);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const modelToLoad = selectedIndex >= 0 ? filteredModels[selectedIndex] : filteredModels[0];
                if (modelToLoad && !modelToLoad.disabled && !modelToLoad.isLoaded) {
                    loadModel(modelToLoad.name);
                } else if (modelToLoad?.isLoaded) {
                    handleClose(); // Already loaded, just close
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setCommandMode(null);
                setQuery('');
                return;
            }
            return;
        }

        const isSearching = !!query.trim();

        // Build complete navigable list depending on state
        // Visual order: Context Items → Pinned Items → Results
        // If searching: Only Results
        const totalContext = isSearching ? 0 : contextItems.length;
        const totalPins = isSearching ? 0 : pinnedItems.length;
        const totalResults = results.length;
        const totalItems = totalContext + totalPins + totalResults;

        // Current selected index in flat list (following visual order: context → pins → results)
        // selectedPinIndex >= pinnedItems.length means a context item is selected
        // selectedPinIndex 0 to pinnedItems.length-1 means a pin is selected
        let currentIndex = -1;
        if (selectedPinIndex >= pinnedItems.length && !isSearching) {
            // Context item selected - visual position is (selectedPinIndex - pinnedItems.length)
            currentIndex = selectedPinIndex - pinnedItems.length;
        } else if (selectedPinIndex >= 0 && selectedPinIndex < pinnedItems.length && !isSearching) {
            // Pin selected - visual position is totalContext + selectedPinIndex
            currentIndex = totalContext + selectedPinIndex;
        } else if (selectedIndex >= 0) {
            currentIndex = totalContext + totalPins + selectedIndex;
        }

        // Navigation handlers - follow visual order: Context → Pins → Results
        if (e.key === 'ArrowDown' && totalItems > 0) {
            e.preventDefault();
            const nextIndex = currentIndex + 1;

            // If at end or not started, wrap/start
            if (currentIndex === -1) {
                // Start at top (first context item, then first pin, then first result)
                if (totalContext > 0) {
                    setSelectedPinIndex(pinnedItems.length); // Context items start after pins in selectedPinIndex
                    setSelectedIndex(-1);
                } else if (totalPins > 0) {
                    setSelectedPinIndex(0);
                    setSelectedIndex(-1);
                } else {
                    setSelectedIndex(0);
                }
            } else if (nextIndex < totalItems) {
                // Map nextIndex to the right section
                if (nextIndex < totalContext) {
                    // Still in context items
                    setSelectedPinIndex(pinnedItems.length + nextIndex);
                    setSelectedIndex(-1);
                } else if (nextIndex < totalContext + totalPins) {
                    // In pins section
                    setSelectedPinIndex(nextIndex - totalContext);
                    setSelectedIndex(-1);
                } else {
                    // In results section
                    setSelectedPinIndex(-1);
                    setSelectedIndex(nextIndex - totalContext - totalPins);
                }
            } else {
                // Loop back to top
                if (totalContext > 0) {
                    setSelectedPinIndex(pinnedItems.length);
                    setSelectedIndex(-1);
                } else if (totalPins > 0) {
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
                // Start at bottom (last result, or last pin, or last context)
                if (totalResults > 0) {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(totalResults - 1);
                } else if (totalPins > 0) {
                    setSelectedPinIndex(totalPins - 1);
                    setSelectedIndex(-1);
                } else if (totalContext > 0) {
                    setSelectedPinIndex(pinnedItems.length + totalContext - 1);
                    setSelectedIndex(-1);
                }
            } else if (nextIndex >= 0) {
                if (nextIndex < totalContext) {
                    setSelectedPinIndex(pinnedItems.length + nextIndex);
                    setSelectedIndex(-1);
                } else if (nextIndex < totalContext + totalPins) {
                    setSelectedPinIndex(nextIndex - totalContext);
                    setSelectedIndex(-1);
                } else {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(nextIndex - totalContext - totalPins);
                }
            } else {
                // Loop to bottom
                if (totalResults > 0) {
                    setSelectedPinIndex(-1);
                    setSelectedIndex(totalResults - 1);
                } else if (totalPins > 0) {
                    setSelectedPinIndex(totalPins - 1);
                    setSelectedIndex(-1);
                } else if (totalContext > 0) {
                    setSelectedPinIndex(pinnedItems.length + totalContext - 1);
                    setSelectedIndex(-1);
                }
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (currentIndex >= 0 && currentIndex < totalItems) {
                if (currentIndex < totalContext) {
                    handleSelect(contextItems[currentIndex]);
                } else if (currentIndex < totalContext + totalPins) {
                    handleSelect(pinnedItems[currentIndex - totalContext]);
                } else {
                    handleSelect(results[currentIndex - totalContext - totalPins]);
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
            if (currentIndex >= totalContext + totalPins && selectedIndex >= 0) {
                togglePin(results[selectedIndex]);
            }
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isSearching && currentIndex >= totalContext && currentIndex < totalContext + totalPins) {
            e.preventDefault();
            const pinIndex = currentIndex - totalContext;
            removePin(pinIndex);
            // Adjust selection after removal
            const maxPinIndex = totalPins - 2; // -1 for removed, -1 for 0-index
            if (maxPinIndex >= 0) setSelectedPinIndex(Math.min(pinIndex, maxPinIndex));
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

        // Record feedback for RAG (fire-and-forget, non-blocking)
        recordSearchSelection(item, resultsDisplayedAtRef.current).catch(() => { });

        // For tabs, switch to the existing tab instead of opening new
        if (item.type === 'tab') {
            try {
                const tabId = item.tabId || item.id;
                if (tabId) {
                    // Fire-and-forget — spotlight is already closing
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        chrome.runtime.sendMessage({ type: 'JUMP_TO_TAB', tabId });
                    } else if (window.electronAPI?.sendMessage) {
                        // Pass _deviceId so shim can focus the correct browser directly
                        window.electronAPI.sendMessage({
                            type: 'JUMP_TO_TAB',
                            tabId,
                            _deviceId: item._deviceId
                        });
                    }
                    return;
                }

                // No tabId — open URL in browser as fallback
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
        
        // Handle files natively using OS default viewer
        if (item.type === 'file') {
            try {
                if (window.electronAPI?.launchApp) {
                    await window.electronAPI.launchApp(item.path);
                } else {
                    console.warn('[Spotlight] launchApp not available for files');
                }
            } catch (e) {
                console.error('[Spotlight] Failed to open file:', e);
            }
            return;
        }

        // For apps, focus running app or launch installed app
        if (item.type === 'app') {
            console.log('[Spotlight] App selected:', item.name, 'isRunning:', item.isRunning, 'pid:', item.pid, 'path:', item.path, 'electronAPI:', !!window.electronAPI);

            try {
                // Track app usage for recommendations
                trackAppUsage(item.name);

                // Check if electronAPI is available
                if (!window.electronAPI) {
                    console.warn('[Spotlight] electronAPI not available - cannot launch/focus apps');
                    return;
                }

                // Check if app is running (use PID from search result if available)
                if (item.isRunning && item.pid) {
                    // App is running - focus specific window by HWND if available, else by PID
                    console.log('[Spotlight] Focusing running app:', item.name, 'PID:', item.pid, 'HWND:', item.hwnd);
                    if (window.electronAPI.focusApp) {
                        await window.electronAPI.focusApp(item.pid, item.name, item.hwnd);
                    } else {
                        console.warn('[Spotlight] focusApp not available');
                    }
                    return;
                }

                // For pinned apps without PID, we need to find the current running instance
                // because the stored PID might be stale (use cached service)
                if (!item.pid) {
                    const { runningApps } = await runningAppsService.getApps();
                    if (runningApps?.length > 0) {
                        const runningInstance = runningApps.find(app =>
                            app.name?.toLowerCase() === item.name?.toLowerCase()
                        );

                        if (runningInstance && runningInstance.pid) {
                            // App is running - focus it
                            console.log('[Spotlight] Found running instance via lookup:', runningInstance.name, 'PID:', runningInstance.pid);
                            if (window.electronAPI.focusApp) {
                                await window.electronAPI.focusApp(runningInstance.pid, runningInstance.name);
                            }
                            return;
                        }
                    }
                }

                // App is not running - launch it
                let launchPath = item.path;

                // If no path, try to find it from installed apps
                if (!launchPath) {
                    console.log('[Spotlight] No path in item, searching installed apps for:', item.name);
                    const { installedApps } = await runningAppsService.getApps();
                    if (installedApps?.length > 0) {
                        const foundApp = installedApps.find(app =>
                            app.name?.toLowerCase() === item.name?.toLowerCase()
                        );
                        if (foundApp?.path) {
                            launchPath = foundApp.path;
                            console.log('[Spotlight] Found path from installed apps:', launchPath);
                        }
                    }
                }

                if (launchPath) {
                    if (window.electronAPI.launchApp) {
                        console.log('[Spotlight] Launching app:', item.name, 'path:', launchPath);
                        await window.electronAPI.launchApp(launchPath);
                    } else {
                        console.warn('[Spotlight] launchApp not available');
                    }
                } else {
                    console.warn('[Spotlight] No path available for app:', item.name);
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
        if (item.type === 'file') return 'File';
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
                    {/* 
                    <button
                        className={`spotlight-deep-btn ${deepSearch ? 'active' : ''}`}
                        onClick={() => setDeepSearch(!deepSearch)}
                        onKeyDown={handleButtonKeyDown}
                        title="Toggle Deep Search"
                    >
                        ✨ Deep
                    </button> */}
                    <button
                        className="spotlight-close-btn"
                        onClick={handleClose}
                        onKeyDown={handleButtonKeyDown}
                        title="Close (Esc)"
                    >
                        ×
                    </button>
                </div>

                {/* AI Chat Mode */}
                {commandMode === 'ai' && (
                    <div className="spotlight-ai-mode">
                        <div className="spotlight-ai-header">
                            <FontAwesomeIcon icon={faRobot} style={{ color: '#A78BFA' }} />
                            <span>AI Chat</span>
                            {isAiLoading && (
                                <div style={{ width: 14, height: 14, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
                            )}
                        </div>
                        <div className="spotlight-ai-messages">
                            {aiMessages.length === 0 && (
                                <div className="spotlight-ai-hint">
                                    Type your message and press Enter to chat with AI
                                </div>
                            )}
                            {aiMessages.map((msg, idx) => (
                                <div key={idx} className={`spotlight-ai-message ${msg.role}`}>
                                    <div className="message-avatar">
                                        {msg.role === 'user' ? '👤' : msg.role === 'error' ? '⚠️' : '🤖'}
                                    </div>
                                    <div className="message-content">{msg.content}</div>
                                </div>
                            ))}
                            {isAiLoading && (
                                <div className="spotlight-ai-message assistant loading">
                                    <div className="message-avatar">🤖</div>
                                    <div className="message-content">
                                        <span className="typing-indicator">
                                            <span></span><span></span><span></span>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Model Selection Mode */}
                {commandMode === 'model' && (
                    <div className="spotlight-model-mode">
                        <div className="spotlight-model-header">
                            <FontAwesomeIcon icon={faRobot} style={{ color: '#A78BFA' }} />
                            <span>Select AI Model</span>
                            {isModelLoading && (
                                <div style={{ width: 14, height: 14, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
                            )}
                        </div>
                        <div className="spotlight-model-list">
                            {availableModels.length === 0 && (
                                <div className="spotlight-model-loading">
                                    <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                    <span>Loading models...</span>
                                </div>
                            )}
                            {availableModels
                                .filter(m => {
                                    const filterQuery = query.replace(/^\/model\s*/i, '').trim().toLowerCase();
                                    return m.title.toLowerCase().includes(filterQuery);
                                })
                                .map((model, idx) => (
                                    <div
                                        key={model.name}
                                        className={`spotlight-model-item ${idx === selectedIndex ? 'selected' : ''} ${model.isLoaded ? 'loaded' : ''} ${model.disabled ? 'disabled' : ''} ${isModelLoading ? 'loading' : ''}`}
                                        onClick={() => !model.disabled && !model.isLoaded && !isModelLoading && loadModel(model.name)}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                    >
                                        <div className="model-icon">
                                            {isModelLoading && idx === selectedIndex ? (
                                                <div style={{ width: 18, height: 18, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                            ) : (
                                                <FontAwesomeIcon icon={faRobot} />
                                            )}
                                        </div>
                                        <div className="model-info">
                                            <span className="model-title">{model.title}</span>
                                            <span className="model-desc">{model.description}</span>
                                        </div>
                                        {model.isLoaded && <span className="model-badge">Active</span>}
                                    </div>
                                ))}
                        </div>
                    </div>
                )}

                {/* Recommendations Section - Shows when query is empty */}
                {!query.trim() && !commandMode && contextItems.length > 0 && (() => {
                    // Group items by type
                    const apps = contextItems.filter(item => item.type === 'app');
                    const tabs = contextItems.filter(item => item.type === 'tab');
                    let flatIndex = pinnedItems.length; // Start after pinned items

                    console.log('[Spotlight] Rendering context - apps:', apps.length, 'tabs:', tabs.length);

                    return (
                        <div className="spotlight-context">
                            {/* Apps Row */}
                            {apps.length > 0 && (
                                <div className="context-section">
                                    <div className="context-section-label">Apps</div>
                                    <div className="context-row">
                                        {apps.map((item, i) => {
                                            const itemIndex = flatIndex++;
                                            return (
                                                <ContextItem
                                                    key={`app-${i}`}
                                                    item={item}
                                                    index={itemIndex}
                                                    isSelected={itemIndex === selectedPinIndex}
                                                    onSelect={handleSelect}
                                                    onHover={setSelectedPinIndex}
                                                    getAppIcon={getAppIcon}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {/* Tabs Row */}
                            {tabs.length > 0 && (
                                <div className="context-section">
                                    <div className="context-section-label">Tabs</div>
                                    <div className="context-row">
                                        {tabs.map((item, i) => {
                                            const itemIndex = flatIndex++;
                                            return (
                                                <ContextItem
                                                    key={`tab-${i}`}
                                                    item={item}
                                                    index={itemIndex}
                                                    isSelected={itemIndex === selectedPinIndex}
                                                    onSelect={handleSelect}
                                                    onHover={setSelectedPinIndex}
                                                    getAppIcon={getAppIcon}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Pinned Section - Only visible when NOT searching */}
                {!query.trim() && !commandMode && (
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
                {results.length > 0 && !commandMode && (
                    <div className="spotlight-results">
                        {results.slice(0, showAllResults ? results.length : 10).map((item, index) => (
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
                        {!showAllResults && results.length > 10 && (
                            <div style={{ padding: '8px 14px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', textAlign: 'center', cursor: 'pointer' }} onClick={() => setShowAllResults(true)}>
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
        case 'file': return faFile;
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
                    (pin.icon && pin.icon.length > 50) ? (
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

// Memoized Context Item - compact version for grouped display
const ContextItem = memo(function ContextItem({ item, index, isSelected, onSelect, onHover, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
    }, []);

    const isApp = item.type === 'app';
    const isRunning = isApp && item.isRunning;

    return (
        <div
            className={`context-item ${isApp ? 'context-app' : 'context-tab'} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            title={isApp ? (item.name || item.title) : (item.title || item.url)}
        >
            <div className="pin-icon">
                {isApp ? (
                    (item.icon && item.icon.length > 50) ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} style={{ color: '#60a5fa' }} />
                    )
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 16, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleIconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={faGlobe} style={{ color: '#a78bfa' }} />
                    );
                })()}
            </div>
            <span className="pin-label">
                {isApp ? (item.name || item.title) : (item.title || 'Tab')}
            </span>
            {isRunning && <span className="running-dot" />}
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
                    (item.icon && item.icon.length > 50 && !iconError) ? (
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
