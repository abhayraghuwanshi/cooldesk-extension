import { faLayerGroup, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';

export function TabManagement({ maxTabs = 8 }) {
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshTabs = useCallback(() => {
    // Determine if we should show a loading state initially
    // We don't want to set loading=true on every background refresh as it causes flickering
    // So we only set it if we have no tabs yet
    if (tabs.length === 0) setLoading(true);

    try {
      const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;
      if (hasTabsQuery) {
        chrome.tabs.query({}, (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            console.warn('[TabManagement] Error querying tabs:', lastErr);
            // Don't clear tabs on error, just keep existing
            setLoading(false);
            return;
          }
          // Fix: Show ALL tabs, do not slice by maxTabs
          // Sort tabs: Active tab first, then by index/window
          const sortedList = (list || []).sort((a, b) => {
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            return a.index - b.index;
          });

          setTabs(sortedList);
          setLoading(false);
        });
      } else {
        // Fallback for non-extension context
        setTabs([]);
        setLoading(false);
      }
    } catch (e) {
      console.warn('[TabManagement] Error:', e);
      setLoading(false);
    }
  }, []); // Remove maxTabs dependency as we don't use it anymore

  useEffect(() => {
    refreshTabs();

    // Add listeners for real-time updates
    const events = [
      chrome?.tabs?.onCreated,
      chrome?.tabs?.onUpdated,
      chrome?.tabs?.onRemoved,
      chrome?.tabs?.onActivated,
      chrome?.tabs?.onMoved,
      chrome?.tabs?.onDetached,
      chrome?.tabs?.onAttached
    ];

    const handleEvent = () => refreshTabs();

    events.forEach(event => {
      if (event?.addListener) {
        event.addListener(handleEvent);
      }
    });

    return () => {
      events.forEach(event => {
        if (event?.removeListener) {
          event.removeListener(handleEvent);
        }
      });
    };
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
            Browser Tabs
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748B' }}>
          <FontAwesomeIcon icon={faSync} spin style={{ fontSize: 'var(--font-4xl)', marginBottom: '12px' }} />
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
          Browser Tabs
        </div>
        <div className="panel-action" onClick={refreshTabs} title="Refresh tabs">
          <FontAwesomeIcon icon={faSync} />
          <span>Refresh</span>
        </div>
      </div>

      {
        tabs.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#64748B',
            fontSize: 'var(--font-base)',
          }}>
            <div style={{ fontSize: 'var(--font-5xl)', marginBottom: '12px' }}>📑</div>
            <div>No tabs found</div>
            <div style={{ fontSize: 'var(--font-sm)', marginTop: '8px', opacity: 0.7 }}>
              Open some browser tabs to see them here
            </div>
          </div>
        ) : (
          <div className="tabs-container" style={{ padding: '0 12px 12px' }}>
            {/* Grouped Tabs Section */}
            {(() => {
              // 1. Group tabs by hostname
              const groups = {};
              tabs.forEach(tab => {
                try {
                  const url = new URL(tab.url);
                  let hostname = url.hostname;
                  // Handle local development specially if needed, or treat as normal domain
                  if (hostname === 'localhost' || hostname === '127.0.0.1') {
                    hostname = `${hostname}${url.port ? ':' + url.port : ''}`;
                  }
                  if (!groups[hostname]) groups[hostname] = [];
                  groups[hostname].push(tab);
                } catch {
                  if (!groups['Other']) groups['Other'] = [];
                  groups['Other'].push(tab);
                }
              });

              // 2. Define Color Palette & Helper
              const PALETTE = [
                '#3B82F6', // Blue
                '#8B5CF6', // Purple
                '#10B981', // Emerald
                '#F59E0B', // Amber
                '#EC4899', // Pink
                '#06B6D4', // Cyan
                '#6366F1', // Indigo
                '#F43F5E', // Rose
              ];

              const getDomainColor = (hostname) => {
                if (hostname === 'Other') return '#94A3B8';
                let hash = 0;
                for (let i = 0; i < hostname.length; i++) {
                  hash = hostname.charCodeAt(i) + ((hash << 5) - hash);
                }
                return PALETTE[Math.abs(hash) % PALETTE.length];
              };

              // 3. Sort groups
              // Priority: Group containing active tab > Localhost > Others sorted by count
              const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
                const aHasActive = groups[a].some(t => t.active);
                const bHasActive = groups[b].some(t => t.active);
                if (aHasActive && !bHasActive) return -1;
                if (!aHasActive && bHasActive) return 1;

                // Keep localhost at top if no active tab preference
                const aIsLocal = a.includes('localhost') || a.includes('127.0.0.1');
                const bIsLocal = b.includes('localhost') || b.includes('127.0.0.1');
                if (aIsLocal && !bIsLocal) return -1;
                if (!aIsLocal && bIsLocal) return 1;

                return groups[b].length - groups[a].length; // Descending by count
              });

              return (
                <>
                  {sortedGroupKeys.map(hostname => {
                    const groupTabs = groups[hostname];
                    const color = getDomainColor(hostname);

                    return (
                      <div key={hostname} style={{ marginBottom: '20px' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '10px',
                          paddingLeft: '4px'
                        }}>
                          <div style={{
                            width: '4px',
                            height: '14px',
                            borderRadius: '2px',
                            backgroundColor: color,
                            boxShadow: `0 0 8px ${color}66`
                          }} />
                          <div style={{
                            fontSize: 'var(--font-xs)',
                            fontWeight: 700,
                            color: '#E2E8F0',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            fontFamily: 'monospace',
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: '6px'
                          }}>
                            {hostname}
                            <span style={{
                              fontSize: 'var(--font-xs)',
                              color: color,
                              opacity: 0.8,
                              background: `${color}1A`,
                              padding: '1px 6px',
                              borderRadius: '4px'
                            }}>
                              {groupTabs.length}
                            </span>
                          </div>
                        </div>

                        <div className="tabs-grid">
                          {groupTabs.map(tab => (
                            <TabItem
                              key={tab.id}
                              tab={tab}
                              color={color}
                              handleTabClick={handleTabClick}
                              handlePinTab={handlePinTab}
                              handleCloseTab={handleCloseTab}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )
      }

      <style jsx>{`
        .tab-card:hover .tab-pin-btn,
        .tab-card:hover .tab-close-btn {
          opacity: 1 !important;
        }
        .tab-card:hover .tab-hover-bg {
          opacity: 1 !important;
        }
        .tab-pin-btn:hover {
          color: #F59E0B !important;
        }
        .tab-close-btn:hover {
          color: #EF4444 !important;
        }
      `}</style>
    </div >
  );
}

function TabItem({ tab, color, handleTabClick, handlePinTab, handleCloseTab }) {
  const accentColor = color || '#3B82F6';
  return (
    <div
      className="browser-tab-card tab-card"
      onClick={() => handleTabClick(tab)}
      data-active={tab.active}
      style={{
        position: 'relative',
        overflow: 'hidden',
        '--domain-color': accentColor // Keep this available for subtle accents if needed via CSS
      }}
    >
      {/* Dynamic hover gradient effect */}
      <div className="tab-hover-bg" style={{
        position: 'absolute',
        inset: 0,
        opacity: 0,
        transition: 'opacity 0.2s',
        pointerEvents: 'none',
        // Moving gradient to CSS using the variable or generic
        background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, transparent 100%)'
      }} />
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
            style={{ color: '#F59E0B', fontSize: 'var(--font-sm)' }}
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
  );
}
