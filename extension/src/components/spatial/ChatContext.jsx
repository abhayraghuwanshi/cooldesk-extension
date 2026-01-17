import { faArrowRight, faComments, faSync } from '@fortawesome/free-solid-svg-icons';
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

  // Load chats
  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await listScrapedChats({
        sortBy: 'scrapedAt',
        sortOrder: 'desc',
      });

      const allChats = response?.data || response || [];
      setChats(Array.isArray(allChats) ? allChats.slice(0, 40) : []);
    } catch (error) {
      console.error('[ChatContext] Error loading chats:', error);
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div style={{
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
      </div>

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
        <div>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '16px',
            paddingLeft: '4px'
          }}>
            Quick Access
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '14px'
          }}>
            {Object.entries(PLATFORM_CONFIG).map(([name, config]) => {
              const faviconUrl = getFaviconUrl(config.url, 32);
              return (
                <button
                  key={name}
                  onClick={() => window.open(config.url, '_blank')}
                  style={{
                    padding: '18px 20px',
                    borderRadius: '16px',
                    background: `linear-gradient(135deg, ${config.accentColor}15, ${config.accentColor}05)`,
                    backdropFilter: 'blur(12px)',
                    border: `1.5px solid ${config.borderColor}`,
                    color: config.textColor,
                    cursor: 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    fontSize: '14px',
                    fontWeight: 600,
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-3px)';
                    e.currentTarget.style.boxShadow = `0 12px 32px ${config.accentColor}35, 0 0 0 1px ${config.accentColor}30`;
                    e.currentTarget.style.background = `linear-gradient(135deg, ${config.accentColor}25, ${config.accentColor}10)`;
                    e.currentTarget.style.borderColor = config.accentColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.background = `linear-gradient(135deg, ${config.accentColor}15, ${config.accentColor}05)`;
                    e.currentTarget.style.borderColor = config.borderColor;
                  }}
                >
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    background: `linear-gradient(135deg, ${config.accentColor}30, ${config.accentColor}15)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: `1px solid ${config.accentColor}40`,
                    transition: 'all 0.3s ease'
                  }}>
                    {faviconUrl && (
                      <img
                        src={faviconUrl}
                        alt={name}
                        style={{
                          width: '28px',
                          height: '28px',
                          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))'
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.textContent = config.emoji;
                          e.target.parentElement.style.fontSize = '22px';
                        }}
                      />
                    )}
                  </div>
                  <span style={{
                    flex: 1,
                    letterSpacing: '0.01em'
                  }}>{name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent chats */}
        <div style={{ paddingBottom: '20px' }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '12px',
            paddingLeft: '4px'
          }}>
            Recent Conversations
          </div>

          {loading ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              color: 'var(--text-secondary)',
              gap: '12px'
            }}>
              <FontAwesomeIcon icon={faSync} spin style={{ fontSize: '28px' }} />
              <span>Loading chats...</span>
            </div>
          ) : chats.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              textAlign: 'center',
              gap: '12px'
            }}>
              <div style={{ fontSize: '48px', opacity: 0.3 }}>💬</div>
              <div style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text)' }}>No AI chats yet</div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '300px' }}>
                Visit ChatGPT, Claude, or Gemini to start tracking your conversations
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {chats.map((chat, index) => {
                const platform = PLATFORM_CONFIG[chat.platform] || {};
                const faviconUrl = platform.url ? getFaviconUrl(platform.url, 20) : null;

                return (
                  <div
                    key={chat.id || index}
                    onClick={() => handleChatClick(chat)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      borderRadius: '12px',
                      background: 'var(--glass-bg)',
                      border: '1px solid var(--border-primary)',
                      borderLeft: `3px solid ${platform.accentColor || 'var(--accent-blue)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      animation: `fadeSlideIn 0.3s ease ${index * 0.05}s backwards`
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.borderColor = 'var(--border-accent)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--glass-bg)';
                      e.currentTarget.style.borderColor = 'var(--border-primary)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: platform.gradient || 'var(--glass-bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: '20px'
                    }}>
                      {faviconUrl ? (
                        <img
                          src={faviconUrl}
                          alt={chat.platform || 'Chat'}
                          style={{ width: '20px', height: '20px' }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.textContent = platform.emoji || '💬';
                          }}
                        />
                      ) : (
                        platform.emoji || '💬'
                      )}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 500,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginBottom: '4px'
                      }}>
                        {chat.title || 'Untitled Chat'}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <span>{chat.platform}</span>
                        <span>•</span>
                        <span>{formatTime(chat.scrapedAt || chat.lastVisitTime)}</span>
                      </div>
                    </div>
                    <FontAwesomeIcon icon={faArrowRight} style={{ color: 'var(--text-muted)', fontSize: '14px' }} />
                  </div>
                );
              })}
            </div>
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
    </div>
  );
}
