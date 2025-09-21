import { faBookmark, faExternalLinkAlt, faFolder, faThumbtack, faTrash, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useRef } from 'react';
import { getFaviconUrl } from '../../utils';

export function SideOptionsPanel({
  show,
  onClose,
  url,
  title,
  onPin,
  onAddToWorkspace,
  onDelete,
  onOpen,
  onAddToBookmarks,
  isPinned = false,
  position = { x: 0, y: 0 }
}) {
  const panelRef = useRef(null);

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
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (show) {
      // Small delay to prevent immediate closing
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);

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

  if (!show) return null;

  const actions = [
    onOpen && {
      id: 'open',
      label: 'Open Link',
      icon: faExternalLinkAlt,
      action: () => onOpen(url),
      color: '#007AFF',
      description: 'Open in new tab'
    },
    onPin && {
      id: 'pin',
      label: isPinned ? 'Unpin' : 'Pin to Quick Access',
      icon: faThumbtack,
      action: () => onPin(url, title),
      color: '#FF9500',
      description: isPinned ? 'Remove from pins' : 'Add to pins for quick access'
    },
    onAddToWorkspace && {
      id: 'workspace',
      label: 'Add to Workspace',
      icon: faFolder,
      action: () => onAddToWorkspace(url, title),
      color: '#34C759',
      description: 'Organize in a workspace'
    },
    onAddToBookmarks && {
      id: 'bookmarks',
      label: 'Add to Bookmarks',
      icon: faBookmark,
      action: () => onAddToBookmarks(url, title),
      color: '#5856D6',
      description: 'Save to browser bookmarks'
    },
    onDelete && {
      id: 'delete',
      label: 'Delete',
      icon: faTrash,
      action: () => onDelete(url),
      color: '#FF3B30',
      description: 'Remove this item',
      separator: true
    }
  ].filter(Boolean);

  return (
    <div
      ref={panelRef}
      className="side-options-panel"
      style={{
        position: 'fixed',
        top: Math.min(position.y, window.innerHeight - 400),
        left: Math.min(position.x + 20, window.innerWidth - 320),
        width: '300px',
        background: 'var(--glass-bg, rgba(20, 20, 30, 0.95))',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
        borderRadius: '12px',
        boxShadow: '0 12px 48px rgba(0, 0, 0, 0.4)',
        zIndex: 10000,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
        animation: 'slideInFromRight 0.2s ease-out'
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 16px 12px 16px',
        borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flex: 1,
          minWidth: 0
        }}>
          <div style={{
            width: 24,
            height: 24,
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
              width={16}
              height={16}
              style={{ borderRadius: 2 }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '14px',
              color: 'var(--text-primary, #ffffff)',
              fontWeight: '500',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {title || 'Link Actions'}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            flexShrink: 0
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.1))';
            e.target.style.color = 'var(--text-primary, #ffffff)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'transparent';
            e.target.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.7))';
          }}
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>
      </div>

      {/* URL Preview */}
      {url && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.02))',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.05))'
        }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: 'monospace'
          }}>
            {url}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '8px 0' }}>
        {actions.map((action, index) => (
          <React.Fragment key={action.id}>
            {action.separator && index > 0 && (
              <div style={{
                height: '1px',
                background: 'var(--border-color, rgba(255, 255, 255, 0.1))',
                margin: '8px 16px'
              }} />
            )}
            <button
              onClick={() => handleAction(action.action)}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                color: 'var(--text-primary, #ffffff)',
                fontSize: '14px',
                transition: 'background-color 0.2s ease',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.08))';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'transparent';
              }}
            >
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: `${action.color}20`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <FontAwesomeIcon
                  icon={action.icon}
                  style={{
                    color: action.color,
                    fontSize: '14px'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '2px'
                }}>
                  {action.label}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
                  lineHeight: 1.3
                }}>
                  {action.description}
                </div>
              </div>
            </button>
          </React.Fragment>
        ))}
      </div>

      <style jsx>{`
        @keyframes slideInFromRight {
          from {
            opacity: 0;
            transform: translateX(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}