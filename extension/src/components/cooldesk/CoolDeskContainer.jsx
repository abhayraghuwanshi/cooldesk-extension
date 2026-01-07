import { faGear, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import logo from '../../../logo-2.png';
import '../../styles/cooldesk.css';
import '../../styles/global-add.css';
import '../../styles/spatial.css';
import '../../styles/tabCard.css';
import { ChatContext } from '../spatial/ChatContext';
import { NotesCanvas } from '../spatial/NotesCanvas';
import { Face, WorkspaceShell } from '../spatial/WorkspaceShell';
import { GlobalAddButton } from './GlobalAddButton';
import { OverviewDashboard } from './OverviewDashboard';
import { TabCard, TabGroupCard } from './TabCard';
import { WorkspaceList } from './WorkspaceList';


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

  const handleWorkspaceClick = (workspace) => {
    if (expandedWorkspace?.id === workspace.id) {
      setExpandedWorkspace(null);
    } else {
      setExpandedWorkspace(workspace);
    }
    setCurrentWorkspace(workspace);
    onOpenWorkspace?.(workspace);
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
      {/* Wallpaper Background */}
      {wallpaperEnabled && wallpaperUrl && (
        <>
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `url(${wallpaperUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: wallpaperOpacity,
            zIndex: -2,
            pointerEvents: 'none'
          }} />
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
        </>
      )}

      {/* Header with Logo and Settings - Outside spatial shell */}
      <div className="cooldesk-header">
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
          <span>Cooldesk</span>
        </div>
        <button className="cooldesk-settings-btn" onClick={onOpenSettings} title="Settings">
          <FontAwesomeIcon icon={faGear} />
        </button>
      </div>

      {/* Spatial Workspace Shell - Takes remaining height */}
      <WorkspaceShell activeFace={activeFace} onFaceChange={handleFaceChange}>
        {/* Face 1: Chat (Far Left) */}
        <Face index="chat">
          <ChatContext
            workspaceId={currentWorkspace?.id}
            workspaceName={currentWorkspace?.name || 'All Workspaces'}
          />
        </Face>

        {/* Face 2: Workspace Details (Left) - Shows ALL Workspaces */}
        <Face index="workspace">
          <WorkspaceList
            savedWorkspaces={savedWorkspaces}
            onWorkspaceClick={(ws) => setCurrentWorkspace(ws)}
            activeWorkspaceId={currentWorkspace?.id}
            expandedWorkspaceId={expandedWorkspace}
            pinnedWorkspaces={pinnedWorkspaces}
            onTogglePin={onTogglePin}
          />
        </Face>

        {/* Face 3: Overview (Center) */}
        {/* Face 3: Overview (Center) - Custom 2-Column Dashboard */}
        <Face index="overview">
          <OverviewDashboard
            savedWorkspaces={savedWorkspaces}
            onWorkspaceClick={(ws) => {
              setCurrentWorkspace(ws);
              setActiveFace('workspace');
            }}
            activeWorkspaceId={currentWorkspace?.id}
            expandedWorkspaceId={expandedWorkspace}
            onAddNote={onAddNote}
            pinnedWorkspaces={pinnedWorkspaces}
          />
        </Face>

        {/* Face 4: Tabs (Right) */}
        <Face index="tabs">
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            height: '100%'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h2 style={{
                fontSize: 'var(--font-2xl, 16px)',
                fontWeight: 600,
                color: 'var(--text-primary, #F1F5F9)',
                margin: 0
              }}>
                Browser Tabs
              </h2>
              <button
                onClick={refreshTabs}
                style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  color: '#60A5FA',
                  cursor: 'pointer',
                  fontSize: 'var(--font-sm, 12px)',
                  fontWeight: 500,
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                }}
              >
                🔄 Refresh
              </button>
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
                  {/* Pinned Tabs Section */}
                  {tabs.filter(tab => tab.pinned).length > 0 && (
                    <div>
                      <h3 style={{
                        fontSize: 'var(--font-sm, 12px)',
                        fontWeight: 600,
                        color: 'var(--text-secondary, #94A3B8)',
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Pinned ({tabs.filter(tab => tab.pinned).length})
                      </h3>
                      <div className="tabs-grid">
                        {tabs.filter(tab => tab.pinned).map(tab => (
                          <TabCard
                            key={tab.id}
                            tab={tab}
                            onClick={handleTabClick}
                            onClose={handleTabClose}
                            onPin={handleTabPin}
                            isPinned={true}
                            isActive={tab.active}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* All Tabs Section */}
                  <div>
                    <h3 style={{
                      fontSize: 'var(--font-sm, 12px)',
                      fontWeight: 600,
                      color: 'var(--text-secondary, #94A3B8)',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      All Tabs ({tabs.length})
                    </h3>
                    {tabs.length > 0 ? (
                      <div className="tabs-grid">
                        {tabs.map(tab => (
                          <TabCard
                            key={tab.id}
                            tab={tab}
                            onClick={handleTabClick}
                            onClose={handleTabClose}
                            onPin={handleTabPin}
                            isPinned={tab.pinned}
                            isActive={tab.active}
                          />
                        ))}
                      </div>
                    ) : (
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
                  </div>

                  {/* Grouped by Domain Section */}
                  {Object.keys(tabsByDomain()).length > 1 && (
                    <div>
                      <h3 style={{
                        fontSize: 'var(--font-sm, 12px)',
                        fontWeight: 600,
                        color: 'var(--text-secondary, #94A3B8)',
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Grouped by Domain
                      </h3>
                      <div className="tabs-grid">
                        {Object.entries(tabsByDomain())
                          .filter(([_, domainTabs]) => domainTabs.length > 1)
                          .map(([domain, domainTabs]) => (
                            <TabGroupCard
                              key={domain}
                              domain={domain}
                              tabs={domainTabs}
                              onClick={() => setExpandedDomain(expandedDomain === domain ? null : domain)}
                              isExpanded={expandedDomain === domain}
                            />
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Face>

        {/* Face 5: Notes (Far Right) */}
        <Face index="notes">
          <NotesCanvas workspaceId={currentWorkspace?.id} />
        </Face>
      </WorkspaceShell>

      {/* Global Add Button - Outside spatial shell */}
      <GlobalAddButton
        workspaces={savedWorkspaces}
        onCreateWorkspace={onCreateWorkspace}
        onAddUrlToWorkspace={onAddUrlToWorkspace}
        onAddNote={onAddNote}
      />
    </div>
  );
}
