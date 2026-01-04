import { faChevronLeft, faChevronRight, faGear, faStickyNote } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import '../../styles/cooldesk.css';
import '../../styles/global-add.css';
import '../../styles/spatial.css';
import '../../styles/tabCard.css';
import { ChatContext } from '../spatial/ChatContext';
import { NotesCanvas } from '../spatial/NotesCanvas';
import { Face, WorkspaceShell } from '../spatial/WorkspaceShell';
import { CoolSearch } from './CoolSearch';
import { GlobalAddButton } from './GlobalAddButton';
import { NotesWidget } from './NotesWidget';
import { QuickAccess } from './QuickAccess';
import { RecentChats } from './RecentChats';
import { TabCard, TabGroupCard } from './TabCard';
import { WorkspaceCard } from './WorkspaceCard';

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
}) {
  const [expandedWorkspace, setExpandedWorkspace] = useState(null);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [workspacePage, setWorkspacePage] = useState(0);
  const [activeFace, setActiveFace] = useState('overview');

  // Tab management state
  const [tabs, setTabs] = useState([]);
  const [pinnedTabs, setPinnedTabs] = useState(new Set());
  const [expandedDomain, setExpandedDomain] = useState(null);

  // Auto-select first workspace on mount
  useEffect(() => {
    if (savedWorkspaces.length > 0 && !currentWorkspace) {
      setCurrentWorkspace(savedWorkspaces[0]);
    }
  }, [savedWorkspaces, currentWorkspace]);

  const WORKSPACES_PER_PAGE = 3; // Show 3 workspaces in overview
  const totalPages = Math.ceil(savedWorkspaces.length / WORKSPACES_PER_PAGE);
  const startIdx = workspacePage * WORKSPACES_PER_PAGE;
  const displayedWorkspaces = savedWorkspaces.slice(startIdx, startIdx + WORKSPACES_PER_PAGE);

  // Fetch browser tabs
  const refreshTabs = useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        setTabs(allTabs);
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to fetch tabs:', error);
    }
  }, []);

  // Load tabs on mount and when activeFace changes to tabs
  useEffect(() => {
    if (activeFace === 'tabs') {
      refreshTabs();
    }
  }, [activeFace, refreshTabs]);

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
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to activate tab:', error);
    }
  }, []);

  const handleTabClose = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
        await chrome.tabs.remove(tab.id);
        await refreshTabs();
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to close tab:', error);
    }
  }, [refreshTabs]);

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
        await refreshTabs();
      }
    } catch (error) {
      console.error('[CoolDesk] Failed to pin/unpin tab:', error);
    }
  }, [pinnedTabs, refreshTabs]);

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
          <div className="cooldesk-logo-icon">🏢</div>
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
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            height: '100%'
          }}>
            <h2 style={{
              fontSize: 'var(--font-2xl, 16px)',
              fontWeight: 600,
              color: 'var(--text-primary, #F1F5F9)',
              margin: 0
            }}>
              All Workspaces ({savedWorkspaces.length})
            </h2>

            {savedWorkspaces.length > 0 ? (
              <div style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '12px',
                alignContent: 'start'
              }}>
                {savedWorkspaces.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    onClick={handleWorkspaceClick}
                    isExpanded={expandedWorkspace?.id === workspace.id}
                    isActive={currentWorkspace?.id === workspace.id}
                  />
                ))}
              </div>
            ) : (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                color: 'var(--text-secondary, #64748B)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '48px', opacity: 0.3 }}>📁</div>
                <div>
                  <div style={{
                    fontSize: 'var(--font-lg, 14px)',
                    fontWeight: 500,
                    marginBottom: '8px'
                  }}>
                    No Workspaces Yet
                  </div>
                  <div style={{ fontSize: 'var(--font-sm, 10px)' }}>
                    Create a workspace to get started
                  </div>
                </div>
              </div>
            )}
          </div>
        </Face>

        {/* Face 3: Overview (Center) */}
        <Face index="overview">
          <div className="cooldesk-overview-content">
            {/* Main Search Bar */}
            <CoolSearch onSearch={handleSearch} />

            {/* Workspace Navigation */}
            {totalPages > 1 && (
              <div className="workspace-navigation">
                <button
                  className="workspace-nav-btn"
                  onClick={() => setWorkspacePage(Math.max(0, workspacePage - 1))}
                  disabled={workspacePage === 0}
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                  <span>Previous</span>
                </button>
                <div className="workspace-page-indicator">
                  <span className="page-dots">
                    {Array.from({ length: totalPages }).map((_, idx) => (
                      <button
                        key={idx}
                        className={`page-dot ${idx === workspacePage ? 'active' : ''}`}
                        onClick={() => setWorkspacePage(idx)}
                        title={`Page ${idx + 1}`}
                      />
                    ))}
                  </span>
                  <span className="page-text">
                    Page {workspacePage + 1} of {totalPages}
                  </span>
                </div>
                <button
                  className="workspace-nav-btn"
                  onClick={() => setWorkspacePage(Math.min(totalPages - 1, workspacePage + 1))}
                  disabled={workspacePage === totalPages - 1}
                >
                  <span>Next</span>
                  <FontAwesomeIcon icon={faChevronRight} />
                </button>
              </div>
            )}

            {/* Workspace Cards Grid - Show current page + Notes */}
            <div className="cooldesk-workspaces">
              {displayedWorkspaces.map((workspace) => (
                <WorkspaceCard
                  key={workspace.id}
                  workspace={workspace}
                  onClick={handleWorkspaceClick}
                  isExpanded={expandedWorkspace?.id === workspace.id}
                  isActive={currentWorkspace?.id === workspace.id}
                />
              ))}
              {/* <CreateWorkspaceCard onClick={handleCreateWorkspace} /> */}
              {/* Notes Widget in 4th position */}
              <div className="cooldesk-workspace-card" style={{
                background: 'rgba(139, 92, 246, 0.15)',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div className="workspace-card-header">
                  <div className="workspace-icon purple">
                    <FontAwesomeIcon icon={faStickyNote} />
                  </div>
                  <div className="workspace-info">
                    <div className="workspace-name">Notes</div>
                    <div className="workspace-count">Jot down a thought...</div>
                  </div>
                </div>
                <div style={{
                  flex: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0
                }}>
                  <NotesWidget maxNotes={5} compact={true} />
                </div>
              </div>
            </div>

            {/* Bottom Grid - Quick Access and Recent Chats Only */}
            <div className="cooldesk-bottom-grid">
              <QuickAccess />
              <RecentChats maxItems={5} />
            </div>

            {/* Mascot Character */}
            <div className="cooldesk-mascot">
              <div className="mascot-character">☁️</div>
              <div className="mascot-sparkles">
                <span className="sparkle">✨</span>
                <span className="sparkle">✨</span>
                <span className="sparkle">✨</span>
              </div>
            </div>
          </div>
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
                  fontSize: 'var(--font-sm, 10px)',
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
              {/* Pinned Tabs Section */}
              {tabs.filter(tab => tab.pinned).length > 0 && (
                <div>
                  <h3 style={{
                    fontSize: 'var(--font-sm, 10px)',
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
                  fontSize: 'var(--font-sm, 10px)',
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
                      <div style={{ fontSize: 'var(--font-sm, 10px)' }}>
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
                    fontSize: 'var(--font-sm, 10px)',
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
