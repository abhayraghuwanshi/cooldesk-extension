import { faComments, faRobot, faSearch, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useCallback, useEffect, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import '../../styles/default/AIChatsSection.css';

// Platform icons/colors
const PLATFORM_CONFIG = {
  'ChatGPT': { icon: '🤖', color: '#10a37f' },
  'Claude': { icon: '🧠', color: '#cc785c' },
  'Gemini': { icon: '✨', color: '#4285f4' },
  'Grok': { icon: '⚡', color: '#1da1f2' }
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
      const allChats = await listScrapedChats({
        sortBy: 'scrapedAt',
        sortOrder: 'desc'
      });
      
      setChats(allChats);
      console.log('[AIChatsSection] Loaded chats:', allChats.length);
    } catch (error) {
      console.error('[AIChatsSection] Error loading chats:', error);
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Filter and sort chats
  const filteredChats = chats
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
  const platforms = [...new Set(chats.map(c => c.platform))].sort();

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
      <div className="ai-chats-header">
        <h2 className="coolDesk-section-title">
          <FontAwesomeIcon icon={faComments} /> AI Chats
        </h2>
        <button 
          className="refresh-button"
          onClick={loadChats}
          disabled={loading}
          title="Refresh chats"
        >
          <FontAwesomeIcon icon={faSync} spin={loading} />
        </button>
      </div>

      {/* Search and filters */}
      <div className="ai-chats-controls">
        <div className="search-box">
          <FontAwesomeIcon icon={faSearch} className="search-icon" />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-controls">
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="platform-filter"
          >
            <option value="all">All Platforms</option>
            {platforms.map(platform => (
              <option key={platform} value={platform}>{platform}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="sort-filter"
          >
            <option value="recent">Recent First</option>
            <option value="platform">By Platform</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="ai-chats-stats">
        <span>{filteredChats.length} chat{filteredChats.length !== 1 ? 's' : ''}</span>
        {platforms.length > 0 && (
          <span> • {platforms.length} platform{platforms.length !== 1 ? 's' : ''}</span>
        )}
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
                <span className="platform-icon" style={{ color: PLATFORM_CONFIG[platform]?.color }}>
                  {PLATFORM_CONFIG[platform]?.icon || '🤖'}
                </span>
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
              <span 
                className="chat-platform-badge"
                style={{ backgroundColor: PLATFORM_CONFIG[chat.platform]?.color }}
              >
                {PLATFORM_CONFIG[chat.platform]?.icon || '🤖'}
              </span>
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
