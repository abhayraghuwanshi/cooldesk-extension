import React, { useMemo, useRef, useState, useEffect } from 'react';
import { CreateWorkspaceModal } from './popups/CreateWorkspaceModal';

export function WorkspaceFilters({ items, active, onChange, onWorkspaceCreated }) {
  const workspaces = useMemo(() => {
    const set = new Set()
    items.forEach((i) => i.workspaceGroup && set.add(i.workspaceGroup))
    return Array.from(set)
  }, [items])

  const btnRefs = useRef([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [currentTab, setCurrentTab] = useState(null)

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
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          Create Workspace
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
            color: ws === active ? '#ffffff' : 'rgba(255, 255, 255, 0.8)',
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
        >
          {ws}
        </button>
        ))}
      </div>

      <CreateWorkspaceModal
        show={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateWorkspace}
        currentTab={currentTab}
      />
    </>
  )
}
