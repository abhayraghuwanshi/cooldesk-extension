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
  faFileLines,
  faFilm,
  faFlask,
  faFolder,
  faFolderOpen,
  faFutbol,
  faGamepad,
  faGraduationCap,
  faGripLines,
  faHashtag,
  faHeartPulse,
  faHome,
  faLightbulb,
  faLink,
  faMusic,
  faNewspaper,
  faPalette,
  faPen,
  faPlane,
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
  faVrCardboard,
  faXmark
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getUrlAnalytics,
  saveWorkspace,
} from '../../../db/index.js';
import { recordFeedbackEvent, recordUrlWorkspace } from '../../../services/feedbackService.js';
import { fetchCooldesk } from '../../../services/cooldeskService.js';
import { useCooldeskVersion } from '../../../shared/hooks/useCooldeskProjects.js';
import { getBaseDomainFromUrl, getFaviconUrl, safeGetHostname } from '../../../utils/helpers.js';
import { AccentColorPicker } from '../../../shared/components/AccentColorPicker.jsx';
import { GroupedLinksPopover } from './GroupedLinksPopover.jsx';
import { UrlAnalyticsPopover } from './UrlAnalyticsPopover.jsx';
import { isEditorApp, workspaceActivityService } from '../../../services/workspaceActivityService.js';
import { useIsSidebarWidth } from '../../../shared/hooks/useIsSidebarWidth.js';

const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

// Resolve a .cooldesk resource path (relative to the project root) to an absolute path.
const joinProjectPath = (base, rel) => {
  if (!base || !rel || rel === '.') return base || rel;
  const b = base.replace(/[\\/]+$/, '');
  const r = String(rel).replace(/[/\\]+/g, '\\').replace(/^\\+/, '');
  return `${b}\\${r}`;
};

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

// Helper to open URLs - works in both extension and Electron modes.
// Navigation itself is the shared find-or-create in workspaceActivityService:
// a link already open in a synced tab is focused rather than duplicated, which
// is what the dock has always done and the card used to not. Only the learning
// signals below are card-specific, so they stay here.
const openUrl = (url, workspaceName, title, target) => {
  if (!url) return;

  // Record feedback for RAG learning (fire-and-forget)
  recordFeedbackEvent({
    suggestionType: 'url_to_workspace',
    action: 'accepted',
    suggestionContent: url,
    contextWorkspace: workspaceName
  }).catch(() => { });

  // Also record URL-workspace association for pattern learning
  if (workspaceName) {
    recordUrlWorkspace(url, title || url, workspaceName).catch(() => { });
  }

  workspaceActivityService.activate({ url }, target !== undefined ? { target } : undefined);
};

// Detect the desktop (Tauri) app via a positive signal. We can't rely on
// `!chrome.runtime?.id` because WebView2 populates `chrome.runtime`, which made
// the context panel/resize handle vanish in the app. electron-shim guarantees
// window.electronAPI (and __TAURI__) in the app; neither exists in the extension.
const isDesktopApp = typeof window !== 'undefined' &&
  !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.electronAPI);

// Memoized WorkspaceCard to prevent unnecessary re-renders
export const WorkspaceCard = memo(function WorkspaceCard({ workspace, onClick, isExpanded = false, isActive = false, compact = false, fullView = false, isPinned = false, onPin, onDelete, onEditWorkspace, onUrlAction, deferAnalytics = false, ...rest }) {
  if (!workspace) return null;

  const [popoverState, setPopoverState] = useState({ index: null, rect: null });
  const [hoveredLink, setHoveredLink] = useState(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  // "Edit" opens the header search's /edit-workspace mode for this workspace
  // (same rename/add/remove/todo/note flow as typing its name there) — hidden
  // in the sidebar, so offering it there just opens a menu item that does
  // nothing visible.
  const isSidebarWidth = useIsSidebarWidth();
  // User-chosen accent color. Optimistic local state so the tint applies
  // instantly; persisted to the workspace record (survives reload / sync).
  const [colorOverride, setColorOverride] = useState(workspace.color || null);
  const activePopover = popoverState.index;

  // ── Context panel ────────────────────────────────────────────────────────
  const PANEL_MIN_HEIGHT = 150; // px — minimum useful height for the panel
  // null = use CSS-controlled height (compact auto); number = inline-style controlled
  const [cardHeight, setCardHeight] = useState(compact ? null : 280);
  const [hasUserResized, setHasUserResized] = useState(false);
  const cardRef = useRef(null);

  // Reset height when view mode switches between compact and non-compact
  useEffect(() => {
    setCardHeight(compact ? null : 280);
    setHasUserResized(false);
  }, [compact]);

  // Mirror the parent's isExpanded into the card height: expand gives the
  // context panel room, collapse snaps back to the natural (auto) height.
  // Skip while the user is manually resizing so we don't clobber their drag.
  const EXPANDED_DEFAULT_HEIGHT = compact ? 320 : 380;
  useEffect(() => {
    if (hasUserResized) return;
    setCardHeight(isExpanded ? EXPANDED_DEFAULT_HEIGHT : (compact ? null : 280));
  }, [isExpanded, hasUserResized, EXPANDED_DEFAULT_HEIGHT, compact]);

  // Show panel when parent says so, OR when the user has dragged the card
  // tall enough to render meaningful content.
  const contextPanelVisible =
    fullView ||
    isExpanded ||
    (hasUserResized && cardHeight !== null && cardHeight >= PANEL_MIN_HEIGHT);

  const { name, urls = [], apps = [], description, icon = 'folder' } = workspace;
  const urlCount = urls.length;
  const appCount = apps.length;
  const totalCount = urlCount + appCount;

  // ── Live state ───────────────────────────────────────────────────────────
  // Which of this card's links and apps are already open. Desktop app only —
  // there are no running apps or synced tabs to match against in the extension,
  // so the subscription (and its poll) never starts there.
  const [activity, setActivity] = useState(null);
  useEffect(() => {
    if (!isDesktopApp) return;
    return workspaceActivityService.subscribe(setActivity);
  }, []);

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

  // Group URLs by domain/entity for compact view.
  // Drafts (AI-suggested "Upcoming" links) are excluded — they'd show up as
  // real workspace links the user never added.
  const groupedItems = useMemo(() => {
    if (!compact) return [];

    // 1. Bucket by specific Entity (Owner/Workspace)
    const entityGroups = {};
    sortedUrls.filter(u => u.status !== 'draft').forEach(urlObj => {
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

  const regularApps = useMemo(() => apps.filter(app => !['folder', 'file'].includes(app.appType?.toLowerCase())), [apps]);
  const folderFileApps = useMemo(() => apps.filter(app => ['folder', 'file'].includes(app.appType?.toLowerCase())), [apps]);
  const editorApps = useMemo(() => apps.filter(isEditorApp), [apps]);
  const desktopApps = useMemo(() => apps.filter(app => {
    const t = app.appType?.toLowerCase();
    return t !== 'folder' && t !== 'file' && !isEditorApp(app);
  }), [apps]);
  const folderApps = useMemo(() => apps.filter(app => app.appType?.toLowerCase() === 'folder'), [apps]);
  const fileApps = useMemo(() => apps.filter(app => app.appType?.toLowerCase() === 'file'), [apps]);

  // ── .cooldesk resources merged into the categorized rows ─────────────────
  // The workspace's project folder (an app of appType 'folder') may hold a
  // committed .cooldesk manifest declaring folders / links / linked projects.
  // Surface those alongside the workspace's own apps/urls instead of duplicating
  // them in a separate chip list.
  // A project folder may be a plain 'folder' app or an editor app (the folder
  // added as "open in <editor>"); both name a root that can hold .cooldesk/.
  // Prefer a plain folder, then fall back to an editor-associated folder.
  const projectFolderPath = useMemo(() => {
    const plain = apps.find(a => a.appType?.toLowerCase() === 'folder' && a.path);
    if (plain) return plain.path;
    const editorFolder = apps.find(a => isEditorApp(a) && a.path);
    return editorFolder?.path || null;
  }, [apps]);
  const [cooldesk, setCooldesk] = useState(null);
  // Re-read when the plugin announces a write to this project's .cooldesk/.
  const cdVersion = useCooldeskVersion(projectFolderPath);
  useEffect(() => {
    if (!projectFolderPath) { setCooldesk(null); return; }
    let cancelled = false;
    fetchCooldesk(projectFolderPath)
      .then(d => { if (!cancelled) setCooldesk(d?.exists ? d : null); })
      .catch(() => { if (!cancelled) setCooldesk(null); });
    return () => { cancelled = true; };
  }, [projectFolderPath, cdVersion]);

  const cdFolders = useMemo(() => {
    if (!cooldesk) return [];
    // Dedupe against the workspace's own folder apps and across projects.
    const seen = new Set(folderApps.map(a => a.path?.toLowerCase()).filter(Boolean));
    const out = [];
    // Folder resources are relative to their own project's root, so each source
    // (the hub and every linked member) is joined against its own base path.
    const addFolders = (resources, base, projectName) => {
      for (const r of (resources || [])) {
        if (r.type !== 'folder' || !r.path) continue;
        const path = joinProjectPath(base, r.path);
        const key = path?.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ name: r.name || r.path, path, appType: 'folder', _cd: true, project: projectName });
      }
    };
    // Hub's own folders.
    addFolders(cooldesk.resources, projectFolderPath, cooldesk.project?.name);
    // Each linked group member's folders (skip the hub's own member entry).
    const hubId = cooldesk.project?.id;
    for (const m of (cooldesk.members || [])) {
      if ((m.project?.id || m.name) === hubId) continue;
      addFolders(m.resources, m.path, m.project?.name || m.name);
    }
    return out;
  }, [cooldesk, folderApps, projectFolderPath]);
  const cdLinks = useMemo(() => {
    if (!cooldesk) return [];
    const norm = (u) => (u || '').replace(/\/+$/, '').toLowerCase();
    const existing = new Set((urls || []).map(u => norm(u.url)));
    return cooldesk.resources
      .filter(r => r.url)
      .map(r => ({ url: r.url, title: r.name || r.url, type: 'single', _cd: true }))
      .filter(r => !existing.has(norm(r.url)));
  }, [cooldesk, urls]);
  const cdProjects = useMemo(() => {
    if (!cooldesk) return [];
    const hubId = cooldesk.project?.id;
    return (cooldesk.members || [])
      .filter(m => (m.project?.id || m.name) !== hubId)
      .map(m => ({ name: m.project?.name || m.name, path: m.path, repo: m.repo, exists: m.exists, _cd: true }));
  }, [cooldesk]);

  const handleCardClick = () => {
    if (fullView) return; // detail view: card body is not a collapse target
    onClick?.(workspace);
  };

  // Expand/collapse button. Collapse must clear any manual-drag state too,
  // otherwise the card stays open from `hasUserResized` even after toggling.
  const handleToggleExpand = (e) => {
    e.stopPropagation();
    if (contextPanelVisible) {
      // Collapsing: drop local drag height, and turn off parent expansion if set.
      setHasUserResized(false);
      setCardHeight(compact ? null : 280);
      if (isExpanded) onClick?.(workspace);
    } else {
      onClick?.(workspace);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Apply an accent color (or null to reset to the default hue). Optimistic:
  // update local state immediately, then persist the whole workspace record.
  // keepOpen=true is used by the live color picker — closing the menu there
  // unmounts the <input>, aborting the OS picker mid-selection.
  const applyColor = (color, keepOpen = false) => {
    setColorOverride(color);
    if (!keepOpen) setContextMenu(null);
    const next = { ...workspace, updatedAt: Date.now() };
    if (color) next.color = color; else delete next.color;
    Promise.resolve(saveWorkspace(next)).catch((err) =>
      console.error('[WorkspaceCard] Failed to save card color:', err)
    );
  };

  // ── Removing items ───────────────────────────────────────────────────────
  // The workspace record is the source of truth for urls[]/apps[], so removal
  // is a filtered save — same shape as applyColor above. Items carrying `_cd`
  // come from a project's committed .cooldesk manifest rather than this
  // record, so they have no × : filtering them here would save a record they
  // aren't in and the chip would reappear on the next read.
  const removeItem = (key, match) => {
    const next = {
      ...workspace,
      [key]: (workspace[key] || []).filter(x => !match(x)),
      updatedAt: Date.now(),
    };
    Promise.resolve(saveWorkspace(next)).catch((err) =>
      console.error(`[WorkspaceCard] Failed to remove ${key} item:`, err)
    );
  };

  const handleRemoveUrl = (e, urlObj) => {
    e.stopPropagation();
    removeItem('urls', u => u.url === urlObj.url);
  };

  const handleRemoveApp = (e, app) => {
    e.stopPropagation();
    // Apps are identified by path; fall back to name for records saved without one.
    removeItem('apps', a => (app.path ? a.path === app.path : a.name === app.name));
  };

  // Dismiss context menu on outside click. The menu is portaled to document.body,
  // so its React onClick stopPropagation can't stop these native window listeners —
  // we must skip clicks that land inside the menu ourselves, otherwise interacting
  // with it (e.g. opening the native color picker) closes it instantly.
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e) => {
      if (e.target?.closest?.('.workspace-context-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('contextmenu', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
    };
  }, [contextMenu]);

  // ── Show fewer links in compact mode, unless expanded ────────────────────
  // Memoized so `resolved` below keys off a stable array identity — recomputing
  // this list every render would defeat that memo entirely.
  const activeUrls = useMemo(() => sortedUrls.filter(u => u.status !== 'draft'), [sortedUrls]);
  const draftUrls = sortedUrls.filter(u => u.status === 'draft');

  const displayLinks = activeUrls;

  // One resolution pass for the whole card: no two items claim the same tab or
  // window, and every render site below reads the same answer the click acts on.
  // Keyed on the objects actually rendered — `sortedUrls` is rebuilt state (it
  // comes back through the analytics cache as fresh objects), so resolving
  // `workspace.urls` would produce a map none of these lookups could hit.
  // `activity` is unread but load-bearing: resolveAll reads the service's
  // mutable snapshot, so a poll landing is the only cue to recompute.
  const resolved = useMemo(
    () => (isDesktopApp ? workspaceActivityService.resolveAll([...activeUrls, ...apps]) : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeUrls, apps, activity]
  );

  const activate = useCallback(
    (item) => workspaceActivityService.activate(item, { target: resolved.get(item) ?? null }),
    [resolved]
  );

  const cardStyle = fullView
    ? {
      // Detail view: content defines the height, the outer view scrolls.
      position: 'relative',
      height: 'auto',
      maxHeight: 'none',
      overflow: 'visible',
    }
    : cardHeight !== null
      ? {
        position: 'relative',
        height: cardHeight,
        maxHeight: 'none',
        overflow: 'hidden',
      }
      : { position: 'relative' }; // CSS class controls height (compact auto)

  return (
    <div
      ref={cardRef}
      className={`cooldesk-workspace-card ${isActive ? 'active' : ''} ${compact ? 'compact' : ''} ${contextPanelVisible ? 'panel-open' : ''} ${fullView ? 'full-view' : ''} ${colorOverride ? 'has-accent' : ''}`}
      onClick={handleCardClick}
      onContextMenu={handleContextMenu}
      style={colorOverride ? { ...cardStyle, '--card-accent': colorOverride } : cardStyle}
      {...rest}
    >
      {compact ? (
        /* macOS Dock-Style List View - Using CSS Classes */
        <div
          className="compact-card-inner"
          style={{ alignItems: contextPanelVisible ? 'flex-start' : 'center' }}
        >
          {/* Workspace Icon + Name stacked (iOS app style) */}
          <div className="compact-workspace-stack">
            <div className={`compact-workspace-icon workspace-icon ${urls.length > 0 ? 'folder-collage' : colorClass}`}>
              {urls.length === 0 ? (
                <FontAwesomeIcon icon={iconToUse} />
              ) : (
                <div className="workspace-folder-grid">
                  {urls.slice(0, 4).map((urlObj, i) => {
                    const fUrl = getFaviconUrl(urlObj.url, 20);
                    const avatar = getLetterAvatar(urlObj.url);
                    return (
                      <div key={i} className="folder-grid-cell">
                        {fUrl && (
                          <img
                            src={fUrl}
                            alt=""
                            onError={(e) => {
                              e.target.style.display = 'none';
                              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        )}
                        <div
                          className="folder-grid-letter"
                          style={{ display: fUrl ? 'none' : 'flex', background: avatar.color }}
                        >
                          {avatar.letter}
                        </div>
                      </div>
                    );
                  })}
                  {Array.from({ length: Math.max(0, 4 - Math.min(urls.length, 4)) }).map((_, i) => (
                    <div key={`empty-${i}`} className="folder-grid-cell folder-grid-empty" />
                  ))}
                </div>
              )}
            </div>
            <div className="compact-workspace-label">{name}</div>
          </div>

          {/* URL Favicons + Apps. Single-row when collapsed; categorized rows when
              expanded. No stopPropagation here: each icon stops its own click, and
              empty-row clicks must bubble so tapping the card expands it — the row
              spans nearly the whole card now that the title sits above it. */}
          <div className="compact-icons-scroll">
            {(() => {
              const renderLinkIcon = (item, idx, showLabel = false) => {
                const isGroup = item.type === 'group';
                const url = isGroup ? item.primaryUrl : item.url;
                const faviconUrl = getFaviconUrl(url, 20);
                const avatar = getLetterAvatar(url);
                const displayName = isGroup ? null : (item.title || formatDomainName(item.url));
                const isOpen = !isGroup && !!resolved.get(item);
                return (
                  <div
                    key={`link-${idx}`}
                    className={`${isGroup ? 'compact-url-group' : 'compact-url-icon'}${showLabel && !isGroup ? ' is-labeled' : ''}${isOpen ? ' is-open' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isGroup) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setGroupPopoverState({ group: item, rect });
                      } else {
                        openUrl(item.url, name, item.title, resolved.get(item));
                      }
                    }}
                    title={isGroup
                      ? `${item.label} (${item.urls.length}) - ${item.subLabel || item.domain}`
                      : `${displayName}${isOpen ? ' — open in browser' : ''}`}
                  >
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
                      style={{ display: faviconUrl ? 'none' : 'flex', background: avatar.color }}
                    >
                      {avatar.letter}
                    </div>
                    {isGroup && (
                      <div className="compact-group-text">
                        <div className="compact-group-label">{item.label}</div>
                        <div className="compact-group-count">{item.urls.length}</div>
                      </div>
                    )}
                    {showLabel && !isGroup && (
                      <span className="compact-icon-label">{displayName}</span>
                    )}
                    {/* Groups have no × — one chip stands for several links, so
                        a single cross would silently drop all of them. */}
                    {!isGroup && !item._cd && (
                      <button
                        type="button"
                        className="item-remove-btn"
                        onClick={(e) => handleRemoveUrl(e, item)}
                        title={`Remove ${displayName}`}
                        aria-label={`Remove ${displayName} from ${name}`}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    )}
                  </div>
                );
              };

              const renderAppIcon = (app, idx, showLabel = false) => {
                const isEditor = isEditorApp(app);
                const appColor = isEditor ? '#38bdf8'
                  : app.appType === 'folder' ? '#facc15'
                    : app.appType === 'file' ? '#94a3b8'
                      : '#8b5cf6';
                const appIcon = isEditor ? faCode
                  : app.appType === 'folder' ? faFolderOpen
                    : app.appType === 'file' ? faFileLines
                      : faDesktop;
                const isRunning = !!resolved.get(app);
                return (
                  <div
                    key={`app-${idx}`}
                    className={`compact-url-icon compact-app-icon${showLabel ? ' is-labeled' : ''}${isRunning ? ' is-open' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      activate(app);
                    }}
                    title={`${app.path || app.name}${isRunning ? ' — running (click to focus)' : ''}`}
                    style={{ border: `1px solid ${appColor}55`, background: `${appColor}12` }}
                  >
                    {app.icon ? (
                      <img src={app.icon} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                    ) : (
                      <FontAwesomeIcon icon={appIcon} style={{ color: appColor, fontSize: '18px' }} />
                    )}
                    {showLabel && (
                      <span className="compact-icon-label" style={{ color: appColor }}>{app.name}</span>
                    )}
                    {!app._cd && (
                      <button
                        type="button"
                        className="item-remove-btn"
                        onClick={(e) => handleRemoveApp(e, app)}
                        title={`Remove ${app.name}`}
                        aria-label={`Remove ${app.name} from ${name}`}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    )}
                  </div>
                );
              };

              if (contextPanelVisible) {
                // Expanded: categorized rows with name pills so folders/apps/files are distinguishable.
                // Each link group (e.g. all Google links) becomes its own section with
                // the links laid out flat — one click to open, no popover indirection.
                const linkGroups = groupedItems.filter(item => item.type === 'group');
                const singleLinks = groupedItems.filter(item => item.type !== 'group');
                // A linked .cooldesk project — opens its folder; shown in its own row.
                const renderProjectIcon = (proj, idx, showLabel = false) => (
                  <div
                    key={`proj-${idx}`}
                    className={`compact-url-icon compact-app-icon${showLabel ? ' is-labeled' : ''}${proj.exists ? '' : ' is-missing'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (proj.exists && proj.path && window.electronAPI?.openFolder) window.electronAPI.openFolder(proj.path);
                      else if (proj.repo) openUrl(proj.repo, name, proj.name);
                    }}
                    title={proj.exists ? (proj.path || proj.name) : `${proj.name} — not found locally${proj.repo ? ` (${proj.repo})` : ''}`}
                    style={{ border: '1px solid #2dd4bf55', background: '#2dd4bf12' }}
                  >
                    <FontAwesomeIcon icon={faBriefcase} style={{ color: '#2dd4bf', fontSize: '18px' }} />
                    {showLabel && <span className="compact-icon-label" style={{ color: '#2dd4bf' }}>{proj.name}</span>}
                  </div>
                );

                const linkRows = [
                  ...linkGroups.map(group => ({
                    key: `group-${group.key}`,
                    label: group.subLabel && group.subLabel !== group.label
                      ? `${group.label} · ${group.subLabel}`
                      : group.label,
                    icon: faLink,
                    accent: '#60a5fa',
                    items: group.urls,
                    render: renderLinkIcon
                  })),
                  { key: 'links', label: linkGroups.length > 0 ? 'Other Links' : 'Links', icon: faLink, accent: '#60a5fa', items: [...singleLinks, ...cdLinks], render: renderLinkIcon },
                ];

                const ROWS = [
                  ...linkRows,
                  { key: 'projects', label: 'Projects', icon: faBriefcase, accent: '#2dd4bf', items: cdProjects, render: renderProjectIcon },
                  { key: 'editors', label: 'Editors', icon: faCode, accent: '#38bdf8', items: editorApps, render: renderAppIcon },
                  { key: 'apps', label: 'Apps', icon: faDesktop, accent: '#8b5cf6', items: desktopApps, render: renderAppIcon },
                  { key: 'folders', label: 'Folders', icon: faFolderOpen, accent: '#facc15', items: [...folderApps, ...cdFolders], render: renderAppIcon },
                  { key: 'files', label: 'Files', icon: faFileLines, accent: '#94a3b8', items: fileApps, render: renderAppIcon },
                ].filter(row => row.items.length > 0);

                return (
                  <div className="compact-icons-rows">
                    {ROWS.map(row => (
                      <div key={row.key} className="compact-icons-row" style={{ '--row-accent': row.accent }}>
                        <div className="compact-icons-row-label">
                          <FontAwesomeIcon icon={row.icon} />
                          <span>{row.label}</span>
                          <span className="compact-icons-row-count">{row.items.length}</span>
                        </div>
                        <div className="compact-icons-container">
                          {row.items.map((item, idx) => row.render(item, idx, true))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }

              // Collapsed: single combined row, icon-only. Every URL gets its own
              // icon — the row scrolls horizontally at all widths, so domain-group
              // stacks would only hide links behind an extra popover hop.
              return (
                <div className="compact-icons-container">
                  {activeUrls.map((item, idx) => renderLinkIcon(item, idx, false))}
                  {apps.map((app, idx) => renderAppIcon(app, idx, false))}
                </div>
              );
            })()}
          </div>

          {/* Expand / collapse — pops the card open inline (status, tasks, notes) */}
          {totalCount > 0 && (
            <button
              className={`compact-expand-btn ${contextPanelVisible ? 'is-open' : ''}`}
              onClick={handleToggleExpand}
              title={contextPanelVisible ? 'Collapse' : 'Expand'}
              aria-label={contextPanelVisible ? 'Collapse workspace' : 'Expand workspace'}
            >
              <FontAwesomeIcon icon={contextPanelVisible ? faChevronUp : faChevronDown} />
            </button>
          )}

          {/* Render Group Popover if Active */}
          {groupPopoverState.group && (
            <GroupedLinksPopover
              group={groupPopoverState.group}
              triggerRect={groupPopoverState.rect}
              onClose={() => setGroupPopoverState({ group: null, rect: null })}
            />
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
                {appCount > 0 && <span style={{ color: '#8b5cf6' }}>{appCount} App{appCount !== 1 ? 's' : ''}</span>}
              </div>
            </div>

          </div>

          {displayLinks.length > 0 && (
            <div className="workspace-row-section">
              <div className="workspace-row-label">
                <FontAwesomeIcon icon={faLink} style={{ fontSize: '9px' }} />
                Links
              </div>
              <div className="workspace-chips-row">
                {displayLinks.map((urlObj, idx) => {
                  const faviconUrl = getFaviconUrl(urlObj.url, 16);
                  const isHovered = hoveredLink === idx;
                  const isPopoverOpen = activePopover === idx;
                  const avatar = getLetterAvatar(urlObj.url);
                  const isOpen = !!resolved.get(urlObj);
                  return (
                    <div
                      key={idx}
                      className={`workspace-url-chip${isPopoverOpen ? ' analytics-open' : ''}${isOpen ? ' is-open' : ''}`}
                      onMouseEnter={() => setHoveredLink(idx)}
                      onMouseLeave={() => { setHoveredLink(null); setPopoverState({ index: null, rect: null }); }}
                      onClick={(e) => { e.stopPropagation(); openUrl(urlObj.url, name, urlObj.title, resolved.get(urlObj)); }}
                      style={{ position: 'relative' }}
                      title={`${urlObj.title || urlObj.url}${isOpen ? ' — open in browser' : ''}`}
                    >
                      <span className="workspace-link-icon">
                        {faviconUrl ? (
                          <img src={faviconUrl} alt="" className="link-favicon"
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          />
                        ) : null}
                        <div className="letter-avatar" style={{ display: faviconUrl ? 'none' : 'flex', background: avatar.color }}>
                          {avatar.letter}
                        </div>
                      </span>
                      <span className="workspace-url-chip-text">
                        {(() => {
                          const hostname = safeGetHostname(urlObj.url);
                          const title = urlObj.title;
                          if (!title || title === hostname || title === hostname.replace(/^www\./, '') || title.endsWith('.com') || title.endsWith('.in') || title.endsWith('.org') || title.endsWith('.net') || title.endsWith('.io')) {
                            return formatDomainName(urlObj.url);
                          }
                          return title;
                        })()}
                      </span>
                      {(isHovered || isPopoverOpen) && (
                        <span
                          className="workspace-link-analytics"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPopoverState(prev => prev.index === idx ? { index: null, rect: null } : { index: idx, rect });
                          }}
                          style={{
                            color: isPopoverOpen ? '#60A5FA' : 'rgba(148, 163, 184, 0.5)',
                            fontSize: '10px',
                            padding: '2px 4px',
                            marginLeft: 'auto',
                            flexShrink: 0
                          }}
                          title="View Analytics"
                        >
                          <FontAwesomeIcon icon={faChartLine} />
                        </span>
                      )}
                      {isPopoverOpen && (
                        <UrlAnalyticsPopover
                          url={urlObj.url}
                          title={urlObj.title}
                          onClose={() => setPopoverState({ index: null, rect: null })}
                          triggerRect={popoverState.rect}
                        />
                      )}
                      {!urlObj._cd && (
                        <button
                          type="button"
                          className="item-remove-btn is-inline"
                          onClick={(e) => handleRemoveUrl(e, urlObj)}
                          title={`Remove ${urlObj.title || urlObj.url}`}
                          aria-label={`Remove ${urlObj.title || urlObj.url} from ${name}`}
                        >
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Row 2: Apps (editors / desktop) */}
          {regularApps.length > 0 && (
            <div className="workspace-row-section">
              <div className="workspace-row-label">
                <FontAwesomeIcon icon={faDesktop} style={{ fontSize: '9px' }} />
                Apps
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {regularApps.map((app, idx) => {
                  const isEditor = isEditorApp(app);
                  const appColor = isEditor ? '#38bdf8' : '#8b5cf6';
                  const appIcon = isEditor ? faCode : faDesktop;
                  const isRunning = !!resolved.get(app);
                  return (
                    <div
                      key={idx}
                      className={`workspace-app-chip${isRunning ? ' is-open' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        activate(app);
                      }}
                      style={{ background: `${appColor}1a`, border: `1px solid ${appColor}4d` }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `${appColor}33`; e.currentTarget.style.borderColor = `${appColor}80`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = `${appColor}1a`; e.currentTarget.style.borderColor = `${appColor}4d`; }}
                      title={isRunning ? `Focus ${app.name}` : `Launch ${app.name}`}
                    >
                      {app.icon ? (
                        <img src={app.icon} alt="" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
                      ) : (
                        <FontAwesomeIcon icon={appIcon} style={{ color: appColor, fontSize: '12px' }} />
                      )}
                      <span>{app.name}</span>
                      {!app._cd && (
                        <button
                          type="button"
                          className="item-remove-btn is-inline"
                          onClick={(e) => handleRemoveApp(e, app)}
                          title={`Remove ${app.name}`}
                          aria-label={`Remove ${app.name} from ${name}`}
                        >
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Row 3: Folders & Files */}
          {folderFileApps.length > 0 && (
            <div className="workspace-row-section">
              <div className="workspace-row-label">
                <FontAwesomeIcon icon={faFolderOpen} style={{ fontSize: '9px', color: '#facc15' }} />
                Folders & Files
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {folderFileApps.map((app, idx) => {
                  const appColor = app.appType === 'folder' ? '#facc15' : '#94a3b8';
                  const appIcon = app.appType === 'folder' ? faFolderOpen : faFileLines;
                  const isOpen = !!resolved.get(app);
                  return (
                    <div
                      key={idx}
                      className={`workspace-app-chip${isOpen ? ' is-open' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        activate(app);
                      }}
                      style={{ background: `${appColor}1a`, border: `1px solid ${appColor}4d` }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `${appColor}33`; e.currentTarget.style.borderColor = `${appColor}80`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = `${appColor}1a`; e.currentTarget.style.borderColor = `${appColor}4d`; }}
                      title={app.path || app.name}
                    >
                      {app.icon ? (
                        <img src={app.icon} alt="" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
                      ) : (
                        <FontAwesomeIcon icon={appIcon} style={{ color: appColor, fontSize: '12px' }} />
                      )}
                      <span>{app.name}</span>
                      {!app._cd && (
                        <button
                          type="button"
                          className="item-remove-btn is-inline"
                          onClick={(e) => handleRemoveApp(e, app)}
                          title={`Remove ${app.name}`}
                          aria-label={`Remove ${app.name} from ${name}`}
                        >
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      )}
                    </div>
                  );
                })}
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
                              }).catch(() => { });
                              recordUrlWorkspace(urlObj.url, urlObj.title || urlObj.url, name).catch(() => { });
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
                              }).catch(() => { });
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

      {/* Status / tasks / notes are no longer shown inside the card. Expanding a
          workspace (click, or the expand chevron) opens the full-width detail
          view (WorkspaceList → .workspace-detail-view), which renders that
          content as its own section below the items — no fixed-height card, no
          internal scroll, no drag-resize. Only the detail-view instance
          (fullView) still hosts the panel, as a sibling in WorkspaceList. */}

      {/* Right-click context menu — rendered via portal to escape backdrop-filter stacking context */}
      {contextMenu && createPortal(
        <div
          className="workspace-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Customize accent color */}
          <div className="context-menu-label">
            <FontAwesomeIcon icon={faPalette} />
            Customize
          </div>
          <AccentColorPicker
            className="context-menu-swatches"
            value={colorOverride}
            onSelect={(color, source) => applyColor(color, source === 'custom')}
          />
          <div className="context-menu-divider" />
          {/* Opens /edit-workspace on the header search for this workspace —
              the same rename/search-to-add/todo/note flow as typing its name
              there, rather than a separate one-shot "add a single thing"
              mode. Lives here rather than as a permanent "+" on the card:
              every card would carry one, and an always-visible button
              competes with the items the card exists to show. */}
          {onEditWorkspace && !isSidebarWidth && (
            <button
              className="context-menu-item"
              onClick={() => { onEditWorkspace(workspace); setContextMenu(null); }}
            >
              <FontAwesomeIcon icon={faPen} />
              Edit
            </button>
          )}
          {onPin && (
            <button
              className="context-menu-item"
              onClick={() => { onPin(workspace); setContextMenu(null); }}
            >
              <FontAwesomeIcon icon={faThumbtack} style={{ color: isPinned ? '#FDE047' : undefined }} />
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {isDesktopApp && (
            <button
              className="context-menu-item"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('cooldesk-dock-workspace', {
                  detail: { id: workspace.id, name: workspace.name },
                }));
                setContextMenu(null);
              }}
            >
              <FontAwesomeIcon icon={faGripLines} />
              Activate as dock
            </button>
          )}
          {onDelete && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { onDelete(workspace); setContextMenu(null); }}
            >
              <FontAwesomeIcon icon={faTrash} />
              Delete
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
});
