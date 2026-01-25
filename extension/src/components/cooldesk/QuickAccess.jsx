import {
  faBookmark,
  faGlobe,
  faHistory,
  faLink,
  faPlus,
  faTimes
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { getFaviconUrl } from '../../utils/helpers.js';

const DEFAULT_LINKS = [
  { id: '1', title: 'Jira Dashboard', url: 'https://jira.example.com', icon: faLink },
  { id: '2', title: 'GitHub Repo/Cooldesk', url: 'https://github.com/cooldesk', icon: faLink },
];

const DEFAULT_RECOMMENDATIONS = [
  { id: 'r1', title: 'Company Portal', icon: faGlobe },
  { id: 'r2', title: 'Information Page', icon: faBookmark },
  { id: 'r3', title: 'Slack', icon: faLink },
];

export function QuickAccess() {
  const [quickLinks, setQuickLinks] = useState([]);
  const [recommendations, setRecommendations] = useState(DEFAULT_RECOMMENDATIONS);
  const [recentTabs, setRecentTabs] = useState([]);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');

  console.log('[QuickAccess] Rendering with', quickLinks.length, 'links');

  // Load most visited URLs from Chrome history
  useEffect(() => {
    const loadMostVisited = async () => {
      try {
        // First try to load from UI state
        const { getUIState } = await import('../../db/index.js');
        const ui = await getUIState();

        if (ui?.quickUrls && Array.isArray(ui.quickUrls) && ui.quickUrls.length > 0) {
          // Use saved quick URLs
          const savedLinks = ui.quickUrls.slice(0, 8).map((url, idx) => ({
            id: `saved_${idx}`,
            title: new URL(url).hostname,
            url: url,
            icon: faLink,
          }));
          setQuickLinks(savedLinks);
        } else if (chrome?.history?.search) {
          // Fallback to most visited from history
          const historyResults = await chrome.history.search({
            text: '',
            maxResults: 100,
            startTime: Date.now() - 30 * 24 * 60 * 60 * 1000, // Last 30 days
          });

          if (historyResults && historyResults.length > 0) {
            // Sort by visit count and take top 8
            const topVisited = historyResults
              .filter(item => item.url && !item.url.startsWith('chrome://') && !item.url.startsWith('edge://'))
              .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
              .slice(0, 8)
              .map((item, idx) => ({
                id: `history_${idx}`,
                title: item.title || new URL(item.url).hostname,
                url: item.url,
                icon: faLink,
                visitCount: item.visitCount,
              }));

            setQuickLinks(topVisited);
          }
        }
      } catch (error) {
        console.warn('[QuickAccess] Failed to load most visited URLs:', error);
        setQuickLinks(DEFAULT_LINKS);
      }
    };

    loadMostVisited();
  }, []);

  useEffect(() => {
    // Fetch recent tabs from Chrome API
    const loadRecentTabs = async () => {
      try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        // Sort by last accessed time and take first 5
        const recentTabsList = tabs
          .filter(tab => !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://'))
          .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
          .slice(0, 5)
          .map(tab => ({
            id: tab.id,
            title: tab.title || 'Untitled',
            url: tab.url,
            favIconUrl: tab.favIconUrl,
          }));
        setRecentTabs(recentTabsList);
      } catch (error) {
        console.warn('[QuickAccess] Failed to load recent tabs', error);
      }
    };

    loadRecentTabs();

    // Event-driven updates instead of polling
    const handleTabUpdate = () => loadRecentTabs();

    try {
      chrome.tabs.onCreated.addListener(handleTabUpdate);
      chrome.tabs.onRemoved.addListener(handleTabUpdate);
      chrome.tabs.onUpdated.addListener(handleTabUpdate);
      chrome.tabs.onActivated.addListener(handleTabUpdate);

      return () => {
        chrome.tabs.onCreated.removeListener(handleTabUpdate);
        chrome.tabs.onRemoved.removeListener(handleTabUpdate);
        chrome.tabs.onUpdated.removeListener(handleTabUpdate);
        chrome.tabs.onActivated.removeListener(handleTabUpdate);
      };
    } catch (error) {
      console.warn('[QuickAccess] Failed to setup tab event listeners', error);
      return () => { };
    }
  }, []);


  const handleAddLink = async () => {
    if (!newLinkUrl.trim()) return;

    try {
      let url = newLinkUrl.trim();
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }

      new URL(url); // Validate URL

      // Save to UI state
      const { getUIState, saveUIState } = await import('../../db/index.js');
      const ui = await getUIState();
      const currentUrls = ui?.quickUrls || [];

      if (!currentUrls.includes(url)) {
        const updatedUrls = [...currentUrls, url].slice(0, 8);
        await saveUIState({ ...ui, quickUrls: updatedUrls });

        // Update local state
        const newLink = {
          id: `saved_${quickLinks.length}`,
          title: newLinkTitle.trim() || new URL(url).hostname,
          url: url,
          icon: faLink,
        };
        setQuickLinks([...quickLinks, newLink].slice(0, 8));
      }

      setNewLinkUrl('');
      setNewLinkTitle('');
      setShowAddLink(false);
    } catch (error) {
      console.warn('[QuickAccess] Invalid URL:', error);
    }
  };

  const handleRemoveLink = async (linkToRemove) => {
    try {
      // Remove from UI state
      const { getUIState, saveUIState } = await import('../../db/index.js');
      const ui = await getUIState();
      const currentUrls = ui?.quickUrls || [];
      const updatedUrls = currentUrls.filter(url => url !== linkToRemove.url);
      await saveUIState({ ...ui, quickUrls: updatedUrls });

      // Update local state
      setQuickLinks(quickLinks.filter(link => link.id !== linkToRemove.id));
    } catch (error) {
      console.warn('[QuickAccess] Failed to remove link:', error);
    }
  };

  const handleLinkClick = (url) => {
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleRemoveRecommendation = (id) => {
    setRecommendations(recommendations.filter(rec => rec.id !== id));
  };

  return (
    <div className="cooldesk-panel">
      <div className="panel-header">
        <div className="panel-title">Most Visited ({quickLinks.length})</div>
        <div className="panel-action" onClick={() => setShowAddLink(!showAddLink)}>
          <FontAwesomeIcon icon={showAddLink ? faTimes : faPlus} />
          <span>{showAddLink ? 'Cancel' : 'Add URL'}</span>
        </div>
      </div>

      {/* Add Link Form */}
      {showAddLink && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: '10px',
          padding: '12px',
          marginBottom: '16px',
        }}>
          <input
            type="text"
            placeholder="URL"
            value={newLinkUrl}
            onChange={(e) => setNewLinkUrl(e.target.value)}
            style={{
              width: '100%',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '8px',
              padding: '8px 12px',
              color: '#E5E7EB',
              fontSize: 'var(--font-md, 13px)',
              marginBottom: '8px',
              outline: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Title (optional)"
            value={newLinkTitle}
            onChange={(e) => setNewLinkTitle(e.target.value)}
            style={{
              width: '100%',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '8px',
              padding: '8px 12px',
              color: '#E5E7EB',
              fontSize: '13px',
              marginBottom: '8px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleAddLink}
            disabled={!newLinkUrl.trim()}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px',
              color: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: newLinkUrl.trim() ? 'pointer' : 'not-allowed',
              opacity: newLinkUrl.trim() ? 1 : 0.5,
            }}
          >
            Add Link
          </button>
        </div>
      )}

      {/* Quick Links */}
      <ul className="quick-links">
        {quickLinks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '30px 16px',
            color: '#64748B',
            fontSize: '13px',
          }}>
            <FontAwesomeIcon icon={faLink} style={{ fontSize: 'var(--font-4xl, 28px)', marginBottom: '10px', display: 'block' }} />
            <div>No quick links yet</div>
            <div style={{ fontSize: 'var(--font-sm, 11px)', marginTop: '6px', opacity: 0.7 }}>
              Add your favorite URLs or they'll auto-populate from history
            </div>
          </div>
        ) : (
          quickLinks.map((link) => {
            const faviconUrl = getFaviconUrl(link.url, 16);
            return (
              <li key={link.id} className="quick-link-item">
                <div
                  className="quick-link-icon"
                  onClick={() => handleLinkClick(link.url)}
                  style={{ cursor: 'pointer' }}
                >
                  {faviconUrl ? (
                    <img
                      src={faviconUrl}
                      alt=""
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '3px',
                        objectFit: 'cover'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'inline';
                      }}
                    />
                  ) : null}
                  <FontAwesomeIcon
                    icon={link.icon || faLink}
                    style={{ display: faviconUrl ? 'none' : 'inline' }}
                  />
                </div>
                <div
                  className="quick-link-text"
                  onClick={() => handleLinkClick(link.url)}
                  style={{ cursor: 'pointer' }}
                  title={link.url}
                >
                  {link.title}
                </div>
                <div className="quick-link-edit" onClick={() => handleRemoveLink(link)}>
                  <FontAwesomeIcon icon={faTimes} />
                </div>
              </li>
            );
          })
        )}
      </ul>

      {/* Recommended for You */}
      <div className="recommended-section">
        <div className="recommended-header">Recommended for You</div>
        <div className="recommended-chips">
          {recommendations.map((rec) => (
            <div key={rec.id} className="recommended-chip">
              <FontAwesomeIcon icon={rec.icon || faBookmark} style={{ fontSize: 'var(--font-md, 12px)' }} />
              <span>{rec.title}</span>
              <span className="close-chip-btn" onClick={() => handleRemoveRecommendation(rec.id)}>
                <FontAwesomeIcon icon={faTimes} style={{ fontSize: 'var(--font-xs, 10px)' }} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Management Section */}
      <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
        <div className="recommended-header" style={{ marginBottom: '10px' }}>Recent Tabs ({recentTabs.length})</div>

        {recentTabs.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px 12px',
            color: '#64748B',
            fontSize: 'var(--font-md, 12px)',
          }}>
            <FontAwesomeIcon icon={faHistory} style={{ fontSize: 'var(--font-3xl, 20px)', marginBottom: '8px', display: 'block' }} />
            <div>No recent tabs</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentTabs.map((tab) => (
              <div
                key={tab.id}
                className="quick-link-item"
                onClick={() => chrome.tabs.update(tab.id, { active: true })}
                style={{ padding: '6px 8px', cursor: 'pointer' }}
              >
                {tab.favIconUrl ? (
                  <img
                    src={tab.favIconUrl}
                    alt=""
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '3px',
                      flexShrink: 0
                    }}
                  />
                ) : (
                  <div className="quick-link-icon" style={{ width: '16px', height: '16px', fontSize: 'var(--font-xs, 10px)' }}>
                    <FontAwesomeIcon icon={faGlobe} />
                  </div>
                )}
                <div style={{
                  flex: 1,
                  fontSize: 'var(--font-md, 12px)',
                  color: '#E5E7EB',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {tab.title}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
