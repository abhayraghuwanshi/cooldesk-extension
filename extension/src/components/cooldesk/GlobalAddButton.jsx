import {
  faBookmark,
  faCheck,
  faClock,
  faFolder,
  faFolderOpen,
  faHistory,
  faLink,
  faPlus,
  faSearch,
  faStar,
  faStickyNote,
  faTimes
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';

export function GlobalAddButton({
  workspaces = [],
  onCreateWorkspace,
  onAddUrlToWorkspace,
  onAddNote,
  isOpen: externalIsOpen,
  onOpen: externalOnOpen,
  onClose: externalOnClose,
  initialWorkspace
}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isControlled = externalIsOpen !== undefined;
  const isOpen = isControlled ? externalIsOpen : internalIsOpen;

  const [mode, setMode] = useState('url'); // 'url', 'workspace', 'note'
  const [browseMode, setBrowseMode] = useState('tabs'); // 'tabs', 'history', 'bookmarks'

  // Form states
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceIcon, setWorkspaceIcon] = useState('folder');
  const [noteText, setNoteText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Browser data
  const [openTabs, setOpenTabs] = useState([]);
  const [historyItems, setHistoryItems] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);

  useEffect(() => {
    if (isOpen && mode === 'url') {
      // Fetch all open tabs
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const tabsList = tabs.map(tab => ({
          url: tab.url,
          title: tab.title,
          favicon: tab.favIconUrl,
          id: tab.id
        }));
        setOpenTabs(tabsList);
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

  // Auto-select workspace logic
  useEffect(() => {
    if (isOpen && mode === 'url') {
      if (initialWorkspace) {
        setSelectedWorkspace(initialWorkspace);
      } else if (!selectedWorkspace && workspaces.length > 0) {
        setSelectedWorkspace(workspaces[0]);
      }
    }
  }, [isOpen, mode, workspaces, initialWorkspace]);

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
    if (isControlled) {
      externalOnOpen?.();
    } else {
      setInternalIsOpen(true);
      setMode('url');
      resetForm();
    }
  };

  const handleClose = () => {
    if (isControlled) {
      externalOnClose?.();
    } else {
      setInternalIsOpen(false);
    }
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
    setBrowseMode('tabs');
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
      {/* Floating Action Button - Redesigned */}
      <button
        className="global-add-button"
        onClick={handleOpen}
        title="Quick Add"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
          border: 'none',
          boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4), 0 0 0 0 rgba(59, 130, 246, 0.7)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '24px',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 9999,
          animation: 'pulse-ring 2s infinite'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1) rotate(90deg)';
          e.currentTarget.style.boxShadow = '0 12px 32px rgba(59, 130, 246, 0.6), 0 0 0 8px rgba(59, 130, 246, 0.2)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.4), 0 0 0 0 rgba(59, 130, 246, 0.7)';
        }}
      >
        <FontAwesomeIcon icon={faPlus} />
      </button>

      {/* Modal - Redesigned */}
      {isOpen && (
        <div
          className="global-add-modal-overlay"
          onClick={handleClose}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            className="global-add-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--glass-bg, rgba(30, 41, 59, 0.95))',
              backdropFilter: 'blur(16px)',
              borderRadius: '20px',
              maxWidth: '800px',
              width: '95%',
              maxHeight: '85vh',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
              border: '1px solid rgba(148, 163, 184, 0.1)',
              animation: 'scaleIn 0.2s ease',
              position: 'relative'
            }}
          >
            {/* Top Bar */}
            <div style={{
              padding: '24px 32px',
              borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 600,
                color: '#f1f5f9',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <FontAwesomeIcon icon={faPlus} style={{ color: '#60a5fa' }} />
                Quick Add
              </h2>
            </div>

            <button
              className="global-add-close"
              onClick={handleClose}
              style={{
                position: 'absolute',
                top: '24px',
                right: '32px',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                fontSize: '18px',
                zIndex: 10
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
                e.currentTarget.style.color = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }}
            >
              <FontAwesomeIcon icon={faTimes} />
            </button>

            {/* Content Wrapper */}
            <div style={{
              padding: '32px',
              maxHeight: 'calc(85vh - 73px)',
              overflowY: 'auto'
            }}>
              {/* Mode Tabs - Simplified Pills */}
              <div style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '32px',
                padding: '6px',
                background: 'rgba(30, 41, 59, 0.5)',
                borderRadius: '12px',
                width: 'fit-content'
              }}>
                {[
                  { key: 'url', icon: faLink, label: 'Add URL' },
                  { key: 'workspace', icon: faFolder, label: 'New Workspace' },
                  { key: 'note', icon: faStickyNote, label: 'Quick Note' }
                ].map(({ key, icon, label }) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      background: mode === key ? '#3b82f6' : 'transparent',
                      border: 'none',
                      color: mode === key ? '#ffffff' : '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s ease',
                      fontSize: '14px',
                      fontWeight: 500,
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                      if (mode !== key) {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                        e.currentTarget.style.color = '#cbd5e1';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (mode !== key) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#94a3b8';
                      }
                    }}
                  >
                    <FontAwesomeIcon icon={icon} style={{ fontSize: '14px' }} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Forms Content */}
              {mode === 'url' && (
                <div className="add-form">
                  {/* Workspace Selector */}
                  <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '12px',
                      display: 'block'
                    }}>Select Workspace</label>
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px'
                    }}>
                      {workspaces.map(ws => (
                        <button
                          key={ws.id}
                          onClick={() => setSelectedWorkspace(ws)}
                          style={{
                            padding: '10px 16px',
                            borderRadius: '12px',
                            background: selectedWorkspace?.id === ws.id
                              ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(139, 92, 246, 0.3) 100%)'
                              : 'rgba(30, 41, 59, 0.6)',
                            border: selectedWorkspace?.id === ws.id
                              ? '2px solid #3b82f6'
                              : '2px solid rgba(148, 163, 184, 0.2)',
                            color: selectedWorkspace?.id === ws.id ? '#60a5fa' : '#cbd5e1',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '14px',
                            fontWeight: 500,
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (selectedWorkspace?.id !== ws.id) {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedWorkspace?.id !== ws.id) {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                            }
                          }}
                        >
                          <FontAwesomeIcon icon={selectedWorkspace?.id === ws.id ? faFolderOpen : faFolder} />
                          <span>{ws.name}</span>
                          {selectedWorkspace?.id === ws.id && (
                            <FontAwesomeIcon icon={faCheck} style={{ fontSize: '12px' }} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Browse Mode Selector */}
                  <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '12px',
                      display: 'block'
                    }}>Source</label>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px'
                    }}>
                      {[
                        { key: 'tabs', icon: faLink, label: 'Open Tabs', count: openTabs.length },
                        { key: 'history', icon: faHistory, label: 'History', count: filteredHistory.length },
                        { key: 'bookmarks', icon: faBookmark, label: 'Bookmarks', count: filteredBookmarks.length }
                      ].map(({ key, icon, label, count }) => (
                        <button
                          key={key}
                          onClick={() => {
                            setBrowseMode(key);
                          }}
                          style={{
                            padding: '12px',
                            borderRadius: '12px',
                            background: browseMode === key
                              ? 'rgba(59, 130, 246, 0.2)'
                              : 'rgba(30, 41, 59, 0.6)',
                            border: browseMode === key
                              ? '2px solid #3b82f6'
                              : '2px solid rgba(148, 163, 184, 0.2)',
                            color: browseMode === key ? '#60a5fa' : '#cbd5e1',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12px',
                            fontWeight: 500,
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <FontAwesomeIcon icon={icon} style={{ fontSize: '16px' }} />
                          <span>{label}</span>
                          {count !== undefined && (
                            <span style={{
                              fontSize: '10px',
                              background: 'rgba(59, 130, 246, 0.2)',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              color: '#60a5fa'
                            }}>{count}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Open Tabs List */}
                  {browseMode === 'tabs' && (
                    <div className="browse-section" style={{ marginBottom: '24px' }}>
                      <div style={{
                        maxHeight: '300px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        marginBottom: '20px'
                      }}>
                        {openTabs.map((tab, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSelectItem(tab)}
                            style={{
                              padding: '12px',
                              borderRadius: '12px',
                              background: 'rgba(30, 41, 59, 0.6)',
                              border: '2px solid rgba(148, 163, 184, 0.1)',
                              color: '#cbd5e1',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              textAlign: 'left',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)';
                            }}
                          >
                            <div style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              background: 'rgba(59, 130, 246, 0.1)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              {tab.favicon ? (
                                <img src={tab.favicon} alt="" width="20" height="20" style={{ borderRadius: '4px' }} />
                              ) : (
                                <FontAwesomeIcon icon={faLink} style={{ color: '#60a5fa', fontSize: '14px' }} />
                              )}
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{
                                fontSize: '13px',
                                fontWeight: 500,
                                color: '#f1f5f9',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                marginBottom: '2px'
                              }}>{tab.title || tab.url}</div>
                              <div style={{
                                fontSize: '11px',
                                color: '#64748b',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}>{new URL(tab.url).hostname}</div>
                            </div>
                            <FontAwesomeIcon icon={faCheck} style={{ color: '#3b82f6', fontSize: '14px', opacity: 0 }} className="select-icon" />
                          </button>
                        ))}
                        {openTabs.length === 0 && (
                          <div style={{
                            padding: '32px',
                            textAlign: 'center',
                            color: '#64748b',
                            fontSize: '14px'
                          }}>No open tabs found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Manual Entry */}
                  {browseMode === 'tabs' && (
                    <>

                      <div className="form-group" style={{ marginBottom: '20px' }}>
                        <label style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <FontAwesomeIcon icon={faLink} style={{ fontSize: '11px', color: '#60a5fa' }} />
                          Enter URL
                        </label>
                        <div style={{ position: 'relative' }}>
                          <FontAwesomeIcon
                            icon={faLink}
                            style={{
                              position: 'absolute',
                              left: '16px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              color: '#94a3b8',
                              fontSize: '14px',
                              pointerEvents: 'none',
                              zIndex: 1
                            }}
                          />
                          <input
                            type="url"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="https://example.com"
                            style={{
                              width: '100%',
                              padding: '14px 16px 14px 44px',
                              borderRadius: '12px',
                              background: 'rgba(51, 65, 85, 0.5)',
                              border: '2px solid rgba(148, 163, 184, 0.3)',
                              color: '#f1f5f9',
                              fontSize: '14px',
                              outline: 'none',
                              transition: 'all 0.2s ease',
                              fontFamily: 'inherit',
                              boxShadow: 'none'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = '#60a5fa';
                              e.target.style.background = 'rgba(51, 65, 85, 0.8)';
                              e.target.style.boxShadow = '0 0 0 3px rgba(96, 165, 250, 0.15)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = 'rgba(148, 163, 184, 0.3)';
                              e.target.style.background = 'rgba(51, 65, 85, 0.5)';
                              e.target.style.boxShadow = 'none';
                            }}
                          />
                        </div>
                      </div>

                      <div className="form-group" style={{ marginBottom: '28px' }}>
                        <label style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <FontAwesomeIcon icon={faStar} style={{ fontSize: '11px', color: '#fbbf24' }} />
                          Title (optional)
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type="text"
                            value={urlTitle}
                            onChange={(e) => setUrlTitle(e.target.value)}
                            placeholder="Enter a custom title"
                            style={{
                              width: '100%',
                              padding: '14px 16px',
                              borderRadius: '14px',
                              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.8) 100%)',
                              border: '2px solid rgba(251, 191, 36, 0.2)',
                              color: '#f1f5f9',
                              fontSize: '14px',
                              outline: 'none',
                              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                              fontFamily: 'inherit',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = '#fbbf24';
                              e.target.style.background = 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)';
                              e.target.style.boxShadow = '0 0 0 4px rgba(251, 191, 36, 0.1), 0 8px 16px rgba(0, 0, 0, 0.2)';
                              e.target.style.transform = 'translateY(-2px)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = 'rgba(251, 191, 36, 0.2)';
                              e.target.style.background = 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.8) 100%)';
                              e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                              e.target.style.transform = 'translateY(0)';
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* History Browse */}
                  {browseMode === 'history' && (
                    <div className="browse-section" style={{ marginBottom: '24px' }}>
                      <div style={{
                        position: 'relative',
                        marginBottom: '16px'
                      }}>
                        <FontAwesomeIcon
                          icon={faSearch}
                          style={{
                            position: 'absolute',
                            left: '16px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: '#64748b',
                            fontSize: '14px'
                          }}
                        />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search history..."
                          autoFocus
                          style={{
                            width: '100%',
                            padding: '12px 16px 12px 44px',
                            borderRadius: '12px',
                            background: 'rgba(30, 41, 59, 0.6)',
                            border: '2px solid rgba(148, 163, 184, 0.2)',
                            color: '#f1f5f9',
                            fontSize: '14px',
                            outline: 'none',
                            transition: 'all 0.2s ease',
                            fontFamily: 'inherit'
                          }}
                          onFocus={(e) => {
                            e.target.style.borderColor = '#3b82f6';
                            e.target.style.background = 'rgba(30, 41, 59, 0.8)';
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                            e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                          }}
                        />
                      </div>

                      <div style={{
                        maxHeight: '300px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        {filteredHistory.slice(0, 15).map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSelectItem(item)}
                            style={{
                              padding: '12px',
                              borderRadius: '12px',
                              background: 'rgba(30, 41, 59, 0.6)',
                              border: '2px solid rgba(148, 163, 184, 0.1)',
                              color: '#cbd5e1',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              textAlign: 'left',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)';
                            }}
                          >
                            <div style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              background: 'rgba(59, 130, 246, 0.1)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              <FontAwesomeIcon icon={faClock} style={{ color: '#60a5fa', fontSize: '14px' }} />
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{
                                fontSize: '13px',
                                fontWeight: 500,
                                color: '#f1f5f9',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                marginBottom: '2px'
                              }}>{item.title || item.url}</div>
                              <div style={{
                                fontSize: '11px',
                                color: '#64748b',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}>{new URL(item.url).hostname}</div>
                            </div>
                            <FontAwesomeIcon icon={faCheck} style={{ color: '#3b82f6', fontSize: '14px', opacity: 0 }} className="select-icon" />
                          </button>
                        ))}
                        {filteredHistory.length === 0 && (
                          <div style={{
                            padding: '32px',
                            textAlign: 'center',
                            color: '#64748b',
                            fontSize: '14px'
                          }}>No history items found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Bookmarks Browse */}
                  {browseMode === 'bookmarks' && (
                    <div className="browse-section" style={{ marginBottom: '24px' }}>
                      <div style={{
                        position: 'relative',
                        marginBottom: '16px'
                      }}>
                        <FontAwesomeIcon
                          icon={faSearch}
                          style={{
                            position: 'absolute',
                            left: '16px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: '#64748b',
                            fontSize: '14px'
                          }}
                        />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search bookmarks..."
                          autoFocus
                          style={{
                            width: '100%',
                            padding: '12px 16px 12px 44px',
                            borderRadius: '12px',
                            background: 'rgba(30, 41, 59, 0.6)',
                            border: '2px solid rgba(148, 163, 184, 0.2)',
                            color: '#f1f5f9',
                            fontSize: '14px',
                            outline: 'none',
                            transition: 'all 0.2s ease',
                            fontFamily: 'inherit'
                          }}
                          onFocus={(e) => {
                            e.target.style.borderColor = '#3b82f6';
                            e.target.style.background = 'rgba(30, 41, 59, 0.8)';
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                            e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                          }}
                        />
                      </div>

                      <div style={{
                        maxHeight: '300px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        {filteredBookmarks.slice(0, 15).map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSelectItem(item)}
                            style={{
                              padding: '12px',
                              borderRadius: '12px',
                              background: 'rgba(30, 41, 59, 0.6)',
                              border: '2px solid rgba(148, 163, 184, 0.1)',
                              color: '#cbd5e1',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              textAlign: 'left',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)';
                            }}
                          >
                            <div style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              background: 'rgba(236, 72, 153, 0.1)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              <FontAwesomeIcon icon={faBookmark} style={{ color: '#ec4899', fontSize: '14px' }} />
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{
                                fontSize: '13px',
                                fontWeight: 500,
                                color: '#f1f5f9',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                marginBottom: '2px'
                              }}>{item.title || item.url}</div>
                              <div style={{
                                fontSize: '11px',
                                color: '#64748b',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}>{new URL(item.url).hostname}</div>
                            </div>
                            <FontAwesomeIcon icon={faCheck} style={{ color: '#ec4899', fontSize: '14px', opacity: 0 }} className="select-icon" />
                          </button>
                        ))}
                        {filteredBookmarks.length === 0 && (
                          <div style={{
                            padding: '32px',
                            textAlign: 'center',
                            color: '#64748b',
                            fontSize: '14px'
                          }}>No bookmarks found</div>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleAddUrl}
                    disabled={!selectedWorkspace || !urlInput.trim()}
                    style={{
                      width: '100%',
                      padding: '14px 24px',
                      borderRadius: '14px',
                      background: !selectedWorkspace || !urlInput.trim()
                        ? 'rgba(71, 85, 105, 0.4)'
                        : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                      border: 'none',
                      color: !selectedWorkspace || !urlInput.trim() ? '#64748b' : 'white',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: !selectedWorkspace || !urlInput.trim() ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: !selectedWorkspace || !urlInput.trim()
                        ? 'none'
                        : '0 4px 16px rgba(59, 130, 246, 0.4)'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedWorkspace && urlInput.trim()) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.6)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = selectedWorkspace && urlInput.trim()
                        ? '0 4px 16px rgba(59, 130, 246, 0.4)'
                        : 'none';
                    }}
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    Add to {selectedWorkspace?.name || 'Workspace'}
                  </button>
                </div>
              )}

              {/* Create Workspace Form */}
              {mode === 'workspace' && (
                <div className="add-form">
                  <h2 style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#f1f5f9',
                    marginBottom: '24px',
                    background: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <FontAwesomeIcon icon={faStar} style={{ fontSize: '20px', color: '#a855f7' }} />
                    Create New Workspace
                  </h2>

                  <div className="form-group" style={{ marginBottom: '20px' }}>
                    <label style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '8px',
                      display: 'block'
                    }}>Workspace Name</label>
                    <input
                      type="text"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="e.g., Work Projects, Personal, Research"
                      autoFocus
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        background: 'rgba(30, 41, 59, 0.6)',
                        border: '2px solid rgba(148, 163, 184, 0.2)',
                        color: '#f1f5f9',
                        fontSize: '14px',
                        outline: 'none',
                        transition: 'all 0.2s ease',
                        fontFamily: 'inherit'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = '#8b5cf6';
                        e.target.style.background = 'rgba(30, 41, 59, 0.8)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                        e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                      }}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '32px' }}>
                    <label style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '12px',
                      display: 'block'
                    }}>Icon</label>
                    <div style={{
                      display: 'flex',
                      gap: '12px'
                    }}>
                      {[
                        { key: 'folder', icon: faFolder },
                        { key: 'folder-open', icon: faFolderOpen },
                        { key: 'link', icon: faLink }
                      ].map(({ key, icon }) => (
                        <button
                          key={key}
                          onClick={() => setWorkspaceIcon(key)}
                          style={{
                            flex: 1,
                            padding: '16px',
                            borderRadius: '12px',
                            background: workspaceIcon === key
                              ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.3) 100%)'
                              : 'rgba(30, 41, 59, 0.6)',
                            border: workspaceIcon === key
                              ? '2px solid #8b5cf6'
                              : '2px solid rgba(148, 163, 184, 0.2)',
                            color: workspaceIcon === key ? '#a855f7' : '#cbd5e1',
                            cursor: 'pointer',
                            fontSize: '24px',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (workspaceIcon !== key) {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (workspaceIcon !== key) {
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                              e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                            }
                          }}
                        >
                          <FontAwesomeIcon icon={icon} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleCreateWorkspace}
                    disabled={!workspaceName.trim()}
                    style={{
                      width: '100%',
                      padding: '14px 24px',
                      borderRadius: '14px',
                      background: !workspaceName.trim()
                        ? 'rgba(71, 85, 105, 0.4)'
                        : 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
                      border: 'none',
                      color: !workspaceName.trim() ? '#64748b' : 'white',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: !workspaceName.trim() ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: !workspaceName.trim()
                        ? 'none'
                        : '0 4px 16px rgba(139, 92, 246, 0.4)'
                    }}
                    onMouseEnter={(e) => {
                      if (workspaceName.trim()) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(139, 92, 246, 0.6)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = workspaceName.trim()
                        ? '0 4px 16px rgba(139, 92, 246, 0.4)'
                        : 'none';
                    }}
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    Create Workspace
                  </button>
                </div>
              )}

              {/* Add Note Form */}
              {mode === 'note' && (
                <div className="add-form">
                  <h2 style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#f1f5f9',
                    marginBottom: '24px',
                    background: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <FontAwesomeIcon icon={faStar} style={{ fontSize: '20px', color: '#fb923c' }} />
                    Add Quick Note
                  </h2>

                  <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#94a3b8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '8px',
                      display: 'block'
                    }}>Note</label>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Write your note here..."
                      rows={8}
                      autoFocus
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        background: 'rgba(30, 41, 59, 0.6)',
                        border: '2px solid rgba(148, 163, 184, 0.2)',
                        color: '#f1f5f9',
                        fontSize: '14px',
                        outline: 'none',
                        transition: 'all 0.2s ease',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        lineHeight: '1.6'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = '#fb923c';
                        e.target.style.background = 'rgba(30, 41, 59, 0.8)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                        e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                      }}
                    />
                  </div>

                  <button
                    onClick={handleAddNote}
                    disabled={!noteText.trim()}
                    style={{
                      width: '100%',
                      padding: '14px 24px',
                      borderRadius: '14px',
                      background: !noteText.trim()
                        ? 'rgba(71, 85, 105, 0.4)'
                        : 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                      border: 'none',
                      color: !noteText.trim() ? '#64748b' : 'white',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: !noteText.trim() ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: !noteText.trim()
                        ? 'none'
                        : '0 4px 16px rgba(245, 158, 11, 0.4)'
                    }}
                    onMouseEnter={(e) => {
                      if (noteText.trim()) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(245, 158, 11, 0.6)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = noteText.trim()
                        ? '0 4px 16px rgba(245, 158, 11, 0.4)'
                        : 'none';
                    }}
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    Add Note
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-ring {
          0%, 100% {
            box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4), 0 0 0 0 rgba(59, 130, 246, 0.7);
          }
          50% {
            box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4), 0 0 0 8px rgba(59, 130, 246, 0);
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            transform: scale(0.95);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }

        .browse-item:hover .select-icon {
          opacity: 1 !important;
        }
      `}</style>
    </>
  );
}
