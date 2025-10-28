import { faBroom, faClose, faGear, faHistory, faLayerGroup, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { getHostTabs } from '../../services/extensionApi';
import '../../styles/default/CurrentTabsSection.css';
import { getFaviconUrl } from '../../utils';

export function CurrentTabsSection({ onAddPing, onRequestPreview }) {
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [removingTabIds, setRemovingTabIds] = React.useState(new Set());
  const [autoCleanupEnabled, setAutoCleanupEnabled] = React.useState(false);
  const [recentlyClosed, setRecentlyClosed] = React.useState([]);
  const [recentSortKey, setRecentSortKey] = React.useState('time_desc'); // time_desc | time_asc | host_az | title_az
  const [recentView, setRecentView] = React.useState('icons'); // icons | list
  const [showRecentlyClosed, setShowRecentlyClosed] = React.useState(false);
  const [autoOrganizeEnabled, setAutoOrganizeEnabled] = React.useState(false);

  // New state to manage which group is expanded
  const [expandedGroup, setExpandedGroup] = React.useState(null);
  const groupsContainerRef = React.useRef(null);
  // Settings popover state
  const [showSettings, setShowSettings] = React.useState(false);
  const settingsRef = React.useRef(null);

  // Helper function to truncate hostname to consistent length
  const truncateHostname = (hostname, maxLength = 18) => {
    if (!hostname || hostname.length <= maxLength) return hostname;
    return hostname.substring(0, maxLength) + '...';
  };


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
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
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

  // Hoisted function: Move all tabs for each hostname from other windows into the active window
  async function consolidateToActiveWindow() {
    try {
      if (typeof chrome === 'undefined' || !chrome?.windows?.getLastFocused || !chrome?.tabs?.move) return;

      // Find the target window (last focused)
      const focused = await chrome.windows.getLastFocused({ populate: false });
      const targetWindowId = focused?.id;
      if (targetWindowId == null) return;

      // Collect tabs to move (skip pinned) grouped by hostname already in groupedTabs
      const tabsToMove = [];
      Object.values(groupedTabs).forEach((arr) => {
        const fromOthers = arr.filter(t => !t.pinned && t.windowId !== targetWindowId);
        // Keep relative order by original index
        fromOthers.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        tabsToMove.push(...fromOthers.map(t => t.id));
      });

      if (tabsToMove.length === 0) return;

      // Move all at once to end of target window; lastError logged if any
      await new Promise((resolve) => {
        chrome.tabs.move(tabsToMove, { windowId: targetWindowId, index: -1 }, () => {
          const err = chrome.runtime?.lastError;
          if (err) {
            console.warn('tabs.move (consolidate) failed:', err.message);
          }
          resolve();
        });
      });
    } catch (e) {
      console.warn('consolidateToActiveWindow error:', e);
    }
  }

  // Hoisted function: Arrange tabs within each window per current groupedTabs (skips pinned)
  function performArrange() {
    try {
      if (!autoOrganizeEnabled || tabs.length === 0 || typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.move) {
        return;
      }
      const byWindow = new Map();
      Object.values(groupedTabs)
        .flat()
        .filter(t => !t.pinned)
        .forEach(t => {
          if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
          byWindow.get(t.windowId).push(t.id);
        });

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
      console.warn('performArrange error:', e);
    }
  }

  // Toggle auto-organize and save to storage
  const toggleAutoOrganize = React.useCallback(async () => {
    const newValue = !autoOrganizeEnabled;
    setAutoOrganizeEnabled(newValue);
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ autoOrganizeEnabled: newValue });
      }
      // If enabling, immediately consolidate to the active window (Option A)
      if (newValue) {
        try {
          await consolidateToActiveWindow();
          // Give a moment and then refresh, arrange effect will finish grouping
          setTimeout(() => {
            try { refreshTabs(); } catch { }
          }, 200);
          // Also trigger an arrange pass right away
          setTimeout(() => {
            try { performArrange(); } catch { }
          }, 50);
        } catch (e) {
          console.warn('consolidateToActiveWindow failed:', e);
        }
      }
    } catch (e) {
      console.warn('Failed to save auto-organize setting:', e);
    }
  }, [autoOrganizeEnabled]);

  // Fetch recently closed tabs
  const fetchRecentlyClosed = React.useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.sessions?.getRecentlyClosed) {
        const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
        const items = sessions
          .filter(s => s.tab)
          .map(s => ({ tab: s.tab, lastModified: s.lastModified }))
          .filter(item => {
            const url = item.tab?.url || '';
            return !url.startsWith('chrome://') &&
              !url.startsWith('chrome-extension://') &&
              !url.startsWith('edge://') &&
              !url.startsWith('moz-extension://');
          });
        setRecentlyClosed(items);
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

  // Derived: group recently closed by timeline buckets and sort
  const groupedRecentlyClosed = React.useMemo(() => {
    const items = Array.isArray(recentlyClosed) ? [...recentlyClosed] : [];
    const getHost = (u) => { try { return new URL(u || '').hostname.replace(/^www\./, ''); } catch { return ''; } };
    const now = Date.now();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    // Sort
    items.sort((a, b) => {
      const at = a.lastModified ?? 0; const bt = b.lastModified ?? 0;
      const ah = getHost(a.tab?.url); const bh = getHost(b.tab?.url);
      const atitle = a.tab?.title || ''; const btitle = b.tab?.title || '';
      switch (recentSortKey) {
        case 'time_asc': return (at - bt);
        case 'host_az': return ah.localeCompare(bh) || atitle.localeCompare(btitle);
        case 'title_az': return atitle.localeCompare(btitle);
        case 'time_desc':
        default: return (bt - at);
      }
    });

    const buckets = { Today: [], Yesterday: [], Earlier: [] };
    for (const it of items) {
      const t = it.lastModified ?? 0;
      if (t >= startOfToday) buckets.Today.push(it);
      else if (t >= startOfYesterday) buckets.Yesterday.push(it);
      else buckets.Earlier.push(it);
    }
    return buckets;
  }, [recentlyClosed, recentSortKey]);

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
      // Never close the currently active tab to avoid accidental closures
      if (tab.active) {
        return;
      }
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

  // Arrange tabs in the browser window whenever inputs change
  React.useEffect(() => {
    if (!autoOrganizeEnabled || tabs.length === 0 || typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.move) {
      return;
    }

    // Arrange tabs shortly after they are refreshed.
    const timeoutId = setTimeout(performArrange, 200);
    return () => clearTimeout(timeoutId);

  }, [groupedTabs, tabs, autoOrganizeEnabled]);

  return (
    <div className="currentTabs-root">

      {/* Header remains the same */}
      <div className="currentTabs-header">
        <h2 className="currentTabs-headerTitle">
          Tabs
        </h2>
        <div className="currentTabs-headerActions">
          <button
            onClick={() => setShowRecentlyClosed(!showRecentlyClosed)}
            className="currentTabs-iconBtn"
            style={{ background: showRecentlyClosed ? 'rgba(255,149,0,0.2)' : undefined, color: showRecentlyClosed ? '#FF9500' : undefined }}
            title="Recently closed"
          >
            <FontAwesomeIcon icon={faHistory} className="currentTabs-icon" />
          </button>
          {/* Settings button and popover */}
          <div ref={settingsRef} className="currentTabs-settingsWrap">
            <button
              onClick={() => setShowSettings(s => !s)}
              className="currentTabs-iconBtn"
              style={{ background: showSettings ? 'rgba(255,255,255,0.2)' : undefined }}
              title="Settings"
            >
              <FontAwesomeIcon icon={faGear} className="currentTabs-icon" />
            </button>
            {showSettings && (
              <div className="currentTabs-settingsPopover" style={{ maxWidth: '90vw', maxHeight: 320, overflowY: 'auto' }}>
                <div className="currentTabs-settingsTitle" style={{ marginBottom: 10 }}>
                  Settings
                </div>
                <div className="currentTabs-divider" style={{ margin: '8px 0 10px 0' }} />

                <div className="currentTabs-settingRow">
                  <div className="currentTabs-settingLabel">
                    <FontAwesomeIcon icon={faBroom} className="currentTabs-icon" style={{ color: '#34C759' }} />
                    <span style={{ fontSize: 13 }}>Auto-cleanup</span>
                  </div>
                  <label className="currentTabs-toggle">
                    <input type="checkbox" checked={!!autoCleanupEnabled} onChange={toggleAutoCleanup} />
                    <span>{autoCleanupEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>

                <div className="currentTabs-divider" style={{ background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />

                <div className="currentTabs-settingRow">
                  <div className="currentTabs-settingLabel">
                    <FontAwesomeIcon icon={faLayerGroup} className="currentTabs-icon" style={{ color: '#007AFF' }} />
                    <span style={{ fontSize: 13 }}>Auto-organize</span>
                  </div>
                  <label className="currentTabs-toggle">
                    <input type="checkbox" checked={!!autoOrganizeEnabled} onChange={toggleAutoOrganize} />
                    <span>{autoOrganizeEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={refreshTabs}
            className="currentTabs-iconBtn"
            title="Reload tabs"
          >
            <FontAwesomeIcon icon={faRotateRight} className="currentTabs-icon" />
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
        <div ref={groupsContainerRef} className="currentTabs-groupsRow">
          {Object.keys(groupedTabs).length === 0 ? (
            <div className="currentTabs-emptyState">
              No tabs found
            </div>
          ) : (
            Object.entries(groupedTabs).map(([hostname, groupTabs]) => {
              const isExpanded = expandedGroup === hostname;
              const firstTab = groupTabs[0];
              if (!firstTab) return null;

              const hasActive = Array.isArray(groupTabs) && groupTabs.some(t => !!t.active);
              return (
                <div key={hostname} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Collapsed State */}
                  <div
                    className={`tab-group-container currentTabs-hostCard ${hasActive ? 'is-active' : ''}`}
                    onClick={() => {
                      if (groupTabs.length === 1) {
                        focusTab(firstTab);
                      } else {
                        handleToggleGroup(hostname);
                      }
                    }}
                  >
                    <img
                      src={getFaviconUrl(firstTab.url, 64) || '/logo.png'}
                      alt={`${hostname} favicon`}
                      width={32}
                      height={32}
                      className="currentTabs-hostFavicon"
                      onError={(e) => { e.currentTarget.src = '/logo.png'; }}
                    />
                    <div className="currentTabs-hostLabel" title={hostname}>
                      {truncateHostname(hostname)}
                    </div>
                    {/* Count Badge */}
                    {groupTabs.length > 1 ? (
                      <div className="currentTabs-badge">
                        {groupTabs.length}
                      </div>
                    ) : (
                      <button
                        className="currentTabs-badge"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (firstTab?.active) return
                          removeTab(firstTab)
                        }}
                        title={firstTab?.active ? 'Cannot close active tab' : 'Close tab'}
                        disabled={!!firstTab?.active}
                      >
                        <FontAwesomeIcon icon={faClose} />
                      </button>
                    )}

                  </div>

                  {/* Expanded State (Popover) */}
                  {isExpanded && (
                    <div
                      className="popover-list currentTabs-popover is-positioned"
                    >
                      {groupTabs.map(tab => (
                        <div
                          key={tab.id}
                          className={`currentTabs-listItem ${tab.active ? 'is-active' : ''}`}
                          title={`${tab.title || ''}${tab.url ? ` — ${tab.url}` : ''}`}
                          onClick={() => focusTab(tab)}
                        >
                          <img
                            src={getFaviconUrl(tab.url, 32) || '/logo.png'}
                            alt=""
                            width={18}
                            height={18}
                            className="currentTabs-favicon"
                            title={tab.title || tab.url || ''}
                            onError={(e) => { e.currentTarget.src = '/logo.png'; }}
                          />
                          {/* Smart text to differentiate tabs */}
                          {(() => {
                            let displayTitle = tab?.title || '';
                            let displayMeta = '';
                            try {
                              const u = new URL(tab?.url || '');
                              const host = u.hostname.replace(/^www\./, '');
                              if (!displayTitle) {
                                const segs = u.pathname.split('/').filter(Boolean);
                                displayTitle = segs[segs.length - 1] || host || 'Tab';
                              }
                              const shortPath = u.pathname.length > 1 ? u.pathname : '';
                              const qp = u.search ? new URLSearchParams(u.search) : null;
                              let qHint = '';
                              if (qp && [...qp.keys()].length > 0) {
                                const keys = [...qp.keys()].slice(0, 2).join(',');
                                qHint = keys ? ` ?${keys}` : '';
                              }
                              const hashHint = u.hash ? ' #' : '';
                              displayMeta = `${host}${shortPath}${qHint}${hashHint}`;
                            } catch { }
                            return (
                              <div className="currentTabs-tabText">
                                <div className="currentTabs-tabTitle">{displayTitle}</div>
                                {displayMeta ? (<div className="currentTabs-tabMeta">{displayMeta}</div>) : null}
                              </div>
                            );
                          })()}
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent focusTab from firing
                              if (tab.active) return; // Don't allow closing active tab
                              removeTab(tab);
                            }}
                            title="Close tab"
                            className="currentTabs-closeBtn"
                            style={{ color: tab.active ? 'rgba(255, 255, 255, 0.25)' : undefined, cursor: tab.active ? 'not-allowed' : undefined }}
                            disabled={!!tab.active}
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

      {/* Recently Closed Section: Timeline + Sort Controls */}
      {showRecentlyClosed && (
        <div style={{ marginTop: 24 }}>
          <h3 className="currentTabs-sectionTitle">
            <FontAwesomeIcon icon={faHistory} className="currentTabs-sectionIcon" />
            Recently Closed
          </h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 12px 0', gap: 8 }}>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Timeline</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                <span>Sort</span>
                <select
                  value={recentSortKey}
                  onChange={(e) => setRecentSortKey(e.target.value)}
                  className="recent-sort-select"
                >
                  <option value="time_desc">Newest first</option>
                  <option value="time_asc">Oldest first</option>
                  <option value="host_az">Hostname A→Z</option>
                  <option value="title_az">Title A→Z</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setRecentView('icons')}
                  className={`currentTabs-toggleBtn ${recentView === 'icons' ? 'currentTabs-toggleBtn--active' : ''}`}
                  title="Icon view"
                >Icons</button>
                <button
                  onClick={() => setRecentView('list')}
                  className={`currentTabs-toggleBtn ${recentView === 'list' ? 'currentTabs-toggleBtn--active' : ''}`}
                  title="List view"
                >List</button>
              </div>
            </div>
          </div>
          {recentlyClosed.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)', padding: '20px', fontStyle: 'italic' }}>
              No recently closed tabs
            </div>
          ) : (
            <div>
              {(['Today', 'Yesterday', 'Earlier']).map(section => (
                groupedRecentlyClosed[section] && groupedRecentlyClosed[section].length > 0 ? (
                  <div key={section} style={{ marginBottom: 12 }}>
                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 600, margin: '8px 0' }}>{section}</div>
                    {recentView === 'icons' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 8 }}>
                        {groupedRecentlyClosed[section].map((item, index) => (
                          <div
                            key={`${item.tab?.sessionId || index}-${item.tab?.url}`}
                            onClick={() => restoreTab(item.tab?.sessionId)}
                            title={`${item.tab?.title || ''}${item.tab?.url ? ` — ${item.tab.url}` : ''}`}
                            className="currentTabs-iconTile"
                          >
                            <img src={getFaviconUrl(item.tab?.url, 32)} alt="" width={16} height={16} style={{ borderRadius: 4 }} onError={(e) => { e.currentTarget.src = '/default-favicon.svg'; }} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {groupedRecentlyClosed[section].map((item, index) => (
                          <div
                            key={`${item.tab?.sessionId || index}-${item.tab?.url}`}
                            className="currentTabs-listRow"
                            title={`${item.tab?.title || ''}${item.tab?.url ? ` — ${item.tab.url}` : ''}`}
                          >
                            <img src={getFaviconUrl(item.tab?.url, 32)} alt="" width={16} height={16} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.src = '/default-favicon.svg'; }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.tab?.title}</div>
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {(() => { try { return new URL(item.tab?.url || '').hostname.replace(/^www\./, ''); } catch { return ''; } })()}
                              </div>
                            </div>
                            <button
                              onClick={() => restoreTab(item.tab?.sessionId)}
                              className="currentTabs-restoreBtn"
                              title="Restore tab"
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}