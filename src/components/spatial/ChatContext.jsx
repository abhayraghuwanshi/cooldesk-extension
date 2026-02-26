import { faAngleRight, faArrowRight, faGear, faPaperPlane, faPlus, faRobot, faSync, faTimes, faToggleOff, faToggleOn, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useState } from 'react';

import scrapperConfig from '../../data/scrapper.json';
import { getScrapedChatStats, listScrapedChats } from '../../db/index.js';
import { saveScrapingConfig } from '../../db/unified-api.js';
import * as LocalAI from '../../services/localAIService.js';
import { defaultFontFamily } from '../../utils/fontUtils';
import { getFaviconUrl } from '../../utils/helpers.js';
import { SmartWorkspace } from '../cooldesk/SmartWorkspace';

/**
 * ChatContext - Project Links interface for workspace
 *
 * Features:
 * - Manual link saving with URL + title
 * - Auto-collected links from scraped AI platforms
 * - Quick access to scraped platforms
 */

// Platform styling configuration - loaded from scrapper.json
const PLATFORM_STYLES = scrapperConfig.platforms.reduce((acc, platform) => {
  acc[platform.name] = {
    color: platform.color,
    borderColor: platform.borderColor,
    textColor: platform.textColor,
    hoverBg: platform.hoverBg,
    hoverBorder: platform.hoverBorder
  };
  return acc;
}, {});

// Default style for unknown platforms
const DEFAULT_PLATFORM_STYLE = scrapperConfig.defaultStyle;

// Storage key for saved links
const SAVED_LINKS_KEY = 'chatContext_savedLinks';

const ChatContext = memo(function ChatContext({ workspaceId, workspaceName, maxItems = 20 }) {
  const [chats, setChats] = useState([]);
  const [allScrapedChats, setAllScrapedChats] = useState([]); // Store all chats for filtering
  const [savedLinks, setSavedLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [scrapedPlatforms, setScrapedPlatforms] = useState([]);
  const [activePlatformFilter, setActivePlatformFilter] = useState(null); // Filter by platform
  // const [autoScrapeEnabled, setAutoScrapeEnabled] = useState(true); // Removed as requested
  const [showSettings, setShowSettings] = useState(false);
  const [showPlatformConfig, setShowPlatformConfig] = useState(false);
  const [activeTab, setActiveTab] = useState('links'); // 'links' or 'smart'

  // AI Chat State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiChatMessages, setAiChatMessages] = useState([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);

  const [customSelectors, setCustomSelectors] = useState({});
  const [allowedDomains, setAllowedDomains] = useState([]);

  const [scrapingStats, setScrapingStats] = useState(() => {
    // Initial state from cache if available
    try {
      const cached = localStorage.getItem('scraped_stats_cache');
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  // Built-in platforms loaded from scrapper.json
  const BUILT_IN_PLATFORMS = scrapperConfig.platforms.map(p => ({
    name: p.name,
    domains: p.domains,
    type: p.type
  }));

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

  const [platformSettings, setPlatformSettings] = useState({});

  // Load settings from storage
  const loadSettings = useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(['domainSelectors', 'genericScraperAllowlist', 'platformSettings']);
        if (result.domainSelectors) {
          setCustomSelectors(result.domainSelectors);
        }
        if (result.genericScraperAllowlist) {
          setAllowedDomains(result.genericScraperAllowlist);
        }
        if (result.platformSettings) {
          setPlatformSettings(result.platformSettings);
        }
      } else {
      }
    } catch (error) {
      console.error('[ChatContext] Error loading settings:', error);
    }
  }, []);

  // Load platform stats from DB with caching
  const loadPlatformStats = useCallback(async () => {
    try {
      // 1. Fetch fresh stats
      const stats = await getScrapedChatStats();

      // 2. Update state and cache if we got results
      if (stats && Object.keys(stats).length > 0) {
        setScrapingStats(stats);
        localStorage.setItem('scraped_stats_cache', JSON.stringify(stats));
      }
    } catch (error) {
      console.error('[ChatContext] Error loading platform stats:', error);
    }
  }, []);



  // Toggle individual platform scraping
  const togglePlatform = async (platformName) => {
    // Default to true if undefined
    const currentStatus = platformSettings[platformName] !== false;
    const newStatus = !currentStatus;

    // Update local state immediately for UI responsiveness
    const newSettings = {
      ...platformSettings,
      [platformName]: newStatus
    };
    setPlatformSettings(newSettings);

    // Check if it's a built-in platform
    const platform = BUILT_IN_PLATFORMS.find(p => p.name === platformName);

    if (platform) {
      try {
        // Update each domain associated with this platform in the DB
        for (const domain of platform.domains) {
          await saveScrapingConfig({
            domain,
            source: 'native', // specific type for built-ins
            enabled: newStatus,
            updatedAt: Date.now()
          });
        }

        // Also update the legacy platformSettings in chrome.storage.local for backward compatibility
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ platformSettings: newSettings });
        }
      } catch (error) {
        console.error('[ChatContext] Error saving platform setting:', error);
      }
    } else {
      // Handle custom/generic domains
      try {
        // Check if we have existing config for this domain
        const existingConfig = customSelectors[platformName];
        if (existingConfig) {
          // Update existing custom config
          await saveScrapingConfig({
            ...existingConfig, // Preserve existing selector and other fields
            domain: platformName,
            enabled: newStatus,
            updatedAt: Date.now()
          });

          // Update customSelectors state to reflect change immediately
          setCustomSelectors({
            ...customSelectors,
            [platformName]: {
              ...existingConfig,
              enabled: newStatus
            }
          });
        }
      } catch (error) {
        console.error('[ChatContext] Error saving custom platform setting:', error);
      }
    }
  };



  useEffect(() => {
    loadChats();
    loadSavedLinks();
    loadSettings();
    loadPlatformStats();
  }, [loadChats, loadSavedLinks, loadSettings, loadPlatformStats]);

  // Check AI availability
  useEffect(() => {
    const checkAI = async () => {
      try {
        const available = await LocalAI.isAvailable();
        setAiAvailable(available);
      } catch {
        setAiAvailable(false);
      }
    };
    checkAI();
  }, []);

  // Handle AI Chat Submit
  const handleAiSubmit = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || isAiLoading) return;

    setAiChatMessages(prev => [...prev, { role: 'user', content: prompt }]);
    setAiPrompt('');
    setIsAiLoading(true);

    try {
      const isAvailable = await LocalAI.isAvailable();
      if (!isAvailable) {
        setAiChatMessages(prev => [...prev, { role: 'error', content: 'Desktop app not running. Please start CoolDesk.' }]);
        setIsAiLoading(false);
        return;
      }

      // Check if model is loaded
      const status = await LocalAI.getStatus();
      if (!status.modelLoaded) {
        setAiChatMessages(prev => [...prev, { role: 'system', content: '🔄 Loading AI model...' }]);

        const modelsResult = await LocalAI.getModels();
        const modelFilenames = Object.keys(modelsResult || {}).filter(name => modelsResult[name]?.downloaded);

        const modelToLoad = modelFilenames.find(name => name.toLowerCase().includes('phi-3'))
          || modelFilenames.find(name => name.toLowerCase().includes('llama'))
          || modelFilenames[0];

        if (!modelToLoad) {
          setAiChatMessages(prev => [...prev, { role: 'error', content: 'No AI models available. Download one from Settings → Local AI.' }]);
          setIsAiLoading(false);
          return;
        }

        await LocalAI.loadModel(modelToLoad);
        setAiChatMessages(prev => {
          const msgs = [...prev];
          const lastIdx = msgs.length - 1;
          if (msgs[lastIdx]?.role === 'system') {
            msgs[lastIdx] = { role: 'system', content: `✅ ${modelToLoad} loaded!` };
          }
          return msgs;
        });
      }

      const response = await LocalAI.chat(prompt);
      setAiChatMessages(prev => [...prev, { role: 'assistant', content: response || 'No response received' }]);
    } catch (error) {
      console.error('[ChatContext] AI error:', error);
      setAiChatMessages(prev => [...prev, { role: 'error', content: error.message || 'AI request failed' }]);
    } finally {
      setIsAiLoading(false);
    }
  }, [aiPrompt, isAiLoading]);



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
      {/* Tab Toggle Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <h3 style={{
          fontSize: 'var(--font-2xl, 20px)',
          fontWeight: 600,
          color: 'var(--text-secondary, #94A3B8)',
          fontFamily: defaultFontFamily,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: 0
        }}>
          {activeTab === 'links' ? 'Project Links' : 'Smart AI'}
        </h3>
        <div style={{
          display: 'flex',
          background: 'rgba(30, 41, 59, 0.5)',
          padding: '4px',
          borderRadius: '8px',
          gap: '4px'
        }}>
          <button
            onClick={() => setActiveTab('links')}
            style={{
              background: activeTab === 'links' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
              color: activeTab === 'links' ? '#60A5FA' : '#64748B',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Links
          </button>
          <button
            onClick={() => setActiveTab('smart')}
            style={{
              background: activeTab === 'smart' ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
              color: activeTab === 'smart' ? '#A78BFA' : '#64748B',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Smart AI ✨
          </button>
        </div>
      </div>

      {activeTab === 'smart' ? (
        /* Smart Workspace + AI Chat Section */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
          {/* AI Chat Panel */}
          <div className="cooldesk-panel" style={{
            flexShrink: 0,
            padding: '0',
          }}>
            {/* AI Input */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              background: aiAvailable
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)'
                : 'rgba(30, 41, 59, 0.5)',
              borderRadius: '12px',
              border: aiAvailable
                ? '1px solid rgba(139, 92, 246, 0.2)'
                : '1px solid rgba(148, 163, 184, 0.1)',
            }}>
              <FontAwesomeIcon
                icon={faRobot}
                style={{
                  color: aiAvailable ? '#A78BFA' : '#64748B',
                  fontSize: '16px',
                  flexShrink: 0,
                }}
              />
              <input
                type="text"
                placeholder={aiAvailable ? 'Ask AI anything...' : 'AI not available — start desktop app'}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && aiPrompt.trim()) handleAiSubmit();
                }}
                disabled={isAiLoading || !aiAvailable}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: '#F1F5F9',
                  fontSize: '13px',
                  fontFamily: defaultFontFamily,
                  outline: 'none',
                  padding: '4px 0',
                }}
              />
              {aiPrompt.trim() && (
                <button
                  onClick={handleAiSubmit}
                  disabled={isAiLoading}
                  style={{
                    background: 'rgba(139, 92, 246, 0.3)',
                    border: '1px solid rgba(139, 92, 246, 0.5)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    color: '#A78BFA',
                    fontSize: '12px',
                    cursor: isAiLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexShrink: 0,
                  }}
                >
                  <FontAwesomeIcon icon={isAiLoading ? faSync : faPaperPlane} spin={isAiLoading} />
                </button>
              )}
            </div>

            {/* AI Chat Messages */}
            {aiChatMessages.length > 0 && (
              <div style={{
                maxHeight: '200px',
                overflowY: 'auto',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                borderTop: '1px solid rgba(148, 163, 184, 0.1)',
              }}>
                {aiChatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                      gap: '8px',
                    }}
                  >
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: '12px',
                      maxWidth: '85%',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      background: msg.role === 'user'
                        ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(139, 92, 246, 0.3))'
                        : msg.role === 'error'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : msg.role === 'system'
                            ? 'rgba(234, 179, 8, 0.15)'
                            : 'rgba(30, 41, 59, 0.8)',
                      color: msg.role === 'error'
                        ? '#F87171'
                        : msg.role === 'system'
                          ? '#FBBF24'
                          : '#E2E8F0',
                      border: msg.role === 'user'
                        ? '1px solid rgba(139, 92, 246, 0.3)'
                        : '1px solid rgba(148, 163, 184, 0.1)',
                    }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isAiLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748B', fontSize: '12px' }}>
                    <FontAwesomeIcon icon={faSync} spin />
                    <span>Thinking...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Smart Workspace Component */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <SmartWorkspace
              maxItems={20}
              externalContext={allLinks.map(link => ({
                url: link.url,
                title: link.title,
                platform: link.platform,
                source: link.source
              }))}
              contextType="workspace"
              onSuggestion={(suggestion) => {
                // Handle AI suggestion - could add to chat or perform action
                setAiChatMessages(prev => [...prev, {
                  role: 'system',
                  content: `💡 Suggestion: ${suggestion}`
                }]);
              }}
            />
          </div>
        </div>
      ) : (
      /* Main Links Panel */
      <div className="cooldesk-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header">
          <div className="panel-title">
            {activePlatformFilter ? (
              <>
                {activePlatformFilter}
                <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: '4px' }}>
                  ({allLinks.length})
                </span>
              </>
            ) : (
              <span style={{ fontSize: '14px', color: '#94A3B8' }}>
                {allLinks.length} links
              </span>
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
            <div
              className="panel-action"
              onClick={() => {
                setShowSettings(!showSettings);
                if (!showSettings) loadPlatformStats();
              }}
              title="Scraping Settings"
              style={{ color: showSettings ? '#3B82F6' : undefined }}
            >
              <FontAwesomeIcon icon={faGear} style={{ transform: showSettings ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }} />
            </div>
          </div>
        </div>

        {/* Scraping Settings & Import */}
        {showSettings && (
          <div className="ai-card" style={{
            padding: '20px',
            margin: '0 16px 20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            animation: 'slideInDown 0.3s ease-out',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(148, 163, 184, 0.1)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
          }}>
            <style>{`
              @keyframes slideInDown {
                from { transform: translateY(-10px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }
              .settings-label {
                font-size: 11px;
                font-weight: 700;
                color: #64748B;
                text-transform: uppercase;
                letter-spacing: 0.1em;
              }
              .platform-item {
                transition: all 0.2s ease;
                border: 1px solid transparent;
              }
              .platform-item:hover {
                background: rgba(255, 255, 255, 0.05) !important;
                border-color: rgba(255, 255, 255, 0.1);
                transform: translateX(4px);
              }
              .premium-toggle {
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
              }
              .premium-toggle:active {
                transform: scale(0.95);
              }
            `}</style>

            {/* Auto-Scraping Engine Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.25)',
              padding: '16px 20px',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.03)'
            }}>
              <div>
                <div className="settings-label" style={{ color: '#F8FAFC', fontSize: '14px', fontWeight: 600 }}>Auto-Scraping Engine</div>
                <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>Automatically sync links while you browse</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

            {/* Platform Explorer Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                className="premium-toggle"
                onClick={() => setShowPlatformConfig(!showPlatformConfig)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FontAwesomeIcon icon={faSync} style={{ color: '#60A5FA', fontSize: 'var(--font-sm)' }} />
                  <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: '#E2E8F0', fontFamily: defaultFontFamily }}>Platform Explorer</span>
                </div>
                <FontAwesomeIcon
                  icon={faAngleRight}
                  style={{
                    color: '#64748B',
                    transform: showPlatformConfig ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    fontSize: 'var(--font-sm)'
                  }}
                />
              </div>

              {showPlatformConfig && (
                <div style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '4px',
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.03)'
                }} className="scrollbar-hidden">
                  <style>{`.scrollbar-hidden::-webkit-scrollbar { width: 0px; background: transparent; }`}</style>

                  {/* Built-in Platforms */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: '8px',
                    padding: '4px'
                  }}>
                    {BUILT_IN_PLATFORMS.map(platform => {
                      const isEnabled = platformSettings[platform.name] !== false;
                      const style = PLATFORM_STYLES[platform.name] || DEFAULT_PLATFORM_STYLE;

                      return (
                        <div key={platform.name} className="platform-item" style={{
                          padding: '10px',
                          background: isEnabled ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0,0,0,0.2)',
                          borderRadius: '12px',
                          border: isEnabled ? `1px solid ${style.borderColor}` : '1px solid rgba(255,255,255,0.05)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          transition: 'all 0.2s ease',
                          opacity: isEnabled ? 1 : 0.6
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              {(() => {
                                const domain = platform.domains[0];
                                const url = `https://${domain}`;
                                const iconUrl = getFaviconUrl(url, 32);
                                return iconUrl ? (
                                  <img
                                    src={iconUrl}
                                    alt={platform.name}
                                    style={{
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '4px',
                                      objectFit: 'contain'
                                    }}
                                    onError={(e) => e.target.style.display = 'none'}
                                  />
                                ) : null;
                              })()}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: '#F1F5F9', fontFamily: defaultFontFamily }}>{platform.name}</span>
                                <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#64748B' }}>{platform.type}</span>
                              </div>
                            </div>
                            <div
                              onClick={(e) => { e.stopPropagation(); togglePlatform(platform.name); }}
                              style={{
                                cursor: 'pointer',
                                color: isEnabled ? '#10B981' : '#475569',
                                transition: 'color 0.2s',
                                fontSize: '14px'
                              }}
                            >
                              <FontAwesomeIcon icon={isEnabled ? faToggleOn : faToggleOff} />
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                            {scrapingStats[platform.name] > 0 ? (
                              <span className="ai-chip" style={{ fontSize: '9px', padding: '2px 6px', borderColor: style.borderColor, color: style.textColor, background: style.color }}>
                                {scrapingStats[platform.name]} links
                              </span>
                            ) : (
                              <span style={{ fontSize: '9px', color: '#475569' }}>Ready</span>
                            )}
                            {/* <FontAwesomeIcon icon={faArrowRight} style={{ fontSize: '8px', opacity: 0.3, color: '#CBD5E1' }} /> */}
                          </div>
                        </div>
                      );
                    })}

                    {/* Custom Platforms */}
                    {Object.entries(customSelectors).map(([domain, config]) => {
                      const isEnabled = config.enabled !== false;

                      return (
                        <div key={domain} className="platform-item" style={{
                          padding: '10px',
                          background: isEnabled ? 'rgba(16, 185, 129, 0.03)' : 'rgba(0,0,0,0.2)',
                          borderRadius: '12px',
                          border: isEnabled ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255,255,255,0.05)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          transition: 'all 0.2s ease',
                          opacity: isEnabled ? 1 : 0.6
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', overflow: 'hidden' }}>
                              {(() => {
                                const url = `https://${domain}`;
                                const iconUrl = getFaviconUrl(url, 32);
                                return iconUrl ? (
                                  <img
                                    src={iconUrl}
                                    alt={domain}
                                    style={{
                                      width: '24px',
                                      height: '24px',
                                      borderRadius: '4px',
                                      objectFit: 'contain'
                                    }}
                                    onError={(e) => e.target.style.display = 'none'}
                                  />
                                ) : null;
                              })()}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                                <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: '#F1F5F9', fontFamily: defaultFontFamily, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{domain}</span>
                                <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#10B981' }}>CUSTOM</span>
                              </div>
                            </div>
                            <div
                              onClick={(e) => { e.stopPropagation(); togglePlatform(domain); }}
                              style={{
                                cursor: 'pointer',
                                color: isEnabled ? '#10B981' : '#475569',
                                transition: 'color 0.2s',
                                fontSize: '14px',
                                flexShrink: 0,
                                marginLeft: '8px'
                              }}
                            >
                              <FontAwesomeIcon icon={isEnabled ? faToggleOn : faToggleOff} />
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                            {scrapingStats[domain] > 0 ? (
                              <span className="ai-chip" style={{ fontSize: '9px', padding: '2px 6px', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#34D399', background: 'rgba(16, 185, 129, 0.1)' }}>
                                {scrapingStats[domain]} links
                              </span>
                            ) : (
                              <span style={{ fontSize: '9px', color: '#475569' }}>Ready</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Monitored Discovery Domains (as readonly items in list) */}
                  {allowedDomains.map(domain => {
                    const isBuiltIn = BUILT_IN_PLATFORMS.some(p => p.domains.includes(domain));
                    const isCustom = customSelectors[domain];
                    if (isBuiltIn || isCustom) return null;

                    return (
                      <div key={domain} className="platform-item" style={{
                        padding: '10px 12px',
                        background: 'rgba(251, 191, 36, 0.03)',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: '#F1F5F9', fontFamily: defaultFontFamily }}>{domain}</span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {scrapingStats[domain] > 0 && (
                              <span className="ai-chip" style={{ fontSize: 'var(--font-xs)', padding: '2px 6px', borderColor: 'rgba(251, 191, 36, 0.3)', color: '#FBBF24', background: 'rgba(251, 191, 36, 0.1)' }}>
                                {scrapingStats[domain]} links
                              </span>
                            )}
                            <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, textTransform: 'uppercase', color: '#F59E0B' }}>MONITORED</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>


          </div>
        )}

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
      )}

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
});

export { ChatContext };

