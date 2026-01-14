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
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)',
              borderRadius: '24px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'hidden',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.1)',
              animation: 'scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              position: 'relative'
            }}
          >
            {/* Gradient Accent */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '4px',
              background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
              opacity: 0.8
            }} />

            {/* Close Button - Redesigned */}
            <button
              className="global-add-close"
              onClick={handleClose}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                fontSize: '18px',
                zIndex: 10
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                e.currentTarget.style.transform = 'rotate(90deg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.transform = 'rotate(0deg)';
              }}
            >
              <FontAwesomeIcon icon={faTimes} />
            </button>

            {/* Content Wrapper with Scroll */}
            <div style={{
              padding: '32px',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}>
              {/* Mode Tabs - Redesigned */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '32px'
              }}>
                {[
                  { key: 'url', icon: faLink, label: 'Add URL', gradient: 'from-blue-500 to-cyan-500' },
                  { key: 'workspace', icon: faFolder, label: 'Workspace', gradient: 'from-purple-500 to-pink-500' },
                  { key: 'note', icon: faStickyNote, label: 'Quick Note', gradient: 'from-amber-500 to-orange-500' }
                ].map(({ key, icon, label, gradient }) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    style={{
                      padding: '16px 12px',
                      borderRadius: '16px',
                      background: mode === key
                        ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
                        : 'rgba(30, 41, 59, 0.5)',
                      border: mode === key
                        ? '2px solid rgba(59, 130, 246, 0.5)'
                        : '2px solid rgba(148, 163, 184, 0.1)',
                      color: mode === key ? '#60a5fa' : '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      fontSize: '12px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                    onMouseEnter={(e) => {
                      if (mode !== key) {
                        e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (mode !== key) {
                        e.currentTarget.style.background = 'rgba(30, 41, 59, 0.5)';
                        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }
                    }}
                  >
                    <FontAwesomeIcon icon={icon} style={{ fontSize: '20px' }} />
                    <span>{label}</span>
                    {mode === key && (
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '3px',
                        background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)',
                        borderRadius: '4px 4px 0 0'
                      }} />
                    )}
                  </button>
                ))}
              </div>

              {/* Forms Content */}
              {mode === 'url' && (
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
                    <FontAwesomeIcon icon={faStar} style={{ fontSize: '20px', color: '#60a5fa' }} />
                    Add URL to Workspace
                  </h2>

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
                        { key: 'current', icon: faLink, label: 'Current Tab' },
                        { key: 'history', icon: faHistory, label: 'History', count: filteredHistory.length },
                        { key: 'bookmarks', icon: faBookmark, label: 'Bookmarks', count: filteredBookmarks.length }
                      ].map(({ key, icon, label, count }) => (
                        <button
                          key={key}
                          onClick={() => {
                            setBrowseMode(key);
                            if (key === 'current' && currentTab) {
                              setUrlInput(currentTab.url);
                              setUrlTitle(currentTab.title);
                            }
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

                  {/* Current Tab / Manual Entry */}
                  {browseMode === 'current' && (
                    <>
                      {currentTab && (
                        <div style={{
                          padding: '16px',
                          borderRadius: '12px',
                          background: 'rgba(30, 41, 59, 0.6)',
                          border: '1px solid rgba(148, 163, 184, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginBottom: '20px'
                        }}>
                          <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: 'rgba(59, 130, 246, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {currentTab.favicon ? (
                              <img src={currentTab.favicon} alt="" width="24" height="24" style={{ borderRadius: '4px' }} />
                            ) : (
                              <FontAwesomeIcon icon={faLink} style={{ color: '#60a5fa', fontSize: '18px' }} />
                            )}
                          </div>
                          <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div style={{
                              fontSize: '14px',
                              fontWeight: 500,
                              color: '#f1f5f9',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginBottom: '4px'
                            }}>{currentTab.title}</div>
                            <div style={{
                              fontSize: '12px',
                              color: '#64748b',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>{new URL(currentTab.url).hostname}</div>
                          </div>
                        </div>
                      )}

                      <div className="form-group" style={{ marginBottom: '16px' }}>
                        <label style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '8px',
                          display: 'block'
                        }}>URL</label>
                        <input
                          type="url"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          placeholder="https://example.com"
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
                            e.target.style.borderColor = '#3b82f6';
                            e.target.style.background = 'rgba(30, 41, 59, 0.8)';
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                            e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                          }}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: '24px' }}>
                        <label style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '8px',
                          display: 'block'
                        }}>Title (optional)</label>
                        <input
                          type="text"
                          value={urlTitle}
                          onChange={(e) => setUrlTitle(e.target.value)}
                          placeholder="Enter a custom title"
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
                            e.target.style.borderColor = '#3b82f6';
                            e.target.style.background = 'rgba(30, 41, 59, 0.8)';
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                            e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                          }}
                        />
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
