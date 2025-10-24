import { useEffect, useState } from 'react'
import {
  getGroupedSharedWorkspaces,
  listSharedWorkspaces,
  saveSharedWorkspace,
  syncSharedWorkspacesFromDropbox
} from '../../db/index.js'
import { clearStoredToken, connectDropbox } from '../../dropbox/auth.js'
import { downloadWorkspaces, getDropboxStatus } from '../../dropbox/sync.js'
import { DropboxConfigModal } from './DropboxConfigModal.jsx'

// Default configuration
const DEFAULT_CONFIG = {
  baseFolder: '/CoolDeskShared',
  groupKey: 'public',
  appKey: 'giehfgphh50abf5'
}

export function DropboxSharedSection() {
  const [sharedWorkspaces, setSharedWorkspaces] = useState([])
  const [groupedData, setGroupedData] = useState({ workspaces: [], links: [], apps: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const viewMode = 'apps' // Always show apps view
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [currentConfig, setCurrentConfig] = useState(DEFAULT_CONFIG)
  const [availableGroups, setAvailableGroups] = useState([])

  // Initialize - load configuration and data
  useEffect(() => {
    (async () => {
      try {
        // Load saved configuration
        loadSavedConfig()
        loadAvailableGroups()

        // Load from local database first (for instant display)
        await loadLocalSharedWorkspaces()

        const status = await getDropboxStatus()
        setConnected(status?.connected || false)

        if (status?.connected) {
          // Then sync from Dropbox in background
          await syncFromDropbox()
        }
      } catch (e) {
        console.warn('[DropboxSharedSection] Init failed:', e)
      }
    })()
  }, [])

  // Reload data when configuration changes
  useEffect(() => {
    if (connected) {
      syncFromDropbox()
    }
  }, [currentConfig, connected])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!connected) return
    const interval = setInterval(syncFromDropbox, 30000)
    return () => clearInterval(interval)
  }, [connected])

  // Listen for share events
  useEffect(() => {
    const handleShareEvent = () => syncFromDropbox()
    window.addEventListener('dropboxItemShared', handleShareEvent)
    return () => window.removeEventListener('dropboxItemShared', handleShareEvent)
  }, [])

  // Configuration management functions
  const loadSavedConfig = () => {
    try {
      const saved = localStorage.getItem('dropbox-current-config')
      if (saved) {
        const config = JSON.parse(saved)
        setCurrentConfig({ ...DEFAULT_CONFIG, ...config })
      }
    } catch (e) {
      console.error('Failed to load saved config:', e)
    }
  }

  const saveCurrentConfig = (config) => {
    try {
      localStorage.setItem('dropbox-current-config', JSON.stringify(config))
      setCurrentConfig(config)
    } catch (e) {
      console.error('Failed to save config:', e)
    }
  }

  const loadAvailableGroups = () => {
    try {
      const saved = localStorage.getItem('dropbox-groups')
      if (saved) {
        const groups = JSON.parse(saved)
        setAvailableGroups(groups)
      }
    } catch (e) {
      console.error('Failed to load groups:', e)
    }
  }

  // Load shared workspaces from local database (instant)
  const loadLocalSharedWorkspaces = async () => {
    try {
      // Test: Try to save a dummy item first to see if DB is working
      console.log('[DropboxSharedSection] Testing database save...')
      try {
        await saveSharedWorkspace({
          id: 'test-' + Date.now(),
          name: 'Test Item',
          url: 'https://test.com',
          shared: true,
          source: 'test'
        })
        console.log('[DropboxSharedSection] Test save successful')
      } catch (testError) {
        console.error('[DropboxSharedSection] Test save failed:', testError)
      }
      const result = await listSharedWorkspaces()
      console.log('[DropboxSharedSection] Raw local result:', result)
      console.log('[DropboxSharedSection] Result.data type:', typeof result?.data)
      console.log('[DropboxSharedSection] Result.data content:', result?.data)
      console.log('[DropboxSharedSection] Result.data keys:', result?.data ? Object.keys(result.data) : 'no data')
      console.log('[DropboxSharedSection] Result.data.data:', result?.data?.data)
      console.log('[DropboxSharedSection] JSON.stringify result:', JSON.stringify(result, null, 2))

      // Handle different possible result formats
      let workspaces = []
      if (Array.isArray(result)) {
        workspaces = result
      } else if (result?.success && result?.data?.data && Array.isArray(result.data.data)) {
        // Handle nested withErrorHandling wrapper format: {success: true, data: {data: [...], count: 5}}
        workspaces = result.data.data
      } else if (result?.success && result?.data && Array.isArray(result.data)) {
        // Handle simple withErrorHandling wrapper format: {success: true, data: [...]}
        workspaces = result.data
      } else if (result?.data && Array.isArray(result.data)) {
        workspaces = result.data
      } else if (result?.workspaces && Array.isArray(result.workspaces)) {
        workspaces = result.workspaces
      } else {
        console.log('[DropboxSharedSection] No workspaces found in result:', result)
        workspaces = []
      }

      console.log('[DropboxSharedSection] Processed workspaces:', workspaces)

      // Transform to ItemGrid format
      const items = workspaces.map(workspace => ({
        id: workspace.id,
        url: workspace.url || `#workspace-${workspace.id}`,
        title: workspace.name || 'Untitled Workspace',
        favicon: workspace.favicon || '',
        dateAdded: workspace.createdAt || workspace.updatedAt || Date.now(),
        lastVisitTime: workspace.updatedAt || workspace.createdAt || Date.now(),
        type: 'workspace',
        source: 'dropbox-shared',
        workspace: workspace,
        sharedBy: workspace.sharedBy || 'unknown'
      }))

      setSharedWorkspaces(items)

      // Also update grouped data
      try {
        const grouped = await getGroupedSharedWorkspaces()
        console.log('[DropboxSharedSection] Grouped data raw:', grouped)

        // Handle withErrorHandling wrapper format
        let finalGrouped = { workspaces: [], links: [], apps: [] }
        if (grouped?.success && grouped?.data) {
          finalGrouped = grouped.data
        } else if (grouped?.workspaces || grouped?.links || grouped?.apps) {
          finalGrouped = grouped
        }

        console.log('[DropboxSharedSection] Final grouped data:', finalGrouped)
        setGroupedData(finalGrouped)
      } catch (groupError) {
        console.error('[DropboxSharedSection] Grouping error:', groupError)
        setGroupedData({ workspaces: [], links: [], apps: [] })
      }

      console.log('[DropboxSharedSection] Loaded from local DB:', { items: items.length })
    } catch (e) {
      console.error('[DropboxSharedSection] Local load error:', e)
      setSharedWorkspaces([])
      setGroupedData({ workspaces: [], links: [], apps: [] })
    }
  }

  // Sync from Dropbox and update local database
  const syncFromDropbox = async () => {
    if (!connected) return

    setLoading(true)
    setError('')
    try {
      console.log('[DropboxSharedSection] Syncing from Dropbox:', currentConfig)

      const result = await downloadWorkspaces(currentConfig)
      console.log('[DropboxSharedSection] Dropbox result:', result)

      // Sync to local database
      const syncResult = await syncSharedWorkspacesFromDropbox({
        ...result,
        groupKey: currentConfig.groupKey,
        sharedBy: result.sharedBy || 'dropbox-sync'
      })
      console.log('[DropboxSharedSection] Sync result:', syncResult)

      // Reload from local database
      await loadLocalSharedWorkspaces()

    } catch (e) {
      console.error('[DropboxSharedSection] Sync error:', e)
      setError(`Failed to sync shared workspaces: ${e?.message || e}`)
    } finally {
      setLoading(false)
    }
  }


  const handleConnect = async () => {
    try {
      setLoading(true)
      await connectDropbox(currentConfig.appKey)
      const status = await getDropboxStatus()
      setConnected(status?.connected || false)
      if (status?.connected) {
        await syncFromDropbox()
      }
    } catch (e) {
      setError(`Connection failed: ${e?.message || e}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await clearStoredToken()
      setConnected(false)
      setSharedWorkspaces([])
      setSharingUrl('')
    } catch (e) {
      setError(`Disconnect failed: ${e?.message || e}`)
    }
  }

  const handleJoinGroup = async () => {
    if (!joinUrl.trim()) return

    try {
      // Parse simple format: "Group: public | Folder: /CoolDeskShared"
      const parts = joinUrl.split('|').map(p => p.trim())
      let group = null
      let folder = null

      parts.forEach(part => {
        if (part.startsWith('Group:')) {
          group = part.replace('Group:', '').trim()
        } else if (part.startsWith('Folder:')) {
          folder = part.replace('Folder:', '').trim()
        }
      })

      if (group && folder) {
        // Update config and reload
        SHARING_CONFIG.groupKey = group
        SHARING_CONFIG.baseFolder = folder
        await loadSharedWorkspaces()
        generateSharingUrl()
        setJoinUrl('')
        setError('')
      } else {
        setError('Invalid sharing format. Expected: "Group: name | Folder: /path"')
      }
    } catch (e) {
      setError('Invalid sharing configuration')
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could show a toast notification here
    }).catch(() => {
      setError('Failed to copy to clipboard')
    })
  }

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px'
      }}>
        <h2 className="coolDesk-section-title">Shared Workspaces</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Group Dropdown */}
          {connected && availableGroups.length > 0 && (
            <select
              value={currentConfig.groupKey}
              onChange={(e) => {
                const selectedGroup = availableGroups.find(g => g.key === e.target.value);
                if (selectedGroup) {
                  const newConfig = {
                    ...currentConfig,
                    groupKey: selectedGroup.key,
                    baseFolder: selectedGroup.baseFolder
                  };
                  saveCurrentConfig(newConfig);
                }
              }}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              {availableGroups.map(group => (
                <option key={group.key} value={group.key}>
                  📁 {group.name}
                </option>
              ))}
            </select>
          )}

          {/* Settings Button */}
          <button
            onClick={() => setShowConfigModal(true)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            ⚙️
          </button>

          {/* Simple connection status */}
          {!connected && (
            <button
              onClick={handleConnect}
              disabled={loading}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(52,199,89,0.3)',
                background: 'rgba(52,199,89,0.1)',
                color: '#34C759',
                fontSize: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px',
          marginBottom: '12px',
          background: 'rgba(255,107,107,0.1)',
          border: '1px solid rgba(255,107,107,0.3)',
          borderRadius: '6px',
          color: '#ff6b6b',
          fontSize: '13px'
        }}>
          {error}
        </div>
      )}


      {loading && (
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--text-secondary)'
        }}>
          {connected ? 'Loading shared workspaces...' : 'Connecting to Dropbox...'}
        </div>
      )}

      {!connected && !loading && (
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>☁️</div>
          <div style={{ marginBottom: '8px' }}>Login to Dropbox to share workspaces</div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>
            Right-click any workspace → "Share to Dropbox" after login
          </div>
        </div>
      )}

      {connected && !loading && sharedWorkspaces.length === 0 && (
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <div style={{ fontSize: '20px', marginBottom: '8px' }}>📂</div>
          <div style={{ marginBottom: '4px' }}>No shared workspaces yet</div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>
            Share your first workspace using the context menu
          </div>
        </div>
      )}

      {connected && !loading && sharedWorkspaces.length > 0 && (
        <div>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginBottom: '8px'
          }}>
            {sharedWorkspaces.length} shared item{sharedWorkspaces.length !== 1 ? 's' : ''}
          </div>

          {/* Debug info */}
          <div style={{ fontSize: '10px', color: 'yellow', marginBottom: '8px' }}>
            Debug: apps={groupedData?.apps?.length || 0}, workspaces={groupedData?.workspaces?.length || 0}, links={groupedData?.links?.length || 0}
          </div>

          {/* iOS App Library Style Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '16px'
          }}>
            {(groupedData?.apps || []).map(app => (
              <div
                key={app.domain}
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
                  borderRadius: '16px',
                  padding: '16px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(10px)',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-4px)'
                  e.target.style.boxShadow = '0 8px 25px rgba(0,0,0,0.3)'
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)'
                  e.target.style.boxShadow = 'none'
                }}
              >
                {/* Category Header */}
                <div style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '12px',
                  textAlign: 'center',
                  textTransform: 'capitalize'
                }}>
                  {app.domain.replace('.com', '').replace('.', ' ')}
                </div>

                {/* App Icons Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: app.items.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  {app.items.slice(0, 4).map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => window.open(item.url || item.workspace?.url, '_blank')}
                      style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '12px',
                        background: item.favicon ?
                          `url(${item.favicon}) center/cover` :
                          'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        border: '1px solid rgba(255,255,255,0.2)',
                        fontSize: '20px',
                        margin: '0 auto'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.transform = 'scale(1.1)'
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.transform = 'scale(1)'
                      }}
                    >
                      {!item.favicon && '🌐'}
                    </div>
                  ))}

                  {/* Show more indicator if there are more than 4 items */}
                  {app.items.length > 4 && (
                    <div style={{
                      width: '50px',
                      height: '50px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      margin: '0 auto'
                    }}>
                      +{app.items.length - 4}
                    </div>
                  )}
                </div>

                {/* Item count */}
                <div style={{
                  textAlign: 'center',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  opacity: 0.8
                }}>
                  {app.count} item{app.count !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>

          {/* Fallback: Show individual items if no grouped apps */}
          {(!groupedData?.apps || groupedData.apps.length === 0) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '16px'
            }}>
              {sharedWorkspaces.map(item => (
                <div
                  key={item.id}
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(10px)',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                  onClick={() => window.open(item.url, '_blank')}
                >
                  <div style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '12px',
                    textAlign: 'center'
                  }}>
                    {item.title || 'Shared Item'}
                  </div>
                  
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '12px',
                    background: item.favicon ? 
                      `url(${item.favicon}) center/cover` : 
                      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 8px auto',
                    border: '1px solid rgba(255,255,255,0.2)',
                    fontSize: '20px'
                  }}>
                    {!item.favicon && '🌐'}
                  </div>
                  
                  <div style={{
                    textAlign: 'center',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    opacity: 0.8
                  }}>
                    Individual item
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* Configuration Modal */}
      <DropboxConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        onConfigChange={(config) => {
          saveCurrentConfig(config)
          loadAvailableGroups() // Refresh groups list
        }}
        currentConfig={currentConfig}
      />
    </div>
  )
}
