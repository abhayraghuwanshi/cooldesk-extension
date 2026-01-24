import { faCheck, faExternalLinkAlt, faLink, faPlus, faSync, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

const POPULAR_TOOLS = [
  { name: 'Midjourney', url: 'https://www.midjourney.com', emoji: '🎨' },
  { name: 'Canva', url: 'https://www.canva.com', emoji: '🖌️' },
  { name: 'Notion', url: 'https://www.notion.so', emoji: '📓' },
  { name: 'Figma', url: 'https://www.figma.com', emoji: '📐' },
  { name: 'GitHub', url: 'https://github.com', emoji: '🐙' },
  { name: 'Linear', url: 'https://linear.app', emoji: '✅' },
  { name: 'V0.dev', url: 'https://v0.dev', emoji: '⚡' },
  { name: 'Replit', url: 'https://replit.com', emoji: '💻' },
  { name: 'StackBlitz', url: 'https://stackblitz.com', emoji: '⚡' },
  { name: 'Poe', url: 'https://poe.com', emoji: '🤖' },
  { name: 'HuggingChat', url: 'https://huggingface.co/chat', emoji: '🤗' },
  { name: 'Weights & Biases', url: 'https://wandb.ai', emoji: '📊' },
  { name: 'Civitai', url: 'https://civitai.com', emoji: '🖼️' },
  { name: 'Vectorizer.ai', url: 'https://vectorizer.ai', emoji: '📐' },
  { name: 'Gamma', url: 'https://gamma.app', emoji: '📑' },
  { name: 'Tome', url: 'https://tome.app', emoji: '📖' },
  { name: 'Synthesia', url: 'https://www.synthesia.io', emoji: '🗣️' },
  { name: 'Descript', url: 'https://www.descript.com', emoji: '🎙️' },
  { name: 'Fireflies.ai', url: 'https://fireflies.ai', emoji: '📝' },
  { name: 'Otter.ai', url: 'https://otter.ai', emoji: '🦦' },
];

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
  const [visibleCount, setVisibleCount] = useState(8);

  // Custom Links State
  const [customLinks, setCustomLinks] = useState([]);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [activeTab, setActiveTab] = useState('popular'); // 'popular' or 'custom'
  const [newLinkData, setNewLinkData] = useState({ name: '', url: '', emoji: '' });

  // Load custom links from storage
  useEffect(() => {
    chrome.storage.local.get(['chatContextLinks'], (result) => {
      if (result.chatContextLinks) {
        setCustomLinks(result.chatContextLinks);
      }
    });
  }, []);

  // Save custom links to storage
  const saveCustomLinks = (links) => {
    setCustomLinks(links);
    chrome.storage.local.set({ chatContextLinks: links });
  };

  const handleAddPopularTool = (tool) => {
    const newLink = {
      id: Date.now().toString(),
      name: tool.name,
      url: tool.url,
      emoji: tool.emoji,
      isCustom: true
    };
    saveCustomLinks([...customLinks, newLink]);
    setIsAddingLink(false);
  };

  const handleAddCustomLink = (e) => {
    e.preventDefault();
    if (!newLinkData.name || !newLinkData.url) return;

    // Ensure URL has protocol
    let url = newLinkData.url;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    const newLink = {
      id: Date.now().toString(),
      name: newLinkData.name,
      url: url,
      emoji: newLinkData.emoji || '🔗',
      isCustom: true
    };

    saveCustomLinks([...customLinks, newLink]);
    setNewLinkData({ name: '', url: '', emoji: '' });
    setIsAddingLink(false);
  };

  const handleRemoveLink = (e, linkId) => {
    e.stopPropagation();
    e.preventDefault();
    const updatedLinks = customLinks.filter(link => link.id !== linkId);
    saveCustomLinks(updatedLinks);
  };

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

  const triggerScrape = () => {
    setLoading(true);
    // Use the new manual trigger that opens tabs if needed
    chrome.runtime.sendMessage({ type: 'TRIGGER_MANUAL_CHATS_SCRAPE' }, (response) => {
      // Re-fetch after delays to allow scrape to start/finish
      // The background script now opens tabs, so it might take a bit longer
      setTimeout(loadChats, 3000);
      setTimeout(loadChats, 8000);
      setTimeout(loadChats, 15000);
    });
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

            {/* Custom Links */}
            {customLinks.map((link) => {
              // ALWAYS try to get a favicon URL first
              const faviconUrl = getFaviconUrl(link.url, 32);

              return (
                <li
                  key={link.id}
                  className="workspace-link-item group"
                  onClick={() => window.open(link.url, '_blank')}
                  style={{ position: 'relative', cursor: 'pointer', padding: '10px' }}
                >
                  <span className="workspace-link-icon">
                    {/* Primary: Try to show Favicon */}
                    {faviconUrl && (
                      <img
                        src={faviconUrl}
                        alt={link.name}
                        className="link-favicon"
                        style={{ display: 'inline', width: '16px', height: '16px', borderRadius: '4px' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          // Show the sibling fallback span
                          const fallback = e.target.nextSibling;
                          if (fallback) fallback.style.display = 'inline';
                        }}
                      />
                    )}

                    {/* Secondary: Emoji Fallback (initially hidden if we have a URL) */}
                    <span
                      className="link-fallback-icon"
                      style={{ display: faviconUrl ? 'none' : 'inline', fontSize: '18px', lineHeight: 1 }}
                    >
                      {link.emoji || '🔗'}
                    </span>
                  </span>
                  <span className="workspace-link-text">{link.name}</span>
                  <button
                    onClick={(e) => handleRemoveLink(e, link.id)}
                    className="workspace-link-remove"
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      opacity: 0,
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => e.target.style.background = 'rgba(239, 68, 68, 0.1)'}
                    onMouseLeave={e => e.target.style.background = 'none'}
                    title="Remove link"
                  >
                    <FontAwesomeIcon icon={faTimes} style={{ fontSize: '12px' }} />
                  </button>
                </li>
              );
            })}

            {/* Add Link Button - Premium Redesign */}
            <li
              className="workspace-link-item add-btn"
              onClick={() => setIsAddingLink(true)}
              style={{
                cursor: 'pointer',
                padding: '12px',
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01))',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                minHeight: '80px', // Match other cards height approx
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(59, 130, 246, 0.15)';
                e.currentTarget.querySelector('.add-icon-wrapper').style.background = 'linear-gradient(135deg, #3b82f6, #60a5fa)';
                e.currentTarget.querySelector('.add-icon-wrapper').style.color = '#fff';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
                e.currentTarget.querySelector('.add-icon-wrapper').style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.querySelector('.add-icon-wrapper').style.color = 'var(--text-secondary)';
              }}
            >
              <div className="add-icon-wrapper" style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
                color: 'var(--text-secondary)'
              }}>
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: '14px' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Add Shortcut</span>
            </li>
          </ul>

          {/* Add Link Modal - Premium Redesign */}
          {isAddingLink && createPortal(
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(8px)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Inter, system-ui, sans-serif'
            }} onClick={() => setIsAddingLink(false)}>
              <style>{`
                @keyframes modalIn {
                  from { opacity: 0; transform: scale(0.95) translateY(10px); }
                  to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .custom-scroll::-webkit-scrollbar {
                  width: 6px;
                }
                .custom-scroll::-webkit-scrollbar-track {
                  background: transparent;
                }
                .custom-scroll::-webkit-scrollbar-thumb {
                  background: rgba(255, 255, 255, 0.1);
                  border-radius: 3px;
                }
                .custom-scroll::-webkit-scrollbar-thumb:hover {
                  background: rgba(255, 255, 255, 0.2);
                }
              `}</style>
              <div style={{
                width: '440px',
                background: 'rgba(30, 30, 35, 0.95)',
                borderRadius: '24px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
                overflow: 'hidden',
                animation: 'modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                flexDirection: 'column'
              }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                  padding: '20px 24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)'
                }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>Add Shortcut</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9CA3AF' }}>Pin your favorite tools for quick access</p>
                  </div>
                  <button
                    onClick={() => setIsAddingLink(false)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: 'none',
                      color: '#9CA3AF',
                      cursor: 'pointer',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; e.currentTarget.style.color = '#9CA3AF'; }}
                  >
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                </div>

                {/* Tabs */}
                <div style={{ padding: '0 24px 20px 24px' }}>
                  <div style={{
                    display: 'flex',
                    background: 'rgba(0, 0, 0, 0.2)',
                    padding: '4px',
                    borderRadius: '12px',
                    gap: '4px'
                  }}>
                    {['popular', 'custom'].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          background: activeTab === tab ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                          border: 'none',
                          borderRadius: '8px',
                          color: activeTab === tab ? '#fff' : '#9CA3AF',
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: '13px',
                          transition: 'all 0.2s',
                          boxShadow: activeTab === tab ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        {tab === 'popular' ? 'Popular Tools' : 'Custom URL'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content */}
                <div className="custom-scroll" style={{ padding: '0 24px 24px 24px', maxHeight: '380px', overflowY: 'auto' }}>
                  {activeTab === 'popular' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      {POPULAR_TOOLS.map(tool => {
                        const isAdded = customLinks.some(l => l.url === tool.url) ||
                          Object.values(PLATFORM_CONFIG).some(p => p.url === tool.url);
                        return (
                          <button
                            key={tool.name}
                            onClick={() => !isAdded && handleAddPopularTool(tool)}
                            disabled={isAdded}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '12px',
                              background: isAdded ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.04)',
                              border: isAdded ? '1px solid transparent' : '1px solid rgba(255, 255, 255, 0.05)',
                              borderRadius: '12px',
                              cursor: isAdded ? 'default' : 'pointer',
                              color: '#fff',
                              opacity: isAdded ? 0.4 : 1,
                              textAlign: 'left',
                              transition: 'all 0.2s',
                              position: 'relative',
                              overflow: 'hidden'
                            }}
                            onMouseEnter={e => !isAdded && (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                            onMouseLeave={e => !isAdded && (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
                          >
                            <span style={{ fontSize: '20px', lineHeight: 1 }}>{tool.emoji}</span>
                            <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>{tool.name}</span>
                            {isAdded && <FontAwesomeIcon icon={faCheck} style={{ fontSize: '10px', color: '#10B981' }} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <form onSubmit={handleAddCustomLink} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#9CA3AF', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Display Name</label>
                        <input
                          type="text"
                          value={newLinkData.name}
                          onChange={e => setNewLinkData({ ...newLinkData, name: e.target.value })}
                          placeholder="e.g. Workflow Dashboard"
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            color: '#fff',
                            fontSize: '14px',
                            outline: 'none',
                            transition: 'all 0.2s',
                            boxSizing: 'border-box'
                          }}
                          onFocus={e => e.target.style.borderColor = 'rgba(59, 130, 246, 0.5)'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#9CA3AF', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destination URL</label>
                        <input
                          type="text"
                          value={newLinkData.url}
                          onChange={e => setNewLinkData({ ...newLinkData, url: e.target.value })}
                          placeholder="https://..."
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            color: '#fff',
                            fontSize: '14px',
                            outline: 'none',
                            transition: 'all 0.2s',
                            boxSizing: 'border-box'
                          }}
                          onFocus={e => e.target.style.borderColor = 'rgba(59, 130, 246, 0.5)'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#9CA3AF', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Icon (Emoji)</label>
                        <input
                          type="text"
                          value={newLinkData.emoji}
                          onChange={e => setNewLinkData({ ...newLinkData, emoji: e.target.value })}
                          placeholder="✨"
                          maxLength={2}
                          style={{
                            width: '80px',
                            padding: '12px',
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            color: '#fff',
                            fontSize: '18px',
                            textAlign: 'center',
                            outline: 'none',
                            transition: 'all 0.2s'
                          }}
                          onFocus={e => e.target.style.borderColor = 'rgba(59, 130, 246, 0.5)'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!newLinkData.name || !newLinkData.url}
                        style={{
                          marginTop: '12px',
                          padding: '14px',
                          background: (!newLinkData.name || !newLinkData.url) ? 'rgba(255, 255, 255, 0.05)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                          color: (!newLinkData.name || !newLinkData.url) ? 'rgba(255, 255, 255, 0.3)' : '#fff',
                          border: 'none',
                          borderRadius: '12px',
                          fontWeight: 600,
                          fontSize: '14px',
                          cursor: (!newLinkData.name || !newLinkData.url) ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                          boxShadow: (!newLinkData.name || !newLinkData.url) ? 'none' : '0 4px 6px -1px rgba(59, 130, 246, 0.3), 0 2px 4px -1px rgba(59, 130, 246, 0.15)'
                        }}
                        onMouseEnter={e => {
                          if (newLinkData.name && newLinkData.url) {
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 6px 8px -1px rgba(59, 130, 246, 0.4), 0 4px 6px -1px rgba(59, 130, 246, 0.2)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (newLinkData.name && newLinkData.url) {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(59, 130, 246, 0.3), 0 2px 4px -1px rgba(59, 130, 246, 0.15)';
                          }
                        }}
                      >
                        Add to Quick Access
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
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

              <button
                onClick={triggerScrape}
                style={{
                  marginTop: '12px',
                  background: 'rgba(59, 130, 246, 0.1)',
                  color: '#60A5FA',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <FontAwesomeIcon icon={faSync} />
                Fetch Chats
              </button>
            </div>
          ) : (
            <>
              <ul className="workspace-links" style={{
                maxHeight: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {chats.slice(0, visibleCount).map((chat, index) => {
                  const platform = PLATFORM_CONFIG[chat.platform] || {};
                  const faviconUrl = platform.url ? getFaviconUrl(platform.url, 32) : null;

                  return (
                    <li
                      key={chat.id || index}
                      className="workspace-link-item"
                      onClick={() => handleChatClick(chat)}
                      style={{
                        cursor: 'pointer',
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: index < chats.length - 1 ? '1px solid var(--border-primary)' : 'none',
                        background: 'rgba(255, 255, 255, 0.02)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                        <span className="workspace-link-icon" style={{ flexShrink: 0 }}>
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
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span className="workspace-link-text" style={{ fontSize: '14px', fontWeight: 500 }}>
                            {chat.title || 'Untitled Chat'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Visual indicator of recency (fading dot) */}
                        <div style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: 'var(--accent-color, #34C759)',
                          opacity: Math.max(0.2, 1 - (index * 0.1))
                        }} title="Recency indicator" />

                        <FontAwesomeIcon
                          icon={faExternalLinkAlt}
                          className="workspace-link-external"
                          style={{ fontSize: '12px', opacity: 0.5 }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>

              {chats.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(prev => prev + 10)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '8px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    marginTop: '12px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.target.style.color = 'var(--text)';
                  }}
                  onMouseLeave={e => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.target.style.color = 'var(--text-secondary)';
                  }}
                >
                  Show more ({chats.length - visibleCount} remaining)
                </button>
              )}
            </>
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
