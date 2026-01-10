import {
  faChartLine,
  faExternalLinkAlt,
  faFilm,
  faFolder,
  faFolderOpen,
  faFutbol,
  faGraduationCap,
  faHashtag,
  faHeartPulse,
  faLink,
  faPlane,
  faPlus,
  faShoppingBag,
  faThumbtack,
  faTools,
  faUtensils
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { getFaviconUrl } from '../../utils.js';

const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

const ICON_MAP = {
  folder: faFolder,
  'folder-open': faFolderOpen,
  link: faLink,
};

const CATEGORY_ICONS = {
  finance: faChartLine,
  health: faHeartPulse,
  education: faGraduationCap,
  sports: faFutbol,
  social: faHashtag,
  travel: faPlane,
  entertainment: faFilm,
  shopping: faShoppingBag,
  food: faUtensils,
  utilities: faTools
};

import { useState } from 'react';
import { UrlAnalyticsPopover } from './UrlAnalyticsPopover.jsx';

export function WorkspaceCard({ workspace, onClick, isExpanded = false, isActive = false, compact = false, isPinned = false, onPin }) {
  if (!workspace) return null;

  const [popoverState, setPopoverState] = useState({ index: null, rect: null });
  const [hoveredLink, setHoveredLink] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const activePopover = popoverState.index;

  const { name, urls = [], description, icon = 'folder' } = workspace;
  const urlCount = urls.length;

  const colorClass = ICON_COLORS[Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const normalizedName = name.toLowerCase();
  const categoryIcon = CATEGORY_ICONS[normalizedName];
  const iconToUse = categoryIcon || (isActive ? faFolderOpen : (ICON_MAP[icon] || faFolder));

  const handleCardClick = () => {
    onClick?.(workspace);
  };

  // Show fewer links in compact mode, unless expanded
  const linkLimit = showAll ? urls.length : (compact ? 3 : 5);
  const displayLinks = urls.slice(0, linkLimit);

  return (
    <div
      className={`cooldesk-workspace-card ${isActive ? 'active' : ''} ${compact ? 'compact' : ''}`}
      onClick={handleCardClick}
      style={{ position: 'relative' }}
    >
      <div className="workspace-card-header">
        <div className={`workspace-icon ${colorClass}`}>
          <FontAwesomeIcon icon={iconToUse} />
        </div>
        <div className="workspace-info">
          <div className="workspace-name">{name}</div>
          <div className="workspace-count">{urlCount} URL{urlCount !== 1 ? 's' : ''}</div>
        </div>

        {/* Pin Button */}
        {onPin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin(workspace);
            }}
            className={`workspace-pin-btn ${isPinned ? 'pinned' : ''}`}
            title={isPinned ? "Unpin Workspace" : "Pin Workspace"}
            style={{
              background: 'transparent',
              border: 'none',
              color: isPinned ? '#FDE047' : 'rgba(148, 163, 184, 0.4)',
              cursor: 'pointer',
              padding: '8px',
              marginLeft: 'auto',
              transition: 'all 0.2s ease',
              opacity: isPinned ? 1 : 0.6,
              fontSize: '14px'
            }}
            onMouseEnter={(e) => {
              if (!isPinned) {
                e.currentTarget.style.color = '#FDE047';
                e.currentTarget.style.opacity = '1';
              }
            }}
            onMouseLeave={(e) => {
              if (!isPinned) {
                e.currentTarget.style.color = 'rgba(148, 163, 184, 0.4)';
                e.currentTarget.style.opacity = '0.6';
              }
            }}
          >
            <FontAwesomeIcon icon={faThumbtack} transform={isPinned ? "" : { rotate: 45 }} />
          </button>
        )}
      </div>

      {displayLinks.length > 0 && (
        <ul className="workspace-links">
          {displayLinks.map((urlObj, idx) => {
            const faviconUrl = getFaviconUrl(urlObj.url, 16);
            const isHovered = hoveredLink === idx;
            const isPopoverOpen = activePopover === idx;

            return (
              <li
                key={idx}
                className="workspace-link-item"
                onMouseEnter={() => setHoveredLink(idx)}
                onMouseLeave={() => {
                  setHoveredLink(null);
                  setPopoverState({ index: null, rect: null });
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (urlObj.url) {
                    window.open(urlObj.url, '_blank');
                  }
                }}
                style={{ cursor: 'pointer', position: 'relative' }}
              >
                <span className="workspace-link-icon">
                  {faviconUrl ? (
                    <img
                      src={faviconUrl}
                      alt=""
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '3px',
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
                    style={{ display: faviconUrl ? 'none' : 'inline', fontSize: '12px' }}
                  />
                </span>
                <span className="workspace-link-text" title={urlObj.title || urlObj.url}>
                  {urlObj.title || new URL(urlObj.url).hostname}
                </span>

                {/* Analytics Trigger */}
                <span
                  className="workspace-link-analytics"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.stopPropagation(); // Double stop just in case
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPopoverState(prev => prev.index === idx ? { index: null, rect: null } : { index: idx, rect });
                  }}
                  style={{
                    padding: '4px 6px',
                    fontSize: '11px',
                    color: isPopoverOpen ? '#60A5FA' : 'rgba(148, 163, 184, 0.5)',
                    opacity: (isHovered || isPopoverOpen) ? 1 : 0,
                    transition: 'all 0.2s',
                    marginRight: '4px',
                    pointerEvents: (isHovered || isPopoverOpen) ? 'auto' : 'none'
                  }}
                  title="View Analytics"
                >
                  <FontAwesomeIcon icon={faChartLine} />
                </span>

                <FontAwesomeIcon
                  icon={faExternalLinkAlt}
                  className="workspace-link-external"
                />

                {/* Analytics Popover */}
                {isPopoverOpen && (
                  <UrlAnalyticsPopover
                    url={urlObj.url}
                    title={urlObj.title}
                    onClose={() => setPopoverState({ index: null, rect: null })}
                    triggerRect={popoverState.rect}
                  />
                )}
              </li>
            );
          })}
          {urls.length > (compact ? 3 : 5) && !showAll && (
            <li
              className="workspace-link-item"
              style={{ opacity: 0.6, fontStyle: 'italic', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                setShowAll(true);
              }}
            >
              <span className="workspace-link-text">
                +{urls.length - (compact ? 3 : 5)} more...
              </span>
            </li>
          )}
          {showAll && urls.length > (compact ? 3 : 5) && (
            <li
              className="workspace-link-item"
              style={{ opacity: 0.6, fontStyle: 'italic', cursor: 'pointer', justifyContent: 'center' }}
              onClick={(e) => {
                e.stopPropagation();
                setShowAll(false);
              }}
            >
              <span className="workspace-link-text">
                Show less
              </span>
            </li>
          )}
        </ul>
      )}

      {urlCount === 0 && !compact && (
        <div className="workspace-empty-state">
          <div className="empty-icon">
            <FontAwesomeIcon icon={faLink} />
          </div>
          <p>No links yet</p>
          <span>Use the + button to add URLs</span>
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
