import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faFolderOpen, faLink, faPlus } from '@fortawesome/free-solid-svg-icons';
import { getFaviconUrl } from '../../utils.js';

const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

const ICON_MAP = {
  folder: faFolder,
  'folder-open': faFolderOpen,
  link: faLink,
};

export function WorkspaceCard({ workspace, onClick, isExpanded = false }) {
  if (!workspace) return null;

  const { name, urls = [], description, icon = 'folder' } = workspace;
  const urlCount = urls.length;
  const colorClass = ICON_COLORS[Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const iconToUse = ICON_MAP[icon] || faFolder;

  const handleCardClick = () => {
    onClick?.(workspace);
  };

  // Always show first 3 links
  const displayLinks = urls.slice(0, 3);

  return (
    <div className="cooldesk-workspace-card" onClick={handleCardClick}>
      <div className="workspace-card-header">
        <div className={`workspace-icon ${colorClass}`}>
          <FontAwesomeIcon icon={iconToUse} />
        </div>
        <div className="workspace-info">
          <div className="workspace-name">{name}</div>
          <div className="workspace-count">{urlCount} URL{urlCount !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {displayLinks.length > 0 && (
        <ul className="workspace-links">
          {displayLinks.map((urlObj, idx) => {
            const faviconUrl = getFaviconUrl(urlObj.url, 16);
            return (
              <li
                key={idx}
                className="workspace-link-item"
                onClick={(e) => {
                  e.stopPropagation();
                  if (urlObj.url) {
                    window.open(urlObj.url, '_blank');
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <span className="workspace-link-icon">
                  {faviconUrl ? (
                    <img
                      src={faviconUrl}
                      alt=""
                      style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '2px',
                        objectFit: 'cover'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'inline';
                      }}
                    />
                  ) : null}
                  <FontAwesomeIcon
                    icon={faLink}
                    style={{ display: faviconUrl ? 'none' : 'inline' }}
                  />
                </span>
                <span className="workspace-link-text" title={urlObj.title || urlObj.url}>
                  {urlObj.title || new URL(urlObj.url).hostname}
                </span>
              </li>
            );
          })}
          {urls.length > 3 && (
            <li className="workspace-link-item" style={{ opacity: 0.6, fontStyle: 'italic' }}>
              <span className="workspace-link-text">
                +{urls.length - 3} more...
              </span>
            </li>
          )}
        </ul>
      )}

      {urlCount === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '20px',
          color: '#64748B',
          fontSize: '13px',
          fontStyle: 'italic'
        }}>
          No links yet. Click to add some!
        </div>
      )}
    </div>
  );
}

export function CreateWorkspaceCard({ onCreate }) {
  const handleClick = () => {
    onCreate?.();
  };

  return (
    <div className="workspace-create-btn" onClick={handleClick}>
      <div className="create-icon">
        <FontAwesomeIcon icon={faPlus} />
      </div>
      <div className="create-text">Create New Workspace</div>
    </div>
  );
}
