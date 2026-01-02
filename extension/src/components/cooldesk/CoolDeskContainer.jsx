import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { WorkspaceCard, CreateWorkspaceCard } from './WorkspaceCard';
import { CoolSearch } from './CoolSearch';
import { QuickAccess } from './QuickAccess';
import { RecentChats } from './RecentChats';
import { NotesWidget } from './NotesWidget';
import { GlobalAddButton } from './GlobalAddButton';
import '../../styles/cooldesk.css';
import '../../styles/global-add.css';

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

  const WORKSPACES_PER_PAGE = 3;
  const totalPages = Math.ceil(savedWorkspaces.length / WORKSPACES_PER_PAGE);
  const startIdx = workspacePage * WORKSPACES_PER_PAGE;
  const displayedWorkspaces = savedWorkspaces.slice(startIdx, startIdx + WORKSPACES_PER_PAGE);

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

  return (
    <div className={`cooldesk-container ${themeClass}`} style={{
      position: 'relative'
    }}>
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

      {/* Header with Logo and Settings */}
      <div className="cooldesk-header">
        <div className="cooldesk-logo">
          <div className="cooldesk-logo-icon">🏢</div>
          <span>Cooldesk</span>
        </div>
        <button className="cooldesk-settings-btn" onClick={onOpenSettings} title="Settings">
          <FontAwesomeIcon icon={faGear} />
        </button>
      </div>

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
        {/* Notes Widget in 4th position */}
        <div className="cooldesk-workspace-card" style={{
          background: 'rgba(139, 92, 246, 0.15)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div className="workspace-card-header">
            <div className="workspace-icon purple">
              📝
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

      {/* Global Add Button */}
      <GlobalAddButton
        workspaces={savedWorkspaces}
        onCreateWorkspace={onCreateWorkspace}
        onAddUrlToWorkspace={onAddUrlToWorkspace}
        onAddNote={onAddNote}
      />
    </div>
  );
}
