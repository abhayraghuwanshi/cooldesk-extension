import { faBroom, faGear, faHistory, faLayerGroup, faRotateRight, faUndo } from '@fortawesome/free-solid-svg-icons';
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
    const startOfToday = new Date().setHours(0,0,0,0);
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
          .recent-sort-select {
            appearance: none;
            -webkit-appearance: none;
            background-color: rgba(255, 255, 255, 0.08);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 8px;
            padding: 4px 24px 4px 8px;
            background-position: right 8px center;
            background-repeat: no-repeat;
          }
          .recent-sort-select:hover {
            background-color: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.28);
          }
          .recent-sort-select:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.35);
            border-color: rgba(0, 122, 255, 0.6);
          }
          .recent-sort-select option {
            background-color: #1f1f25;
            color: #fff;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <button
            onClick={() => setShowRecentlyClosed(!showRecentlyClosed)}
            style={{
              height: 32,
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
          {/* Settings button and popover */}
          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSettings(s => !s)}
              style={{
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: showSettings ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              title="Settings"
            >
              <FontAwesomeIcon icon={faGear} style={{ fontSize: '12px' }} />
            </button>
            {showSettings && (
              <div style={{
                position: 'absolute',
                top: '40px',
                right: 0,
                width: 320,
                maxWidth: '90vw',
                maxHeight: 320,
                overflowY: 'auto',
                background: 'rgba(28, 28, 33, 0.96)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 14,
                padding: 14,
                boxShadow: '0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
                backdropFilter: 'blur(14px)',
                zIndex: 200
              }}>
                <div style={{
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: '-0.2px',
                  marginBottom: 10
                }}>
                  Settings
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 0 10px 0' }} />

                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff',
                    padding: '8px 6px', borderRadius: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FontAwesomeIcon icon={faBroom} style={{ fontSize: 12, color: '#34C759' }} />
                    <span style={{ fontSize: 13 }}>Auto-cleanup</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!autoCleanupEnabled} onChange={toggleAutoCleanup} style={{ transform: 'scale(1.1)' }} />
                    <span>{autoCleanupEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>

                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />

                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff',
                    padding: '8px 6px', borderRadius: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FontAwesomeIcon icon={faLayerGroup} style={{ fontSize: 12, color: '#007AFF' }} />
                    <span style={{ fontSize: 13 }}>Auto-organize</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!autoOrganizeEnabled} onChange={toggleAutoOrganize} style={{ transform: 'scale(1.1)' }} />
                    <span>{autoOrganizeEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={refreshTabs}
            style={{
              height: 32,
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
                      bottom: '90px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '320px',
                      background: 'rgba(35, 35, 40, 0.95)',
                      backdropFilter: 'blur(20px)',
                      borderRadius: '14px',
                      border: '1px solid rgba(70, 70, 75, 0.7)',
                      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
                      pointerEvents: 'auto',
                      zIndex: 10000,
                      padding: '8px'
                    }}>
                      {groupTabs.map(tab => (
                        <div
                          key={tab.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 10px',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            color: 'rgba(255, 255, 255, 0.9)'
                          }}
                          title={`${tab.title || ''}${tab.url ? ` — ${tab.url}` : ''}`}
                          onClick={() => focusTab(tab)}
                        >
                          <img
                            src={getFaviconUrl(tab.url, 32)}
                            alt=""
                            width={18}
                            height={18}
                            style={{ borderRadius: '4px', flexShrink: 0 }}
                            title={tab.title || tab.url || ''}
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

      {/* Recently Closed Section: Timeline + Sort Controls */}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 12px 0', gap: 8 }}>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Timeline</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                <span>Sort</span>
                <select
                  value={recentSortKey}
                  onChange={(e) => setRecentSortKey(e.target.value)}
                  className="recent-sort-select"
                  style={{
                    background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    padding: '4px 8px', fontSize: 12, outline: 'none'
                  }}
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
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: recentView === 'icons' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
                    color: '#fff', cursor: 'pointer', fontSize: 12
                  }}
                  title="Icon view"
                >Icons</button>
                <button
                  onClick={() => setRecentView('list')}
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: recentView === 'list' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
                    color: '#fff', cursor: 'pointer', fontSize: 12
                  }}
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
                            style={{
                              width: 40, height: 40,
                              borderRadius: 10,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer',
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}
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
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'auto 1fr auto',
                              alignItems: 'center',
                              gap: 10,
                              padding: '6px 8px',
                              borderRadius: 8,
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid rgba(255, 255, 255, 0.08)'
                            }}
                            title={`${item.tab?.title || ''}${item.tab?.url ? ` — ${item.tab.url}` : ''}`}
                          >
                            <img src={getFaviconUrl(item.tab?.url, 32)} alt="" width={16} height={16} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.src = '/default-favicon.svg'; }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.tab?.title}</div>
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {(() => { try { return new URL(item.tab?.url || '').hostname.replace(/^www\./,''); } catch { return ''; } })()}
                              </div>
                            </div>
                            <button
                              onClick={() => restoreTab(item.tab?.sessionId)}
                              style={{
                                height: 24,
                                padding: '0 10px',
                                borderRadius: 6,
                                border: '1px solid rgba(255,255,255,0.18)',
                                background: 'rgba(255,255,255,0.08)',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: 12
                              }}
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
