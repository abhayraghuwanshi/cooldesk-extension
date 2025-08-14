import React, { useState } from 'react';

export function AddToWorkspaceModal({ show, onClose, onSave, workspace }) {
  const [newUrl, setNewUrl] = useState('');

  if (!show || !workspace) {
    return null;
  }

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

  return (
    <div className="modal-overlay">
      <div className="modal">

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


        <style>{`
          .workspace-description {
            font-size: 0.9em;
            color: #666;
            margin-top: -10px;
            margin-bottom: 15px;
          }
        `}</style>

        {/* <div className="modal-actions">
          <button className="filter-btn" onClick={handleClose}>Cancel</button>
          <button
            className="filter-btn primary"
            onClick={handleSave}
            disabled={!newUrl}
          >
            Add Link
          </button>
        </div> */}
      </div>
    </div>
  );
}
