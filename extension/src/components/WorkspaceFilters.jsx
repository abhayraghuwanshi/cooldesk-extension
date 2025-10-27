import React, { useEffect, useMemo, useRef, useState } from 'react';
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
}) {
  const workspaces = useMemo(() => {
    const set = new Set()
    items.forEach((i) => i.workspaceGroup && set.add(i.workspaceGroup))
    return Array.from(set)
  }, [items])

  const btnRefs = useRef([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [currentTab, setCurrentTab] = useState(null)
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, ws: null })

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

  const handleCreateWorkspace = async (name, description) => {
    try {
      if (onWorkspaceCreated) {
        await onWorkspaceCreated(name, description)
      }
      setShowCreateModal(false)
    } catch (error) {
      console.error('Error creating workspace:', error)
    }
  }

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
        {workspaces.map((ws, i) => (
          <button
            key={ws}
            onClick={() => onChange(ws)}
            ref={el => btnRefs.current[i] = el}
            style={{
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
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              height: '32px',
              justifyContent: 'center',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              outline: 'none',
              position: 'relative',
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
              try { e.preventDefault(); e.stopPropagation(); } catch {}
              setMenu({ open: true, x: e.clientX, y: e.clientY, ws })
            }}
          >
            {ws}
          </button>
        ))}
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
      )}

      <CreateWorkspaceModal
        show={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateWorkspace}
        currentTab={currentTab}
      />
    </>
  )
}
