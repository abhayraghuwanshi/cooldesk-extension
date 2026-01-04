import {
    faBookmark,
    faComments,
    faGlobe,
    faLink
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import '../../styles/cooldesk.css';
import { getFaviconUrl } from '../../utils.js';

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

    // Load Most Visited (Quick Access)
    const loadQuickLinks = useCallback(async () => {
        try {
            // Priority: UI State -> Chrome History
            const { getUIState } = await import('../../db/index.js');
            const ui = await getUIState();

            if (ui?.quickUrls?.length > 0) {
                return ui.quickUrls.slice(0, 8).map((url, idx) => ({
                    id: `saved_${idx}`,
                    title: new URL(url).hostname,
                    url: url,
                    type: 'link'
                }));
            }

            if (chrome?.history?.search) {
                const results = await chrome.history.search({
                    text: '',
                    maxResults: 50,
                    startTime: Date.now() - 30 * 24 * 60 * 60 * 1000
                });
                return results
                    .filter(i => i.url && !i.url.startsWith('chrome://'))
                    .sort((a, b) => b.visitCount - a.visitCount)
                    .slice(0, 8)
                    .map(item => ({
                        id: item.id || `hist_${Math.random()}`,
                        title: item.title || new URL(item.url).hostname,
                        url: item.url,
                        type: 'link'
                    }));
            }
        } catch (e) {
            console.error('Failed to load quick links', e);
        }
        return [];
    }, []);

    // Load Feed Items (Chats + Tabs)
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
                        timestamp: tab.lastAccessed || Date.now(), // Fallback if lastAccessed undefined
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
        return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20); // Top 20 items
    }, []);

    useEffect(() => {
        const loadAll = async () => {
            setIsLoading(true);
            const [links, feed] = await Promise.all([loadQuickLinks(), loadFeed()]);
            setQuickLinks(links);
            setFeedItems(feed);
            setIsLoading(false);
        };
        loadAll();

        // Refresh every 10s
        const interval = setInterval(loadAll, 10000);
        return () => clearInterval(interval);
    }, [loadQuickLinks, loadFeed]);

    const handleItemClick = (url) => {
        if (url) window.open(url, '_blank');
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
            <div style={{ padding: '16px', borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#94A3B8',
                    marginBottom: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <FontAwesomeIcon icon={faBookmark} /> Favorites
                </div>
                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
                    {quickLinks.length > 0 ? quickLinks.map(link => (
                        <div key={link.id}
                            onClick={() => handleItemClick(link.url)}
                            title={link.title}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: 'rgba(59, 130, 246, 0.1)',
                                border: '1px solid rgba(59, 130, 246, 0.2)',
                                borderRadius: '20px',
                                padding: '6px 12px',
                                fontSize: '12px',
                                color: '#E2E8F0',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                        >
                            <img
                                src={getFaviconUrl(link.url, 16)}
                                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }}
                                style={{ width: '14px', height: '14px', borderRadius: '2px' }}
                            />
                            <FontAwesomeIcon icon={faLink} style={{ display: 'none', fontSize: '10px' }} />
                            <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{link.title}</span>
                        </div>
                    )) : (
                        <div style={{ color: '#64748B', fontSize: '12px' }}>No favorites yet</div>
                    )}
                </div>
            </div>

            {/* Feed Tabs & List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0', display: 'flex', flexDirection: 'column' }}>
                <div style={{
                    padding: '16px 16px 0',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--glass-bg, rgba(15, 23, 42, 0.9))',
                    zIndex: 1,
                    backdropFilter: 'blur(8px)',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.1)'
                }}>
                    <div style={{
                        display: 'flex',
                        gap: '4px',
                        paddingBottom: '12px'
                    }}>
                        {['all', 'chats', 'tabs'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    background: activeTab === tab ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                    color: activeTab === tab ? '#60A5FA' : '#94A3B8',
                                    border: 'none',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    flex: 1
                                }}
                            >
                                {tab === 'all' ? 'All Activity' : tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ flex: 1, paddingBottom: '16px' }}>
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
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <div style={{
                                                width: '32px', height: '32px',
                                                borderRadius: '8px',
                                                background: isChat ? 'rgba(139, 92, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '16px',
                                                flexShrink: 0
                                            }}>
                                                {icon ? icon : (
                                                    <img src={item.favIconUrl || getFaviconUrl(item.url, 32)}
                                                        style={{ width: '16px', height: '16px' }}
                                                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }}
                                                    />
                                                )}
                                                {!icon && <FontAwesomeIcon icon={faGlobe} style={{ display: 'none', fontSize: '14px', color: '#60A5FA' }} />}
                                            </div>

                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: '13px',
                                                    color: '#F1F5F9',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis'
                                                }}>
                                                    {item.title}
                                                </div>
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: '#64748B',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px'
                                                }}>
                                                    {isChat && <FontAwesomeIcon icon={faComments} style={{ fontSize: '10px' }} />}
                                                    {!isChat && <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '10px' }} />}
                                                    <span>{item.subtitle}</span>
                                                    <span style={{ width: '2px', height: '2px', background: '#475569', borderRadius: '50%' }}></span>
                                                    <span>{formatTime(item.timestamp)}</span>
                                                </div>
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
        </div>
    );
}
