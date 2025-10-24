import { faComments, faRobot, faSync } from '@fortawesome/free-solid-svg-icons';
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

export function AIChatsSection() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' or 'platform'

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

  // Filter and sort chats
  const filteredChats = (Array.isArray(chats) ? chats : [])
    .filter(chat => {
      // Platform filter
      if (selectedPlatform !== 'all' && chat.platform !== selectedPlatform) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return chat.title?.toLowerCase().includes(query) ||
          chat.platform?.toLowerCase().includes(query);
      }

      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'platform') {
        return a.platform.localeCompare(b.platform);
      }
      return (b.scrapedAt || 0) - (a.scrapedAt || 0);
    });

  // Get unique platforms
  const platforms = [...new Set((Array.isArray(chats) ? chats : []).map(c => c.platform))].sort();

  // Group chats by platform for display
  const groupedChats = filteredChats.reduce((acc, chat) => {
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

  return (
    <div className="ai-chats-section">
      {/* Header with title and refresh */}
      <div className="ai-chats-header">
        <h2 className="coolDesk-section-title">
          <FontAwesomeIcon icon={faComments} /> AI Chats
          <span className="chat-count">({filteredChats.length})</span>
        </h2>
        <button className="refresh-button" onClick={loadChats} disabled={loading} title="Refresh">
          <FontAwesomeIcon icon={faSync} spin={loading} />
        </button>
      </div>

      {/* Search and filters in one row */}
      <div className="ai-chats-controls">
        <div className="ai-search-box">
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <select value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)} className="platform-filter">
          <option value="all">All</option>
          {platforms.map(platform => (
            <option key={platform} value={platform}>{platform}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-filter">
          <option value="recent">Recent</option>
          <option value="platform">Platform</option>
        </select>
      </div>



      {/* Chats list */}
      <div className="ai-chats-list">
        {loading ? (
          <div className="loading-state">
            <FontAwesomeIcon icon={faSync} spin /> Loading chats...
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="empty-state">
            <FontAwesomeIcon icon={faRobot} size="3x" />
            <p>No AI chats found</p>
            <small>Visit ChatGPT, Claude, Gemini, or Grok to start scraping chats</small>
          </div>
        ) : sortBy === 'platform' ? (
          // Group by platform
          Object.entries(groupedChats).map(([platform, platformChats]) => (
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
          filteredChats.map(chat => (
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
                <div className="chat-meta">
                  <span className="chat-platform">{chat.platform}</span>
                  <span className="chat-separator">•</span>
                  <span className="chat-date">{formatDate(chat.scrapedAt)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
