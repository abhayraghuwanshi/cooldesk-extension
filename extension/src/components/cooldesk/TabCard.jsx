import { faExternalLinkAlt, faGlobe, faThumbtack, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { getFaviconUrl } from '../../utils.js';

const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

/**
 * TabCard - Card component for displaying browser tabs in spatial interface
 * Follows WorkspaceCard design pattern with tab-specific features
 */
export function TabCard({ tab, onClick, onClose, onPin, isPinned = false, isActive = false }) {
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
    <div className={`cooldesk-tab-card ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}`} onClick={handleCardClick}>
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
}

/**
 * TabGroupCard - Card for displaying grouped tabs by domain
 */
export function TabGroupCard({ domain, tabs = [], onClick, isExpanded = false }) {
  if (!domain || tabs.length === 0) return null;

  const colorClass = ICON_COLORS[Math.abs(domain.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const faviconUrl = tabs[0]?.favIconUrl || getFaviconUrl(tabs[0]?.url, 16);

  const handleCardClick = () => {
    onClick?.(domain, tabs);
  };

  return (
    <div className={`cooldesk-tab-group-card ${isExpanded ? 'expanded' : ''}`} onClick={handleCardClick}>
      <div className="tab-group-header">
        <div className={`tab-group-icon ${colorClass}`}>
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
        <div className="tab-group-info">
          <div className="tab-group-domain">{domain}</div>
          <div className="tab-group-count">{tabs.length} tab{tabs.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {isExpanded && tabs.length > 0 && (
        <div className="tab-group-tabs">
          {tabs.slice(0, 5).map((tab, idx) => (
            <div
              key={idx}
              className="tab-group-item"
              onClick={(e) => {
                e.stopPropagation();
                if (tab.url) window.open(tab.url, '_blank');
              }}
              title={tab.title}
            >
              <span className="tab-group-item-icon">
                {tab.favIconUrl ? (
                  <img
                    src={tab.favIconUrl}
                    alt=""
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '3px',
                      objectFit: 'cover'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextElementSibling.style.display = 'inline';
                    }}
                  />
                ) : null}
                <FontAwesomeIcon
                  icon={faGlobe}
                  style={{ display: tab.favIconUrl ? 'none' : 'inline', fontSize: '10px' }}
                />
              </span>
              <span className="tab-group-item-text">
                {tab.title || 'Untitled'}
              </span>
            </div>
          ))}
          {tabs.length > 5 && (
            <div className="tab-group-item" style={{ opacity: 0.6, fontStyle: 'italic' }}>
              <span className="tab-group-item-text">
                +{tabs.length - 5} more...
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
