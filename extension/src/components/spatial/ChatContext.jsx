import { faArrowRight, faPlus, faSync, faTimes, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import { getFaviconUrl } from '../../utils/helpers.js';

/**
 * ChatContext - Project Links interface for workspace
 *
 * Features:
 * - Manual link saving with URL + title
 * - Auto-collected links from scraped AI platforms
 * - Quick access to scraped platforms
 */

// Platform styling configuration
const PLATFORM_STYLES = {
  'ChatGPT': { color: 'rgba(16, 163, 127, 0.15)', borderColor: 'rgba(16, 163, 127, 0.3)', textColor: '#6EE7B7', hoverBg: 'rgba(16, 163, 127, 0.25)', hoverBorder: 'rgba(16, 163, 127, 0.5)' },
  'Claude': { color: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.3)', textColor: '#C4B5FD', hoverBg: 'rgba(139, 92, 246, 0.25)', hoverBorder: 'rgba(139, 92, 246, 0.5)' },
  'Gemini': { color: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.3)', textColor: '#93C5FD', hoverBg: 'rgba(59, 130, 246, 0.25)', hoverBorder: 'rgba(59, 130, 246, 0.5)' },
  'Grok': { color: 'rgba(251, 146, 60, 0.15)', borderColor: 'rgba(251, 146, 60, 0.3)', textColor: '#FCA5A5', hoverBg: 'rgba(251, 146, 60, 0.25)', hoverBorder: 'rgba(251, 146, 60, 0.5)' },
  'Perplexity': { color: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', textColor: '#A7F3D0', hoverBg: 'rgba(16, 185, 129, 0.25)', hoverBorder: 'rgba(16, 185, 129, 0.5)' },
  'AI Studio': { color: 'rgba(66, 133, 244, 0.15)', borderColor: 'rgba(66, 133, 244, 0.3)', textColor: '#93C5FD', hoverBg: 'rgba(66, 133, 244, 0.25)', hoverBorder: 'rgba(66, 133, 244, 0.5)' },
  'Lovable': { color: 'rgba(167, 139, 250, 0.15)', borderColor: 'rgba(167, 139, 250, 0.3)', textColor: '#C4B5FD', hoverBg: 'rgba(167, 139, 250, 0.25)', hoverBorder: 'rgba(167, 139, 250, 0.5)' },
};

// Default style for unknown platforms
const DEFAULT_PLATFORM_STYLE = {
  color: 'rgba(100, 116, 139, 0.15)',
  borderColor: 'rgba(100, 116, 139, 0.3)',
  textColor: '#94A3B8',
  hoverBg: 'rgba(100, 116, 139, 0.25)',
  hoverBorder: 'rgba(100, 116, 139, 0.5)'
};

// Storage key for saved links
const SAVED_LINKS_KEY = 'chatContext_savedLinks';

export function ChatContext({ workspaceId, workspaceName, maxItems = 20 }) {
  const [chats, setChats] = useState([]);
  const [allScrapedChats, setAllScrapedChats] = useState([]); // Store all chats for filtering
  const [savedLinks, setSavedLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [scrapedPlatforms, setScrapedPlatforms] = useState([]);
  const [activePlatformFilter, setActivePlatformFilter] = useState(null); // Filter by platform

  // Load saved links from storage
  const loadSavedLinks = useCallback(() => {
    try {
      const stored = localStorage.getItem(SAVED_LINKS_KEY);
      if (stored) {
        setSavedLinks(JSON.parse(stored));
      }
    } catch (error) {
      console.error('[ChatContext] Error loading saved links:', error);
    }
  }, []);

  // Save link to storage
  const saveLink = useCallback((url, title) => {
    try {
      // Ensure URL has protocol
      let finalUrl = url;
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl;
      }

      const newLink = {
        id: Date.now().toString(),
        url: finalUrl,
        title: title || new URL(finalUrl).hostname,
        savedAt: Date.now(),
        type: 'manual'
      };
      const updated = [newLink, ...savedLinks];
      setSavedLinks(updated);
      localStorage.setItem(SAVED_LINKS_KEY, JSON.stringify(updated));
      setNewLinkUrl('');
      setNewLinkTitle('');
      setShowAddLink(false);
    } catch (error) {
      console.error('[ChatContext] Error saving link:', error);
    }
  }, [savedLinks]);

  // Delete saved link
  const deleteLink = useCallback((linkId) => {
    const updated = savedLinks.filter(l => l.id !== linkId);
    setSavedLinks(updated);
    localStorage.setItem(SAVED_LINKS_KEY, JSON.stringify(updated));
  }, [savedLinks]);

  // Load chats from scraped data
  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await listScrapedChats({
        sortBy: 'scrapedAt',
        sortOrder: 'desc',
      });

      const allChats = response?.data || response || [];
      const chatArray = Array.isArray(allChats) ? allChats : [];

      // Store all chats for filtering
      setAllScrapedChats(chatArray);

      // Show limited chats initially
      const finalChats = chatArray.slice(0, maxItems);
      setChats(finalChats);

      // Extract unique platforms with their URLs and count for Quick Access
      const platformMap = new Map();
      chatArray.forEach(chat => {
        if (chat.platform && chat.url) {
          if (!platformMap.has(chat.platform)) {
            try {
              const url = new URL(chat.url);
              platformMap.set(chat.platform, { url: url.origin, count: 1 });
            } catch {
              // Invalid URL, skip
            }
          } else {
            platformMap.get(chat.platform).count++;
          }
        }
      });

      // Convert to array with styling and count
      const platforms = Array.from(platformMap.entries()).map(([name, data]) => ({
        name,
        url: data.url,
        count: data.count,
        ...(PLATFORM_STYLES[name] || DEFAULT_PLATFORM_STYLE)
      }));
      setScrapedPlatforms(platforms);
    } catch (error) {
      console.error('[ChatContext] Error loading chats:', error);
      setChats([]);
      setAllScrapedChats([]);
    } finally {
      setLoading(false);
    }
  }, [maxItems]);

  useEffect(() => {
    loadChats();
    loadSavedLinks();
  }, [loadChats, loadSavedLinks]);

  const handleLinkClick = (url) => {
    if (url) {
      window.open(url, '_blank');
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

  const getIcon = () => {
    return '🔗';
  };

  // When a platform filter is active, show all chats from that platform
  // Otherwise show recent chats (limited by maxItems)
  const filteredChats = activePlatformFilter
    ? allScrapedChats.filter(c => c.platform === activePlatformFilter)
    : chats;

  // Build links list - saved links first (sorted by save time), then scraped links
  const sortedSavedLinks = activePlatformFilter
    ? []
    : [...savedLinks].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map(l => ({ ...l, source: 'saved' }));

  // Scraped links - sort by scrapedAt descending (most recently active first)
  const scrapedLinks = [...filteredChats]
    .sort((a, b) => (b.scrapedAt || 0) - (a.scrapedAt || 0))
    .map(c => ({
      id: c.id,
      url: c.url,
      title: c.title,
      platform: c.platform,
      source: 'auto'
    }));

  const allLinks = [...sortedSavedLinks, ...scrapedLinks];

  if (loading) {
    return (
      <div className="cooldesk-panel" style={{ height: '100%' }}>
        <div className="panel-header">
          <div className="panel-title">Project Links</div>
        </div>
        <div style={{ textAlign: 'center', padding: '30px 16px', color: '#64748B' }}>
          <FontAwesomeIcon icon={faSync} spin style={{ fontSize: 'var(--font-3xl, 20px)', marginBottom: '10px' }} />
          <div style={{ fontSize: 'var(--font-lg, 14px)' }}>Loading links...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      gap: '16px',
      overflow: 'hidden'
    }}>
      {/* Main Links Panel */}
      <div className="cooldesk-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header">
          <div className="panel-title">
            {/* <FontAwesomeIcon icon={faLink} style={{ marginRight: '8px' }} /> */}
            {activePlatformFilter ? (
              <>
                {activePlatformFilter}
                <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: '4px' }}>
                  ({allLinks.length})
                </span>
              </>
            ) : (
              <h3 style={{
                fontSize: 'var(--font-2xl, 20px)',
                fontWeight: 600,
                color: 'var(--text-primary, #F1F5F9)',
                // fontFamily: defaultFontFamily,
                marginBottom: '16px',
                marginTop: 0
              }}>
                Project Links
              </h3>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {activePlatformFilter && (
              <div
                className="panel-action"
                onClick={() => setActivePlatformFilter(null)}
                title="Show all links"
                style={{ color: '#FCA5A5' }}
              >
                <FontAwesomeIcon icon={faTimes} />
              </div>
            )}
            {!activePlatformFilter && (
              <div
                className="panel-action"
                onClick={() => setShowAddLink(!showAddLink)}
                title="Add Link"
                style={{ color: showAddLink ? '#A78BFA' : undefined }}
              >
                <FontAwesomeIcon icon={showAddLink ? faTimes : faPlus} />
              </div>
            )}
            <div className="panel-action" onClick={loadChats} title="Refresh">
              <FontAwesomeIcon icon={faSync} />
            </div>
          </div>
        </div>

        {/* Add Link Form */}
        {showAddLink && (
          <div style={{
            padding: '12px',
            background: 'rgba(139, 92, 246, 0.08)',
            borderRadius: '8px',
            marginBottom: '12px',
            border: '1px solid rgba(139, 92, 246, 0.2)'
          }}>
            <input
              type="text"
              placeholder="Paste URL..."
              value={newLinkUrl}
              onChange={(e) => setNewLinkUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '6px',
                color: '#F1F5F9',
                fontSize: 'var(--font-sm, 12px)',
                marginBottom: '8px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLinkUrl.trim()) {
                  saveLink(newLinkUrl.trim(), newLinkTitle.trim());
                }
              }}
              autoFocus
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={newLinkTitle}
              onChange={(e) => setNewLinkTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '6px',
                color: '#F1F5F9',
                fontSize: 'var(--font-sm, 12px)',
                marginBottom: '8px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLinkUrl.trim()) {
                  saveLink(newLinkUrl.trim(), newLinkTitle.trim());
                }
              }}
            />
            <button
              onClick={() => newLinkUrl.trim() && saveLink(newLinkUrl.trim(), newLinkTitle.trim())}
              disabled={!newLinkUrl.trim()}
              style={{
                width: '100%',
                padding: '8px',
                background: newLinkUrl.trim() ? 'rgba(139, 92, 246, 0.3)' : 'rgba(100, 116, 139, 0.2)',
                border: '1px solid',
                borderColor: newLinkUrl.trim() ? 'rgba(139, 92, 246, 0.5)' : 'rgba(100, 116, 139, 0.3)',
                borderRadius: '6px',
                color: newLinkUrl.trim() ? '#A78BFA' : '#64748B',
                fontSize: 'var(--font-sm, 12px)',
                fontWeight: 600,
                cursor: newLinkUrl.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s'
              }}
            >
              Save Link
            </button>
          </div>
        )}

        {/* Links List */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {allLinks.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '30px 16px',
              color: '#64748B',
              fontSize: 'var(--font-lg, 14px)',
            }}>
              <div style={{ fontSize: 'var(--font-5xl, 28px)', marginBottom: '10px' }}>🔗</div>
              <div>No project links yet</div>
              <div style={{ fontSize: 'var(--font-base, 13px)', marginTop: '6px', opacity: 0.7 }}>
                Add links manually or visit AI platforms to auto-collect
              </div>
            </div>
          ) : (
            <ul className="recent-chats-list">
              {allLinks.map((link, index) => {
                const faviconUrl = link.url ? getFaviconUrl(link.url, 20) : null;

                return (
                  <li
                    key={link.id || index}
                    className="recent-chat-item cooldesk-flex"
                    onClick={() => handleLinkClick(link.url)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="chat-icon">
                      {faviconUrl ? (
                        <img
                          src={faviconUrl}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '4px',
                            objectFit: 'contain',
                            padding: '2px'
                          }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.textContent = getIcon();
                          }}
                        />
                      ) : (
                        getIcon()
                      )}
                    </div>
                    <div className="chat-content">
                      <div className="chat-title">
                        {link.title || 'Untitled Link'}
                      </div>
                      <div className="chat-time" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {link.source === 'saved' ? (
                          // Show time only for manually saved links
                          formatTime(link.savedAt)
                        ) : link.platform ? (
                          // Show platform badge for scraped links
                          <span style={{
                            fontSize: '9px',
                            background: (PLATFORM_STYLES[link.platform]?.color || 'rgba(100, 116, 139, 0.15)'),
                            color: (PLATFORM_STYLES[link.platform]?.textColor || '#94A3B8'),
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 500
                          }}>{link.platform}</span>
                        ) : null}
                      </div>
                    </div>
                    {link.source === 'saved' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteLink(link.id);
                        }}
                        className="link-delete-btn"
                        title="Delete link"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#64748B',
                          cursor: 'pointer',
                          padding: '4px',
                          opacity: 0,
                          transition: 'all 0.2s'
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} style={{ fontSize: '11px' }} />
                      </button>
                    )}
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
        </div>

        {/* Quick Access - Show scraped platforms */}
        {scrapedPlatforms.length > 0 && (
          <div style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(148, 163, 184, 0.15)',
            flexShrink: 0,
          }}>
            <div className="recommended-header" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{activePlatformFilter ? `${activePlatformFilter} Links` : 'Quick Access'}</span>
              {activePlatformFilter && (
                <button
                  onClick={() => setActivePlatformFilter(null)}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    color: '#FCA5A5',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <FontAwesomeIcon icon={faTimes} style={{ fontSize: '8px' }} />
                  Clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {scrapedPlatforms.map((platform) => {
                const faviconUrl = getFaviconUrl(platform.url, 16);
                const isActive = activePlatformFilter === platform.name;
                return (
                  <button
                    key={platform.name}
                    onClick={() => {
                      if (isActive) {
                        // If already active, open the platform URL
                        window.open(platform.url, '_blank');
                      } else {
                        // First click: filter by platform
                        setActivePlatformFilter(platform.name);
                      }
                    }}
                    style={{
                      background: isActive ? platform.hoverBg : platform.color,
                      border: `1px solid ${isActive ? platform.hoverBorder : platform.borderColor}`,
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
                      boxShadow: isActive ? `0 0 0 2px ${platform.textColor}40` : 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = platform.hoverBg;
                        e.currentTarget.style.borderColor = platform.hoverBorder;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = platform.color;
                        e.currentTarget.style.borderColor = platform.borderColor;
                      }
                    }}
                    title={isActive ? `Click again to open ${platform.name}` : `Show ${platform.count} ${platform.name} links`}
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
                    <span style={{
                      background: 'rgba(0,0,0,0.2)',
                      borderRadius: '10px',
                      padding: '1px 6px',
                      fontSize: '10px',
                      fontWeight: 600,
                    }}>
                      {platform.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(16px)',
        borderRadius: '12px',
        border: '1px solid var(--border-primary)',
        fontSize: 'var(--font-sm)',
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0
      }}>
        <kbd style={{
          padding: '2px 6px',
          borderRadius: '4px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-primary)',
          fontSize: 'var(--font-sm)',
          fontFamily: 'monospace'
        }}>Esc</kbd>
        <span>Back to overview</span>
        <span style={{ opacity: 0.5 }}>•</span>
        <span>Links are saved locally</span>
      </div>

      <style jsx>{`
        .recent-chat-item:hover .chat-arrow {
          opacity: 1 !important;
        }
        .recent-chat-item:hover .link-delete-btn {
          opacity: 1 !important;
        }
        .link-delete-btn:hover {
          color: #EF4444 !important;
        }
      `}</style>
    </div>
  );
}
