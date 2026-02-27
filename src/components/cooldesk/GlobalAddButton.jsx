import {
  faBookmark,
  faCheck,
  faClock,
  faFolder,
  faFolderOpen,
  faHistory,
  faLink,
  faMagicWandSparkles,
  faPlus,
  faSearch,
  faStar,
  faStickyNote,
  faTimes
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import NanoAIService from '../../services/nanoAIService';
import { safeGetHostname } from '../../utils/helpers';

export function GlobalAddButton({
  workspaces = [],
  onCreateWorkspace,
  onAddUrlToWorkspace,
  onAddNote,
  isOpen: externalIsOpen,
  onOpen: externalOnOpen,
  onClose: externalOnClose,
  initialWorkspace,
  ...rest
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

  // AI Workspace Suggestion States
  const [isSuggestingLinks, setIsSuggestingLinks] = useState(false);
  const [suggestedLinks, setSuggestedLinks] = useState([]);
  const [selectedSuggestedLinks, setSelectedSuggestedLinks] = useState(new Set());
  const [aiSuggestionError, setAiSuggestionError] = useState('');
  const [suggestedWorkspaceNames, setSuggestedWorkspaceNames] = useState([]);
  const [isSuggestingName, setIsSuggestingName] = useState(false);

  // Multi-Select URL States
  const [selectedUrls, setSelectedUrls] = useState(new Set());

  // AI URL Command States
  const [aiCommand, setAiCommand] = useState('');
  const [isAiProcessingLinks, setIsAiProcessingLinks] = useState(false);
  const [aiUrlError, setAiUrlError] = useState('');

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
        maxResults: 1000,
        startTime: Date.now() - 30 * 24 * 60 * 60 * 1000 // Last 30 days
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
    setSuggestedLinks([]);
    setSelectedSuggestedLinks(new Set());
    setSelectedUrls(new Set());
    setAiSuggestionError('');
    setAiCommand('');
    setAiUrlError('');
    setSuggestedWorkspaceNames([]);
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

  const handleAddUrl = async () => {
    if (selectedWorkspace) {
      // If we have multi-selected URLs, add them all
      if (selectedUrls.size > 0) {
        // Find matching items to get their full info (title, favicon)
        const allItems = [...openTabs, ...historyItems, ...bookmarks]; // Use historyItems directly, filteredHistory is for UI
        const itemsToAdd = allItems.filter(item => selectedUrls.has(item.url));

        // Deduplicate
        const uniqueItems = Array.from(new Map(itemsToAdd.map(item => [item.url, item])).values());

        for (const item of uniqueItems) {
          await onAddUrlToWorkspace?.(selectedWorkspace.id, item);
        }
      }
      // Fallback for manual manual entry
      else if (urlInput.trim()) {
        await onAddUrlToWorkspace?.(selectedWorkspace.id, {
          url: urlInput,
          title: urlTitle || safeGetHostname(urlInput)
        });
      }
      handleClose();
    }
  };

  const handleCreateWorkspace = async () => {
    if (workspaceName.trim()) {
      const urlsToAdd = suggestedLinks.filter(link => selectedSuggestedLinks.has(link.url));

      try {
        const newWorkspace = await onCreateWorkspace?.({
          name: workspaceName,
          icon: workspaceIcon,
          urls: []
        });

        // If the parent component returns the new workspace (or its ID), we add the URLs
        if (newWorkspace && newWorkspace.id && urlsToAdd.length > 0) {
          for (const link of urlsToAdd) {
            await onAddUrlToWorkspace?.(newWorkspace.id, link);
          }
        } else if (urlsToAdd.length > 0) {
          console.warn("Could not add suggested links because workspace creation did not return the new workspace object/ID.");
        }
      } catch (err) {
        console.error("Error creating workspace or adding suggested links:", err);
      }
      handleClose();
    }
  };

  const handleSuggestWorkspaceLinks = async () => {
    if (!workspaceName.trim()) return;

    setIsSuggestingLinks(true);
    setAiSuggestionError('');
    setSuggestedLinks([]);
    setSelectedSuggestedLinks(new Set());

    try {
      // Combine open tabs, history, and bookmarks into a searchable pool
      const searchPool = [];
      const seenUrls = new Set();

      const addToPool = (items) => {
        items.forEach(item => {
          if (item.url && !seenUrls.has(item.url) && !item.url.startsWith('chrome://')) {
            seenUrls.add(item.url);
            searchPool.push({
              url: item.url,
              title: item.title || safeGetHostname(item.url),
              favicon: item.favicon
            });
          }
        });
      };

      addToPool(openTabs);
      addToPool(historyItems.slice(0, 10000)); // Limit history to recent

      if (searchPool.length === 0) {
        setAiSuggestionError('No browser history or tabs found to suggest from.');
        setIsSuggestingLinks(false);
        return;
      }

      // Use NanoAI to find relevant links
      const prompt = `Find links related to the workspace category: "${workspaceName}"`;
      const rankedResults = await NanoAIService.naturalLanguageSearch(prompt, searchPool, 10);

      if (rankedResults && rankedResults.length > 0 && rankedResults[0]._aiMatched) {
        setSuggestedLinks(rankedResults);
        // Auto-select top 5 suggestions
        const newSelection = new Set();
        rankedResults.slice(0, 5).forEach(link => newSelection.add(link.url));
        setSelectedSuggestedLinks(newSelection);
      } else {
        setAiSuggestionError(`Could not find links strongly related to "${workspaceName}".`);
      }

    } catch (err) {
      console.error("Error suggesting workspace links:", err);
      setAiSuggestionError('AI suggestion failed. ' + err.message);
    } finally {
      setIsSuggestingLinks(false);
    }
  };

  const handleAutoSuggestWorkspaceName = async () => {
    if (openTabs.length === 0) {
      setAiSuggestionError('Open some tabs first to get workspace suggestions.');
      return;
    }

    setIsSuggestingName(true);
    setAiSuggestionError('');

    try {
      const suggestions = await LocalAIService.suggestWorkspaces(openTabs.slice(0, 10));
      if (suggestions && suggestions.length > 0) {
        setSuggestedWorkspaceNames(suggestions);
      } else {
        setAiSuggestionError('Could not find a cohesive workspace name for these tabs.');
      }
    } catch (err) {
      console.error("Error suggesting workspace name:", err);
      // Fallback to legacy NanoAI prompt if LocalAI fails
      try {
        const text = openTabs.slice(0, 5).map(t => t.title).join(', ');
        const prompt = `Based on these tabs: ${text}, suggest 3 short (2-3 word) workspace names as a JSON array ["Name 1", "Name 2", "Name 3"]`;
        const result = await NanoAIService.prompt(prompt);
        const match = result.match(/\[.*\]/);
        if (match) setSuggestedWorkspaceNames(JSON.parse(match[0]));
      } catch (e) {
        setAiSuggestionError('AI suggestion failed.');
      }
    } finally {
      setIsSuggestingName(false);
    }
  };

  const handleAiUrlCommand = async () => {
    if (!aiCommand.trim()) return;

    setIsAiProcessingLinks(true);
    setAiUrlError('');

    try {
      // Determine which list we are filtering
      let sourceList = [];
      if (browseMode === 'tabs') sourceList = openTabs;
      else if (browseMode === 'history') sourceList = filteredHistory.slice(0, 10000); // Limit context
      else if (browseMode === 'bookmarks') sourceList = filteredBookmarks;

      if (sourceList.length === 0) {
        setAiUrlError('No items in the selected source to filter.');
        setIsAiProcessingLinks(false);
        return;
      }

      // Use NanoAI Search to rank items based on the command
      const prompt = `Based on the user command: "${aiCommand}", find matching relevant links.`;
      const rankedResults = await NanoAIService.naturalLanguageSearch(prompt, sourceList, 20);

      if (rankedResults && rankedResults.length > 0) {
        // Select items that NanoAI marked as a match (_aiMatched)
        const matchedItems = rankedResults.filter(item => item._aiMatched);
        if (matchedItems.length > 0) {
          const nextSelected = new Set(selectedUrls);
          matchedItems.forEach(item => {
            nextSelected.add(item.url);
          });
          setSelectedUrls(nextSelected);
        } else {
          setAiUrlError('Could not find links matching your command.');
        }
      } else {
        setAiUrlError('Could not find links matching your command.');
      }
    } catch (err) {
      console.error("Error processing AI URL command:", err);
      setAiUrlError('AI processing failed. ' + err.message);
    } finally {
      setIsAiProcessingLinks(false);
    }
  };

  const handleAddNote = () => {
    if (noteText.trim()) {
      onAddNote?.(noteText);
      handleClose();
    }
  };

  const handleSelectItem = (item) => {
    // Toggle selection
    const next = new Set(selectedUrls);
    if (next.has(item.url)) {
      next.delete(item.url);
    } else {
      next.add(item.url);
    }
    setSelectedUrls(next);

    // Legacy support for manual input syncing (for single selection behavior)
    // If only one item is selected, populate the manual input fields
    if (next.size === 1) {
      setUrlInput(item.url);
      setUrlTitle(item.title || '');
    } else if (next.size === 0) {
      setUrlInput('');
      setUrlTitle('');
    }
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

  const renderBrowseSection = (itemsList, icon, browseModeKey) => {
    return (
      <div className="browse-section" style={{ marginBottom: '24px' }}>
        {browseModeKey !== 'tabs' && ( // Only show search for history and bookmarks
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
              placeholder={`Search ${browseModeKey}...`}
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
        )}

        <div style={{
          maxHeight: '300px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          marginBottom: '20px'
        }}>
          {itemsList.map((item, idx) => {
            const isSelected = selectedUrls.has(item.url);
            return (
              <button
                key={idx}
                onClick={() => handleSelectItem(item)}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: isSelected ? 'rgba(168, 85, 247, 0.15)' : 'rgba(30, 41, 59, 0.6)',
                  border: isSelected ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(148, 163, 184, 0.1)',
                  color: isSelected ? '#f1f5f9' : '#cbd5e1',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  textAlign: 'left',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.border = '1px solid rgba(148, 163, 184, 0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                    e.currentTarget.style.border = '1px solid rgba(148, 163, 184, 0.1)';
                  }
                }}
              >
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: isSelected ? '#a855f7' : 'rgba(59, 130, 246, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  border: isSelected ? 'none' : '1px solid rgba(148, 163, 184, 0.2)'
                }}>
                  {isSelected ? (
                    <FontAwesomeIcon icon={faCheck} style={{ color: 'white', fontSize: '14px' }} />
                  ) : item.favicon ? (
                    <img src={item.favicon} alt="" width="20" height="20" style={{ borderRadius: '4px' }} />
                  ) : (
                    <FontAwesomeIcon icon={icon} style={{ color: '#60a5fa', fontSize: '14px' }} />
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
                  }}>{item.title || item.url}</div>
                  <div style={{
                    fontSize: '11px',
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>{safeGetHostname(item.url)}</div>
                </div>
              </button>
            )
          })}
          {itemsList.length === 0 && (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              color: '#64748b',
              fontSize: '14px'
            }}>No {browseModeKey} found matching your search</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Floating Action Button - Redesigned */}
      <button
        className="global-add-button"
        onClick={handleOpen}
        title="Quick Add"
        {...rest}
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
                  {/* AI Smart Filter Input */}
                  <div className="form-group" style={{ marginBottom: '24px' }}>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        value={aiCommand}
                        onChange={(e) => setAiCommand(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAiUrlCommand();
                          }
                        }}
                        placeholder="✨ AI Manager: e.g. 'find my github repos', 'keep text links'"
                        style={{
                          width: '100%',
                          padding: '14px 16px 14px 44px',
                          borderRadius: '12px',
                          background: 'rgba(30, 41, 59, 0.4)',
                          border: '2px solid rgba(168, 85, 247, 0.3)',
                          color: '#f1f5f9',
                          fontSize: '14px',
                          outline: 'none',
                          transition: 'all 0.2s ease',
                          fontFamily: 'inherit'
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor = '#a855f7';
                          e.target.style.background = 'rgba(30, 41, 59, 0.6)';
                          e.target.style.boxShadow = '0 0 0 4px rgba(168, 85, 247, 0.1)';
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = 'rgba(168, 85, 247, 0.3)';
                          e.target.style.background = 'rgba(30, 41, 59, 0.4)';
                          e.target.style.boxShadow = 'none';
                        }}
                      />
                      <div style={{
                        position: 'absolute',
                        left: '16px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: '#a855f7',
                        fontSize: '16px'
                      }}>
                        {isAiProcessingLinks ? (
                          <div className="spinner" style={{ width: '16px', height: '16px', border: '2px solid rgba(168, 85, 247, 0.3)', borderTopColor: '#a855f7', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <FontAwesomeIcon icon={faStar} />
                        )}
                      </div>

                      {aiUrlError && (
                        <div style={{
                          marginTop: '8px',
                          padding: '8px 12px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '8px',
                          color: '#f87171',
                          fontSize: '12px'
                        }}>
                          {aiUrlError}
                        </div>
                      )}
                    </div>
                  </div>

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
                  {browseMode === 'tabs' && renderBrowseSection(openTabs, faLink, 'tabs')}

                  {/* Manual Entry */}
                  {(urlInput.trim() || selectedUrls.size === 0) && ( // Only show manual entry if no items are selected or if there's manual input
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
                  {browseMode === 'history' && renderBrowseSection(filteredHistory.slice(0, 15), faClock, 'history')}

                  {/* Bookmarks Browse */}
                  {browseMode === 'bookmarks' && renderBrowseSection(filteredBookmarks.slice(0, 15), faBookmark, 'bookmarks')}

                  <button
                    onClick={handleAddUrl}
                    disabled={(!urlInput.trim() && selectedUrls.size === 0) || !selectedWorkspace}
                    style={{
                      width: '100%',
                      padding: '14px 24px',
                      borderRadius: '14px',
                      background: (!urlInput.trim() && selectedUrls.size === 0) || !selectedWorkspace
                        ? 'rgba(71, 85, 105, 0.4)'
                        : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                      border: 'none',
                      color: (!urlInput.trim() && selectedUrls.size === 0) || !selectedWorkspace ? '#64748b' : 'white',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: (!urlInput.trim() && selectedUrls.size === 0) || !selectedWorkspace ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: (!urlInput.trim() && selectedUrls.size === 0) || !selectedWorkspace
                        ? 'none'
                        : '0 4px 16px rgba(59, 130, 246, 0.4)'
                    }}
                    onMouseEnter={(e) => {
                      if ((urlInput.trim() || selectedUrls.size > 0) && selectedWorkspace) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.6)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = selectedWorkspace && (urlInput.trim() || selectedUrls.size > 0)
                        ? '0 4px 16px rgba(59, 130, 246, 0.4)'
                        : 'none';
                    }}
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    {selectedUrls.size > 1 ? `Add ${selectedUrls.size} items to ${selectedWorkspace?.name || 'Workspace'}` : `Add to ${selectedWorkspace?.name || 'Workspace'}`}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>Workspace Name</label>

                      <button
                        onClick={handleAutoSuggestWorkspaceName}
                        disabled={isSuggestingName}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#a855f7',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <FontAwesomeIcon icon={faMagicWandSparkles} spin={isSuggestingName} />
                        {isSuggestingName ? 'Magic...' : 'Auto-Suggest'}
                      </button>
                    </div>

                    {suggestedWorkspaceNames.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                        {suggestedWorkspaceNames.map((name, i) => (
                          <button
                            key={i}
                            onClick={() => setWorkspaceName(name)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              background: 'rgba(168, 85, 247, 0.1)',
                              border: '1px solid rgba(168, 85, 247, 0.2)',
                              color: '#d8b4fe',
                              fontSize: '11px',
                              cursor: 'pointer'
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}

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

                  {/* AI Link Suggestions */}
                  <div className="form-group" style={{ marginBottom: '32px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '12px'
                    }}>
                      <label style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <FontAwesomeIcon icon={faStar} style={{ fontSize: '11px', color: '#a855f7' }} />
                        Smart Populate
                      </label>

                      <button
                        onClick={handleSuggestWorkspaceLinks}
                        disabled={isSuggestingLinks || !workspaceName.trim()}
                        style={{
                          background: isSuggestingLinks ? 'transparent' : 'rgba(168, 85, 247, 0.15)',
                          border: '1px solid rgba(168, 85, 247, 0.3)',
                          borderRadius: '8px',
                          padding: '6px 12px',
                          color: '#d8b4fe',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: isSuggestingLinks || !workspaceName.trim() ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.2s',
                          opacity: !workspaceName.trim() ? 0.5 : 1
                        }}
                        onMouseEnter={e => {
                          if (!isSuggestingLinks && workspaceName.trim()) {
                            e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isSuggestingLinks && workspaceName.trim()) {
                            e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                          }
                        }}
                      >
                        {isSuggestingLinks ? (
                          <>
                            <div className="spinner" style={{ width: '12px', height: '12px', border: '2px solid rgba(216, 180, 254, 0.3)', borderTopColor: '#d8b4fe', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                            Analyzing...
                          </>
                        ) : (
                          <>✨ Suggest Links</>
                        )}
                      </button>
                    </div>

                    {aiSuggestionError && (
                      <div style={{
                        padding: '10px 14px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '8px',
                        color: '#f87171',
                        fontSize: '13px',
                        marginBottom: '12px'
                      }}>
                        {aiSuggestionError}
                      </div>
                    )}

                    {suggestedLinks.length > 0 && (
                      <div style={{
                        maxHeight: '220px',
                        overflowY: 'auto',
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: '1px solid rgba(148, 163, 184, 0.1)',
                        borderRadius: '12px',
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}>
                        {suggestedLinks.map((link, idx) => {
                          const isSelected = selectedSuggestedLinks.has(link.url);
                          return (
                            <button
                              key={idx}
                              onClick={() => {
                                const next = new Set(selectedSuggestedLinks);
                                if (isSelected) next.delete(link.url);
                                else next.add(link.url);
                                setSelectedSuggestedLinks(next);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '10px',
                                borderRadius: '8px',
                                background: isSelected ? 'rgba(168, 85, 247, 0.1)' : 'transparent',
                                border: isSelected ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid transparent',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={e => {
                                if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              }}
                              onMouseLeave={e => {
                                if (!isSelected) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <div style={{
                                width: '18px',
                                height: '18px',
                                borderRadius: '4px',
                                border: isSelected ? 'none' : '2px solid rgba(148, 163, 184, 0.4)',
                                background: isSelected ? '#a855f7' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}>
                                {isSelected && <FontAwesomeIcon icon={faCheck} style={{ color: 'white', fontSize: '10px' }} />}
                              </div>
                              <div style={{ flex: 1, overflow: 'hidden' }}>
                                <div style={{
                                  fontSize: '13px',
                                  color: isSelected ? '#f1f5f9' : '#cbd5e1',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  fontWeight: isSelected ? '500' : '400'
                                }}>{link.title}</div>
                                <div style={{
                                  fontSize: '11px',
                                  color: '#64748b',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}>{safeGetHostname(link.url)}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
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
