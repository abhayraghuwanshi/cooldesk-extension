import { faGithub } from '@fortawesome/free-brands-svg-icons';
import {
  faBook,
  faBriefcase,
  faChartLine,
  faCheckCircle,
  faChevronDown,
  faChevronUp,
  faCloud,
  faCode,
  faDesktop,
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
  faTimesCircle,
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
import { recordFeedbackEvent, recordUrlWorkspace } from '../../services/feedbackService.js';
import { getBaseDomainFromUrl, getFaviconUrl, safeGetHostname } from '../../utils/helpers.js';
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

// Helper to open URLs - works in both extension and Electron modes
const openUrl = (url, workspaceName, title) => {
  if (!url) return;

  // Record feedback for RAG learning (fire-and-forget)
  recordFeedbackEvent({
    suggestionType: 'url_to_workspace',
    action: 'accepted',
    suggestionContent: url,
    contextWorkspace: workspaceName
  }).catch(() => {});

  // Also record URL-workspace association for pattern learning
  if (workspaceName) {
    recordUrlWorkspace(url, title || url, workspaceName).catch(() => {});
  }

  // Prefer chrome.tabs.create for extensions (more reliable, no popup blocker)
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url });
  } else {
    // Fallback for Electron or other environments
    window.open(url, '_blank');
  }
};

// Memoized WorkspaceCard to prevent unnecessary re-renders
export const WorkspaceCard = memo(function WorkspaceCard({ workspace, onClick, isExpanded = false, isActive = false, compact = false, isPinned = false, onPin, onDelete, onAddUrl, onUrlAction, deferAnalytics = false, ...rest }) {
  if (!workspace) return null;

  const [popoverState, setPopoverState] = useState({ index: null, rect: null });
  const [hoveredLink, setHoveredLink] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const activePopover = popoverState.index;

  const { name, urls = [], apps = [], description, icon = 'folder' } = workspace;
  const urlCount = urls.length;
  const appCount = apps.length;
  const totalCount = urlCount + appCount;

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
      const hostname = safeGetHostname(url);
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

  // Generate letter avatar with consistent color based on domain
  const getLetterAvatar = (url) => {
    try {
      const hostname = safeGetHostname(url).replace(/^www\./, '');
      const firstLetter = hostname.charAt(0).toUpperCase();

      // Generate consistent color from hostname
      let hash = 0;
      for (let i = 0; i < hostname.length; i++) {
        hash = hostname.charCodeAt(i) + ((hash << 5) - hash);
      }

      // Vibrant color palette for better visibility
      const colors = [
        '#3B82F6', // blue
        '#8B5CF6', // purple
        '#EC4899', // pink
        '#EF4444', // red
        '#F97316', // orange
        '#EAB308', // yellow
        '#22C55E', // green
        '#14B8A6', // teal
        '#06B6D4', // cyan
        '#6366F1', // indigo
      ];

      const colorIndex = Math.abs(hash) % colors.length;
      return { letter: firstLetter, color: colors[colorIndex] };
    } catch {
      return { letter: '?', color: '#64748B' };
    }
  };

  // Generate a hash for the URLs to detect changes
  const urlsHash = useMemo(() => {
    return urls.map(u => u.url).join(',');
  }, [urls]);

  // Cache key for this workspace's sorted URLs with analytics
  const cacheKey = `cooldesk_urls_analytics_${workspace.id}`;
  const cacheHashKey = `cooldesk_urls_analytics_hash_${workspace.id}`;
  const cacheTimeKey = `cooldesk_urls_analytics_time_${workspace.id}`;

  // Score calculation helper (defined early so it can be used in useState initializer)
  const calculateUrlScore = (stats) => {
    const totalVisits = stats.totalVisits || 0;
    const timeInHours = (stats.totalTime || 0) / (1000 * 60 * 60);
    const mostRecentVisit = stats.lastVisit || 0;

    const recencyBonus = mostRecentVisit > 0
      ? Math.max(0, 100 - (Date.now() - mostRecentVisit) / (1000 * 60 * 60 * 24))
      : 0;

    return (totalVisits * 10) + (timeInHours * 50) + recencyBonus;
  };

  // State for sorted URLs based on usage
  // Load from cache synchronously to prevent layout shift
  const [sortedUrls, setSortedUrls] = useState(() => {
    try {
      const cachedHash = localStorage.getItem(cacheHashKey);
      if (cachedHash === urlsHash) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached); // Array of {url, title, stats} objects
          // Merge cached analytics with current URL data
          const urlMap = new Map(urls.map(u => [u.url, u]));
          const sorted = cachedData
            .map(cached => {
              const current = urlMap.get(cached.url);
              return current ? { ...current, stats: cached.stats } : null;
            })
            .filter(Boolean);
          // Add any new URLs not in cache at the end
          const cachedSet = new Set(cachedData.map(c => c.url));
          urls.forEach(u => {
            if (!cachedSet.has(u.url)) {
              sorted.push({ ...u, stats: { totalVisits: 0, totalTime: 0, lastVisit: 0 } });
            }
          });
          return sorted;
        }
      }
    } catch { /* ignore */ }
    return urls;
  });
  const [isSorting, setIsSorting] = useState(false);

  // Effect to sort URLs by usage - refresh analytics periodically
  // Uses requestIdleCallback to avoid blocking the main thread
  useEffect(() => {
    let isMounted = true;
    let idleCallbackId = null;

    const sortUrlsByUsage = async () => {
      if (!urls || urls.length === 0) {
        if (isMounted) setSortedUrls([]);
        return;
      }

      // Check if cache is still valid (same URLs and less than 5 minutes old)
      try {
        const cachedHash = localStorage.getItem(cacheHashKey);
        const cachedTime = parseInt(localStorage.getItem(cacheTimeKey) || '0', 10);
        const cacheAge = Date.now() - cachedTime;
        const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

        if (cachedHash === urlsHash && cacheAge < CACHE_TTL) {
          // Cache is valid and fresh, no need to re-fetch
          return;
        }
      } catch { /* ignore */ }

      // If deferAnalytics is true, skip fetching entirely on initial render
      // This prevents INP issues when many cards mount at once
      if (deferAnalytics) {
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
            return {
              ...urlObj,
              stats: { totalVisits: 0, totalTime: 0, lastVisit: 0 }
            };
          }
        });

        const urlsWithStats = await Promise.all(analyticsPromises);

        if (!isMounted) return;

        // Calculate scores and sort
        const sorted = [...urlsWithStats].sort((a, b) => {
          const scoreA = calculateUrlScore(a.stats);
          const scoreB = calculateUrlScore(b.stats);
          return scoreB - scoreA; // Descending order
        });

        if (isMounted) {
          setSortedUrls(sorted);
          // Cache the sorted URLs with their full analytics data
          try {
            const cacheData = sorted.map(u => ({
              url: u.url,
              title: u.title,
              stats: u.stats
            }));
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
            localStorage.setItem(cacheHashKey, urlsHash);
            localStorage.setItem(cacheTimeKey, Date.now().toString());
          } catch { /* ignore */ }
        }
      } catch (error) {
        console.error('[WorkspaceCard] Error sorting URLs:', error);
        if (isMounted) setSortedUrls(urls);
      } finally {
        if (isMounted) setIsSorting(false);
      }
    };

    // Use requestIdleCallback to defer analytics loading when browser is idle
    // This prevents blocking the main thread during interactions
    const scheduleSort = () => {
      if (window.requestIdleCallback) {
        idleCallbackId = window.requestIdleCallback(
          () => sortUrlsByUsage(),
          { timeout: 2000 } // Max wait 2 seconds
        );
      } else {
        // Fallback: use setTimeout with longer delay
        idleCallbackId = setTimeout(sortUrlsByUsage, 200);
      }
    };

    scheduleSort();

    return () => {
      isMounted = false;
      if (idleCallbackId) {
        if (window.cancelIdleCallback) {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          clearTimeout(idleCallbackId);
        }
      }
    };
  }, [urls, urlsHash, deferAnalytics]); // Re-run if URLs change

  const [groupPopoverState, setGroupPopoverState] = useState({ group: null, rect: null });
  const [visibleCount, setVisibleCount] = useState(8);
  const iconsContainerRef = useRef(null);

  // Grouping Logic using PSL for proper base domain detection
  // Strategy: Group by base domain (company/org level)
  // e.g., dash.cloudflare.com, workers.cloudflare.com -> "Cloudflare"
  // e.g., console.firebase.google.com, docs.google.com -> "Google"
  const getGroupingInfo = (urlStr) => {
    try {
      // Ensure URL has protocol for parsing
      const urlWithProtocol = urlStr.startsWith('http://') || urlStr.startsWith('https://')
        ? urlStr
        : `https://${urlStr}`;
      const url = new URL(urlWithProtocol);
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
    let containerWidth = container.offsetWidth;

    // Account for padding
    const computedStyle = window.getComputedStyle(container);
    containerWidth -= (parseFloat(computedStyle.paddingLeft || '0') + parseFloat(computedStyle.paddingRight || '0'));

    if (containerWidth <= 0) return;

    // Use dynamic measurements if available to be 100% accurate across all screen resolutions
    const sampleItem = container.querySelector('.compact-url-icon:not(.compact-more-btn), .compact-url-group');
    const iconBaseWidth = sampleItem ? sampleItem.offsetWidth : 64;
    const gap = parseFloat(computedStyle.columnGap || computedStyle.gap || '12');
    const itemFullWidth = iconBaseWidth + gap;

    // Optional Add URL button needs space. It matches the width of standard icons.
    const addBtnSpace = onAddUrl ? itemFullWidth : 0;

    // Check if we can fit EVERYTHING including the Add button natively on one line
    // Include both URL groups and apps in total count
    const totalItems = groupedItems.length + apps.length;
    const maxAllowedItems = totalItems;
    let widthForEverything = maxAllowedItems * itemFullWidth - gap + addBtnSpace;

    // Safety buffer to prevent rounding issues causing accidental overflow
    const safeContainerWidth = containerWidth - 8;

    if (maxAllowedItems > 0 && widthForEverything <= safeContainerWidth) {
      // Everything fits perfectly, including the + Add button
      setVisibleCount(totalItems);
      return;
    }

    if (maxAllowedItems === 0 && addBtnSpace <= safeContainerWidth) {
      setVisibleCount(0);
      return;
    }

    // We can't fit everything. We reserve space for the Expand button. 
    // The Expand button takes the space of one icon.
    // We drop the Add button if not expanded (per layout constraints and user req)
    const reservedWidthForExpand = itemFullWidth;
    const availableWidthForIcons = safeContainerWidth - reservedWidthForExpand;

    let count = 0;
    if (availableWidthForIcons >= iconBaseWidth) {
      count = Math.floor((availableWidthForIcons + gap) / itemFullWidth);
    }

    // Never show more than length - 1, since if we show length, we'd have no overflow and wouldn't need expand btn
    setVisibleCount(Math.max(0, Math.min(count, Math.max(0, totalItems - 1))));
  }, [groupedItems, apps, compact, onAddUrl]);

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
  // Split into active vs draft tiers
  const activeUrls = sortedUrls.filter(u => u.status !== 'draft');
  const draftUrls = sortedUrls.filter(u => u.status === 'draft');

  // Use activeUrls for normal display
  const linkLimit = showAll ? activeUrls.length : (compact ? 3 : 5);
  const displayLinks = activeUrls.slice(0, linkLimit);

  return (
    <div
      className={`cooldesk-workspace-card ${isActive ? 'active' : ''} ${compact ? 'compact' : ''}`}
      onClick={handleCardClick}
      style={{ position: 'relative' }}
      {...rest}
    >
      {compact ? (
        /* macOS Dock-Style List View - Using CSS Classes */
        <div className="compact-card-inner" style={{ alignItems: showAll ? 'flex-start' : 'center' }}>
          {/* Workspace Icon on Left */}
          <div className={`compact-workspace-icon workspace-icon ${colorClass}`}>
            <FontAwesomeIcon icon={iconToUse} />
          </div>

          {/* Workspace Info */}
          <div className="compact-workspace-info" style={{ marginTop: showAll ? '12px' : '0' }}>
            <div className="compact-workspace-name">{name}</div>
            <div className="compact-workspace-count">
              {urlCount > 0 && <span>{urlCount} URL{urlCount !== 1 ? 's' : ''}</span>}
              {urlCount > 0 && appCount > 0 && <span style={{ margin: '0 4px' }}>•</span>}
              {appCount > 0 && <span style={{ color: '#22C55E' }}>{appCount} App{appCount !== 1 ? 's' : ''}</span>}
              {totalCount === 0 && <span>Empty</span>}
            </div>
          </div>

          {/* URL Favicons - Grouped */}
          <div ref={iconsContainerRef} className="compact-icons-container" style={{ flexWrap: showAll ? 'wrap' : 'nowrap' }}>
            {groupedItems.slice(0, showAll ? groupedItems.length : visibleCount).map((item, idx) => {
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
                      openUrl(item.url, name, item.title);
                    }
                  }}
                  title={isGroup ? `${item.label} (${item.urls.length}) - ${item.subLabel || item.domain}` : (item.title || formatDomainName(item.url))}
                >
                  {(() => {
                    const avatar = getLetterAvatar(url);
                    return (
                      <>
                        {faviconUrl ? (
                          <img
                            src={faviconUrl}
                            alt=""
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div
                          className="letter-avatar"
                          style={{
                            display: faviconUrl ? 'none' : 'flex',
                            background: avatar.color
                          }}
                        >
                          {avatar.letter}
                        </div>
                      </>
                    );
                  })()}

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

            {/* App Icons - Distinct green styling */}
            {apps.slice(0, showAll ? apps.length : Math.max(0, visibleCount - groupedItems.length)).map((app, idx) => (
              <div
                key={`app-${idx}`}
                className="compact-url-icon compact-app-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  // Launch or focus the app
                  if (window.electronAPI?.launchApp && app.path) {
                    window.electronAPI.launchApp(app.path);
                  }
                }}
                title={app.name}
                style={{
                  border: '2px solid rgba(34, 197, 94, 0.4)',
                  background: 'rgba(34, 197, 94, 0.1)'
                }}
              >
                {app.icon ? (
                  <img src={app.icon} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                ) : (
                  <FontAwesomeIcon icon={faDesktop} style={{ color: '#22C55E', fontSize: '18px' }} />
                )}
              </div>
            ))}

            {/* Inline Add URL Button */}
            {onAddUrl && (showAll || ((groupedItems.length + apps.length) <= visibleCount)) && (
              <div
                className="compact-url-icon"
                style={{
                  border: '1px dashed rgba(148, 163, 184, 0.4)',
                  background: 'transparent',
                  color: 'rgba(148, 163, 184, 0.8)'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddUrl(workspace);
                }}
                title="Add Link"
              >
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: '18px' }} />
              </div>
            )}

            {/* Expand/Collapse Button */}
            {(groupedItems.length + apps.length) > visibleCount && (
              <div
                className="compact-more-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll(!showAll);
                }}
                title={showAll ? "Collapse" : "Expand"}
              >
                <FontAwesomeIcon icon={showAll ? faChevronUp : faChevronDown} style={{ fontSize: '16px' }} />
              </div>
            )}
          </div>

          {/* Render Group Popover if Active */}
          {groupPopoverState.group && (
            <GroupedLinksPopover
              group={groupPopoverState.group}
              triggerRect={groupPopoverState.rect}
              onClose={() => setGroupPopoverState({ group: null, rect: null })}
            />
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
              <div className="workspace-count">
                {urlCount > 0 && <span>{urlCount} URL{urlCount !== 1 ? 's' : ''}</span>}
                {urlCount > 0 && appCount > 0 && <span> • </span>}
                {appCount > 0 && <span style={{ color: '#22C55E' }}>{appCount} App{appCount !== 1 ? 's' : ''}</span>}
              </div>
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
                  data-onboarding="add-link-btn"
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
                        openUrl(urlObj.url, name, urlObj.title);
                      }
                    }}
                    style={{ cursor: 'pointer', position: 'relative' }}
                  >
                    <span className="workspace-link-icon">
                      {(() => {
                        const avatar = getLetterAvatar(urlObj.url);
                        return (
                          <>
                            {faviconUrl ? (
                              <img
                                src={faviconUrl}
                                alt=""
                                className="link-favicon"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className="letter-avatar"
                              style={{
                                display: faviconUrl ? 'none' : 'flex',
                                background: avatar.color
                              }}
                            >
                              {avatar.letter}
                            </div>
                          </>
                        );
                      })()}
                    </span>
                    <span className="workspace-link-text" title={urlObj.url}>
                      {(() => {
                        // If title exists and is different from the hostname, use it
                        // Otherwise use formatted domain name
                        const hostname = safeGetHostname(urlObj.url);
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
              {activeUrls.length > (compact ? 3 : 5) && !showAll && (
                <li
                  className="workspace-link-item"
                  style={{ opacity: 0.6, fontStyle: 'italic', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAll(true);
                  }}
                >
                  <span className="workspace-link-text">
                    + {activeUrls.length - (compact ? 3 : 5)} more items...
                  </span>
                </li>
              )}
            </ul>
          )}

          {/* Apps Section - Green themed */}
          {apps.length > 0 && (
            <div className="workspace-apps-section" style={{ marginTop: '8px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '6px',
                color: '#22C55E',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                <FontAwesomeIcon icon={faDesktop} style={{ fontSize: '10px' }} />
                Apps ({apps.length})
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                {apps.map((app, idx) => (
                  <div
                    key={idx}
                    className="workspace-app-chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.electronAPI?.launchApp && app.path) {
                        window.electronAPI.launchApp(app.path);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      background: 'rgba(34, 197, 94, 0.1)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontSize: '12px',
                      color: '#E2E8F0'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.3)';
                    }}
                    title={`Launch ${app.name}`}
                  >
                    {app.icon ? (
                      <img src={app.icon} alt="" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
                    ) : (
                      <FontAwesomeIcon icon={faDesktop} style={{ color: '#22C55E', fontSize: '12px' }} />
                    )}
                    <span>{app.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming (Draft) URLs — collapsible section */}
          {draftUrls.length > 0 && (
            <div className="workspace-drafts-section" style={{ marginTop: '8px' }}>
              <button
                className="workspace-drafts-toggle"
                onClick={(e) => { e.stopPropagation(); setShowDrafts(v => !v); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'rgba(148, 163, 184, 0.7)',
                  fontSize: '11px',
                  padding: '4px 0',
                  width: '100%',
                  textAlign: 'left'
                }}
              >
                <FontAwesomeIcon icon={showDrafts ? faChevronUp : faChevronDown} style={{ fontSize: '9px' }} />
                Upcoming ({draftUrls.length})
              </button>

              {showDrafts && (
                <ul className="workspace-links workspace-drafts-list" style={{ marginTop: '4px' }}>
                  {draftUrls.map((urlObj, idx) => {
                    const faviconUrl = getFaviconUrl(urlObj.url, 16);
                    return (
                      <li
                        key={idx}
                        className="workspace-link-item workspace-draft-item"
                        style={{
                          opacity: 0.6,
                          borderLeft: '2px dashed rgba(96, 165, 250, 0.4)',
                          paddingLeft: '6px',
                          cursor: 'pointer'
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (urlObj.url) openUrl(urlObj.url, name, urlObj.title);
                        }}
                      >
                        <span className="workspace-link-icon">
                          {(() => {
                            const avatar = getLetterAvatar(urlObj.url);
                            return (
                              <>
                                {faviconUrl ? (
                                  <img src={faviconUrl} alt="" className="link-favicon"
                                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                  />
                                ) : null}
                                <div className="letter-avatar" style={{ display: faviconUrl ? 'none' : 'flex', background: avatar.color }}>
                                  {avatar.letter}
                                </div>
                              </>
                            );
                          })()}
                        </span>
                        <span className="workspace-link-text" title={urlObj.url} style={{ flex: 1 }}>
                          {(() => {
                            const hostname = safeGetHostname(urlObj.url);
                            const t = urlObj.title;
                            if (!t || t === hostname || t === hostname.replace(/^www\./, '') || t.endsWith('.com') || t.endsWith('.org') || t.endsWith('.io')) return formatDomainName(urlObj.url);
                            return t;
                          })()}
                        </span>

                        {/* Promote button */}
                        {onUrlAction && (
                          <button
                            title="Promote to Active"
                            className="workspace-draft-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Record positive feedback for URL suggestion
                              recordFeedbackEvent({
                                suggestionType: 'url_to_workspace',
                                action: 'accepted',
                                suggestionContent: urlObj.url,
                                contextWorkspace: name
                              }).catch(() => {});
                              recordUrlWorkspace(urlObj.url, urlObj.title || urlObj.url, name).catch(() => {});
                              onUrlAction('promote', urlObj, workspace);
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'rgba(34, 197, 94, 0.6)', fontSize: '12px', padding: '4px'
                            }}
                          >
                            <FontAwesomeIcon icon={faCheckCircle} />
                          </button>
                        )}

                        {/* Dismiss button */}
                        {onUrlAction && (
                          <button
                            title="Dismiss"
                            className="workspace-draft-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Record negative feedback for URL suggestion
                              recordFeedbackEvent({
                                suggestionType: 'url_to_workspace',
                                action: 'rejected',
                                suggestionContent: urlObj.url,
                                contextWorkspace: name
                              }).catch(() => {});
                              onUrlAction('dismiss', urlObj, workspace);
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'rgba(239, 68, 68, 0.6)', fontSize: '12px', padding: '4px'
                            }}
                          >
                            <FontAwesomeIcon icon={faTimesCircle} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
