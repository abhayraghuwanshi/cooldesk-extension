import {
    faBookmark,
    faGlobe,
    faLink
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import '../../styles/cooldesk.css';
import { getFaviconUrl } from '../../utils.js';

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
    const [activeTab, setActiveTab] = useState('all');
    const [isLoading, setIsLoading] = useState(true);

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
            } else if (chrome?.history?.search) {
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
            if (chrome?.tabs?.query) {
                const tabs = await chrome.tabs.query({ currentWindow: true });
                const tabItems = tabs
                    .filter(t => !t.url.startsWith('chrome://'))
                    .map(tab => ({
                        id: `tab_${tab.id}`,
                        title: tab.title,
                        url: tab.url,
                        timestamp: tab.lastAccessed || Date.now(),
                        type: 'tab',
                        subtitle: new URL(tab.url).hostname,
                        favIconUrl: tab.favIconUrl
                    }));
                items.push(...tabItems);
            }
        } catch (e) {
            console.error('Failed to load tabs', e);
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
            const [links, feed] = await Promise.all([loadQuickLinks(), loadFeed()]);
            setQuickLinks(links);
            setFeedItems(feed);
            setIsLoading(false);
        };
        loadAll();

        // Event-driven updates with debouncing
        try {
            // Listen to tab events for real-time updates
            chrome.tabs.onCreated.addListener(debouncedUpdate);
            chrome.tabs.onRemoved.addListener(debouncedUpdate);
            chrome.tabs.onUpdated.addListener(debouncedUpdate);
            chrome.tabs.onActivated.addListener(debouncedUpdate);

            // Listen to storage changes for chat updates
            chrome.storage.onChanged.addListener(debouncedUpdate);

            return () => {
                chrome.tabs.onCreated.removeListener(debouncedUpdate);
                chrome.tabs.onRemoved.removeListener(debouncedUpdate);
                chrome.tabs.onUpdated.removeListener(debouncedUpdate);
                chrome.tabs.onActivated.removeListener(debouncedUpdate);
                chrome.storage.onChanged.removeListener(debouncedUpdate);
            };
        } catch (error) {
            console.warn('[ActivityFeed] Failed to setup event listeners', error);
            return () => { };
        }
    }, [loadQuickLinks, loadFeed, debouncedUpdate]);


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
                    fontSize: '12px',
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
                {/* Scrollable Container */}
                <div
                    className="favorites-scroll-container"
                    style={{
                        display: 'flex',
                        gap: '8px',
                        overflowX: 'auto',
                        padding: '0 16px 12px 16px', // Side padding + bottom padding
                        scrollbarWidth: 'thin', // Firefox: show thin scrollbar
                        scrollbarColor: 'rgba(148, 163, 184, 0.3) transparent', // Firefox
                        WebkitOverflowScrolling: 'touch'
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
                                    fontSize: '18px',
                                    color: 'rgba(96, 165, 250, 0.8)'
                                }}
                            />
                        </div>
                    )) : (
                        <div style={{ color: '#64748B', fontSize: '12px' }}>No favorites yet</div>
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
                        {['all', 'chats', 'tabs'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '8px 20px',
                                    background: activeTab === tab
                                        ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.25), rgba(59, 130, 246, 0.15))'
                                        : 'transparent',
                                    border: activeTab === tab
                                        ? '1px solid rgba(96, 165, 250, 0.4)'
                                        : '1px solid transparent',
                                    borderRadius: '10px',
                                    color: activeTab === tab ? '#60A5FA' : '#94A3B8',
                                    fontSize: '13px',
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
                    {isLoading && feedItems.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#64748B' }}>Loading feed...</div>
                    ) : feedItems.filter(item => activeTab === 'all' || item.type === (activeTab === 'chats' ? 'chat' : 'tab')).length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {feedItems
                                .filter(item => activeTab === 'all' || item.type === (activeTab === 'chats' ? 'chat' : 'tab'))
                                .map(item => {
                                    const isChat = item.type === 'chat';
                                    const icon = isChat
                                        ? PLATFORM_CONFIG[item.platform]?.emoji || '💬'
                                        : null;

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
                                                background: isChat ? 'var(--accent-purple-soft, rgba(139, 92, 246, 0.15))' : 'var(--accent-blue-soft, rgba(96, 165, 250, 0.15))',
                                                border: isChat ? '1px solid var(--accent-purple-border, rgba(139, 92, 246, 0.2))' : '1px solid var(--accent-blue-border, rgba(96, 165, 250, 0.2))',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '18px',
                                                flexShrink: 0,
                                                color: isChat ? 'var(--accent-purple, #8b5cf6)' : 'var(--accent-blue, #60a5fa)',
                                                overflow: 'hidden'
                                            }}>
                                                <img
                                                    src={item.favIconUrl || getFaviconUrl(item.url, 32)}
                                                    alt=""
                                                    style={{ width: '18px', height: '18px', objectFit: 'contain' }}
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
                                                    fontSize: '13px',
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
                                                    fontSize: '11px',
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
                                                        fontSize: '10px',
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
                                                ) : (
                                                    <div style={{
                                                        fontSize: '10px',
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
