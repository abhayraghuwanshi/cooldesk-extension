import { useEffect, useMemo, useRef, useState } from 'react';
import { CreateWorkspaceModal } from './popups/CreateWorkspaceModal';

export function WorkspaceFilters({
  items,
  active,
  onChange,
  onWorkspaceCreated,
  onPinWorkspace,
  onDeleteWorkspace,
  onAddLink,
  pinnedWorkspaces = [],
  onWorkspaceReordered,
  onShareWorkspaceUrl,
}) {
  const [workspaces, setWorkspaces] = useState(() => {
    const set = new Set();
    items.forEach((i) => i.workspaceGroup && set.add(i.workspaceGroup));
    return Array.from(set);
  });

  // Track workspace usage/activity
  const [workspaceActivity, setWorkspaceActivity] = useState(() => {
    const saved = localStorage.getItem('workspace_activity');
    return saved ? JSON.parse(saved) : {};
  });

  const [sortBy, setSortBy] = useState('manual'); // 'activity', 'name', 'manual' - changed to manual to prevent chaos
  const VISIBLE_WORKSPACES_LIMIT = 5;
  const [isInteracting, setIsInteracting] = useState(false);

  // Update workspaces when items change (but not during interaction)
  useEffect(() => {
    // Skip updates while user is interacting to prevent chaos
    if (isInteracting) return;

    const newWorkspaces = [];
    const seen = new Set();

    // First, keep the existing order for workspaces that still exist
    workspaces.forEach(ws => {
      if (items.some(item => item.workspaceGroup === ws)) {
        newWorkspaces.push(ws);
        seen.add(ws);
      }
    });

    // Then add any new workspaces that weren't in the list
    items.forEach(item => {
      if (item.workspaceGroup && !seen.has(item.workspaceGroup)) {
        newWorkspaces.push(item.workspaceGroup);
        seen.add(item.workspaceGroup);
      }
    });

    setWorkspaces(newWorkspaces);
  }, [items, isInteracting]);

  // Track workspace activity when switching (without causing re-sort immediately)
  const trackWorkspaceActivity = (workspaceName) => {
    const now = Date.now();
    const newActivity = {
      ...workspaceActivity,
      [workspaceName]: {
        lastAccessed: now,
        accessCount: (workspaceActivity[workspaceName]?.accessCount || 0) + 1,
        totalItems: items.filter(item => item.workspaceGroup === workspaceName).length
      }
    };

    // Update activity in background without triggering re-sort
    localStorage.setItem('workspace_activity', JSON.stringify(newActivity));

    // Delay the state update to prevent immediate re-sort chaos
    setTimeout(() => {
      setWorkspaceActivity(newActivity);
    }, 300);
  };

  // Sort workspaces based on selected method (memoized to prevent chaos)
  const sortedWorkspaces = useMemo(() => {
    const sorted = [...workspaces];

    switch (sortBy) {
      case 'activity':
        return sorted.sort((a, b) => {
          const aActivity = workspaceActivity[a] || { lastAccessed: 0, accessCount: 0 };
          const bActivity = workspaceActivity[b] || { lastAccessed: 0, accessCount: 0 };

          // Sort by last accessed first, then by access count
          if (aActivity.lastAccessed !== bActivity.lastAccessed) {
            return bActivity.lastAccessed - aActivity.lastAccessed;
          }
          return bActivity.accessCount - aActivity.accessCount;
        });
      case 'name':
        return sorted.sort((a, b) => a.localeCompare(b));
      case 'manual':
      default:
        return sorted;
    }
  }, [workspaces, sortBy, workspaceActivity]);

  // Handle drag start
  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index);
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  };

  // Handle drag over
  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const draggedIndex = Number(e.dataTransfer.getData('text/plain'));
    if (draggedIndex === index) return;

    const newWorkspaces = [...workspaces];
    const [removed] = newWorkspaces.splice(draggedIndex, 1);
    newWorkspaces.splice(index, 0, removed);

    setWorkspaces(newWorkspaces);
    if (onWorkspaceReordered) {
      onWorkspaceReordered(newWorkspaces);
    }
  };

  // Handle drag end
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
  };

  // Handle drop
  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.style.opacity = '1';
  };

  const btnRefs = useRef([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [currentTab, setCurrentTab] = useState(null)
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, ws: null })
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)

  // Get current tab when modal opens
  useEffect(() => {
    if (showCreateModal) {
      const getCurrentTab = async () => {
        try {
          if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            setCurrentTab(tab)
          }
        } catch (error) {
          console.warn('Could not get current tab:', error)
        }
      }
      getCurrentTab()
    }
  }, [showCreateModal])

  // Close context menu on outside click or Escape
  useEffect(() => {
    const onClick = () => setMenu({ open: false, x: 0, y: 0, ws: null })
    const onKey = (e) => { if (e.key === 'Escape') setMenu({ open: false, x: 0, y: 0, ws: null }) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const handleWorkspaceClick = (workspaceName) => {
    trackWorkspaceActivity(workspaceName);
    onChange(workspaceName);
  };

  const handleCreateWorkspace = async (name, description) => {
    try {
      if (onWorkspaceCreated) {
        await onWorkspaceCreated(name, description)
      }
      setShowCreateModal(false)
    } catch (error) {
      console.error('Error creating workspace:', error)
    }
  };

  return (
    <>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '16px',
        alignItems: 'center',
        marginBottom: '8px'
      }}>
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            padding: '8px 12px',
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: 'var(--font-size-base)',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            height: '32px',
            justifyContent: 'center',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            outline: 'none',
            position: 'relative',
            whiteSpace: 'nowrap',
            gap: '6px'
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'rgba(255, 255, 255, 0.12)';
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(255, 255, 255, 0.08)';
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </button>
        {sortedWorkspaces.slice(0, showAllWorkspaces ? sortedWorkspaces.length : VISIBLE_WORKSPACES_LIMIT).map((ws, i) => (
          <button
            key={ws}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            onClick={() => handleWorkspaceClick(ws)}
            ref={el => btnRefs.current[i] = el}
            style={{
              cursor: 'grab',
              userSelect: 'none',
              touchAction: 'none',
              position: 'relative',
              background: ws === active
                ? 'rgba(255, 255, 255, 0.15)'
                : 'rgba(255, 255, 255, 0.08)',
              border: ws === active
                ? '1px solid rgba(255, 255, 255, 0.3)'
                : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '8px 12px',
              color: 'rgba(255, 255, 255, 0.85)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,

              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              height: '32px',
              justifyContent: 'center',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              outline: 'none',

              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              if (ws !== active) {
                e.target.style.background = 'rgba(255, 255, 255, 0.12)';
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (ws !== active) {
                e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              }
            }}
            onContextMenu={(e) => {
              try { e.preventDefault(); e.stopPropagation(); } catch { }
              setMenu({ open: true, x: e.clientX, y: e.clientY, ws })
            }}
          >
            {ws}
          </button>
        ))}
        {sortedWorkspaces.length > VISIBLE_WORKSPACES_LIMIT && (
          <button
            onClick={() => setShowAllWorkspaces(!showAllWorkspaces)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '8px 12px',
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              height: '32px',
              justifyContent: 'center',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              outline: 'none',
              whiteSpace: 'nowrap',
              gap: '4px',
              marginLeft: '4px'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.05)';
              e.target.style.color = 'rgba(255, 255, 255, 0.8)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent';
              e.target.style.color = 'rgba(255, 255, 255, 0.6)';
            }}
          >
            {showAllWorkspaces ? (
              <>
                <span>Show Less</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'rotate(180deg)' }}>
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </>
            ) : (
              <>
                <span>Show {sortedWorkspaces.length - VISIBLE_WORKSPACES_LIMIT} More</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </>
            )}
          </button>
        )}
      </div>

      {menu.open && (
        <div
          style={{
            position: 'fixed',
            top: `${menu.y}px`,
            left: `${menu.x}px`,
            background: 'rgba(28,28,33,0.98)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            minWidth: 160,
            zIndex: 9999,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Pin/Unpin */}
          {(() => {
            const isPinned = Array.isArray(pinnedWorkspaces) && pinnedWorkspaces.includes(menu.ws)
            const label = isPinned ? 'Unpin from Pinned Workspaces' : 'Pin to Pinned Workspaces'
            return (
              <button
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'transparent',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13
                }}
                onClick={() => {
                  if (typeof onPinWorkspace === 'function') {
                    onPinWorkspace(menu.ws)
                  }
                  setMenu({ open: false, x: 0, y: 0, ws: null })
                }}
              >
                {label}
              </button>
            )
          })()}

          {/* Add Link */}
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              textAlign: 'left',
              background: 'transparent',
              color: '#34c759',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13
            }}
            onClick={() => {
              setMenu({ open: false, x: 0, y: 0, ws: null })
              if (typeof onAddLink === 'function' && menu.ws) {
                onAddLink(menu.ws)
              }
            }}
          >
            Add link to workspace
          </button>

          {/* Share URL to team workspace */}
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              textAlign: 'left',
              background: 'transparent',
              color: '#60a5fa',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13
            }}
            onClick={() => {
              setMenu({ open: false, x: 0, y: 0, ws: null })
              if (typeof onShareWorkspaceUrl === 'function' && menu.ws) {
                onShareWorkspaceUrl(menu.ws)
              }
            }}
          >
            Share URL to team workspace
          </button>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />

          {/* Delete */}
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              textAlign: 'left',
              background: 'transparent',
              color: '#fca5a5',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13
            }}
            onClick={() => {
              const ws = menu.ws
              setMenu({ open: false, x: 0, y: 0, ws: null })
              if (!ws) return
              const ok = confirm(`Delete workspace "${ws}"? This cannot be undone.`)
              if (!ok) return
              if (typeof onDeleteWorkspace === 'function') {
                try { onDeleteWorkspace(ws) } catch (err) { console.error('Delete workspace failed:', err) }
              }
            }}
          >
            Delete workspace
          </button>
        </div>
      )
      }

      < CreateWorkspaceModal
        show={showCreateModal}
        onClose={() => setShowCreateModal(false)
        }
        onCreate={handleCreateWorkspace}
        currentTab={currentTab}
      />
    </>
  )
}
