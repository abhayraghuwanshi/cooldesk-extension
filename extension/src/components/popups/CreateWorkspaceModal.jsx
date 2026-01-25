import React, { useEffect, useState } from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../../utils/helpers';

export function CreateWorkspaceModal({ show, onClose, onCreate, currentTab }) {
  const [workspaceName, setWorkspaceName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (show && currentTab) {
      // Auto-suggest workspace name based on current tab
      const domain = getDomainFromUrl(currentTab.url)
      setWorkspaceName(`${domain} workspace`)
      setDescription(`Workspace created from ${currentTab.title}`)
    }
  }, [show, currentTab])

  const handleCreate = async () => {
    if (!workspaceName.trim()) return

    setLoading(true)
    try {
      await onCreate(workspaceName.trim(), description.trim())
      setWorkspaceName('')
      setDescription('')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setWorkspaceName('')
    setDescription('')
    onClose()
  }

  if (!show) return null

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: '500px', width: '90%' }}>
        <div style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
          height: '100%',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Header */}
          <div style={{
            padding: '20px 20px 16px 20px',
            borderBottom: '1px solid var(--border-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-0)'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: '600',
              color: 'var(--text)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
              Create New Workspace
            </h3>
            <button
              onClick={handleClose}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '20px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'var(--interactive-hover)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'transparent';
              }}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            background: 'var(--surface-1)',
            padding: '20px'
          }}>
            {/* Current Tab Preview */}
            {currentTab && (
              <div style={{
                padding: '16px',
                marginBottom: '20px',
                borderRadius: '12px',
                border: '1px solid var(--border-secondary)',
                background: 'var(--surface-2)'
              }}>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  marginBottom: '8px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}>
                  Current Tab
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <img
                    src={getFaviconUrl(currentTab.url)}
                    alt=""
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '4px',
                      flexShrink: 0
                    }}
                    onError={(e) => {
                      e.target.style.opacity = '0.3';
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: '500',
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: '2px'
                    }}>
                      {currentTab.title}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {currentTab.url}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Workspace Name Input */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: 'var(--text)',
                marginBottom: '8px'
              }}>
                Workspace Name *
              </label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Enter workspace name..."
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-secondary)',
                  background: 'var(--surface-3)',
                  color: 'var(--text)',
                  fontSize: '14px',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--accent-primary)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(52, 199, 89, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--border-secondary)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Description Input */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: 'var(--text)',
                marginBottom: '8px'
              }}>
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What are you working on? (optional)"
                rows="3"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-secondary)',
                  background: 'var(--surface-3)',
                  color: 'var(--text)',
                  fontSize: '14px',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  resize: 'vertical',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--accent-primary)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(52, 199, 89, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--border-secondary)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={handleClose}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-secondary)',
                  background: 'var(--surface-3)',
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: loading ? 0.5 : 1,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.target.style.background = 'var(--surface-4)';
                    e.target.style.borderColor = 'var(--border-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.target.style.background = 'var(--surface-3)';
                    e.target.style.borderColor = 'var(--border-secondary)';
                  }
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!workspaceName.trim() || loading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-primary)',
                  background: 'var(--accent-primary)',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: (!workspaceName.trim() || loading) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: (!workspaceName.trim() || loading) ? 0.5 : 1,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                }}
                onMouseEnter={(e) => {
                  if (workspaceName.trim() && !loading) {
                    e.target.style.opacity = '0.9';
                  }
                }}
                onMouseLeave={(e) => {
                  if (workspaceName.trim() && !loading) {
                    e.target.style.opacity = '1';
                  }
                }}
              >
                {loading ? 'Creating...' : 'Create Workspace'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
