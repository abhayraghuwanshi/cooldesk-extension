import { faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import { useEffect, useRef, useState } from 'react';
import { CommandExecutor } from '../../services/commandExecutor.js';
import { CommandParser } from '../../services/commandParser.js';
import { VoiceCommandProcessor } from '../../services/voiceCommandProcessor.js';
import { fuzzySearch } from '../../utils/searchUtils.js';

export function CoolSearch({ onSearch, placeholder = "Search or type ! for commands..." }) {
  const [searchValue, setSearchValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Command execution state
  const [commandFeedback, setCommandFeedback] = useState(null);
  const [commandSuggestions, setCommandSuggestions] = useState([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // Search suggestions state
  const [searchSuggestions, setSearchSuggestions] = useState([]);

  // Audio visualization state
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [waveformData, setWaveformData] = useState(Array(5).fill(0));
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null);
  const animationFrameRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);

  // Voice command processor
  const commandProcessorRef = useRef(null);
  const [workspaceData, setWorkspaceData] = useState(null);

  const [commandExecutor] = useState(() => new CommandExecutor((feedback) => {
    setCommandFeedback(feedback);

    // Auto-clear feedback after 3 seconds (except help)
    if (feedback.type !== 'help') {
      setTimeout(() => setCommandFeedback(null), 3000);
    }
  }));

  const showFeedback = (message, type = 'success') => {
    setCommandFeedback({ message, type });
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setCommandFeedback(null);
      setTranscript('');
    }, 3000);
  };

  // Audio visualization functions
  const startAudioAnalysis = async (retryCount = 0) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      microphoneRef.current = stream;

      if (audioContextRef.current && audioContextRef.current.state === 'running') {
        return; // Reuse existing context
      }

      // Close suspended contexts before creating new ones
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.close();
      }

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      updateAudioData();
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        console.error('Microphone permission denied');
      } else if (retryCount < 2) {
        console.warn('getUserMedia error - retrying', error);
        setTimeout(() => startAudioAnalysis(retryCount + 1), 1000);
      }
    }
  };

  const stopAudioAnalysis = async () => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop microphone stream
    if (microphoneRef.current) {
      microphoneRef.current.getTracks().forEach(track => {
        track.stop();
      });
      microphoneRef.current = null;
    }

    // Close audio context properly
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
        }
      } catch (error) {
        console.warn('Error closing audio context:', error);
      }
      audioContextRef.current = null;
    }

    // Clear analyser
    if (analyserRef.current) {
      analyserRef.current = null;
    }

    // Reset UI state
    setVoiceLevel(0);
    setWaveformData(Array(5).fill(0));
  };

  const updateAudioData = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const normalizedLevel = Math.min(average / 128, 1);
    setVoiceLevel(normalizedLevel);

    // Create waveform data (5 bars)
    const barCount = 5;
    const barSize = Math.floor(dataArray.length / barCount);
    const waveform = [];

    for (let i = 0; i < barCount; i++) {
      const start = i * barSize;
      const end = start + barSize;
      const barData = dataArray.slice(start, end);
      const barAverage = barData.reduce((sum, value) => sum + value, 0) / barData.length;
      waveform.push(Math.min(barAverage / 128, 1));
    }

    setWaveformData(waveform);

    animationFrameRef.current = requestAnimationFrame(updateAudioData);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioAnalysis();
    };
  }, []);

  // Command suggestions based on input
  useEffect(() => {
    if (!searchValue.startsWith('!')) {
      setCommandSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    const query = searchValue.slice(1).toLowerCase();
    const allCommands = CommandParser.getAllCommands();

    // If just "!" is typed, show all commands
    if (query === '') {
      setCommandSuggestions(allCommands.slice(0, 5));
      setSelectedSuggestionIndex(-1);
      return;
    }

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

  // Fetch workspace data for voice commands
  const fetchWorkspaceData = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getWorkspaceData'
      });

      if (response?.success) {
        setWorkspaceData(response.data);
        if (commandProcessorRef.current) {
          commandProcessorRef.current.updateWorkspaceData(response.data);
        }
      }
    } catch (error) {
      console.warn('Failed to fetch workspace data:', error);
    }
  };

  // Initialize voice commands
  const initializeCommands = () => {
    if (!annyang) return null;

    const commands = {
      // Number commands
      'show numbers': () => {
        console.log('[CoolSearch] Show numbers command');
        showElementNumbers();
      },
      'hide numbers': () => {
        console.log('[CoolSearch] Hide numbers command');
        hideElementNumbers();
      },
      'click :num': (num) => {
        console.log('[CoolSearch] Click number command:', num);
        clickByNumber(`click ${num}`);
      },
      'click number :num': (num) => {
        console.log('[CoolSearch] Click number command:', num);
        clickByNumber(`click number ${num}`);
      },
      // Tab switching - MUST come before general search commands
      'switch to tab :num': async (num) => {
        await commandProcessorRef.current.processVoiceCommand(`switch to tab ${num}`);
      },
      'go to tab :num': async (num) => {
        await commandProcessorRef.current.processVoiceCommand(`go to tab ${num}`);
      },
      'find tab *term': async (term) => {
        console.log('[CoolSearch] Finding tab:', term);
        await commandProcessorRef.current.processVoiceCommand(`find tab ${term}`);
      },
      'search tab *term': async (term) => {
        console.log('[CoolSearch] Searching tab:', term);
        await commandProcessorRef.current.processVoiceCommand(`search tab ${term}`);
      },
      // Tab navigation
      'next tab': async () => {
        await commandProcessorRef.current.processVoiceCommand('next tab');
      },
      'previous tab': async () => {
        await commandProcessorRef.current.processVoiceCommand('previous tab');
      },
      'close tab': async () => {
        await commandProcessorRef.current.processVoiceCommand('close tab');
      },
      'new tab': async () => {
        await commandProcessorRef.current.processVoiceCommand('new tab');
      },
      // Search commands - come AFTER tab commands to avoid conflicts
      'search for *term': async (term) => {
        console.log('[CoolSearch] Search for:', term);
        setSearchValue(term);
        onSearch?.(term);
      },
      'google search *term': async (term) => {
        console.log('[CoolSearch] Google search:', term);
        await commandProcessorRef.current.processVoiceCommand(`google search ${term}`);
      },
      'search *term': async (term) => {
        // Only process if it's not a tab search (those are handled above)
        if (!term.toLowerCase().startsWith('tab ')) {
          console.log('[CoolSearch] Search:', term);
          setSearchValue(term);
          onSearch?.(term);
        }
      },
      'open *term': async (term) => {
        console.log('[CoolSearch] Open:', term);
        await commandProcessorRef.current.processVoiceCommand(`open ${term}`);
      },
      'go to *term': async (term) => {
        // This will match "go to Gmail", "go to GitHub", etc.
        console.log('[CoolSearch] Go to:', term);
        await commandProcessorRef.current.processVoiceCommand(`go to ${term}`);
      },
      // Page navigation
      'scroll down': async () => {
        await commandProcessorRef.current.processVoiceCommand('scroll down');
      },
      'scroll up': async () => {
        await commandProcessorRef.current.processVoiceCommand('scroll up');
      },
      'go back': async () => {
        await commandProcessorRef.current.processVoiceCommand('go back');
      },
      'go forward': async () => {
        await commandProcessorRef.current.processVoiceCommand('go forward');
      },
      // Notes and todos
      'add note *note': async (note) => {
        await commandProcessorRef.current.processVoiceCommand(`add note ${note}`);
      },
      'add todo *todo': async (todo) => {
        await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
      }
    };

    return commands;
  };

  // Initialize annyang and command processor
  useEffect(() => {
    // Fetch workspace data on mount
    fetchWorkspaceData();

    // Initialize command processor
    if (!commandProcessorRef.current) {
      commandProcessorRef.current = new VoiceCommandProcessor(showFeedback, workspaceData);
    }

    if (annyang) {
      const commands = initializeCommands();
      if (commands) {
        annyang.addCommands(commands);
      }

      annyang.setLanguage('en-US');

      // Handle results
      annyang.addCallback('result', (phrases) => {
        if (phrases.length > 0) {
          const command = phrases[0];
          console.log('[CoolSearch] Voice command:', command);
          setTranscript(command);

          // If it looks like a search, populate search box
          if (command.toLowerCase().startsWith('search')) {
            const searchTerm = command.replace(/^search\s+(for\s+)?/i, '').trim();
            setSearchValue(searchTerm);
          }
        }
      });

      annyang.addCallback('error', (error) => {
        console.warn('Speech recognition error:', error);
        setIsListening(false);
        stopAudioAnalysis();
      });

      annyang.addCallback('start', () => {
        setIsListening(true);
        startAudioAnalysis();
      });

      annyang.addCallback('end', () => {
        setIsListening(false);
        setVoiceLevel(0);
        setWaveformData(Array(5).fill(0));
      });
    }

    return () => {
      if (annyang) {
        annyang.removeCommands();
        annyang.removeCallback('result');
        annyang.removeCallback('error');
        annyang.removeCallback('start');
        annyang.removeCallback('end');
        annyang.abort();
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      stopAudioAnalysis();
    };
  }, [onSearch]);

  // Handle external voice triggers (from Footer Bar / Background)
  useEffect(() => {
    // 1. Check for pending voice start on mount (from background/footer)
    const checkPendingVoice = async () => {
      try {
        const { pendingVoiceStart } = await chrome.storage.local.get('pendingVoiceStart');
        if (pendingVoiceStart) {
          console.log('[CoolSearch] Found pending voice start, activating...');
          await chrome.storage.local.remove('pendingVoiceStart');
          // Short delay to ensure components are ready
          setTimeout(() => toggleVoice(true), 500);
        }
      } catch (e) {
        console.warn('Error checking pending voice:', e);
      }
    };
    checkPendingVoice();

    // 2. Listen for runtime messages
    const messageListener = (msg, sender, sendResponse) => {
      if (msg.action === 'toggleVoice') {
        console.log('[CoolSearch] Check voice toggle command:', msg);
        if (msg.forceStart) {
          if (!isListening) toggleVoice(true);
        } else {
          toggleVoice();
        }
      } else if (msg.action === 'checkVoiceState') {
        // Broadcast current state to new listeners
        chrome.runtime.sendMessage({
          type: 'voiceStateChange',
          isListening: isListening
        }).catch(() => { });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [isListening]); // Re-bind listener when isListening changes to capture correct state closure? 
  // Actually simpler: stick to a ref or functional update if needed, but isListening dependency is fine here for the check.
  // BUT: if we recreate listener on every state change, we might miss messages? No, it's fast.
  // Better: Use a ref for current listening state in the listener, OR rely on the toggleVoice function handling it correctly.

  const handleChange = (e) => {
    setSearchValue(e.target.value);
    // Clear command feedback when user starts typing again
    if (commandFeedback && commandFeedback.type === 'help') {
      setCommandFeedback(null);
    }
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

  const toggleVoice = async (forceStart = false) => {
    if (!annyang) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }

    // Determine target state
    const shouldListen = forceStart ? true : !isListening;

    if (!shouldListen) {
      annyang.abort();
      setIsListening(false);
      stopAudioAnalysis();
      // Broadcast state
      chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: false }).catch(() => { });
    } else {
      try {
        await startAudioAnalysis();
        annyang.start({ autoRestart: false, continuous: true });
        setIsListening(true);
        // Broadcast state
        chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: true }).catch(() => { });
      } catch (e) {
        console.warn('Speech recognition error:', e);
        setIsListening(false);
        stopAudioAnalysis();
        chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: false }).catch(() => { });
      }
    }
  };

  // Show/hide numbers functionality
  const showElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: addNumbersToElements
      });

      if (results && results[0] && results[0].result) {
        const elementCount = results[0].result.count;
        showFeedback(`Showing numbers on ${elementCount} clickable elements`, 'success');
      }
    } catch (error) {
      showFeedback(`Failed to show numbers: ${error.message}`, 'error');
    }
  };

  const hideElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: removeNumbers
      });
      showFeedback('Numbers hidden', 'success');
    } catch (error) {
      showFeedback(`Failed to hide numbers: ${error.message}`, 'error');
    }
  };

  const clickByNumber = async (command) => {
    try {
      const numberMatch = command.match(/click (\d+)/) || command.match(/click number (\d+)/);
      if (!numberMatch) {
        showFeedback('Please specify a number to click', 'error');
        return;
      }

      const clickNumber = parseInt(numberMatch[1]);
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: clickElementByNumber,
        args: [clickNumber]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          showFeedback(`Clicked element ${clickNumber}: ${result.elementText}`, 'success');
        } else {
          showFeedback(`Element ${clickNumber} not found. Say "show numbers" first.`, 'error');
        }
      }
    } catch (error) {
      showFeedback(`Failed to click by number: ${error.message}`, 'error');
    }
  };

  // Injected page functions
  const addNumbersToElements = () => {
    document.querySelectorAll('.voice-nav-number').forEach(el => el.remove());

    const selectors = [
      'a:not([style*="display: none"])',
      'button:not([disabled])',
      '[role="button"]',
      '[onclick]',
      'input[type="submit"]',
      'input[type="button"]'
    ];

    let elements = [];
    selectors.forEach(selector => {
      try { elements.push(...document.querySelectorAll(selector)); } catch { }
    });

    const visibleElements = elements.filter((el, index, arr) => {
      if (arr.indexOf(el) !== index) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.bottom > 0;
    });

    const limitedElements = visibleElements.slice(0, 20);
    limitedElements.forEach((element, index) => {
      const number = index + 1;
      const numberEl = document.createElement('div');
      numberEl.className = 'voice-nav-number';
      numberEl.textContent = number;
      numberEl.setAttribute('data-element-index', number);

      Object.assign(numberEl.style, {
        position: 'absolute',
        height: '22px',
        minWidth: '22px',
        padding: '0 6px',
        borderRadius: '9999px',
        background: 'rgba(17,24,39,0.75)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: '700',
        border: '1px solid rgba(255,255,255,0.35)',
        boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: '10001',
        pointerEvents: 'none'
      });

      const rect = element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      numberEl.style.top = `${rect.top + scrollTop - 12}px`;
      numberEl.style.left = `${rect.left + scrollLeft - 12}px`;

      document.body.appendChild(numberEl);
      element.setAttribute('data-voice-nav-number', number);
    });

    return { count: limitedElements.length };
  };

  const removeNumbers = () => {
    document.querySelectorAll('.voice-nav-number').forEach(el => el.remove());
    document.querySelectorAll('[data-voice-nav-number]').forEach(el =>
      el.removeAttribute('data-voice-nav-number')
    );
  };

  const clickElementByNumber = (number) => {
    const element = document.querySelector(`[data-voice-nav-number="${number}"]`);
    if (!element) return { success: false };

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => element.click(), 200);

    return {
      success: true,
      elementText: element.textContent?.trim() || element.getAttribute('title') || `Element ${number}`
    };
  };

  return (
    <div className="cooldesk-search-container">
      <form onSubmit={handleSubmit} className="cooldesk-search-box">
        <span className="terminal-prompt" style={{
          fontFamily: "'Fira Code', monospace",
          fontWeight: '700',
          fontSize: '18px',
          color: 'var(--accent-color, #34C759)',
          marginRight: '4px',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center'
        }}>{'>'}</span>
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
          className={`cooldesk-voice-btn ${isListening ? 'listening' : ''}`}
          onClick={toggleVoice}
          title={isListening ? 'Stop listening' : 'Voice search'}
        >
          <FontAwesomeIcon
            icon={faMicrophone}
          />
          {isListening && (
            <div style={{
              display: 'flex',
              gap: 3,
              alignItems: 'center',
              marginLeft: 8,
              position: 'relative',
              zIndex: 1
            }}>
              {waveformData.map((v, i) => (
                <div key={i} style={{
                  width: 2.5,
                  height: `${6 + v * 14}px`,
                  background: 'currentColor',
                  opacity: 0.9,
                  borderRadius: 2,
                  transition: 'height 0.1s ease'
                }} />
              ))}
            </div>
          )}
        </button>
      </form>

      {/* Command Suggestions Dropdown */}
      {commandSuggestions.length > 0 && (
        <div
          className="cool-search-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '8px',
            borderRadius: '12px',
            overflow: 'hidden',
            zIndex: 1000
          }}
        >
          {commandSuggestions.map((cmd, idx) => (
            <div
              key={idx}
              className="cool-search-dropdown-item"
              data-selected={selectedSuggestionIndex === idx}
              style={{
                padding: '12px 16px',
                cursor: 'pointer'
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
                <code className="cool-search-code" style={{ fontSize: '13px' }}>
                  {cmd.command}
                </code>
                <span className="cool-search-badge">
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
          // background: 'rgba(30, 41, 59, 0.98)', // REMOVED: Managed by CSS
          // border: '1px solid rgba(148, 163, 184, 0.2)', // REMOVED: Managed by CSS
          borderRadius: '12px',
          // boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)', // REMOVED: Managed by CSS
          overflow: 'hidden',
          zIndex: 1000,
          // backdropFilter: 'blur(16px)' // REMOVED: Managed by CSS
        }} className="cool-search-dropdown">
          {searchSuggestions.map((suggestion, idx) => (
            <div
              key={idx}
              className="cool-search-dropdown-item"
              data-selected={selectedSuggestionIndex === idx}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                // transition: 'background 0.1s ease', // Handled by CSS
                // background: selectedSuggestionIndex === idx ... // Handled by CSS
                // borderBottom: ... // Handled by CSS
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
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1
                }}>
                  {suggestion.title}
                </div>
                <span
                  className="cool-search-badge"
                  data-type={suggestion.type}
                  style={{
                    flexShrink: 0
                  }}
                >
                  {suggestion.type === 'workspace' ? '💼 Workspace' : suggestion.type === 'bookmark' ? '⭐ Bookmark' : '🕐 History'}
                </span>
              </div>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
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

      {/* Command Feedback - Only show when no suggestions */}
      {commandFeedback && commandSuggestions.length === 0 && searchSuggestions.length === 0 && (
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
          zIndex: 1001,
          maxHeight: '200px',
          overflowY: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '8px'
        }}>
          <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
            {commandFeedback.message}
          </div>
          <button
            onClick={() => setCommandFeedback(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '0 4px',
              opacity: 0.6,
              flexShrink: 0
            }}
            onMouseEnter={(e) => e.target.style.opacity = '1'}
            onMouseLeave={(e) => e.target.style.opacity = '0.6'}
            title="Close"
          >
            ✕
          </button>
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
