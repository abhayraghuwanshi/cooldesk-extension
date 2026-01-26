import {
    faBookmark,
    faCalendarAlt,
    faGlobe,
    faLink
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import '../../styles/cooldesk.css';
import { getFaviconUrl } from '../../utils/helpers.js';

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Platform config for chats (reused)
const PLATFORM_CONFIG = {
    'ChatGPT': { emoji: '💬', color: '#10A37F' },
    'Claude': { emoji: '🤖', color: '#8B5CF6' },
    'Gemini': { emoji: '💎', color: '#3B82F6' },
    'Grok': { emoji: '🚀', color: '#F97316' },
    'Perplexity': { emoji: '🔍', color: '#14B8A6' },
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
            const chatRes = await listScrapedChats({ sortBy: 'scrapedAt', sortOrder: 'desc' });
            const chats = (chatRes.data || chatRes || []).slice(0, 10).map(chat => ({
                id: chat.id,
                title: chat.title || 'Untitled Chat',
                url: chat.url,
                timestamp: new Date(chat.scrapedAt || chat.lastVisitTime).getTime(),
                type: 'chat',
                platform: chat.platform,
                subtitle: chat.platform
            }));
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
        } catch (e) {
            console.error('Failed to load calendar items', e);
        }

        // Sort combined feed by timestamp (newest first)
        return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    }, []);

    // Debounced update handler (500ms delay)
    const debouncedUpdate = useMemo(
        () => debounce(async () => {
            setIsLoading(true);
            const [links, feed] = await Promise.all([loadQuickLinks(), loadFeed()]);
            setQuickLinks(links);
            setFeedItems(feed);
            setIsLoading(false);
        }, 500),
        [loadQuickLinks, loadFeed]
    );

    useEffect(() => {
        const loadAll = async () => {
            setIsLoading(true);
            const [links, feed] = await Promise.all([loadQuickLinks(), loadFeed(), loadCalendarEvents()]);
            setQuickLinks(links);
            setFeedItems(feed);
            setIsLoading(false);
        };
        loadAll();

        // Event-driven updates with debouncing
        try {
            if (typeof chrome !== 'undefined') {
                // Listen to tab events for real-time updates
                if (chrome.tabs) {
                    chrome.tabs.onCreated.addListener(debouncedUpdate);
                    chrome.tabs.onRemoved.addListener(debouncedUpdate);
                    chrome.tabs.onUpdated.addListener(debouncedUpdate);
                    chrome.tabs.onActivated.addListener(debouncedUpdate);
                }

                // Listen to storage changes for chat and calendar updates
                if (chrome.storage) {
                    const storageListener = (changes) => {
                        if (changes.calendar_events) {
                            setCalendarEvents(changes.calendar_events.newValue || []);
                        }
                        debouncedUpdate();
                    };
                    chrome.storage.onChanged.addListener(storageListener);

                    return () => {
                        if (chrome.tabs) {
                            chrome.tabs.onCreated.removeListener(debouncedUpdate);
                            chrome.tabs.onRemoved.removeListener(debouncedUpdate);
                            chrome.tabs.onUpdated.removeListener(debouncedUpdate);
                            chrome.tabs.onActivated.removeListener(debouncedUpdate);
                        }
                        if (chrome.storage) {
                            chrome.storage.onChanged.removeListener(storageListener);
                        }
                    };
                }
            }
        } catch (error) {
            console.warn('[ActivityFeed] Failed to setup event listeners', error);
            return () => { };
        }
        return () => { };
    }, [loadQuickLinks, loadFeed, loadCalendarEvents, debouncedUpdate]);

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
                    background: 'var(--glass-bg, rgba(15, 23, 42, 0.95))',
                    zIndex: 10,
                    backdropFilter: 'blur(12px)',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.1)'
                }}>
                    {/* Modern Pill-Style Segmented Control */}
                    <div style={{
                        display: 'inline-flex',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(148, 163, 184, 0.15)',
                        borderRadius: '12px',
                        padding: '4px',
                        gap: '4px',
                        position: 'relative'
                    }}>
                        {['all', 'calendar', 'chats', 'tabs'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '8px 16px',
                                    background: activeTab === tab
                                        ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.25), rgba(59, 130, 246, 0.15))'
                                        : 'transparent',
                                    border: activeTab === tab
                                        ? '1px solid rgba(96, 165, 250, 0.4)'
                                        : '1px solid transparent',
                                    borderRadius: '10px',
                                    color: activeTab === tab ? '#60A5FA' : '#94A3B8',
                                    fontSize: '12px',
                                    fontWeight: activeTab === tab ? 600 : 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    textTransform: 'capitalize',
                                    position: 'relative',
                                    zIndex: 1,
                                    whiteSpace: 'nowrap',
                                    boxShadow: activeTab === tab
                                        ? '0 4px 12px rgba(96, 165, 250, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                                        : 'none'
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
                    ) : feedItems.filter(item => activeTab === 'all' || item.type === (activeTab === 'chats' ? 'chat' : 'tab')).length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {feedItems
                                .filter(item => activeTab === 'all' || item.type === (activeTab === 'chats' ? 'chat' : 'tab'))
                                .map(item => {
                                    const isChat = item.type === 'chat';
                                    const isCalendar = item.type === 'calendar';
                                    const icon = isChat
                                        ? PLATFORM_CONFIG[item.platform]?.emoji || '💬'
                                        : isCalendar ? '📅' : null;

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
                                                width: '36px', height: '36px',
                                                borderRadius: isChat ? '12px' : '8px',
                                                background: isChat ? 'var(--accent-purple-soft, rgba(139, 92, 246, 0.15))' : isCalendar ? 'rgba(16, 185, 129, 0.15)' : 'var(--accent-blue-soft, rgba(96, 165, 250, 0.15))',
                                                border: isChat ? '1px solid var(--accent-purple-border, rgba(139, 92, 246, 0.2))' : isCalendar ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid var(--accent-blue-border, rgba(96, 165, 250, 0.2))',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '18px',
                                                flexShrink: 0,
                                                color: isChat ? 'var(--accent-purple, #8b5cf6)' : isCalendar ? '#10B981' : 'var(--accent-blue, #60a5fa)',
                                                overflow: 'hidden'
                                            }}>
                                                <img
                                                    src={item.favIconUrl || getFaviconUrl(item.url, 32)}
                                                    alt=""
                                                    style={{ width: 'var(--font-5xl)', height: 'var(--font-5xl)', objectFit: 'contain' }}
                                                    onError={e => {
                                                        e.target.style.display = 'none';
                                                        // Show fallback icon if image fails
                                                        if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                                                    }}
                                                />
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
