import { faDiagramProject, faGear } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import logo from '../../../logo-2.png';
import { saveWorkspace } from '../../db/unified-api';
import { TEAM_FEATURE_ENABLED } from '../../config/features';
import { isElectronApp } from '../../services/environmentDetector';
import { runningAppsService } from '../../services/runningAppsService';
import { getPendingSuggestions, runSeedingIfNeeded } from '../../services/appCategorizationService';
import '../../styles/cooldesk.css';
import '../../styles/spatial.css';
import '../../styles/tabCard.css';
import { Face, WorkspaceShell } from './WorkspaceShell';
import { GlobalSpotlight } from '../../features/spotlight/GlobalSpotlight';
import { UpdateButton } from '../../features/updates/UpdateButton';
import { OverviewDashboard } from '../overview/OverviewDashboard';
import { WorkspaceDockBar } from '../../features/dock/WorkspaceDockBar';
import { useDockState } from '../../features/dock/useDockState';
import { useLayoutSwitch } from '../../features/dock/useLayoutSwitch';
import { LayoutSwitchButton } from '../../features/dock/LayoutSwitchButton';
import { useCooldeskAutoWorkspace, useCooldeskDiscovery } from '../../shared/hooks/useCooldeskProjects.js';
import { useIsSidebarWidth } from '../../shared/hooks/useIsSidebarWidth.js';
// Lazy load WorkspaceList (Face 2)
const WorkspaceList = lazy(() => import('../workspace/WorkspaceList').then(m => ({ default: m.WorkspaceList })));

// Lazy load heavy components
const ChatContext = lazy(() => import('../workspace/ChatContext').then(m => ({ default: m.ChatContext })));
const TeamView = lazy(() => import('../team/TeamView')); // Default export
const TabManagement = lazy(() => import('../tabs/TabManagement').then(m => ({ default: m.TabManagement })));
// Heavy: react-force-graph-2d (d3-force + canvas). Only load when the graph opens.
const KnowledgeGraph = lazy(() => import('../../features/knowledge-graph/KnowledgeGraph').then(m => ({ default: m.KnowledgeGraph })));

console.log('[CoolDesk] Module loaded. OverviewDashboard:', OverviewDashboard);

export function CoolDeskContainer({
  savedWorkspaces = [],
  onOpenWorkspace,
  onOpenAllWorkspace,
  onCreateWorkspace,
  onAddUrlToWorkspace,
  onAddNote,
  onSearch,
  onOpenSettings,
  themeClass = 'crimson-fire', // Default theme
  wallpaperEnabled = false,
  wallpaperUrl = '',
  wallpaperOpacity = 0.3,
  pinnedWorkspaces = [],
  onTogglePin,
}) {
  // Detect if running in Tauri/Electron app
  const isDesktopApp = isElectronApp();

  // App suggestions from AI categorization (loaded from localStorage + updated after seeding)
  const [appSuggestions, setAppSuggestions] = useState(() => getPendingSuggestions());

  // Subscribe to installed apps for seeding
  const [installedApps, setInstalledApps] = useState([]);
  useEffect(() => {
    const unsubscribe = runningAppsService.subscribe(({ installedApps: apps }) => {
      setInstalledApps(apps || []);
    });
    return unsubscribe;
  }, []);

  // The docked drawer's webview is hidden rather than unmounted between
  // opens (see dock_expand/expand_drawer in lib.rs), so every face's scroll
  // position otherwise survives untouched from whenever it was last closed —
  // scroll down once, close the drawer, and it reopens still scrolled to the
  // bottom every time after. `dock-expanded` fires on every drawer open
  // (first time and every reopen); reset whatever's actually scrolled inside
  // the currently visible face there, the same way a re-opened Spotlight
  // resets on `spotlight-shown`. Centralized here (rather than in each face
  // component individually) so it covers every face — Tabs, Workspace list,
  // any future one — without each having to wire this up itself.
  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    // `window.electronAPI` is attached by electron-shim.js's own
    // `initElectronAPI`, which documents (and retries for) exactly this
    // startup race on macOS — if this effect's first run lands before that
    // retry lands, `subscribe` would silently never get registered for the
    // rest of the session, since this effect has no dependency that would
    // make it run again on its own.
    const trySubscribe = () => {
      if (cancelled || unsubscribe) return;
      if (!window.electronAPI?.subscribe) {
        console.log('[CoolDesk] dock-expanded: electronAPI not ready yet, will retry');
        return;
      }
      // Scoping to `.workspace-face.active *` found nothing — the actual
      // scrolled container isn't reachable through that assumption, so cast
      // the net over the whole document instead of guessing again. Also
      // reset again a couple of times shortly after, in case something else
      // (async content settling into the list, a layout pass) scrolls it
      // back down right after this first pass.
      const resetScroll = () => {
        const scrolled = [...document.querySelectorAll('*')].filter(el => el.scrollTop > 0);
        console.log('[CoolDesk] dock-expanded: resetting', scrolled.length, 'scrolled element(s)',
          scrolled.map(el => el.className || el.tagName));
        scrolled.forEach(el => { el.scrollTop = 0; });
      };
      unsubscribe = window.electronAPI.subscribe('dock-expanded', () => {
        resetScroll();
        requestAnimationFrame(resetScroll);
        setTimeout(resetScroll, 300);
      });
      console.log('[CoolDesk] dock-expanded: subscribed');
    };
    trySubscribe();
    const timers = [50, 200, 500, 1500].map(ms => setTimeout(trySubscribe, ms));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      unsubscribe?.();
    };
  }, []);

  // A `/cd-init` in a repo CoolDesk has never seen becomes a workspace here,
  // instead of staying invisible until someone creates one by hand.
  useCooldeskAutoWorkspace(savedWorkspaces);

  // …and the repos that were already `.cooldesk` projects before this app ever
  // ran get found by scanning disk, instead of waiting for a plugin hook to fire.
  useCooldeskDiscovery(savedWorkspaces, { enabled: isDesktopApp });

  // Run AI app categorization on first launch (or when apps/workspaces change)
  useEffect(() => {
    if (!isDesktopApp) return; // Only relevant in desktop app where sidecar runs
    if (!savedWorkspaces.length || !installedApps.length) return;

    let cancelled = false;
    (async () => {
      try {
        const [LocalAI] = await Promise.all([
          import('../../services/localAIService'),
        ]);
        const available = await LocalAI.isAvailable();
        if (cancelled || !available) return;

        const result = await runSeedingIfNeeded(installedApps, savedWorkspaces, LocalAI.simpleChat);
        if (!cancelled && result) {
          // New suggestions were generated — refresh the banner state
          setAppSuggestions(getPendingSuggestions());
        }
      } catch (e) {
        console.warn('[CoolDesk] App seeding failed:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [isDesktopApp, savedWorkspaces, installedApps]);

  // Handler: add AI-suggested apps to a workspace
  const handleAddAppsToWorkspace = useCallback(async (workspaceName, apps) => {
    const workspace = savedWorkspaces.find(w => w.name === workspaceName);
    if (!workspace) return;

    const existingPaths = new Set((workspace.apps || []).map(a => a.path?.toLowerCase()));
    const newApps = apps.filter(a => !existingPaths.has(a.path?.toLowerCase()));
    if (!newApps.length) return;

    try {
      const updatedWorkspace = {
        ...workspace,
        apps: [...(workspace.apps || []), ...newApps]
      };
      await saveWorkspace(updatedWorkspace);
      console.log(`[CoolDesk] Added ${newApps.length} apps to workspace "${workspaceName}"`);
    } catch (err) {
      console.error('[CoolDesk] Failed to add apps to workspace:', err);
    }
  }, [savedWorkspaces]);

  const [expandedWorkspace, setExpandedWorkspace] = useState(null);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [workspacePage, setWorkspacePage] = useState(0);
  const [activeFace, setActiveFace] = useState(() => {
    const stored = localStorage.getItem('cooldesk-active-face');
    const fallback = isDesktopApp ? 'workspace' : 'overview';
    // 'notes' face was removed (notes are now embedded in workspace cards) — migrate any
    // leftover persisted value so the app doesn't boot into an empty/broken state.
    if (stored === 'notes') return fallback;
    if (stored === 'team' && !TEAM_FEATURE_ENABLED) return fallback;
    return stored || fallback;
  });

  // ── Add mode ─────────────────────────────────────────────────────────────
  // Adding to a workspace reuses the header search rather than a modal of its
  // own: finding the thing to add is the same problem the spotlight already
  // solves, and a card-local search box would be a second, worse index.
  // `addTarget` is the workspace the next picked result lands in.
  const [addTarget, setAddTarget] = useState(null);

  const handleOpenAddModal = useCallback((workspace = null) => {
    if (!workspace) return;
    setAddTarget({ id: workspace.id, name: workspace.name });
  }, []);

  const handleExitAddMode = useCallback(() => setAddTarget(null), []);

  const [graphOpen, setGraphOpen] = useState(false);

  // SettingsModal is a fixed two-column dialog that doesn't adapt to sidebar
  // widths (same reasoning that already keeps it out of `sidebar-control-bar`
  // below) — gate WorkspaceShell's own settings nav dot on the same check so
  // it isn't reachable from a width where it can't actually open correctly.
  const isSidebarWidth = useIsSidebarWidth();

  // Backend dock state — drives the horizontal-bar render mode below.
  const dockState = useDockState();

  // Activate a workspace as a taskbar-style bottom bar: make it current, then
  // dock the main window to the bottom edge and slide it in.
  const handleDockWorkspace = useCallback(async (workspace) => {
    if (workspace) setCurrentWorkspace(workspace);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('dock_enable', { mode: 'drawer', side: 'bottom' });
      await invoke('dock_expand');
    } catch (e) {
      console.error('[CoolDesk] Failed to dock workspace as bar:', e);
    }
  }, []);

  /* ── Layout cycle ────────────────────────────────────────────────────────
     One button walks the window through three layouts:
       full → side (drawer on the saved vertical edge) → bar (bottom strip) → full
     Shared with the Tab Management toolbar and the workspace dock bar via
     `useLayoutSwitch` — see `src/features/dock/useLayoutSwitch.js`. */
  const { currentLayoutInfo, nextLayout, cycleLayout } = useLayoutSwitch(dockState);

  // Persist one item picked from the header search into the target workspace.
  // Links go through the URL index (`onAddUrlToWorkspace`) so analytics and
  // the workspace↔url association stay consistent with every other add path;
  // apps/folders/files are plain members of the workspace record.
  const handleAddFromSearch = useCallback(async (target, item) => {
    const workspace = savedWorkspaces.find(w => w.id === target.id);
    if (!workspace) throw new Error(`Workspace ${target.id} no longer exists`);

    if (item.kind === 'url') {
      await onAddUrlToWorkspace?.(workspace.id, {
        url: item.url,
        title: item.title,
        favicon: item.favicon,
      });
      return;
    }

    // Apps dedupe on path — re-adding the same folder from search is a
    // no-op rather than a second identical chip on the card.
    const path = (item.path || '').toLowerCase();
    if (path && (workspace.apps || []).some(a => (a.path || '').toLowerCase() === path)) return;
    await saveWorkspace({
      ...workspace,
      apps: [...(workspace.apps || []), { name: item.name, path: item.path, icon: item.icon ?? null, ...(item.appType ? { appType: item.appType } : {}) }],
      updatedAt: Date.now(),
    });
  }, [savedWorkspaces, onAddUrlToWorkspace]);

  // Keyboard shortcuts: Graph (Ctrl+Shift+G), sidebar dock toggle (Ctrl+Shift+D).
  // `e.key` is the *shifted* character, so compare case-insensitively.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!((e.metaKey || e.ctrlKey) && e.shiftKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'g') {
        e.preventDefault();
        setGraphOpen(prev => !prev);
      } else if (key === 'd' && isDesktopApp) {
        e.preventDefault();
        cycleLayout();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDesktopApp, cycleLayout]);

  // Onboarding navigation via custom event (face names: workspace, tabs, team, overview)
  useEffect(() => {
    const handler = (e) => {
      const face = e.detail?.face;
      if (face) handleFaceChange(face);
    };
    window.addEventListener('cooldesk-navigate', handler);
    return () => window.removeEventListener('cooldesk-navigate', handler);
  }, []);

  // "Activate as dock" from a workspace card's context menu (custom event so it
  // doesn't need prop-drilling through WorkspaceList's three card call sites).
  useEffect(() => {
    const handler = (e) => {
      const { id, name } = e.detail || {};
      const workspace = savedWorkspaces.find((w) => (id && w.id === id) || (name && w.name === name));
      if (workspace) handleDockWorkspace(workspace);
    };
    window.addEventListener('cooldesk-dock-workspace', handler);
    return () => window.removeEventListener('cooldesk-dock-workspace', handler);
  }, [savedWorkspaces, handleDockWorkspace]);

  // Tab management state
  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [pinnedTabs, setPinnedTabs] = useState(new Set());
  const [expandedDomain, setExpandedDomain] = useState(null);

  // Auto-select first workspace on mount
  useEffect(() => {
    if (savedWorkspaces.length > 0 && !currentWorkspace) {
      setCurrentWorkspace(savedWorkspaces[0]);
    }
  }, [savedWorkspaces, currentWorkspace]);

  const WORKSPACES_PER_PAGE = 2; // Show 3 workspaces in overview
  const totalPages = Math.ceil(savedWorkspaces.length / WORKSPACES_PER_PAGE);
  const startIdx = workspacePage * WORKSPACES_PER_PAGE;
  const displayedWorkspaces = savedWorkspaces.slice(startIdx, startIdx + WORKSPACES_PER_PAGE);

  // Fetch browser tabs
  const refreshTabs = useCallback(async () => {
    // Only set loading on initial empty state to avoid flickering
    if (tabs.length === 0) setTabsLoading(true);

    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
        // Fix: Query ALL tabs from ALL windows (removed { currentWindow: true })
        const allTabs = await chrome.tabs.query({});

        // Sort: Active tabs first, then by windowId + index
        const sortedTabs = (allTabs || []).sort((a, b) => {
          if (a.active && !b.active) return -1;
          if (!a.active && b.active) return 1;
          if (a.windowId !== b.windowId) return a.windowId - b.windowId;
          return a.index - b.index;
        });

        setTabs(sortedTabs);
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to fetch tabs:', error);
    } finally {
      setTabsLoading(false);
    }
  }, []); // tabs dependency removed to avoid loops, though it wasn't there before

  // Load tabs on mount and keep updated
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

  // Group tabs by domain
  const tabsByDomain = useCallback(() => {
    const grouped = {};
    tabs.forEach(tab => {
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;
        if (!grouped[domain]) {
          grouped[domain] = [];
        }
        grouped[domain].push(tab);
      } catch (e) {
        // Invalid URL, skip
      }
    });
    return grouped;
  }, [tabs]);

  // Handle tab actions
  const handleTabClick = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId && chrome?.windows?.update) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to activate tab:', error);
    }
  }, []);

  const handleTabClose = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
        await chrome.tabs.remove(tab.id);
        // Event listener will trigger refresh
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to close tab:', error);
    }
  }, []);

  const handleTabPin = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        console.log('[TabDebug] Manual pin toggle requested for tab:', tab.id, !pinnedTabs.has(tab.id));
        const isPinned = pinnedTabs.has(tab.id);
        await chrome.tabs.update(tab.id, { pinned: !isPinned });

        const newPinned = new Set(pinnedTabs);
        if (isPinned) {
          newPinned.delete(tab.id);
        } else {
          newPinned.add(tab.id);
        }
        setPinnedTabs(newPinned);
        // Event listener will trigger refresh
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to pin/unpin tab:', error);
    }
  }, [pinnedTabs]);

  // Click outside to close expanded workspace
  useEffect(() => {
    // A mousedown on a scrollbar reports the scrolling element as its target,
    // with coordinates in the scrollbar gutter — i.e. outside that element's
    // client (padding) box. Without this, grabbing the scrollbar of any
    // container *around* the detail view counted as an outside click and
    // collapsed the workspace mid-drag.
    const isScrollbarClick = (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect();
      const inVerticalGutter = el.scrollHeight > el.clientHeight &&
        e.clientX > rect.left + el.clientLeft + el.clientWidth;
      const inHorizontalGutter = el.scrollWidth > el.clientWidth &&
        e.clientY > rect.top + el.clientTop + el.clientHeight;
      return inVerticalGutter || inHorizontalGutter;
    };

    const handleGlobalClick = (e) => {
      if (isScrollbarClick(e)) return;
      // If clicking inside a workspace card, do nothing (let internal handler work).
      // The right-click context menu renders via a portal to document.body, so it
      // is OUTSIDE the card subtree — exempt it explicitly, otherwise this mousedown
      // collapses the workspace and unmounts the menu before its buttons / the
      // native color picker can fire.
      // .workspace-detail-view covers the context panel, which is a sibling of the
      // card rather than a child of it.
      if (e.target.closest('.cooldesk-workspace-card') ||
          e.target.closest('.workspace-detail-view') ||
          e.target.closest('.workspace-popup-menu') ||
          e.target.closest('.workspace-context-menu')) {
        return;
      }
      // If clicking outside, close
      if (expandedWorkspace) {
        setExpandedWorkspace(null);
      }
    };

    document.addEventListener('mousedown', handleGlobalClick);
    return () => document.removeEventListener('mousedown', handleGlobalClick);
  }, [expandedWorkspace]);

  const handleWorkspaceClick = (workspace) => {
    // Toggle logic: if already expanded, close it; else open it
    if (expandedWorkspace?.id === workspace.id) {
      setExpandedWorkspace(null);
    } else {
      setExpandedWorkspace(workspace);
    }
    // Only set current workspace if not just closing the menu?
    // User intent might be to just view the menu, or switch. 
    // Usually clicking a card switches to it. 
    // If the card expands on click, that's one thing. 
    // Assuming clicking the main card switches, and there's a menu button?
    // Based on user query "how do i close this", it seems clicking opens it.

    // Keeping existing logic for now, just robust toggle.
    setCurrentWorkspace(workspace);
    onOpenWorkspace?.(workspace);
  };

  const handleOverviewClick = (workspace) => {
    // Toggle expansion logic
    if (expandedWorkspace?.id === workspace.id) {
      setExpandedWorkspace(null);
    } else {
      setExpandedWorkspace(workspace);
    }
    setCurrentWorkspace(workspace);
    // Explicitly NO navigation (setActiveFace) here to keep user in Overview
  };

  const handleCreateWorkspace = () => {
    onCreateWorkspace?.();
  };

  const handleFaceChange = (face) => {
    setActiveFace(face);
    localStorage.setItem('cooldesk-active-face', face);
    console.log('[CoolDesk] Navigated to face:', face);
  };

  const handleWorkspaceNavigate = (workspaceName) => {
    // Find the workspace by name
    const workspace = savedWorkspaces.find(ws => ws.name === workspaceName);
    if (workspace) {
      setCurrentWorkspace(workspace);
      setActiveFace('workspace'); // Navigate to workspace view
      onOpenWorkspace?.(workspace);
      console.log('[CoolDesk] Navigated to workspace:', workspaceName);
    }
  };

  const handleNavigate = (destination) => {
    console.log('[CoolDesk] Navigation requested to:', destination);

    // Map navigation commands to face names
    const faceMap = {
      'workspace': 'workspace',
      'chat': 'chat',
      'tabs': 'tabs',
      ...(TEAM_FEATURE_ENABLED ? { 'team': 'team' } : {}),
      'overview': 'overview'
    };

    const face = faceMap[destination];
    if (face) {
      console.log('[CoolDesk] Navigating from', activeFace, 'to', face);
      setActiveFace(face);
      localStorage.setItem('cooldesk-active-face', face);
    } else {
      console.warn('[CoolDesk] Unknown destination:', destination);
    }
  };

  // Track visited faces to lazy load heavy components
  const [visitedFaces, setVisitedFaces] = useState(() => {
    // Initialize with current face (usually 'overview')
    const initial = new Set(['overview']);
    try {
      const active = localStorage.getItem('cooldesk-active-face') || 'overview';
      // 'notes' face was removed — don't treat it as a visited face anymore.
      // 'team' is feature-flagged off — visiting it would lazy-init P2P for nothing.
      if (active !== 'notes' && (active !== 'team' || TEAM_FEATURE_ENABLED)) initial.add(active);
    } catch { }
    return initial;
  });

  // Helper to check if a face should be rendered
  const shouldRenderFace = (faceName) => {
    return visitedFaces.has(faceName) || activeFace === faceName;
  };

  // Update visited faces when navigation occurs
  useEffect(() => {
    if (!visitedFaces.has(activeFace)) {
      setVisitedFaces(prev => {
        const next = new Set(prev);
        next.add(activeFace);
        return next;
      });
    }
  }, [activeFace, visitedFaces]);

  // Lazy Initialize P2P Sync (only if Team is visited)
  const [p2pInitialized, setP2pInitialized] = useState(false);
  useEffect(() => {
    if (p2pInitialized) return;

    // Check if we need P2P
    const needsP2P = visitedFaces.has('team');

    if (needsP2P) {
      console.log('[CoolDesk] Initializing P2P Service (Lazy)...');
      // Dynamic import to avoid loading the module on startup
      import('../../services/p2p/syncService').then(({ p2pSyncService }) => {
        p2pSyncService.init().catch(err => {
          console.warn('Failed to initialize P2P Sync:', err);
        });
      }).catch(err => {
        console.warn('Failed to load P2P Sync service:', err);
      });
      setP2pInitialized(true);
    }
  }, [visitedFaces, p2pInitialized]);

  // Horizontal dock mode: while docked to the top/bottom edge, the main window
  // is a ~96px-tall strip — render only the taskbar-style workspace bar.
  if (isDesktopApp && dockState?.enabled && (dockState.side === 'top' || dockState.side === 'bottom')) {
    return (
      <WorkspaceDockBar
        workspaces={savedWorkspaces}
        activeWorkspace={currentWorkspace}
        onSelectWorkspace={setCurrentWorkspace}
        side={dockState.side}
      />
    );
  }

  return (
    <div className={`cooldesk-container ${themeClass}`}>
      {/* Wallpaper Background Overlay (Blur) handled by React, Image handled by Body CSS */}
      {/* {wallpaperEnabled && wallpaperUrl && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          // backdropFilter: 'blur(8px)',
          // WebkitBackdropFilter: 'blur(8px)',
          zIndex: -1,
          pointerEvents: 'none'
        }} />
      )} */}

      {/* Header with Logo and Settings - Unified Top Bar */}
      <div className="cooldesk-header">
        <div className="header-left">
          <div className="cooldesk-logo">
            <img
              src={logo}
              alt="CoolDesk Logo"
              className="cooldesk-logo-icon"
              width="44"
              height="44"
              decoding="async"
              fetchPriority="high"
              style={{
                objectFit: 'contain'
              }}
            />
            {/* <span>Cooldesk</span> */}
          </div>
        </div>

        <div className="header-center">
          {/* Same spotlight as Alt+K, embedded as the header search; voice and
              slash commands are activated for this surface via props. */}
          <GlobalSpotlight
            variant="embedded"
            onWorkspaceNavigate={handleWorkspaceNavigate}
            onNavigate={handleNavigate}
            isDesktopApp={isDesktopApp}
            enableVoice
            enableSlashCommands
            addTarget={addTarget}
            onAddItem={handleAddFromSearch}
            onExitAddMode={handleExitAddMode}
          />
        </div>

        <div className="header-right">
          {/* Renders only when an update is actually pending — the update must
              be reachable without opening Settings. */}
          <UpdateButton />
          {isDesktopApp && (
            <LayoutSwitchButton
              className="cooldesk-settings-btn"
              data-onboarding="dock-btn"
              dockState={dockState}
              title={`${currentLayoutInfo.label} → ${nextLayout.label} (Ctrl+Shift+D)`}
            />
          )}
          <button className="cooldesk-settings-btn" onClick={() => setGraphOpen(true)} title="Cool Activity (Ctrl+Shift+G)">
            <FontAwesomeIcon icon={faDiagramProject} />
          </button>
          <button className="cooldesk-settings-btn" onClick={onOpenSettings} title="Settings">
            <FontAwesomeIcon icon={faGear} />
          </button>
        </div>
      </div>

      {/* Corner control bar — only visible at sidebar widths (CSS), where the
          top header above is hidden. Just the update badge now: the layout
          switch lives in the Tab Management toolbar instead, so this corner
          isn't a second copy of it. */}
      <div className="sidebar-control-bar">
        {/* Outside the collapse: a pending update shouldn't hide behind the
            dots button, and it disappears again once installed. */}
        <UpdateButton compact />
        {/* No Settings or Cool Activity here. Both are full desktop surfaces —
            SettingsModal is a fixed two-column dialog and the activity graph
            wants real canvas area — and neither adapts to sidebar widths, so
            offering them from the drawer only led somewhere broken. Both stay
            reachable from the full-width header. */}
      </div>

      {/* Spatial Workspace Shell - Takes remaining height */}
      {/* In extension mode: Only show OverviewDashboard */}
      {/* In desktop app (Tauri/Electron): Show all faces with navigation */}
      <WorkspaceShell activeFace={activeFace} onFaceChange={handleFaceChange} onOpenSettings={isDesktopApp && !isSidebarWidth ? onOpenSettings : undefined} isDesktopApp={isDesktopApp}>
        {/* Face 1: Workspace Details + ChatContext (Left) - Desktop App Only */}
        {isDesktopApp && (
          <Face index="workspace">
            {shouldRenderFace('workspace') && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px', overflow: 'hidden', padding: '16px 0' }}>
                {/* WorkspaceList - takes 55% of space */}
                <div style={{ flex: '0 0 100%', minHeight: 0, overflow: 'auto' }}>
                  <Suspense fallback={<div style={{ padding: 20, color: '#64748B', textAlign: 'center' }}>Loading...</div>}>
                    <WorkspaceList
                      savedWorkspaces={savedWorkspaces}
                      onWorkspaceClick={handleWorkspaceClick}
                      activeWorkspaceId={currentWorkspace?.id}
                      expandedWorkspaceId={expandedWorkspace?.id}
                      pinnedWorkspaces={pinnedWorkspaces}
                      onTogglePin={onTogglePin}
                      onAddUrl={handleOpenAddModal}
                      appSuggestions={appSuggestions}
                      onAddAppsToWorkspace={handleAddAppsToWorkspace}
                    />
                  </Suspense>
                </div>
                {/* ChatContext - takes 45% of space */}
                {/* <div style={{ flex: '0 0 45%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <Suspense fallback={null}>
                    <ChatContext
                      workspaceId={currentWorkspace?.id}
                      workspaceName={currentWorkspace?.name || 'All Workspaces'}
                    />
                  </Suspense>
                </div> */}
              </div>
            )}
          </Face>
        )}

        {/* Face 3: Overview (Center) - Extension Only */}
        {!isDesktopApp && (
          <Face index="overview">
            <OverviewDashboard
              savedWorkspaces={savedWorkspaces}
              onWorkspaceClick={handleOverviewClick}
              activeWorkspaceId={currentWorkspace?.id}
              expandedWorkspaceId={expandedWorkspace?.id}
              onAddNote={onAddNote}
              pinnedWorkspaces={pinnedWorkspaces}
              onAddUrl={handleOpenAddModal}
            />
          </Face>
        )}

        {/* Face 4: Tabs (Right) - Desktop App Only */}
        {isDesktopApp && (
          <Face index="tabs">
            {shouldRenderFace('tabs') && (
              <Suspense fallback={null}>
                <TabManagement />
              </Suspense>
            )}
          </Face>
        )}

        {/* Face 3: Team (Right-most) - Desktop App Only, behind feature flag */}
        {isDesktopApp && TEAM_FEATURE_ENABLED && (
          <Face index="team">
            {shouldRenderFace('team') && (
              <Suspense fallback={null}>
                <TeamView />
              </Suspense>
            )}
          </Face>
        )}
      </WorkspaceShell>

      {/* The floating "Quick Add" button used to live here. Adding to a
          workspace is now right-click → Add item, which arms the header
          search — so a permanent action button for the same job was one
          entry point too many. `features/global-add/` is unreferenced as a
          result; it still holds the only manual New Workspace form. */}

      {/* Knowledge Graph — lazy; only mount when opened so d3/force-graph stays out of main */}
      {graphOpen && (
        <Suspense fallback={null}>
          <KnowledgeGraph isOpen={graphOpen} onClose={() => setGraphOpen(false)} />
        </Suspense>
      )}
    </div >
  );
}
