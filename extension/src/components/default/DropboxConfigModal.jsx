import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clearStoredToken, connectDropbox } from '../../dropbox/auth.js'
import { getDropboxStatus } from '../../dropbox/sync.js'

export function DropboxConfigModal({ isOpen, onClose, onConfigChange, currentConfig }) {
    const [connected, setConnected] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [groups, setGroups] = useState([])
    const [selectedGroup, setSelectedGroup] = useState(currentConfig?.groupKey || 'public')
    const [customGroup, setCustomGroup] = useState('')
    const [baseFolder, setBaseFolder] = useState(currentConfig?.baseFolder || '/CoolDeskShared')
    const [showAdvanced, setShowAdvanced] = useState(false)

    // Predefined groups for easy selection
    const predefinedGroups = [
        { key: 'public', name: 'Public', description: 'Open to everyone' },
        { key: 'team', name: 'Team', description: 'For team collaboration' },
        { key: 'family', name: 'Family', description: 'Family sharing' },
        { key: 'friends', name: 'Friends', description: 'Friend group' },
        { key: 'work', name: 'Work', description: 'Work projects' },
        { key: 'custom', name: 'Custom', description: 'Create your own group' }
    ]

    useEffect(() => {
        if (isOpen) {
            checkConnection()
            loadSavedGroups()
        }
    }, [isOpen])

    const checkConnection = async () => {
        try {
            const status = await getDropboxStatus()
            setConnected(status?.connected || false)
        } catch (e) {
            console.error('Failed to check Dropbox status:', e)
        }
    }

    const loadSavedGroups = () => {
        try {
            const saved = localStorage.getItem('dropbox-groups')
            if (saved) {
                const parsedGroups = JSON.parse(saved)
                setGroups(parsedGroups)
            }
        } catch (e) {
            console.error('Failed to load saved groups:', e)
        }
    }

    const saveGroups = (newGroups) => {
        try {
            localStorage.setItem('dropbox-groups', JSON.stringify(newGroups))
            setGroups(newGroups)
        } catch (e) {
            console.error('Failed to save groups:', e)
        }
    }

    const handleConnect = async () => {
        try {
            setLoading(true)
            setError('')
            await connectDropbox('giehfgphh50abf5') // Your Dropbox App Key
            const status = await getDropboxStatus()
            setConnected(status?.connected || false)
        } catch (e) {
            setError(`Connection failed: ${e?.message || e}`)
        } finally {
            setLoading(false)
        }
    }

    const handleDisconnect = async () => {
        try {
            setLoading(true)
            await clearStoredToken()
            setConnected(false)
        } catch (e) {
            setError(`Disconnect failed: ${e?.message || e}`)
        } finally {
            setLoading(false)
        }
    }

    const handleSaveConfig = () => {
        const groupKey = selectedGroup === 'custom' ? customGroup : selectedGroup

        if (!groupKey.trim()) {
            setError('Please enter a group name')
            return
        }

        const config = {
            baseFolder: baseFolder.trim(),
            groupKey: groupKey.trim(),
            appKey: 'giehfgphh50abf5'
        }

        // Save to groups list
        const existingGroup = groups.find(g => g.key === groupKey)
        if (!existingGroup) {
            const newGroup = {
                key: groupKey,
                name: selectedGroup === 'custom' ? customGroup : predefinedGroups.find(p => p.key === selectedGroup)?.name,
                baseFolder,
                createdAt: Date.now(),
                lastUsed: Date.now()
            }
            saveGroups([...groups, newGroup])
        } else {
            // Update last used
            const updatedGroups = groups.map(g =>
                g.key === groupKey ? { ...g, lastUsed: Date.now() } : g
            )
            saveGroups(updatedGroups)
        }

        onConfigChange(config)
        onClose()
    }

    const handleDeleteGroup = (groupKey) => {
        const updatedGroups = groups.filter(g => g.key !== groupKey)
        saveGroups(updatedGroups)
    }

    const generateSharingUrl = () => {
        const groupKey = selectedGroup === 'custom' ? customGroup : selectedGroup
        return `Group: ${groupKey} | Folder: ${baseFolder}`
    }

    if (!isOpen) return null

    return createPortal(
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: 'rgba(0,0,0,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                backdropFilter: 'blur(4px)',
                margin: 0,
                padding: '20px',
                boxSizing: 'border-box'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="ai-card" style={{
                width: '100%',
                maxWidth: '500px',
                maxHeight: 'calc(100vh - 40px)',
                overflow: 'auto',
                padding: '0',
                position: 'relative',
                zIndex: 10000,
                margin: 'auto',
                transform: 'translateZ(0)' // Force hardware acceleration
            }}>
                <div style={{ padding: '32px' }}>
                    <div className="modal-header" style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '24px',
                        paddingBottom: '16px'
                    }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: 'var(--text)' }}>
                                🔗 Sharing Groups
                            </h2>
                            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                Manage your Dropbox sharing configurations
                            </p>
                        </div>
                        <button
                            className="icon-btn"
                            onClick={onClose}
                            style={{
                                width: '32px',
                                height: '32px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '16px'
                            }}
                        >
                            ×
                        </button>
                    </div>

                    {error && (
                        <div className="status-badge error" style={{
                            padding: '12px',
                            marginBottom: '16px',
                            width: '100%',
                            justifyContent: 'flex-start'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Connection Status */}
                    <div className={`status-badge ${connected ? 'success' : 'warning'}`} style={{
                        padding: '20px',
                        marginBottom: '24px',
                        width: '100%',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '10px',
                                    background: connected ? 'rgba(52,199,89,0.2)' : 'rgba(255,149,0,0.2)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '18px'
                                }}>
                                    {connected ? '✓' : '⚠'}
                                </div>
                                <div>
                                    <div style={{ fontWeight: '600', fontSize: '15px', marginBottom: '2px' }}>
                                        {connected ? 'Connected to Dropbox' : 'Connect to Dropbox'}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {connected ? 'Ready to share workspaces' : 'Required for sharing functionality'}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={connected ? handleDisconnect : handleConnect}
                                disabled={loading}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: connected ? 'rgba(255,107,107,0.15)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    color: connected ? '#ff6b6b' : 'white',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    opacity: loading ? 0.6 : 1,
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {loading ? 'Working...' : (connected ? 'Disconnect' : 'Connect')}
                            </button>
                        </div>
                    </div>

                    {/* Group Selection */}
                    <div className="form-group">
                        <label className="form-label">
                            Select Sharing Group
                        </label>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: '8px',
                            marginBottom: '12px'
                        }}>
                            {predefinedGroups.map(group => (
                                <div
                                    key={group.key}
                                    onClick={() => setSelectedGroup(group.key)}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '6px',
                                        border: selectedGroup === group.key ? '2px solid #34C759' : '1px solid rgba(255,255,255,0.2)',
                                        background: selectedGroup === group.key ? 'rgba(52,199,89,0.1)' : 'rgba(255,255,255,0.05)',
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <div style={{ fontSize: '12px', fontWeight: '500' }}>{group.name}</div>
                                    <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>
                                        {group.description}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {selectedGroup === 'custom' && (
                            <input
                                type="text"
                                placeholder="Enter custom group name"
                                value={customGroup}
                                onChange={(e) => setCustomGroup(e.target.value)}
                                className="form-input"
                                style={{ fontSize: '12px' }}
                            />
                        )}
                    </div>

                    {/* Saved Groups */}
                    {groups.length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{
                                display: 'block',
                                fontSize: '14px',
                                fontWeight: '500',
                                marginBottom: '8px'
                            }}>
                                Recent Groups
                            </label>
                            <div style={{ maxHeight: '120px', overflow: 'auto' }}>
                                {groups.sort((a, b) => b.lastUsed - a.lastUsed).map(group => (
                                    <div
                                        key={group.key}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '8px 12px',
                                            borderRadius: '4px',
                                            background: 'rgba(255,255,255,0.05)',
                                            marginBottom: '4px',
                                            fontSize: '12px'
                                        }}
                                    >
                                        <div
                                            onClick={() => {
                                                setSelectedGroup(group.key)
                                                setBaseFolder(group.baseFolder)
                                            }}
                                            style={{ cursor: 'pointer', flex: 1 }}
                                        >
                                            <span style={{ fontWeight: '500' }}>{group.name}</span>
                                            <span style={{ opacity: 0.7, marginLeft: '8px' }}>
                                                {group.baseFolder}/{group.key}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteGroup(group.key)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#ff6b6b',
                                                cursor: 'pointer',
                                                padding: '2px 6px',
                                                fontSize: '10px'
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Advanced Settings */}
                    <div style={{ marginBottom: '20px' }}>
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            {showAdvanced ? '▼' : '▶'} Advanced Settings
                        </button>

                        {showAdvanced && (
                            <div style={{ marginTop: '12px' }}>
                                <label style={{
                                    display: 'block',
                                    fontSize: '12px',
                                    marginBottom: '4px'
                                }}>
                                    Base Folder Path
                                </label>
                                <input
                                    type="text"
                                    value={baseFolder}
                                    onChange={(e) => setBaseFolder(e.target.value)}
                                    className="form-input"
                                    style={{ fontSize: '11px' }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Sharing URL Preview */}
                    <div style={{
                        padding: '12px',
                        background: 'rgba(255,255,255,0.05)',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        <div style={{ fontSize: '12px', marginBottom: '4px', opacity: 0.7 }}>
                            Sharing URL Preview:
                        </div>
                        <div style={{
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            color: '#34C759',
                            wordBreak: 'break-all'
                        }}>
                            {generateSharingUrl()}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        justifyContent: 'flex-end'
                    }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'rgba(255,255,255,0.05)',
                                color: 'var(--text-secondary)',
                                fontSize: '12px',
                                cursor: 'pointer'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveConfig}
                            disabled={!connected}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                background: connected ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.1)',
                                color: connected ? 'white' : 'var(--text-secondary)',
                                fontSize: '12px',
                                cursor: connected ? 'pointer' : 'not-allowed'
                            }}
                        >
                            Save & Apply
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}
