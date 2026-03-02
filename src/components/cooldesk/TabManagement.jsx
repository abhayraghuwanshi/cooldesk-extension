import { faBrain, faClock, faDesktop, faSync, faTasks, faToggleOff, faToggleOn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { runningAppsService } from '../../services/runningAppsService.js';
import { enrichRunningAppsWithIcons, getBaseDomainFromUrl } from '../../utils/helpers.js';
import { scoreAndSortTabs } from '../../utils/tabScoring.js';
import { AppCard, TabCard, TabGroupCard, TaskGroupCard } from './TabCard';

// Browser colors matching TabCard.jsx
const BROWSER_INFO = {
  chrome: { name: 'Chrome', color: '#4285F4' },
  edge: { name: 'Edge', color: '#0078D4' },
  firefox: { name: 'Firefox', color: '#FF7139' },
  safari: { name: 'Safari', color: '#006CFF' },
  other: { name: 'Other', color: '#94A3B8' }
};

// Detect current browser from user agent
function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Chrome/')) return 'chrome';
  if (ua.includes('Firefox/')) return 'firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'safari';
  return 'other';
}

// Get current browser (cached)
const CURRENT_BROWSER = detectBrowser();

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function TabManagement() {
  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [expandedDomain, setExpandedDomain] = useState(null);
  const [autoGroupEnabled, setAutoGroupEnabled] = useState(false);
  const [smartSortEnabled, setSmartSortEnabled] = useState(true);
  const [visibleTabsCount, setVisibleTabsCount] = useState(12);
  const [tabActivity, setTabActivity] = useState({});
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [runningApps, setRunningApps] = useState([]);

  // Task-First Tab Modeling state
  const [taskViewEnabled, setTaskViewEnabled] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [activeTaskId, setActiveTaskId] = useState(null);

  // Load auto-group, smart sort, and task view state on mount
  useEffect(() => {
    chrome.storage.local.get(['autoGroupEnabled', 'smartSortEnabled', 'isFocusMode', 'taskViewEnabled'], (result) => {
      setAutoGroupEnabled(result.autoGroupEnabled || false);
      setSmartSortEnabled(result.smartSortEnabled !== false); // Default to true
      setIsFocusMode(result.isFocusMode || false);
      setTaskViewEnabled(result.taskViewEnabled || false);
    });
  }, []);

  // Subscribe to task updates (Task-First Tab Modeling)
  useEffect(() => {
    // Function to fetch tasks with retry
    const fetchTasks = (retryCount = 0) => {
      console.log('[TabManagement] Fetching tasks... (attempt', retryCount + 1, ')');
      chrome.runtime.sendMessage({ type: 'GET_ALL_TASKS' })
        .then(response => {
          console.log('[TabManagement] GET_ALL_TASKS raw response:', JSON.stringify(response));
          if (response?.success) {
            console.log('[TabManagement] Setting', response.tasks?.length || 0, 'tasks');
            setTasks(response.tasks || []);
            setActiveTaskId(response.activeTaskId);
            // If no tasks and we haven't retried much, try again after a delay
            if (response.tasks?.length === 0 && retryCount < 3) {
              console.log('[TabManagement] No tasks yet, retrying in 1s...');
              setTimeout(() => fetchTasks(retryCount + 1), 1000);
            }
          } else if (response === undefined) {
            console.log('[TabManagement] No response from background - service worker may not be ready');
            if (retryCount < 5) {
              setTimeout(() => fetchTasks(retryCount + 1), 1000);
            }
          }
        })
        .catch((err) => {
          console.error('[TabManagement] GET_ALL_TASKS error:', err);
          if (retryCount < 5) {
            setTimeout(() => fetchTasks(retryCount + 1), 1000);
          }
        });
    };

    // Initial fetch with small delay to let background initialize
    setTimeout(() => fetchTasks(), 500);

    // Subscribe via BroadcastChannel for real-time updates
    let bc = null;
    try {
      bc = new BroadcastChannel('cooldesk_tasks');
      bc.onmessage = (ev) => {
        if (ev?.data?.type === 'tasksChanged') {
          setTasks(ev.data.tasks || []);
          setActiveTaskId(ev.data.activeTaskId);
        }
      };
    } catch (e) {
      console.debug('[TabManagement] BroadcastChannel not available');
    }

    // Also listen via runtime messages
    const handleMessage = (msg) => {
      if (msg?.type === 'TASKS_UPDATED') {
        setTasks(msg.tasks || []);
        setActiveTaskId(msg.activeTaskId);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      try { bc?.close(); } catch { }
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Track if initial load completed
  const initialLoadDone = useRef(false);

  // Fetch browser tabs
  const refreshTabs = useCallback(async () => {
    try {
      let allTabs = [];

      // 1. Electron App Mode: Fetch from Main Process (tabs already have browser field from sync)
      if (window.electronAPI?.getTabs) {
        allTabs = await window.electronAPI.getTabs();
      }
      // 2. Extension Mode: Fetch from Chrome API
      else if (chrome?.tabs?.query) {
        const rawTabs = await chrome.tabs.query({});
        allTabs = rawTabs.map(tab => ({
          ...tab,
          browser: tab.browser || CURRENT_BROWSER
        }));
      }

      // Always update loading state
      setTabsLoading(false);
      initialLoadDone.current = true;

      // Deduplicate by browser+id+url to handle any sidecar sync artifacts
      // Also filter out common placeholder/empty tabs to reduce noise
      const seen = new Set();
      const uniqueTabs = allTabs.filter(tab => {
        if (!tab || !tab.url) return false;

        // Filter out empty system tabs
        const url = tab.url.toLowerCase();
        if (url === 'about:blank' ||
          url === 'chrome://newtab/' ||
          url === 'edge://newtab/' ||
          url.startsWith('chrome-extension://') && url.includes('index.html')) {
          return false;
        }

        const key = `${tab.browser || 'other'}-${tab.id}-${tab.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (!uniqueTabs?.length) {
        setTabs([]);
        return;
      }

      // Show UNIQUE tabs IMMEDIATELY
      setTabs(uniqueTabs);

      // Then sort in background if smart sort enabled
      if (smartSortEnabled) {
        const sorted = await scoreAndSortTabs(uniqueTabs);
        setTabs(sorted);
      }
    } catch (error) {
      console.error('[TabManagement] Failed to fetch tabs:', error);
      setTabsLoading(false);
    }
  }, [smartSortEnabled]);

  // Debounced refresh (300ms delay to reduce CPU churn while staying responsive)
  const debouncedRefresh = useMemo(
    () => debounce(() => refreshTabs(), 300),
    [refreshTabs]
  );

  // Initial load and subscription setup - runs once on mount
  useEffect(() => {
    let removeListener = null;

    // Electron Mode: Subscribe to IPC updates
    if (window.electronAPI?.subscribe) {
      removeListener = window.electronAPI.subscribe('tabs-updated', (updatedTabs) => {
        console.log('[TabManagement] tabs-updated:', updatedTabs?.length);
        if (Array.isArray(updatedTabs)) {
          // Tabs from Electron should already have browser field from sync
          // But ensure fallback for any tabs missing it
          const tabsWithBrowser = updatedTabs.map(tab => ({
            ...tab,
            browser: tab.browser || 'other'
          }));
          setTabs(tabsWithBrowser);
          setTabsLoading(false);
        }
      });
    }

    // Fetch initial tabs (works for both Electron and Extension mode)
    const fetchInitial = async () => {
      let allTabs = [];

      if (window.electronAPI?.getTabs) {
        allTabs = await window.electronAPI.getTabs();
      } else if (chrome?.tabs?.query) {
        const rawTabs = await chrome.tabs.query({});
        // Add browser field to each tab
        allTabs = rawTabs.map(tab => ({
          ...tab,
          browser: tab.browser || CURRENT_BROWSER
        }));
      }

      setTabsLoading(false);
      if (allTabs?.length) {
        setTabs(allTabs);
      }
    };

    fetchInitial();

    return () => {
      if (removeListener) removeListener();
    };
  }, []); // Empty deps - only run on mount

  // Subscribe to running apps (uses centralized service to avoid duplicate API calls)
  useEffect(() => {
    if (!window.electronAPI?.getRunningApps) return;

    const unsubscribe = runningAppsService.subscribe(({ runningApps: apps, installedApps }) => {
      if (Array.isArray(apps)) {
        // Enrich running apps with icons from installed apps using utility
        const enrichedApps = enrichRunningAppsWithIcons(apps, installedApps);

        // Filter out browsers and tray/background-only processes
        const filteredApps = enrichedApps.filter(app => {
          const appName = (app.name || '').toLowerCase();
          const isBrowser = appName.includes('chrome') ||
            appName === 'msedge' ||
            appName === 'microsoft edge' ||
            appName === 'edge' ||
            appName.includes('brave') ||
            appName.includes('firefox');
          if (isBrowser) return false;

          // Skip tray/background windows: hidden (isVisible=false) and not cloaked by
          // virtual desktop (cloaked=2). These are system trays, not focusable apps.
          const isTrayOnly = app.isVisible === false && (app.cloaked || 0) !== 2;
          if (isTrayOnly) return false;

          return true;
        });

        // runningAppsService returns per-HWND entries — multi-window apps appear once per window.
        const sortedApps = [...filteredApps].sort((a, b) =>
          (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
        );
        setRunningApps(sortedApps);
      }
    });

    return unsubscribe;
  }, []);

  // Extension Mode (real browser extension, not Electron)
  useEffect(() => {
    const isRealExtension = typeof chrome !== 'undefined' && chrome.tabs && !window.electronAPI;
    if (!isRealExtension) return;

    const events = [
      chrome.tabs.onCreated,
      chrome.tabs.onUpdated,
      chrome.tabs.onRemoved,
      chrome.tabs.onActivated,
      chrome.tabs.onMoved,
      chrome.tabs.onDetached,
      chrome.tabs.onAttached
    ];

    events.forEach(event => {
      if (event?.addListener) {
        event.addListener(debouncedRefresh);
      }
    });

    return () => {
      events.forEach(event => {
        if (event?.removeListener) {
          event.removeListener(debouncedRefresh);
        }
      });
    };
  }, [debouncedRefresh]);


  // Handle tab actions
  const handleTabClick = useCallback(async (tab) => {
    try {
      // Check if running in Electron
      if (window.electronAPI && window.electronAPI.sendMessage) {
        console.log('[TabManagement] Sending JUMP_TO_TAB to Electron:', tab.id);
        await window.electronAPI.sendMessage({
          type: 'JUMP_TO_TAB',
          tabId: tab.id,
          windowId: tab.windowId
        });
        return;
      }

      // Fallback for Extension functionality
      // Switch to the existing tab instead of opening a new one
      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId && chrome?.windows?.update) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      }
    } catch (error) {
      console.error('[TabManagement] Failed to activate tab:', error);
    }
  }, []);

  const handleTabClose = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
        await chrome.tabs.remove(tab.id);
      }
    } catch (error) {
      console.error('[TabManagement] Failed to close tab:', error);
    }
  }, []);

  const handleTabPin = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        console.log('[TabManagement] Manual PIN toggle for tab:', tab.id, !tab.pinned);
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
      }
    } catch (error) {
      console.error('[TabManagement] Failed to pin/unpin tab:', error);
    }
  }, []);

  const handleAppClick = useCallback(async (app) => {
    try {
      if (window.electronAPI?.focusApp && app.pid) {
        console.log('[TabManagement] Focusing app:', app.name, app.pid, 'HWND:', app.hwnd);
        await window.electronAPI.focusApp(app.pid, app.name, app.hwnd);
      }
    } catch (error) {
      console.error('[TabManagement] Failed to focus app:', error);
    }
  }, []);

  const filteredTabs = useMemo(() => {
    let result = tabs;

    if (isFocusMode) {
      // Focus mode: Get the top 10 most relevant tabs
      const topTabs = result.slice(0, 10);

      // Preserve group integrity by keeping all tabs from these relevant domains
      const focusedDomains = new Set(topTabs.map(t => getBaseDomainFromUrl(t.url)));

      result = result.filter(t => t.pinned || t.active || focusedDomains.has(getBaseDomainFromUrl(t.url)));
    }

    return result;
  }, [tabs, isFocusMode]);

  // Get recently active tabs (excluding current active)
  const recentTabs = useMemo(() => {
    if (!tabActivity) return [];

    return tabs
      .filter(tab => tab && !tab.active && tabActivity[tab.id])
      .sort((a, b) => (tabActivity[b?.id] || 0) - (tabActivity[a?.id] || 0))
      .slice(0, 4);
  }, [tabs, tabActivity]);

  // Find the VERY last active tab
  const lastActiveTabId = useMemo(() => {
    const sorted = Object.entries(tabActivity)
      .filter(([id, _]) => {
        const tab = tabs.find(t => t?.id === parseInt(id));
        return tab && !tab.active;
      })
      .sort((a, b) => b[1] - a[1]);

    return sorted.length > 0 ? parseInt(sorted[0][0]) : null;
  }, [tabActivity, tabs]);

  // Partition tabs into exclusive buckets to avoid duplication
  const partitionedTabs = useMemo(() => {
    // 1. Pinned Tabs (Priority 1)
    const pinned = filteredTabs.filter(t => t.pinned);
    const pinnedIds = new Set(pinned.map(t => t.id));

    // 2. Unpinned Tabs
    const unpinned = filteredTabs.filter(t => !pinnedIds.has(t.id));

    // 3. Grouped Tabs (Priority 2: >1 tab per domain)
    const groups = {};
    const singles = [];

    // First pass: organize unpinned by base domain
    const byDomain = {};
    unpinned.forEach(t => {
      const domain = getBaseDomainFromUrl(t.url);
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(t);
    });

    // Identify valid groups vs singles
    Object.entries(byDomain).forEach(([domain, domainTabs]) => {
      // Group if either:
      // 1. Auto-group is enabled and we have multiple tabs
      // 2. We have a lot of tabs (force group > 3 even if auto-group is off, for sanity?)
      // Actually, let's stick to autoGroupEnabled preference.
      if (autoGroupEnabled && domainTabs.length > 1) {
        groups[domain] = domainTabs;
      } else {
        singles.push(...domainTabs);
      }
    });

    // Sort singles by activity if available
    const sortedSingles = [...singles].sort((a, b) => {
      const scoreA = tabActivity[a.id] || 0;
      const scoreB = tabActivity[b.id] || 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return (a.title || '').localeCompare(b.title || '');
    });

    // Take top 8 as "Recent" (active or high score)
    // Or strictly checks activity existence?
    // Let's take top 8 regardless, as "Recent/Singles"
    const recent = sortedSingles.slice(0, 8);

    // 5. Others (Priority 4: The rest)
    const others = sortedSingles.slice(8);

    return {
      pinned,
      grouped: groups,
      recent,
      others,
      hasGroups: Object.keys(groups).length > 0
    };
  }, [filteredTabs, tabActivity, autoGroupEnabled]);

  // Partition tabs by task (when task view is enabled)
  const partitionedByTask = useMemo(() => {
    console.log('[TabManagement] partitionedByTask - taskViewEnabled:', taskViewEnabled, 'tasks:', tasks.length, 'filteredTabs:', filteredTabs.length);

    if (!taskViewEnabled || tasks.length === 0) {
      console.log('[TabManagement] partitionedByTask returning null (disabled or no tasks)');
      return null;
    }

    const taskGroups = [];
    const tabIdToTab = new Map(filteredTabs.map(t => [t.id, t]));

    for (const task of tasks) {
      const taskTabs = task.tabIds
        .map(id => tabIdToTab.get(id))
        .filter(Boolean);

      console.log('[TabManagement] Task', task.name, 'has', task.tabIds.length, 'tabIds, matched', taskTabs.length, 'tabs');

      if (taskTabs.length > 0) {
        taskGroups.push({
          task,
          tabs: taskTabs
        });
      }
    }

    console.log('[TabManagement] partitionedByTask returning', taskGroups.length, 'task groups');
    // Sort by lastUpdated (most recent first)
    return taskGroups.sort((a, b) => b.task.lastUpdated - a.task.lastUpdated);
  }, [taskViewEnabled, tasks, filteredTabs]);

  // Compute browser statistics from tabs
  const browserStats = useMemo(() => {
    const stats = {};
    for (const tab of tabs) {
      const browser = tab.browser || 'other';
      if (!stats[browser]) {
        stats[browser] = 0;
      }
      stats[browser]++;
    }
    return stats;
  }, [tabs]);

  // Check if we have tabs from multiple browsers
  const hasMultipleBrowsers = Object.keys(browserStats).length > 1;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      borderRadius: 16,
      overflow: 'hidden',
      border: '1px solid transparent'
    }}>
      {/* Browser Legend - show when tabs from multiple browsers */}
      {hasMultipleBrowsers && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '12px',
          padding: '8px 12px',
          background: 'rgba(30, 41, 59, 0.6)',
          borderRadius: '8px',
          border: '1px solid rgba(71, 85, 105, 0.3)'
        }}>
          <span style={{
            fontSize: 'var(--font-xs, 11px)',
            color: 'var(--text-secondary, #94A3B8)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 500
          }}>
            Browsers:
          </span>
          {Object.entries(browserStats).map(([browser, count]) => {
            const info = BROWSER_INFO[browser] || BROWSER_INFO.other;
            return (
              <div
                key={browser}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  background: `${info.color}15`,
                  borderRadius: '6px',
                  borderLeft: `3px solid ${info.color}`
                }}
              >
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#22C55E', // Green dot for connected
                  boxShadow: '0 0 6px #22C55E', // Glow effect
                  // A CSS animation class can make it pulse, but static glow is clean
                  marginRight: '2px'
                }} title="Connected" />
                <span style={{
                  fontSize: 'var(--font-sm, 12px)',
                  fontWeight: 600,
                  color: info.color
                }} title={`${info.name} is Connected and Syncing`}>
                  {info.name}
                </span>
                <span style={{
                  fontSize: 'var(--font-xs, 11px)',
                  color: 'var(--text-secondary, #94A3B8)',
                  background: 'rgba(0, 0, 0, 0.2)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }} title={`${count} open tabs`}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={async () => {
              const newState = !isFocusMode;
              setIsFocusMode(newState);
              // Ensure smart sort is enabled when focus is on
              if (newState) {
                setSmartSortEnabled(true);
                chrome.storage.local.set({ isFocusMode: newState, smartSortEnabled: true });
              } else {
                chrome.storage.local.set({ isFocusMode: newState });
              }
              // Immediately trigger a refetch/resort so the UI updates
              debouncedRefresh();
            }}
            style={{
              background: isFocusMode
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.15))'
                : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
              border: isFocusMode
                ? '1px solid rgba(139, 92, 246, 0.4)'
                : '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: isFocusMode ? '#A78BFA' : '#94A3B8',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              if (isFocusMode) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(124, 58, 237, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.6)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(71, 85, 105, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.5)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (isFocusMode) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                e.currentTarget.style.transform = 'translateY(0)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            title={isFocusMode
              ? "Focus enabled - Showing most relevant tabs"
              : "Focus disabled - Showing all tabs"}
          >
            <FontAwesomeIcon
              icon={faBrain}
              size="lg"
              style={{ pointerEvents: 'none' }}
            />
            <span style={{ pointerEvents: 'none' }}>Focus</span>
          </button>
          <button
            onClick={() => {
              const newState = !autoGroupEnabled;
              // Update state immediately for responsive UI
              setAutoGroupEnabled(newState);
              // Save to storage
              chrome.storage.local.set({ autoGroupEnabled: newState });
              console.log('[TabManagement] Auto-group toggled:', newState);
              // Notify background (fire and forget)
              chrome.runtime.sendMessage({
                type: 'TOGGLE_AUTO_GROUP',
                enabled: newState
              }).catch(() => {/* ignore errors */ });
            }}
            style={{
              background: autoGroupEnabled
                ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15))'
                : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
              border: autoGroupEnabled
                ? '1px solid rgba(34, 197, 94, 0.4)'
                : '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: autoGroupEnabled ? '#4ADE80' : '#94A3B8',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              if (autoGroupEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(16, 185, 129, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(71, 85, 105, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.5)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (autoGroupEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                e.currentTarget.style.transform = 'translateY(0)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            title={autoGroupEnabled
              ? "Auto-grouping enabled - Click to disable and ungroup all tabs"
              : "Auto-grouping disabled - Click to enable automatic grouping by domain"}
          >
            <FontAwesomeIcon
              icon={autoGroupEnabled ? faToggleOn : faToggleOff}
              size="lg"
              style={{ pointerEvents: 'none' }}
            />
            <span style={{ pointerEvents: 'none' }}>Auto Group</span>
          </button>
          <button
            onClick={() => {
              const newState = !taskViewEnabled;
              setTaskViewEnabled(newState);
              chrome.storage.local.set({ taskViewEnabled: newState });
              // Refresh tasks when enabling
              if (newState) {
                chrome.runtime.sendMessage({ type: 'GET_ALL_TASKS' })
                  .then(response => {
                    if (response?.success) {
                      setTasks(response.tasks || []);
                      setActiveTaskId(response.activeTaskId);
                    }
                  })
                  .catch(() => { });
              }
            }}
            style={{
              background: taskViewEnabled
                ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.15))'
                : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
              border: taskViewEnabled
                ? '1px solid rgba(59, 130, 246, 0.4)'
                : '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: taskViewEnabled ? '#60A5FA' : '#94A3B8',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              if (taskViewEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.6)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(71, 85, 105, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.5)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (taskViewEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                e.currentTarget.style.transform = 'translateY(0)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            title={taskViewEnabled
              ? "Task View enabled - Showing tabs grouped by task/intent"
              : "Task View disabled - Click to group tabs by browsing tasks"}
          >
            <FontAwesomeIcon
              icon={faTasks}
              size="lg"
              style={{ pointerEvents: 'none' }}
            />
            <span style={{ pointerEvents: 'none' }}>Tasks</span>
          </button>
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {tabsLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '40px 20px',
            color: 'var(--text-secondary, #64748B)',
            textAlign: 'center',
            height: '100%'
          }}>
            <FontAwesomeIcon icon={faSync} spin size="2x" style={{ opacity: 0.5 }} />
            <div style={{ fontSize: 'var(--font-sm, 12px)' }}>Loading tabs...</div>
          </div>
        ) : (
          <>
            {/* 1. Pinned Tabs Section */}
            {partitionedTabs.pinned.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Pinned ({partitionedTabs.pinned.length})
                </h3>
                <div className="tabs-grid">
                  {partitionedTabs.pinned.map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={true}
                      isActive={tab.active}
                      lastAccessedAt={tabActivity[tab.id] || null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 2. Active Apps Section (Electron only) */}
            {runningApps.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <FontAwesomeIcon icon={faDesktop} style={{ opacity: 0.6 }} />
                  Active Apps ({runningApps.length})
                </h3>
                <div className="tabs-grid">
                  {runningApps.map(app => (
                    <AppCard
                      key={app.id || app.pid}
                      app={app}
                      onClick={handleAppClick}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 3. Grouped by Task Section (Task-First Tab Modeling) */}
            {taskViewEnabled && partitionedByTask && partitionedByTask.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <FontAwesomeIcon icon={faTasks} style={{ opacity: 0.6 }} />
                  Grouped by Task ({partitionedByTask.length})
                </h3>
                <div className="tabs-grid">
                  {partitionedByTask.map(({ task, tabs: taskTabs }) => (
                    <TaskGroupCard
                      key={task.id}
                      task={task}
                      tabs={taskTabs}
                      isActive={task.id === activeTaskId}
                      onTabClick={handleTabClick}
                      onTabClose={handleTabClose}
                      onRename={(newName) => {
                        chrome.runtime.sendMessage({
                          type: 'RENAME_TASK',
                          taskId: task.id,
                          name: newName
                        }).catch(() => { });
                      }}
                      onAIName={() => {
                        chrome.runtime.sendMessage({
                          type: 'AI_NAME_TASK',
                          taskId: task.id
                        }).catch(() => { });
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 4. Grouped by Domain Section (only when task view is disabled) */}
            {!taskViewEnabled && partitionedTabs.hasGroups && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Grouped by Domain
                </h3>
                <div className="tabs-grid">
                  {Object.entries(partitionedTabs.grouped)
                    .sort(([domainA], [domainB]) => domainA.localeCompare(domainB))
                    .map(([domain, domainTabs]) => (
                      <TabGroupCard
                        key={domain}
                        domain={domain}
                        tabs={domainTabs}
                        onToggleExpand={() => startTransition(() => setExpandedDomain(expandedDomain === domain ? null : domain))}
                        onTabClick={handleTabClick}
                        onTabClose={handleTabClose}
                        isExpanded={expandedDomain === domain}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* 5. Recent (Ungrouped) Section - only when task view is disabled */}
            {!taskViewEnabled && partitionedTabs.recent.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <FontAwesomeIcon icon={faClock} style={{ opacity: 0.6 }} />
                  Recent
                </h3>
                <div className="tabs-grid">
                  {partitionedTabs.recent.map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={false}
                      isActive={tab.active}
                      isLastActive={tab.id === lastActiveTabId}
                      lastAccessedAt={tabActivity[tab.id] || null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 6. Other Tabs Section - only when task view is disabled */}
            {!taskViewEnabled && partitionedTabs.others.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {`Others (${partitionedTabs.others.length})`}
                </h3>
                <div className="tabs-grid">
                  {/* Only show 'others' if not in focus mode, or just user preference? 
                        Focus mode already slices input `filteredTabs`, so `others` will likely be empty or small.
                        We can show what remains.
                    */}
                  {partitionedTabs.others.slice(0, visibleTabsCount).map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={false}
                      isActive={tab.active}
                      isLastActive={false}
                      lastAccessedAt={tabActivity[tab.id] || null}
                    />
                  ))}
                </div>
                {/* Load More Button for Others */}
                {partitionedTabs.others.length > visibleTabsCount && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                    <button
                      onClick={() => startTransition(() => setVisibleTabsCount(prev => prev + 12))}
                      style={{
                        background: 'rgba(59, 130, 246, 0.1)',
                        color: '#60A5FA',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        padding: '8px 24px',
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Show More ({partitionedTabs.others.length - visibleTabsCount} remaining)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Empty State */}
            {filteredTabs.length === 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '40px 20px',
                color: 'var(--text-secondary, #64748B)',
                textAlign: 'center',
                background: 'var(--glass-bg, rgba(30, 41, 59, 0.95))',
                borderRadius: '12px',
                border: '1px solid rgba(59, 130, 246, 0.2)'
              }}>
                <div style={{ fontSize: '48px', opacity: 0.3 }}>📑</div>
                <div>
                  <div style={{
                    fontSize: 'var(--font-lg, 14px)',
                    fontWeight: 500,
                    marginBottom: '8px'
                  }}>
                    No Tabs Found
                  </div>
                  <div style={{ fontSize: 'var(--font-sm, 12px)' }}>
                    Open some browser tabs to see them here
                  </div>
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div >
  );
}
