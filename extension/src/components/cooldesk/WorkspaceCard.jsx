import { faGithub } from '@fortawesome/free-brands-svg-icons';
import {
  faBook,
  faBriefcase,
  faChartLine,
  faCloud,
  faCode,
  faExternalLinkAlt,
  faFilm,
  faFlask,
  faFolder,
  faFolderOpen,
  faFutbol,
  faGamepad,
  faGraduationCap,
  faHashtag,
  faHeartPulse,
  faHome,
  faLightbulb,
  faLink,
  faMusic,
  faNewspaper,
  faPalette,
  faPlane,
  faPlus,
  faRobot,
  faSearch,
  faShoppingBag,
  faTasks,
  faTerminal,
  faThumbtack,
  faTools,
  faTrash,
  faUtensils,
  faVial,
  faVideo,
  faVrCardboard
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUrlAnalytics } from '../../db/index.js';
import { getBaseDomainFromUrl, getFaviconUrl } from '../../utils/helpers.js';
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
  utilities: faTools,
  github: faGithub,
  git: faGithub,
  dev: faCode,
  development: faCode,
  coding: faCode,
  code: faCode,
  terminal: faTerminal,
  ai: faRobot,
  gpt: faRobot,
  openai: faRobot,
  work: faBriefcase,
  business: faBriefcase,
  office: faBriefcase,
  personal: faHome,
  home: faHome,
  tasks: faTasks,
  management: faTasks,
  project: faTasks,
  design: faPalette,
  creative: faPalette,
  research: faSearch,
  google: faSearch,
  search: faSearch,
  spatial: faVrCardboard,
  cloud: faCloud,
  gaming: faGamepad,
  games: faGamepad,
  music: faMusic,
  video: faVideo,
  news: faNewspaper,
  reading: faBook,
  ideas: faLightbulb,
  test: faVial,
  lab: faFlask,
  cooldesk: faVrCardboard
};

// Memoized WorkspaceCard to prevent unnecessary re-renders
export const WorkspaceCard = memo(function WorkspaceCard({ workspace, onClick, isExpanded = false, isActive = false, compact = false, isPinned = false, onPin, onDelete, onAddUrl }) {
  if (!workspace) return null;

  const [popoverState, setPopoverState] = useState({ index: null, rect: null });
  const [hoveredLink, setHoveredLink] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const activePopover = popoverState.index;

  const { name, urls = [], description, icon = 'folder' } = workspace;
  const urlCount = urls.length;

  const colorClass = ICON_COLORS[Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const normalizedName = name.toLowerCase().trim();

  // Advanced category matching (checks if category key is contained in the name)
  const matchedCategory = Object.keys(CATEGORY_ICONS).find(cat =>
    normalizedName === cat || normalizedName.includes(cat + ' ') || normalizedName.includes(' ' + cat)
  );

  const categoryIcon = matchedCategory ? CATEGORY_ICONS[matchedCategory] : null;
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


  // State for sorted URLs based on usage
  const [sortedUrls, setSortedUrls] = useState(urls);
  const [isSorting, setIsSorting] = useState(false);

  // Effect to sort URLs by usage
  useEffect(() => {
    let isMounted = true;

    const sortUrlsByUsage = async () => {
      if (!urls || urls.length === 0) {
        if (isMounted) setSortedUrls([]);
        return;
      }

      setIsSorting(true);
      try {
        // Fetch analytics for all URLs in parallel
        const analyticsPromises = urls.map(async (urlObj) => {
          try {
            const response = await getUrlAnalytics(urlObj.url);
            const stats = response?.success ? response.data : null;
            return {
              ...urlObj,
              stats: stats || { totalVisits: 0, totalTime: 0, lastVisit: 0 }
            };
          } catch (error) {
            // console.error(`[WorkspaceCard] Error getting stats for "${urlObj.url}":`, error);
            return {
              ...urlObj,
              stats: { totalVisits: 0, totalTime: 0, lastVisit: 0 }
            };
          }
        });

        const urlsWithStats = await Promise.all(analyticsPromises);

        if (!isMounted) return;

        // Calculate scores and sort
        const sorted = urlsWithStats.sort((a, b) => {
          const scoreA = calculateUrlScore(a.stats);
          const scoreB = calculateUrlScore(b.stats);
          return scoreB - scoreA; // Descending order
        });

        if (isMounted) {
          setSortedUrls(sorted);
        }
      } catch (error) {
        console.error('[WorkspaceCard] Error sorting URLs:', error);
        // Fallback to original order
        if (isMounted) setSortedUrls(urls);
      } finally {
        if (isMounted) setIsSorting(false);
      }
    };

    // Score calculation helper
    const calculateUrlScore = (stats) => {
      const totalVisits = stats.totalVisits || 0;
      const timeInHours = (stats.totalTime || 0) / (1000 * 60 * 60);
      const mostRecentVisit = stats.lastVisit || 0;

      const recencyBonus = mostRecentVisit > 0
        ? Math.max(0, 100 - (Date.now() - mostRecentVisit) / (1000 * 60 * 60 * 24)) // Decay over days
        : 0;

      return (totalVisits * 10) + (timeInHours * 50) + recencyBonus;
    };

    // Debounce/Delay slightly to avoid blocking UI on mount
    const timeoutId = setTimeout(sortUrlsByUsage, 100);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [urls]); // Re-run if URLs change

  const [groupPopoverState, setGroupPopoverState] = useState({ group: null, rect: null });
  const [visibleCount, setVisibleCount] = useState(8);
  const iconsContainerRef = useRef(null);

  // Grouping Logic using PSL for proper base domain detection
  // Strategy: Group by base domain (company/org level)
  // e.g., dash.cloudflare.com, workers.cloudflare.com -> "Cloudflare"
  // e.g., console.firebase.google.com, docs.google.com -> "Google"
  const getGroupingInfo = (urlStr) => {
    try {
      const url = new URL(urlStr);
      const baseDomain = getBaseDomainFromUrl(urlStr);
      const pathParts = url.pathname.split('/').filter(Boolean);

      const formatLabel = (str) => str.charAt(0).toUpperCase() + str.slice(1);
      const baseName = baseDomain.split('.')[0];

      // GitHub: Group by owner (github.com/owner/...)
      if (baseDomain === 'github.com' && pathParts.length > 0) {
        const owner = pathParts[0];
        if (!['pulls', 'issues', 'marketplace', 'explore', 'settings', 'topics', 'notifications'].includes(owner)) {
          return {
            key: `github-${owner}`,
            label: owner,
            subLabel: 'GitHub',
            domain: baseDomain
          };
        }
      }

      // Linear: Group by workspace
      if (baseDomain === 'linear.app' && pathParts.length > 0) {
        return {
          key: `linear-${pathParts[0]}`,
          label: pathParts[0],
          subLabel: 'Linear',
          domain: baseDomain
        };
      }

      // Default: Group by base domain
      return {
        key: baseDomain,
        label: formatLabel(baseName),
        subLabel: null,
        domain: baseDomain
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
    // Use sortedUrls instead of urls
    sortedUrls.forEach(urlObj => {
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
              label: serviceName, // Just "Google" or "GitHub", not "Other Google"
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

      // Secondary sort by "primaryUrl" usage (which is already sorted implicitly by order of insertion if sortedUrls is sorted)
      // But groups insert order depends on first occurrence. 

      return 0;
    });
  }, [sortedUrls, compact]); // Depend on sortedUrls

  // Calculate how many items can fit in the available width
  const calculateVisibleItems = useCallback(() => {
    if (!iconsContainerRef.current || !compact) return;

    const container = iconsContainerRef.current;
    const containerWidth = container.offsetWidth;

    // Approximate widths: single icon ~44px (38px + 6px gap), group ~86px (80px + 6px gap)
    // Reserve ~45px for the "+N more" button
    const reservedWidth = 45;
    const availableWidth = containerWidth - reservedWidth;

    let usedWidth = 0;
    let count = 0;

    for (let i = 0; i < groupedItems.length; i++) {
      const item = groupedItems[i];
      const itemWidth = item.type === 'group' ? 100 : 54;

      if (usedWidth + itemWidth <= availableWidth) {
        usedWidth += itemWidth;
        count++;
      } else {
        break;
      }
    }

    // Show at least 1 item, max 8
    setVisibleCount(Math.max(1, Math.min(count, 8)));
  }, [groupedItems, compact]);

  // Recalculate on mount and resize
  useEffect(() => {
    if (!compact) return;

    calculateVisibleItems();

    const resizeObserver = new ResizeObserver(() => {
      calculateVisibleItems();
    });

    if (iconsContainerRef.current) {
      resizeObserver.observe(iconsContainerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [calculateVisibleItems, compact]);

  const handleCardClick = () => {
    onClick?.(workspace);
  };

  // Show fewer links in compact mode, unless expanded
  // Use sortedUrls for display
  const linkLimit = showAll ? sortedUrls.length : (compact ? 3 : 5);
  const displayLinks = sortedUrls.slice(0, linkLimit);

  return (
    <div
      className={`cooldesk-workspace-card ${isActive ? 'active' : ''} ${compact ? 'compact' : ''}`}
      onClick={handleCardClick}
      style={{ position: 'relative' }}
    >
      {compact ? (
        /* macOS Dock-Style List View - Using CSS Classes */
        <div className="compact-card-inner">
          {/* Workspace Icon on Left */}
          <div className={`compact-workspace-icon workspace-icon ${colorClass}`}>
            <FontAwesomeIcon icon={iconToUse} />
          </div>

          {/* Workspace Info */}
          <div className="compact-workspace-info">
            <div className="compact-workspace-name">{name}</div>
            <div className="compact-workspace-count">
              {urlCount} URL{urlCount !== 1 ? 's' : ''}
            </div>
          </div>

          {/* URL Favicons - Grouped */}
          {groupedItems.length > 0 && (
            <div ref={iconsContainerRef} className="compact-icons-container">
              {groupedItems.slice(0, visibleCount).map((item, idx) => {
                const isGroup = item.type === 'group';
                const url = isGroup ? item.primaryUrl : item.url;
                const faviconUrl = getFaviconUrl(url, 20);

                return (
                  <div
                    key={idx}
                    className={isGroup ? 'compact-url-group' : 'compact-url-icon'}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isGroup) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setGroupPopoverState({ group: item, rect });
                      } else {
                        window.open(item.url, '_blank');
                      }
                    }}
                    title={isGroup ? `${item.label} (${item.urls.length}) - ${item.subLabel || item.domain}` : (item.title || formatDomainName(item.url))}
                  >
                    {faviconUrl ? (
                      <img
                        src={faviconUrl}
                        alt=""
                        className="compact-item-img"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <FontAwesomeIcon
                      icon={faLink}
                      className="fallback-icon"
                      style={{ display: faviconUrl ? 'none' : 'flex' }}
                    />

                    {/* Pill Text Content */}
                    {isGroup && (
                      <div className="compact-group-text">
                        <div className="compact-group-label">{item.label}</div>
                        <div className="compact-group-count">{item.urls.length}</div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* +N More Indicator */}
              {groupedItems.length > visibleCount && (
                <div
                  className="compact-more-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const remainingItems = groupedItems.slice(visibleCount);
                    const flatUrls = [];
                    remainingItems.forEach(item => {
                      if (item.type === 'group') {
                        item.urls.forEach(u => flatUrls.push(u));
                      } else {
                        flatUrls.push(item);
                      }
                    });
                    setGroupPopoverState({
                      group: { domain: 'More Links', urls: flatUrls },
                      rect
                    });
                  }}
                >
                  +{groupedItems.length - visibleCount}
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

          {/* Add URL Button */}
          {onAddUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddUrl(workspace);
              }}
              className="compact-action-btn workspace-add-btn"
              title="Add URL"
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}

          {/* Pin Button */}
          {onPin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPin(workspace);
              }}
              className={`compact-action-btn pin-btn ${isPinned ? 'pinned' : ''}`}
              title={isPinned ? "Unpin Workspace" : "Pin Workspace"}
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
              className="compact-action-btn delete-btn"
              title="Delete Workspace"
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Add URL Button */}
              {onAddUrl && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddUrl(workspace);
                  }}
                  className="workspace-add-btn"
                  title="Add URL to Workspace"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(96, 165, 250, 0.6)',
                    cursor: 'pointer',
                    padding: '8px',
                    transition: 'all 0.2s ease',
                    opacity: 0,
                    fontSize: '14px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#60A5FA';
                    e.currentTarget.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(96, 165, 250, 0.6)';
                    e.currentTarget.style.opacity = '0';
                  }}
                >
                  <FontAwesomeIcon icon={faPlus} />
                </button>
              )}

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
                          className="link-favicon"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'inline';
                          }}
                        />
                      ) : null}
                      <FontAwesomeIcon
                        icon={faLink}
                        className="link-fallback-icon"
                        style={{ display: faviconUrl ? 'none' : 'inline' }}
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
                        height: '44px',
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
              {sortedUrls.length > (compact ? 3 : 5) && !showAll && (
                <li
                  className="workspace-link-item"
                  style={{ opacity: 0.6, fontStyle: 'italic', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAll(true);
                  }}
                >
                  <span className="workspace-link-text">
                    + {sortedUrls.length - (compact ? 3 : 5)} more items...
                  </span>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
});
