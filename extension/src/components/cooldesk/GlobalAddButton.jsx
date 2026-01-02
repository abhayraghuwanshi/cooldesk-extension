import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faTimes,
  faFolder,
  faLink,
  faStickyNote,
  faCheck,
  faFolderOpen,
  faHistory,
  faBookmark,
  faSearch,
  faClock
} from '@fortawesome/free-solid-svg-icons';

export function GlobalAddButton({ workspaces = [], onCreateWorkspace, onAddUrlToWorkspace, onAddNote }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState('url'); // 'url', 'workspace', 'note'
  const [browseMode, setBrowseMode] = useState('current'); // 'current', 'history', 'bookmarks'

  // Form states
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceIcon, setWorkspaceIcon] = useState('folder');
  const [noteText, setNoteText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Browser data
  const [currentTab, setCurrentTab] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);

  useEffect(() => {
    if (isOpen && mode === 'url') {
      // Fetch current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          setCurrentTab({
            url: tabs[0].url,
            title: tabs[0].title,
            favicon: tabs[0].favIconUrl
          });
          if (browseMode === 'current') {
            setUrlInput(tabs[0].url);
            setUrlTitle(tabs[0].title);
          }
        }
      });

      // Fetch history
      chrome.history.search({
        text: '',
        maxResults: 50,
        startTime: Date.now() - 7 * 24 * 60 * 60 * 1000 // Last 7 days
      }, (results) => {
        setHistoryItems(results);
      });

      // Fetch bookmarks
      chrome.bookmarks.getTree((bookmarkTreeNodes) => {
        const flatBookmarks = [];
        const traverse = (nodes) => {
          nodes.forEach(node => {
            if (node.url) {
              flatBookmarks.push({
                id: node.id,
                title: node.title,
                url: node.url
              });
            }
            if (node.children) {
              traverse(node.children);
            }
          });
        };
        traverse(bookmarkTreeNodes);
        setBookmarks(flatBookmarks);
      });
    }
  }, [isOpen, mode]);

  // Auto-select first workspace if available
  useEffect(() => {
    if (isOpen && mode === 'url' && !selectedWorkspace && workspaces.length > 0) {
      setSelectedWorkspace(workspaces[0]);
    }
  }, [isOpen, mode, workspaces]);

  const resetForm = () => {
    setUrlInput('');
    setUrlTitle('');
    setWorkspaceName('');
    setWorkspaceIcon('folder');
    setNoteText('');
    setSearchQuery('');
    setSelectedWorkspace(null);
    setBrowseMode('current');
  };

  const handleOpen = () => {
    setIsOpen(true);
    setMode('url');
    resetForm();
  };

  const handleClose = () => {
    setIsOpen(false);
    resetForm();
  };

  const handleAddUrl = () => {
    if (selectedWorkspace && urlInput.trim()) {
      onAddUrlToWorkspace?.(selectedWorkspace.id, {
        url: urlInput,
        title: urlTitle || new URL(urlInput).hostname
      });
      handleClose();
    }
  };

  const handleCreateWorkspace = () => {
    if (workspaceName.trim()) {
      onCreateWorkspace?.({
        name: workspaceName,
        icon: workspaceIcon,
        urls: []
      });
      handleClose();
    }
  };

  const handleAddNote = () => {
    if (noteText.trim()) {
      onAddNote?.(noteText);
      handleClose();
    }
  };

  const handleSelectItem = (item) => {
    setUrlInput(item.url);
    setUrlTitle(item.title);
    setBrowseMode('current');
  };

  // Filter history and bookmarks based on search
  const filteredHistory = historyItems.filter(item =>
    !searchQuery ||
    item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.url?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBookmarks = bookmarks.filter(item =>
    !searchQuery ||
    item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.url?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {/* Floating Action Button */}
      <button className="global-add-button" onClick={handleOpen} title="Add Content">
        <FontAwesomeIcon icon={faPlus} />
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="global-add-modal-overlay" onClick={handleClose}>
          <div className="global-add-modal simple" onClick={(e) => e.stopPropagation()}>
            <button className="global-add-close" onClick={handleClose}>
              <FontAwesomeIcon icon={faTimes} />
            </button>

            {/* Mode Tabs */}
            <div className="add-mode-tabs">
              <button
                className={`mode-tab ${mode === 'url' ? 'active' : ''}`}
                onClick={() => setMode('url')}
              >
                <FontAwesomeIcon icon={faLink} />
                <span>Add URL</span>
              </button>
              <button
                className={`mode-tab ${mode === 'workspace' ? 'active' : ''}`}
                onClick={() => setMode('workspace')}
              >
                <FontAwesomeIcon icon={faFolder} />
                <span>New Workspace</span>
              </button>
              <button
                className={`mode-tab ${mode === 'note' ? 'active' : ''}`}
                onClick={() => setMode('note')}
              >
                <FontAwesomeIcon icon={faStickyNote} />
                <span>Quick Note</span>
              </button>
            </div>

            {/* Add URL Form */}
            {mode === 'url' && (
              <div className="add-form">
                <h2>Add URL to Workspace</h2>

                {/* Workspace Selector */}
                <div className="form-group">
                  <label>Select Workspace</label>
                  <div className="workspace-selector">
                    {workspaces.map(ws => (
                      <button
                        key={ws.id}
                        className={`workspace-chip ${selectedWorkspace?.id === ws.id ? 'selected' : ''}`}
                        onClick={() => setSelectedWorkspace(ws)}
                      >
                        <FontAwesomeIcon icon={selectedWorkspace?.id === ws.id ? faFolderOpen : faFolder} />
                        <span>{ws.name}</span>
                        {selectedWorkspace?.id === ws.id && (
                          <FontAwesomeIcon icon={faCheck} className="check-icon" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Browse Mode Selector */}
                <div className="form-group">
                  <label>Source</label>
                  <div className="browse-mode-selector">
                    <button
                      className={`browse-mode-btn ${browseMode === 'current' ? 'active' : ''}`}
                      onClick={() => {
                        setBrowseMode('current');
                        if (currentTab) {
                          setUrlInput(currentTab.url);
                          setUrlTitle(currentTab.title);
                        }
                      }}
                    >
                      <FontAwesomeIcon icon={faLink} />
                      <span>Current Tab</span>
                    </button>
                    <button
                      className={`browse-mode-btn ${browseMode === 'history' ? 'active' : ''}`}
                      onClick={() => setBrowseMode('history')}
                    >
                      <FontAwesomeIcon icon={faHistory} />
                      <span>History</span>
                      <span className="count">{filteredHistory.length}</span>
                    </button>
                    <button
                      className={`browse-mode-btn ${browseMode === 'bookmarks' ? 'active' : ''}`}
                      onClick={() => setBrowseMode('bookmarks')}
                    >
                      <FontAwesomeIcon icon={faBookmark} />
                      <span>Bookmarks</span>
                      <span className="count">{filteredBookmarks.length}</span>
                    </button>
                  </div>
                </div>

                {/* Current Tab / Manual Entry */}
                {browseMode === 'current' && (
                  <>
                    {currentTab && (
                      <div className="current-tab-preview">
                        <div className="tab-preview-icon">
                          {currentTab.favicon ? (
                            <img src={currentTab.favicon} alt="" width="20" height="20" />
                          ) : (
                            <FontAwesomeIcon icon={faLink} />
                          )}
                        </div>
                        <div className="tab-preview-info">
                          <div className="tab-preview-title">{currentTab.title}</div>
                          <div className="tab-preview-url">{new URL(currentTab.url).hostname}</div>
                        </div>
                      </div>
                    )}

                    <div className="form-group">
                      <label>URL</label>
                      <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://example.com"
                        className="form-input"
                      />
                    </div>

                    <div className="form-group">
                      <label>Title (optional)</label>
                      <input
                        type="text"
                        value={urlTitle}
                        onChange={(e) => setUrlTitle(e.target.value)}
                        placeholder="Enter a custom title"
                        className="form-input"
                      />
                    </div>
                  </>
                )}

                {/* History Browse */}
                {browseMode === 'history' && (
                  <div className="browse-section">
                    <div className="search-box">
                      <FontAwesomeIcon icon={faSearch} />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search history..."
                        className="search-input"
                        autoFocus
                      />
                    </div>

                    <div className="browse-list">
                      {filteredHistory.slice(0, 15).map((item, idx) => (
                        <button
                          key={idx}
                          className="browse-item"
                          onClick={() => handleSelectItem(item)}
                        >
                          <div className="browse-item-icon">
                            <FontAwesomeIcon icon={faClock} />
                          </div>
                          <div className="browse-item-info">
                            <div className="browse-item-title">{item.title || item.url}</div>
                            <div className="browse-item-url">{new URL(item.url).hostname}</div>
                          </div>
                          <FontAwesomeIcon icon={faCheck} className="browse-item-select" />
                        </button>
                      ))}
                      {filteredHistory.length === 0 && (
                        <div className="browse-empty">No history items found</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Bookmarks Browse */}
                {browseMode === 'bookmarks' && (
                  <div className="browse-section">
                    <div className="search-box">
                      <FontAwesomeIcon icon={faSearch} />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search bookmarks..."
                        className="search-input"
                        autoFocus
                      />
                    </div>

                    <div className="browse-list">
                      {filteredBookmarks.slice(0, 15).map((item, idx) => (
                        <button
                          key={idx}
                          className="browse-item"
                          onClick={() => handleSelectItem(item)}
                        >
                          <div className="browse-item-icon">
                            <FontAwesomeIcon icon={faBookmark} />
                          </div>
                          <div className="browse-item-info">
                            <div className="browse-item-title">{item.title || item.url}</div>
                            <div className="browse-item-url">{new URL(item.url).hostname}</div>
                          </div>
                          <FontAwesomeIcon icon={faCheck} className="browse-item-select" />
                        </button>
                      ))}
                      {filteredBookmarks.length === 0 && (
                        <div className="browse-empty">No bookmarks found</div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  className="submit-btn"
                  onClick={handleAddUrl}
                  disabled={!selectedWorkspace || !urlInput.trim()}
                >
                  <FontAwesomeIcon icon={faCheck} />
                  Add to {selectedWorkspace?.name || 'Workspace'}
                </button>
              </div>
            )}

            {/* Create Workspace Form */}
            {mode === 'workspace' && (
              <div className="add-form">
                <h2>Create New Workspace</h2>

                <div className="form-group">
                  <label>Workspace Name</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="e.g., Work Projects, Personal, Research"
                    className="form-input"
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label>Icon</label>
                  <div className="icon-selector">
                    {['folder', 'folder-open', 'link'].map(icon => (
                      <button
                        key={icon}
                        className={`icon-option ${workspaceIcon === icon ? 'active' : ''}`}
                        onClick={() => setWorkspaceIcon(icon)}
                      >
                        <FontAwesomeIcon
                          icon={icon === 'folder' ? faFolder : icon === 'folder-open' ? faFolderOpen : faLink}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  className="submit-btn"
                  onClick={handleCreateWorkspace}
                  disabled={!workspaceName.trim()}
                >
                  <FontAwesomeIcon icon={faCheck} />
                  Create Workspace
                </button>
              </div>
            )}

            {/* Add Note Form */}
            {mode === 'note' && (
              <div className="add-form">
                <h2>Add Quick Note</h2>

                <div className="form-group">
                  <label>Note</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Write your note here..."
                    className="form-textarea"
                    rows={8}
                    autoFocus
                  />
                </div>

                <button
                  className="submit-btn"
                  onClick={handleAddNote}
                  disabled={!noteText.trim()}
                >
                  <FontAwesomeIcon icon={faCheck} />
                  Add Note
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
