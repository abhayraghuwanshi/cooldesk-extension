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
import '../../styles/dock-see-through.css';
import { Face, WorkspaceShell } from './WorkspaceShell';
import { GlobalSpotlight } from '../../features/spotlight/GlobalSpotlight';
import { UpdateButton } from '../../features/updates/UpdateButton';
import { openSpotlightEdit } from '../../services/spotlightEdit';
import { OverviewDashboard } from '../overview/OverviewDashboard';
import { itemRankingService } from '../../services/itemRankingService.js';
import { WorkspaceDockBar } from '../../features/dock/WorkspaceDockBar';
import { WorkspaceFileDrop } from '../../features/workspace-drop/WorkspaceFileDrop.jsx';
import { useDockState } from '../../features/dock/useDockState';
import { useLayoutSwitch } from '../../features/dock/useLayoutSwitch';
import { LayoutSwitchButton } from '../../features/dock/LayoutSwitchButton';
import { useCooldeskAutoWorkspace, useCooldeskDiscovery } from '../../shared/hooks/useCooldeskProjects.js';
import { useIsSidebarWidth } from '../../shared/hooks/useIsSidebarWidth.js';
// Lazy load WorkspaceList (Face 2)
const WorkspaceList = lazy(() => import('../workspace/WorkspaceList').then(m => ({ default: m.WorkspaceList })));

// Lazy load heavy components
const ChatContext = lazy(() => import('../workspace/ChatContext').then(m => ({ default: m.ChatContext })));
const TabManagement = lazy(() => import('../tabs/TabManagement').then(m => ({ default: m.TabManagement })));
// Last current workspace, restored on launch.
const CURRENT_WS_KEY = 'cooldesk.currentWorkspaceId';
const BrowseView = lazy(() => import('../browse/BrowseView').then(m => ({ default: m.BrowseView })));
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
      if (!window.electronAPI?.subscribe) return;
      // Scoping to `.workspace-face.active *` found nothing — the actual
      // scrolled container isn't reachable through that assumption, so cast
      // the net over the whole document instead of guessing again. Also
      // reset again a couple of times shortly after, in case something else
      // (async content settling into the list, a layout pass) scrolls it
      // back down right after this first pass.
      const resetScroll = () => {
        const scrolled = [...document.querySelectorAll('*')].filter(el => el.scrollTop > 0);
        scrolled.forEach(el => { el.scrollTop = 0; });
      };
      unsubscribe = window.electronAPI.subscribe('dock-expanded', () => {
        resetScroll();
        requestAnimationFrame(resetScroll);
        setTimeout(resetScroll, 300);
      });
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

  // ── Edit mode ────────────────────────────────────────────────────────────
  // The card's right-click "Edit" opens the same /edit-workspace mode on the
  // header search that typing a workspace's name there does — rename,
  // search-to-add a link/folder/app, todos, notes — rather than a second,
  // narrower "add one thing" flow with its own rules. `editTarget` is the
  // workspace the search box enters edit mode for; cleared once GlobalSpotlight
  // reports the mode closed (Esc, its chip's ×, or picking another workspace),
  // so the next right-click "Edit" — even on the same workspace — re-triggers.
  const [editTarget, setEditTarget] = useState(null);
  // Backend dock state — drives the sidebar / horizontal-bar render modes below.
  const dockState = useDockState();
  // Docked left/right always gets the sidebar layout, whatever width the page
  // reports: if the page view ever lags the window (it did — see
  // `autoresize_main_page` in src-tauri/src/lib.rs), Browse stayed mounted and its
  // native page showed over the 360pt panel.
  const isVerticalDock = isDesktopApp && !!dockState?.enabled
    && (dockState.side === 'left' || dockState.side === 'right');
  const isSidebarWidth = useIsSidebarWidth() || isVerticalDock;

  // At sidebar widths the header (and its embedded spotlight) isn't mounted,
  // so hand the edit to the standalone spotlight window instead.
  const handleOpenEditModal = useCallback((workspace = null) => {
    if (!workspace) return;
    if (isDesktopApp && isSidebarWidth) {
      openSpotlightEdit(workspace);
      return;
    }
    setEditTarget({ id: workspace.id, name: workspace.name });
  }, [isDesktopApp, isSidebarWidth]);

  const handleExitEditMode = useCallback(() => setEditTarget(null), []);

  const [graphOpen, setGraphOpen] = useState(false);

  // SettingsModal is a fixed two-column dialog that doesn't adapt to sidebar
  // widths (same reasoning that already keeps it out of `sidebar-control-bar`
  // below) — gate WorkspaceShell's own settings nav dot on the same check so
  // it isn't reachable from a width where it can't actually open correctly.

  const isDockedDrawer = isDesktopApp && !!dockState?.enabled && dockState.mode === 'drawer';

  // See-through on every platform now. How the window gets there differs —
  // macOS flips `setOpaque(false)` on the live window (`dock::set_see_through`),
  // Windows is built `.transparent(true)` up front because Win32/WebView2 fixes
  // transparency at creation — but from here it is one flag either way.
  //
  // This was long assumed macOS-only. The objection on record was that
  // `backdrop-filter` glitches inside a transparent webview, which is true of
  // WebKit and not of Chromium/WebView2; see `ensure_main_window`.
  const isSeeThroughDock = isDockedDrawer;

  // Vertical sides additionally get the floating-tile treatment — card
  // border/radius/shadow, hidden scrollbars, lifted text (`dock-sidebar` in
  // dock-see-through.css). The bar has its own pill styling instead.
  const isSidebarDock = isDockedDrawer
    && (dockState.side === 'left' || dockState.side === 'right');
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dock-see-through', !!isSeeThroughDock);
    root.classList.toggle('dock-sidebar', !!isSidebarDock);
    return () => root.classList.remove('dock-see-through', 'dock-sidebar');
  }, [isSeeThroughDock, isSidebarDock]);

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

  // On launch / reload: the workspace you were last in (else the first).
  // Remembered, so a refresh doesn't drop you back on workspace #1.
  useEffect(() => {
    if (savedWorkspaces.length > 0 && !currentWorkspace) {
      let lastId = null;
      try { lastId = localStorage.getItem(CURRENT_WS_KEY); } catch { /* none */ }
      setCurrentWorkspace(savedWorkspaces.find(w => w.id === lastId) || savedWorkspaces[0]);
    }
  }, [savedWorkspaces, currentWorkspace]);
  useEffect(() => {
    if (!currentWorkspace?.id) return;
    try { localStorage.setItem(CURRENT_WS_KEY, currentWorkspace.id); } catch { /* per session then */ }
  }, [currentWorkspace?.id]);

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
      // Opening one counts toward its activity rank (closing doesn't).
      itemRankingService.recordWorkspaceOpen(workspace);
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

  // There are no faces any more: old face names (slash commands, workspace
  // jumps, the onboarding event) map onto Browse — Home for the workspace
  // views, the side panel's Tabs tab for the tab views. BrowseView listens.
  const handleFaceChange = (face) => {
    const to = face === 'tabs' || face === 'browse' || face === 'team' ? 'tabs' : 'home';
    window.dispatchEvent(new CustomEvent('cooldesk-browse', { detail: { to } }));
  };

  const handleWorkspaceNavigate = (workspaceName) => {
    // Find the workspace by name
    const workspace = savedWorkspaces.find(ws => ws.name === workspaceName);
    if (workspace) {
      itemRankingService.recordWorkspaceOpen(workspace);
      setCurrentWorkspace(workspace);
      handleFaceChange('workspace'); // Home, now showing this workspace
      onOpenWorkspace?.(workspace);
      console.log('[CoolDesk] Navigated to workspace:', workspaceName);
    }
  };

  const handleNavigate = (destination) => {
    console.log('[CoolDesk] Navigation requested to:', destination);

    // Map navigation commands to face names. No 'chat' — WorkspaceShell has
    // no such face (see DESKTOP_FACES), so it used to leave the shell on a
    // currentFace nothing renders for.
    const faceMap = {
      'workspace': 'workspace',
      'tabs': 'tabs',
      'browse': 'browse',
      ...(TEAM_FEATURE_ENABLED ? { 'team': 'team' } : {}),
      'overview': 'overview'
    };

    const face = faceMap[destination];
    if (face) {
      handleFaceChange(face);
    } else {
      console.warn('[CoolDesk] Unknown destination:', destination);
    }
  };


  // Horizontal dock mode: while docked to the top/bottom edge, the main window
  // is a ~96px-tall strip — render only the taskbar-style workspace bar.
  if (isDesktopApp && dockState?.enabled && (dockState.side === 'top' || dockState.side === 'bottom')) {
    return (
      <>
        <WorkspaceDockBar
          workspaces={savedWorkspaces}
          activeWorkspace={currentWorkspace}
          onSelectWorkspace={setCurrentWorkspace}
          side={dockState.side}
        />
        <WorkspaceFileDrop />
      </>
    );
  }

  // Docked sidebar (desktop): the Active card (everything open right now),
  // your two most active workspaces, then widgets, Popular Folders and dev
  // servers — open apps/tabs aren't listed twice. At full width
  // Browse shows the same in its side panel's Home tab instead.
  // Popular Folders open in Browse's Files panel.
  const openFolderInBrowse = (path) => {
    window.dispatchEvent(new CustomEvent('cooldesk-browse', { detail: { to: 'folder', path } }));
  };
  const homePage = isDesktopApp && isSidebarWidth ? (
    <div className="home-stack">
      <section className="home-stack-workspaces">
        <Suspense fallback={null}>
          <WorkspaceList
            savedWorkspaces={savedWorkspaces}
            onWorkspaceClick={handleWorkspaceClick}
            activeWorkspaceId={currentWorkspace?.id}
            expandedWorkspaceId={expandedWorkspace?.id}
            pinnedWorkspaces={pinnedWorkspaces}
            onTogglePin={onTogglePin}
            onEditWorkspace={handleOpenEditModal}
            appSuggestions={appSuggestions}
            onAddAppsToWorkspace={handleAddAppsToWorkspace}
            showActive
            // Only the two most active; the rest stay behind "Show all".
            initialLimit={2}
          />
        </Suspense>
      </section>
      <section className="home-stack-active">
        <Suspense fallback={null}>
          {/* Open apps/tabs are in WorkspaceList's Active card; this keeps
              widgets, Popular Folders and dev servers. */}
          <TabManagement hideOpen />
        </Suspense>
      </section>
    </div>
  ) : null;

  return (
    <div className={`cooldesk-container ${themeClass}`}>
      {/* Finder/Explorer → workspace card drops (desktop app only). */}
      <WorkspaceFileDrop />
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
              slash commands are activated for this surface via props.
              CSS drops the whole header at sidebar widths, but a display:none
              parent doesn't stop this component's effects (data fetching,
              polling, event subscriptions) from running — so gate the mount
              itself instead of relying on the header being hidden. */}
          {!isSidebarWidth && (
            <GlobalSpotlight
              variant="embedded"
              onWorkspaceNavigate={handleWorkspaceNavigate}
              onNavigate={handleNavigate}
              isDesktopApp={isDesktopApp}
              enableVoice
              enableSlashCommands
              editTarget={editTarget}
              onExitEditMode={handleExitEditMode}
            />
          )}
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
          top header above is hidden: the update badge and the layout switch. */}
      <div className="sidebar-control-bar">
        {/* Outside the collapse: a pending update shouldn't hide behind the
            dots button, and it disappears again once installed. */}
        <UpdateButton compact />
        {/* The one layout switch at sidebar widths (was a row in each page —
            WorkspaceList and TabManagement). With the header hidden this is
            the only on-screen way out of the sidebar, so it lives here where
            every page shows it. */}
        {isDesktopApp && (
          <LayoutSwitchButton className="sidebar-control-btn" dockState={dockState} />
        )}
        {/* No Settings or Cool Activity here. Both are full desktop surfaces —
            SettingsModal is a fixed two-column dialog and the activity graph
            wants real canvas area — and neither adapts to sidebar widths, so
            offering them from the drawer only led somewhere broken. Both stay
            reachable from the full-width header. */}
      </div>

      {/* Desktop app: one screen. Browse is the whole app — Home (the
          workspace cards) in blank tabs, pages / files / folders as tabs, and
          the side panel for everything else. The old faces (Collections,
          Tabs, Browse) and their sliding shell are gone. */}
      {isDesktopApp && isSidebarWidth ? (
        // Docked sidebar: too narrow for a browser, so just the Home page.
        <div className="cooldesk-sidebar-page">{homePage}</div>
      ) : isDesktopApp ? (
        <div className="cooldesk-one-screen">
          <Suspense fallback={null}>
            <BrowseView
              savedWorkspaces={savedWorkspaces}
              activeWorkspaceId={currentWorkspace?.id}
              onSelectWorkspace={(id) => {
                const ws = savedWorkspaces.find(w => w.id === id);
                if (ws) setCurrentWorkspace(ws);
              }}
              isActive
              homeExtras={(
                <Suspense fallback={null}>
                  <TabManagement panel onOpenFolder={openFolderInBrowse} />
                </Suspense>
              )}
            />
          </Suspense>
        </div>
      ) : (
        // Extension: the single Overview face, as before.
        <WorkspaceShell activeFace="overview" isDesktopApp={false}>
          <Face index="overview">
            <OverviewDashboard
              savedWorkspaces={savedWorkspaces}
              onWorkspaceClick={handleOverviewClick}
              activeWorkspaceId={currentWorkspace?.id}
              expandedWorkspaceId={expandedWorkspace?.id}
              onAddNote={onAddNote}
              pinnedWorkspaces={pinnedWorkspaces}
              onEditWorkspace={handleOpenEditModal}
            />
          </Face>
        </WorkspaceShell>
      )}

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
