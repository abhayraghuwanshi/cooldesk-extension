import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CreateWorkspaceModal } from './popups/CreateWorkspaceModal';
import { getDropboxStatus } from '../dropbox/sync.js';
import { getFaviconUrl } from '../utils.js';

export function WorkspaceFilters({
  items,
  active,
  onChange,
  onWorkspaceCreated,
  onPinWorkspace,
  onDeleteWorkspace,
  pinnedWorkspaces = [],
  workspaceData = []
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

  const handleShareWorkspace = async (workspaceName) => {
    try {
      // Check if Dropbox is connected
      const status = await getDropboxStatus()
      if (!status?.connected) {
        alert('Please connect to Dropbox in Settings → Dropbox Sync to share workspaces')
        return
      }

      if (!workspaceName || workspaceName === 'All') {
        alert('Please select a specific workspace to share')
        return
      }

      const workspaceObj = workspaceData.find(ws => ws?.name === workspaceName)

      if (!workspaceObj) {
        console.warn('[WorkspaceShare] Workspace not found in workspaceData')
      }

      // Build item list from saved workspace URLs (preferred source)
      let workspaceItems = (workspaceObj?.urls || [])
        .map(urlItem => ({
          url: urlItem?.url,
          title: urlItem?.title || urlItem?.name || urlItem?.url,
          favicon: urlItem?.favicon,
          addedAt: urlItem?.addedAt || urlItem?.dateAdded || urlItem?.createdAt
        }))
        .filter(item => !!item.url)

      if ((!workspaceItems || workspaceItems.length === 0) && workspaceObj?.urls) {
        console.warn('[WorkspaceShare] Workspace URLs missing detailed data, falling back to items filter')
      }

      if (!workspaceItems || workspaceItems.length === 0) {
        workspaceItems = items
          .filter(item => item.workspaceGroup === workspaceName)
          .map(item => ({
            url: item.url || item.href || item.link,
            title: item.title || item.name || item.url || item.href || 'Untitled',
            favicon: item.favicon || getFaviconUrl(item.url || item.href),
            addedAt: item.dateAdded || item.createdAt || item.addedAt || Date.now()
          }))
          .filter(item => !!item.url)
      }

      console.log('[WorkspaceShare] Workspace object:', workspaceObj)
      console.log('[WorkspaceShare] Workspace items (processed):', workspaceItems)

      if (workspaceItems.length === 0) {
        alert('No items found in this workspace to share')
        return
      }

      // Group URLs by domain to avoid sharing individual chat links
      const domainGroups = {}
      workspaceItems.forEach(item => {
        try {
          const urlObj = new URL(item.url)
          const domain = urlObj.hostname.replace('www.', '')
          if (!domainGroups[domain]) {
            domainGroups[domain] = {
              urls: [],
              favicon: item.favicon,
              addedAt: item.addedAt
            }
          }
          domainGroups[domain].urls.push(item)
        } catch (e) {
          // Invalid URL, group under 'misc'
          if (!domainGroups['misc']) {
            domainGroups['misc'] = { urls: [], favicon: item.favicon, addedAt: item.addedAt }
          }
          domainGroups['misc'].urls.push(item)
        }
      })

      // Create representative URLs (one per domain)
      const groupedItems = Object.entries(domainGroups).map(([domain, group]) => {
        const firstItem = group.urls[0]
        return {
          url: firstItem.url,
          title: `${domain} (${group.urls.length} items)`,
          favicon: firstItem.favicon || getFaviconUrl(firstItem.url),
          addedAt: firstItem.addedAt
        }
      })

      console.log('[WorkspaceShare] Grouped items by domain:', groupedItems)

      // Load saved groups or use default
      let shareGroups = []
      try {
        const saved = localStorage.getItem('dropbox-groups')
        if (saved) {
          shareGroups = JSON.parse(saved)
        } else {
          shareGroups = [
            { key: 'public', name: 'Public', baseFolder: '/CoolDeskShared' }
          ]
        }
      } catch (e) {
        shareGroups = [{ key: 'public', name: 'Public', baseFolder: '/CoolDeskShared' }]
      }

      // For now, share to the first available group (or public by default)
      const targetGroup = shareGroups[0] || { key: 'public', name: 'Public', baseFolder: '/CoolDeskShared' }

      // Import Dropbox functions
      const { downloadWorkspaces } = await import('../dropbox/sync.js')
      const { getDropboxClient } = await import('../dropbox/auth.js')

      const SHARING_CONFIG = {
        baseFolder: targetGroup.baseFolder,
        groupKey: targetGroup.key,
        appKey: 'giehfgphh50abf5'
      }

      // Download existing shared workspaces
      const existingData = await downloadWorkspaces(SHARING_CONFIG)
      const existingWorkspaces = existingData?.workspaces || []

      // Create a shared workspace object
      const sharedWorkspace = {
        id: `shared-workspace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: workspaceName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        urls: groupedItems.map((item, idx) => {
          const urlData = {
            url: item.url,
            title: item.title || item.name || item.url || 'Untitled',
            favicon: item.favicon || getFaviconUrl(item.url),
            addedAt: item.addedAt || Date.now()
          }
          console.log(`[WorkspaceShare] Processed URL ${idx}:`, urlData)
          return urlData
        }),
        shared: true,
        source: 'workspace-share',
        workspaceGroup: workspaceName
      }

      // Add to existing workspaces (avoid duplicates by name)
      const existingIndex = existingWorkspaces.findIndex(w => w.name === workspaceName && w.source === 'workspace-share')
      
      let updatedWorkspaces
      if (existingIndex >= 0) {
        // Update existing workspace
        updatedWorkspaces = [...existingWorkspaces]
        updatedWorkspaces[existingIndex] = {
          ...updatedWorkspaces[existingIndex],
          ...sharedWorkspace,
          updatedAt: Date.now()
        }
      } else {
        // Add new workspace
        updatedWorkspaces = [...existingWorkspaces, sharedWorkspace]
      }

      // Upload to Dropbox
      const dbx = await getDropboxClient()
      if (!dbx) throw new Error('Failed to get Dropbox client')

      const sharedData = {
        workspaces: updatedWorkspaces,
        updatedAt: Date.now(),
        sharedBy: 'workspace-share'
      }

      const filePath = `${SHARING_CONFIG.baseFolder}/${SHARING_CONFIG.groupKey}/workspaces.json`
      
      await dbx.filesUpload({
        path: filePath,
        contents: JSON.stringify(sharedData, null, 2),
        mode: { '.tag': 'overwrite' }
      })

      // Show success message
      alert(`Workspace "${workspaceName}" shared to ${targetGroup.name} group!\nShared ${groupedItems.length} domains (from ${workspaceItems.length} items)\nPath: ${filePath}`)
      console.log(`Successfully shared workspace "${workspaceName}" with ${groupedItems.length} domains (from ${workspaceItems.length} items)`)

      // Trigger automatic refresh of shared workspaces
      window.dispatchEvent(new CustomEvent('dropboxItemShared', {
        detail: { workspace: workspaceName, itemCount: groupedItems.length, totalItems: workspaceItems.length, ...SHARING_CONFIG }
      }))

    } catch (err) {
      console.error('Failed to share workspace:', err)
      alert(`Failed to share workspace: ${err?.message || err}`)
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
          {/* Share Workspace */}
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              textAlign: 'left',
              background: 'transparent',
              color: '#34C759',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13
            }}
            onClick={() => {
              const ws = menu.ws
              setMenu({ open: false, x: 0, y: 0, ws: null })
              if (ws) {
                handleShareWorkspace(ws)
              }
            }}
          >
            🔗 Share Workspace to Dropbox
          </button>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />

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
