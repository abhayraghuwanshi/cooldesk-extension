import React, { useState, useEffect } from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../utils';

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
      <div className="modal">
        <h3>Create New Workspace</h3>

        {currentTab && (
          <div className="current-tab-info">
            <div className="tab-preview">
              <img src={getFaviconUrl(currentTab.url)} alt="" className="tab-favicon" />
              <div className="tab-details">
                <div className="tab-title">{currentTab.title}</div>
                <div className="tab-url">{currentTab.url}</div>
              </div>
            </div>
          </div>
        )}

        <label>
          <span>Workspace Name *</span>
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="Enter workspace name..."
            autoFocus
          />
        </label>

        <label>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you working on? (optional)"
            rows="3"
          />
        </label>

        <div className="modal-actions">
          <button className="filter-btn" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="filter-btn primary"
            onClick={handleCreate}
            disabled={!workspaceName.trim() || loading}
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
