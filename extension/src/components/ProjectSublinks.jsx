import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../utils';
import { createLinkActionHandlers, isUrlPinned } from '../utils/linkActionHandlers.js';
import { ContextMenu } from './common/ContextMenu.jsx';

export function ProjectSublinks({ values = [], onDelete, onAddToWorkspace, tabs = [] }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [pinnedItems, setPinnedItems] = useState({});
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [selectedItem, setSelectedItem] = useState(null);

  // Handle individual item deletion by removing URL from workspace
  const handleItemDelete = useCallback(async (url) => {
    try {
      const hostname = new URL(url).hostname;
      const confirmed = confirm(`Remove this specific item from ${hostname} workspace?`);
      if (!confirmed) return;

      console.log('Attempting to delete individual item:', url);

      // Import database functions
      const db = await import('../db/index.js');

      try {
        // Get all workspaces
        const allWorkspaces = await db.listWorkspaces();
        let currentWorkspaceId = null;
        let currentWorkspace = null;

        // Find which workspace this item belongs to
        if (allWorkspaces && Array.isArray(allWorkspaces)) {
          for (const workspace of allWorkspaces) {
            if (workspace.values && workspace.values.some(v => v.url === url)) {
              currentWorkspaceId = workspace.id;
              currentWorkspace = workspace;
              break;
            }
          }
        }

        if (currentWorkspaceId && currentWorkspace) {
          // Filter out the item to be deleted
          const updatedValues = currentWorkspace.values.filter(v => v.url !== url);

          if (updatedValues.length === 0) {
            // If this was the last item, delete the entire workspace
            await db.deleteWorkspace(currentWorkspaceId);
            console.log('Deleted workspace as it was the last item');
          } else {
            // Otherwise, update the workspace with the remaining items
            await db.updateWorkspace(currentWorkspaceId, { values: updatedValues });
            console.log('Updated workspace by removing the item');
          }

          // Notify parent component
          if (onDelete) {
            const item = values.find(v => v.url === url);
            if (item) {
              await onDelete(url, [item], { individual: true });
            }
          }
        } else {
          console.log('Could not find workspace, using fallback delete');
          if (onDelete) {
            const item = values.find(v => v.url === url);
            if (item) {
              await onDelete(url, [item], { individual: true });
            }
          }
        }
      } catch (dbError) {
        console.error('Database error during individual deletion:', dbError);
        // Fallback to parent delete
        if (onDelete) {
          const item = values.find(v => v.url === url);
          if (item) {
            await onDelete(url, [item], { individual: true });
          }
        }
      }
    } catch (error) {
      console.error('Error in individual item deletion:', error);
      alert('Error deleting individual item. Please try again.');
    }
  }, [onDelete, values]);

  // Create action handlers
  const actionHandlers = useMemo(() => {
    return createLinkActionHandlers({
      tabs,
      onWorkspaceModalOpen: onAddToWorkspace,
      onDeleteConfirm: () => true, // Skip confirmation since we handle it above
      onDeleteAction: handleItemDelete,
      onSuccess: (result) => {
        if (result.action === 'pinned') {
          setPinnedItems(prev => ({ ...prev, [result.url]: true }));
        } else if (result.action === 'unpinned') {
          setPinnedItems(prev => ({ ...prev, [result.url]: false }));
        }
      },
      onError: (error) => {
        console.error('Action error:', error);
      }
    });
  }, [tabs, onDelete, onAddToWorkspace, values]);

  // Load pin status for all items
  useEffect(() => {
    const loadPinStatuses = async () => {
      const statuses = {};
      for (const item of values) {
        try {
          const pinned = await isUrlPinned(item.url);
          statuses[item.url] = pinned;
        } catch (error) {
          console.warn('Failed to check pin status:', error);
          statuses[item.url] = false;
        }
      }
      setPinnedItems(statuses);
    };
    if (values.length > 0) {
      loadPinStatuses();
    }
  }, [values]);

  // Utility function to truncate long titles
  const truncateTitle = (title, maxLength = 35) => {
    if (!title || title.length <= maxLength) return title;
    return title.slice(0, maxLength).trim() + '…';
  };

  const handleRightClick = (e, item) => {
    e.preventDefault();
    e.stopPropagation();

    setSelectedItem(item);
    setContextMenuPosition({
      x: e.clientX,
      y: e.clientY
    });
    setShowContextMenu(true);
  };

  if (!values || values.length === 0) {
    return null;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '12px'
    }}>
      {values.map((item, index) => {
        const domain = getDomainFromUrl(item.url);
        const originalTitle = item.title || item.extractedData?.title || domain || 'Untitled';
        const title = truncateTitle(originalTitle);

        return (
          <div
            key={index}
            style={{
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
              borderRadius: '8px',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onContextMenu={(e) => handleRightClick(e, item)}
          >
            {/* Main clickable area */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                window.open(item.url, '_blank');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flex: 1
              }}
            >
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <img
                  src={getFaviconUrl(item.url)}
                  alt=""
                  width={32}
                  height={32}
                  style={{ borderRadius: 6 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    color: 'var(--text, #ffffff)',
                    lineHeight: 1.4,
                    marginBottom: 2,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={originalTitle}
                >
                  {title}
                </div>
                {/* Show timing information if available */}
                {item.subtitle && (
                  <div style={{
                    fontSize: 12,
                    color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {item.subtitle}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              display: 'flex',
              gap: '4px',
              opacity: hoveredIndex === index ? 1 : 0,
              transition: 'opacity 0.2s ease'
            }}>
              {/* Three-dot menu button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRightClick(e, item);
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  padding: '4px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  width: '20px',
                  height: '20px'
                }}
                title="More options"
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.2)';
                  e.target.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.target.style.color = 'rgba(255, 255, 255, 0.7)';
                }}
              >
                ⋯
              </button>
            </div>
          </div>
        );
      })}

      {/* Context Menu */}
      {selectedItem && (
        <ContextMenu
          show={showContextMenu}
          onClose={() => setShowContextMenu(false)}
          url={selectedItem.url}
          title={selectedItem.title || selectedItem.extractedData?.title || getDomainFromUrl(selectedItem.url)}
          onPin={actionHandlers.handlePin}
          onDelete={actionHandlers.handleDelete}
          onOpen={actionHandlers.handleOpen}
          onAddToBookmarks={actionHandlers.handleAddToBookmarks}
          onAddToWorkspace={actionHandlers.handleAddToWorkspace}
          isPinned={pinnedItems[selectedItem.url] || false}
          position={contextMenuPosition}
        />
      )}
    </div>
  );
}