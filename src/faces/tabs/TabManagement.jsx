import { faClock, faCode, faDesktop, faFolderOpen, faSync, faTasks, faToggleOff, faToggleOn, faWifi } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { recordFeedbackEvent } from '../../services/feedbackService.js';
import { getHostTabs } from '../../services/extensionApi.js';
import { syncOrchestrator } from '../../services/syncOrchestrator.js';
import { syncWebSocket } from '../../services/syncWebSocket.js';
import { getHostUrl, isHostSyncEnabled } from '../../services/syncConfig.js';
import { isElectronApp } from '../../services/environmentDetector.js';
import { runningAppsService } from '../../services/runningAppsService.js';
import { enrichRunningAppsWithIcons, getGroupDomainFromUrl } from '../../utils/helpers.js';
import { scoreAndSortTabs } from '../../utils/tabScoring.js';
import { AppCard, FolderCard, TabCard, TabGroupCard, TaskGroupCard } from './parts/TabCard';
import { DevServersPanel } from './parts/DevServersPanel';
import { FileManager } from '../../features/file-manager/FileManager';
import { WidgetBoard } from '../../features/widgets/WidgetBoard';

// The Tabs page gets its own widget strip (independent of the overview board).
const TABS_WIDGET_DEFAULT = [
  { id: 'clock', size: 's' },
  { id: 'todo', size: 's' },
];

// Chrome native tab group colors (matches Chrome's palette)
const CHROME_GROUP_COLORS = {
  grey: '#9AA0A6',
  blue: '#4285F4',
  red: '#EA4335',
  yellow: '#FBBC04',
  green: '#34A853',
  pink: '#FF69B4',
  purple: '#9334E6',
  cyan: '#00BCD4',
  orange: '#FF9800'
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

// Detect localhost / local dev server URLs (localhost, loopback, private LAN IPs, *.local mDNS).
// These are grouped into their own "Local Dev" section instead of by hostname.
function isLocalhostUrl(url) {
  if (!url) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (h.endsWith('.local')) return true; // mDNS / Bonjour
  if (h.startsWith('127.')) return true; // loopback range
  // Private LAN ranges (RFC 1918): 10.x, 192.168.x, 172.16–31.x
  if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

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
  const [isPending, startTransition] = useTransition();
  const [runningApps, setRunningApps] = useState([]);
  const [chromeTabGroups, setChromeTabGroups] = useState({});
  const [frequentFolders, setFrequentFolders] = useState([]);
  // Folder currently open in the in-app file manager (null = manager closed)
  const [browsingFolder, setBrowsingFolder] = useState(null);

  // Task-First Tab Modeling state
  const [taskViewEnabled, setTaskViewEnabled] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [activeTaskId, setActiveTaskId] = useState(null);

  // WebSocket connection state (for sync indicator)
  const [wsConnected, setWsConnected] = useState(() => syncWebSocket.isConnected());
  // True while a manual "fetch all tabs from all instances" request is in flight
  const [requestingTabs, setRequestingTabs] = useState(false);
  // True when tabs come from remote sidecar (not live chrome.tabs API)
  const isRemoteTabMode = !window.electronAPI && !(typeof chrome !== 'undefined' && chrome?.tabs?.query);
  // Tauri desktop app — only here is the Rust `kill_process_on_port` command available.
  const isTauriApp = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

  // Load auto-group, smart sort, and task view state on mount
  useEffect(() => {
    chrome.storage.local.get(['autoGroupEnabled', 'smartSortEnabled', 'taskViewEnabled'], (result) => {
      setAutoGroupEnabled(result.autoGroupEnabled || false);
      setSmartSortEnabled(result.smartSortEnabled !== false); // Default to true
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
        setChromeTabGroups({});
        return;
      }

      // Fetch Chrome native tab groups (extension mode only)
      if (!window.electronAPI && typeof chrome !== 'undefined' && chrome.tabGroups?.query) {
        try {
          const groups = await chrome.tabGroups.query({});
          const groupMap = {};
          groups.forEach(g => { groupMap[g.id] = g; });
          setChromeTabGroups(groupMap);
        } catch { /* tabGroups API unavailable */ }
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

  // Force every connected browser instance to re-report its tabs, then refresh.
  // Use when the synced list looks wrong/stale (e.g. an extension dropped tabs).
  const requestAllTabs = useCallback(async () => {
    setRequestingTabs(true);
    try {
      // Ask all browsers (via the sidecar) to re-push their current tabs.
      syncWebSocket.send('request-tabs', {});
      // Give extensions a moment to push, then pull the aggregated list.
      await new Promise((r) => setTimeout(r, 600));
      await refreshTabs();
    } catch (e) {
      console.error('[TabManagement] requestAllTabs failed:', e);
    } finally {
      setRequestingTabs(false);
    }
  }, [refreshTabs]);

  // Debounced refresh (300ms delay to reduce CPU churn while staying responsive)
  const debouncedRefresh = useMemo(
    () => debounce(() => refreshTabs(), 300),
    [refreshTabs]
  );

  // Subscribe to connection events (must be after refreshTabs is defined).
  //
  // The desktop app never opens a sync WebSocket: isElectronApp() is true there
  // (the Tauri shim defines window.electronAPI), so syncOrchestrator.init()
  // takes the initElectronSync() branch and syncWebSocket.connect() is never
  // called. Reading syncWebSocket.isConnected() therefore pinned this badge to
  // "Offline" forever, even with sync working perfectly over HTTP. Ask the
  // sidecar directly instead — reachable host is what "synced" means here.
  useEffect(() => {
    if (!isHostSyncEnabled()) return;

    let cancelled = false;

    if (isElectronApp()) {
      const checkHealth = async () => {
        try {
          const res = await fetch(`${getHostUrl()}/health`);
          if (!cancelled) setWsConnected(res.ok);
        } catch {
          if (!cancelled) setWsConnected(false);
        }
      };
      checkHealth();
      const poll = setInterval(checkHealth, 5000);
      return () => {
        cancelled = true;
        clearInterval(poll);
      };
    }

    // Extension / browser: the WebSocket is the real transport, so its state is
    // the honest answer.
    const checkConnection = () => setWsConnected(syncWebSocket.isConnected());

    // Check immediately and poll every 2s to catch state we may have missed
    checkConnection();
    const poll = setInterval(checkConnection, 2000);

    const unsubConnect = syncWebSocket.on('connected', () => {
      setWsConnected(true);
      refreshTabs();
    });
    const unsubDisconnect = syncWebSocket.on('disconnected', () => setWsConnected(false));

    return () => {
      cancelled = true;
      clearInterval(poll);
      unsubConnect?.();
      unsubDisconnect?.();
    };
  }, [refreshTabs]);

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

    // Fetch initial tabs — use refreshTabs() so dedup/filter/sort are applied from the start
    refreshTabs();

    // Tauri app mode: no electronAPI, no chrome.tabs — fetch via HTTP and subscribe to WS sync
    if (!window.electronAPI && !chrome?.tabs?.query) {
      getHostTabs().then(res => {
        if (res.ok && res.tabs?.length) {
          setTabs(res.tabs.map(tab => ({ ...tab, browser: tab.browser || 'other' })));
          setTabsLoading(false);
        }
      }).catch(() => {});

      const unsubTabs = syncOrchestrator.on('tabs-synced', (updatedTabs) => {
        if (Array.isArray(updatedTabs) && updatedTabs.length) {
          setTabs(updatedTabs.map(tab => ({ ...tab, browser: tab.browser || 'other' })));
          setTabsLoading(false);
        }
      });
      return () => {
        if (removeListener) removeListener();
        unsubTabs?.();
      };
    }

    return () => {
      if (removeListener) removeListener();
    };
  }, []); // Empty deps - only run on mount

  // Load frequently visited folders from Windows Quick Access (Tauri desktop only)
  useEffect(() => {
    if (!isTauriApp) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const folders = await invoke('get_frequent_folders');
        if (!cancelled && Array.isArray(folders)) setFrequentFolders(folders);
      } catch (error) {
        console.warn('[TabManagement] Failed to load frequent folders:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [isTauriApp]);

  // Subscribe to running apps (uses centralized service to avoid duplicate API calls)
  useEffect(() => {
    if (!window.electronAPI?.getRunningApps) return;

    const unsubscribe = runningAppsService.subscribe(({ runningApps: apps, installedApps }) => {
      if (Array.isArray(apps)) {
        // Enrich running apps with icons from installed apps using utility
        const enrichedApps = enrichRunningAppsWithIcons(apps, installedApps);

        // macOS system process filter
        const systemExactNames = new Set([
          // Windows system processes
          'svchost', 'csrss', 'smss', 'wininit', 'winlogon', 'services', 'lsass',
          'registry', 'system', 'idle', 'dwm', 'conhost', 'ctfmon', 'spoolsv',
          'taskhostw', 'sihost', 'runtimebroker', 'applicationframehost',
          'searchindexer', 'searchhost', 'securityhealthsystray',
          // macOS system UI processes
          'windowserver', 'dock', 'controlcenter', 'notificationcenter',
          'spotlight', 'loginwindow', 'textinputswitcher', 'accessibilityuiserver',
          'cursoruiviewservice', 'nsattributedstringagent', 'webthumbnailextension',
          'linkednotesuitservice', 'securityprivacyextension',
        ]);
        const isMacSystemProcess = (name) =>
          name.startsWith('com.apple.') ||
          name.includes('.xpc.') ||
          (name.endsWith('helper') && !name.includes(' ')) ||
          (name.endsWith('agent') && !name.includes(' '));

        // Filter out browsers, cooldesk, and system processes
        const filteredApps = enrichedApps.filter(app => {
          const appName = (app.name || '').toLowerCase();

          // Skip browsers (tabs are shown separately)
          const isBrowser = appName.includes('chrome') ||
            appName === 'msedge' ||
            appName === 'microsoft edge' ||
            appName === 'edge' ||
            appName.includes('brave') ||
            appName.includes('firefox') ||
            appName.includes('opera') ||
            appName.includes('vivaldi') ||
            appName.includes('arc');
          if (isBrowser) return false;

          // Skip cooldesk app itself
          const isCoolDesk = appName.includes('cooldesk') ||
            appName.includes('cool-desk') ||
            appName.includes('tauri') ||
            appName.includes('webview') ||
            appName.includes('wry');
          if (isCoolDesk) return false;

          // Skip macOS system processes
          if (systemExactNames.has(appName)) return false;
          if (isMacSystemProcess(appName)) return false;

          // Skip tray/background windows on Windows only.
          // macOS apps (source: applications/system_applications/user_applications) are
          // pre-filtered by the scanner — all entries here are valid user apps regardless
          // of isVisible (macOS apps frequently report isVisible=false even when open).
          const isMacStyle = app.source === 'applications' ||
            app.source === 'system_applications' ||
            app.source === 'user_applications' ||
            app.source === 'macos';
          if (!isMacStyle) {
            const isTrayOnly = app.isVisible === false && (app.cloaked || 0) !== 2;
            if (isTrayOnly) return false;
          }

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
      chrome.tabs.onAttached,
      // Tab group changes should also trigger a refresh (picks up new group metadata)
      chrome.tabGroups?.onCreated,
      chrome.tabGroups?.onUpdated,
      chrome.tabGroups?.onRemoved,
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
      // Record feedback for RAG learning (fire-and-forget)
      recordFeedbackEvent({
        suggestionType: 'tab_category',
        action: 'accepted',
        suggestionContent: tab.url || tab.title,
        contextUrls: [tab.url].filter(Boolean)
      }).catch(() => { });

      // Check if running in Electron
      if (window.electronAPI && window.electronAPI.sendMessage) {
        console.log('[TabManagement] Sending JUMP_TO_TAB to Electron:', tab.id);
        await window.electronAPI.sendMessage({
          type: 'JUMP_TO_TAB',
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url,
          _deviceId: tab._deviceId
        });
        return;
      }

      // Route through background.js so native focus fires for cross-desktop windows
      if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'JUMP_TO_TAB', tabId: tab.id, url: tab.url });
      }
    } catch (error) {
      console.error('[TabManagement] Failed to activate tab:', error);
    }
  }, []);

  const handleTabClose = useCallback(async (tab) => {
    try {
      // _deviceId identifies the exact browser instance that owns this tab
      // (prefixed with the browser name, e.g. "edge-…", "brave-…"), so the close
      // is routed to the right browser regardless of type. browser is a hint only.
      const closeMsg = {
        type: 'CLOSE_TAB',
        tabId: tab.id,
        url: tab.url,
        _deviceId: tab._deviceId,
        browser: tab.browser,
      };

      // Optimistically drop the tab from the list for instant feedback
      setTabs(prev => prev.filter(t => !(t.id === tab.id && (t.browser || 'other') === (tab.browser || 'other'))));

      // Desktop (Tauri/Electron): route via sidecar → owning browser extension
      if (window.electronAPI?.sendMessage) {
        await window.electronAPI.sendMessage(closeMsg);
        return;
      }

      // Real extension context: close the local tab directly
      if (typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
        await chrome.tabs.remove(tab.id);
      }
    } catch (error) {
      console.error('[TabManagement] Failed to close tab:', error);
    }
  }, []);

  const handleTabPin = useCallback(async (tab) => {
    try {
      // Record feedback - pinning is a strong positive signal
      recordFeedbackEvent({
        suggestionType: 'tab_category',
        action: tab.pinned ? 'rejected' : 'accepted', // Unpinning = negative, pinning = positive
        suggestionContent: tab.url || tab.title,
        contextUrls: [tab.url].filter(Boolean)
      }).catch(() => { });

      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        console.log('[TabManagement] Manual PIN toggle for tab:', tab.id, !tab.pinned);
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
      }
    } catch (error) {
      console.error('[TabManagement] Failed to pin/unpin tab:', error);
    }
  }, []);

  // Kill the process listening on a local dev tab's port (Tauri desktop only),
  // then close the now-dead tab. Returns nothing; surfaces failures via console.
  const handleKillPort = useCallback(async (tab, port) => {
    const parsedPort = parseInt(port, 10);
    if (!parsedPort) {
      console.warn('[TabManagement] No port to kill for tab:', tab?.url);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('kill_process_on_port', { port: parsedPort });
      console.log('[TabManagement] kill_process_on_port:', result);
      // Server is gone — close the orphaned tab too.
      handleTabClose(tab);
    } catch (error) {
      console.error('[TabManagement] Failed to kill port', parsedPort, ':', error);
    }
  }, [handleTabClose]);

  // Force-quit a running app by PID (Tauri desktop only). The running-apps
  // service will drop it from the list on its next poll.
  const handleKillApp = useCallback(async (app) => {
    if (!app?.pid) {
      console.warn('[TabManagement] No PID to kill for app:', app?.name);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('kill_process', { pid: app.pid });
      console.log('[TabManagement] kill_process:', result);
      // Optimistically drop every window of that PID from the list.
      setRunningApps(prev => prev.filter(a => a.pid !== app.pid));
    } catch (error) {
      console.error('[TabManagement] Failed to kill app', app.pid, ':', error);
    }
  }, []);

  // Folders open in the in-app file manager; the OS explorer stays available
  // as an explicit secondary action on the chip and inside the manager.
  const handleFolderClick = useCallback((folder) => {
    if (folder?.path) setBrowsingFolder(folder.path);
  }, []);

  const handleFolderOpenExternal = useCallback(async (folder) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path: folder.path });
    } catch (error) {
      console.error('[TabManagement] Failed to open folder:', folder?.path, error);
    }
  }, []);

  const handleAppClick = useCallback(async (app) => {
    try {
      // Record feedback for RAG learning (fire-and-forget)
      recordFeedbackEvent({
        suggestionType: 'related_resource',
        action: 'accepted',
        suggestionContent: app.name || app.title
      }).catch(() => { });

      // Tab entry (Windows Terminal / File Explorer): these share one HWND with
      // their siblings, so focusing by pid/hwnd alone lands on whichever tab was
      // last active. Route through UIA to select the specific tab, same as
      // GlobalSpotlight does.
      if (app.tabIndex != null && app.hwnd && window.electronAPI?.focusAppTab) {
        console.log('[TabManagement] Focusing tab:', app.title, 'HWND:', app.hwnd, 'index:', app.tabIndex);
        await window.electronAPI.focusAppTab(app.hwnd, app.tabIndex, app.title);
        return;
      }

      if (window.electronAPI?.focusApp && app.pid) {
        console.log('[TabManagement] Focusing app:', app.name, app.pid, 'HWND:', app.hwnd);
        try {
          await window.electronAPI.focusApp(app.pid, app.name, app.hwnd);
        } catch (focusError) {
          // focusApp goes through OS-level window scripting, which can fail
          // silently from the user's POV (missing Automation permission, or a
          // background process with no window to raise). launchApp goes
          // through `open`/ShellExecute instead, which needs neither and
          // reliably raises an already-running app's window too.
          console.warn('[TabManagement] focusApp failed, falling back to launchApp:', focusError);
          if (app.path && window.electronAPI?.launchApp) {
            await window.electronAPI.launchApp(app.path);
          }
        }
      }
    } catch (error) {
      console.error('[TabManagement] Failed to focus app:', error);
    }
  }, []);

  // Focus mode used to narrow this to the top-scoring domains. It was removed:
  // smart sort already surfaces the relevant tabs first, so hiding the rest only
  // made tabs go missing with no clear way to tell why.
  const filteredTabs = tabs;

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
    const unpinnedAll = filteredTabs.filter(t => !pinnedIds.has(t.id));

    // 2b. Local Dev (localhost / loopback / LAN) — pulled out into their own section
    // so dev servers across many ports don't scatter into per-host domain groups.
    const localhost = [];
    const unpinned = [];
    unpinnedAll.forEach(t => {
      if (isLocalhostUrl(t.url)) localhost.push(t);
      else unpinned.push(t);
    });

    // 3. Chrome native tab groups (extension mode only)
    // Tabs with groupId !== -1 belong to a Chrome group - separate them out
    const hasChromeGroupData = Object.keys(chromeTabGroups).length > 0;
    const chromeGrouped = {}; // groupId -> { group, tabs[] }
    const domainGroupable = []; // tabs not in any Chrome group

    unpinned.forEach(t => {
      const gid = t.groupId;
      if (hasChromeGroupData && gid !== undefined && gid !== -1 && chromeTabGroups[gid]) {
        if (!chromeGrouped[gid]) chromeGrouped[gid] = { group: chromeTabGroups[gid], tabs: [] };
        chromeGrouped[gid].tabs.push(t);
      } else {
        domainGroupable.push(t);
      }
    });

    // 4. Domain-based grouping for remaining tabs
    const groups = {};
    const singles = [];

    // Domains that should never be auto-grouped (system/fallback values)
    const SKIP_GROUP_DOMAINS = new Set(['System', 'Local Files', 'Other', 'Unknown', 'Local']);

    const byDomain = {};
    domainGroupable.forEach(t => {
      const domain = getGroupDomainFromUrl(t.url);
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(t);
    });

    Object.entries(byDomain).forEach(([domain, domainTabs]) => {
      if (autoGroupEnabled && domainTabs.length > 1 && !SKIP_GROUP_DOMAINS.has(domain)) {
        groups[domain] = domainTabs;
      } else {
        singles.push(...domainTabs);
      }
    });

    // Sort singles by activity if available
    const sortedSingles = [...singles].sort((a, b) => {
      const scoreA = tabActivity[a.id] || 0;
      const scoreB = tabActivity[b.id] || 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return (a.title || '').localeCompare(b.title || '');
    });

    const recent = sortedSingles.slice(0, 8);
    const others = sortedSingles.slice(8);

    return {
      pinned,
      localhost,
      chromeGroups: Object.values(chromeGrouped),
      grouped: groups,
      recent,
      others,
      hasGroups: Object.keys(groups).length > 0,
      hasChromeGroups: Object.values(chromeGrouped).length > 0
    };
  }, [filteredTabs, tabActivity, autoGroupEnabled, chromeTabGroups]);

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

  return (
    <div className="tab-management" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      borderRadius: 16,
      overflow: 'hidden',
      border: '1px solid transparent'
    }}>
      <div className="tab-management__toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>

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
          {/* <button
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
          </button> */}
        </div>

        {/* WS Connection Status Indicator */}
        {isHostSyncEnabled() && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            borderRadius: '8px',
            background: wsConnected
              ? 'rgba(34, 197, 94, 0.1)'
              : 'rgba(100, 116, 139, 0.1)',
            border: `1px solid ${wsConnected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(100, 116, 139, 0.2)'}`,
            fontSize: 'var(--font-xs, 11px)',
            fontWeight: 500,
            color: wsConnected ? '#4ADE80' : '#64748B',
            userSelect: 'none'
          }}
            title={wsConnected ? 'Sync connected — tabs are live' : 'Sync disconnected — tabs may be outdated'}
          >
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: wsConnected ? '#22C55E' : '#64748B',
              boxShadow: wsConnected ? '0 0 6px #22C55E' : 'none',
              flexShrink: 0
            }} />
            <FontAwesomeIcon icon={faWifi} style={{ fontSize: '10px', opacity: 0.8 }} />
            <span>{wsConnected ? 'Synced' : 'Offline'}</span>
          </div>
        )}
      </div>

      {/* Stale tabs warning — shown when sync is down in remote-tab mode */}
      {isHostSyncEnabled() && !wsConnected && isRemoteTabMode && tabs.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '7px 12px',
          marginTop: '6px',
          background: 'rgba(234, 179, 8, 0.08)',
          border: '1px solid rgba(234, 179, 8, 0.2)',
          borderRadius: '8px',
          fontSize: 'var(--font-xs, 11px)',
          color: '#CA8A04'
        }}>
          <span>Browser sync disconnected — tabs may be outdated</span>
          <button
            onClick={() => refreshTabs()}
            style={{
              background: 'rgba(234, 179, 8, 0.15)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: '6px',
              padding: '3px 10px',
              color: '#CA8A04',
              cursor: 'pointer',
              fontSize: 'var(--font-xs, 11px)',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
          >
            Refresh
          </button>
        </div>
      )}

      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {/* Reserved widget area — same store as the overview board, its own layout. */}
        <WidgetBoard storageArea="tabs" compact defaultBoard={TABS_WIDGET_DEFAULT} />

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
            {/* 1. Active Apps Section (desktop only) */}
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
                      onKill={isTauriApp ? handleKillApp : null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 2. Pinned Tabs Section */}
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

            {/* 3. Local Dev Section (localhost / loopback / LAN dev servers) */}
            {partitionedTabs.localhost.length > 0 && (
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
                  <FontAwesomeIcon icon={faCode} style={{ opacity: 0.6 }} />
                  Local Dev ({partitionedTabs.localhost.length})
                </h3>
                <div className="tabs-grid">
                  {partitionedTabs.localhost.map(tab => (
                    <TabCard
                      key={`${tab.browser || 'other'}-${tab.id}`}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      onKillPort={isTauriApp ? handleKillPort : null}
                      isPinned={false}
                      isActive={tab.active}
                      lastAccessedAt={tabActivity[tab.id] || null}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 4. Chrome Native Tab Groups (Extension only) */}
            {!taskViewEnabled && partitionedTabs.hasChromeGroups && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Tab Groups ({partitionedTabs.chromeGroups.length})
                </h3>
                <div className="tabs-grid">
                  {partitionedTabs.chromeGroups.map(({ group, tabs: groupTabs }) => {
                    const color = CHROME_GROUP_COLORS[group.color] || '#9AA0A6';
                    // Fall back to primary domain if group has no title
                    const label = group.title || getGroupDomainFromUrl(groupTabs[0]?.url) || 'Group';
                    const groupKey = `chrome-${group.id}`;
                    return (
                      <TabGroupCard
                        key={group.id}
                        domain={label}
                        tabs={groupTabs}
                        onToggleExpand={() => startTransition(() => setExpandedDomain(expandedDomain === groupKey ? null : groupKey))}
                        onTabClick={handleTabClick}
                        onTabClose={handleTabClose}
                        isExpanded={expandedDomain === groupKey}
                        groupColor={color}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* 5. Grouped by Task Section (Task-First Tab Modeling) */}
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

            {/* 6. Grouped by Domain Section (only when task view is disabled) */}
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

            {/* 7. Recent (Ungrouped) Section - only when task view is disabled */}
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

            {/* 8. Other Tabs Section - only when task view is disabled */}
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

            {/* 9. Popular Folders (ranked from Recent Items activity, Tauri only) */}
            {frequentFolders.length > 0 && (
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
                  <FontAwesomeIcon icon={faFolderOpen} style={{ opacity: 0.6 }} />
                  Popular Folders ({Math.min(frequentFolders.length, 8)})
                </h3>
                <div className="folders-chip-grid">
                  {frequentFolders.slice(0, 8).map(folder => (
                    <FolderCard
                      key={folder.path}
                      folder={folder}
                      onClick={handleFolderClick}
                      onOpenExternal={handleFolderOpenExternal}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 10. Dev Servers panel — port-driven list of listening processes (Tauri only) */}
            {isTauriApp && (
              <DevServersPanel
                tabs={partitionedTabs.localhost}
                onTabClick={handleTabClick}
              />
            )}

            {/* Empty State */}
            {filteredTabs.length === 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                padding: '36px 20px',
                color: 'var(--text-secondary, #64748B)',
                textAlign: 'center',
                background: 'var(--glass-bg, rgba(30, 41, 59, 0.95))',
                borderRadius: '12px',
                border: '1px solid rgba(59, 130, 246, 0.2)'
              }}>
                <div style={{ fontSize: '44px', opacity: 0.3 }}>📑</div>
                <div>
                  <div style={{ fontSize: 'var(--font-lg, 14px)', fontWeight: 500, marginBottom: '6px' }}>
                    No Tabs Found
                  </div>
                  <div style={{ fontSize: 'var(--font-sm, 12px)' }}>
                    {isHostSyncEnabled()
                      ? 'No browser tabs are syncing from the extension yet'
                      : 'Open some browser tabs to see them here'}
                  </div>
                </div>

                {/* Host-sync mode: show connection health + troubleshooting + manual fetch */}
                {isHostSyncEnabled() && (
                  <>
                    {/* Connection status pill */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 12px', borderRadius: '99px',
                      fontSize: 'var(--font-xs, 11px)', fontWeight: 500,
                      background: wsConnected ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                      border: `1px solid ${wsConnected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                      color: wsConnected ? '#4ADE80' : '#F87171'
                    }}>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: wsConnected ? '#22C55E' : '#EF4444',
                        boxShadow: wsConnected ? '0 0 6px #22C55E' : 'none'
                      }} />
                      <FontAwesomeIcon icon={faWifi} style={{ fontSize: '10px' }} />
                      <span>{wsConnected ? 'Sync connected' : 'Sync offline'}</span>
                    </div>

                    {wsConnected ? (
                      // Sync layer is up but no tabs — extension may be down, or a sync hiccup.
                      <>
                        <div style={{ fontSize: 'var(--font-xs, 11px)', maxWidth: 320, lineHeight: 1.5 }}>
                          Sync is connected but no tabs were reported. If you have tabs open, make sure
                          the browser extension is enabled, then fetch them again from all browser instances.
                        </div>
                        <button
                          onClick={requestAllTabs}
                          disabled={requestingTabs}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '7px 16px', borderRadius: '8px',
                            background: 'rgba(59,130,246,0.18)',
                            border: '1px solid rgba(59,130,246,0.4)',
                            color: '#60A5FA', fontWeight: 500,
                            fontSize: 'var(--font-sm, 12px)',
                            cursor: requestingTabs ? 'default' : 'pointer',
                            opacity: requestingTabs ? 0.6 : 1
                          }}
                        >
                          <FontAwesomeIcon icon={faSync} spin={requestingTabs} style={{ fontSize: '11px' }} />
                          {requestingTabs ? 'Fetching…' : 'Fetch all tabs from all browsers'}
                        </button>
                      </>
                    ) : (
                      // Not connected — guide the user through the common causes.
                      <div style={{
                        textAlign: 'left', maxWidth: 340,
                        fontSize: 'var(--font-xs, 11px)', lineHeight: 1.6,
                        background: 'rgba(239,68,68,0.06)',
                        border: '1px solid rgba(239,68,68,0.15)',
                        borderRadius: '8px', padding: '10px 14px'
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary, #94A3B8)' }}>
                          Check these common issues:
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '16px' }}>
                          <li>Is the CoolDesk browser extension installed and <strong>enabled</strong>?</li>
                          <li>Is your browser (Chrome/Edge) actually running?</li>
                          <li>Try reloading the extension from <code>chrome://extensions</code>.</li>
                          <li>A firewall/VPN may be blocking <code>localhost:4545</code>.</li>
                        </ul>
                        <button
                          onClick={requestAllTabs}
                          disabled={requestingTabs}
                          style={{
                            marginTop: '10px',
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '5px 12px', borderRadius: '6px',
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            color: 'var(--text-secondary, #CBD5E1)',
                            fontSize: 'var(--font-xs, 11px)',
                            cursor: requestingTabs ? 'default' : 'pointer',
                            opacity: requestingTabs ? 0.6 : 1
                          }}
                        >
                          <FontAwesomeIcon icon={faSync} spin={requestingTabs} style={{ fontSize: '10px' }} />
                          Retry connection
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

          </>
        )}
      </div>

      {/* In-app folder browser — opened from any folder chip */}
      <FileManager
        isOpen={!!browsingFolder}
        initialPath={browsingFolder}
        places={frequentFolders}
        onClose={() => setBrowsingFolder(null)}
      />
    </div >
  );
}
