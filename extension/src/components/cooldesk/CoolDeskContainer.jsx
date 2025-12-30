import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear } from '@fortawesome/free-solid-svg-icons';
import { WorkspaceCard, CreateWorkspaceCard } from './WorkspaceCard';
import { CoolSearch } from './CoolSearch';
import { QuickAccess } from './QuickAccess';
import { RecentChats } from './RecentChats';
import { NotesWidget } from './NotesWidget';
import '../../styles/cooldesk.css';

export function CoolDeskContainer({
  savedWorkspaces = [],
  onOpenWorkspace,
  onOpenAllWorkspace,
  onCreateWorkspace,
  onSearch,
  onOpenSettings,
}) {
  const [expandedWorkspace, setExpandedWorkspace] = useState(null);

  const handleWorkspaceClick = (workspace) => {
    if (expandedWorkspace?.id === workspace.id) {
      setExpandedWorkspace(null);
    } else {
      setExpandedWorkspace(workspace);
    }
    onOpenWorkspace?.(workspace);
  };

  const handleOpenAll = (workspace) => {
    onOpenAllWorkspace?.(workspace);
  };

  const handleCreateWorkspace = () => {
    onCreateWorkspace?.();
  };

  const handleSearch = (query) => {
    onSearch?.(query);
  };

  return (
    <div className="cooldesk-container">
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

      {/* Workspace Cards Grid - Show only first 3 + Notes */}
      <div className="cooldesk-workspaces">
        {savedWorkspaces.slice(0, 3).map((workspace) => (
          <WorkspaceCard
            key={workspace.id}
            workspace={workspace}
            onClick={handleWorkspaceClick}
            onOpenAll={handleOpenAll}
            isExpanded={expandedWorkspace?.id === workspace.id}
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
    </div>
  );
}
