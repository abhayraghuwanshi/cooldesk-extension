import { faExternalLinkAlt, faLink, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { listScrapedChats } from '../../db/index.js';
import { getFaviconUrl } from '../../utils.js';

/**
 * ChatContext - AI conversation interface bound to workspace
 *
 * Features:
 * - Recent chats from workspace context
 * - AI chat suggestions
 * - Workspace-aware prompts
 * - Context strip (notes + URLs)
 */

const PLATFORM_CONFIG = {
  'ChatGPT': { url: 'https://chat.openai.com', emoji: '💬', gradient: 'linear-gradient(135deg, rgba(16, 163, 127, 0.2), rgba(16, 163, 127, 0.05))', borderColor: 'rgba(16, 163, 127, 0.3)', textColor: '#6EE7B7', accentColor: '#10a37f' },
  'Claude': { url: 'https://claude.ai', emoji: '🤖', gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.05))', borderColor: 'rgba(139, 92, 246, 0.3)', textColor: '#C4B5FD', accentColor: '#8b5cf6' },
  'Gemini': { url: 'https://gemini.google.com', emoji: '💎', gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.05))', borderColor: 'rgba(59, 130, 246, 0.3)', textColor: '#93C5FD', accentColor: '#3b82f6' },
  'Grok': { url: 'https://x.com', emoji: '🚀', gradient: 'linear-gradient(135deg, rgba(251, 146, 60, 0.2), rgba(251, 146, 60, 0.05))', borderColor: 'rgba(251, 146, 60, 0.3)', textColor: '#FCA5A5', accentColor: '#fb923c' },
  'Perplexity': { url: 'https://www.perplexity.ai', emoji: '🔍', gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.05))', borderColor: 'rgba(16, 185, 129, 0.3)', textColor: '#A7F3D0', accentColor: '#10b981' },
  'AI Studio': { url: 'https://aistudio.google.com', emoji: '🧪', gradient: 'linear-gradient(135deg, rgba(66, 133, 244, 0.2), rgba(66, 133, 244, 0.05))', borderColor: 'rgba(66, 133, 244, 0.3)', textColor: '#8AB4F8', accentColor: '#4285F4' },
  'Lovable': { url: 'https://lovable.dev', emoji: '💜', gradient: 'linear-gradient(135deg, rgba(167, 139, 250, 0.2), rgba(167, 139, 250, 0.05))', borderColor: 'rgba(167, 139, 250, 0.3)', textColor: '#C4B5FD', accentColor: '#8b5cf6' },
  'ElevenLabs': { url: 'https://elevenlabs.io', emoji: '🗣️', gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05))', borderColor: 'rgba(255, 255, 255, 0.2)', textColor: '#F3F4F6', accentColor: '#ffffff' },
  'Suno': { url: 'https://suno.com', emoji: '🎵', gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.2), rgba(236, 72, 153, 0.05))', borderColor: 'rgba(236, 72, 153, 0.3)', textColor: '#F9A8D4', accentColor: '#ec4899' },
  'Runway': { url: 'https://runwayml.com', emoji: '🎬', gradient: 'linear-gradient(135deg, rgba(250, 204, 21, 0.2), rgba(250, 204, 21, 0.05))', borderColor: 'rgba(250, 204, 21, 0.3)', textColor: '#FDE047', accentColor: '#facc15' },
  'Luma Dream Machine': { url: 'https://lumalabs.ai/dream-machine', emoji: '🎥', gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.05))', borderColor: 'rgba(16, 185, 129, 0.3)', textColor: '#6EE7B7', accentColor: '#10b981' },
  'Pika': { url: 'https://pika.art', emoji: '🐇', gradient: 'linear-gradient(135deg, rgba(167, 139, 250, 0.2), rgba(167, 139, 250, 0.05))', borderColor: 'rgba(167, 139, 250, 0.3)', textColor: '#C4B5FD', accentColor: '#8b5cf6' },
};

const WORKSPACE_PROMPTS = [
  { icon: '✨', text: 'Summarize everything I worked on here', action: 'summarize' },
  { icon: '🔗', text: 'What links are related to my notes?', action: 'relate-links' },
  { icon: '📋', text: 'Create a plan from my notes', action: 'create-plan' },
  { icon: '💡', text: 'Suggest next steps for this project', action: 'suggest-next' },
  { icon: '🎯', text: 'Find patterns in my browsing here', action: 'find-patterns' },
];

export function ChatContext({ workspaceId, workspaceName }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(() => localStorage.getItem('chatFilter') || 'All');

  useEffect(() => {
    localStorage.setItem('chatFilter', filter);
  }, [filter]);

  // Load chats
  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      const queryOptions = {
        sortBy: 'scrapedAt',
        sortOrder: 'desc',
        limit: 50
      };

      if (filter !== 'All') {
        queryOptions.platform = filter;
      }

      const response = await listScrapedChats(queryOptions);

      const allChats = response?.data || response || [];
      setChats(Array.isArray(allChats) ? allChats : []);
    } catch (error) {
      console.error('[ChatContext] Error loading chats:', error);
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const handleChatClick = (chat) => {
    if (chat.url) {
      window.open(chat.url, '_blank');
    }
  };

  const handlePromptClick = (prompt) => {
    // Future: Send to AI with workspace context
    console.log('[ChatContext] Prompt clicked:', prompt.action, 'Workspace:', workspaceName);
    alert(`AI prompt: "${prompt.text}"\n\nThis will be implemented with workspace context in Phase 2.`);
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

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      gap: '20px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      {/* <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(16px)',
        borderRadius: '16px',
        border: '1px solid var(--border-primary)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FontAwesomeIcon icon={faComments} style={{ color: 'var(--accent-blue)', fontSize: '20px' }} />
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>AI Chats</h2>
          {workspaceName && (
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              background: 'var(--accent-blue-soft)',
              border: '1px solid var(--accent-blue-border)',
              color: 'var(--accent-blue)',
              fontSize: '12px',
              fontWeight: 500
            }}>
              {workspaceName}
            </span>
          )}
        </div>

        <button onClick={loadChats} style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          padding: '8px',
          borderRadius: '8px',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--interactive-hover)';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="Refresh">
          <FontAwesomeIcon icon={faSync} spin={loading} />
        </button>
      </div> */}

      {/* Scrollable Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        paddingRight: '4px',
        minHeight: 0
      }}>
        {/* Workspace-aware prompts */}
        {/* <div>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '12px',
            paddingLeft: '4px'
          }}>
            Workspace Suggestions
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px'
          }}>
            {WORKSPACE_PROMPTS.map((prompt, index) => (
              <button
                key={index}
                onClick={() => handlePromptClick(prompt)}
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--border-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  textAlign: 'left',
                  color: 'var(--text)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-blue-soft)';
                  e.currentTarget.style.borderColor = 'var(--accent-blue-border)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--glass-bg)';
                  e.currentTarget.style.borderColor = 'var(--border-primary)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span style={{ fontSize: '20px' }}>{prompt.icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>{prompt.text}</span>
              </button>
            ))}
          </div>
        </div> */}

        {/* Quick access platforms */}
        <div style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid var(--border-primary)',
          padding: '16px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '12px',
            paddingLeft: '4px'
          }}>
            Quick Access
          </div>
          <ul className="workspace-links" style={{
            maxHeight: 'none',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px'
          }}>
            {Object.entries(PLATFORM_CONFIG).map(([name, config]) => {
              const faviconUrl = getFaviconUrl(config.url, 32);
              return (
                <li
                  key={name}
                  className="workspace-link-item"
                  onClick={() => window.open(config.url, '_blank')}
                  style={{ cursor: 'pointer', padding: '10px' }}
                >
                  <span className="workspace-link-icon">
                    {faviconUrl ? (
                      <img
                        src={faviconUrl}
                        alt={name}
                        className="link-favicon"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'inline';
                        }}
                      />
                    ) : null}
                    <FontAwesomeIcon
                      icon={faLink}
                      className="link-fallback-icon"
                      style={{ display: faviconUrl ? 'none' : 'inline' }}
                    />
                  </span>
                  <span className="workspace-link-text">{name}</span>
                  <FontAwesomeIcon
                    icon={faExternalLinkAlt}
                    className="workspace-link-external"
                  />
                </li>
              );
            })}
          </ul>
        </div>


        <div style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid var(--border-primary)',
          padding: '16px',
          paddingBottom: '20px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
            paddingRight: '4px',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              paddingLeft: '4px'
            }}>
              Recent Conversations
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text)',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '6px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '100px'
              }}
            >
              <option value="All" style={{ background: '#1e1e1e', color: '#ffffff' }}>All</option>
              {Object.keys(PLATFORM_CONFIG).map(platform => (
                <option key={platform} value={platform} style={{ background: '#1e1e1e', color: '#ffffff' }}>{platform}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px',
              color: 'var(--text-secondary)',
              gap: '8px'
            }}>
              <FontAwesomeIcon icon={faSync} spin style={{ fontSize: '20px' }} />
              <span style={{ fontSize: '12px' }}>Loading...</span>
            </div>
          ) : chats.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px',
              textAlign: 'center',
              gap: '8px'
            }}>
              <div style={{ fontSize: '32px', opacity: 0.3 }}>💬</div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
                {filter === 'All' ? 'No chats yet' : `No ${filter} chats`}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '280px', lineHeight: 1.5 }}>
                Visit AI platforms to start tracking your conversations.
                <br />
                <span style={{ opacity: 0.7, fontStyle: 'italic' }}>
                  (Note: Some platforms require visiting specific chat URLs to track)
                </span>
              </div>
            </div>
          ) : (
            <ul className="workspace-links" style={{
              maxHeight: 'none',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '12px'
            }}>
              {chats.map((chat, index) => {
                const platform = PLATFORM_CONFIG[chat.platform] || {};
                const faviconUrl = platform.url ? getFaviconUrl(platform.url, 32) : null;

                return (
                  <li
                    key={chat.id || index}
                    className="workspace-link-item"
                    onClick={() => handleChatClick(chat)}
                    style={{ cursor: 'pointer', padding: '10px' }}
                  >
                    <span className="workspace-link-icon">
                      {faviconUrl ? (
                        <img
                          src={faviconUrl}
                          alt={chat.platform}
                          className="link-favicon"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'inline';
                          }}
                        />
                      ) : null}
                      <span
                        className="link-fallback-icon"
                        style={{ display: faviconUrl ? 'none' : 'inline', fontSize: '14px' }}
                      >
                        {platform.emoji || '💬'}
                      </span>
                    </span>
                    <span className="workspace-link-text">
                      {chat.title || 'Untitled Chat'}
                      <span style={{ opacity: 0.5, marginLeft: '6px', fontSize: '11px' }}>
                        • {formatTime(chat.scrapedAt || chat.lastVisitTime)}
                      </span>
                    </span>
                    <FontAwesomeIcon
                      icon={faExternalLinkAlt}
                      className="workspace-link-external"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Footer hints */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(16px)',
        borderRadius: '12px',
        border: '1px solid var(--border-primary)',
        fontSize: '12px',
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
          fontSize: '11px',
          fontFamily: 'monospace'
        }}>Esc</kbd>
        <span>Back to overview</span>
        <span>•</span>
        <span>AI responses use workspace context</span>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div >
  );
}
