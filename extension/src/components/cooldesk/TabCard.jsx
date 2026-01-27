
import { faChevronDown, faExternalLinkAlt, faGlobe, faThumbtack, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo } from 'react';
import { getFaviconUrl } from '../../utils/helpers.js';
const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

/**
 * TabCard - Card component for displaying browser tabs in spatial interface
 * Follows WorkspaceCard design pattern with tab-specific features
 * Memoized to prevent unnecessary re-renders
 */
export const TabCard = memo(function TabCard({ tab, onClick, onClose, onPin, isPinned = false, isActive = false, isLastActive = false }) {
  if (!tab) return null;

  const { url, title, favIconUrl } = tab;
  const hostname = url ? new URL(url).hostname : 'Unknown';
  const colorClass = ICON_COLORS[Math.abs(hostname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const faviconUrl = favIconUrl || getFaviconUrl(url, 16);

  const handleCardClick = () => {
    onClick?.(tab);
  };

  const handleClose = (e) => {
    e.stopPropagation();
    onClose?.(tab);
  };

  const handlePin = (e) => {
    e.stopPropagation();
    onPin?.(tab);
  };

  return (
    <div className={`cooldesk-tab-card ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${isLastActive ? 'last-active' : ''}`} onClick={handleCardClick}>
      {/* Last active indicator badge */}
      {isLastActive && !isActive && (
        <div className="tab-recent-badge" title="Most recently used">
          <FontAwesomeIcon icon={faExternalLinkAlt} style={{ fontSize: '10px' }} />
          <span>Recent</span>
        </div>
      )}
      {/* Pinned indicator badge */}
      {isPinned && (
        <div className="tab-pinned-badge">
          <FontAwesomeIcon icon={faThumbtack} />
        </div>
      )}

      <div className="tab-card-header">
        <div className={`tab-icon ${colorClass}`}>
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                objectFit: 'cover'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextElementSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <FontAwesomeIcon
            icon={faGlobe}
            style={{ display: faviconUrl ? 'none' : 'flex' }}
          />
        </div>
        <div className="tab-info">
          <div className="tab-title" title={title}>
            {title || 'Untitled Tab'}
          </div>
          <div className="tab-hostname">{hostname}</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="tab-actions">
        <button
          className="tab-action-btn pin-btn"
          onClick={handlePin}
          title={isPinned ? 'Unpin tab' : 'Pin tab'}
        >
          <FontAwesomeIcon icon={faThumbtack} />
        </button>
        <button
          className="tab-action-btn open-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (url) window.open(url, '_blank');
          }}
          title="Open in new tab"
        >
          <FontAwesomeIcon icon={faExternalLinkAlt} />
        </button>
        <button
          className="tab-action-btn close-btn"
          onClick={handleClose}
          title="Close tab"
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>
      </div>
    </div>
  );
});

/**
 * TabGroupCard - Card for displaying grouped tabs by domain
 * Memoized to prevent unnecessary re-renders
 */
export const TabGroupCard = memo(function TabGroupCard({ domain, tabs = [], onToggleExpand, onTabClick, onTabClose, isExpanded = false }) {
  if (!domain || tabs.length === 0) return null;

  const topTab = tabs[0];
  const colorClass = ICON_COLORS[Math.abs(domain.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  // Use top tab's favicon
  const faviconUrl = topTab?.favIconUrl || getFaviconUrl(topTab?.url, 16);

  // Primary action: Open the top tab (only on header click)
  const handleHeaderClick = (e) => {
    e.stopPropagation();
    onTabClick?.(topTab);
  };

  // Secondary action: Toggle group expansion
  const handleExpandClick = (e) => {
    e.stopPropagation();
    onToggleExpand?.();
  };

  return (
    <div className={`cooldesk-tab-group-card ${isExpanded ? 'expanded' : ''}`}>
      {/* Tab count badge - positioned top right */}
      <div className="tab-group-count-badge">
        <span>{tabs.length}</span>
      </div>

      <div className="tab-group-header" onClick={handleHeaderClick} style={{ cursor: 'pointer' }}>
        <div className={`tab-group-icon ${colorClass}`}>
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextElementSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <FontAwesomeIcon
            icon={faGlobe}
            style={{ display: faviconUrl ? 'none' : 'flex' }}
          />
        </div>
        <div className="tab-group-info">
          <div className="tab-group-domain">
            {domain}
          </div>
          <div className="tab-group-subtitle">
            {topTab.title || 'Untitled'}
          </div>
        </div>
      </div>

      {/* Expand/Collapse toggle bar */}
      <button
        className={`tab-group-expand-btn ${isExpanded ? 'expanded' : ''}`}
        onClick={handleExpandClick}
        title={isExpanded ? "Collapse group" : "Show all tabs"}
      >
        <span className="expand-btn-text">
          {isExpanded ? 'Hide tabs' : `Show ${tabs.length} tabs`}
        </span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className="expand-btn-icon"
        />
      </button>

      {isExpanded && tabs.length > 0 && (
        <div className="tab-group-tabs">
          {tabs.map((tab, idx) => {
            const isTop = tab.id === topTab.id;
            return (
              <div
                key={tab.id || idx}
                className={`tab-group-item ${isTop ? 'is-top' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClick?.(tab);
                }}
                title={tab.title}
              >
                <span className="tab-group-item-icon">
                  {tab.favIconUrl ? (
                    <img
                      src={tab.favIconUrl}
                      alt=""
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'inline';
                      }}
                    />
                  ) : null}
                  <FontAwesomeIcon
                    icon={faGlobe}
                    style={{ display: tab.favIconUrl ? 'none' : 'inline' }}
                  />
                </span>
                <span className="tab-group-item-text">
                  {tab.title || 'Untitled'}
                </span>
                {isTop && <span className="tab-group-item-badge">Current</span>}
                <button
                  className="tab-group-item-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose?.(tab);
                  }}
                  title="Close tab"
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
