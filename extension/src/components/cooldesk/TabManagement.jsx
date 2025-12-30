import React, { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLayerGroup, faSync, faClose, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import { getFaviconUrl } from '../../utils';

export function TabManagement({ maxTabs = 8 }) {
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshTabs = useCallback(() => {
    setLoading(true);
    try {
      const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;
      if (hasTabsQuery) {
        chrome.tabs.query({}, (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            console.warn('[TabManagement] Error querying tabs:', lastErr);
            setTabs([]);
            setLoading(false);
            return;
          }
          const tabList = Array.isArray(list) ? list.slice(0, maxTabs) : [];
          setTabs(tabList);
          setLoading(false);
        });
      } else {
        // Fallback for non-extension context
        setTabs([]);
        setLoading(false);
      }
    } catch (e) {
      console.warn('[TabManagement] Error:', e);
      setTabs([]);
      setLoading(false);
    }
  }, [maxTabs]);

  useEffect(() => {
    refreshTabs();
    const interval = setInterval(refreshTabs, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [refreshTabs]);

  const handleTabClick = (tab) => {
    if (tab?.id && typeof chrome !== 'undefined' && chrome?.tabs?.update) {
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId && chrome?.windows?.update) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    }
  };

  const handleCloseTab = (e, tabId) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime?.lastError) {
          console.warn('[TabManagement] Error closing tab:', chrome.runtime.lastError);
        } else {
          refreshTabs();
        }
      });
    }
  };

  const handlePinTab = (e, tab) => {
    e.stopPropagation();
    if (tab?.id && typeof chrome !== 'undefined' && chrome?.tabs?.update) {
      chrome.tabs.update(tab.id, { pinned: !tab.pinned }, () => {
        if (chrome.runtime?.lastError) {
          console.warn('[TabManagement] Error pinning tab:', chrome.runtime.lastError);
        } else {
          refreshTabs();
        }
      });
    }
  };

  if (loading) {
    return (
      <div className="cooldesk-panel tab-management-widget">
        <div className="panel-header">
          <div className="panel-title">
            <FontAwesomeIcon icon={faLayerGroup} style={{ marginRight: '8px' }} />
            Tab Management
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748B' }}>
          <FontAwesomeIcon icon={faSync} spin style={{ fontSize: '24px', marginBottom: '12px' }} />
          <div>Loading tabs...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cooldesk-panel tab-management-widget">
      <div className="panel-header">
        <div className="panel-title">
          <FontAwesomeIcon icon={faLayerGroup} style={{ marginRight: '8px' }} />
          Tab Management
        </div>
        <div className="panel-action" onClick={refreshTabs} title="Refresh tabs">
          <FontAwesomeIcon icon={faSync} />
          <span>Refresh</span>
        </div>
      </div>

      {tabs.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#64748B',
          fontSize: '14px',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📑</div>
          <div>No tabs found</div>
          <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>
            Open some browser tabs to see them here
          </div>
        </div>
      ) : (
        <div className="tabs-grid">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="tab-card"
              onClick={() => handleTabClick(tab)}
              style={{
                border: tab.active ? '1px solid rgba(59, 130, 246, 0.5)' : undefined,
                background: tab.active ? 'rgba(59, 130, 246, 0.1)' : undefined,
              }}
            >
              <img
                src={getFaviconUrl(tab.url)}
                alt=""
                className="tab-favicon"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
              <div className="tab-info">
                <div className="tab-title">{tab.title || 'Untitled'}</div>
                <div className="tab-url">
                  {tab.url ? new URL(tab.url).hostname : 'No URL'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {tab.pinned && (
                  <FontAwesomeIcon
                    icon={faThumbtack}
                    style={{ color: '#F59E0B', fontSize: '12px' }}
                    title="Pinned"
                  />
                )}
                <button
                  onClick={(e) => handlePinTab(e, tab)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: tab.pinned ? '#F59E0B' : '#64748B',
                    cursor: 'pointer',
                    padding: '4px',
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                  }}
                  className="tab-pin-btn"
                  title={tab.pinned ? 'Unpin' : 'Pin'}
                >
                  <FontAwesomeIcon icon={faThumbtack} />
                </button>
                <button
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#64748B',
                    cursor: 'pointer',
                    padding: '4px',
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                  }}
                  className="tab-close-btn"
                  title="Close tab"
                >
                  <FontAwesomeIcon icon={faClose} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .tab-card:hover .tab-pin-btn,
        .tab-card:hover .tab-close-btn {
          opacity: 1 !important;
        }
        .tab-pin-btn:hover {
          color: #F59E0B !important;
        }
        .tab-close-btn:hover {
          color: #EF4444 !important;
        }
      `}</style>
    </div>
  );
}
