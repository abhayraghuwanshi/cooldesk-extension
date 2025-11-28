import { faGlobe, faRobot, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import '../../styles/default/AIChatsSection.css';
import { getFaviconUrl } from '../../utils.js';

// Platform icons/colors
const PLATFORM_CONFIG = {
  'ChatGPT': {
    url: 'https://chatgpt.com',
    color: '#10a37f'
  },
  'Claude': {
    url: 'https://claude.ai',
    color: '#cc785c'
  },
  'Gemini': {
    url: 'https://gemini.google.com',
    color: '#4285f4'
  },
  'Grok': {
    url: 'https://grok.com',
    color: '#1da1f2'
  }
};

const DEFAULT_VISIBLE_COUNT = 8;
const LOAD_STEP = 20;

export function AIChatsSection() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' or 'platform'
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('aiChats_collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Load chats from IndexedDB using unified API
  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      console.log('[AIChatsSection] Starting to load chats...');

      const response = await listScrapedChats({
        sortBy: 'scrapedAt',
        sortOrder: 'desc'
      });

      // Extract the data array from the response object
      const allChats = response?.data || response || [];

      console.log('[AIChatsSection] Loaded chats:', allChats);
      console.log('[AIChatsSection] Chat count:', allChats?.length || 0);
      console.log('[AIChatsSection] Is array?', Array.isArray(allChats));

      setChats(Array.isArray(allChats) ? allChats : []);
    } catch (error) {
      console.error('[AIChatsSection] Error loading chats:', error);
      console.error('[AIChatsSection] Error stack:', error.stack);
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE_COUNT);
  }, [selectedPlatform, sortBy, chats]);

  // Persist collapsed state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('aiChats_collapsed', String(isCollapsed));
    } catch (e) {
      console.warn('[AIChats] Failed to save collapsed state', e);
    }
  }, [isCollapsed]);

  // Filter and sort chats
  const filteredChats = (Array.isArray(chats) ? chats : [])
    .filter(chat => {
      // Platform filter
      if (selectedPlatform !== 'all' && chat.platform !== selectedPlatform) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'platform') {
        return a.platform.localeCompare(b.platform);
      }
      return (b.scrapedAt || 0) - (a.scrapedAt || 0);
    });

  const totalCount = filteredChats.length;
  const visibleChats = filteredChats.slice(0, Math.min(visibleCount, totalCount || DEFAULT_VISIBLE_COUNT));

  // Get unique platforms
  const platforms = [...new Set((Array.isArray(chats) ? chats : []).map(c => c.platform))].sort();

  // Group chats by platform for display
  const groupedVisibleChats = visibleChats.reduce((acc, chat) => {
    const platform = chat.platform || 'Unknown';
    if (!acc[platform]) acc[platform] = [];
    acc[platform].push(chat);
    return acc;
  }, {});

  const handleChatClick = (chat) => {
    // Open chat in new tab
    chrome.tabs.create({ url: chat.url });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // If collapsed, show only title
  if (isCollapsed) {
    return (
      <div
        onClick={() => setIsCollapsed(false)}
        style={{
          marginBottom: 'var(--section-spacing)',
          padding: '12px 20px',
          border: '1px solid rgba(70, 70, 75, 0.7)',
          borderRadius: '16px',
          background: 'rgba(28, 28, 33, 0.45)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(28, 28, 33, 0.65)';
          e.currentTarget.style.borderColor = 'rgba(100, 100, 105, 0.7)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(28, 28, 33, 0.45)';
          e.currentTarget.style.borderColor = 'rgba(70, 70, 75, 0.7)';
        }}
      >
        <h3 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          AI Chats
        </h3>
        <span style={{
          fontSize: '0.85rem',
          opacity: 0.5,
          color: 'var(--text-secondary, #aaa)'
        }}>
          Click to expand
        </span>
      </div>
    );
  }

  return (
    <div className="ai-chats-section">
      {/* Header with title and refresh */}
      <div className="ai-chats-header">
        <div
          onClick={() => setIsCollapsed(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            cursor: 'pointer',
            transition: 'opacity 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.7';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          <h3 style={{
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 600,
            margin: 0,
            color: '#ffffff',
            letterSpacing: '-0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            AI Chats
          </h3>
          <span style={{
            fontSize: '0.75rem',
            opacity: 0.4,
            color: 'var(--text-secondary, #aaa)'
          }}>
            Click to hide
          </span>
        </div>
        <div className="ai-chats-header-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`refresh-button ${loading ? 'loading' : ''}`}
            onClick={loadChats}
            disabled={loading}
            title="Refresh"
          >
            <FontAwesomeIcon icon={faSync} spin={loading} />
          </button>
          <div className="platform-filters">
            <button
              className={`platform-filter ${selectedPlatform === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedPlatform('all')}
              title="All Platforms"
            >
              <FontAwesomeIcon icon={faGlobe} />
            </button>
            {platforms.map(platform => {
              const platformUrls = {
                'ChatGPT': 'https://chat.openai.com',
                'Claude': 'https://claude.ai',
                'Gemini': 'https://gemini.google.com',
                'Grok': 'https://x.com'
              };
              const iconUrl = getFaviconUrl(platformUrls[platform] || platform, 32);

              return (
                <button
                  key={platform}
                  className={`platform-filter ${selectedPlatform === platform ? 'active' : ''}`}
                  onClick={() => setSelectedPlatform(platform)}
                  title={platform}
                >
                  <img
                    src={iconUrl}
                    alt={platform}
                    style={{ width: '16px', height: '16px', objectFit: 'contain' }}
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMSAxMWE0IDQgMCAwIDAtNC00SDdhNCA0IDAgMCAwLTMgNi43NjlWMTlhMyAzIDAgMCAwIDMgM2gxMGEzIDMgMCAwIDAgMy0zdi0yLjIzMUE0IDQgMCAwIDAgMjEgMTF6Ij48L3BhdGg+PGNpcmNsZSBjeD0iOSIgeT0iOSIgcj0iMiI+PC9jaXJjbGU+PGNpcmNsZSBjeD0iMTUiIGN5PSI5IiByPSIyIj48L2NpcmNsZT48L3N2Zz4=';
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>


      {/* Chats list */}
      <div className="ai-chats-list">
        {loading ? (
          <div className="loading-state">
            <FontAwesomeIcon icon={faSync} spin /> Loading chats...
          </div>
        ) : totalCount === 0 ? (
          <div className="empty-state">
            <FontAwesomeIcon icon={faRobot} size="3x" />
            <p>No AI chats found</p>
            <small>Visit ChatGPT, Claude, Gemini, or Grok to start scraping chats</small>
          </div>
        ) : sortBy === 'platform' ? (
          // Group by platform
          Object.entries(groupedVisibleChats).map(([platform, platformChats]) => (
            <div key={platform} className="platform-group">
              <div className="platform-header">
                {PLATFORM_CONFIG[platform]?.url ? (
                  <img
                    src={getFaviconUrl(PLATFORM_CONFIG[platform].url, 20)}
                    alt={platform}
                    className="platform-icon-img"
                  />
                ) : (
                  <span className="platform-icon" style={{ color: PLATFORM_CONFIG[platform]?.color }}>
                    🤖
                  </span>
                )}
                <span className="platform-name">{platform}</span>
                <span className="platform-count">({platformChats.length})</span>
              </div>
              {platformChats.map(chat => (
                <div
                  key={chat.chatId}
                  className="chat-item"
                  onClick={() => handleChatClick(chat)}
                >
                  <div className="chat-content">
                    <div className="chat-title">{chat.title}</div>
                    <div className="chat-meta">
                      <span className="chat-date">{formatDate(chat.scrapedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          // Flat list
          visibleChats.map(chat => (
            <div
              key={chat.chatId}
              className="chat-item"
              onClick={() => handleChatClick(chat)}
            >
              {PLATFORM_CONFIG[chat.platform]?.url ? (
                <img
                  src={getFaviconUrl(PLATFORM_CONFIG[chat.platform].url, 32)}
                  alt={chat.platform}
                  className="chat-platform-badge-img"
                />
              ) : (
                <span
                  className="chat-platform-badge"
                  style={{ backgroundColor: PLATFORM_CONFIG[chat.platform]?.color }}
                >
                  🤖
                </span>
              )}
              <div className="chat-content">
                <div className="chat-title">{chat.title}</div>
                {/* <div className="chat-meta">
                  <span className="chat-platform">{chat.platform}</span>
                  <span className="chat-separator">•</span>
                  <span className="chat-date">{formatDate(chat.scrapedAt)}</span>
                </div> */}
              </div>
            </div>
          ))
        )}
      </div>

      {totalCount > DEFAULT_VISIBLE_COUNT && (
        <div className="ai-chats-load-controls">
          {visibleChats.length < totalCount ? (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => Math.min(prev + LOAD_STEP, totalCount))}
            >
              Load more
            </button>
          ) : (
            <button type="button" onClick={() => setVisibleCount(DEFAULT_VISIBLE_COUNT)}>
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}