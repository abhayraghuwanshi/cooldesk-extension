import { faBookmark, faEllipsisV, faExternalLinkAlt, faFolder, faPlus, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useRef, useState } from 'react';

export function LinkActions({
  url,
  title,
  onPin,
  onAddToWorkspace,
  onDelete,
  onOpen,
  onAddToBookmarks,
  showPin = true,
  showWorkspace = true,
  showDelete = true,
  showOpen = true,
  showBookmarks = true,
  isPinned = false,
  className = '',
  style = {},
  triggerIcon = faEllipsisV,
  position = 'bottom-right' // bottom-right, bottom-left, top-right, top-left
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const handleAction = (action, e) => {
    e.stopPropagation();
    setIsOpen(false);
    action();
  };

  const getDropdownPosition = () => {
    const positions = {
      'bottom-right': { top: '100%', left: '0', marginTop: '4px' },
      'bottom-left': { top: '100%', right: '0', marginTop: '4px' },
      'top-right': { bottom: '100%', left: '0', marginBottom: '4px' },
      'top-left': { bottom: '100%', right: '0', marginBottom: '4px' }
    };
    return positions[position] || positions['bottom-right'];
  };

  const actions = [
    showOpen && onOpen && {
      id: 'open',
      label: 'Open Link',
      icon: faExternalLinkAlt,
      action: () => onOpen(url),
      color: '#007AFF'
    },
    showPin && onPin && {
      id: 'pin',
      label: isPinned ? 'Unpin' : 'Add to Pins',
      icon: faThumbtack,
      action: () => onPin(url, title),
      color: isPinned ? '#FF9500' : '#FF9500'
    },
    showWorkspace && onAddToWorkspace && {
      id: 'workspace',
      label: 'Add to Workspace',
      icon: faFolder,
      action: () => onAddToWorkspace(url, title),
      color: '#34C759'
    },
    showBookmarks && onAddToBookmarks && {
      id: 'bookmarks',
      label: 'Add to Bookmarks',
      icon: faBookmark,
      action: () => onAddToBookmarks(url, title),
      color: '#5856D6'
    },
    showDelete && onDelete && {
      id: 'delete',
      label: 'Delete',
      icon: faTrash,
      action: () => onDelete(url),
      color: '#FF3B30',
      separator: true
    }
  ].filter(Boolean);

  if (actions.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className={`link-actions ${className}`}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style
      }}
    >
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="link-actions-trigger"
        style={{
          background: 'transparent',
          border: 'none',
          padding: '4px 6px',
          borderRadius: '4px',
          cursor: 'pointer',
          color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px'
        }}
        onMouseEnter={(e) => {
          e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.1))';
          e.target.style.color = 'var(--text-primary, #ffffff)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = 'transparent';
          e.target.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.7))';
        }}
        title="Link actions"
      >
        <FontAwesomeIcon icon={triggerIcon} />
      </button>

      {isOpen && (
        <div
          className="link-actions-dropdown"
          style={{
            position: 'absolute',
            ...getDropdownPosition(),
            background: 'var(--glass-bg, rgba(20, 20, 30, 0.95))',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            borderRadius: '8px',
            padding: '4px 0',
            minWidth: '160px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            fontSize: '13px'
          }}
        >
          {actions.map((action, index) => (
            <React.Fragment key={action.id}>
              {action.separator && index > 0 && (
                <div style={{
                  height: '1px',
                  background: 'var(--border-color, rgba(255, 255, 255, 0.1))',
                  margin: '4px 0'
                }} />
              )}
              <button
                onClick={(e) => handleAction(action.action, e)}
                className="link-action-item"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-primary, #ffffff)',
                  fontSize: '13px',
                  transition: 'background-color 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.1))';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'transparent';
                }}
              >
                <FontAwesomeIcon
                  icon={action.icon}
                  style={{
                    color: action.color,
                    fontSize: '12px',
                    width: '12px'
                  }}
                />
                <span>{action.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// Convenience component for common use cases
export function QuickLinkActions({ url, title, onPin, onAddToWorkspace, onDelete, isPinned }) {
  return (
    <LinkActions
      url={url}
      title={title}
      onPin={onPin}
      onAddToWorkspace={onAddToWorkspace}
      onDelete={onDelete}
      isPinned={isPinned}
      showOpen={false}
      showBookmarks={false}
      triggerIcon={faEllipsisV}
      position="bottom-right"
    />
  );
}

// Minimal actions for space-constrained areas
export function MiniLinkActions({ url, onPin, onDelete, isPinned }) {
  return (
    <LinkActions
      url={url}
      onPin={onPin}
      onDelete={onDelete}
      isPinned={isPinned}
      showWorkspace={false}
      showOpen={false}
      showBookmarks={false}
      triggerIcon={faEllipsisV}
      position="bottom-left"
      style={{ fontSize: '10px' }}
    />
  );
}