import {
  faChevronLeft,
  faChevronRight,
  faFolder,
  faFolderOpen,
  faPlus,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';

export default function WorkspaceSidebar({
  workspaces = [],
  selectedId,
  onSelect,
  onCreateNew,
  onShowSuggestions,
  isSuggestionsMode = false
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="awm-sidebar awm-sidebar-collapsed">
        <button
          className="awm-sidebar-toggle"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
        <div className="awm-sidebar-icons">
          <button
            className={`awm-sidebar-icon-btn ${isSuggestionsMode ? 'selected' : ''}`}
            onClick={onShowSuggestions}
            title="AI Suggestions"
          >
            <FontAwesomeIcon icon={faWandMagicSparkles} />
          </button>
          {workspaces.slice(0, 7).map(workspace => (
            <button
              key={workspace.id}
              className={`awm-sidebar-icon-btn ${workspace.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(workspace)}
              title={workspace.name}
            >
              <FontAwesomeIcon icon={workspace.id === selectedId ? faFolderOpen : faFolder} />
            </button>
          ))}
          <button
            className="awm-sidebar-icon-btn awm-sidebar-icon-add"
            onClick={onCreateNew}
            title="Create new workspace"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="awm-sidebar">
      <div className="awm-sidebar-header">
        <span className="awm-sidebar-count">{workspaces.length} workspaces</span>
        <button
          className="awm-sidebar-toggle"
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      </div>

      {/* Workspace List */}
      <div className="awm-sidebar-list">
        {/* AI Suggestions entry — always at top, acts as "home" */}
        <button
          className={`awm-sidebar-item awm-sidebar-suggestions-item ${isSuggestionsMode ? 'selected' : ''}`}
          onClick={onShowSuggestions}
        >
          <FontAwesomeIcon icon={faWandMagicSparkles} className="awm-sidebar-item-icon-sm" />
          <span className="awm-sidebar-item-name">AI Suggestions</span>
        </button>

        {workspaces.map(workspace => {
          const isSelected = workspace.id === selectedId;
          return (
            <button
              key={workspace.id}
              className={`awm-sidebar-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(workspace)}
            >
              <FontAwesomeIcon
                icon={isSelected ? faFolderOpen : faFolder}
                className="awm-sidebar-item-icon-sm"
              />
              <span className="awm-sidebar-item-name">{workspace.name}</span>
              <span className="awm-sidebar-item-badge">{workspace.urls?.length || 0}</span>
            </button>
          );
        })}

        {workspaces.length === 0 && (
          <div className="awm-sidebar-empty">No workspaces yet</div>
        )}
      </div>

      {/* Create New Button */}
      <button className="awm-sidebar-create" onClick={onCreateNew}>
        <FontAwesomeIcon icon={faPlus} />
        <span>New</span>
      </button>
    </div>
  );
}
