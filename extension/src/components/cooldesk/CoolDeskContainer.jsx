import { faGear } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import logo from '../../../logo-2.png';
import '../../styles/cooldesk.css';
import '../../styles/global-add.css';
import '../../styles/spatial.css';
import '../../styles/tabCard.css';
import { Face, WorkspaceShell } from '../spatial/WorkspaceShell';
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
  const [expandedWorkspace, setExpandedWorkspace] = useState(null);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [workspacePage, setWorkspacePage] = useState(0);
  const [activeFace, setActiveFace] = useState('overview');

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
    console.log('[CoolDesk] Navigated to face:', face);
  };

  return (
    <div className={`cooldesk-container ${themeClass}`}>
      {/* Wallpaper Background Overlay (Blur) handled by React, Image handled by Body CSS */}
      {wallpaperEnabled && wallpaperUrl && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: -1,
          pointerEvents: 'none'
        }} />
      )}

      {/* Header with Logo and Settings - Unified Top Bar */}
      <div className="cooldesk-header">
        <div className="header-left">
          <div className="cooldesk-logo">
            <img
              src={logo}
              alt="CoolDesk Logo"
              className="cooldesk-logo-icon"
              style={{
                width: '32px',
                height: '32px',
                objectFit: 'contain'
              }}
            />
            {/* <span>Cooldesk</span> */}
          </div>
        </div>

        <div className="header-center">
          <CoolSearch onSearch={handleSearch} />
        </div>

        <div className="header-right">
          <button className="cooldesk-settings-btn" onClick={onOpenSettings} title="Settings">
            <FontAwesomeIcon icon={faGear} />
          </button>
        </div>
      </div>

      {/* Spatial Workspace Shell - Takes remaining height */}
      <WorkspaceShell activeFace={activeFace} onFaceChange={handleFaceChange}>
        {/* Face 1: Chat (Far Left) */}
        <Face index="chat">
          <Suspense fallback={null}>
            <ChatContext
              workspaceId={currentWorkspace?.id}
              workspaceName={currentWorkspace?.name || 'All Workspaces'}
            />
          </Suspense>
        </Face>

        {/* Face 2: Workspace Details (Left) - Shows ALL Workspaces */}
        <Face index="workspace">
          <Suspense fallback={<div style={{ padding: 20, color: '#64748B', textAlign: 'center' }}>Loading...</div>}>
            <WorkspaceList
              savedWorkspaces={savedWorkspaces}
              onWorkspaceClick={handleWorkspaceClick}
              activeWorkspaceId={currentWorkspace?.id}
              expandedWorkspaceId={expandedWorkspace?.id}
              pinnedWorkspaces={pinnedWorkspaces}
              onTogglePin={onTogglePin}
            />
          </Suspense>
        </Face>

        {/* Face 3: Overview (Center) */}
        <Face index="overview">
          <OverviewDashboard
            savedWorkspaces={savedWorkspaces}
            onWorkspaceClick={handleOverviewClick}
            activeWorkspaceId={currentWorkspace?.id}
            expandedWorkspaceId={expandedWorkspace?.id}
            onAddNote={onAddNote}
            pinnedWorkspaces={pinnedWorkspaces}
          />
        </Face>

        {/* Face 4: Tabs (Right) */}
        <Face index="tabs">
          <Suspense fallback={null}>
            <TabManagement />
          </Suspense>
        </Face>

        {/* Face 5: Team (Further Right) */}
        <Face index="team">
          <Suspense fallback={null}>
            <TeamView />
          </Suspense>
        </Face>

        {/* Face 6: Notes (Far Right) */}
        <Face index="notes">
          <Suspense fallback={null}>
            <NotesCanvas workspaceId={currentWorkspace?.id} />
          </Suspense>
        </Face>
      </WorkspaceShell>

      {/* Global Add Button - Outside spatial shell */}
      <GlobalAddButton
        workspaces={savedWorkspaces}
        onCreateWorkspace={onCreateWorkspace}
        onAddUrlToWorkspace={onAddUrlToWorkspace}
        onAddNote={onAddNote}
      />
    </div >
  );
}
