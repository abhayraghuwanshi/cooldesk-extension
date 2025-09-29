import { faBroom, faHistory, faRotateRight, faUndo, faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { getHostTabs } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function CurrentTabsSection({ onAddPing, onRequestPreview }) {
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [removingTabIds, setRemovingTabIds] = React.useState(new Set());
  const [autoCleanupEnabled, setAutoCleanupEnabled] = React.useState(false);
  const [recentlyClosed, setRecentlyClosed] = React.useState([]);
  const [showRecentlyClosed, setShowRecentlyClosed] = React.useState(false);
  const [autoOrganizeEnabled, setAutoOrganizeEnabled] = React.useState(false);

  // New state to manage which group is expanded
  const [expandedGroup, setExpandedGroup] = React.useState(null);
  const groupsContainerRef = React.useRef(null);


  const refreshTabs = React.useCallback(() => {
    setTabsError(null);
    try {
      const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;
      if (hasTabsQuery) {
        chrome.tabs.query({}, async (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            setTabsError(lastErr.message || 'Unable to query tabs');
            setTabs([]);
            return;
          }
          const tabList = Array.isArray(list) ? list : [];
          setTabs(tabList);
        });
      } else {
        // Fallback: fetch tabs mirrored by the extension to the host (Electron mode)
        (async () => {
          const res = await getHostTabs();
          if (res.ok) {
            setTabs(res.tabs || []);
            setTabsError(null);
          } else {
            setTabs([]);
            // Keep UI clean in Electron: don't surface noisy errors
            setTabsError('');
          }
        })();
      }
    } catch (e) {
      // Keep UI quiet in non-Chrome environments
      setTabsError('');
      setTabs([]);
    }
  }, []);

  // Effect to handle clicking outside of an expanded group to close it
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (groupsContainerRef.current && !groupsContainerRef.current.contains(event.target)) {
        setExpandedGroup(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Load settings from storage
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
          const result = await chrome.storage.local.get(['autoCleanupEnabled', 'autoOrganizeEnabled']);
          setAutoCleanupEnabled(result.autoCleanupEnabled || false);
          setAutoOrganizeEnabled(result.autoOrganizeEnabled || false);
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
    };
    loadSettings();
  }, []);

  React.useEffect(() => {
    refreshTabs();
    const id = setInterval(refreshTabs, 15000);
    return () => {
      clearInterval(id);
    };
  }, [refreshTabs]);

  // Toggle auto-cleanup and save to storage
  const toggleAutoCleanup = React.useCallback(async () => {
    const newValue = !autoCleanupEnabled;
    setAutoCleanupEnabled(newValue);

    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ autoCleanupEnabled: newValue });

        // Send message to background script to update cleanup state
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'setAutoCleanup',
            enabled: newValue
          });
        }
      }
    } catch (e) {
      console.warn('Failed to save auto-cleanup setting:', e);
    }
  }, [autoCleanupEnabled]);

  // Toggle auto-organize and save to storage
  const toggleAutoOrganize = React.useCallback(async () => {
    const newValue = !autoOrganizeEnabled;
    setAutoOrganizeEnabled(newValue);
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ autoOrganizeEnabled: newValue });
      }
    } catch (e) {
      console.warn('Failed to save auto-organize setting:', e);
    }
  }, [autoOrganizeEnabled]);

  // Fetch recently closed tabs
  const fetchRecentlyClosed = React.useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.sessions?.getRecentlyClosed) {
        const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
        const closedTabs = sessions
          .filter(session => session.tab) // Only include tabs, not windows
          .map(session => session.tab)
          .filter(tab => {
            // Filter out system/extension tabs
            const url = tab.url || '';
            return !url.startsWith('chrome://') &&
              !url.startsWith('chrome-extension://') &&
              !url.startsWith('edge://') &&
              !url.startsWith('moz-extension://');
          });
        setRecentlyClosed(closedTabs);
      }
    } catch (e) {
      console.warn('Failed to fetch recently closed tabs:', e);
      setRecentlyClosed([]);
    }
  }, []);

  // Restore a recently closed tab
  const restoreTab = React.useCallback(async (sessionId) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.sessions?.restore) {
        await chrome.sessions.restore(sessionId);
        // Refresh the recently closed list after restoration
        setTimeout(fetchRecentlyClosed, 500);
        // Also refresh current tabs
        setTimeout(refreshTabs, 500);
      }
    } catch (e) {
      console.warn('Failed to restore tab:', e);
    }
  }, [fetchRecentlyClosed, refreshTabs]);

  // Load recently closed tabs when component mounts or when toggled
  React.useEffect(() => {
    if (showRecentlyClosed) {
      fetchRecentlyClosed();
    }
  }, [showRecentlyClosed, fetchRecentlyClosed]);

  // Sort tabs by hostname (DNS) so similar URLs are grouped, filter out removing tabs
  const sortedTabs = React.useMemo(() => {
    const getHost = (t) => {
      try { return new URL(t?.url || '').hostname || ''; } catch { return ''; }
    };
    const arr = Array.isArray(tabs) ? [...tabs] : [];
    // Filter out tabs that are being removed
    const filteredArr = arr.filter(tab => !removingTabIds.has(tab.id));
    filteredArr.sort((a, b) => {
      const ha = getHost(a);
      const hb = getHost(b);
      if (ha !== hb) return ha.localeCompare(hb);
      // Secondary sort: by full URL for stable grouping
      const ua = a?.url || '';
      const ub = b?.url || '';
      return ua.localeCompare(ub);
    });
    return filteredArr;
  }, [tabs, removingTabIds]);

  // *** NEW LOGIC: Group sorted tabs into a dictionary by hostname ***
  const groupedTabs = React.useMemo(() => {
    const filteredTabs = Array.isArray(tabs) ? tabs.filter(tab => !removingTabIds.has(tab.id)) : [];
    const groups = filteredTabs.reduce((acc, tab) => {
      try {
        const hostname = new URL(tab.url || '').hostname.replace(/^www\./, '');
        if (!acc[hostname]) { acc[hostname] = []; }
        acc[hostname].push(tab);
      } catch (e) {/* ignore */ }
      return acc;
    }, {});
    return Object.keys(groups).sort().reduce((obj, key) => {
      obj[key] = groups[key];
      return obj;
    }, {});
  }, [tabs, removingTabIds]);


  const focusTab = React.useCallback((tab) => {
    if (!tab || !tab.id) return;
    try {
      const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
      if (!hasTabsUpdate) return;
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null && chrome?.windows?.update) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
      // Close the popover after focusing a tab
      setExpandedGroup(null);
    } catch (e) {
      console.warn('Failed to focus tab', e);
    }
  }, []);

  const removeTab = React.useCallback((tab) => {
    try {
      if (!tab) return;
      setRemovingTabIds(prev => new Set([...prev, tab.id]));

      const hasRemove = typeof chrome !== 'undefined' && chrome?.tabs?.remove;
      if (hasRemove && tab.id != null) {
        chrome.tabs.remove(tab.id, () => {
          setTimeout(refreshTabs, 100);
        });
      }
    } catch (e) {
      console.warn('Failed to remove tab', e);
      setRemovingTabIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(tab.id);
        return newSet;
      });
    }
  }, [refreshTabs]);

  const handleToggleGroup = (hostname) => {
    setExpandedGroup(prev => (prev === hostname ? null : hostname));
  };

  // *** NEW FUNCTION to physically arrange tabs in the browser window ***
  React.useEffect(() => {
    if (!autoOrganizeEnabled || tabs.length === 0 || typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.move) {
      return;
    }

    const arrangeTabs = () => {
      try {
        // Build the desired order per window, skipping pinned tabs
        const byWindow = new Map();
        Object.values(groupedTabs)
          .flat()
          .filter(t => !t.pinned)
          .forEach(t => {
            if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
            byWindow.get(t.windowId).push(t.id);
          });

        // For each window, compare and move if different
        byWindow.forEach((desiredIds, windowId) => {
          const currentIds = tabs
            .filter(t => t.windowId === windowId && !t.pinned && desiredIds.includes(t.id))
            .map(t => t.id);

          if (JSON.stringify(desiredIds) !== JSON.stringify(currentIds)) {
            chrome.tabs.move(desiredIds, { index: 0 }, () => {
              const err = chrome.runtime?.lastError;
              if (err) {
                console.warn('tabs.move failed:', err.message);
              }
            });
          }
        });
      } catch (e) {
        console.warn('arrangeTabs error:', e);
      }
    };

    // Arrange tabs shortly after they are refreshed.
    const timeoutId = setTimeout(arrangeTabs, 300);
    return () => clearTimeout(timeoutId);

  }, [groupedTabs, tabs, autoOrganizeEnabled]);

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      <style>
        {`
          .tab-group-container, .popover-list-item {
            transition: all 0.2s ease-in-out;
          }
          .tab-group-container:hover {
            transform: translateY(-2px);
          }
          .popover-list-item:hover {
            background-color: rgba(255, 255, 255, 0.1);
          }
          .popover-list {
            animation: fadeIn 0.2s ease-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}
      </style>

      {/* Header remains the same */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h2 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          Tabs
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowRecentlyClosed(!showRecentlyClosed)}
            style={{
              height: 32,
              width: 32,
              borderRadius: '50%',
              border: 'none',
              background: showRecentlyClosed ? 'rgba(255, 149, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: showRecentlyClosed ? '#FF9500' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Recently closed"
          >
            <FontAwesomeIcon icon={faHistory} style={{ fontSize: '12px' }} />
          </button>
          <button
            onClick={toggleAutoCleanup}
            style={{
              height: 32,
              width: 32,
              borderRadius: '50%',
              border: 'none',
              background: autoCleanupEnabled ? 'rgba(52, 199, 89, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: autoCleanupEnabled ? '#34C759' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            title={`Auto-cleanup ${autoCleanupEnabled ? 'enabled' : 'disabled'}`}
          >
            <FontAwesomeIcon icon={faBroom} style={{ fontSize: '12px' }} />
          </button>
          <button
            onClick={toggleAutoOrganize}
            style={{
              height: 32,
              width: 32,
              borderRadius: '50%',
              border: 'none',
              background: autoOrganizeEnabled ? 'rgba(0, 122, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: autoOrganizeEnabled ? '#007AFF' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title={`Auto-organize ${autoOrganizeEnabled ? 'enabled' : 'disabled'}`}
          >
            <FontAwesomeIcon icon={faLayerGroup} style={{ fontSize: '12px' }} />
          </button>
          <button
            onClick={refreshTabs}
            style={{
              height: 32,
              width: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Reload tabs"
          >
            <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: '12px' }} />
          </button>
        </div>
      </div>

      {tabsError ? (
        <div style={{
          background: 'rgba(255, 59, 48, 0.1)',
          border: '1px solid rgba(255, 59, 48, 0.2)',
          borderRadius: 12,
          padding: 12,
          color: '#FF3B30',
          fontSize: 'var(--font-size-base)',
          marginBottom: 16
        }}>
          {String(tabsError)}
        </div>
      ) : (
        // *** REVISED RENDERING LOGIC FOR GROUPED TABS ***
        <div ref={groupsContainerRef} style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'flex-start',
          gap: '16px',
          padding: '20px 16px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          minHeight: '100px',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 4px 20px rgba(0, 0, 0, 0.1)'
        }}>
          {Object.keys(groupedTabs).length === 0 ? (
            <div style={{ width: '100%', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)', fontStyle: 'italic' }}>
              No tabs found
            </div>
          ) : (
            Object.entries(groupedTabs).map(([hostname, groupTabs]) => {
              const isExpanded = expandedGroup === hostname;
              const firstTab = groupTabs[0];
              if (!firstTab) return null;

              return (
                <div key={hostname} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Collapsed State */}
                  <div
                    className="tab-group-container"
                    style={{
                      width: '80px',
                      height: '80px',
                      padding: '8px',
                      borderRadius: '18px',
                      background: 'rgba(45, 45, 50, 0.7)',
                      border: '1px solid rgba(70, 70, 75, 0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
                      backdropFilter: 'blur(10px)',
                      position: 'relative',
                    }}
                    onClick={() => handleToggleGroup(hostname)}
                  >
                    <img
                      src={getFaviconUrl(firstTab.url, 64)}
                      alt={`${hostname} favicon`}
                      width={32}
                      height={32}
                      style={{ borderRadius: '8px', marginBottom: '4px' }}
                      onError={(e) => { e.currentTarget.src = '/default-favicon.svg'; }}
                    />
                    <div style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '11px', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hostname}
                    </div>
                    {/* Badge */}
                    <div style={{
                      position: 'absolute',
                      top: '-5px',
                      right: '-5px',
                      background: '#007aff',
                      color: 'white',
                      borderRadius: '10px',
                      padding: '2px 7px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
                    }}>
                      {groupTabs.length}
                    </div>
                  </div>

                  {/* Expanded State (Popover) */}
                  {isExpanded && (
                    <div className="popover-list" style={{
                      position: 'absolute',
                      top: '90px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '280px',
                      background: 'rgba(35, 35, 40, 0.95)',
                      backdropFilter: 'blur(20px)',
                      borderRadius: '14px',
                      border: '1px solid rgba(70, 70, 75, 0.7)',
                      boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                      padding: '8px',
                      zIndex: 100
                    }}>
                      {groupTabs.map(tab => (
                        <div
                          key={tab.id}
                          className="popover-list-item"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 10px',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            color: 'rgba(255, 255, 255, 0.9)'
                          }}
                          onClick={() => focusTab(tab)}
                        >
                          <img
                            src={getFaviconUrl(tab.url, 32)}
                            alt=""
                            width={18}
                            height={18}
                            style={{ borderRadius: '4px', flexShrink: 0 }}
                            onError={(e) => { e.currentTarget.src = '/default-favicon.svg'; }}
                          />
                          <span style={{ flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '14px' }}>
                            {tab.title}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent focusTab from firing
                              removeTab(tab);
                            }}
                            title="Close tab"
                            style={{
                              background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.6)', cursor: 'pointer',
                              fontSize: '16px', padding: '0 5px', lineHeight: 1
                            }}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Recently Closed Section remains the same */}
      {showRecentlyClosed && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{
            fontSize: 'var(--font-size-lg)',
            fontWeight: 600,
            margin: '0 0 12px 0',
            color: '#ffffff',
            letterSpacing: '-0.3px',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <FontAwesomeIcon icon={faHistory} style={{ color: '#FF9500', fontSize: '14px' }} />
            Recently Closed
          </h3>
          {recentlyClosed.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)', padding: '20px', fontStyle: 'italic' }}>
              No recently closed tabs
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
              {recentlyClosed.map((tab, index) => (
                <div
                  key={`${tab.sessionId || index}-${tab.url}`}
                  style={{
                    padding: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onClick={() => restoreTab(tab.sessionId)}
                >
                  <img src={getFaviconUrl(tab.url, 32)} alt="" width={16} height={16} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.src = '/default-favicon.svg'; }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</div>
                  </div>
                  <FontAwesomeIcon icon={faUndo} style={{ color: 'rgba(255,255,255,0.6)', fontSize: '10px' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
