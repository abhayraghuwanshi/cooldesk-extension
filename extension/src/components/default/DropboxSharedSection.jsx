import { useEffect, useState } from 'react'
import {
  listSharedWorkspaces,
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
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState(null)

  const computeGroupedData = (workspacesList = []) => {
    const grouped = {
      workspaces: [],
      links: [],
      apps: []
    }

    if (!Array.isArray(workspacesList)) {
      return grouped
    }

    const linkItems = []

    workspacesList.forEach(item => {
      if (Array.isArray(item?.urls) && item.urls.length > 1) {
        grouped.workspaces.push(item)
      } else {
        linkItems.push(item)
      }
    })

    grouped.links = linkItems

    const domainGroups = {}
    linkItems.forEach(link => {
      try {
        const url = link.url || link.urls?.[0]?.url
        if (!url) return
        const domain = new URL(url).hostname.replace('www.', '')
        if (!domainGroups[domain]) {
          domainGroups[domain] = {
            domain,
            items: [],
            favicon: link.favicon,
            count: 0
          }
        }
        domainGroups[domain].items.push(link)
        domainGroups[domain].count += 1
      } catch (e) {
        if (!domainGroups.misc) {
          domainGroups.misc = {
            domain: 'misc',
            items: [],
            count: 0
          }
        }
        domainGroups.misc.items.push(link)
        domainGroups.misc.count += 1
      }
    })

    grouped.apps = Object.values(domainGroups)
    return grouped
  }

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
      const items = workspaces.map(workspace => {
        const primaryUrl = workspace.url || workspace.urls?.[0]?.url || `#workspace-${workspace.id}`
        const primaryFavicon = workspace.favicon || workspace.urls?.[0]?.favicon || ''
        return {
          id: workspace.id,
          url: primaryUrl,
          title: workspace.name || 'Untitled Workspace',
          favicon: primaryFavicon,
          dateAdded: workspace.createdAt || workspace.updatedAt || Date.now(),
          lastVisitTime: workspace.updatedAt || workspace.createdAt || Date.now(),
          type: 'workspace',
          source: 'dropbox-shared',
          workspace,
          sharedBy: workspace.sharedBy || 'unknown'
        }
      })

      setSharedWorkspaces(items)

      // Also update grouped data
      setGroupedData(computeGroupedData(workspaces))

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
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'var(--glass-bg, rgba(20, 20, 30, 0.95))',
                backdropFilter: 'blur(20px)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                color: 'var(--text-primary)',
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                appearance: 'none'
              }}
            >
              {availableGroups.map(group => (
                <option
                  key={group.key}
                  value={group.key}
                  style={{
                    background: 'rgba(20, 20, 30, 0.95)',
                    color: 'var(--text-primary)',
                  }}
                >
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
          padding: '12px',
          marginBottom: '12px',
          borderRadius: '8px',
          border: '1px dashed rgba(255,255,255,0.2)',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          textAlign: 'center'
        }}>
          {connected ? 'Syncing latest shared workspaces…' : 'Connecting to Dropbox…'}
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

      {connected && sharedWorkspaces.length > 0 && (
        <div>
          {/* <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginBottom: '8px'
          }}>
            {sharedWorkspaces.length} shared item{sharedWorkspaces.length !== 1 ? 's' : ''}
          </div> */}



          {/* Dedicated cards for shared workspaces with multiple items */}
          {Array.isArray(groupedData?.workspaces) && groupedData.workspaces.length > 0 && (
            <div style={{
              gap: '16px',
              padding: '14px',
              margin: '0 auto 30px auto',
              justifyContent: 'flex-start'
            }}>
              {groupedData.workspaces.map((workspace) => {
                const urls = Array.isArray(workspace.urls) ? workspace.urls.filter(u => !!u?.url) : []
                const isExpanded = expandedWorkspaceId === workspace.id
                const previewItems = isExpanded ? urls : urls.slice(0, 3)
                return (
                  <div
                    key={workspace.id}
                    style={{
                      marginLeft: '16px',
                      marginRight: '16px',
                      borderRadius: '18px',
                      padding: '16px',
                      transition: 'all 0.3s ease',
                      width: '100%',
                      maxWidth: '200px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      display: 'inline-flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      textAlign: 'center',
                      marginBottom: '10px',
                      color: 'var(--text-primary)'
                    }}>
                      {workspace.name || 'Untitled Workspace'}
                    </div>

                    {urls.length > 0 ? (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '10px',
                        justifyContent: 'center',
                        justifyItems: 'center',
                        width: '100%'
                      }}>
                        {previewItems.map((entry, idx) => (
                          <div
                            key={idx}
                            onClick={() => window.open(entry.url, '_blank')}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '14px',
                              background: entry.favicon ? `url(${entry.favicon}) center/cover` : 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              border: '1px solid rgba(255,255,255,0.2)',
                              transition: 'transform 0.2s ease',
                              margin: '0 auto'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'scale(1.08)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'scale(1)'
                            }}
                            title={entry.url || undefined}
                          >
                            {!entry.favicon && '🌐'}
                          </div>
                        ))}

                        {!isExpanded && urls.length > 3 && (
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '14px',
                            background: 'rgba(255,255,255,0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '13px',
                            fontWeight: '600',
                            color: 'var(--text-secondary)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            margin: '0 auto',
                            cursor: 'pointer'
                          }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedWorkspaceId(workspace.id)
                            }}
                            title="Show all links"
                          >
                            +{urls.length - 3}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{
                        padding: '12px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px dashed rgba(255,255,255,0.2)',
                        textAlign: 'center',
                        fontSize: '12px',
                        color: 'var(--text-secondary)'
                      }}>
                        No URLs shared yet
                      </div>
                    )}

                    <div style={{
                      textAlign: 'center',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      opacity: 0.8
                    }}>
                      {urls.length} item{urls.length !== 1 ? 's' : ''}
                      {isExpanded && urls.length > 3 && (
                        <div
                          style={{
                            marginTop: '10px',
                            fontSize: '11px',
                            color: '#34C759',
                            cursor: 'pointer'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedWorkspaceId(null)
                          }}
                        >
                          Show less
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* iOS App Library Style Grid */}
          <div style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '30px'
          }}>
            {(groupedData?.apps || []).map(app => (
              <div
                key={app.domain}
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

                {/* App Icons Grid --- THIS IS THE FIXED BLOCK --- */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 32px)',
                  gap: '8px',
                  marginBottom: '8px',
                  justifyContent: 'center'
                }}>
                  {app.items.slice(0, 4).map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => window.open(item.url || item.workspace?.url, '_blank')}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '12px',
                        background: item.favicon ?
                          `url(${item.favicon}) center/cover` :
                          'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        fontSize: '20px',
                        margin: '0 auto'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.transform = 'scale(1.1)'
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.transform = 'scale(1)'
                      }}
                      title={item.url || item.workspace?.url || undefined}
                    >
                      {!item.favicon && '🌐'}
                    </div>
                  ))}

                  {/* Show more indicator if there are more than 4 items */}
                  {app.items.length > 4 && (
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      margin: '0 auto'
                    }}
                      title={`${app.items.length - 4} more`}
                    >
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

          {/* Fallback: Show individual items if no grouped data */}
          {(!groupedData || ((groupedData.apps?.length || 0) === 0 && (groupedData.workspaces?.length || 0) === 0)) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '30px'
            }}>
              {sharedWorkspaces.map(item => (
                <div
                  key={item.id}
                  style={{
                    borderRadius: '16px',
                    padding: '16px',
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
                    width: '32px',
                    height: '32px',
                    borderRadius: '12px',
                    background: item.favicon ?
                      `url(${item.favicon}) center/cover` :
                      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 8px auto',
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