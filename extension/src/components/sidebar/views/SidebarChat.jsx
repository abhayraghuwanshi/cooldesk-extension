import { faExternalLinkAlt, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { listScrapedChats } from '../../../db/index.js';
import '../../../styles/theme.css';
import { getFaviconUrl } from '../../../utils/helpers.js';

const PLATFORM_CONFIG = {
    'ChatGPT': { url: 'https://chat.openai.com', emoji: '💬', accentColor: '#10a37f' },
    'Claude': { url: 'https://claude.ai', emoji: '🤖', accentColor: '#8b5cf6' },
    'Gemini': { url: 'https://gemini.google.com', emoji: '💎', accentColor: '#3b82f6' },
    'Grok': { url: 'https://x.com', emoji: '🚀', accentColor: '#fb923c' },
    'Perplexity': { url: 'https://www.perplexity.ai', emoji: '🔍', accentColor: '#10b981' },
    'AI Studio': { url: 'https://aistudio.google.com', emoji: '🧪', accentColor: '#4285F4' },
    'Lovable': { url: 'https://lovable.dev', emoji: '💜', accentColor: '#8b5cf6' },
};

/**
 * SidebarChat - Lists scraped AI chats for quick access
 */
export function SidebarChat() {
    const [chats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadChats = async () => {
        setLoading(true);
        try {
            const res = await listScrapedChats({ sortBy: 'scrapedAt', sortOrder: 'desc', limit: 50 });
            // Handle various response formats
            let data = [];
            if (Array.isArray(res)) data = res;
            else if (res?.data && Array.isArray(res.data)) data = res.data;

            setChats(data);
        } catch (e) {
            console.error('[SidebarChat] Error loading chats:', e);
            setChats([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadChats();
    }, []);

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '16px'
            }}>
                <h2 style={{
                    fontSize: 'var(--font-xl)', fontWeight: 700, margin: 0,
                    color: 'var(--text)'
                }}>
                    AI Chats
                </h2>
                <button
                    onClick={loadChats}
                    className="btn-ghost"
                    style={{
                        borderRadius: '50%', width: '32px', height: '32px',
                        padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title="Refresh"
                >
                    <FontAwesomeIcon icon={faSync} spin={loading} />
                </button>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '20px' }}>
                        Loading...
                    </div>
                ) : chats.length === 0 ? (
                    <div style={{
                        textAlign: 'center', color: 'var(--text-secondary)',
                        marginTop: '40px', padding: '20px',
                        border: '1px dashed var(--border-primary)', borderRadius: '12px'
                    }}>
                        No recorded AI chats found.
                    </div>
                ) : (
                    chats.map(chat => {
                        const platform = PLATFORM_CONFIG[chat.platform] || { emoji: '🔴', accentColor: 'var(--text-secondary)' };
                        const faviconUrl = platform.url ? getFaviconUrl(platform.url, 20) : null;

                        return (
                            <div
                                key={chat.id || chat.chatId}
                                onClick={() => window.open(chat.url, '_blank')}
                                className="glass-card"
                                style={{
                                    padding: '12px',
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    cursor: 'pointer',
                                    borderLeft: `3px solid ${platform.accentColor}`
                                }}
                            >
                                <div style={{
                                    width: '32px', height: '32px', borderRadius: '8px',
                                    background: 'var(--surface-3)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    {faviconUrl ? (
                                        <img src={faviconUrl} alt="" style={{ width: '16px', height: '16px' }} />
                                    ) : (
                                        <span style={{ fontSize: 'var(--font-lg)' }}>{platform.emoji}</span>
                                    )}
                                </div>
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{
                                        fontSize: 'var(--font-base)', fontWeight: 500, color: 'var(--text)',
                                        whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden'
                                    }}>
                                        {chat.title || 'Untitled Chat'}
                                    </div>
                                    <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                                        {chat.platform} • {formatTime(chat.scrapedAt)}
                                    </div>
                                </div>
                                <FontAwesomeIcon icon={faExternalLinkAlt} style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }} />
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
