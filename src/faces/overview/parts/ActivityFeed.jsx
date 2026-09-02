import {
    faBookmark,
    faCalendarAlt,
    faChevronDown,
    faCode,
    faEyeSlash,
    faGlobe,
    faLayerGroup,
    faLink,
    faPlus,
    faRotateLeft,
    faXmark
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import scrapperConfig from '../../../data/scrapper.json';
import { getTimeSeriesDataRange, listPins, listScrapedChats } from '../../../db/index.js';
import { isElectronApp } from '../../../services/environmentDetector';
import { runningAppsService } from '../../../services/runningAppsService.js';
import { getDeviceId, getHostUrl, isSyncFeatureEnabled, loadSyncConfig } from '../../../services/syncConfig.js';
import '../../../styles/cooldesk.css';
import {
    enrichRunningAppsWithIcons,
    getBaseDomainFromUrl,
    getFaviconUrl,
    getGroupDomainFromUrl,
    getLocalUrlLabel,
    isLocalhostUrl,
    safeGetHostname
} from '../../../utils/helpers.js';


// Curated "Search" launcher: the search engines + AI tools people actually
// open. Domains are used to detect whether one is already open in a tab so we
// can focus it instead of opening a duplicate. (URLs all exist in
// data/appstore.json under the "ai"/"information" categories — this is just a
// hand-ordered subset with proper display names.)
const SEARCH_APPS = [
    { name: 'Google', url: 'https://www.google.com', domains: ['google.com'] },
    { name: 'ChatGPT', url: 'https://chatgpt.com', domains: ['chatgpt.com', 'chat.openai.com'] },
    { name: 'Claude', url: 'https://claude.ai', domains: ['claude.ai'] },
    { name: 'Gemini', url: 'https://gemini.google.com', domains: ['gemini.google.com'] },
    { name: 'Perplexity', url: 'https://www.perplexity.ai', domains: ['perplexity.ai'] },
    { name: 'Grok', url: 'https://grok.com', domains: ['grok.com', 'x.ai'] },
    { name: 'Copilot', url: 'https://copilot.microsoft.com', domains: ['copilot.microsoft.com'] },
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', domains: ['deepseek.com'] },
    { name: 'Mistral', url: 'https://chat.mistral.ai', domains: ['mistral.ai'] },
    { name: 'You.com', url: 'https://you.com', domains: ['you.com'] },
    { name: 'Bing', url: 'https://www.bing.com', domains: ['bing.com'] },
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com', domains: ['duckduckgo.com'] },
];

// Tabs living in *other* browsers (Edge/Brave/a second Chrome profile) are
// invisible to chrome.tabs.* — each extension instance only sees its own
// profile. The CoolDesk sidecar aggregates every connected browser's tabs into
// GET /tabs, keyed by device, so we pull that and merge in the foreign ones.
// Returns [] whenever the desktop app isn't running — this is purely additive.
let syncConfigReady = null;
async function fetchRemoteBrowserTabs(myDeviceId) {
    // The extension page never boots the sync config on its own, so the
    // in-memory copy would otherwise be defaults and ignore a user's opt-out.
    syncConfigReady ||= loadSyncConfig().catch(() => null);
    await syncConfigReady;
    if (!isSyncFeatureEnabled('syncTabs')) return [];
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(`${getHostUrl()}/tabs`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return [];
        const all = await res.json();
        if (!Array.isArray(all)) return [];
        // Drop anything this browser already reported — we render those from the
        // live chrome.tabs query, which is fresher than the 30s sidecar poll.
        return all.filter(t => t?.url && t._deviceId && t._deviceId !== myDeviceId);
    } catch {
        return []; // app closed / sidecar down — stay silent
    }
}

// Tint per browser so a row's owner is readable at a glance. Falls back to a
// neutral slate for anything the sidecar reports that we don't have a colour for.
const BROWSER_TINTS = {
    chrome: '#4285F4',
    edge: '#39B4EC',
    brave: '#FB542B',
    firefox: '#FF7139',
    safari: '#22A6F2',
};

/**
 * Compact pill marking a tab that lives in a *different* browser. Renders
 * nothing for local tabs — the common case stays visually quiet, and the badge
 * also explains why identical URLs collapse to one row (local always wins).
 */
const RemoteBrowserBadge = ({ item }) => {
    if (!item?.remote) return null;
    const key = (item.browser || '').toLowerCase();
    const tint = BROWSER_TINTS[key] || '#94A3B8';
    const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Other browser';
    return (
        <span
            title={`Open in ${label} — clicking focuses it there`}
            style={{
                flexShrink: 0,
                padding: '1px 6px',
                borderRadius: '999px',
                border: `1px solid ${tint}59`,
                background: `${tint}1F`,
                color: tint,
                fontSize: 'var(--font-xs)',
                fontWeight: 600,
                lineHeight: 1.6,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
            }}
        >
            {label}
        </span>
    );
};

// Platform config derived from scrapper.json
const PLATFORM_CONFIG = scrapperConfig.platforms.reduce((acc, platform) => {
    acc[platform.name] = {
        name: platform.name,
        color: platform.color,
        icon: null, // Will use favicon
        domains: platform.domains,
        type: platform.type
    };
    return acc;
}, {});

// Helper to get platform info for a chat
const getPlatformInfo = (chat) => {
    // 1. Try to match by explicit platform name
    if (chat.platform && PLATFORM_CONFIG[chat.platform]) {
        return PLATFORM_CONFIG[chat.platform];
    }

    // 2. Try to match by domain
    const domain = safeGetHostname(chat.url);
    const knownPlatform = Object.values(PLATFORM_CONFIG).find(p =>
        p.domains.some(d => domain.includes(d))
    );

    if (knownPlatform) {
        return knownPlatform;
    }

    // 3. Fallback to generic domain info
    return {
        name: domain,
        color: '#64748B', // Default slate color
        isGeneric: true,
        domain: domain
    };
};

// Stale-while-revalidate snapshot: every new tab is a fresh document, so the
// last render's data is kept in localStorage and painted instantly while the
// real fetch runs in the background. Feed items are plain JSON (favicons are
// URLs, platform info is data) so a round-trip through storage is lossless.
const FEED_SNAPSHOT_KEY = 'cooldesk-feed-snapshot';

// Persists which segmented-control tab (All Activity/Browsing/Local/Suites/
// Apps/Chats/Search) was active, so a refresh doesn't silently dump you back
// on "All Activity" after you'd picked Local or Suites.
const ACTIVE_TAB_KEY = 'cooldesk-feed-active-tab';
const VALID_TABS = new Set(['all', 'chats', 'tabs', 'apps', 'local', 'suites', 'search']);

function loadActiveTab() {
    try {
        const v = localStorage.getItem(ACTIVE_TAB_KEY);
        return VALID_TABS.has(v) ? v : 'all';
    } catch {
        return 'all';
    }
}

function readFeedSnapshot() {
    try {
        const s = JSON.parse(localStorage.getItem(FEED_SNAPSHOT_KEY) || 'null');
        return s && Array.isArray(s.links) && Array.isArray(s.feed) ? s : null;
    } catch {
        return null;
    }
}

function writeFeedSnapshot(links, feed) {
    try {
        localStorage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({
            links: links.slice(0, 30),
            feed: feed.slice(0, 150),
            at: Date.now(),
        }));
    } catch { /* storage full or unavailable */ }
}

// "Suites" tab (multi-service accounts, e.g. Google/Microsoft/Apple, but
// fully automatic — see orgSuites in ActivityFeed below).
const SUITE_SKIP_DOMAINS = new Set(['System', 'Local Files', 'Local', 'Other', 'Unknown', 'localhost']);
const SUITE_MIN_SERVICES = 3;

export function ActivityFeed() {
    // Detect if running in Tauri/Electron app
    const isDesktopApp = isElectronApp();

    const bootSnapshot = useMemo(readFeedSnapshot, []);
    const [quickLinks, setQuickLinks] = useState(bootSnapshot ? bootSnapshot.links : []);
    const [feedItems, setFeedItems] = useState(bootSnapshot ? bootSnapshot.feed : []);
    // Raw live-tabs + 90-day-history snapshot backing both the Local and
    // Suites tabs — see loadDeepActivity below. localApps/orgSuites derive
    // from this via useMemo instead of feedItems, which only looks 4h back
    // and caps at 100 items: a port or a Google product you haven't touched
    // in weeks should still show up.
    const [deepActivity, setDeepActivity] = useState({ tabs: [], history: [] });
    const [calendarEvents, setCalendarEvents] = useState([]);
    const [activeTab, setActiveTabState] = useState(loadActiveTab);
    const setActiveTab = useCallback((next) => {
        setActiveTabState(next);
        try { localStorage.setItem(ACTIVE_TAB_KEY, next); } catch { /* storage unavailable — won't persist */ }
    }, []);
    // With a snapshot on screen there is nothing to spin about — the refresh
    // swaps in silently when it lands.
    const [isLoading, setIsLoading] = useState(!bootSnapshot);
    // Apps the user has removed from the Search launcher (persisted)
    const [hiddenSearchApps, setHiddenSearchApps] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem('searchHiddenApps') || '[]')); } catch { return new Set(); }
    });
    // User-added Search apps (persisted): [{ name, url, domains, custom: true }]
    const [customSearchApps, setCustomSearchApps] = useState(() => {
        try { return JSON.parse(localStorage.getItem('searchCustomApps') || '[]'); } catch { return []; }
    });
    const [addingSearchApp, setAddingSearchApp] = useState(false);
    const [newSearchUrl, setNewSearchUrl] = useState('');
    const [visibleFavCount, setVisibleFavCount] = useState(8);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [region, setRegion] = useState('');
    const [expandedDomains, setExpandedDomains] = useState(new Set());
    const [chatsShowingAll, setChatsShowingAll] = useState(new Set());
    const [isPending, startTransition] = useTransition();
    const favContainerRef = useRef(null);
    const [runningApps, setRunningApps] = useState([]);
    const [installedApps, setInstalledApps] = useState([]);

    // Clock and region detection
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        try {
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const regionName = timeZone.split('/')[1] || timeZone;
            setRegion(regionName.replace(/_/g, ' '));
        } catch (e) {
            setRegion('Local Time');
        }
        return () => clearInterval(timer);
    }, []);

    // Subscribe to running apps (uses centralized service to avoid duplicate API calls)
    // Only available in desktop app mode
    useEffect(() => {
        if (!isDesktopApp || !window.electronAPI?.getRunningApps) return;

        const unsubscribe = runningAppsService.subscribe(({ runningApps: running, installedApps: installed }) => {
            if (Array.isArray(installed)) {
                setInstalledApps(installed);
            }

            if (Array.isArray(running)) {
                // Enrich running apps with icons
                const enriched = enrichRunningAppsWithIcons(running, installed);
                setRunningApps(enriched);
            }
        });

        return unsubscribe;
    }, [isDesktopApp]);

    // Load calendar events
    const loadCalendarEvents = useCallback(async () => {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const result = await chrome.storage.local.get(['calendar_events']);
                if (result.calendar_events) {
                    setCalendarEvents(result.calendar_events);
                }
            }
        } catch (e) {
            console.error('Failed to load calendar events:', e);
        }
    }, []);

    const triggerCalendarScrape = () => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'TRIGGER_CALENDAR_SCRAPE' }, () => {
                setTimeout(loadCalendarEvents, 5000);
            });
        }
    };

    // Load Most Visited (Quick Access) - memoized
    const loadQuickLinks = useCallback(async () => {
        try {
            // Helper to identify and filter out search engine queries
            const isSearchQuery = (url) => {
                if (!url) return true;
                try {
                    const u = new URL(url);
                    const host = u.hostname.toLowerCase();
                    if (host.includes('google.') && u.pathname.startsWith('/search')) return true;
                    if (host.includes('bing.com') && u.pathname.startsWith('/search')) return true;
                    if (host.includes('duckduckgo.com') && u.searchParams.has('q')) return true;
                    if (host.includes('search.yahoo.com')) return true;
                    if (host.includes('ecosia.org') && u.pathname.startsWith('/search')) return true;
                    if (host.includes('search.brave.com')) return true;
                    return false;
                } catch {
                    return true; // Filter out invalid URLs
                }
            };

            const finalLinks = [];
            const seenUrls = new Set();

            // Priority 1: Explicitly pinned items
            const pins = await listPins();
            if (pins && pins.length > 0) {
                pins.forEach(pin => {
                    if (!pin.url || isSearchQuery(pin.url)) return; // Exclude Google Searches from pins

                    let hostname = 'link';
                    try {
                        const u = new URL(pin.url);
                        hostname = u.hostname.replace('www.', '');
                        seenUrls.add(pin.url);

                        finalLinks.push({
                            id: pin.id || pin.url,
                            title: pin.title || hostname,
                            url: pin.url,
                            type: 'link',
                            favicon: pin.favicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
                            hostname
                        });
                    } catch (e) {
                        // ignore invalid
                    }
                });
            }

            // Priority 2: Fill remaining slots with Chrome Top Sites (Highly Accurate Browser Algorithm)
            if (typeof chrome !== 'undefined' && chrome.topSites) {
                const topSites = await new Promise(resolve => chrome.topSites.get(resolve));

                for (const site of topSites) {
                    if (finalLinks.length >= 10) break; // Limit to 10 Quick Links total

                    if (!site.url || isSearchQuery(site.url) || seenUrls.has(site.url)) continue;

                    try {
                        const u = new URL(site.url);
                        const hostname = u.hostname.replace('www.', '');

                        // Prevent too many links from the exact same domain
                        const domainCount = finalLinks.filter(l => l.hostname === hostname).length;
                        if (domainCount < 2) {
                            seenUrls.add(site.url);
                            finalLinks.push({
                                id: site.url,
                                title: site.title || hostname,
                                url: site.url,
                                type: 'top_site',
                                favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
                                hostname
                            });
                        }
                    } catch (e) {
                        // ignore invalid
                    }
                }
            }

            return finalLinks;

        } catch (e) {
            console.error('Failed to load quick links', e);
        }
        return [];
    }, []);

    // Load Feed Items (Chats + Tabs) - memoized
    const loadFeed = useCallback(async () => {
        const items = [];

        // 1. Fetch Chats
        try {
            // Increase limit to ensure we get all chats for "Show all" functionality
            const chatRes = await listScrapedChats({ limit: 100, sortBy: 'scrapedAt', sortOrder: 'desc' });
            const chats = (chatRes.data || chatRes || []).map(chat => {
                const platformInfo = getPlatformInfo(chat);
                return {
                    id: chat.chatId || chat.id,
                    title: chat.title || 'Untitled Chat',
                    url: chat.url,
                    timestamp: new Date(chat.scrapedAt || chat.lastVisitTime).getTime(),
                    type: 'chat',
                    platform: platformInfo.name,
                    platformInfo: platformInfo,
                    subtitle: platformInfo.name
                };
            });
            items.push(...chats);
        } catch (e) {
            console.error('Failed to load chats', e);
        }

        // 2. Fetch Active Tabs
        const openTabUrls = new Set();
        try {
            if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
                // Query ALL windows, not just the focused one — browser windows are
                // often spread across virtual desktops, and { currentWindow: true }
                // silently hid every tab that wasn't in the window holding this page.
                const tabs = await chrome.tabs.query({});
                const tabItems = tabs
                    .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'))
                    .map(tab => {
                        let hostname = 'Browser Tab';
                        try {
                            if (tab.url) hostname = new URL(tab.url).hostname;
                        } catch (e) { }
                        openTabUrls.add(tab.url);
                        return {
                            id: `tab_${tab.id}`,
                            title: tab.title || 'Untitled Tab',
                            url: tab.url,
                            timestamp: tab.lastAccessed || Date.now(),
                            type: 'tab',
                            subtitle: hostname,
                            favIconUrl: tab.favIconUrl
                        };
                    });
                items.push(...tabItems);
            }
        } catch (e) {
            console.error('Failed to load tabs', e);
        }

        // 2b. Fetch tabs open in OTHER browsers via the sidecar (Edge, Brave, a
        // second Chrome profile...). chrome.tabs.* can't see them.
        try {
            const myDeviceId = await getDeviceId();
            const remoteTabs = await fetchRemoteBrowserTabs(myDeviceId);
            for (const tab of remoteTabs) {
                if (openTabUrls.has(tab.url)) continue;
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) continue;
                if (tab.url.startsWith('chrome-extension://')) continue;
                openTabUrls.add(tab.url);
                items.push({
                    id: `rtab_${tab._deviceId}_${tab.id}`,
                    title: tab.title || 'Untitled Tab',
                    url: tab.url,
                    timestamp: Date.now(),
                    type: 'tab',
                    subtitle: safeGetHostname(tab.url) || 'Browser Tab',
                    favIconUrl: tab.favIconUrl,
                    // Remote-tab routing info — clicking these jumps in the owning browser
                    remote: true,
                    remoteTabId: tab.id,
                    remoteWindowId: tab.windowId,
                    deviceId: tab._deviceId,
                    browser: tab.browser || null,
                });
            }
        } catch (e) {
            console.debug('[ActivityFeed] remote tabs unavailable', e);
        }

        // 3. Fetch Recent Browsing History (last 4 hours, skip already-open tabs)
        try {
            if (typeof chrome !== 'undefined' && chrome.history?.search) {
                const since = Date.now() - 4 * 60 * 60 * 1000;
                const historyItems = await chrome.history.search({ text: '', startTime: since, maxResults: 150 });
                for (const item of historyItems) {
                    if (!item.url || openTabUrls.has(item.url)) continue;
                    if (item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) continue;
                    try {
                        const hostname = new URL(item.url).hostname.replace('www.', '');
                        items.push({
                            id: `hist_${item.id || item.url}`,
                            title: item.title || hostname,
                            url: item.url,
                            timestamp: item.lastVisitTime || Date.now(),
                            type: 'recent',
                            subtitle: hostname,
                            visitCount: item.visitCount || 1,
                        });
                    } catch { /* ignore invalid URLs */ }
                }
            }
        } catch (e) {
            console.error('Failed to load history', e);
        }

        // 3. Fetch Calendar Events
        /*
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const calResult = await chrome.storage.local.get(['calendar_events']);
                const events = calResult.calendar_events || [];
                const calendarItems = events.map((evt, idx) => ({
                    id: `cal_${evt.scrapedAt}_${idx}`,
                    title: evt.title || 'Untitled Event',
                    url: evt.link || 'https://calendar.google.com/',
                    timestamp: evt.scrapedAt || Date.now(),
                    type: 'calendar',
                    subtitle: evt.time || 'Upcoming',
                    platform: 'Google Calendar'
                }));
                items.push(...calendarItems);
            }
            console.error('Failed to load calendar items', e);
        }
        */

        // 4. Fetch App Activity - LIMIT to last 2 hours to prevent memory bloat
        // Only available in desktop app mode
        if (isDesktopApp) {
            try {
                const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000; // Only 2 hours, not 24!
                const activities = await getTimeSeriesDataRange(twoHoursAgo, Date.now());
                // CRITICAL: Limit to 50 items max to prevent memory explosion
                const appItems = activities
                    .filter(a => a.type === 'app')
                    .slice(0, 50)
                    .map(a => ({
                        id: a.id,
                        title: a.title || a.appName || 'Unknown App',
                        url: a.url || '#',
                        timestamp: a.timestamp,
                        type: 'app',
                        appName: a.appName || 'Application',
                        duration: a.time,
                        subtitle: a.appName // Show app name as subtitle
                    }));
                items.push(...appItems);
            } catch (e) {
                console.error('Failed to load app activity', e);
            }
        }

        // Sort combined feed by timestamp (newest first)
        return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100); // CAP: Limit to 100 items
    }, [isDesktopApp]);

    // Raw material for both the Local and Suites tabs: live tabs + 90 days of
    // history, unfiltered. One fetch instead of two — both tabs need "every
    // URL you've touched recently", just clustered differently afterwards
    // (by hostname:port for Local, by base domain for Suites). Kept out of
    // loadFeed above since that only looks 4h back and caps at 100 items —
    // fine for a recency feed, not for "have I used 3+ Google products ever".
    const loadDeepActivity = useCallback(async () => {
        let tabs = [];
        let history = [];

        try {
            if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
                tabs = await chrome.tabs.query({});
            }
        } catch (e) {
            console.error('[ActivityFeed] Failed to load tabs for deep activity', e);
        }

        try {
            if (typeof chrome !== 'undefined' && chrome.history?.search) {
                const since = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days back
                history = await chrome.history.search({ text: '', startTime: since, maxResults: 5000 });
            }
        } catch (e) {
            console.error('[ActivityFeed] Failed to load history for deep activity', e);
        }

        return { tabs, history };
    }, []);

    // Effect: Listen for activity DB changes
    useEffect(() => {
        const bc = new BroadcastChannel('activity_db_changes');
        bc.onmessage = (event) => {
            if (event.data && event.data.type === 'activityChanged') {
                // Refresh feed
                loadFeed().then(items => {
                    setFeedItems(items);
                    setIsLoading(false);
                });
            }
        };

        return () => {
            bc.close();
        };
    }, [loadFeed]);

    // Refresh the deep-activity snapshot when Local or Suites is opened.
    // loadDeepActivity does a 90-day history.search, so it's kept out of the
    // 2s tab-event throttle below (which would otherwise re-run it on every
    // tab open/close) and instead just refreshes on view, in addition to the
    // initial mount load.
    useEffect(() => {
        if (activeTab !== 'local' && activeTab !== 'suites') return;
        loadDeepActivity().then(setDeepActivity).catch(console.error);
    }, [activeTab, loadDeepActivity]);

    // Effect: Listen for pins DB changes (for favorites/quick links sync)
    useEffect(() => {
        const bc = new BroadcastChannel('ws_db_changes');
        bc.onmessage = (event) => {
            if (event.data && event.data.type === 'pinsChanged') {
                // Refresh quick links when pins change
                loadQuickLinks().then(links => {
                    setQuickLinks(links);
                });
            }
        };

        return () => {
            bc.close();
        };
    }, [loadQuickLinks]);

    // Throttled update handler (2000ms delay to reduce memory pressure from frequent tab events)
    // Use useRef to maintain a stable reference that won't cause listener leaks
    const updateFunctionsRef = useRef({ loadQuickLinks, loadFeed });
    updateFunctionsRef.current = { loadQuickLinks, loadFeed };

    const throttledUpdateRef = useRef(null);
    if (!throttledUpdateRef.current) {
        let lastCall = 0;
        let pendingTimeout = null;
        throttledUpdateRef.current = () => {
            const now = Date.now();
            const timeSinceLastCall = now - lastCall;
            const THROTTLE_MS = 2000; // Only update every 2 seconds max

            if (pendingTimeout) return; // Already scheduled

            if (timeSinceLastCall >= THROTTLE_MS) {
                lastCall = now;
                const { loadQuickLinks, loadFeed } = updateFunctionsRef.current;
                Promise.all([loadQuickLinks(), loadFeed()]).then(([links, feed]) => {
                    setQuickLinks(links);
                    setFeedItems(feed);
                    writeFeedSnapshot(links, feed);
                }).catch(console.error);
            } else {
                // Schedule for later
                pendingTimeout = setTimeout(() => {
                    pendingTimeout = null;
                    lastCall = Date.now();
                    const { loadQuickLinks, loadFeed } = updateFunctionsRef.current;
                    Promise.all([loadQuickLinks(), loadFeed()]).then(([links, feed]) => {
                        setQuickLinks(links);
                        setFeedItems(feed);
                        writeFeedSnapshot(links, feed);
                    }).catch(console.error);
                }, THROTTLE_MS - timeSinceLastCall);
            }
        };
    }
    const throttledUpdate = throttledUpdateRef.current;

    useEffect(() => {
        const loadAll = async () => {
            const [links, feed, deep] = await Promise.all([loadQuickLinks(), loadFeed(), loadDeepActivity()]);
            setQuickLinks(links);
            setFeedItems(feed);
            setDeepActivity(deep);
            writeFeedSnapshot(links, feed);
            setIsLoading(false);
        };
        loadAll();

        // Event-driven updates with throttling (using stable ref to prevent listener leaks)
        try {
            if (typeof chrome !== 'undefined') {
                // Listen to tab events for real-time updates
                // NOTE: Using throttledUpdate which is a stable reference
                if (chrome.tabs) {
                    if (chrome.tabs.onCreated) chrome.tabs.onCreated.addListener(throttledUpdate);
                    if (chrome.tabs.onRemoved) chrome.tabs.onRemoved.addListener(throttledUpdate);
                    // SKIP onUpdated - it fires too frequently and causes memory pressure
                    // if (chrome.tabs.onUpdated) chrome.tabs.onUpdated.addListener(throttledUpdate);
                    if (chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(throttledUpdate);
                }

                // Listen to storage changes for chat and calendar updates
                if (chrome.storage && chrome.storage.onChanged) {
                    chrome.storage.onChanged.addListener(throttledUpdate);

                    return () => {
                        if (chrome.tabs) {
                            if (chrome.tabs.onCreated) chrome.tabs.onCreated.removeListener(throttledUpdate);
                            if (chrome.tabs.onRemoved) chrome.tabs.onRemoved.removeListener(throttledUpdate);
                            if (chrome.tabs.onActivated) chrome.tabs.onActivated.removeListener(throttledUpdate);
                        }
                        if (chrome.storage && chrome.storage.onChanged) {
                            chrome.storage.onChanged.removeListener(throttledUpdate);
                        }
                    };
                }
            }
        } catch (error) {
            console.warn('[ActivityFeed] Failed to setup event listeners', error);
            return () => { };
        }
        return () => { };
    }, [throttledUpdate]); // Only depend on stable throttledUpdate ref

    // Calculate how many favorite icons can fit in the available width
    const calculateVisibleFavorites = useCallback(() => {
        if (!favContainerRef.current) return;

        const container = favContainerRef.current;
        const styles = window.getComputedStyle(container);
        const paddingLeft = parseFloat(styles.paddingLeft) || 0;
        const paddingRight = parseFloat(styles.paddingRight) || 0;

        // Use container width minus the horizontal padding to get true content area
        const containerWidth = container.offsetWidth - paddingLeft - paddingRight;

        // Each icon is ~52px (44px width + 8px gap)
        const iconWidth = 52;
        const moreButtonWidth = 52;

        let count = Math.floor(containerWidth / iconWidth);

        // If we can't fit all items, reserve space for the "+N more" button
        if (quickLinks.length > count) {
            count = Math.floor((containerWidth - moreButtonWidth) / iconWidth);
        }

        // Show at least 1 item
        setVisibleFavCount(Math.max(1, count));
    }, [quickLinks.length]);

    // Recalculate on mount and resize
    useEffect(() => {
        calculateVisibleFavorites();

        const resizeObserver = new ResizeObserver(() => {
            calculateVisibleFavorites();
        });

        if (favContainerRef.current) {
            resizeObserver.observe(favContainerRef.current);
        }

        return () => resizeObserver.disconnect();
    }, [calculateVisibleFavorites, quickLinks]);

    const handleItemClick = async (url, item = null) => {
        if (!url) return;

        // Tab lives in another browser — ask the sidecar to focus it there
        // instead of opening a duplicate in this one.
        if (item?.remote) {
            try {
                await fetch(`${getHostUrl()}/cmd/jump-to-tab`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tabId: item.remoteTabId,
                        windowId: item.remoteWindowId,
                        url,
                        deviceId: item.deviceId,
                        browser: item.browser,
                    }),
                });
                return;
            } catch (e) {
                console.warn('[ActivityFeed] remote jump failed, opening locally', e);
            }
        }

        try {
            if (chrome?.tabs?.query) {
                const tabs = await chrome.tabs.query({});
                const existingTab = tabs.find(t => t.url === url || t.url === url + '/' || t.url.replace(/\/$/, '') === url);

                if (existingTab) {
                    await chrome.tabs.update(existingTab.id, { active: true });
                    if (existingTab.windowId && chrome.windows?.update) {
                        await chrome.windows.update(existingTab.windowId, { focused: true });
                    }
                    return;
                }
            }
        } catch (e) {
            console.error('Navigation error:', e);
        }

        window.open(url, '_blank');
    };

    // Close an actual open Chrome tab from the feed
    const handleCloseTab = async (tabItem, e) => {
        if (e) e.stopPropagation();
        const rawId = typeof tabItem.id === 'string' ? tabItem.id.replace(/^tab_/, '') : tabItem.id;
        const tabId = parseInt(rawId, 10);
        if (!Number.isFinite(tabId)) return;

        // Optimistically drop it from the feed for instant feedback;
        // chrome.tabs.onRemoved will reconcile the real state shortly after.
        setFeedItems(prev => prev.filter(i => i.id !== tabItem.id));
        try {
            if (chrome?.tabs?.remove) await chrome.tabs.remove(tabId);
        } catch (err) {
            console.error('Failed to close tab:', err);
        }
    };

    // Small × button shown on open-tab rows.
    // Tabs owned by another browser can't be closed via chrome.tabs.remove, so
    // they get no button rather than a dead one.
    const renderTabCloseBtn = (tabItem) => tabItem?.remote ? null : (
        <button
            className="feed-tab-close"
            type="button"
            title="Close tab"
            aria-label="Close tab"
            onClick={(e) => handleCloseTab(tabItem, e)}
            style={{
                flexShrink: 0,
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: '#94A3B8',
                cursor: 'pointer',
                fontSize: '12px',
                transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
                e.stopPropagation();
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)';
                e.currentTarget.style.color = '#F87171';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#94A3B8';
            }}
        >
            <FontAwesomeIcon icon={faXmark} />
        </button>
    );

    // Remove an app from the Search launcher. Built-ins are hidden (restorable);
    // user-added apps are deleted from the custom list.
    const removeSearchApp = (app, e) => {
        if (e) e.stopPropagation();
        if (app.custom) {
            setCustomSearchApps(prev => {
                const next = prev.filter(a => a.url !== app.url);
                try { localStorage.setItem('searchCustomApps', JSON.stringify(next)); } catch { /* ignore */ }
                return next;
            });
        } else {
            setHiddenSearchApps(prev => {
                const next = new Set(prev);
                next.add(app.name);
                try { localStorage.setItem('searchHiddenApps', JSON.stringify([...next])); } catch { /* ignore */ }
                return next;
            });
        }
    };

    const restoreSearchApps = () => {
        setHiddenSearchApps(new Set());
        try { localStorage.removeItem('searchHiddenApps'); } catch { /* ignore */ }
    };

    // Add a user-supplied URL to the Search launcher
    const addSearchApp = (raw) => {
        const input = (raw || '').trim();
        if (!input) return;
        const urlStr = /^https?:\/\//i.test(input) ? input : `https://${input}`;
        let host;
        try { host = new URL(urlStr).hostname.replace(/^www\./, '').toLowerCase(); } catch { return; }
        if (!host) return;

        // If this host already matches an existing app, just un-hide it (don't duplicate)
        const builtinMatch = SEARCH_APPS.find(a => a.domains.some(d => host === d || host.endsWith('.' + d)));
        const customMatch = customSearchApps.find(a => a.domains.some(d => host === d || host.endsWith('.' + d)));
        if (builtinMatch || customMatch) {
            if (builtinMatch) {
                setHiddenSearchApps(prev => {
                    if (!prev.has(builtinMatch.name)) return prev;
                    const next = new Set(prev); next.delete(builtinMatch.name);
                    try { localStorage.setItem('searchHiddenApps', JSON.stringify([...next])); } catch { /* ignore */ }
                    return next;
                });
            }
            setNewSearchUrl(''); setAddingSearchApp(false);
            return;
        }

        // Derive a display name from the registrable domain (perplexity.ai -> "Perplexity")
        const parts = host.split('.');
        const sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        const name = sld.charAt(0).toUpperCase() + sld.slice(1);
        const app = { name, url: urlStr, domains: [host], custom: true };

        setCustomSearchApps(prev => {
            const next = [...prev, app];
            try { localStorage.setItem('searchCustomApps', JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
        setNewSearchUrl(''); setAddingSearchApp(false);
    };

    // Grey "remove from list" button (hidden until row hover, like the close ×)
    const renderHideBtn = (app) => (
        <button
            className="feed-tab-close"
            type="button"
            title="Remove from Search"
            aria-label="Remove from Search"
            onClick={(e) => removeSearchApp(app, e)}
            style={{
                flexShrink: 0,
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: '#94A3B8',
                cursor: 'pointer',
                fontSize: '11px',
                transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
                e.stopPropagation();
                e.currentTarget.style.background = 'rgba(148, 163, 184, 0.18)';
                e.currentTarget.style.color = '#E2E8F0';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#94A3B8';
            }}
        >
            <FontAwesomeIcon icon={faEyeSlash} />
        </button>
    );

    // Fixed-width trailing slot so every row's right edge lines up regardless of
    // whether it has a close button. Pass the tab item to show ×, or null for an
    // empty (but space-reserving) slot.
    const renderActionSlot = (tabItem) => (
        <div style={{ width: '24px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '4px' }}>
            {tabItem ? renderTabCloseBtn(tabItem) : null}
        </div>
    );

    const formatTime = (ts) => {
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    // "Search" tab: curated launcher of search engines + AI tools.
    // If one is already open in a tab, badge it and focus that tab on click.
    const renderSearchApps = () => {
        // Built-ins the user hasn't hidden, plus any user-added apps
        const visibleApps = [
            ...SEARCH_APPS.filter(app => !hiddenSearchApps.has(app.name)),
            ...customSearchApps
        ];

        const openTabs = feedItems.filter(i => i.type === 'tab' && i.url);
        const activeByApp = {}; // app.name -> open tab item
        openTabs.forEach(tab => {
            let host = '';
            try { host = new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return; }
            // Pick the app with the most specific (longest) matching domain so
            // gemini.google.com maps to Gemini, not Google.
            let best = null, bestLen = -1;
            for (const app of visibleApps) {
                for (const d of app.domains) {
                    if ((host === d || host.endsWith('.' + d)) && d.length > bestLen) {
                        best = app; bestLen = d.length;
                    }
                }
            }
            if (best && !activeByApp[best.name]) activeByApp[best.name] = tab;
        });

        // Show currently-open ones first, keeping curated order within each group.
        const ordered = visibleApps.map((app, i) => ({ app, i }))
            .sort((a, b) => (activeByApp[b.app.name] ? 1 : 0) - (activeByApp[a.app.name] ? 1 : 0) || a.i - b.i)
            .map(x => x.app);

        const hiddenCount = hiddenSearchApps.size;

        return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {ordered.map(app => {
                    const activeTabItem = activeByApp[app.name];
                    const activeUrl = activeTabItem?.url;
                    return (
                        <div key={app.url || app.name}
                            className="feed-row"
                            onClick={() => handleItemClick(activeUrl || app.url)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px 16px',
                                cursor: 'pointer',
                                borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                                transition: 'background 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            {/* Icon */}
                            <div style={{ borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--accent-blue, #60a5fa)', overflow: 'hidden' }}>
                                <img
                                    src={getFaviconUrl(app.url, 32)}
                                    alt=""
                                    style={{ width: 'var(--font-5xl)', height: 'var(--font-5xl)', objectFit: 'contain' }}
                                    onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'block'; }}
                                />
                                <div style={{ display: 'none' }}>
                                    <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '16px' }} />
                                </div>
                            </div>

                            {/* Name */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: 'var(--font-base)',
                                    color: 'var(--text-primary, #F1F5F9)',
                                    fontWeight: 500,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {app.name}
                                </div>
                            </div>

                            {/* Active "Open" badge */}
                            {activeUrl && (
                                <div style={{
                                    flexShrink: 0,
                                    fontSize: 'var(--font-xs)',
                                    fontWeight: 600,
                                    color: '#34D399',
                                    background: 'rgba(16, 185, 129, 0.12)',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                }}>
                                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34D399' }}></span>
                                    Open
                                </div>
                            )}

                            {/* Hover actions: remove-from-list (always) + close-tab (when open). Fixed width keeps right edges aligned. */}
                            <div style={{ width: '52px', flexShrink: 0, marginLeft: '4px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
                                {renderHideBtn(app)}
                                {activeTabItem && renderTabCloseBtn(activeTabItem)}
                            </div>
                        </div>
                    );
                })}

                {/* Add a custom app */}
                {addingSearchApp ? (
                    <div style={{ display: 'flex', gap: '8px', margin: '10px 16px' }}>
                        <input
                            autoFocus
                            value={newSearchUrl}
                            onChange={e => setNewSearchUrl(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') addSearchApp(newSearchUrl);
                                else if (e.key === 'Escape') { setAddingSearchApp(false); setNewSearchUrl(''); }
                            }}
                            placeholder="Paste a URL — e.g. notion.so"
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '8px 10px',
                                background: 'rgba(15, 23, 42, 0.6)',
                                border: '1px solid rgba(96, 165, 250, 0.4)',
                                borderRadius: '8px',
                                color: '#E2E8F0',
                                fontSize: 'var(--font-sm)',
                                outline: 'none'
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => addSearchApp(newSearchUrl)}
                            style={{
                                padding: '8px 14px',
                                background: 'rgba(96, 165, 250, 0.18)',
                                border: '1px solid rgba(96, 165, 250, 0.45)',
                                borderRadius: '8px',
                                color: '#93C5FD',
                                fontSize: 'var(--font-sm)',
                                fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            Add
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setAddingSearchApp(true)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            margin: '10px 16px 4px 16px',
                            padding: '9px',
                            background: 'transparent',
                            border: '1px dashed rgba(96, 165, 250, 0.3)',
                            borderRadius: '8px',
                            color: '#93C5FD',
                            fontSize: 'var(--font-xs)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(96, 165, 250, 0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <FontAwesomeIcon icon={faPlus} style={{ fontSize: '10px' }} />
                        Add app
                    </button>
                )}

                {hiddenCount > 0 && (
                    <button
                        type="button"
                        onClick={restoreSearchApps}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            margin: '10px 16px',
                            padding: '8px',
                            background: 'transparent',
                            border: '1px dashed rgba(148, 163, 184, 0.25)',
                            borderRadius: '8px',
                            color: '#94A3B8',
                            fontSize: 'var(--font-xs)',
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)'; e.currentTarget.style.color = '#CBD5E1'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; }}
                    >
                        <FontAwesomeIcon icon={faRotateLeft} style={{ fontSize: '10px' }} />
                        Restore {hiddenCount} hidden {hiddenCount === 1 ? 'app' : 'apps'}
                    </button>
                )}
            </div>
        );
    };

    // Local dev servers (localhost/loopback/LAN, any port), derived from
    // deepActivity. Deduped by hostname:port, since that's what actually
    // tells two dev servers apart; an open tab wins the slot over a history
    // entry for the same port so clicking focuses it instead of opening a
    // duplicate.
    const localApps = useMemo(() => {
        const byLabel = new Map();

        deepActivity.tabs.forEach(tab => {
            if (!tab.url || !isLocalhostUrl(tab.url)) return;
            const label = getLocalUrlLabel(tab.url);
            byLabel.set(label, {
                id: `tab_${tab.id}`,
                label,
                title: tab.title || label,
                url: tab.url,
                timestamp: tab.lastAccessed || Date.now(),
                isOpen: true,
            });
        });

        deepActivity.history.forEach(item => {
            if (!item.url || !isLocalhostUrl(item.url)) return;
            const label = getLocalUrlLabel(item.url);
            if (byLabel.get(label)?.isOpen) return; // an open tab already claims this port
            const ts = item.lastVisitTime || 0;
            const existing = byLabel.get(label);
            if (!existing || ts > existing.timestamp) {
                byLabel.set(label, {
                    id: `hist_${item.id || item.url}`,
                    label,
                    title: item.title || label,
                    url: item.url,
                    timestamp: ts,
                    isOpen: false,
                    visitCount: item.visitCount || 1,
                });
            }
        });

        return [...byLabel.values()].sort((a, b) => (b.isOpen - a.isOpen) || b.timestamp - a.timestamp);
    }, [deepActivity]);

    // "Local" tab: dev servers detected on this run, same row layout/actions as
    // the other feed rows (renderActionSlot's × closes an open tab). Reads
    // localApps, defined above.
    const renderLocalApps = () => {
        if (localApps.length === 0) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '40px 20px',
                    color: '#64748B',
                    textAlign: 'center'
                }}>
                    <FontAwesomeIcon icon={faCode} style={{ fontSize: '20px', opacity: 0.5 }} />
                    <div style={{ fontSize: 'var(--font-sm)' }}>No local dev servers detected</div>
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {localApps.map(item => (
                    <div key={item.label}
                        className="feed-row"
                        onClick={() => handleItemClick(item.url, item)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                            transition: 'background 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#34D399',
                            flexShrink: 0
                        }}>
                            <FontAwesomeIcon icon={faCode} style={{ fontSize: '13px' }} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 'var(--font-base)',
                                color: 'var(--text-primary, #F1F5F9)',
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                {item.title || item.url}
                            </div>
                            <div style={{
                                fontSize: 'var(--font-xs)',
                                color: '#34D399',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                {item.label}
                            </div>
                        </div>

                        {item.isOpen && (
                            <div style={{
                                flexShrink: 0,
                                fontSize: 'var(--font-xs)',
                                fontWeight: 600,
                                color: '#34D399',
                                background: 'rgba(16, 185, 129, 0.12)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                            }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34D399' }}></span>
                                Open
                            </div>
                        )}

                        {renderActionSlot(item.isOpen ? item : null)}
                    </div>
                ))}
            </div>
        );
    };

    // Multi-service "suites" (Google, Microsoft, Apple, or anything else that
    // happens to qualify) — fully automatic, no hardcoded org list. Cluster
    // deepActivity (live tabs + 90-day history, not just the last 4h feed) by
    // base domain (getBaseDomainFromUrl, eTLD+1: mail.google.com and
    // drive.google.com are both "google.com") and count distinct services
    // within that cluster (getGroupDomainFromUrl, which keeps the subdomain —
    // the same "what site is this" vs. "should these sit together" split
    // TabManagement's domain grouping already relies on). A base domain
    // clears the bar once you've actually used SUITE_MIN_SERVICES or more
    // distinct products from it, ever, not because of who they are.
    //
    // Ranked by total usage (summed history visitCount across every URL under
    // that service), not last-visit time — an org you use constantly should
    // outrank one you glanced at once more recently, especially once there
    // are enough suites here to need scrolling to find the one you actually
    // want. Each service accumulates visitCount across every distinct URL on
    // that hostname (history returns one row per URL, not per hostname), and
    // an open tab marks isOpen without resetting that count.
    const orgSuites = useMemo(() => {
        const byBase = new Map(); // base domain -> Map(service hostname -> entry)

        const entryFor = (base, service) => {
            if (!byBase.has(base)) byBase.set(base, new Map());
            const services = byBase.get(base);
            if (!services.has(service)) {
                services.set(service, { service, id: null, title: null, url: null, timestamp: 0, isOpen: false, visitCount: 0 });
            }
            return services.get(service);
        };

        deepActivity.history.forEach(item => {
            if (!item.url) return;
            const base = getBaseDomainFromUrl(item.url);
            if (SUITE_SKIP_DOMAINS.has(base)) return;
            const entry = entryFor(base, getGroupDomainFromUrl(item.url));
            entry.visitCount += item.visitCount || 1;
            const ts = item.lastVisitTime || 0;
            if (ts >= entry.timestamp) {
                entry.timestamp = ts;
                entry.title = item.title || entry.title;
                entry.url = item.url;
                entry.id = `hist_${item.id || item.url}`;
            }
        });

        deepActivity.tabs.forEach(tab => {
            if (!tab.url) return;
            const base = getBaseDomainFromUrl(tab.url);
            if (SUITE_SKIP_DOMAINS.has(base)) return;
            const entry = entryFor(base, getGroupDomainFromUrl(tab.url));
            entry.isOpen = true;
            // An open tab is the clickable target (focuses it) even when a
            // history row happens to carry a numerically later timestamp —
            // but still let it fill in title/url if history never did.
            if (!entry.url || (tab.lastAccessed || 0) >= entry.timestamp) {
                entry.timestamp = tab.lastAccessed || entry.timestamp || Date.now();
                entry.title = tab.title || entry.title;
                entry.url = tab.url;
                entry.id = `tab_${tab.id}`;
            }
        });

        return [...byBase.entries()]
            .map(([base, services]) => {
                const list = [...services.values()].filter(s => s.url)
                    .sort((a, b) => (b.isOpen - a.isOpen) || (b.visitCount - a.visitCount) || (b.timestamp - a.timestamp));
                const totalVisits = list.reduce((sum, s) => sum + s.visitCount, 0);
                const latestTimestamp = list.reduce((max, s) => Math.max(max, s.timestamp), 0);
                return { base, services: list, totalVisits, latestTimestamp };
            })
            .filter(org => org.services.length >= SUITE_MIN_SERVICES)
            .sort((a, b) => b.totalVisits - a.totalVisits || b.latestTimestamp - a.latestTimestamp);
    }, [deepActivity]);

    // "Suites" tab: one header per qualifying org, its distinct services
    // listed underneath — same row layout/actions as the other feed rows.
    const renderSuites = () => {
        if (orgSuites.length === 0) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '40px 20px',
                    color: '#64748B',
                    textAlign: 'center'
                }}>
                    <FontAwesomeIcon icon={faLayerGroup} style={{ fontSize: '20px', opacity: 0.5 }} />
                    <div style={{ fontSize: 'var(--font-sm)' }}>No multi-service accounts detected yet</div>
                    <div style={{ fontSize: 'var(--font-xs)', opacity: 0.8 }}>
                        Shows up once you've used {SUITE_MIN_SERVICES}+ products from the same domain
                    </div>
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {orgSuites.map(org => (
                    <div key={org.base}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 16px 6px',
                        }}>
                            <img
                                src={getFaviconUrl(`https://${org.base}`, 32)}
                                alt=""
                                style={{ width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0 }}
                                onError={e => { e.target.style.visibility = 'hidden'; }}
                            />
                            <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary, #F1F5F9)' }}>
                                {org.base}
                            </span>
                            <span style={{ fontSize: 'var(--font-xs)', color: '#64748B' }}>
                                {org.services.length} services
                            </span>
                        </div>

                        {org.services.map(s => (
                            <div key={s.service}
                                className="feed-row"
                                onClick={() => handleItemClick(s.url, s)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '8px 16px 8px 42px',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: 'var(--font-base)',
                                        color: 'var(--text-primary, #F1F5F9)',
                                        fontWeight: 500,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {s.title}
                                    </div>
                                    <div style={{
                                        fontSize: 'var(--font-xs)',
                                        color: '#64748B',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {s.service}
                                    </div>
                                </div>

                                {s.isOpen && (
                                    <div style={{
                                        flexShrink: 0,
                                        fontSize: 'var(--font-xs)',
                                        fontWeight: 600,
                                        color: '#34D399',
                                        background: 'rgba(16, 185, 129, 0.12)',
                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                        padding: '2px 8px',
                                        borderRadius: '999px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px'
                                    }}>
                                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34D399' }}></span>
                                        Open
                                    </div>
                                )}

                                {renderActionSlot(s.isOpen ? s : null)}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        );
    };

    // Group tabs by domain and chats by platform for cleaner view
    const groupedFeedItems = useMemo(() => {
        const filtered = feedItems.filter(item => {
            if (activeTab === 'all') return true;
            // "Browsing" = only currently-open tabs (recent history + chats stay under "All Activity")
            if (activeTab === 'tabs') return item.type === 'tab';
            if (activeTab === 'apps') return item.type === 'app';
            return false;
        });

        // Separate items by type
        const chats = filtered.filter(item => item.type === 'chat');
        const tabs = filtered.filter(item => item.type === 'tab' || item.type === 'recent');
        // Apps only available in desktop mode
        const apps = isDesktopApp ? filtered.filter(item => item.type === 'app') : [];

        // Group chats by platform
        const chatsByPlatform = {};
        chats.forEach(chat => {
            const platform = chat.platform || 'Other';
            if (!chatsByPlatform[platform]) {
                chatsByPlatform[platform] = [];
            }
            chatsByPlatform[platform].push(chat);
        });

        // Sort each platform's chats by timestamp (newest first)
        Object.values(chatsByPlatform).forEach(platformChats => {
            platformChats.sort((a, b) => b.timestamp - a.timestamp);
        });

        // Convert to array of chat groups
        const groupedChats = Object.entries(chatsByPlatform)
            .map(([platform, platformChats]) => {
                const info = platformChats[0].platformInfo || {};
                return {
                    type: 'chat-group',
                    platform,
                    chats: platformChats,
                    latestTimestamp: platformChats[0].timestamp,
                    count: platformChats.length,
                    config: {
                        color: info.color || '#64748B',
                        emoji: null, // Use favicon instead
                        name: platform
                    }
                };
            })
            .sort((a, b) => b.latestTimestamp - a.latestTimestamp);

        // Group tabs by domain
        const tabsByDomain = {};
        tabs.forEach(tab => {
            let domain = 'other';
            try {
                domain = new URL(tab.url).hostname.replace('www.', '');
            } catch (e) { /* ignore */ }

            if (!tabsByDomain[domain]) {
                tabsByDomain[domain] = [];
            }
            tabsByDomain[domain].push(tab);
        });

        // Sort each domain's tabs by timestamp (newest first)
        Object.values(tabsByDomain).forEach(domainTabs => {
            domainTabs.sort((a, b) => b.timestamp - a.timestamp);
        });

        // Convert to array and sort by most recent tab in each group
        const groupedTabs = Object.entries(tabsByDomain)
            .map(([domain, domainTabs]) => ({
                type: 'tab-group',
                domain,
                tabs: domainTabs,
                latestTimestamp: domainTabs[0].timestamp,
                count: domainTabs.length
            }))
            .sort((a, b) => b.latestTimestamp - a.latestTimestamp);

        // Group apps by App Name (from activity tracking)
        const appsByName = {};
        apps.forEach(app => {
            const name = app.appName || 'Other';
            if (!appsByName[name]) {
                appsByName[name] = [];
            }
            appsByName[name].push(app);
        });

        Object.values(appsByName).forEach(appGroup => {
            appGroup.sort((a, b) => b.timestamp - a.timestamp);
        });

        const groupedApps = Object.entries(appsByName)
            .map(([name, appList]) => ({
                type: 'app-group',
                appName: name,
                apps: appList,
                latestTimestamp: appList[0].timestamp,
                count: appList.length,
                totalDuration: appList.reduce((acc, curr) => acc + (curr.duration || 0), 0)
            }))
            .sort((a, b) => b.latestTimestamp - a.latestTimestamp);

        // Create running apps list (apps currently running) - Desktop only
        const runningAppItems = isDesktopApp ? runningApps.map(app => ({
            id: `running-${app.pid || app.name}`,
            type: 'running-app',
            name: app.name,
            title: app.title || app.name,
            icon: app.icon,
            pid: app.pid,
            path: app.path,
            timestamp: Date.now(),
            isRunning: true
        })) : [];

        // Create installed apps list (all available apps, excluding running ones) - Desktop only
        const runningNames = new Set(runningApps.map(a => (a.name || '').toLowerCase()));
        const installedAppItems = isDesktopApp ? installedApps
            .filter(app => !runningNames.has((app.name || '').toLowerCase()))
            .slice(0, 20) // Limit to 20 installed apps
            .map(app => ({
                id: `installed-${app.name}`,
                type: 'installed-app',
                name: app.name,
                title: app.title || app.name,
                icon: app.icon,
                path: app.path,
                timestamp: 0, // No timestamp for installed apps
                isRunning: false
            })) : [];

        // Merge chat groups and tab groups
        const result = [];

        // Add chat groups (single chats stay as singles, multiple become groups)
        groupedChats.forEach(group => {
            if (group.count === 1) {
                result.push({ ...group.chats[0], isGrouped: false });
            } else {
                result.push(group);
            }
        });

        // Add tab groups (single tabs stay as singles, multiple become groups)
        groupedTabs.forEach(group => {
            if (group.count === 1) {
                result.push({ ...group.tabs[0], isGrouped: false });
            } else {
                result.push(group);
            }
        });

        // Add app groups (activity tracking)
        groupedApps.forEach(group => {
            if (group.count === 1) {
                result.push({ ...group.apps[0], isGrouped: false });
            } else {
                result.push(group);
            }
        });

        // For 'apps' tab or 'all' tab, also add running and installed apps
        if (activeTab === 'apps' || activeTab === 'all') {
            // Add running apps at the top
            runningAppItems.forEach(app => {
                result.push(app);
            });

            // Add installed apps section (only in 'apps' tab to avoid clutter)
            if (activeTab === 'apps' && installedAppItems.length > 0) {
                // Pre-sort installed apps by name here
                const sortedApps = [...installedAppItems].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                result.push({
                    id: 'installed-apps-grid',
                    type: 'installed-apps-grid',
                    apps: sortedApps,
                    timestamp: 0 // Keep at bottom
                });
            }
        }

        // Sort final result by timestamp (running apps first, then by time)
        return result.sort((a, b) => {
            // Running apps always first
            if (a.type === 'running-app' && b.type !== 'running-app') return -1;
            if (b.type === 'running-app' && a.type !== 'running-app') return 1;

            // Installed apps grid always last
            if ((a.type === 'installed-app' || a.type === 'installed-apps-grid') && (b.type !== 'installed-app' && b.type !== 'installed-apps-grid')) return 1;
            if ((b.type === 'installed-app' || b.type === 'installed-apps-grid') && (a.type !== 'installed-app' && a.type !== 'installed-apps-grid')) return -1;

            // Sort by name for individual installed apps if any sneak through
            if (a.type === 'installed-app' && b.type === 'installed-app') {
                return (a.name || '').localeCompare(b.name || '');
            }

            const tsA = a.type === 'tab-group' ? a.latestTimestamp :
                a.type === 'chat-group' ? a.latestTimestamp :
                    a.type === 'app-group' ? a.latestTimestamp : a.timestamp;

            const tsB = b.type === 'tab-group' ? b.latestTimestamp :
                b.type === 'chat-group' ? b.latestTimestamp :
                    b.type === 'app-group' ? b.latestTimestamp : b.timestamp;
            return tsB - tsA;
        });
    }, [feedItems, activeTab, runningApps, installedApps, isDesktopApp]);

    const toggleDomainExpand = useCallback((domain) => {
        startTransition(() => {
            setExpandedDomains(prev => {
                const next = new Set(prev);
                if (next.has(domain)) {
                    next.delete(domain);
                } else {
                    next.add(domain);
                }
                return next;
            });
        });
    }, []);

    return (
        <div className="cooldesk-panel activity-feed-panel" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Header: Favorites */}
            <div>
                <div style={{
                    padding: '16px 16px 12px 16px',
                    fontSize: 'var(--font-sm)',
                    fontWeight: 600,
                    color: '#94A3B8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <FontAwesomeIcon icon={faBookmark} /> Favorites
                </div>
                {/* Favorites Container */}
                <div
                    ref={favContainerRef}
                    className="favorites-scroll-container activity-feed-scroll"
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '0 16px 12px 16px',
                        alignItems: 'center'
                    }}
                >
                    {quickLinks.length > 0 ? quickLinks.map(link => (
                        <div key={link.id}
                            onClick={() => handleItemClick(link.url)}
                            title={link.title}
                            style={{
                                width: '44px',
                                height: '44px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(59, 130, 246, 0.12)',
                                border: '1.5px solid rgba(59, 130, 246, 0.25)',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                flexShrink: 0,
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                                e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)';
                                e.currentTarget.style.boxShadow = '0 8px 20px rgba(59, 130, 246, 0.3)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.12)';
                                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.25)';
                                e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        >
                            <img
                                src={getFaviconUrl(link.url, 24)}
                                onError={e => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'flex';
                                }}
                                style={{
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '4px',
                                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))'
                                }}
                            />
                            <FontAwesomeIcon
                                icon={faLink}
                                style={{
                                    display: 'none',
                                    fontSize: 'var(--font-xl)',
                                    color: 'rgba(96, 165, 250, 0.8)'
                                }}
                            />
                        </div>
                    )) : (
                        <div style={{ color: '#64748B', fontSize: '12px' }}>No favorites yet</div>
                    )}
                </div>
            </div>

            {/* Feed Tabs & List. Behavior is class-driven (.activity-feed-list):
                wide two-pane = scrolls inside the fixed-height card; stacked
                (≤600px) = grows and flows into the single page scroll. */}
            <div className="activity-feed-list" style={{ padding: '0', display: 'flex', flexDirection: 'column' }}>
                <div
                    className="activity-feed-sticky-tabs"
                    style={{
                        padding: '4px 16px 12px',
                        position: 'sticky',
                        top: 0,
                        // Solid-enough backing: rows scrolling underneath must not
                        // bleed through the segmented control. Colorless card color
                        // (.overview-activity-column.is-colorless) strips this back
                        // out via CSS — see cooldesk.css — so the whole column reads
                        // as fully transparent, not just its base layer.
                        background: 'rgba(11, 11, 14, 0.85)',
                        zIndex: 10,
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                    }}>
                    {/* Modern Pill-Style Segmented Control */}
                    <div style={{
                        display: 'inline-flex',
                        background: 'rgba(15, 23, 42, 0.5)',
                        border: '1px solid rgba(148, 163, 184, 0.12)',
                        borderRadius: '12px',
                        padding: '4px',
                        gap: '4px',
                        position: 'relative'
                    }}>
                        {(isDesktopApp ? ['all', 'chats', 'tabs', 'apps', 'local', 'suites', 'search'] : ['all', 'tabs', 'local', 'suites', 'search']).map(tab => {
                            const isActive = activeTab === tab;
                            return (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => setActiveTab(tab)}
                                    style={{
                                        appearance: 'none',
                                        WebkitAppearance: 'none',
                                        border: isActive ? '1px solid rgba(96, 165, 250, 0.45)' : '1px solid transparent',
                                        outline: 'none',
                                        padding: '7px 16px',
                                        borderRadius: '9px',
                                        background: isActive ? 'rgba(96, 165, 250, 0.18)' : 'transparent',
                                        color: isActive ? '#93C5FD' : '#94A3B8',
                                        fontSize: '12px',
                                        fontWeight: isActive ? 600 : 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                        textTransform: 'capitalize',
                                        position: 'relative',
                                        zIndex: 1,
                                        whiteSpace: 'nowrap',
                                        boxShadow: isActive ? '0 2px 8px rgba(96, 165, 250, 0.18)' : 'none'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)';
                                            e.currentTarget.style.color = '#CBD5E1';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.color = '#94A3B8';
                                        }
                                    }}
                                >
                                    {tab === 'all' ? 'All Activity' : tab === 'tabs' ? 'Browsing' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div
                    className="activity-feed-scroll"
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        minHeight: 0 // Important for flex children with overflow
                    }}>
                    {/* Calendar Tab Content */}
                    {activeTab === 'search' ? (
                        renderSearchApps()
                    ) : activeTab === 'local' ? (
                        renderLocalApps()
                    ) : activeTab === 'suites' ? (
                        renderSuites()
                    ) : activeTab === 'calendar' ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {/* Clock Header */}
                            <div style={{
                                padding: '16px',
                                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(30, 41, 59, 0.4))',
                                borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <div>
                                    <div style={{
                                        fontSize: 'var(--font-4xl)',
                                        fontWeight: 700,
                                        color: '#F8FAFC',
                                        fontFamily: 'monospace',
                                        lineHeight: '1',
                                        letterSpacing: '-1px'
                                    }}>
                                        {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div style={{
                                        fontSize: 'var(--font-sm)',
                                        color: '#94A3B8',
                                        marginTop: '4px',
                                        fontWeight: 500
                                    }}>
                                        {currentTime.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{
                                        padding: '4px 8px',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        borderRadius: '8px',
                                        fontSize: 'var(--font-xs)',
                                        color: '#CBD5E1'
                                    }}>
                                        {region}
                                    </span>
                                    <button
                                        onClick={triggerCalendarScrape}
                                        title="Sync Calendar"
                                        style={{
                                            border: 'none',
                                            background: 'rgba(59, 130, 246, 0.15)',
                                            color: '#60A5FA',
                                            padding: '6px 10px',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontSize: 'var(--font-sm)',
                                            fontWeight: 500
                                        }}
                                    >
                                        ↻ Sync
                                    </button>
                                </div>
                            </div>

                            {/* Calendar Events List */}
                            {calendarEvents.length === 0 ? (
                                <div style={{
                                    padding: '40px 20px',
                                    textAlign: 'center',
                                    color: '#64748B'
                                }}>
                                    <div style={{ fontSize: 'var(--font-3xl)', marginBottom: '8px', opacity: 0.5 }}>☕</div>
                                    <div style={{ fontSize: 'var(--font-base)' }}>No upcoming meetings</div>
                                    <div style={{ fontSize: 'var(--font-xs)', marginTop: '8px', color: '#475569' }}>
                                        Open Google Calendar to sync events
                                    </div>
                                </div>
                            ) : (
                                calendarEvents.map((evt, idx) => {
                                    const isAllDayEvent = evt.time && (evt.time.toLowerCase().includes('all day') || evt.time.toLowerCase().includes('unknown'));
                                    return (
                                        <div
                                            key={idx}
                                            onClick={() => evt.link && window.open(evt.link, '_blank')}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '12px 16px',
                                                cursor: evt.link ? 'pointer' : 'default',
                                                borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                                                transition: 'background 0.2s',
                                                position: 'relative'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            {/* Calendar Icon */}
                                            <div style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '10px',
                                                background: isAllDayEvent ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                                border: `1px solid ${isAllDayEvent ? 'rgba(16, 185, 129, 0.25)' : 'rgba(59, 130, 246, 0.25)'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                color: isAllDayEvent ? '#10B981' : '#60A5FA'
                                            }}>
                                                <FontAwesomeIcon icon={faCalendarAlt} style={{ fontSize: '16px' }} />
                                            </div>

                                            {/* Event Info */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: 'var(--font-base)',
                                                    color: '#E2E8F0',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    marginBottom: '2px'
                                                }}>
                                                    {evt.title}
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    color: '#94A3B8'
                                                }}>
                                                    {isAllDayEvent ? 'All Day' : evt.time || 'Time TBA'}
                                                </div>
                                            </div>

                                            {/* Join Button */}
                                            {evt.link && (
                                                <div style={{
                                                    fontSize: '10px',
                                                    fontWeight: 600,
                                                    color: '#60A5FA',
                                                    background: 'rgba(59, 130, 246, 0.1)',
                                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                                    padding: '4px 10px',
                                                    borderRadius: '6px'
                                                }}>
                                                    Join
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    ) : isLoading && feedItems.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#64748B' }}>Loading feed...</div>
                    ) : groupedFeedItems.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {groupedFeedItems.map((item, idx) => {
                                // Handle chat groups (multiple chats from same platform)
                                if (item.type === 'chat-group') {
                                    const isExpanded = expandedDomains.has(`chat-${item.platform}`);
                                    const showAll = chatsShowingAll.has(item.platform);
                                    const topChat = item.chats[0];
                                    const { emoji, color } = item.config;
                                    const favicon = getFaviconUrl(topChat.url, 32);

                                    // Determine which chats to show in the expanded list (skipping the top/first one which is in header)
                                    const displayedChats = showAll ? item.chats.slice(1) : item.chats.slice(1, 4);
                                    const remainingCount = item.chats.length - 1 - displayedChats.length;

                                    return (
                                        <div key={`chat-group-${item.platform}`} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.05)' }}>
                                            {/* Group Header */}
                                            <div
                                                onClick={() => toggleDomainExpand(`chat-${item.platform}`)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    padding: '12px 16px',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s',
                                                    position: 'relative'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                {/* Platform Icon */}
                                                <div
                                                    style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '12px',
                                                        background: `${color}20`,
                                                        border: `1px solid ${color}40`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '18px',
                                                        flexShrink: 0,
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    {favicon ? (
                                                        <img
                                                            src={favicon}
                                                            alt={item.platform}
                                                            style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                                                            onError={e => { e.target.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <span style={{ fontSize: '18px' }}>💬</span>
                                                    )}
                                                </div>

                                                {/* Info */}
                                                <div
                                                    onClick={() => handleItemClick(topChat.url)}
                                                    style={{ flex: 1, minWidth: 0 }}
                                                >
                                                    <div style={{
                                                        fontSize: 'var(--font-base)',
                                                        color: 'var(--text-primary, #F1F5F9)',
                                                        fontWeight: 500,
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        marginBottom: '2px'
                                                    }}>
                                                        {topChat.title}
                                                    </div>
                                                    <div style={{
                                                        fontSize: 'var(--font-xs)',
                                                        color: 'var(--text-secondary, #64748B)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}>
                                                        <span style={{ color }}>{item.platform}</span>
                                                        <span style={{ width: '2px', height: '2px', background: 'currentColor', borderRadius: '50%', opacity: 0.5 }}></span>
                                                        <span>{formatTime(topChat.timestamp)}</span>
                                                    </div>
                                                </div>

                                                {/* Count Badge + Expand Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleDomainExpand(`chat-${item.platform}`);
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        padding: '4px 10px',
                                                        borderRadius: '8px',
                                                        border: `1px solid ${color}50`,
                                                        background: isExpanded ? `${color}25` : `${color}15`,
                                                        color: color,
                                                        fontSize: 'var(--font-xs)',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    <span>{item.count} chats</span>
                                                    <FontAwesomeIcon
                                                        icon={faChevronDown}
                                                        style={{
                                                            fontSize: '10px',
                                                            transition: 'transform 0.2s',
                                                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                                                        }}
                                                    />
                                                </button>
                                                {/* Empty action slot keeps chat-group pills aligned with tab rows */}
                                                {renderActionSlot(null)}
                                            </div>

                                            {/* Expanded Chats */}
                                            {isExpanded && (
                                                <div style={{
                                                    background: 'rgba(0, 0, 0, 0.15)',
                                                    borderTop: '1px solid rgba(148, 163, 184, 0.05)'
                                                }}>
                                                    {displayedChats.map((chat, chatIdx) => (
                                                        <div
                                                            key={chat.id}
                                                            onClick={() => handleItemClick(chat.url)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '12px',
                                                                padding: '10px 16px 10px 48px',
                                                                cursor: 'pointer',
                                                                transition: 'background 0.2s',
                                                                borderBottom: chatIdx < displayedChats.length - 1 ? '1px solid rgba(148, 163, 184, 0.03)' : 'none'
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                        >
                                                            <img
                                                                src={getFaviconUrl(chat.url, 16)}
                                                                alt=""
                                                                style={{ width: '16px', height: '16px', objectFit: 'contain', marginRight: '8px' }}
                                                                onError={e => { e.target.style.display = 'none'; }}
                                                            />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{
                                                                    fontSize: 'var(--font-sm)',
                                                                    color: 'var(--text-primary, #E2E8F0)',
                                                                    whiteSpace: 'nowrap',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis'
                                                                }}>
                                                                    {chat.title}
                                                                </div>
                                                            </div>
                                                            <span style={{ fontSize: 'var(--font-xs)', color: '#64748B' }}>
                                                                {formatTime(chat.timestamp)}
                                                            </span>
                                                        </div>
                                                    ))}

                                                    {/* Show More Button */}
                                                    {!showAll && remainingCount > 0 && (
                                                        <div
                                                            style={{
                                                                padding: '8px 16px 8px 48px',
                                                                fontSize: 'var(--font-xs)',
                                                                color: '#60A5FA',
                                                                cursor: 'pointer',
                                                                background: 'rgba(59, 130, 246, 0.05)',
                                                                borderTop: '1px solid rgba(148, 163, 184, 0.05)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px'
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setChatsShowingAll(prev => {
                                                                    const next = new Set(prev);
                                                                    next.add(item.platform);
                                                                    return next;
                                                                });
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.05)'}
                                                        >
                                                            <span>Show {remainingCount} more chats</span>
                                                            <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: '10px' }} />
                                                        </div>
                                                    )}

                                                    {/* Show Less Button */}
                                                    {showAll && item.chats.length > 4 && (
                                                        <div
                                                            style={{
                                                                padding: '8px 16px 8px 48px',
                                                                fontSize: 'var(--font-xs)',
                                                                color: '#64748B',
                                                                cursor: 'pointer',
                                                                background: 'rgba(148, 163, 184, 0.05)',
                                                                borderTop: '1px solid rgba(148, 163, 184, 0.05)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px'
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setChatsShowingAll(prev => {
                                                                    const next = new Set(prev);
                                                                    next.delete(item.platform);
                                                                    return next;
                                                                });
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(148, 163, 184, 0.05)'}
                                                        >
                                                            <span>Show less</span>
                                                            <FontAwesomeIcon icon={faChevronDown} transform="rotate-180" style={{ fontSize: '10px' }} />
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // Handle tab groups (multiple tabs from same domain)
                                if (item.type === 'tab-group') {
                                    const isExpanded = expandedDomains.has(item.domain);
                                    const topTab = item.tabs[0];

                                    return (
                                        <div key={`group-${item.domain}`} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.05)' }}>
                                            {/* Group Header - Shows top tab with expand button */}
                                            <div
                                                className="feed-row"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    padding: '12px 16px',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s',
                                                    position: 'relative'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                {/* Icon */}
                                                <div
                                                    onClick={() => handleItemClick(topTab.url, topTab)}
                                                    style={{
                                                        borderRadius: '8px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '18px',
                                                        flexShrink: 0,
                                                        color: 'var(--accent-blue, #60a5fa)',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <img
                                                        src={topTab.favIconUrl || getFaviconUrl(topTab.url, 32)}
                                                        alt=""
                                                        style={{ width: 'var(--font-5xl)', height: 'var(--font-5xl)', objectFit: 'contain' }}
                                                        onError={e => {
                                                            e.target.style.display = 'none';
                                                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                                                        }}
                                                    />
                                                    <div style={{ display: 'none' }}>
                                                        <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '16px' }} />
                                                    </div>
                                                </div>

                                                {/* Info */}
                                                <div
                                                    onClick={() => handleItemClick(topTab.url, topTab)}
                                                    style={{ flex: 1, minWidth: 0 }}
                                                >
                                                    <div style={{
                                                        fontSize: 'var(--font-base)',
                                                        color: 'var(--text-primary, #F1F5F9)',
                                                        fontWeight: 500,
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        marginBottom: '2px'
                                                    }}>
                                                        {topTab.title}
                                                    </div>
                                                    <div style={{
                                                        fontSize: 'var(--font-xs)',
                                                        color: 'var(--text-secondary, #64748B)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}>
                                                        <span>{item.domain}</span>
                                                        <span style={{ width: '2px', height: '2px', background: 'currentColor', borderRadius: '50%', opacity: 0.5 }}></span>
                                                        <span>{formatTime(topTab.timestamp)}</span>
                                                        <RemoteBrowserBadge item={topTab} />
                                                    </div>
                                                </div>

                                                {/* Count Badge + Expand Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleDomainExpand(item.domain);
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        padding: '4px 10px',
                                                        borderRadius: '8px',
                                                        border: '1px solid rgba(59, 130, 246, 0.3)',
                                                        background: isExpanded ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)',
                                                        color: '#60A5FA',
                                                        fontSize: 'var(--font-xs)',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    <span>{item.count} tabs</span>
                                                    <FontAwesomeIcon
                                                        icon={faChevronDown}
                                                        style={{
                                                            fontSize: '10px',
                                                            transition: 'transform 0.2s',
                                                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                                                        }}
                                                    />
                                                </button>

                                                {/* Close the top tab of this group */}
                                                {renderActionSlot(topTab)}
                                            </div>

                                            {/* Expanded Tabs */}
                                            {isExpanded && (
                                                <div style={{
                                                    background: 'rgba(0, 0, 0, 0.15)',
                                                    borderTop: '1px solid rgba(148, 163, 184, 0.05)'
                                                }}>
                                                    {item.tabs.slice(1).map((tab, tabIdx) => (
                                                        <div
                                                            key={tab.id}
                                                            className="feed-row"
                                                            onClick={() => handleItemClick(tab.url, tab)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '12px',
                                                                padding: '10px 16px 10px 48px',
                                                                cursor: 'pointer',
                                                                transition: 'background 0.2s',
                                                                borderBottom: tabIdx < item.tabs.length - 2 ? '1px solid rgba(148, 163, 184, 0.03)' : 'none'
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                        >
                                                            <img
                                                                src={tab.favIconUrl || getFaviconUrl(tab.url, 20)}
                                                                alt=""
                                                                style={{ width: '20px', height: '20px', objectFit: 'contain', borderRadius: '4px' }}
                                                                onError={e => { e.target.style.display = 'none'; }}
                                                            />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{
                                                                    fontSize: 'var(--font-sm)',
                                                                    color: 'var(--text-primary, #E2E8F0)',
                                                                    whiteSpace: 'nowrap',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis'
                                                                }}>
                                                                    {tab.title}
                                                                </div>
                                                            </div>
                                                            <RemoteBrowserBadge item={tab} />
                                                            <span style={{ fontSize: 'var(--font-xs)', color: '#64748B' }}>
                                                                {formatTime(tab.timestamp)}
                                                            </span>
                                                            {renderActionSlot(tab)}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // Handle app groups
                                if (item.type === 'app-group') {
                                    const isExpanded = expandedDomains.has(item.appName);
                                    const topApp = item.apps[0];

                                    return (
                                        <div key={`group-${item.appName}`} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.05)' }}>
                                            {/* Group Header */}
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    padding: '12px 16px',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s',
                                                    position: 'relative'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                {/* Icon */}
                                                <div
                                                    onClick={() => { }}
                                                    style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '10px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '18px',
                                                        flexShrink: 0,
                                                        background: 'rgba(236, 72, 153, 0.15)', // Pinkish for apps
                                                        border: '1px solid rgba(236, 72, 153, 0.25)',
                                                        color: '#EC4899',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    🖥️
                                                </div>

                                                {/* Info */}
                                                <div
                                                    onClick={() => { }}
                                                    style={{ flex: 1, minWidth: 0 }}
                                                >
                                                    <div style={{
                                                        fontSize: 'var(--font-base)',
                                                        color: 'var(--text-primary, #F1F5F9)',
                                                        fontWeight: 500,
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        marginBottom: '2px'
                                                    }}>
                                                        {item.appName}
                                                    </div>
                                                    <div style={{
                                                        fontSize: 'var(--font-xs)',
                                                        color: 'var(--text-secondary, #64748B)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}>
                                                        <span>Desktop App</span>
                                                        <span style={{ width: '2px', height: '2px', background: 'currentColor', borderRadius: '50%', opacity: 0.5 }}></span>
                                                        <span>{formatTime(item.latestTimestamp)}</span>
                                                    </div>
                                                </div>

                                                {/* Count Badge + Expand Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleDomainExpand(item.appName);
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        padding: '4px 10px',
                                                        borderRadius: '8px',
                                                        border: '1px solid rgba(236, 72, 153, 0.3)',
                                                        background: isExpanded ? 'rgba(236, 72, 153, 0.15)' : 'rgba(236, 72, 153, 0.08)',
                                                        color: '#EC4899',
                                                        fontSize: 'var(--font-xs)',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    <span>{Math.round(item.totalDuration / 1000)}s total</span>
                                                    <FontAwesomeIcon
                                                        icon={faChevronDown}
                                                        style={{
                                                            fontSize: '10px',
                                                            transition: 'transform 0.2s',
                                                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                                                        }}
                                                    />
                                                </button>
                                            </div>

                                            {/* Expanded Apps */}
                                            {isExpanded && (
                                                <div style={{
                                                    background: 'rgba(0, 0, 0, 0.15)',
                                                    borderTop: '1px solid rgba(148, 163, 184, 0.05)'
                                                }}>
                                                    {item.apps.map((app, appIdx) => (
                                                        <div
                                                            key={app.id}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '12px',
                                                                padding: '10px 16px 10px 48px',
                                                                cursor: 'default',
                                                                transition: 'background 0.2s',
                                                                borderBottom: appIdx < item.apps.length - 1 ? '1px solid rgba(148, 163, 184, 0.03)' : 'none'
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                        >
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{
                                                                    fontSize: 'var(--font-sm)',
                                                                    color: 'var(--text-primary, #E2E8F0)',
                                                                    whiteSpace: 'nowrap',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis'
                                                                }}>
                                                                    {app.title}
                                                                </div>
                                                            </div>
                                                            <span style={{ fontSize: 'var(--font-xs)', color: '#64748B' }}>
                                                                {formatTime(app.timestamp)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // Handle running apps (currently active desktop apps)
                                if (item.type === 'running-app') {
                                    return (
                                        <div key={item.id}
                                            onClick={async () => {
                                                if (window.electronAPI?.focusApp && item.pid) {
                                                    try {
                                                        await window.electronAPI.focusApp(item.pid, item.name, item.hwnd, item.path);
                                                    } catch (e) {
                                                        // focusApp needs OS-level scripting permission and a
                                                        // window to raise; launchApp needs neither and reliably
                                                        // raises an already-running app's window too.
                                                        console.warn('[ActivityFeed] focusApp failed, falling back to launchApp:', e);
                                                        if (item.path && window.electronAPI?.launchApp) {
                                                            await window.electronAPI.launchApp(item.path);
                                                        }
                                                    }
                                                }
                                            }}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '12px 16px',
                                                cursor: 'pointer',
                                                borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                                                transition: 'background 0.2s',
                                                position: 'relative'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            {/* Icon */}
                                            <div style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '10px',
                                                background: 'rgba(34, 197, 94, 0.15)',
                                                border: '1px solid rgba(34, 197, 94, 0.25)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                overflow: 'hidden'
                                            }}>
                                                {item.icon ? (
                                                    <img
                                                        src={item.icon}
                                                        alt=""
                                                        style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                                        onError={e => { e.target.style.display = 'none'; }}
                                                    />
                                                ) : (
                                                    <span style={{ fontSize: '18px' }}>🖥️</span>
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: 'var(--font-base)',
                                                    color: 'var(--text-primary, #F1F5F9)',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    marginBottom: '2px'
                                                }}>
                                                    {item.name}
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    color: 'var(--text-secondary, #64748B)'
                                                }}>
                                                    {item.title !== item.name ? item.title : 'Running'}
                                                </div>
                                            </div>

                                            {/* Badge */}
                                            <div style={{
                                                fontSize: 'var(--font-xs)',
                                                fontWeight: 600,
                                                color: '#22C55E',
                                                background: 'rgba(34, 197, 94, 0.1)',
                                                border: '1px solid rgba(34, 197, 94, 0.2)',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                textTransform: 'uppercase',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22C55E' }}></div>
                                                Running
                                            </div>
                                        </div>
                                    );
                                }

                                // Handle installed apps grid
                                if (item.type === 'installed-apps-grid') {
                                    return (
                                        <div key="installed-apps" style={{ padding: '16px', borderBottom: '1px solid rgba(148, 163, 184, 0.05)' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#94A3B8', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                Installed Apps
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '12px' }}>
                                                {item.apps.map(app => (
                                                    <div key={app.id}
                                                        onClick={async () => { if (window.electronAPI?.launchApp && app.path) await window.electronAPI.launchApp(app.path); }}
                                                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '12px 8px', borderRadius: '12px', transition: 'all 0.2s', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)'; }}
                                                    >
                                                        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(100, 116, 139, 0.15)', border: '1px solid rgba(100, 116, 139, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {app.icon ? <img src={app.icon} style={{ width: '24px', height: '24px', objectFit: 'contain' }} alt="" onError={e => e.target.style.display = 'none'} /> : '📦'}
                                                        </div>
                                                        <div style={{ fontSize: '11px', color: '#E2E8F0', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                                                            {app.name}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }

                                // Handle installed apps (available but not running)
                                if (item.type === 'installed-app') {
                                    return (
                                        <div key={item.id}
                                            onClick={async () => {
                                                if (window.electronAPI?.launchApp && item.path) {
                                                    await window.electronAPI.launchApp(item.path);
                                                }
                                            }}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '12px 16px',
                                                cursor: 'pointer',
                                                borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                                                transition: 'background 0.2s',
                                                position: 'relative',
                                                opacity: 0.8
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'; e.currentTarget.style.opacity = '1'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '0.8'; }}
                                        >
                                            {/* Icon */}
                                            <div style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '10px',
                                                background: 'rgba(100, 116, 139, 0.15)',
                                                border: '1px solid rgba(100, 116, 139, 0.25)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                overflow: 'hidden'
                                            }}>
                                                {item.icon ? (
                                                    <img
                                                        src={item.icon}
                                                        alt=""
                                                        style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                                        onError={e => { e.target.style.display = 'none'; }}
                                                    />
                                                ) : (
                                                    <span style={{ fontSize: '18px' }}>📦</span>
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: 'var(--font-base)',
                                                    color: 'var(--text-primary, #F1F5F9)',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    marginBottom: '2px'
                                                }}>
                                                    {item.name}
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    color: 'var(--text-secondary, #64748B)'
                                                }}>
                                                    Click to launch
                                                </div>
                                            </div>

                                            {/* Badge */}
                                            <div style={{
                                                fontSize: 'var(--font-xs)',
                                                fontWeight: 600,
                                                color: '#64748B',
                                                background: 'rgba(100, 116, 139, 0.1)',
                                                border: '1px solid rgba(100, 116, 139, 0.2)',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                textTransform: 'uppercase'
                                            }}>
                                                Installed
                                            </div>
                                        </div>
                                    );
                                }

                                // Handle single items (chats, single tabs, recent history, calendar, single apps)
                                const isChat = item.type === 'chat';
                                const isCalendar = item.type === 'calendar';
                                const isApp = item.type === 'app';
                                const isRecent = item.type === 'recent';
                                const icon = isChat
                                    ? '💬'
                                    : isCalendar ? '📅'
                                        : isApp ? '🖥️' : null;

                                return (
                                    <div key={item.id}
                                        className="feed-row"
                                        onClick={() => handleItemClick(item.url, item)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '12px 16px',
                                            cursor: 'pointer',
                                            borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                                            transition: 'background 0.2s',
                                            position: 'relative'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        {/* Icon */}
                                        <div style={{
                                            borderRadius: isChat ? '12px' : '8px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '18px',
                                            flexShrink: 0,
                                            color: isChat ? 'var(--accent-purple, #8b5cf6)'
                                                : isCalendar ? '#10B981'
                                                    : isApp ? '#EC4899'
                                                        : 'var(--accent-blue, #60a5fa)',
                                            overflow: 'hidden'
                                        }}>
                                            {isApp ? (
                                                <div style={{ fontSize: '20px' }}>🖥️</div>
                                            ) : (
                                                <img
                                                    src={item.favIconUrl || getFaviconUrl(item.url, 32)}
                                                    alt=""
                                                    style={{ width: 'var(--font-5xl)', height: 'var(--font-5xl)', objectFit: 'contain' }}
                                                    onError={e => {
                                                        e.target.style.display = 'none';
                                                        if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                                                    }}
                                                />
                                            )}
                                            <div style={{ display: 'none' }}>
                                                {icon ? icon : <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '16px' }} />}
                                            </div>
                                        </div>

                                        {/* Info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: 'var(--font-base)',
                                                color: 'var(--text-primary, #F1F5F9)',
                                                fontWeight: 500,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                marginBottom: '2px'
                                            }}>
                                                {item.title}
                                            </div>
                                            <div style={{
                                                fontSize: 'var(--font-xs)',
                                                color: 'var(--text-secondary, #64748B)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px'
                                            }}>
                                                <span>{item.subtitle}</span>
                                                <span style={{ width: '2px', height: '2px', background: 'currentColor', borderRadius: '50%', opacity: 0.5 }}></span>
                                                <span>{formatTime(item.timestamp)}</span>
                                                <RemoteBrowserBadge item={item} />
                                            </div>
                                        </div>

                                        {/* Badge */}
                                        <div style={{ flexShrink: 0, marginLeft: '8px' }}>
                                            {isChat ? (
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    fontWeight: 600,
                                                    color: 'var(--accent-purple, #8B5CF6)',
                                                    background: 'var(--accent-purple-soft, rgba(139, 92, 246, 0.1))',
                                                    border: '1px solid var(--accent-purple-border, rgba(139, 92, 246, 0.2))',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Chat
                                                </div>
                                            ) : isCalendar ? (
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    fontWeight: 600,
                                                    color: '#10B981',
                                                    background: 'rgba(16, 185, 129, 0.1)',
                                                    border: '1px solid rgba(16, 185, 129, 0.2)',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Event
                                                </div>
                                            ) : isApp ? (
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    fontWeight: 600,
                                                    color: '#EC4899',
                                                    background: 'rgba(236, 72, 153, 0.1)',
                                                    border: '1px solid rgba(236, 72, 153, 0.2)',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    App
                                                </div>
                                            ) : isRecent ? (
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    fontWeight: 600,
                                                    color: '#64748B',
                                                    background: 'rgba(100, 116, 139, 0.1)',
                                                    border: '1px solid rgba(100, 116, 139, 0.2)',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase',
                                                }}>
                                                    Recent
                                                </div>
                                            ) : (
                                                <div style={{
                                                    fontSize: 'var(--font-xs)',
                                                    fontWeight: 600,
                                                    color: 'var(--accent-blue, #3B82F6)',
                                                    background: 'var(--accent-blue-soft, rgba(59, 130, 246, 0.1))',
                                                    border: '1px solid var(--accent-blue-border, rgba(59, 130, 246, 0.2))',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'currentColor' }}></div>
                                                    Tab
                                                </div>
                                            )}
                                        </div>

                                        {/* Action slot: close button for open tabs, empty otherwise (keeps right edges aligned) */}
                                        {renderActionSlot(item.type === 'tab' ? item : null)}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B' }}>
                            <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.5 }}>📭</div>
                            <div>No {activeTab === 'all' ? 'activity' : activeTab} found</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Custom scrollbar for favorites */}
            <style>{`
                /* Tab close button: hidden until the row is hovered (or focused via keyboard) */
                .feed-tab-close {
                    opacity: 0;
                    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
                }
                .feed-row:hover .feed-tab-close,
                .feed-tab-close:focus-visible {
                    opacity: 1;
                }

                .favorites-scroll-container::-webkit-scrollbar {
                    height: 6px;
                }
                .favorites-scroll-container::-webkit-scrollbar-track {
                    background: transparent;
                }
                .favorites-scroll-container::-webkit-scrollbar-thumb {
                    background-color: rgba(148, 163, 184, 0.3);
                    border-radius: 3px;
                }
                .favorites-scroll-container::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(148, 163, 184, 0.5);
                }
            `}</style>
        </div >
    );
}
