import { faCode, faLayerGroup, faSync } from '@fortawesome/free-solid-svg-icons';
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

    // Keep the interval as a fallback backup
    const interval = setInterval(refreshTabs, 10000);

    return () => {
      clearInterval(interval);
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
            fontSize: '14px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📑</div>
            <div>No tabs found</div>
            <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>
              Open some browser tabs to see them here
            </div>
          </div>
        ) : (
          <div className="tabs-container" style={{ padding: '0 12px 12px' }}>
            {/* Local Development Section */}
            {(() => {
              const localTabs = tabs.filter(t => {
                try {
                  const url = new URL(t.url);
                  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
                } catch { return false; }
              });

              const otherTabs = tabs.filter(t => {
                try {
                  const url = new URL(t.url);
                  return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';
                } catch { return true; }
              });

              const localGroups = {};
              localTabs.forEach(t => {
                try {
                  const url = new URL(t.url);
                  const key = `${url.hostname}${url.port ? ':' + url.port : ''}`;
                  if (!localGroups[key]) localGroups[key] = [];
                  localGroups[key].push(t);
                } catch { }
              });

              return (
                <>
                  {Object.keys(localGroups).length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#60A5FA', // Blue accent
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        paddingTop: '12px'
                      }}>
                        <FontAwesomeIcon icon={faCode} /> Local Development
                      </div>

                      {Object.entries(localGroups).map(([groupKey, groupTabs]) => (
                        <div key={groupKey} style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '10px',
                            color: '#94A3B8',
                            marginBottom: '6px',
                            fontFamily: 'monospace',
                            paddingLeft: '4px'
                          }}>
                            {groupKey}
                          </div>
                          <div className="tabs-grid">
                            {groupTabs.map(tab => (
                              <TabItem
                                key={tab.id}
                                tab={tab}
                                handleTabClick={handleTabClick}
                                handlePinTab={handlePinTab}
                                handleCloseTab={handleCloseTab}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                      <div style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)', margin: '16px 0 8px' }}></div>
                    </div>
                  )}

                  {/* Other Tabs */}
                  {otherTabs.length > 0 && (
                    <div className="tabs-grid">
                      {otherTabs.map(tab => (
                        <TabItem
                          key={tab.id}
                          tab={tab}
                          handleTabClick={handleTabClick}
                          handlePinTab={handlePinTab}
                          handleCloseTab={handleCloseTab}
                        />
                      ))}
                    </div>
                  )}
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

function TabItem({ tab, handleTabClick, handlePinTab, handleCloseTab }) {
  return (
    <div
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
  );
}
