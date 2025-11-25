import { faBroom, faClose, faGear, faHistory, faLayerGroup, faRotateRight, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getHostTabs } from '../../services/extensionApi';
import '../../styles/default/CurrentTabsSection.css';
import { getFaviconUrl } from '../../utils';

/**
 * CurrentTabsSection (Adaptive Grouping - Arc-style)
 *
 * Features:
 * - Pinned section (user can pin/unpin tabs)
 * - Recents (top N, default 4) sorted by lastUsed timestamp
 * - Domain groups (collapsed by default, expandable)
 * - Persist tab metadata (lastUsed, pinned) in chrome.storage.local
 * - Integrates with existing focus/remove/auto-organize logic
 * - Responsive and uses existing CSS class names (with additions below)
 *
 * Updates:
 * - "Tidy Up" feature: Physical Chrome Tab Grouping button
 */

export function CurrentTabsSection({
  onAddPing,
  onRequestPreview,
  recentsLimit = 4, // configurable recents top-N
}) {
  // Raw tabs array from chrome or host
  const [tabs, setTabs] = useState([]);
  const [tabsError, setTabsError] = useState(null);
  const [removingTabIds, setRemovingTabIds] = useState(new Set());
  const [recentlyClosed, setRecentlyClosed] = useState([]);
  const [recentSortKey, setRecentSortKey] = useState('time_desc');
  const [recentView, setRecentView] = useState('icons');
  const [showRecentlyClosed, setShowRecentlyClosed] = useState(false);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(false);
  const [autoOrganizeEnabled, setAutoOrganizeEnabled] = useState(false);

  // Metadata: { [tabId]: { lastUsed: number, pinned: boolean, expanded: boolean } }
  const [tabMeta, setTabMeta] = useState({});
  // Which domain group is expanded
  const [expandedGroup, setExpandedGroup] = useState(null);

  // Settings popover
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);
  const groupsContainerRef = useRef(null);

  // Utility: persist tabMeta to chrome.storage.local
  const persistTabMeta = useCallback(async (meta) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ currentTabs_meta: meta });
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // Load initial settings and metadata
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
          const keys = await chrome.storage.local.get(['autoCleanupEnabled', 'autoOrganizeEnabled', 'currentTabs_meta']);
          setAutoCleanupEnabled(keys.autoCleanupEnabled || false);
          setAutoOrganizeEnabled(keys.autoOrganizeEnabled || false);
          if (keys.currentTabs_meta) setTabMeta(keys.currentTabs_meta);
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
    };
    loadSettings();
  }, []);

  // Query tabs (chrome or fallback)
  const refreshTabs = useCallback(() => {
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
        (async () => {
          const res = await getHostTabs();
          if (res.ok) {
            setTabs(res.tabs || []);
            setTabsError(null);
          } else {
            setTabs([]);
            setTabsError('');
          }
        })();
      }
    } catch (e) {
      setTabsError('');
      setTabs([]);
    }
  }, []);

  useEffect(() => {
    refreshTabs();
    const id = setInterval(refreshTabs, 15000);
    return () => clearInterval(id);
  }, [refreshTabs]);

  // Click outside handler to close groups/settings
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (groupsContainerRef.current && !groupsContainerRef.current.contains(e.target)) {
        setExpandedGroup(null);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Persist tabMeta on change
  useEffect(() => {
    persistTabMeta(tabMeta);
  }, [tabMeta, persistTabMeta]);

  // Toggle settings
  const toggleAutoCleanup = useCallback(async () => {
    const newVal = !autoCleanupEnabled;
    setAutoCleanupEnabled(newVal);
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ autoCleanupEnabled: newVal });
      }
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'setAutoCleanup', enabled: newVal });
      }
    } catch (e) { /* ignore */ }
  }, [autoCleanupEnabled]);

  // Auto-organize: consolidate and arrange (uses your existing functions adapted)
  async function consolidateToActiveWindow() {
    try {
      if (typeof chrome === 'undefined' || !chrome?.windows?.getLastFocused || !chrome?.tabs?.move) return;
      const focused = await chrome.windows.getLastFocused({ populate: false });
      const targetWindowId = focused?.id;
      if (targetWindowId == null) return;

      // Move all non-pinned tabs grouped by hostname into active window
      const tabsToMove = [];
      Object.values(groupedByHost()).forEach(arr => {
        const fromOthers = arr.filter(t => !isPinned(t) && t.windowId !== targetWindowId);
        fromOthers.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        tabsToMove.push(...fromOthers.map(t => t.id));
      });

      if (tabsToMove.length === 0) return;

      await new Promise((resolve) => {
        chrome.tabs.move(tabsToMove, { windowId: targetWindowId, index: -1 }, () => {
          const err = chrome.runtime?.lastError;
          if (err) console.warn('tabs.move (consolidate) failed:', err.message);
          resolve();
        });
      });
    } catch (e) {
      console.warn('consolidateToActiveWindow error:', e);
    }
  }

  function performArrange() {
    try {
      if (!autoOrganizeEnabled || tabs.length === 0 || typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.move) {
        return;
      }
      // For each window, arrange tab IDs in the order of groupedByHost flattened
      const byWindow = new Map();
      Object.values(groupedByHost())
        .flat()
        .filter(t => !isPinned(t))
        .forEach(t => {
          if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
          byWindow.get(t.windowId).push(t.id);
        });

      byWindow.forEach((desiredIds, windowId) => {
        const currentIds = tabs
          .filter(t => t.windowId === windowId && !isPinned(t) && desiredIds.includes(t.id))
          .map(t => t.id);
        if (JSON.stringify(desiredIds) !== JSON.stringify(currentIds)) {
          chrome.tabs.move(desiredIds, { index: 0 }, () => {
            const err = chrome.runtime?.lastError;
            if (err) console.warn('tabs.move failed:', err.message);
          });
        }
      });
    } catch (e) {
      console.warn('performArrange error:', e);
    }
  }

  const toggleAutoOrganize = useCallback(async () => {
    const newVal = !autoOrganizeEnabled;
    setAutoOrganizeEnabled(newVal);
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ autoOrganizeEnabled: newVal });
      }
      if (newVal) {
        try {
          await consolidateToActiveWindow();
          setTimeout(() => refreshTabs(), 250);
          setTimeout(() => performArrange(), 150);
        } catch (e) {
          console.warn('consolidateToActiveWindow failed:', e);
        }
      }
    } catch (e) {
      console.warn('Failed to save auto-organize setting:', e);
    }
  }, [autoOrganizeEnabled, refreshTabs]);

  // Recently closed
  const fetchRecentlyClosed = useCallback(async () => {
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

  const restoreTab = useCallback(async (sessionId) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.sessions?.restore) {
        await chrome.sessions.restore(sessionId);
        setTimeout(fetchRecentlyClosed, 500);
        setTimeout(refreshTabs, 500);
      }
    } catch (e) {
      console.warn('Failed to restore tab:', e);
    }
  }, [fetchRecentlyClosed, refreshTabs]);

  useEffect(() => {
    if (showRecentlyClosed) fetchRecentlyClosed();
  }, [showRecentlyClosed, fetchRecentlyClosed]);

  // ---------- Metadata helpers ----------
  const setMetaForTab = useCallback((tabId, changes) => {
    setTabMeta(prev => {
      const next = { ...prev, [tabId]: { ...(prev[tabId] || {}), ...changes } };
      // persist
      persistTabMeta(next);
      return next;
    });
  }, [persistTabMeta]);

  const isPinned = useCallback((tab) => {
    if (!tab) return false;
    return !!(tabMeta?.[tab.id]?.pinned || tab.pinned);
  }, [tabMeta]);

  // Mark lastUsed when user focuses a tab
  const focusTab = useCallback((tab) => {
    if (!tab || !tab.id) return;
    try {
      const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
      if (!hasTabsUpdate) return;
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null && chrome?.windows?.update) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
      // update lastUsed meta
      setMetaForTab(tab.id, { lastUsed: Date.now() });
      // expand its group
      try {
        const host = (new URL(tab.url || '')).hostname.replace(/^www\./, '');
        setExpandedGroup(host);
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.warn('Failed to focus tab', e);
    }
  }, [setMetaForTab]);

  // Remove tab (close)
  const removeTab = useCallback((tab) => {
    if (!tab) return;
    if (tab.active) return; // avoid closing active tab
    setRemovingTabIds(prev => new Set([...prev, tab.id]));
    try {
      const hasRemove = typeof chrome !== 'undefined' && chrome?.tabs?.remove;
      if (hasRemove && tab.id != null) {
        chrome.tabs.remove(tab.id, () => {
          setTimeout(refreshTabs, 120);
        });
      }
    } catch (e) {
      console.warn('Failed to remove tab', e);
      setRemovingTabIds(prev => {
        const s = new Set(prev);
        s.delete(tab.id);
        return s;
      });
    }
  }, [refreshTabs]);

  // Pin/unpin a tab
  const togglePin = useCallback((tab, e) => {
    e?.stopPropagation();
    if (!tab) return;
    // If browser supports tab pinning, toggle via chrome API; otherwise store in meta
    if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
      try {
        chrome.tabs.update(tab.id, { pinned: !tab.pinned }, () => {
          setTimeout(refreshTabs, 120);
        });
      } catch (err) {
        // fallback to metadata
        setMetaForTab(tab.id, { pinned: !(tabMeta?.[tab.id]?.pinned) });
      }
    } else {
      setMetaForTab(tab.id, { pinned: !(tabMeta?.[tab.id]?.pinned) });
    }
  }, [refreshTabs, setMetaForTab, tabMeta]);

  // ---------- Grouping logic (Adaptive: pinned, recents, domain groups) ----------
  // Helper: grouped by hostname for "others" - used by arrange/old logic
  const groupedByHost = useCallback(() => {
    const groups = {};
    const filteredTabs = Array.isArray(tabs) ? tabs.filter(t => !removingTabIds.has(t.id)) : [];
    filteredTabs.forEach(tab => {
      try {
        const hostname = new URL(tab.url || '').hostname.replace(/^www\./, '') || '';
        if (!groups[hostname]) groups[hostname] = [];
        groups[hostname].push(tab);
      } catch (e) {
        // tabs with invalid url - put under empty host
        if (!groups['']) groups[''] = [];
        groups[''].push(tab);
      }
    });
    // sort each group by index for stability
    Object.keys(groups).forEach(h => {
      groups[h].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    });
    return groups;
  }, [tabs, removingTabIds]);

  // Build adaptive groups: pinned, recents, domainGroups
  const adaptiveGroups = useMemo(() => {
    const filteredTabs = Array.isArray(tabs) ? tabs.filter(t => !removingTabIds.has(t.id)) : [];

    // Pinned tabs (explicit browser pinned OR metadata pinned)
    const pinned = filteredTabs.filter(t => isPinned(t));

    // Recents: exclude pinned, pick those with lastUsed metadata
    const withMeta = filteredTabs.filter(t => !isPinned(t)).map(t => ({ tab: t, meta: tabMeta[t.id] || {} }));
    // sort by lastUsed desc (tabs without lastUsed go to end)
    withMeta.sort((a, b) => (b.meta.lastUsed || 0) - (a.meta.lastUsed || 0));
    const recents = withMeta.slice(0, recentsLimit).map(x => x.tab);

    // Others -> grouped by hostname (excluding ones in pinned or recents)
    const others = filteredTabs.filter(t => !pinned.includes(t) && !recents.includes(t));
    const domainGroups = others.reduce((acc, tab) => {
      let host = '';
      try { host = new URL(tab.url || '').hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
      if (!acc[host]) acc[host] = [];
      acc[host].push(tab);
      return acc;
    }, {});
    // sort group keys lexicographically (empty host last)
    const sortedDomainGroups = Object.keys(domainGroups).sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    }).reduce((obj, key) => {
      // stable sort inside group (by lastUsed desc, then index)
      domainGroups[key].sort((a, b) => {
        const la = tabMeta[a.id]?.lastUsed || 0;
        const lb = tabMeta[b.id]?.lastUsed || 0;
        if (lb !== la) return lb - la;
        return (a.index ?? 0) - (b.index ?? 0);
      });
      obj[key] = domainGroups[key];
      return obj;
    }, {});

    return { pinned, recents, domainGroups: sortedDomainGroups };
  }, [tabs, tabMeta, removingTabIds, recentsLimit, isPinned]);

  // Automatically run performArrange when autoOrganizeEnabled toggled or grouped changes
  useEffect(() => {
    if (!autoOrganizeEnabled) return;
    const t = setTimeout(() => performArrange(), 200);
    return () => clearTimeout(t);
  }, [adaptiveGroups, tabs, autoOrganizeEnabled]);

  // Helper: truncate hostname
  const truncateHostname = useCallback((hostname, maxLength = 18) => {
    if (!hostname || hostname.length <= maxLength) return hostname;
    return hostname.substring(0, maxLength) + '...';
  }, []);

  // --------------------------------------------------------------------------
  // SYNC TO BROWSER GROUPS (User Triggered)
  // This uses chrome.tabs.group to physically group tabs in the browser.
  // --------------------------------------------------------------------------
  const syncGroupsToBrowser = useCallback(async () => {
    // Check for API availability
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.group) {
      console.warn("Chrome Tab Group API not available.");
      return;
    }

    const domains = Object.entries(adaptiveGroups.domainGroups);

    // Helper for color generation
    const getGroupColor = (hostname) => {
      const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
      let hash = 0;
      for (let i = 0; i < hostname.length; i++) {
        hash = hostname.charCodeAt(i) + ((hash << 5) - hash);
      }
      return colors[Math.abs(hash) % colors.length];
    };

    let didGroup = false;

    for (const [hostname, groupTabs] of domains) {
      // Only group if we have 2 or more tabs for this domain
      if (groupTabs.length < 2) continue;

      const tabIds = groupTabs.map(t => t.id);

      try {
        // Check if the first tab is already in a group
        const firstTabId = tabIds[0];
        // Use Promise wrapper for tabs.get
        const firstTab = await new Promise((resolve) => chrome.tabs.get(firstTabId, resolve));

        if (!firstTab) continue;

        let groupId = firstTab.groupId;

        // Group the tabs
        if (groupId === -1) {
          // Create new group
          groupId = await new Promise((resolve) => chrome.tabs.group({ tabIds }, resolve));
        } else {
          // Add to existing group
          await new Promise((resolve) => chrome.tabs.group({ groupId, tabIds }, resolve));
        }

        // Update group metadata
        if (chrome.tabGroups && chrome.tabGroups.update) {
          await new Promise((resolve) => chrome.tabGroups.update(groupId, {
            title: truncateHostname(hostname, 12),
            color: getGroupColor(hostname),
            collapsed: true // Auto-collapse to save space
          }, resolve));
        }

        didGroup = true;

      } catch (e) {
        console.warn(`Failed to group ${hostname}:`, e);
      }
    }

    if (didGroup) {
      setTimeout(refreshTabs, 600);
    }
  }, [adaptiveGroups, refreshTabs, truncateHostname]);


  // Count total tab number
  const totalTabsCount = tabs.length;

  // Handler: toggle group expansion
  const handleToggleGroup = (hostname) => {
    setExpandedGroup(prev => (prev === hostname ? null : hostname));
  };

  // Utility: derive display info
  const displayTitleFor = (tab) => {
    if (!tab) return '';
    if (tab.title) {
      // Truncate title if too long
      const maxLength = 25;
      if (tab.title.length <= maxLength) return tab.title;
      return tab.title.substring(0, maxLength) + '...';
    }
    try {
      const u = new URL(tab.url || '');
      const segs = u.pathname.split('/').filter(Boolean);
      return segs[segs.length - 1] || u.hostname || tab.url;
    } catch (e) {
      return tab.url || 'Tab';
    }
  };

  // Render helpers
  function renderPinnedSection() {
    if (!adaptiveGroups.pinned || adaptiveGroups.pinned.length === 0) return null;
    return (
      <div className="currentTabs-section">
        <div className="groupHeader">Pinned</div>
        <div className="currentTabs-pinnedRow" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {adaptiveGroups.pinned.map(tab => (
            <div key={tab.id} className={`currentTabs-hostCard ${tab.active ? 'is-active' : ''}`} onClick={() => focusTab(tab)}>
              <img src={getFaviconUrl(tab.url, 64) || '/logo-2.png'} alt="" className="currentTabs-hostFavicon" width={32} height={32} onError={(e) => { e.currentTarget.src = '/logo-2.png'; }} />
              <div className="currentTabs-hostLabel" title={tab.title || tab.url}>{truncateHostname(displayTitleFor(tab))}</div>
              <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 4 }}>
                <button
                  className="currentTabs-badge currentTabs-pinBadge"
                  title="Unpin"
                  onClick={(e) => togglePin(tab, e)}
                >
                  <FontAwesomeIcon icon={faThumbtack} />
                </button>
                <button
                  className="currentTabs-badge currentTabs-closeBadge"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tab.active) return;
                    removeTab(tab);
                  }}
                  title={tab.active ? 'Cannot close active tab' : 'Close tab'}
                  disabled={!!tab.active}
                >
                  <FontAwesomeIcon icon={faClose} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderRecentsSection() {
    if (!adaptiveGroups.recents || adaptiveGroups.recents.length === 0) return null;
    return (
      <div className="currentTabs-section">
        <div className="groupHeader">Recents</div>
        <div className="currentTabs-recentsRow" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {adaptiveGroups.recents.map(tab => (
            <div key={tab.id} className={`currentTabs-hostCard ${tab.active ? 'is-active' : ''}`} onClick={() => focusTab(tab)}>
              <img src={getFaviconUrl(tab.url, 64) || '/logo-2.png'} alt="" className="currentTabs-hostFavicon" width={32} height={32} onError={(e) => { e.currentTarget.src = '/logo-2.png'; }} />
              <div className="currentTabs-hostLabel" title={tab.title || tab.url}>{truncateHostname(displayTitleFor(tab))}</div>
              <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 4 }}>
                <button
                  className="currentTabs-badge currentTabs-pinBadge"
                  title="Pin"
                  onClick={(e) => togglePin(tab, e)}
                >
                  <FontAwesomeIcon icon={faThumbtack} />
                </button>
                <button
                  className="currentTabs-badge currentTabs-closeBadge"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tab.active) return;
                    removeTab(tab);
                  }}
                  title={tab.active ? 'Cannot close active tab' : 'Close tab'}
                  disabled={!!tab.active}
                >
                  <FontAwesomeIcon icon={faClose} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render domain group card (collapsed + popover list on expand)
  function renderDomainGroups() {
    if (Object.keys(adaptiveGroups.domainGroups).length === 0) return null;
    return (
      <div className="currentTabs-section">
        <div className="groupHeader">Domains</div>
        <div className="currentTabs-domainGroupsGrid">
          {Object.entries(adaptiveGroups.domainGroups).map(([hostname, groupTabs]) => {
            const isExpanded = expandedGroup === hostname;
            const firstTab = groupTabs[0];
            const groupCount = groupTabs.length;
            const hasActive = groupTabs.some(t => !!t.active);
            return (
              <div key={hostname || '__blank__'} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  className={`tab-group-container currentTabs-hostCard ${hasActive ? 'is-active' : ''}`}
                  onClick={() => {
                    if (groupTabs.length === 1) {
                      focusTab(firstTab);
                    } else {
                      handleToggleGroup(hostname);
                    }
                  }}
                  title={hostname || '(unknown)'}
                >
                  <img
                    src={getFaviconUrl(firstTab?.url, 64) || '/logo-2.png'}
                    alt={`${hostname} favicon`}
                    width={32}
                    height={32}
                    className="currentTabs-hostFavicon"
                    onError={(e) => { e.currentTarget.src = '/logo-2.png'; }}
                  />
                  <div className="currentTabs-hostLabel" title={hostname}>
                    {truncateHostname(hostname)}
                  </div>

                  {groupCount > 1 ? (
                    <div className="currentTabs-badge">{groupCount}</div>
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

                {isExpanded && (
                  <div className="popover-list currentTabs-popover is-positioned">
                    {groupTabs.map(tab => (
                      <div
                        key={tab.id}
                        className={`currentTabs-listItem ${tab.active ? 'is-active' : ''}`}
                        title={`${tab.title || ''}${tab.url ? ` — ${tab.url}` : ''}`}
                      >
                        <img
                          src={getFaviconUrl(tab.url, 32) || '/logo-2.png'}
                          alt=""
                          width={24}
                          height={24}
                          className="currentTabs-favicon"
                          onClick={() => focusTab(tab)}
                          onError={(e) => { e.currentTarget.src = '/logo-2.png'; }}
                        />
                        <div className="currentTabs-tabText" onClick={() => focusTab(tab)}>
                          <div className="currentTabs-tabTitle">{displayTitleFor(tab)}</div>
                          {/* <div className="currentTabs-tabMeta">{(() => { try { return new URL(tab.url || '').hostname.replace(/^www\./, ''); } catch { return ''; } })()}</div> */}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            title={tab.pinned || (tabMeta?.[tab.id]?.pinned) ? 'Unpin' : 'Pin'}
                            className="currentTabs-iconBtn"
                            onClick={(e) => { e.stopPropagation(); togglePin(tab, e); }}
                          >
                            <FontAwesomeIcon icon={faThumbtack} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (tab.active) return;
                              removeTab(tab);
                            }}
                            title="Close tab"
                            className="currentTabs-closeBtn"
                            style={{ color: tab.active ? 'rgba(255,255,255,0.25)' : undefined, cursor: tab.active ? 'not-allowed' : undefined }}
                            disabled={!!tab.active}
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Sort recently closed into buckets (Today / Yesterday / Earlier)
  const groupedRecentlyClosed = useMemo(() => {
    const items = Array.isArray(recentlyClosed) ? [...recentlyClosed] : [];
    const getHost = (u) => { try { return new URL(u || '').hostname.replace(/^www\./, ''); } catch { return ''; } };
    const now = Date.now();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

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

  // Render
  return (
    <div className="currentTabs-root">
      <div className="currentTabs-header">
        <h3 className="currentTabs-headerTitle">Active Tabs <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginLeft: 8 }}>{totalTabsCount}</span></h3>
        <div className="currentTabs-headerActions">
          <button
            onClick={() => setShowRecentlyClosed(s => !s)}
            className="currentTabs-iconBtn"
            style={{ background: showRecentlyClosed ? 'rgba(255,149,0,0.2)' : undefined, color: showRecentlyClosed ? '#FF9500' : undefined }}
            title="Recently closed"
          >
            <FontAwesomeIcon icon={faHistory} className="currentTabs-icon" />
          </button>

          <button
            onClick={syncGroupsToBrowser}
            className="currentTabs-iconBtn"
            title="Tidy Up: Group tabs in Browser"
          >
            <FontAwesomeIcon icon={faLayerGroup} className="currentTabs-icon" />
          </button>

          <div ref={settingsRef} className="currentTabs-settingsWrap">
            <button
              onClick={() => setShowSettings(s => !s)}
              className="currentTabs-iconBtn"
              style={{ background: showSettings ? 'rgba(255,255,255,0.12)' : undefined }}
              title="Settings"
            >
              <FontAwesomeIcon icon={faGear} className="currentTabs-icon" />
            </button>
            {showSettings && (
              <div className="currentTabs-settingsPopover" style={{ maxWidth: '90vw', maxHeight: 320, overflowY: 'auto' }}>
                <div className="currentTabs-settingsTitle">Settings</div>
                <div className="currentTabs-divider" style={{ margin: '8px 0' }} />
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

          <button onClick={refreshTabs} className="currentTabs-iconBtn" title="Reload tabs"><FontAwesomeIcon icon={faRotateRight} className="currentTabs-icon" /></button>
        </div>
      </div>

      {tabsError ? (
        <div style={{
          background: 'rgba(255, 59, 48, 0.08)',
          border: '1px solid rgba(255, 59, 48, 0.18)',
          borderRadius: 12,
          padding: 12,
          color: '#FF3B30',
          fontSize: 'var(--font-size-base)',
          marginBottom: 16
        }}>
          {String(tabsError)}
        </div>
      ) : (
        <div ref={groupsContainerRef} className="currentTabs-groupsRow">
          {/* Pinned */}
          {renderPinnedSection()}

          {/* Recents */}
          {renderRecentsSection()}

          {/* Domain Groups */}
          {renderDomainGroups()}

          {/* Empty state */}
          {Object.keys(adaptiveGroups.domainGroups).length === 0 && adaptiveGroups.recents.length === 0 && adaptiveGroups.pinned.length === 0 && (
            <div className="currentTabs-emptyState">No tabs found</div>
          )}
        </div>
      )}

      {/* Recently Closed */}
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
                <select value={recentSortKey} onChange={(e) => setRecentSortKey(e.target.value)} className="recent-sort-select">
                  <option value="time_desc">Newest first</option>
                  <option value="time_asc">Oldest first</option>
                  <option value="host_az">Hostname A→Z</option>
                  <option value="title_az">Title A→Z</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setRecentView('icons')} className={`currentTabs-toggleBtn ${recentView === 'icons' ? 'currentTabs-toggleBtn--active' : ''}`}>Icons</button>
                <button onClick={() => setRecentView('list')} className={`currentTabs-toggleBtn ${recentView === 'list' ? 'currentTabs-toggleBtn--active' : ''}`}>List</button>
              </div>
            </div>
          </div>

          {recentlyClosed.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', padding: '20px', fontStyle: 'italic' }}>No recently closed tabs</div>
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
                            <button onClick={() => restoreTab(item.tab?.sessionId)} className="currentTabs-restoreBtn" title="Restore tab">Restore</button>
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