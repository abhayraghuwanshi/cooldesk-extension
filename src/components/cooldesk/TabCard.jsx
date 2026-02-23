
import { faBolt, faChevronDown, faClock, faDesktop, faExternalLinkAlt, faGlobe, faMagic, faTasks, faThumbtack, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useState } from 'react';
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
export const TabCard = memo(function TabCard({ tab, onClick, onClose, onPin, isPinned = false, isActive = false, isLastActive = false, lastAccessedAt = null }) {
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  if (!tab) return null;

  const { url, title, favIconUrl, browser } = tab;
  const hostname = url ? safeGetHostname(url) : 'Unknown';
  const colorClass = ICON_COLORS[Math.abs(hostname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];
  const faviconUrl = favIconUrl || getFaviconUrl(url, 16);
  const relativeTime = formatRelativeTime(lastAccessedAt);
  const browserStyle = BROWSER_COLORS[browser] || BROWSER_COLORS.other;

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
export const AppCard = memo(function AppCard({ app, onClick }) {
  if (!app) return null;

  const { name, title, icon, pid } = app;
  const displayName = title || name || 'Unknown App';
  const colorClass = ICON_COLORS[Math.abs((name || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ICON_COLORS.length];

  const handleClick = () => {
    onClick?.(app);
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
      </div>
    </div>
  );
});

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
