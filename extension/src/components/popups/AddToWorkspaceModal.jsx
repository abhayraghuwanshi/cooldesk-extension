import React, { useMemo, useState } from 'react';
import { getFaviconUrl } from '../../utils/helpers';

export function AddToWorkspaceModal({ show, onClose, onSave, workspace, suggestions = [] }) {
  const [newUrl, setNewUrl] = useState('');

  const handleSave = () => {
    // Basic URL validation could be improved
    if (newUrl && (newUrl.startsWith('http://') || newUrl.startsWith('https://'))) {
      onSave(workspace.id, newUrl);
      setNewUrl(''); // Reset after save
    } else {
      alert('Please enter a valid URL.');
    }
  };

  const handleClose = () => {
    setNewUrl(''); // Reset on close
    onClose();
  };

  const filtered = useMemo(() => {
    const q = (newUrl || '').trim().toLowerCase();
    const existing = new Set((workspace?.urls || []).map(u => u.url));
    const base = suggestions.filter(it => !existing.has(it.url));
    if (!q) return base.slice(0, 20);
    const res = base.filter((it) => {
      const t = (it.title || '').toLowerCase();
      const u = (it.url || '').toLowerCase();
      const s = (it.summary || '').toLowerCase();
      return t.includes(q) || u.includes(q) || s.includes(q);
    });
    return res.slice(0, 20);
  }, [newUrl, suggestions, workspace]);

  // Only after hooks are declared can we conditionally return
  if (!show || !workspace) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
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
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Add to "{workspace.name}"
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
              ({(workspace.urls || []).length} existing)
            </span>
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

        {workspace.description && (
          <p className="workspace-description">{workspace.description}</p>
        )}

        <label>
          <span>URL</span>
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/page"
            autoFocus
          />
        </label>

        {/* Suggestions list */}
        <div className="suggestions" style={{ marginTop: 8 }}>
          {filtered.length > 0 && (
            <ul className="workspace-grid" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {filtered.map((it) => {
                const favicon = getFaviconUrl(it.url);
                return (
                  <li key={it.id} className="workspace-item" onClick={() => setNewUrl(it.url)} title={it.url}>
                    <div className="item-header">
                      <div className="item-info">
                        {favicon && <img className="favicon" src={favicon} alt="" />}
                        <div className="domain-info">
                          <span className="title" style={{ display: 'block' }}>{it.title || it.url}</span>
                          <span className="url-key" style={{ opacity: 0.8, fontSize: 12 }}>{it.url}</span>
                        </div>
                      </div>
                      <div className="item-actions">
                        <button className="details-btn" onClick={(e) => { e.stopPropagation(); setNewUrl(it.url); }}>Use</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>


        <style>{`
          .workspace-description {
            font-size: 0.9em;
            color: #666;
            margin-top: -10px;
            margin-bottom: 15px;
          }
        `}</style>

        <div className="modal-actions" style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="filter-btn" onClick={handleClose}>Cancel</button>
          <button
            className="filter-btn primary"
            onClick={handleSave}
            disabled={!newUrl}
          >
            Add Link
          </button>
        </div>
      </div>
    </div>
  );
}
