import { useEffect, useState } from 'react'
import { getDropboxStatus } from '../../dropbox/sync.js'

export default function DropboxSync() {
  const [status, setStatus] = useState({ connected: false })

  useEffect(() => {
    (async () => {
      const st = await getDropboxStatus()
      setStatus(st)
    })()
  }, [])

  return (
    <div style={{ padding: '16px' }}>
      <div style={{
        padding: '16px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔄</div>
        <div style={{ marginBottom: '8px' }}>Dropbox Sync Moved</div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          Dropbox functionality is now in the main interface.<br />
          Go to <strong>Shared Workspaces</strong> section to login and share items.
        </div>
      </div>

      <div style={{ marginTop: '16px', fontSize: 12, color: '#9ca3af' }}>
        💡 <strong>How to use Dropbox:</strong><br />
        1. Find "Shared Workspaces" section in the main interface<br />
        2. Click "Login" to connect to Dropbox<br />
        3. Right-click any workspace → "Share to Dropbox" to share individual items<br />
        4. Copy/paste sharing configurations to collaborate with others
      </div>

      {status.connected && (
        <div style={{
          marginTop: '12px',
          fontSize: 13,
          color: '#34C759',
          textAlign: 'center'
        }}>
          ✓ Already connected to Dropbox{status?.account?.email ? ` as ${status.account.email}` : ''}
        </div>
      )}
    </div>
  )
}

