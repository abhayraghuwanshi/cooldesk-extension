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

  // Helper function to format domain name like mobile apps
  const formatDomainName = (url) => {
    try {
      const hostname = new URL(url).hostname;
      // Remove www. prefix
      let domain = hostname.replace(/^www\./, '');

      // Remove common TLDs (.com, .in, .org, .net, .io, etc.)
      domain = domain.replace(/\.(com|in|org|net|io|co|edu|gov|mil|int|info|biz|me|app|dev|tech|ai|xyz)$/i, '');

      // Handle subdomains (e.g., brad-carter.medium.com -> Brad Carter)
      const parts = domain.split('.');
      if (parts.length > 1) {
        // Take the subdomain part (e.g., 'brad-carter' from 'brad-carter.medium')
        domain = parts[0];
      }

      // Replace hyphens and underscores with spaces
      domain = domain.replace(/[-_]/g, ' ');

      // Capitalize each word
      domain = domain.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      return domain;
    } catch (e) {
      return url;
    }
  };

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
      {compact ? (
        /* macOS Dock-Style List View */
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          width: '100%'
        }}>
          {/* Workspace Icon on Left */}
          <div className={`workspace-icon ${colorClass}`} style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            flexShrink: 0
          }}>
            <FontAwesomeIcon icon={iconToUse} />
          </div>

          {/* Workspace Info */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: '120px',
            flexShrink: 0
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#F1F5F9',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {name}
            </div>
            <div style={{
              fontSize: '11px',
              color: '#94A3B8',
              whiteSpace: 'nowrap'
            }}>
              {urlCount} URL{urlCount !== 1 ? 's' : ''}
            </div>
          </div>

          {/* URL Favicons - Up to 10 */}
          {urls.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flex: 1,
              overflow: 'hidden',
              paddingLeft: '12px'
            }}>
              {urls.slice(0, 10).map((urlObj, idx) => {
                const faviconUrl = getFaviconUrl(urlObj.url, 20);
                return (
                  <div
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(urlObj.url, '_blank');
                    }}
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '8px',
                      background: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                      e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.15)';
                      e.currentTarget.style.transform = 'translateY(0) scale(1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title={urlObj.title || formatDomainName(urlObj.url)}
                  >
                    {faviconUrl ? (
                      <img
                        src={faviconUrl}
                        alt=""
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '4px',
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
                      style={{ display: faviconUrl ? 'none' : 'inline', fontSize: '14px', color: '#60a5fa' }}
                    />
                  </div>
                );
              })}

              {/* +N More Indicator */}
              {urls.length > 10 && (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    background: 'rgba(148, 163, 184, 0.1)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#94A3B8',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick?.(workspace);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(148, 163, 184, 0.2)';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)';
                    e.currentTarget.style.color = '#CBD5E1';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                    e.currentTarget.style.color = '#94A3B8';
                  }}
                  title="Click to expand and see all URLs"
                >
                  +{urls.length - 10}
                </div>
              )}
            </div>
          )}

          {/* Pin Button - Show on Hover */}
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
                opacity: isPinned ? 1 : 0,
                fontSize: '14px',
                flexShrink: 0
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
                  e.currentTarget.style.opacity = '0';
                }
              }}
            >
              <FontAwesomeIcon icon={faThumbtack} transform={isPinned ? "" : { rotate: 45 }} />
            </button>
          )}
        </div>
      ) : (
        /* Original Grid View */
        <>
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
                    <span className="workspace-link-text" title={urlObj.url}>
                      {(() => {
                        // If title exists and is different from the hostname, use it
                        // Otherwise use formatted domain name
                        const hostname = new URL(urlObj.url).hostname;
                        const title = urlObj.title;

                        // Check if title is just the domain/hostname (common case)
                        if (!title || title === hostname || title === hostname.replace(/^www\./, '') || title.endsWith('.com') || title.endsWith('.in') || title.endsWith('.org') || title.endsWith('.net') || title.endsWith('.io')) {
                          return formatDomainName(urlObj.url);
                        }

                        return title;
                      })()}
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
        </>
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
