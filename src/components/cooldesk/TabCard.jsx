
import { faBolt, faChevronDown, faClock, faDesktop, faExternalLinkAlt, faFile, faFolder, faFolderOpen, faGlobe, faMagic, faPowerOff, faTasks, faThumbtack, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useRef, useState } from 'react';
import { getFaviconUrl, safeGetHostname } from '../../utils/helpers.js';
const ICON_COLORS = ['blue', 'orange', 'brown', 'green', 'purple'];

// Browser color scheme for visual distinction
const BROWSER_COLORS = {
  chrome: { color: '#4285F4', bg: 'rgba(66, 133, 244, 0.15)', border: 'rgba(66, 133, 244, 0.4)' },
  edge: { color: '#0078D4', bg: 'rgba(0, 120, 212, 0.15)', border: 'rgba(0, 120, 212, 0.4)' },
  firefox: { color: '#FF7139', bg: 'rgba(255, 113, 57, 0.15)', border: 'rgba(255, 113, 57, 0.4)' },
  safari: { color: '#006CFF', bg: 'rgba(0, 108, 255, 0.15)', border: 'rgba(0, 108, 255, 0.4)' },
  other: { color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.4)' }
};

/**
 * Format a timestamp as relative time (e.g., "2m ago", "1h ago", "3d ago")
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return null;

  const now = Date.now();
  const diff = now - timestamp;

  // Less than a minute
  if (diff < 60000) {
    return 'just now';
  }

  // Less than an hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }

  // Less than a day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Less than a week
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days}d ago`;
  }

  // More than a week - show date
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Get page text content from a tab via content script
 */
async function getTabPageText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Extract main content text from the page
        const selectors = [
          'article',
          'main',
          '[role="main"]',
          '.content',
          '.post-content',
          '.article-content',
          '#content',
          '.entry-content'
        ];

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText?.length > 100) {
            return el.innerText.slice(0, 5000);
          }
        }

        // Fallback to body
        const body = document.body?.innerText || '';
        return body.slice(0, 5000);
      }
    });
    return results?.[0]?.result || '';
  } catch (e) {
    console.warn('Failed to get page text:', e);
    return '';
  }
}

/**
 * TabCard - Card component for displaying browser tabs in spatial interface
 * Follows WorkspaceCard design pattern with tab-specific features
 * Memoized to prevent unnecessary re-renders
 */
export const TabCard = memo(function TabCard({ tab, onClick, onClose, onPin, onKillPort = null, isPinned = false, isActive = false, isLastActive = false, lastAccessedAt = null }) {
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  // Two-step confirm for the destructive "kill dev server" action.
  const [confirmKill, setConfirmKill] = useState(false);
  const [killing, setKilling] = useState(false);
  const confirmTimer = useRef(null);

  if (!tab) return null;

  const { url, title, favIconUrl, browser } = tab;
  const hostname = url ? safeGetHostname(url) : 'Unknown';
  const colorClass = ICON_COLORS[Math.abs(hostname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const faviconUrl = favIconUrl || getFaviconUrl(url, 16);
  const relativeTime = formatRelativeTime(lastAccessedAt);
  const browserStyle = BROWSER_COLORS[browser] || BROWSER_COLORS.other;
  // Port behind a local dev tab (used by the optional "kill server" action).
  const devPort = (() => {
    try {
      const u = new URL(url);
      return u.port || (u.protocol === 'https:' ? '443' : '80');
    } catch {
      return null;
    }
  })();

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

  // First click arms the confirm (auto-disarms after 3s); second click kills.
  const handleKill = (e) => {
    e.stopPropagation();
    if (!confirmKill) {
      setConfirmKill(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmKill(false);
    setKilling(true);
    Promise.resolve(onKillPort?.(tab, devPort)).finally(() => setKilling(false));
  };

  const handleSummarize = async (e) => {
    e.stopPropagation();

    if (summary) {
      setShowSummary(!showSummary);
      return;
    }

    setSummarizing(true);
    try {
      // Get page text from the tab
      const pageText = await getTabPageText(tab.id);

      if (!pageText || pageText.length < 50) {
        setSummary('Not enough content to summarize.');
        setShowSummary(true);
        return;
      }

      // Request summarization from background
      const response = await chrome.runtime.sendMessage({
        type: 'NANO_AI_SUMMARIZE',
        text: pageText,
        maxLength: 80
      });

      if (response?.success) {
        setSummary(response.summary);
      } else {
        setSummary(response?.error || 'Summarization unavailable');
      }
      setShowSummary(true);
    } catch (err) {
      setSummary('Failed to summarize: ' + err.message);
      setShowSummary(true);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div
      className={`cooldesk-tab-card ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${isLastActive ? 'last-active' : ''}`}
      onClick={handleCardClick}
      style={{
        borderLeftWidth: browser ? '3px' : undefined,
        borderLeftStyle: browser ? 'solid' : undefined,
        borderLeftColor: browser ? browserStyle.color : undefined
      }}
    >
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
          <div className="tab-hostname">
            {hostname}
            {relativeTime && (
              <span className="tab-last-accessed" title="Last accessed">
                <FontAwesomeIcon icon={faClock} style={{ fontSize: '9px', marginLeft: '8px', marginRight: '3px', opacity: 0.7 }} />
                {relativeTime}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary display */}
      {showSummary && summary && (
        <div className="tab-summary" onClick={(e) => e.stopPropagation()}>
          <div className="tab-summary-content">{summary}</div>
          <button
            className="tab-summary-close"
            onClick={(e) => {
              e.stopPropagation();
              setShowSummary(false);
            }}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="tab-actions">
        {/* <button
          className="tab-action-btn summarize-btn"
          onClick={handleSummarize}
          title={summary ? (showSummary ? 'Hide summary' : 'Show summary') : 'Summarize with AI'}
          disabled={summarizing}
        >
          <FontAwesomeIcon icon={summarizing ? faSpinner : faMagic} spin={summarizing} />
        </button> */}
        {onKillPort && devPort && (
          <button
            className="tab-action-btn kill-btn"
            onClick={handleKill}
            disabled={killing}
            title={confirmKill ? `Click again to kill the server on port ${devPort}` : `Kill the dev server on port ${devPort}`}
            style={{
              width: confirmKill ? 'auto' : undefined,
              padding: confirmKill ? '0 8px' : undefined,
              color: confirmKill ? '#F87171' : '#FB923C',
              background: confirmKill ? 'rgba(239, 68, 68, 0.18)' : undefined,
              fontSize: confirmKill ? '11px' : undefined,
              fontWeight: 600,
              gap: '4px'
            }}
          >
            <FontAwesomeIcon icon={faPowerOff} spin={killing} />
            {confirmKill && <span>Kill :{devPort}?</span>}
          </button>
        )}
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
/**
 * AppCard - Card component for displaying running desktop apps
 * Similar to TabCard but for native applications
 */
export const AppCard = memo(function AppCard({ app, onClick, onKill = null }) {
  const [confirmKill, setConfirmKill] = useState(false);
  const [killing, setKilling] = useState(false);
  const confirmTimer = useRef(null);

  if (!app) return null;

  const { name, title, icon, pid } = app;
  const displayName = title || name || 'Unknown App';
  const colorClass = ICON_COLORS[Math.abs((name || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];

  const handleClick = () => {
    onClick?.(app);
  };

  // First click arms confirm (auto-disarms after 3s); second click kills.
  const handleKill = (e) => {
    e.stopPropagation();
    if (!confirmKill) {
      setConfirmKill(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmKill(false);
    setKilling(true);
    Promise.resolve(onKill?.(app)).finally(() => setKilling(false));
  };

  return (
    <div className="cooldesk-tab-card app-card" onClick={handleClick}>
      <div className="tab-card-header">
        <div className={`tab-icon ${colorClass}`}>
          {icon ? (
            <img
              src={icon}
              alt=""
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                objectFit: 'contain'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextElementSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <FontAwesomeIcon
            icon={faDesktop}
            style={{ display: icon ? 'none' : 'flex' }}
          />
        </div>
        <div className="tab-info">
          <div className="tab-title" title={displayName}>
            {displayName}
          </div>
          <div className="tab-hostname">
            {name !== title && name ? name : 'Running'}
          </div>
        </div>
        {onKill && pid && (
          <button
            className="tab-action-btn app-kill-btn"
            onClick={handleKill}
            disabled={killing}
            title={confirmKill ? `Click again to force-quit ${displayName}` : `Force-quit ${displayName}`}
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              padding: confirmKill ? '0 8px' : undefined,
              width: confirmKill ? 'auto' : undefined,
              color: confirmKill ? '#F87171' : '#FB923C',
              background: confirmKill ? 'rgba(239, 68, 68, 0.18)' : undefined,
              fontSize: confirmKill ? '11px' : undefined,
              fontWeight: 600,
              gap: '4px',
              // Stay visible once armed even if the pointer leaves the card.
              opacity: confirmKill ? 1 : undefined
            }}
          >
            <FontAwesomeIcon icon={faPowerOff} spin={killing} />
            {confirmKill && <span>Quit?</span>}
          </button>
        )}
      </div>
    </div>
  );
});

// List a directory's entries ({ path, date, is_dir }) — Electron shim if
// present, otherwise the Tauri `list_dir` command. Same source Spotlight's
// folder tree uses, so both render identical contents.
async function listDirAny(path) {
  if (window.electronAPI?.listDir) return window.electronAPI.listDir(path);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('list_dir', { path });
}

function baseName(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * FolderCard - Card for frequently visited folders. Header click opens the
 * folder in the system file manager; the card expands inline to browse its
 * contents (Spotlight-style tree: subfolders drill deeper, files open on click).
 */
export const FolderCard = memo(function FolderCard({ folder, onClick }) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Nested subfolders currently open inside the tree
  const [openPaths, setOpenPaths] = useState(() => new Set());
  // path -> children entries, loaded once per folder then cached
  const [childrenCache, setChildrenCache] = useState({});

  if (!folder?.path) return null;

  const { name, path } = folder;
  const colorClass = ICON_COLORS[Math.abs(path.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  // Compact the path for display: "C:\Users\me\projects\app" → "~\projects\app"
  const shortPath = path.replace(/^[A-Za-z]:\\Users\\[^\\]+/i, '~');

  const loadChildren = (p) => {
    if (childrenCache[p]) return;
    listDirAny(p)
      .then(items => setChildrenCache(prev => ({ ...prev, [p]: Array.isArray(items) ? items : [] })))
      .catch(() => setChildrenCache(prev => ({ ...prev, [p]: [] })));
  };

  const toggleCard = (e) => {
    e.stopPropagation();
    const next = !isExpanded;
    setIsExpanded(next);
    if (next) loadChildren(path);
  };

  const toggleDir = (e, p) => {
    e.stopPropagation();
    setOpenPaths(prev => {
      const next = new Set(prev);
      if (next.has(p)) {
        next.delete(p);
      } else {
        next.add(p);
        loadChildren(p);
      }
      return next;
    });
  };

  // Open any path (folder or file) with the system handler.
  const openPath = (e, p) => {
    e.stopPropagation();
    onClick?.({ name: baseName(p), path: p });
  };

  // Flatten the tree (children of expanded folders, recursively) into rows.
  const MAX_PER_LEVEL = 15;
  const rows = [];
  const walk = (p, depth) => {
    const kids = childrenCache[p];
    if (!kids) return;
    kids.slice(0, MAX_PER_LEVEL).forEach(k => {
      rows.push({ ...k, depth });
      if (k.is_dir && openPaths.has(k.path)) walk(k.path, depth + 1);
    });
    if (kids.length > MAX_PER_LEVEL) {
      rows.push({ path: p, more: kids.length - MAX_PER_LEVEL, depth });
    }
  };
  if (isExpanded) walk(path, 0);
  const loading = isExpanded && !childrenCache[path];

  return (
    <div className={`cooldesk-tab-group-card ${isExpanded ? 'expanded' : ''}`}>
      <div className="tab-group-header" onClick={(e) => openPath(e, path)} style={{ cursor: 'pointer' }} title={path}>
        <div className={`tab-group-icon ${colorClass}`}>
          <FontAwesomeIcon icon={faFolderOpen} />
        </div>
        <div className="tab-group-info">
          <div className="tab-group-domain">{name}</div>
          <div className="tab-group-subtitle">{shortPath}</div>
        </div>
      </div>

      <button
        className={`tab-group-expand-btn ${isExpanded ? 'expanded' : ''}`}
        onClick={toggleCard}
        title={isExpanded ? 'Hide folder contents' : 'Browse folder contents'}
      >
        <span className="expand-btn-text">
          {isExpanded ? 'Hide contents' : 'Browse contents'}
        </span>
        <FontAwesomeIcon icon={faChevronDown} className="expand-btn-icon" />
      </button>

      {isExpanded && (
        <div className="tab-group-tabs">
          {loading && (
            <div style={{ padding: '8px 10px', fontSize: 'var(--font-xs, 11px)', color: 'var(--text-secondary, #64748B)' }}>
              Loading…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 'var(--font-xs, 11px)', color: 'var(--text-secondary, #64748B)' }}>
              Empty folder
            </div>
          )}
          {rows.map((row, idx) => {
            // One guide line per ancestor level keeps the hierarchy readable.
            const guides = Array.from({ length: row.depth }, (_, i) => (
              <span key={i} className="folder-tree-guide" />
            ));
            if (row.more) {
              return (
                <div
                  key={`more-${row.path}-${idx}`}
                  className="tab-group-item folder-tree-row"
                  style={{ opacity: 0.7 }}
                  onClick={(e) => openPath(e, row.path)}
                  title="Open in file manager to see everything"
                >
                  {guides}
                  <span className="folder-tree-caret" />
                  <div className="tab-group-item-text">+{row.more} more…</div>
                </div>
              );
            }
            const isOpen = row.is_dir && openPaths.has(row.path);
            return (
              <div
                key={row.path}
                className="tab-group-item folder-tree-row"
                onClick={(e) => (row.is_dir ? toggleDir(e, row.path) : openPath(e, row.path))}
                title={row.path}
              >
                {guides}
                <span className="folder-tree-caret">
                  {row.is_dir && (
                    <FontAwesomeIcon
                      icon={faChevronDown}
                      style={{
                        fontSize: '9px',
                        opacity: 0.7,
                        transform: isOpen ? 'none' : 'rotate(-90deg)',
                        transition: 'transform 0.15s ease'
                      }}
                    />
                  )}
                </span>
                <div className="tab-group-item-icon">
                  <FontAwesomeIcon
                    icon={row.is_dir ? (isOpen ? faFolderOpen : faFolder) : faFile}
                    style={{ color: row.is_dir ? '#FACC15' : '#94A3B8' }}
                  />
                </div>
                <div className="tab-group-item-text">{baseName(row.path)}</div>
                {row.is_dir && (
                  <button
                    className="tab-group-item-close"
                    onClick={(e) => openPath(e, row.path)}
                    title="Open in file manager"
                  >
                    <FontAwesomeIcon icon={faExternalLinkAlt} style={{ fontSize: '9px' }} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export const TabGroupCard = memo(function TabGroupCard({ domain, tabs = [], onToggleExpand, onTabClick, onTabClose, isExpanded = false, groupColor = null }) {
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
    <div
      className={`cooldesk-tab-group-card ${isExpanded ? 'expanded' : ''}`}
      style={groupColor ? { borderLeftColor: groupColor, borderLeftWidth: '4px', borderLeftStyle: 'solid' } : undefined}
    >
      {/* Tab count badge - positioned top right */}
      <div className="tab-group-count-badge">
        <span>{tabs.length}</span>
      </div>

      <div className="tab-group-header" onClick={handleHeaderClick} style={{ cursor: 'pointer' }}>
        <div
          className={`tab-group-icon ${groupColor ? '' : colorClass}`}
          style={groupColor ? { background: `${groupColor}22`, border: `1px solid ${groupColor}44`, color: groupColor } : undefined}
        >
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
            {domain || 'Other'}
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

// Task colors matching taskManager.js
const TASK_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'cyan', 'red', 'yellow'];

/**
 * TaskGroupCard - Card for displaying grouped tabs by task (Task-First Tab Modeling)
 * Similar to TabGroupCard but organized by user tasks/intent rather than domain
 */
export const TaskGroupCard = memo(function TaskGroupCard({
  task,
  tabs = [],
  isActive = false,
  onTabClick,
  onTabClose,
  onRename,
  onAIName
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task?.name || '');

  if (!task || tabs.length === 0) return null;

  const topTab = tabs[0];
  const colorClass = TASK_COLORS[task.colorIndex % TASK_COLORS.length];
  const faviconUrl = topTab?.favIconUrl || getFaviconUrl(topTab?.url, 16);

  const handleSaveName = () => {
    if (editName.trim() && editName !== task.name) {
      onRename?.(editName.trim());
    }
    setIsEditing(false);
  };

  const handleHeaderClick = () => {
    onTabClick?.(topTab);
  };

  return (
    <div className={`cooldesk-task-group-card ${isActive ? 'active-task' : ''}`}
      style={{ borderLeftColor: `var(--color-${colorClass}, ${colorClass})` }}
    >
      {/* Tab count badge */}
      <div className="tab-group-count-badge">
        <span>{tabs.length}</span>
      </div>

      {/* Active task indicator */}
      {isActive && (
        <div className="task-active-badge">
          <FontAwesomeIcon icon={faBolt} />
          <span>Active</span>
        </div>
      )}

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
            icon={faTasks}
            style={{ display: faviconUrl ? 'none' : 'flex' }}
          />
        </div>

        <div className="tab-group-info">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') {
                  setEditName(task.name);
                  setIsEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="task-name-input"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color, #475569)',
                borderRadius: '4px',
                padding: '2px 6px',
                color: 'inherit',
                fontSize: 'inherit',
                fontWeight: 'inherit',
                width: '100%',
                outline: 'none'
              }}
            />
          ) : (
            <div
              className="tab-group-domain task-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <span>{task.name}</span>
              {!task.aiNamed && (
                <button
                  className="task-ai-name-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAIName?.();
                  }}
                  title="Generate AI name"
                  style={{
                    background: 'rgba(147, 51, 234, 0.2)',
                    border: '1px solid rgba(147, 51, 234, 0.4)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    color: '#A78BFA'
                  }}
                >
                  <FontAwesomeIcon icon={faMagic} />
                </button>
              )}
            </div>
          )}
          <div className="tab-group-subtitle">
            <FontAwesomeIcon icon={faClock} style={{ fontSize: '9px', marginRight: '4px', opacity: 0.7 }} />
            {formatRelativeTime(task.lastUpdated)} · {tabs.length} tab{tabs.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Expand/Collapse toggle */}
      <button
        className={`tab-group-expand-btn ${isExpanded ? 'expanded' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <span className="expand-btn-text">
          {isExpanded ? 'Hide tabs' : `Show ${tabs.length} tabs`}
        </span>
        <FontAwesomeIcon icon={faChevronDown} className="expand-btn-icon" />
      </button>

      {/* Expanded tab list */}
      {isExpanded && (
        <div className="tab-group-tabs">
          {tabs.map((tab, idx) => (
            <div
              key={tab.id || idx}
              className="tab-group-item"
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
          ))}
        </div>
      )}
    </div>
  );
});
