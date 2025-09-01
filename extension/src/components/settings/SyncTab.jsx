import { faCheckCircle, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

const SyncTab = ({ 
  syncConfig, 
  syncStatus, 
  syncConfigLoading, 
  handleToggleHostSync, 
  handleSyncConfigChange 
}) => {
  const syncFeatures = [
    { key: 'syncWorkspaces', label: 'Workspaces', description: 'Sync workspace data and URLs' },
    { key: 'syncTabs', label: 'Tabs', description: 'Share current browser tabs with host' },
    { key: 'syncActivity', label: 'Activity', description: 'Track browsing activity and time spent' },
    { key: 'syncSettings', label: 'Settings', description: 'Synchronize extension settings' },
    { key: 'syncDashboard', label: 'Dashboard', description: 'Sync dashboard data and bookmarks' },
    { key: 'enableRedirects', label: 'URL Redirects', description: 'Allow host to redirect URLs' },
    { key: 'enableHostActions', label: 'Host Actions', description: 'Allow host to open URLs and control browser' }
  ];

  return (
    <div style={{ padding: '16px 0' }}>
      <h4 style={{
        margin: '0 0 12px 0',
        fontSize: '16px',
        fontWeight: '600',
        color: 'var(--text-primary)'
      }}>
        Host Application Sync
      </h4>
      <p style={{
        margin: '0 0 20px 0',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: '1.5'
      }}>
        Configure synchronization with the desktop host application running on localhost:4000.
        When enabled, your workspaces, tabs, and activity will sync with the desktop app.
      </p>

      {syncConfigLoading && (
        <div style={{
          padding: '12px',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
          <span style={{ color: 'var(--text-secondary)' }}>Loading sync configuration...</span>
        </div>
      )}

      {syncConfig && (
        <>
          {/* Master Enable/Disable Switch */}
          <div style={{
            padding: '16px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            marginBottom: '16px',
            border: syncConfig.enableHostSync ? '1px solid #34C759' : '1px solid var(--border-primary)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Enable Host Sync</span>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={syncConfig.enableHostSync}
                  onChange={(e) => handleToggleHostSync(e.target.checked)}
                  disabled={syncConfigLoading}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ color: syncConfig.enableHostSync ? '#34C759' : 'var(--text-secondary)' }}>
                  {syncConfig.enableHostSync ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {syncConfig.enableHostSync
                ? 'Extension will sync data with desktop host application'
                : 'Extension running in standalone mode'
              }
            </div>
          </div>

          {/* Connection Status */}
          {syncStatus && (
            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <FontAwesomeIcon
                  icon={syncStatus.hostSyncEnabled ? faCheckCircle : faExclamationTriangle}
                  style={{ color: syncStatus.hostSyncEnabled ? '#34C759' : '#FF9500' }}
                />
                <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                  Connection Status: {syncStatus.hostSyncEnabled ? 'Ready' : 'Disabled'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Host URL: {syncStatus.hostUrl} | WebSocket: {syncStatus.websocketUrl}
              </div>
            </div>
          )}

          {/* Individual Sync Features */}
          {syncConfig.enableHostSync && (
            <div style={{ display: 'grid', gap: '12px' }}>
              <h5 style={{
                margin: '0 0 8px 0',
                fontSize: '14px',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Sync Features
              </h5>

              {syncFeatures.map(feature => (
                <div key={feature.key} style={{
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div>
                    <div style={{ fontWeight: '500', color: 'var(--text-primary)', marginBottom: '2px' }}>
                      {feature.label}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {feature.description}
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={syncConfig[feature.key]}
                      onChange={(e) => handleSyncConfigChange(feature.key, e.target.checked)}
                      disabled={syncConfigLoading}
                      style={{ marginRight: '8px' }}
                    />
                    <span style={{
                      color: syncConfig[feature.key] ? '#34C759' : 'var(--text-secondary)',
                      fontSize: '12px'
                    }}>
                      {syncConfig[feature.key] ? 'On' : 'Off'}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          )}

          {/* Host URL Configuration */}
          <div style={{ marginTop: '20px' }}>
            <h5 style={{
              margin: '0 0 8px 0',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Host Configuration
            </h5>
            <div style={{ display: 'grid', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  HTTP URL
                </label>
                <input
                  type="text"
                  value={syncConfig.hostUrl}
                  onChange={(e) => handleSyncConfigChange('hostUrl', e.target.value)}
                  disabled={syncConfigLoading}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-primary)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '13px'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  WebSocket URL
                </label>
                <input
                  type="text"
                  value={syncConfig.websocketUrl}
                  onChange={(e) => handleSyncConfigChange('websocketUrl', e.target.value)}
                  disabled={syncConfigLoading}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-primary)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '13px'
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SyncTab;