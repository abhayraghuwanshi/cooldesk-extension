import { faArrowRight, faComments, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import { getFaviconUrl } from '../../utils.js';

// Platform configuration matching AIChats.jsx
const PLATFORM_CONFIG = {
  'ChatGPT': {
    url: 'https://chat.openai.com',
    emoji: '💬',
  },
  'Claude': {
    url: 'https://claude.ai',
    emoji: '🤖',
  },
  'Gemini': {
    url: 'https://gemini.google.com',
    emoji: '💎',
  },
  'Grok': {
    url: 'https://x.com',
    emoji: '🚀',
  },
  'Perplexity': {
    url: 'https://www.perplexity.ai',
    emoji: '🔍',
  },
};

const AI_PLATFORMS = [
  { name: 'ChatGPT', url: 'https://chat.openai.com', color: 'rgba(16, 163, 127, 0.15)', borderColor: 'rgba(16, 163, 127, 0.3)', textColor: '#6EE7B7', hoverBg: 'rgba(16, 163, 127, 0.25)', hoverBorder: 'rgba(16, 163, 127, 0.5)' },
  { name: 'Claude', url: 'https://claude.ai', color: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.3)', textColor: '#C4B5FD', hoverBg: 'rgba(139, 92, 246, 0.25)', hoverBorder: 'rgba(139, 92, 246, 0.5)' },
  { name: 'Gemini', url: 'https://gemini.google.com', color: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.3)', textColor: '#93C5FD', hoverBg: 'rgba(59, 130, 246, 0.25)', hoverBorder: 'rgba(59, 130, 246, 0.5)' },
  { name: 'Grok', url: 'https://x.com', color: 'rgba(251, 146, 60, 0.15)', borderColor: 'rgba(251, 146, 60, 0.3)', textColor: '#FCA5A5', hoverBg: 'rgba(251, 146, 60, 0.25)', hoverBorder: 'rgba(251, 146, 60, 0.5)' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai', color: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', textColor: '#A7F3D0', hoverBg: 'rgba(16, 185, 129, 0.25)', hoverBorder: 'rgba(16, 185, 129, 0.5)' },
];

export function RecentChats({ maxItems = 5 }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      console.log('[RecentChats] Starting to load chats...');
      const response = await listScrapedChats({
        sortBy: 'scrapedAt',
        sortOrder: 'desc',
      });

      console.log('[RecentChats] Raw response:', response);
      console.log('[RecentChats] Response type:', typeof response);
      console.log('[RecentChats] Is Array:', Array.isArray(response));

      const allChats = response?.data || response || [];
      console.log('[RecentChats] All chats:', allChats);
      console.log('[RecentChats] All chats length:', allChats.length);

      const finalChats = Array.isArray(allChats) ? allChats.slice(0, maxItems) : [];
      console.log('[RecentChats] Final chats to display:', finalChats);

      setChats(finalChats);
    } catch (error) {
      console.error('[RecentChats] Error loading chats:', error);
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, [maxItems]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const handleChatClick = (chat) => {
    if (chat.url) {
      window.open(chat.url, '_blank');
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getIcon = (platform) => {
    return PLATFORM_CONFIG[platform]?.emoji || '💬';
  };

  const getPlatformUrl = (platform) => {
    return PLATFORM_CONFIG[platform]?.url || null;
  };

  if (loading) {
    return (
      <div className="cooldesk-panel">
        <div className="panel-header">
          <div className="panel-title">Recent Chats</div>
        </div>
        <div style={{ textAlign: 'center', padding: '30px 16px', color: '#64748B' }}>
          <FontAwesomeIcon icon={faSync} spin style={{ fontSize: 'var(--font-3xl, 20px)', marginBottom: '10px' }} />
          <div style={{ fontSize: 'var(--font-lg, 14px)' }}>Loading chats...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cooldesk-panel">
      <div className="panel-header">
        <div className="panel-title">
          <FontAwesomeIcon icon={faComments} style={{ marginRight: '8px' }} />
          Recent Chats
        </div>
        <div className="panel-action" onClick={loadChats} title="Refresh">
          <FontAwesomeIcon icon={faSync} />
          <span>Refresh</span>
        </div>
      </div>

      {chats.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '30px 16px',
          color: '#64748B',
          fontSize: 'var(--font-lg, 14px)',
        }}>
          <div style={{ fontSize: 'var(--font-5xl, 28px)', marginBottom: '10px' }}>💬</div>
          <div>No AI chats yet</div>
          <div style={{ fontSize: 'var(--font-md, 12px)', marginTop: '6px', opacity: 0.7 }}>
            Visit ChatGPT, Claude, or Gemini to start tracking your chats
          </div>
          <div style={{ fontSize: 'var(--font-md, 12px)', marginTop: '4px', opacity: 0.5, fontStyle: 'italic' }}>
            Chats will automatically appear here when you visit AI platforms
          </div>
        </div>
      ) : (
        <ul className="recent-chats-list">
          {chats.map((chat, index) => {
            // Get platform base URL instead of chat URL
            const platformUrl = getPlatformUrl(chat.platform);
            const faviconUrl = platformUrl ? getFaviconUrl(platformUrl, 20) : null;

            console.log('[RecentChats] Chat item:', {
              platform: chat.platform,
              platformUrl,
              faviconUrl,
              title: chat.title
            });

            return (
              <li
                key={chat.id || index}
                className="recent-chat-item cooldesk-flex"
                onClick={() => handleChatClick(chat)}
                style={{ cursor: 'pointer' }}
              >
                <div className="chat-icon">
                  {faviconUrl ? (
                    <img
                      src={faviconUrl}
                      alt={chat.platform || 'Chat'}
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '4px',
                        objectFit: 'contain',
                        padding: '2px'
                      }}
                      onError={(e) => {
                        // Fallback to emoji icon if favicon fails to load
                        console.error('[RecentChats] Favicon failed to load:', faviconUrl);
                        e.target.style.display = 'none';
                        e.target.parentElement.textContent = getIcon(chat.platform);
                      }}
                    />
                  ) : (
                    getIcon(chat.platform)
                  )}
                </div>
                <div className="chat-content">
                  <div className="chat-title">
                    {chat.title || 'Untitled Chat'}
                  </div>
                  <div className="chat-time">
                    {formatTime(chat.scrapedAt || chat.lastVisitTime)}
                  </div>
                </div>
                <FontAwesomeIcon
                  icon={faArrowRight}
                  style={{
                    color: '#64748B',
                    fontSize: 'var(--font-xl, 14px)',
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                  }}
                  className="chat-arrow"
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* AI Platform Quick Access */}
      <div style={{
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(148, 163, 184, 0.15)',
        flexShrink: 0,
      }}>
        <div className="recommended-header" style={{ marginBottom: '10px' }}>Quick Access</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {AI_PLATFORMS.map((platform) => {
            const faviconUrl = getFaviconUrl(platform.url, 16);
            return (
              <button
                key={platform.name}
                onClick={() => window.open(platform.url, '_blank')}
                style={{
                  background: platform.color,
                  border: `1px solid ${platform.borderColor}`,
                  borderRadius: '6px',
                  padding: '6px 10px',
                  color: platform.textColor,
                  fontSize: 'var(--font-md, 12px)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = platform.hoverBg;
                  e.currentTarget.style.borderColor = platform.hoverBorder;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = platform.color;
                  e.currentTarget.style.borderColor = platform.borderColor;
                }}
              >
                {faviconUrl && (
                  <img
                    src={faviconUrl}
                    alt={platform.name}
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '2px',
                      flexShrink: 0,
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                {platform.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* View All Chats - Below Horizontal Line */}
      {/* <div
        style={{
          marginTop: '12px',
          paddingTop: '12px',
          borderTop: '1px solid rgba(148, 163, 184, 0.15)',
          flexShrink: 0,
        }}
      >
        <div
          className="panel-action"
          style={{
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          onClick={() => {
            // TODO: Navigate to all chats view
            console.log('[RecentChats] View All Chats clicked');
          }}
        >
          <span>View All Chats</span>
          <FontAwesomeIcon icon={faArrowRight} />
        </div>
      </div> */}

      <style jsx>{`
        .recent-chat-item:hover .chat-arrow {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
