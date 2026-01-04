import { faCheck, faExternalLinkAlt, faFolder, faFolderOpen, faLink, faPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { getFaviconUrl } from '../../utils.js';

const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

const ICON_MAP = {
  folder: faFolder,
  'folder-open': faFolderOpen,
  link: faLink,
};

export function WorkspaceCard({ workspace, onClick, isExpanded = false, isActive = false }) {
  if (!workspace) return null;

  const { name, urls = [], description, icon = 'folder' } = workspace;
  const urlCount = urls.length;
  const colorClass = ICON_COLORS[Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const iconToUse = isActive ? faFolderOpen : (ICON_MAP[icon] || faFolder);

  const handleCardClick = () => {
    onClick?.(workspace);
  };

  // Show first 5 links (more space now without Add URL button)
  const displayLinks = urls.slice(0, 5);

  return (
    <div className={`cooldesk-workspace-card ${isActive ? 'active' : ''}`} onClick={handleCardClick}>
      {/* Active indicator badge */}
      {isActive && (
        <div className="workspace-active-badge">
          <FontAwesomeIcon icon={faCheck} />
          <span>Active</span>
        </div>
      )}

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
                <FontAwesomeIcon
                  icon={faExternalLinkAlt}
                  className="workspace-link-external"
                />
              </li>
            );
          })}
          {urls.length > 5 && (
            <li className="workspace-link-item" style={{ opacity: 0.6, fontStyle: 'italic' }}>
              <span className="workspace-link-text">
                +{urls.length - 5} more...
              </span>
            </li>
          )}
        </ul>
      )}

      {urlCount === 0 && (
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
