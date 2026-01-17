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
  faTrash,
  faUtensils
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useMemo, useState } from 'react';
import { getFaviconUrl } from '../../utils.js';
import { GroupedLinksPopover } from './GroupedLinksPopover.jsx';
import { UrlAnalyticsPopover } from './UrlAnalyticsPopover.jsx';

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

// Memoized WorkspaceCard to prevent unnecessary re-renders
export const WorkspaceCard = memo(function WorkspaceCard({ workspace, onClick, isExpanded = false, isActive = false, compact = false, isPinned = false, onPin, onDelete }) {
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


  const [groupPopoverState, setGroupPopoverState] = useState({ group: null, rect: null });

  // Advanced Grouping Logic
  const getGroupingInfo = (urlStr) => {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname;
      const domain = hostname.replace(/^www\./, '');
      const pathParts = url.pathname.split('/').filter(Boolean);

      // GitHub: Group by Owner (github.com/owner/...)
      if (domain === 'github.com' && pathParts.length > 0) {
        const owner = pathParts[0];
        // Filter out common non-user paths if needed, but usually 1st part is owner
        if (!['pulls', 'issues', 'marketplace', 'explore', 'settings', 'topics', 'notifications'].includes(owner)) {
          return {
            key: `github-${owner}`,
            label: owner,
            subLabel: 'GitHub',
            domain: 'github.com'
          };
        }
      }

      // Notion: Group by subdomain or path
      if (domain.includes('notion.site')) {
        const subdomain = domain.split('.')[0];
        return {
          key: `notion-${subdomain}`,
          label: subdomain,
          subLabel: 'Notion',
          domain: 'notion.so'
        };
      }

      // Linear
      if (domain === 'linear.app' && pathParts.length > 0) {
        return {
          key: `linear-${pathParts[0]}`,
          label: pathParts[0],
          subLabel: 'Linear',
          domain: 'linear.app'
        };
      }

      // Google Services (Catch-all for anything ending in google.com)
      if (domain.endsWith('.google.com') || domain === 'google.com') {
        // Extract service name from subdomain (e.g. "docs", "mail", "gemini")
        // If it's just google.com, label as Google
        const parts = domain.split('.');
        let service = parts.length > 2 ? parts[parts.length - 3] : 'Google'; // maps.google.com -> maps

        // Refine common service names
        if (service === 'www') service = 'Google';

        return {
          key: `google-${service}`,
          label: service.charAt(0).toUpperCase() + service.slice(1),
          subLabel: 'Google',
          domain: domain
        };
      }

      // Dropbox (dropbox.com, paper.dropbox.com)
      if (domain.endsWith('dropbox.com')) {
        return {
          key: 'dropbox',
          label: 'Dropbox',
          subLabel: 'Dropbox',
          domain: 'dropbox.com'
        };
      }

      // Telegram (t.me, telegram.org)
      if (domain === 't.me' || domain.endsWith('telegram.org')) {
        return {
          key: 'telegram',
          label: 'Telegram',
          subLabel: 'Telegram',
          domain: 'telegram.org'
        };
      }

      // Amazon (amazon.com, aws.amazon.com)
      if (domain.endsWith('amazon.com')) {
        return {
          key: 'amazon',
          label: 'Amazon',
          subLabel: 'Amazon',
          domain: 'amazon.com'
        };
      }

      // Microsoft (office.com, microsoft.com)
      if (domain.endsWith('microsoft.com') || domain.endsWith('office.com') || domain.endsWith('sharepoint.com')) {
        return {
          key: 'microsoft',
          label: 'Microsoft',
          subLabel: 'Microsoft',
          domain: 'microsoft.com'
        };
      }

      // Default: Group by Domain
      // Heuristic: If we can't identify the service, clear subLabel so it doesn't get grouped into "Other ..."
      // Unless we want to group all unknown "example.com" links? 
      // Current logic: entityGroups uses 'key' (domain). If >1, it groups.
      // If 1 item, it falls back to 'subLabel' or 'domain' for misc bucket.
      // So if we have 2 links to "random.com/a" and "random.com/b", key is "random.com", so they group.

      return {
        key: domain,
        label: formatDomainName(urlStr),
        subLabel: null, // Let domain grouping handle it
        domain: domain
      };

    } catch (e) {
      return { key: 'other', label: 'Other', subLabel: null, domain: 'unknown' };
    }
  };

  // Group URLs by domain/entity for compact view
  const groupedItems = useMemo(() => {
    if (!compact) return [];

    // 1. Bucket by specific Entity (Owner/Workspace)
    const entityGroups = {};
    urls.forEach(urlObj => {
      const info = getGroupingInfo(urlObj.url);
      if (!entityGroups[info.key]) {
        entityGroups[info.key] = {
          info,
          urls: []
        };
      }
      entityGroups[info.key].urls.push(urlObj);
    });

    const finalResult = [];
    const serviceMiscBuckets = {}; // Group remaining singletons by Service (e.g. "GitHub")

    // 2. Identify "Major" groups vs "Minor" items
    Object.values(entityGroups).forEach(group => {
      // If an entity has > 1 item, keep it as a dedicated stack.
      if (group.urls.length > 1) {
        finalResult.push({
          type: 'group',
          ...group.info,
          urls: group.urls,
          primaryUrl: group.urls[0].url
        });
      } else {
        // Collect for potential "Other Service" grouping
        const serviceName = group.info.subLabel || group.info.domain; // e.g. "GitHub" or "google.com"
        if (!serviceMiscBuckets[serviceName]) {
          serviceMiscBuckets[serviceName] = {
            info: {
              key: `misc-${serviceName}`,
              label: `Other ${serviceName}`,
              subLabel: serviceName, // Keep original service name
              domain: group.info.domain
            },
            urls: []
          };
        }
        serviceMiscBuckets[serviceName].urls.push(...group.urls);
      }
    });

    // 3. Process Misc Buckets
    Object.values(serviceMiscBuckets).forEach(bucket => {
      // If the misc bucket has multiple items, make it a stack
      if (bucket.urls.length > 1) {
        finalResult.push({
          type: 'group',
          ...bucket.info,
          urls: bucket.urls,
          primaryUrl: bucket.urls[0].url
        });
      } else {
        // Just one single item for this entire service? Show as single.
        bucket.urls.forEach(u => finalResult.push({ type: 'url', ...u }));
      }
    });

    return finalResult.sort((a, b) => {
      // Optional: Sort groups before singles?
      if (a.type === 'group' && b.type !== 'group') return -1;
      if (a.type !== 'group' && b.type === 'group') return 1;
      return 0;
    });
  }, [urls, compact]);

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

          {/* URL Favicons - Grouped */}
          {groupedItems.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flex: 1,
              overflow: 'hidden',
              paddingLeft: '12px'
            }}>
              {groupedItems.slice(0, 8).map((item, idx) => {
                const isGroup = item.type === 'group';
                const url = isGroup ? item.primaryUrl : item.url;
                const faviconUrl = getFaviconUrl(url, 20);

                return (
                  <div
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isGroup) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setGroupPopoverState({ group: item, rect });
                      } else {
                        window.open(item.url, '_blank');
                      }
                    }}
                    style={{
                      width: isGroup ? 'auto' : '45px',
                      minWidth: isGroup ? '90px' : '0',
                      maxWidth: isGroup ? '140px' : 'none',
                      height: '45px',
                      borderRadius: isGroup ? '12px' : '8px',
                      background: isGroup ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)',
                      border: isGroup ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(59, 130, 246, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: isGroup ? 'flex-start' : 'center',
                      padding: isGroup ? '0 10px 0 6px' : '0',
                      gap: isGroup ? '8px' : '0',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      flexShrink: 0,
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                      e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isGroup ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)';
                      e.currentTarget.style.transform = 'translateY(0) scale(1)';
                    }}
                    title={isGroup ? `${item.label} (${item.urls.length}) - ${item.subLabel || item.domain}` : (item.title || formatDomainName(item.url))}
                  >
                    {faviconUrl ? (
                      <img
                        src={faviconUrl}
                        alt=""
                        style={{
                          width: isGroup ? '24px' : '40px',
                          height: isGroup ? '24px' : '40px',
                          borderRadius: '4px',
                          objectFit: 'cover',
                          opacity: isGroup ? 1 : 1
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'inline';
                        }}
                      />
                    ) : null}
                    <FontAwesomeIcon
                      icon={faLink}
                      style={{ display: faviconUrl ? 'none' : 'inline', fontSize: isGroup ? '14px' : '14px', color: '#60a5fa' }}
                    />

                    {/* Pill Text Content */}
                    {isGroup && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        justifyContent: 'center'
                      }}>
                        <div style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#F1F5F9',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: '1.2'
                        }}>
                          {item.label}
                        </div>
                        <div style={{
                          fontSize: '9px',
                          color: '#94A3B8',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: '1.2'
                        }}>
                          {item.urls.length} items
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* +N More Indicator */}
              {groupedItems.length > 5 && (
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
                    flexShrink: 0
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Open a popover with the remaining items
                    const rect = e.currentTarget.getBoundingClientRect();
                    const remainingItems = groupedItems.slice(5);

                    // Flatten remaining items if they include groups, for the simple list view
                    // Or keep them as groups? GroupedLinksPopover expects a 'group' object with 'urls'.
                    // We need to construct a flat list of simple url objects for the standard popover view

                    const flatUrls = [];
                    remainingItems.forEach(item => {
                      if (item.type === 'group') {
                        item.urls.forEach(u => flatUrls.push(u));
                      } else {
                        flatUrls.push(item);
                      }
                    });

                    setGroupPopoverState({
                      group: {
                        domain: 'More Links',
                        urls: flatUrls
                      },
                      rect
                    });
                  }}
                >
                  +{groupedItems.length - 5}
                </div>
              )}
            </div>
          )}

          {/* Render Group Popover if Active */}
          {groupPopoverState.group && (
            <GroupedLinksPopover
              group={groupPopoverState.group}
              triggerRect={groupPopoverState.rect}
              onClose={() => setGroupPopoverState({ group: null, rect: null })}
            />
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
                opacity: 0,
                fontSize: '14px',
                flexShrink: 0
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#FDE047';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = isPinned ? '#FDE047' : 'rgba(148, 163, 184, 0.4)';
                e.currentTarget.style.opacity = '0';
              }}
            >
              <FontAwesomeIcon icon={faThumbtack} transform={isPinned ? "" : { rotate: 45 }} />
            </button>
          )}

          {/* Delete Button - Show on Hover */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(workspace);
              }}
              className="workspace-delete-btn"
              title="Delete Workspace"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(239, 68, 68, 0.4)',
                cursor: 'pointer',
                padding: '8px',
                transition: 'all 0.2s ease',
                opacity: 0,
                fontSize: '14px',
                flexShrink: 0
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#EF4444';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(239, 68, 68, 0.4)';
                e.currentTarget.style.opacity = '0';
              }}
            >
              <FontAwesomeIcon icon={faTrash} />
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
                  opacity: 0,
                  fontSize: '14px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#FDE047';
                  e.currentTarget.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = isPinned ? '#FDE047' : 'rgba(148, 163, 184, 0.4)';
                  e.currentTarget.style.opacity = '0';
                }}
              >
                <FontAwesomeIcon icon={faThumbtack} transform={isPinned ? "" : { rotate: 45 }} />
              </button>
            )}

            {/* Delete Button */}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(workspace);
                }}
                className="workspace-delete-btn"
                title="Delete Workspace"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(239, 68, 68, 0.4)',
                  cursor: 'pointer',
                  padding: '8px',
                  transition: 'all 0.2s ease',
                  opacity: 0,
                  fontSize: '14px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#EF4444';
                  e.currentTarget.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'rgba(239, 68, 68, 0.4)';
                  e.currentTarget.style.opacity = '0';
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
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
});

// Memoized CreateWorkspaceCard
export const CreateWorkspaceCard = memo(function CreateWorkspaceCard({ onCreate }) {
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
});
