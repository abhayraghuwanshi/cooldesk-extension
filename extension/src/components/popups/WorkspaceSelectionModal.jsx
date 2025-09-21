import React, { useEffect, useMemo, useState } from 'react';
import { listWorkspaces, addUrlToWorkspace } from '../../db/index.js';
import { getFaviconUrl } from '../../utils';

export function WorkspaceSelectionModal({ show, onClose, url, title }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [adding, setAdding] = useState(false);

  // Load workspaces when modal opens
  useEffect(() => {
    if (!show) return;

    const loadWorkspaces = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listWorkspaces();
        const workspacesData = result?.data || result || [];
        setWorkspaces(Array.isArray(workspacesData) ? workspacesData : []);
      } catch (err) {
        console.error('Failed to load workspaces:', err);
        setError('Failed to load workspaces');
        setWorkspaces([]);
      } finally {
        setLoading(false);
      }
    };

    loadWorkspaces();
  }, [show]);

  // Filter workspaces based on search
  const filteredWorkspaces = useMemo(() => {
    if (!searchQuery.trim()) return workspaces;

    const query = searchQuery.toLowerCase();
    return workspaces.filter(ws =>
      (ws.name || '').toLowerCase().includes(query) ||
      (ws.description || '').toLowerCase().includes(query) ||
      (ws.urls || []).some(urlItem =>
        (urlItem.url || '').toLowerCase().includes(query) ||
        (urlItem.title || '').toLowerCase().includes(query)
      )
    );
  }, [workspaces, searchQuery]);

  const handleAddToWorkspace = async (workspace) => {
    if (!url || !workspace) return;

    setAdding(true);
    try {
      await addUrlToWorkspace(workspace.id, {
        url,
        title: title || url,
        addedAt: Date.now()
      });

      // Close modal on success
      handleClose();
    } catch (err) {
      console.error('Failed to add URL to workspace:', err);
      setError(`Failed to add to "${workspace.name}"`);
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setError(null);
    onClose();
  };

  if (!show) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
        backdropFilter: 'blur(4px)'
      }}
    >
      <div
        className="modal"
        style={{
          maxWidth: '500px',
          width: '90%',
          position: 'relative',
          zIndex: 10002
        }}>
        <div
          className="add-link-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingBottom: 8,
            borderBottom: '1px solid #273043',
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Add to Workspace
          </h3>
          <button
            onClick={handleClose}
            className="cancel-btn"
            aria-label="Close"
            title="Close"
            style={{ padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        {/* URL info */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px',
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))'
        }}>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <img
              src={getFaviconUrl(url)}
              alt=""
              width={16}
              height={16}
              style={{ borderRadius: 2 }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '14px',
              color: 'var(--text-primary, #ffffff)',
              fontWeight: '500',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {title || url}
            </div>
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {url}
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Search workspaces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
              borderRadius: '6px',
              color: 'var(--text-primary, #ffffff)',
              outline: 'none'
            }}
            autoFocus
          />
        </div>

        {/* Error display */}
        {error && (
          <div style={{
            padding: '8px 12px',
            marginBottom: '16px',
            background: 'rgba(255, 59, 48, 0.1)',
            border: '1px solid rgba(255, 59, 48, 0.3)',
            borderRadius: '6px',
            color: '#FF3B30',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        {/* Workspace list */}
        <div style={{
          maxHeight: '300px',
          overflowY: 'auto',
          marginBottom: '16px'
        }}>
          {loading ? (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))'
            }}>
              Loading workspaces...
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))'
            }}>
              {searchQuery ? 'No workspaces found matching your search' : 'No workspaces available'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredWorkspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  onClick={() => handleAddToWorkspace(workspace)}
                  disabled={adding}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                    borderRadius: '8px',
                    cursor: adding ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                    width: '100%',
                    opacity: adding ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!adding) {
                      e.target.style.background = 'var(--hover-bg, rgba(255, 255, 255, 0.1))';
                      e.target.style.borderColor = 'var(--border-hover, rgba(255, 255, 255, 0.2))';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!adding) {
                      e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.05))';
                      e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.1))';
                    }
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: '16px'
                  }}>
                    📁
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '14px',
                      color: 'var(--text-primary, #ffffff)',
                      fontWeight: '500',
                      marginBottom: '2px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {workspace.name || 'Untitled Workspace'}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {workspace.description || `${(workspace.urls || []).length} URLs`}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary, rgba(255, 255, 255, 0.7))',
                    flexShrink: 0
                  }}>
                    {(workspace.urls || []).length}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px'
        }}>
          <button
            className="filter-btn"
            onClick={handleClose}
            disabled={adding}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}