import { faGear } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import logo from '../../../logo-2.png';
import { addUrlToWorkspace, deleteWorkspace, saveWorkspace } from '../../db/unified-api';
import { isElectronApp } from '../../services/environmentDetector';
import { runningAppsService } from '../../services/runningAppsService';
import { getPendingSuggestions } from '../../services/appCategorizationService';
import '../../styles/cooldesk.css';
import '../../styles/global-add.css';
import '../../styles/spatial.css';
import '../../styles/tabCard.css';
import { Face, WorkspaceShell } from '../spatial/WorkspaceShell';
import AIWorkspaceManager from './AIWorkspaceManager';
import { CoolSearch } from './CoolSearch';
import { GlobalAddButton } from './GlobalAddButton';
import { OverviewDashboard } from './OverviewDashboard';
// Lazy load WorkspaceList (Face 2)
const WorkspaceList = lazy(() => import('./WorkspaceList').then(m => ({ default: m.WorkspaceList })));

// Lazy load heavy components
const ChatContext = lazy(() => import('../spatial/ChatContext').then(m => ({ default: m.ChatContext })));
const NotesCanvas = lazy(() => import('../spatial/NotesCanvas').then(m => ({ default: m.NotesCanvas })));
const TeamView = lazy(() => import('../spatial/TeamView')); // Default export
const TabManagement = lazy(() => import('./TabManagement').then(m => ({ default: m.TabManagement })));

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

  // Run AI app categorization on first launch (or when apps/workspaces change)
  useEffect(() => {
    if (!isDesktopApp) return; // Only relevant in desktop app where sidecar runs
    if (!savedWorkspaces.length || !installedApps.length) return;

    let cancelled = false;
    (async () => {
      try {
        const [LocalAI, { runSeedingIfNeeded }] = await Promise.all([
          import('../../services/localAIService'),
          import('../../services/appCategorizationService')
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
    return localStorage.getItem('cooldesk-active-face') || (isDesktopApp ? 'workspace' : 'overview');
  });

  // Add Modal State
  const [addModalState, setAddModalState] = useState({
    isOpen: false,
    initialWorkspace: null
  });

  const handleOpenAddModal = (workspace = null) => {
    handleOpenAIManager(workspace);
  };

  const handleCloseAddModal = () => {
    setAddModalState(prev => ({ ...prev, isOpen: false }));
  };

  // AI Workspace Manager State
  const [aiManagerState, setAiManagerState] = useState({
    isOpen: false,
    initialWorkspace: null
  });

  const handleOpenAIManager = useCallback((workspace = null) => {
    setAiManagerState({
      isOpen: true,
      initialWorkspace: workspace
    });
  }, []);

  const handleCloseAIManager = useCallback(() => {
    setAiManagerState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const handleAIManagerSave = useCallback(async (workspaceData) => {
    try {
      // Save workspace to database
      await saveWorkspace(workspaceData);

      // Add URLs to the workspace URL index
      if (workspaceData.urls?.length > 0) {
        for (const urlItem of workspaceData.urls) {
          await addUrlToWorkspace(urlItem.url, workspaceData.id, {
            title: urlItem.title,
            favicon: urlItem.favicon,
            status: 'active'
          });
        }
      }

      console.log('[CoolDesk] Workspace saved via AI Manager:', workspaceData.name);
    } catch (err) {
      console.error('[CoolDesk] Failed to save workspace:', err);
      throw err;
    }
  }, []);

  const handleAIManagerDelete = useCallback(async (workspaceId) => {
    try {
      await deleteWorkspace(workspaceId);
      console.log('[CoolDesk] Workspace deleted:', workspaceId);
    } catch (err) {
      console.error('[CoolDesk] Failed to delete workspace:', err);
      throw err;
    }
  }, []);

  // Keyboard shortcut for AI Workspace Manager (Cmd/Ctrl+Shift+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'k') {
        e.preventDefault();
        if (!aiManagerState.isOpen) {
          handleOpenAIManager(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [aiManagerState.isOpen, handleOpenAIManager]);

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
    const handleGlobalClick = (e) => {
      // If clicking inside a workspace card, do nothing (let internal handler work)
      if (e.target.closest('.workspace-card') || e.target.closest('.workspace-popup-menu')) {
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

  const handleSearch = (query) => {
    onSearch?.(query);
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
      'notes': 'notes',
      'workspace': 'workspace',
      'chat': 'chat',
      'tabs': 'tabs',
      'team': 'team',
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
    // Check which one is active and add it
    try {
      const active = localStorage.getItem('cooldesk-active-face') || 'overview';
      initial.add(active);
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

  // Warmup other faces after idle (optional, 4s delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisitedFaces(prev => {
        // Preload commonly used faces if not already there
        if (prev.has('notes') && prev.has('team')) return prev;
        const next = new Set(prev);
        // Speculatively load notes after user is settled
        // next.add('notes'); 
        return next;
      });
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Lazy Initialize P2P Sync (only if Notes or Team is visited)
  const [p2pInitialized, setP2pInitialized] = useState(false);
  useEffect(() => {
    if (p2pInitialized) return;

    // Check if we need P2P
    const needsP2P = visitedFaces.has('notes') || visitedFaces.has('team');

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
              width="48"
              height="48"
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
          <CoolSearch
            onSearch={handleSearch}
            onWorkspaceNavigate={handleWorkspaceNavigate}
            onNavigate={handleNavigate}
            isDesktopApp={isDesktopApp}
          />
        </div>

        <div className="header-right">
          <button className="cooldesk-settings-btn" onClick={onOpenSettings} title="Settings">
            <FontAwesomeIcon icon={faGear} />
          </button>
        </div>
      </div>

      {/* Spatial Workspace Shell - Takes remaining height */}
      {/* In extension mode: Only show OverviewDashboard */}
      {/* In desktop app (Tauri/Electron): Show all faces with navigation */}
      <WorkspaceShell activeFace={activeFace} onFaceChange={handleFaceChange} onOpenSettings={isDesktopApp ? onOpenSettings : undefined} isDesktopApp={isDesktopApp}>
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
                      onEditWorkspace={handleOpenAIManager}
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
              onEditWorkspace={handleOpenAIManager}
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

        {/* Face 5: Team (Further Right) - Desktop App Only */}
        {isDesktopApp && (
          <Face index="team">
            {shouldRenderFace('team') && (
              <Suspense fallback={null}>
                <TeamView />
              </Suspense>
            )}
          </Face>
        )}

        {/* Face 6: Notes (Far Right) - Desktop App Only */}
        {isDesktopApp && (
          <Face index="notes">
            {shouldRenderFace('notes') && (
              <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Notes...</div>}>
                <NotesCanvas workspaceId={currentWorkspace?.id} />
              </Suspense>
            )}
          </Face>
        )}
      </WorkspaceShell>

      {/* Global Add Button - Desktop App Only */}
      {isDesktopApp && (
        <GlobalAddButton
          workspaces={savedWorkspaces}
          onCreateWorkspace={onCreateWorkspace}
          onAddUrlToWorkspace={onAddUrlToWorkspace}
          onAddNote={onAddNote}
          isOpen={addModalState.isOpen}
          onOpen={() => handleOpenAddModal(null)}
          onClose={handleCloseAddModal}
          initialWorkspace={addModalState.initialWorkspace}
          onOpenAIManager={() => handleOpenAIManager(null)}
          data-onboarding="global-add-btn"
        />
      )}

      {/* AI Workspace Manager - Two-column AI-powered workspace management */}
      <AIWorkspaceManager
        workspaces={savedWorkspaces}
        onSave={handleAIManagerSave}
        onDelete={handleAIManagerDelete}
        isOpen={aiManagerState.isOpen}
        onClose={handleCloseAIManager}
        initialWorkspace={aiManagerState.initialWorkspace}
      />
    </div >
  );
}
