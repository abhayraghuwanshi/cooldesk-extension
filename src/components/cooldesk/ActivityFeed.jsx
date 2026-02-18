import {
    faBookmark,
    faCalendarAlt,
    faChevronDown,
    faGlobe,
    faLink
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import scrapperConfig from '../../data/scrapper.json';
import { getTimeSeriesDataRange, listScrapedChats } from '../../db/index.js';
import '../../styles/cooldesk.css';
import { getFaviconUrl, safeGetHostname } from '../../utils/helpers.js';


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

export function ActivityFeed() {
    const [quickLinks, setQuickLinks] = useState([]);
    const [feedItems, setFeedItems] = useState([]);
    const [calendarEvents, setCalendarEvents] = useState([]);
    const [activeTab, setActiveTab] = useState('all');
    const [isLoading, setIsLoading] = useState(true);
    const [visibleFavCount, setVisibleFavCount] = useState(8);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [region, setRegion] = useState('');
    const [expandedDomains, setExpandedDomains] = useState(new Set());
    const [chatsShowingAll, setChatsShowingAll] = useState(new Set());
    const [isPending, startTransition] = useTransition();
    const favContainerRef = useRef(null);

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
            // Priority: UI State -> Chrome History
            const { getUIState } = await import('../../db/index.js');
            const ui = await getUIState();

            let urls = [];

            if (ui?.quickUrls?.length > 0) {
                urls = ui.quickUrls.map((url, idx) => ({
                    id: `saved_${idx}`,
                    title: new URL(url).hostname,
                    url: url,
                    type: 'link',
                    hostname: new URL(url).hostname.replace('www.', '')
                }));
            } else if (typeof chrome !== 'undefined' && chrome.history && chrome.history.search) {
                const results = await chrome.history.search({
                    text: '',
                    maxResults: 50,
                    startTime: Date.now() - 30 * 24 * 60 * 60 * 1000
                });
                urls = results
                    .filter(i => i.url && !i.url.startsWith('chrome://'))
                    .sort((a, b) => b.visitCount - a.visitCount)
                    .map(item => ({
                        id: item.id || `hist_${Math.random()}`,
                        title: item.title || new URL(item.url).hostname,
                        url: item.url,
                        type: 'link',
                        hostname: new URL(item.url).hostname.replace('www.', '')
                    }));
            }

            // Deduplicate by hostname - keep only the first occurrence of each domain
            const seenHostnames = new Set();
            const uniqueUrls = urls.filter(item => {
                if (seenHostnames.has(item.hostname)) {
                    return false;
                }
                seenHostnames.add(item.hostname);
                return true;
            });

            return uniqueUrls.slice(0, 8);
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
        try {
            if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
                const tabs = await chrome.tabs.query({ currentWindow: true });
                const tabItems = tabs
                    .filter(t => !t.url.startsWith('chrome://'))
                    .map(tab => {
                        let hostname = 'Browser Tab';
                        try {
                            if (tab.url) hostname = new URL(tab.url).hostname;
                        } catch (e) {
                            // Invalid URL, keep default
                        }

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

        // Sort combined feed by timestamp (newest first)
        return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100); // CAP: Limit to 100 items
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
                    }).catch(console.error);
                }, THROTTLE_MS - timeSinceLastCall);
            }
        };
    }
    const throttledUpdate = throttledUpdateRef.current;

    useEffect(() => {
        const loadAll = async () => {
            setIsLoading(true);
            const [links, feed] = await Promise.all([loadQuickLinks(), loadFeed()]);
            setQuickLinks(links);
            setFeedItems(feed);
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
        const containerWidth = container.offsetWidth;

        // Each icon is ~52px (44px width + 8px gap), reserve ~50px for "+N more" button
        const iconWidth = 52;
        const reservedWidth = 50;
        const availableWidth = containerWidth - reservedWidth;

        const count = Math.floor(availableWidth / iconWidth);

        // Show at least 1 item, max 8
        setVisibleFavCount(Math.max(1, Math.min(count, 8)));
    }, []);

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

    const handleItemClick = async (url) => {
        if (!url) return;

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

    const formatTime = (ts) => {
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    // Group tabs by domain and chats by platform for cleaner view
    const groupedFeedItems = useMemo(() => {
        const filtered = feedItems.filter(item => {
            if (activeTab === 'all') return true;
            if (activeTab === 'chats') return item.type === 'chat';
            if (activeTab === 'tabs') return item.type === 'tab';
            if (activeTab === 'apps') return item.type === 'app';
            return false;
        });

        // Separate items by type
        const chats = filtered.filter(item => item.type === 'chat');
        const tabs = filtered.filter(item => item.type === 'tab');
        const apps = filtered.filter(item => item.type === 'app');

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

        // Group apps by App Name
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

        // Add app groups
        groupedApps.forEach(group => {
            if (group.count === 1) {
                result.push({ ...group.apps[0], isGrouped: false });
            } else {
                result.push(group);
            }
        });

        // Sort final result by timestamp
        return result.sort((a, b) => {
            const tsA = a.type === 'tab-group' ? a.latestTimestamp :
                a.type === 'chat-group' ? a.latestTimestamp :
                    a.type === 'app-group' ? a.latestTimestamp : a.timestamp;

            const tsB = b.type === 'tab-group' ? b.latestTimestamp :
                b.type === 'chat-group' ? b.latestTimestamp :
                    b.type === 'app-group' ? b.latestTimestamp : b.timestamp;
            return tsB - tsA;
        });
    }, [feedItems, activeTab]);

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
        <div className="cooldesk-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header: Favorites */}
            <div style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
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
                    className="favorites-scroll-container"
                    style={{
                        display: 'flex',
                        gap: '8px',
                        overflow: 'hidden',
                        padding: '0 16px 12px 16px',
                        alignItems: 'center'
                    }}
                >
                    {quickLinks.length > 0 ? quickLinks.slice(0, visibleFavCount).map(link => (
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

                    {/* +N More Indicator */}
                    {quickLinks.length > visibleFavCount && (
                        <div
                            style={{
                                width: '44px',
                                height: '44px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(148, 163, 184, 0.15)',
                                border: '1.5px solid rgba(148, 163, 184, 0.25)',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                flexShrink: 0,
                                fontSize: 'var(--font-sm)',
                                fontWeight: 600,
                                color: '#94A3B8'
                            }}
                            title={`${quickLinks.length - visibleFavCount} more favorites`}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(148, 163, 184, 0.25)';
                                e.currentTarget.style.color = '#E5E7EB';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(148, 163, 184, 0.15)';
                                e.currentTarget.style.color = '#94A3B8';
                            }}
                        >
                            +{quickLinks.length - visibleFavCount}
                        </div>
                    )}
                </div>
            </div>

            {/* Feed Tabs & List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0', display: 'flex', flexDirection: 'column' }}>
                <div style={{
                    padding: '16px',
                    position: 'sticky',
                    top: 0,
                    // background: 'var(--glass-bg, rgba(15, 23, 42, 0.95))',
                    zIndex: 10,
                    backdropFilter: 'blur(12px)',
                    // borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                    // borderRadius: '12px'
                }}>
                    {/* Modern Pill-Style Segmented Control */}
                    <div style={{
                        display: 'inline-flex',
                        // background: 'rgba(15, 23, 42, 0.6)',
                        // border: '1px solid rgba(148, 163, 184, 0.15)',
                        borderRadius: '12px',
                        padding: '4px',
                        gap: '4px',
                        position: 'relative'
                    }}>
                        {['all', 'chats', 'tabs', 'apps'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '8px 16px',
                                    // background: activeTab === tab
                                    //     ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.25), rgba(59, 130, 246, 0.15))'
                                    //     : 'transparent',
                                    // border: activeTab === tab
                                    //     ? '1px solid rgba(96, 165, 250, 0.8)'
                                    //     : '1px solid transparent',
                                    // borderRadius: '10px',
                                    color: activeTab === tab ? '#60A5FA' : '#94A3B8',
                                    fontSize: '12px',
                                    fontWeight: activeTab === tab ? 600 : 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    textTransform: 'capitalize',
                                    position: 'relative',
                                    zIndex: 1,
                                    whiteSpace: 'nowrap',
                                    // boxShadow: activeTab === tab
                                    //     ? '0 4px 12px rgba(96, 165, 250, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                                    //     : 'none'
                                }}
                                onMouseEnter={(e) => {
                                    if (activeTab !== tab) {
                                        e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)';
                                        e.currentTarget.style.color = '#CBD5E1';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (activeTab !== tab) {
                                        e.currentTarget.style.background = 'transparent';
                                        e.currentTarget.style.color = '#94A3B8';
                                    }
                                }}
                            >
                                {tab === 'all' ? 'All Activity' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    minHeight: 0 // Important for flex children with overflow
                }}>
                    {/* Calendar Tab Content */}
                    {activeTab === 'calendar' ? (
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
                                                    onClick={() => handleItemClick(topTab.url)}
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
                                                    onClick={() => handleItemClick(topTab.url)}
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
                                                            onClick={() => handleItemClick(tab.url)}
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
                                                            <span style={{ fontSize: 'var(--font-xs)', color: '#64748B' }}>
                                                                {formatTime(tab.timestamp)}
                                                            </span>
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

                                // Handle single items (chats, single tabs, calendar, single apps)
                                const isChat = item.type === 'chat';
                                const isCalendar = item.type === 'calendar';
                                const isApp = item.type === 'app';
                                const icon = isChat
                                    ? '💬'
                                    : isCalendar ? '📅'
                                        : isApp ? '🖥️' : null;

                                return (
                                    <div key={item.id}
                                        onClick={() => handleItemClick(item.url)}
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
