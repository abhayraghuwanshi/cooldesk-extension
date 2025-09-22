import { faTag, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import { formatTime, getDomainFromUrl, getFaviconUrl, getUrlParts } from '../utils';
import { createLinkActionHandlers, isUrlPinned } from '../utils/linkActionHandlers.js';
import { ContextMenu } from './common/ContextMenu.jsx';
import { QuickLinkActions } from './common/LinkActions.jsx';
import { WorkspaceSelectionModal } from './popups/WorkspaceSelectionModal.jsx';

export const WorkspaceItem = React.forwardRef(function WorkspaceItem({ base, values, onAddRelated, timeSpentMs, onDelete, onAddToWorkspace, tabs = [] }, ref) {
  const [showDetails, setShowDetails] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fallbackTimeMs, setFallbackTimeMs] = useState(0);
  const [isPinned, setIsPinned] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const favicon = getFaviconUrl(base);
  const cleanedBase = getUrlParts(base).key;
  const timeString = formatTime(timeSpentMs || fallbackTimeMs);


  useEffect(() => {
    // Defer fetching per-item timeSpent until interaction to reduce initial load
    if (timeSpentMs) return; // parent provided
    if (!(showDetails || hovered)) return; // only fetch when needed
    let mounted = true;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
          if (!hasRuntime) return;
          const resp = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (res) => {
                const lastErr = chrome.runtime?.lastError;
                if (lastErr) return resolve({ ok: false, error: lastErr.message });
                resolve(res);
              });
            } catch (e) { resolve({ ok: false, error: String(e) }); }
          });
          if (mounted && resp?.ok) {
            const ms = resp.timeSpent?.[cleanedBase] || 0;
            setFallbackTimeMs(ms);
          }
        } catch (e) {
          // non-fatal
        }
      })();
    }, 300); // small delay to avoid blocking immediate interactions
    return () => { mounted = false; clearTimeout(timer); };
  }, [cleanedBase, timeSpentMs, showDetails, hovered]);

  // Load pin status
  useEffect(() => {
    const loadPinStatus = async () => {
      try {
        const pinned = await isUrlPinned(base);
        setIsPinned(pinned);
      } catch (error) {
        console.warn('Failed to check pin status:', error);
      }
    };
    loadPinStatus();
  }, [base]);

  // Create action handlers
  const actionHandlers = useMemo(() => {
    return createLinkActionHandlers({
      tabs,
      onWorkspaceModalOpen: (url, title) => {
        setShowWorkspaceModal(true);
      },
      onDeleteConfirm: (url) => {
        try {
          const hostname = new URL(url).hostname;
          return confirm(`Remove ${hostname} from this workspace?`);
        } catch {
          return confirm('Remove this item from workspace?');
        }
      },
      onDeleteAction: async (url) => {
        if (onDelete) {
          await onDelete(base, values);
        }
      },
      onSuccess: (result) => {
        if (result.action === 'pinned') {
          setIsPinned(true);
        } else if (result.action === 'unpinned') {
          setIsPinned(false);
        }
      },
      onError: (error) => {
        console.error('Action error:', error);
      }
    });
  }, [tabs, onDelete, base, values]);

  // Get unique tags from all items in the workspace
  const tags = useMemo(() => {
    const allTags = values.flatMap(item => item.tags || []);
    return [...new Set(allTags)];
  }, [values]);

  // Get workspace title
  const workspaceTitle = useMemo(() => {
    if (values && values.length > 0 && values[0].extractedData && values[0].extractedData.workspace) {
      return values[0].extractedData.workspace;
    }
    try {
      return new URL(base).hostname;
    } catch {
      return base.length > 40 ? base.slice(0, 37) + '…' : base;
    }
  }, [base, values]);

  const handleItemClick = () => {
    window.location.href = base;
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Get click position for context menu placement
    setContextMenuPosition({
      x: e.clientX,
      y: e.clientY
    });

    setShowContextMenu(true);
  };

  const toggleDetails = (e) => {
    e.stopPropagation();
    setShowDetails(!showDetails);
  };

  const handleGetRelated = (e) => {
    e.stopPropagation();
    onAddRelated(base, getDomainFromUrl(base));
  };


  return (
    <li
      className="workspace-item"
      tabIndex={0}
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={handleRightClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleItemClick();
        }
      }}
      style={{
        borderRadius: '12px',
        marginBottom: '12px',
        backdropFilter: 'blur(10px)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        position: 'relative'
      }}
      title="Right-click for options"
    >
      <div className="item-header" onClick={handleItemClick} style={{
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        {favicon && (
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <img
              src={favicon}
              alt=""
              width={18}
              height={18}
              style={{ borderRadius: 4 }}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Workspace Title - show workspace name instead of individual URL */}
          <div style={{
            fontSize: 16,
            color: 'var(--text, #ffffff)',
            lineHeight: 1.4,
            marginBottom: 2,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {workspaceTitle}
          </div>

          {/* URL Count and Platform Info */}
          <div style={{
            fontSize: 13,
            color: 'var(--text-dim, rgba(255, 255, 255, 0.7))',
            lineHeight: 1.4,
            marginBottom: 0,
            fontWeight: 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {(() => {
              if (values && values.length > 1) {
                // Check if this is an AI chat workspace with conversations
                const hasConversations = values.some(item =>
                  item.extractedData?.details?.type === 'conversation'
                );

                if (hasConversations) {
                  const conversationCount = values.filter(item =>
                    item.extractedData?.details?.type === 'conversation'
                  ).length;
                  return `${conversationCount} conversation${conversationCount !== 1 ? 's' : ''}`;
                } else {
                  return `${values.length} URLs`;
                }
              } else if (values && values.length > 0 && values[0].extractedData && values[0].extractedData.title) {
                return values[0].extractedData.title;
              } else {
                try {
                  return new URL(base).hostname;
                } catch {
                  return base.length > 40 ? base.slice(0, 37) + '…' : base;
                }
              }
            })()}
          </div>

          {/* Tags display */}
          {tags.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              marginTop: '6px',
              alignItems: 'center'
            }}>
              <FontAwesomeIcon
                icon={faTag}
                style={{
                  fontSize: '10px',
                  color: 'var(--text-dim, rgba(255, 255, 255, 0.5))',
                  marginRight: '2px'
                }}
              />
              {tags.slice(0, 3).map(tag => (
                <span
                  key={tag}
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    background: 'var(--tag-bg, rgba(255, 255, 255, 0.1))',
                    color: 'var(--text-dim, rgba(255, 255, 255, 0.7))',
                  }}
                >
                  {tag}
                </span>
              ))}
              {tags.length > 3 && (
                <span style={{
                  fontSize: '10px',
                  color: 'var(--text-dim, rgba(255, 255, 255, 0.5))'
                }}>
                  +{tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="item-actions" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '8px'
        }}>
          {/* Three-dot button for full menu */}
          <div style={{
            display: hovered ? 'block' : 'none'
          }}>
            <QuickLinkActions
              url={base}
              title={workspaceTitle}
              onPin={actionHandlers.handlePin}
              onAddToWorkspace={actionHandlers.handleAddToWorkspace}
              onDelete={actionHandlers.handleDelete}
              isPinned={isPinned}
              onTriggerClick={(e) => {
                // Get click position for context menu placement
                setContextMenuPosition({
                  x: e.clientX,
                  y: e.clientY
                });
                setShowContextMenu(true);
              }}
            />
          </div>
        </div>
      </div>

      {/* Context Menu - Right-click (Pin + Workspace only) */}
      <ContextMenu
        show={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        url={base}
        title={workspaceTitle}
        onPin={actionHandlers.handlePin}
        onDelete={actionHandlers.handleDelete}
        onOpen={actionHandlers.handleOpen}
        onAddToBookmarks={actionHandlers.handleAddToBookmarks}
        onAddToWorkspace={onAddToWorkspace}
        isPinned={isPinned}
        position={contextMenuPosition}
      />

      {/* Workspace Selection Modal - From three-dot menu */}
      <WorkspaceSelectionModal
        show={showWorkspaceModal}
        onClose={() => setShowWorkspaceModal(false)}
        url={base}
        title={workspaceTitle}
      />
    </li>
  );
});
