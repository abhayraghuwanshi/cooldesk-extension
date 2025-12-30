import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faSearch } from '@fortawesome/free-solid-svg-icons';
import { CommandExecutor } from '../../services/commandExecutor.js';
import { CommandParser } from '../../services/commandParser.js';
import { fuzzySearch } from '../../utils/searchUtils.js';

export function CoolSearch({ onSearch, placeholder = "Search or ask AI..." }) {
  const [searchValue, setSearchValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // Command execution state
  const [commandFeedback, setCommandFeedback] = useState(null);
  const [commandSuggestions, setCommandSuggestions] = useState([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // Search suggestions state
  const [searchSuggestions, setSearchSuggestions] = useState([]);

  const [commandExecutor] = useState(() => new CommandExecutor((feedback) => {
    setCommandFeedback(feedback);

    // Auto-clear feedback after 3 seconds (except help)
    if (feedback.type !== 'help') {
      setTimeout(() => setCommandFeedback(null), 3000);
    }
  }));

  // Command suggestions based on input
  useEffect(() => {
    if (!searchValue.startsWith('!') || searchValue.length < 2) {
      setCommandSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    const query = searchValue.slice(1).toLowerCase();
    const allCommands = CommandParser.getAllCommands();

    const matches = allCommands.filter(cmd => {
      const cmdName = cmd.command.toLowerCase();
      return cmdName.includes(query) || cmd.description.toLowerCase().includes(query);
    }).slice(0, 5);

    setCommandSuggestions(matches);
    setSelectedSuggestionIndex(-1);
  }, [searchValue]);

  // Search suggestions from history and bookmarks
  useEffect(() => {
    if (searchValue.startsWith('!') || searchValue.length < 2 || /^https?:\/\//i.test(searchValue)) {
      setSearchSuggestions([]);
      return;
    }

    const query = searchValue.toLowerCase();

    const fetchSuggestions = async () => {
      try {
        const suggestions = [];

        // Search workspaces
        try {
          const { listWorkspaces } = await import('../../db/index.js');
          const workspacesResult = await listWorkspaces();
          const workspaces = workspacesResult?.success ? workspacesResult.data : [];

          if (Array.isArray(workspaces)) {
            const workspaceItems = workspaces.map(ws => {
              const urls = ws?.urls || [];
              const urlTexts = urls.map(urlItem => {
                const url = typeof urlItem === 'string' ? urlItem : urlItem?.url || '';
                const title = typeof urlItem === 'string' ? '' : urlItem?.title || '';
                return `${url} ${title}`;
              }).join(' ');

              const matchedDomains = Array.isArray(ws?.matchedDomains) ? ws.matchedDomains.join(' ') : '';
              const tags = Array.isArray(ws?.tags) ? ws.tags.join(' ') : '';

              return {
                name: ws.name || '',
                description: ws.description || '',
                tags: tags,
                domains: matchedDomains,
                urlContent: urlTexts,
                workspace: ws.name,
                urlCount: urls.length,
                original: ws
              };
            });

            const fuzzyResults = fuzzySearch(workspaceItems, query,
              ['name', 'description', 'tags', 'domains', 'urlContent'],
              { threshold: 0.4 }
            );

            const matchingWorkspaces = fuzzyResults
              .slice(0, 3)
              .map(item => ({
                title: item.name,
                description: item.description || `${item.urlCount} items`,
                workspace: item.workspace,
                type: 'workspace'
              }));

            suggestions.push(...matchingWorkspaces);
          }
        } catch (error) {
          console.warn('[CoolSearch] Failed to search workspaces:', error);
        }

        // Search history
        try {
          if (chrome?.history?.search) {
            const historyResults = await chrome.history.search({
              text: '',
              maxResults: 200,
              startTime: 0
            });

            if (historyResults && historyResults.length > 0) {
              const historyItems = historyResults.map(item => ({
                title: item.title || item.url,
                url: item.url,
                type: 'history',
                visitCount: item.visitCount || 0
              }));

              const fuzzyHistoryResults = fuzzySearch(historyItems, query, ['title', 'url'], {
                threshold: 0.3
              });

              suggestions.push(...fuzzyHistoryResults.slice(0, 4));
            }
          }
        } catch (error) {
          console.warn('[CoolSearch] Failed to search history:', error);
        }

        // Search bookmarks
        try {
          if (chrome?.bookmarks?.search) {
            const bookmarkResults = await chrome.bookmarks.search('');

            if (bookmarkResults && bookmarkResults.length > 0) {
              const bookmarkItems = bookmarkResults
                .filter(item => item.url)
                .map(item => ({
                  title: item.title || item.url,
                  url: item.url,
                  type: 'bookmark'
                }));

              const fuzzyBookmarkResults = fuzzySearch(bookmarkItems, query, ['title', 'url'], {
                threshold: 0.3
              });

              suggestions.push(...fuzzyBookmarkResults.slice(0, 2));
            }
          }
        } catch (error) {
          console.warn('[CoolSearch] Failed to search bookmarks:', error);
        }

        // Sort by priority
        suggestions.sort((a, b) => {
          if (a.type === 'workspace' && b.type !== 'workspace') return -1;
          if (a.type !== 'workspace' && b.type === 'workspace') return 1;
          if (a.type === 'bookmark' && b.type !== 'bookmark' && b.type !== 'workspace') return -1;
          if (a.type !== 'bookmark' && b.type === 'bookmark' && a.type !== 'workspace') return 1;
          return (b.visitCount || 0) - (a.visitCount || 0);
        });

        setSearchSuggestions(suggestions.slice(0, 6));
      } catch (error) {
        console.warn('[CoolSearch] Failed to fetch suggestions:', error);
        setSearchSuggestions([]);
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 150);
    return () => clearTimeout(timeoutId);
  }, [searchValue]);

  useEffect(() => {
    // Initialize speech recognition if available
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setSearchValue(transcript);
        onSearch?.(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [onSearch]);

  const handleChange = (e) => {
    setSearchValue(e.target.value);
  };

  const handleKeyDown = (e) => {
    const activeSuggestions = commandSuggestions.length > 0 ? commandSuggestions : searchSuggestions;
    const isCommandMode = commandSuggestions.length > 0;

    if (activeSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev =>
        prev < activeSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
      e.preventDefault();
      const selected = activeSuggestions[selectedSuggestionIndex];

      if (isCommandMode) {
        setSearchValue(selected.command);
        setCommandSuggestions([]);
      } else {
        // Handle workspace or URL selection
        if (selected.type === 'workspace') {
          handleWorkspaceOpen(selected.workspace);
        } else if (selected.url) {
          if (chrome?.tabs?.create) {
            chrome.tabs.create({ url: selected.url });
          } else {
            window.open(selected.url, '_blank');
          }
        }
        setSearchValue('');
        setSearchSuggestions([]);
      }
      setSelectedSuggestionIndex(-1);
    } else if (e.key === 'Escape') {
      setCommandSuggestions([]);
      setSearchSuggestions([]);
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleWorkspaceOpen = async (workspaceName) => {
    try {
      const { listWorkspaces } = await import('../../db/index.js');
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : workspacesResult || [];

      const workspace = workspaces.find(ws => ws.name === workspaceName);

      if (workspace && workspace.urls) {
        for (const urlItem of workspace.urls.slice(0, 10)) {
          const url = typeof urlItem === 'string' ? urlItem : urlItem?.url;
          if (url) {
            if (chrome?.tabs?.create) {
              chrome.tabs.create({ url, active: false });
            } else {
              window.open(url, '_blank');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
    } catch (error) {
      console.error('[CoolSearch] Failed to open workspace:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!searchValue.trim()) return;

    const query = searchValue.trim();

    // Check if it's a command
    if (CommandParser.isCommand(query)) {
      try {
        const parsed = CommandParser.parse(query);
        console.log('[CoolSearch] Executing command:', parsed);

        const result = await commandExecutor.execute(parsed);
        console.log('[CoolSearch] Command result:', result);

        // If workspace switch, trigger workspace change
        if (result.workspace) {
          window.dispatchEvent(new CustomEvent('workspaceChanged', {
            detail: { workspace: result.workspace }
          }));
        }

        setSearchValue('');
      } catch (error) {
        console.error('[CoolSearch] Command execution error:', error);
        setCommandFeedback({
          type: 'error',
          message: error.message || 'Command failed'
        });
      }
      return;
    }

    // Regular search handling
    let url;

    if (/^https?:\/\//i.test(query)) {
      url = query;
    } else if (/\.\w{2,}/.test(query) && !query.includes(' ')) {
      url = `https://${query}`;
    } else {
      // Use Chrome's default search engine
      if (chrome?.search?.query) {
        chrome.search.query({
          text: query,
          disposition: 'NEW_TAB'
        });
        setSearchValue('');
        return;
      } else {
        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
    }

    // Open in new tab
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }

    setSearchValue('');
  };

  const toggleVoice = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.warn('Speech recognition error:', e);
        setIsListening(false);
      }
    }
  };

  return (
    <div className="cooldesk-search-container">
      <form onSubmit={handleSubmit} className="cooldesk-search-box">
        <FontAwesomeIcon icon={faSearch} style={{ color: '#64748B', fontSize: '18px' }} />
        <input
          type="text"
          className="cooldesk-search-input"
          placeholder={placeholder}
          value={searchValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="cooldesk-voice-btn"
          onClick={toggleVoice}
          title={isListening ? 'Stop listening' : 'Voice search'}
          style={{
            animation: isListening ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          <FontAwesomeIcon icon={faMicrophone} />
        </button>
      </form>

      {/* Command Suggestions Dropdown */}
      {commandSuggestions.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '8px',
          background: 'rgba(30, 41, 59, 0.98)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          zIndex: 1000,
          backdropFilter: 'blur(16px)'
        }}>
          {commandSuggestions.map((cmd, idx) => (
            <div
              key={idx}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                transition: 'background 0.1s ease',
                background: selectedSuggestionIndex === idx
                  ? 'rgba(59, 130, 246, 0.2)'
                  : 'transparent',
                borderBottom: idx < commandSuggestions.length - 1
                  ? '1px solid rgba(148, 163, 184, 0.1)'
                  : 'none'
              }}
              onMouseEnter={() => setSelectedSuggestionIndex(idx)}
              onMouseLeave={() => setSelectedSuggestionIndex(-1)}
              onClick={() => {
                setSearchValue(cmd.command);
                setCommandSuggestions([]);
                setSelectedSuggestionIndex(-1);
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '4px'
              }}>
                <code style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#60A5FA',
                  fontFamily: 'monospace'
                }}>
                  {cmd.command}
                </code>
                <span style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(148, 163, 184, 0.15)',
                  color: '#94A3B8',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {cmd.category}
                </span>
              </div>
              <div style={{
                fontSize: '11px',
                color: '#94A3B8',
                lineHeight: 1.3
              }}>
                {cmd.description}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search Suggestions Dropdown */}
      {searchSuggestions.length > 0 && commandSuggestions.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '8px',
          background: 'rgba(30, 41, 59, 0.98)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          zIndex: 1000,
          backdropFilter: 'blur(16px)'
        }}>
          {searchSuggestions.map((suggestion, idx) => (
            <div
              key={idx}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                transition: 'background 0.1s ease',
                background: selectedSuggestionIndex === idx
                  ? 'rgba(59, 130, 246, 0.2)'
                  : 'transparent',
                borderBottom: idx < searchSuggestions.length - 1
                  ? '1px solid rgba(148, 163, 184, 0.1)'
                  : 'none'
              }}
              onMouseEnter={() => setSelectedSuggestionIndex(idx)}
              onMouseLeave={() => setSelectedSuggestionIndex(-1)}
              onClick={async () => {
                if (suggestion.type === 'workspace') {
                  handleWorkspaceOpen(suggestion.workspace);
                } else if (suggestion.url) {
                  if (chrome?.tabs?.create) {
                    chrome.tabs.create({ url: suggestion.url });
                  } else {
                    window.open(suggestion.url, '_blank');
                  }
                }
                setSearchValue('');
                setSearchSuggestions([]);
                setSelectedSuggestionIndex(-1);
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '4px'
              }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#F1F5F9',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1
                }}>
                  {suggestion.title}
                </div>
                <span style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: suggestion.type === 'workspace'
                    ? 'rgba(139, 92, 246, 0.2)'
                    : suggestion.type === 'bookmark'
                      ? 'rgba(251, 191, 36, 0.2)'
                      : 'rgba(59, 130, 246, 0.2)',
                  color: suggestion.type === 'workspace'
                    ? '#A78BFA'
                    : suggestion.type === 'bookmark'
                      ? '#FDE047'
                      : '#60A5FA',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  flexShrink: 0
                }}>
                  {suggestion.type === 'workspace' ? '💼 Workspace' : suggestion.type === 'bookmark' ? '⭐ Bookmark' : '🕐 History'}
                </span>
              </div>
              <div style={{
                fontSize: '11px',
                color: '#94A3B8',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {suggestion.type === 'workspace' ? suggestion.description : suggestion.url}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Command Feedback */}
      {commandFeedback && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '8px',
          padding: '10px 16px',
          borderRadius: '10px',
          background: commandFeedback.type === 'error'
            ? 'rgba(239, 68, 68, 0.15)'
            : commandFeedback.type === 'success'
              ? 'rgba(34, 197, 94, 0.15)'
              : 'rgba(59, 130, 246, 0.15)',
          border: `1px solid ${commandFeedback.type === 'error'
            ? 'rgba(239, 68, 68, 0.3)'
            : commandFeedback.type === 'success'
              ? 'rgba(34, 197, 94, 0.3)'
              : 'rgba(59, 130, 246, 0.3)'}`,
          color: commandFeedback.type === 'error'
            ? '#F87171'
            : commandFeedback.type === 'success'
              ? '#4ADE80'
              : '#60A5FA',
          fontSize: '12px',
          fontWeight: 500,
          zIndex: 1000
        }}>
          {commandFeedback.message}
        </div>
      )}

      {/* Command Help Hint */}
      {searchValue.startsWith('!') && !commandFeedback && commandSuggestions.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '8px',
          fontSize: '11px',
          opacity: 0.6,
          textAlign: 'center',
          color: '#94A3B8'
        }}>
          Type <code style={{ background: 'rgba(148, 163, 184, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>!?</code> for help
        </div>
      )}
    </div>
  );
}
