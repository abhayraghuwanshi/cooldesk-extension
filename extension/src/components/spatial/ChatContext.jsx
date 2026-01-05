import { faArrowRight, faSync } from '@fortawesome/free-solid-svg-icons';
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
  'ChatGPT': { url: 'https://chat.openai.com', emoji: '💬', color: 'rgba(16, 163, 127, 0.15)', borderColor: 'rgba(16, 163, 127, 0.3)', textColor: '#6EE7B7' },
  'Claude': { url: 'https://claude.ai', emoji: '🤖', color: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.3)', textColor: '#C4B5FD' },
  'Gemini': { url: 'https://gemini.google.com', emoji: '💎', color: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.3)', textColor: '#93C5FD' },
  'Grok': { url: 'https://x.com', emoji: '🚀', color: 'rgba(251, 146, 60, 0.15)', borderColor: 'rgba(251, 146, 60, 0.3)', textColor: '#FCA5A5' },
  'Perplexity': { url: 'https://www.perplexity.ai', emoji: '🔍', color: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', textColor: '#A7F3D0' },
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
    <div className="chat-context">
      {/* Header */}
      {/* <div className="chat-context-header">
        <div className="header-left">
          <FontAwesomeIcon icon={faComments} className="header-icon" />
          <h2 className="header-title">AI Chats</h2>
          {workspaceName && <span className="workspace-badge">{workspaceName}</span>}
        </div>

        <button className="icon-btn" onClick={loadChats} title="Refresh">
          <FontAwesomeIcon icon={faSync} />
        </button>
      </div> */}

      {/* Workspace-aware prompts */}
      {/* <div className="chat-prompts">
        <div className="prompts-title">Workspace Suggestions</div>
        <div className="prompts-grid">
          {WORKSPACE_PROMPTS.map((prompt, index) => (
            <button
              key={index}
              className="prompt-card"
              onClick={() => handlePromptClick(prompt)}
            >
              <span className="prompt-icon">{prompt.icon}</span>
              <span className="prompt-text">{prompt.text}</span>
            </button>
          ))}
        </div>
      </div> */}

      {/* Recent chats */}
      <div className="chat-section">
        <div className="section-title">Recent Conversations</div>

        {loading ? (
          <div className="chat-loading">
            <FontAwesomeIcon icon={faSync} spin />
            <span>Loading chats...</span>
          </div>
        ) : chats.length === 0 ? (
          <div className="chat-empty">
            <div className="empty-icon">💬</div>
            <div className="empty-text">No AI chats yet</div>
            <div className="empty-hint">Visit ChatGPT, Claude, or Gemini to start tracking your conversations</div>
          </div>
        ) : (
          <div className="chats-list">
            {chats.map((chat, index) => {
              const platform = PLATFORM_CONFIG[chat.platform] || {};
              const faviconUrl = platform.url ? getFaviconUrl(platform.url, 20) : null;

              return (
                <div
                  key={chat.id || index}
                  className="chat-item"
                  onClick={() => handleChatClick(chat)}
                >
                  <div className="chat-icon">
                    {faviconUrl ? (
                      <img
                        src={faviconUrl}
                        alt={chat.platform || 'Chat'}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.textContent = platform.emoji || '💬';
                        }}
                      />
                    ) : (
                      platform.emoji || '💬'
                    )}
                  </div>
                  <div className="chat-content">
                    <div className="chat-title">{chat.title || 'Untitled Chat'}</div>
                    <div className="chat-meta">
                      <span className="chat-platform">{chat.platform}</span>
                      <span className="chat-separator">•</span>
                      <span className="chat-time">{formatTime(chat.scrapedAt || chat.lastVisitTime)}</span>
                    </div>
                  </div>
                  <FontAwesomeIcon icon={faArrowRight} className="chat-arrow" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick access platforms */}
      <div className="platform-section">
        <div className="section-title">Quick Access</div>
        <div className="platform-grid">
          {Object.entries(PLATFORM_CONFIG).map(([name, config]) => {
            const faviconUrl = getFaviconUrl(config.url, 16);
            return (
              <button
                key={name}
                className="platform-btn"
                onClick={() => window.open(config.url, '_blank')}
                style={{
                  background: config.color,
                  border: `1px solid ${config.borderColor}`,
                  color: config.textColor,
                }}
              >
                {faviconUrl && (
                  <img
                    src={faviconUrl}
                    alt={name}
                    className="platform-icon"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer hints */}
      <div className="chat-context-footer">
        <div className="footer-hint">
          <kbd>Esc</kbd> Back to overview
          <span className="hint-separator">•</span>
          AI responses use workspace context
        </div>
      </div>
    </div>
  );
}
