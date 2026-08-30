import { faSync, faWifi } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { isHostSyncEnabled } from '../../../services/syncConfig.js';

// Shown when there are no tabs to list at all. In host-sync mode this also
// carries the connection-health pill and troubleshooting steps, since "no
// tabs" there usually means the extension/sync link is the actual problem.
export function EmptyTabsState({ wsConnected, requestingTabs, onRequestAllTabs }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      padding: '36px 20px',
      color: 'var(--text-secondary, #64748B)',
      textAlign: 'center',
      background: 'var(--glass-bg, rgba(30, 41, 59, 0.95))',
      borderRadius: '12px',
      border: '1px solid rgba(59, 130, 246, 0.2)'
    }}>
      <div style={{ fontSize: '44px', opacity: 0.3 }}>📑</div>
      <div>
        <div style={{ fontSize: 'var(--font-lg, 14px)', fontWeight: 500, marginBottom: '6px' }}>
          No Tabs Found
        </div>
        <div style={{ fontSize: 'var(--font-sm, 12px)' }}>
          {isHostSyncEnabled()
            ? 'No browser tabs are syncing from the extension yet'
            : 'Open some browser tabs to see them here'}
        </div>
      </div>

      {/* Host-sync mode: show connection health + troubleshooting + manual fetch */}
      {isHostSyncEnabled() && (
        <>
          {/* Connection status pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '6px 12px', borderRadius: '99px',
            fontSize: 'var(--font-xs, 11px)', fontWeight: 500,
            background: wsConnected ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${wsConnected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: wsConnected ? '#4ADE80' : '#F87171'
          }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: wsConnected ? '#22C55E' : '#EF4444',
              boxShadow: wsConnected ? '0 0 6px #22C55E' : 'none'
            }} />
            <FontAwesomeIcon icon={faWifi} style={{ fontSize: '10px' }} />
            <span>{wsConnected ? 'Sync connected' : 'Sync offline'}</span>
          </div>

          {wsConnected ? (
            // Sync layer is up but no tabs — extension may be down, or a sync hiccup.
            <>
              <div style={{ fontSize: 'var(--font-xs, 11px)', maxWidth: 320, lineHeight: 1.5 }}>
                Sync is connected but no tabs were reported. If you have tabs open, make sure
                the browser extension is enabled, then fetch them again from all browser instances.
              </div>
              <button
                onClick={onRequestAllTabs}
                disabled={requestingTabs}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 16px', borderRadius: '8px',
                  background: 'rgba(59,130,246,0.18)',
                  border: '1px solid rgba(59,130,246,0.4)',
                  color: '#60A5FA', fontWeight: 500,
                  fontSize: 'var(--font-sm, 12px)',
                  cursor: requestingTabs ? 'default' : 'pointer',
                  opacity: requestingTabs ? 0.6 : 1
                }}
              >
                <FontAwesomeIcon icon={faSync} spin={requestingTabs} style={{ fontSize: '11px' }} />
                {requestingTabs ? 'Fetching…' : 'Fetch all tabs from all browsers'}
              </button>
            </>
          ) : (
            // Not connected — guide the user through the common causes.
            <div style={{
              textAlign: 'left', maxWidth: 340,
              fontSize: 'var(--font-xs, 11px)', lineHeight: 1.6,
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: '8px', padding: '10px 14px'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary, #94A3B8)' }}>
                Check these common issues:
              </div>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                <li>Is the CoolDesk browser extension installed and <strong>enabled</strong>?</li>
                <li>Is your browser (Chrome/Edge) actually running?</li>
                <li>Try reloading the extension from <code>chrome://extensions</code>.</li>
                <li>A firewall/VPN may be blocking <code>localhost:4545</code>.</li>
              </ul>
              <button
                onClick={onRequestAllTabs}
                disabled={requestingTabs}
                style={{
                  marginTop: '10px',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '5px 12px', borderRadius: '6px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text-secondary, #CBD5E1)',
                  fontSize: 'var(--font-xs, 11px)',
                  cursor: requestingTabs ? 'default' : 'pointer',
                  opacity: requestingTabs ? 0.6 : 1
                }}
              >
                <FontAwesomeIcon icon={faSync} spin={requestingTabs} style={{ fontSize: '10px' }} />
                Retry connection
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
