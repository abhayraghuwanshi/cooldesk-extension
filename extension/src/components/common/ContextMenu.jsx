import { faBookmark, faCopy, faExternalLinkAlt, faFolder, faFolderPlus, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listWorkspaces, addUrlToWorkspace } from '../../db/index.js';
import { getFaviconUrl } from '../../utils';

export function ContextMenu({
  show,
  onClose,
  url,
  title,
  onPin,
  onDelete,
  onOpen,
  onAddToBookmarks,
  isPinned = false,
  position = { x: 0, y: 0 }
}) {
  const menuRef = useRef(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load workspaces when component mounts
  useEffect(() => {
    if (show) {
      loadWorkspaces();
    }
  }, [show]);

  const loadWorkspaces = async () => {
    setLoading(true);
    try {
      const result = await listWorkspaces();
      const workspacesData = result?.data || result || [];
      setWorkspaces(Array.isArray(workspacesData) ? workspacesData : []);
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (show) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [show, onClose]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (show) {
      // Small delay to prevent immediate closing
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 50);

      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [show, onClose]);

  const handleAction = (action) => {
    action();
    onClose();
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(url).then(() => {
      console.log('URL copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy URL:', err);
    });
    onClose();
  };

  const handleCopyTitle = () => {
    navigator.clipboard.writeText(title || url).then(() => {
      console.log('Title copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy title:', err);
    });
    onClose();
  };

  const handleAddToWorkspace = async (workspace) => {
    try {
      await addUrlToWorkspace(workspace.id, {
        url,
        title: title || url,
        addedAt: Date.now()
      });
      console.log(`Added to workspace: ${workspace.name}`);
    } catch (err) {
      console.error('Failed to add to workspace:', err);
    }
    onClose();
  };

  if (!show) return null;

  // Calculate position to keep menu on screen
  const menuWidth = showWorkspaces ? 400 : 200;
  const menuHeight = showWorkspaces ? Math.min(350, 80 + workspaces.length * 40) : 120;

  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - menuWidth - 10),
    y: Math.min(position.y, window.innerHeight - menuHeight - 10)
  };

  const mainActions = [
    {
      id: 'pin',
      label: isPinned ? 'Unpin' : 'Pin',
      icon: faThumbtack,
      action: () => handleAction(() => onPin?.(url, title)),
      color: '#FF9500'
    },
    {
      id: 'workspaces',
      label: 'Add to Workspace',
      icon: faFolder,
      action: () => setShowWorkspaces(!showWorkspaces),
      hasSubmenu: true,
      color: '#34C759'
    }
  ];

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        top: adjustedPosition.y,
        left: adjustedPosition.x,
        width: menuWidth,
        background: 'var(--glass-bg, rgba(20, 20, 30, 0.95))',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
        borderRadius: '8px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        zIndex: 999999,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
        animation: 'contextMenuSlide 0.15s ease-out',
        overflow: 'hidden'
      }}
    >
      {/* URL Preview Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px',
        borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.02))'
      }}>
        <div style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <img
            src={getFaviconUrl(url)}
            alt=""
            width={14}
            height={14}
            style={{ borderRadius: 2 }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-primary, #ffffff)',
            fontWeight: '500',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {title || 'Link'}
          </div>
          <div style={{
            fontSize: '10px',
            color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {url}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        {/* Main Actions */}
        <div style={{
          flex: showWorkspaces ? '0 0 200px' : '1',
          padding: '4px 0'
        }}>
          {mainActions.map((action, index) => (
            <React.Fragment key={action.id}>
              <button
                onClick={action.action}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: 'var(--text-primary, #ffffff)',
                  fontSize: '14px',
                  transition: 'background-color 0.1s ease',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.08))';
                  if (action.hasSubmenu) {
                    setShowWorkspaces(true);
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FontAwesomeIcon
                    icon={action.icon}
                    style={{
                      color: action.color || 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
                      fontSize: '14px',
                      width: '14px'
                    }}
                  />
                  <span style={{ fontWeight: '500' }}>{action.label}</span>
                </div>
                {action.hasSubmenu && (
                  <span style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))'
                  }}>
                    ▶
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Workspace List */}
        {showWorkspaces && (
          <div style={{
            flex: '1',
            borderLeft: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            maxHeight: '280px',
            overflowY: 'auto',
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.02))'
          }}>
            <div style={{
              padding: '10px 12px 8px 12px',
              fontSize: '11px',
              color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
              fontWeight: '600',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))'
            }}>
              📁 Workspaces
            </div>

            {loading ? (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                fontSize: '12px',
                color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))'
              }}>
                Loading...
              </div>
            ) : workspaces.length === 0 ? (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                fontSize: '12px',
                color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))'
              }}>
                No workspaces available
              </div>
            ) : (
              workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  onClick={() => handleAddToWorkspace(workspace)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    color: 'var(--text-primary, #ffffff)',
                    fontSize: '13px',
                    transition: 'background-color 0.1s ease',
                    textAlign: 'left'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.1))';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'transparent';
                  }}
                >
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '4px',
                    background: 'linear-gradient(135deg, #34C759, #28A745)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    flexShrink: 0
                  }}>
                    📁
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: '500',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginBottom: '2px'
                    }}>
                      {workspace.name || 'Untitled Workspace'}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {(workspace.urls || []).length} item{(workspace.urls || []).length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes contextMenuSlide {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-5px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>,
    document.body
  );
}