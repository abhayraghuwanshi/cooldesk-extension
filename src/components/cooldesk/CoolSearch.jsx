import {
  faBook,
  faBriefcase,
  faComment,
  faHome,
  faLayerGroup,
  faRobot
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import Fuse from 'fuse.js';
import React, { useEffect, useRef, useState } from 'react';
import { CommandExecutor } from '../../services/commandExecutor.js';
import { CommandParser } from '../../services/commandParser.js';
import * as LocalAI from '../../services/localAIService.js';
import { isNaturalLanguageQuery, naturalLanguageSearch } from '../../services/searchService.js';
import { VoiceCommandProcessor } from '../../services/voiceCommandProcessor.js';
import { ExpandedSearchPanel } from './ExpandedSearchPanel.jsx';

// Separate cache outside component to persist across re-mounts if needed, 
// though component state is usually fine. Let's use component state but allow ref fetching.
// Actually, let's keep it simple with refs inside component.

export function CoolSearch({ onSearch, onWorkspaceNavigate, onNavigate, placeholder = "Search or type / for commands...", isDesktopApp = false }) {
  const [searchValue, setSearchValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Command execution state
  const [commandFeedback, setCommandFeedback] = useState(null);
  const [commandSuggestions, setCommandSuggestions] = useState([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // Liquid UI State
  const [commandMode, setCommandMode] = useState('default'); // 'default', 'nav', 'action', 'ai'
  const [activePill, setActivePill] = useState(null); // { label: 'AI', prefix: '/ai' }

  // Search suggestions state
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [autocompleteHint, setAutocompleteHint] = useState(''); // Ghost text for autocomplete
  const [isAISearch, setIsAISearch] = useState(false); // NL search indicator

  // AI Chat Panel state
  const [aiChatMessages, setAiChatMessages] = useState([]); // [{role: 'user'|'assistant', content: string}]
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false); // Loading state for model selection

  // Performance Optimizations
  const workspacesCache = useRef(null);
  const fuseInstance = useRef(null);
  const [isWorkspaceDataLoaded, setIsWorkspaceDataLoaded] = useState(false);

  // Memoized handlers for child component optimization
  const handleHover = React.useCallback((idx) => {
    setSelectedSuggestionIndex(idx);
  }, []);

  const handleClose = React.useCallback(() => {
    setCommandSuggestions([]);
    setSearchSuggestions([]);
    setSelectedSuggestionIndex(-1);
  }, []);




  // Audio visualization state
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [waveformData, setWaveformData] = useState(Array(5).fill(0));
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null);
  const animationFrameRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);
  const inputRef = useRef(null);

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

  // Pre-fetch and cache workspace data locally (DB + Storage)
  const loadWorkspaceData = React.useCallback(async () => {
    try {
      const { listWorkspaces } = await import('../../db/index.js');

      // Parallel fetch: Workspaces (DB) and Dashboard Data (Storage)
      const [workspacesResult, storageResult] = await Promise.all([
        listWorkspaces(),
        chrome.storage.local.get(['dashboardData'])
      ]);

      const workspaces = workspacesResult?.success ? workspacesResult.data : [];
      const dashboardData = storageResult?.dashboardData || {};

      // 1. Process for CoolSearch Cache & Fuse
      if (Array.isArray(workspaces)) {
        workspacesCache.current = workspaces;
        setIsWorkspaceDataLoaded(true);

        // Prepare Fuse index data
        const allUrls = [];
        const seenUrls = new Set();

        workspaces.forEach(ws => {
          const urls = ws?.urls || [];
          urls.forEach(urlItem => {
            const url = typeof urlItem === 'string' ? urlItem : urlItem?.url || '';
            const title = typeof urlItem === 'string' ? '' : urlItem?.title || '';

            if (url && !seenUrls.has(url)) {
              let domainKeywords = '';
              try {
                const hostname = new URL(url).hostname;
                domainKeywords = hostname.replace(/^www\./, '').split('.').join(' ');
              } catch { }

              allUrls.push({
                url: url,
                title: title || url,
                workspaceName: ws.name,
                workspaceId: ws.id,
                favicon: urlItem?.favicon || null,
                searchText: `${title} ${url} ${domainKeywords}`.toLowerCase(),
                source: 'workspace'
              });
              seenUrls.add(url);
            }
          });
        });

        // Initialize Fuse instance
        fuseInstance.current = new Fuse(allUrls, {
          includeScore: true,
          shouldSort: true,
          threshold: 0.3,
          location: 0,
          distance: 100,
          maxPatternLength: 32,
          minMatchCharLength: 1,
          keys: ['title', 'url', 'searchText']
        });
      }

      // 2. Process for Voice Command Processor (Replacing background fetch)
      // Prepare data structure expected by VoiceCommandProcessor
      const voiceAllItems = [
        ...(dashboardData.history || []),
        ...(dashboardData.bookmarks || [])
      ];

      const voiceSavedItems = workspaces.flatMap(ws =>
        (ws.urls || []).map(u => ({
          ...u,
          workspaceGroup: ws.name,
          id: `${ws.id}-${u.url}`
        }))
      );

      const consolidatedData = {
        allItems: voiceAllItems,
        savedItems: voiceSavedItems
      };

      setWorkspaceData(consolidatedData);

      // Update processor if it exists
      if (commandProcessorRef.current) {
        commandProcessorRef.current.updateWorkspaceData(consolidatedData);
      }

    } catch (error) {
      console.warn('[CoolSearch] Failed to cache workspaces:', error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadWorkspaceData();

    // Refresh on focus to keep data fresh
    const onFocus = () => loadWorkspaceData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadWorkspaceData]);

  // Search suggestions with debounce and caching



  // Re-implementing the main search effect efficiently
  useEffect(() => {
    // 1. Handle Active Pill (Synchronous / Local)
    if (activePill) {
      const query = searchValue.toLowerCase();

      // Multi-Stage Destination Picker
      if (activePill.stage === 'DESTINATION') {
        const processDestinations = (workspaces) => {
          const cards = workspaces.map(ws => ({
            command: `${activePill.prefix} ${ws.name}`,
            title: ws.name,
            description: `Move current tab to "${ws.name}"`,
            icon: '📁',
            category: 'Select Destination'
          })).filter(c => c.title.toLowerCase().includes(query));
          setCommandSuggestions(cards);
        };

        if (workspacesCache.current) {
          processDestinations(workspacesCache.current);
        } else {
          // Fallback to fetch
          import('../../db/index.js').then(({ listWorkspaces }) => listWorkspaces()).then(res => {
            const ws = res?.success ? res.data : (Array.isArray(res) ? res : []);
            processDestinations(ws);
          });
        }
        setSearchSuggestions([]);
        setSelectedSuggestionIndex(-1);
        return;
      }

      // Model Selection Stage
      if (activePill.stage === 'MODEL_SELECT') {
        const fetchModels = async () => {
          try {
            // Check if sidecar is available
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
              setCommandSuggestions([{
                command: '/model',
                title: 'Desktop App Not Running',
                description: 'Please start the CoolDesk desktop app to use AI',
                icon: faRobot,
                category: 'Error',
                disabled: true
              }]);
              return;
            }

            // Get status to see which model is loaded
            const status = await LocalAI.getStatus();
            const currentModel = status.currentModel || null;

            // Get available models
            const modelsResult = await LocalAI.getModels();
            const modelFilenames = Object.keys(modelsResult || {}).filter(
              name => modelsResult[name]?.downloaded
            );

            if (modelFilenames.length === 0) {
              setCommandSuggestions([{
                command: '/model',
                title: 'No Models Downloaded',
                description: 'Go to Settings → Local AI to download models',
                icon: faRobot,
                category: 'Info',
                disabled: true
              }]);
              return;
            }

            // Build model cards
            const modelCards = modelFilenames
              .filter(name => name.toLowerCase().includes(query))
              .map(name => {
                const modelInfo = modelsResult[name];
                const isLoaded = currentModel === name;
                return {
                  command: `/model ${name}`,
                  title: modelInfo?.displayName || name,
                  description: isLoaded ? '✓ Currently loaded' : `Click to load • ${modelInfo?.size || ''}`,
                  icon: faRobot,
                  category: 'Select Model',
                  modelName: name,
                  isLoaded
                };
              })
              .sort((a, b) => {
                // Put loaded model first
                if (a.isLoaded && !b.isLoaded) return -1;
                if (!a.isLoaded && b.isLoaded) return 1;
                return 0;
              });

            setCommandSuggestions(modelCards);
          } catch (error) {
            console.error('[CoolSearch] Failed to fetch models:', error);
            setCommandSuggestions([{
              command: '/model',
              title: 'Error Loading Models',
              description: error.message || 'Failed to connect to AI service',
              icon: faRobot,
              category: 'Error',
              disabled: true
            }]);
          }
        };

        fetchModels();
        setSearchSuggestions([]);
        setSelectedSuggestionIndex(-1);
        return;
      }

      // Only AI pill is supported now - no suggestions needed for AI mode
      // User just types their prompt directly
      setCommandSuggestions([]);
      setSearchSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    // 2. Handle Slash Commands Only
    if (searchValue.startsWith('/')) {
      const query = searchValue.slice(1).toLowerCase();

      const fetchFlattenedSuggestions = async () => {
        // Build command list based on environment
        // In extension mode: Only AI commands (search, /ai, /model)
        // In desktop app: Full navigation + AI commands
        const commands = [
          // AI Commands - Always available
          { command: '/ai', title: 'Ask AI', description: 'Chat with local LLM', icon: faRobot, category: 'AI' },
          { command: '/model', title: 'Select Model', description: 'Choose AI model to use', icon: faRobot, category: 'AI' },

          // Navigation - Desktop App Only
          ...(isDesktopApp ? [
            { command: '/notes', title: 'Notes', description: 'Go to Notes', icon: faBook, category: 'Nav' },
            { command: '/chat', title: 'Chat', description: 'Go to AI Chat', icon: faComment, category: 'Nav' },
            { command: '/tabs', title: 'Tabs', description: 'Manage Tabs', icon: faLayerGroup, category: 'Nav' },
            { command: '/workspaces', title: 'Workspaces', description: 'Manage Workspaces', icon: faBriefcase, category: 'Nav' },
            { command: '/overview', title: 'Dashboard', description: 'Go to Dashboard', icon: faHome, category: 'Nav' },
          ] : []),
        ];

        if (query === '') {
          setCommandSuggestions(commands);
        } else {
          const matches = commands.filter(opt => {
            const searchStr = `${opt.title} ${opt.command} ${opt.category} ${opt.description}`.toLowerCase();
            return searchStr.includes(query) ||
              query.split('').every((char, i) => searchStr.indexOf(char, i) !== -1);
          });

          // Sort: 1. Exact/Start Match, 2. Category Order
          matches.sort((a, b) => {
            const aCmd = a.command.toLowerCase();
            const bCmd = b.command.toLowerCase();

            // Exact match priority
            if (aCmd === '/' + query) return -1;
            if (bCmd === '/' + query) return 1;
            // Starts with priority
            if (aCmd.startsWith('/' + query) && !bCmd.startsWith('/' + query)) return -1;
            if (!aCmd.startsWith('/' + query) && bCmd.startsWith('/' + query)) return 1;

            // Category Order
            const catOrder = { 'NAV': 1, 'ACTION': 2, 'AI': 3 };
            const aCat = catOrder[a.category?.toUpperCase()] || 99;
            const bCat = catOrder[b.category?.toUpperCase()] || 99;
            if (aCat !== bCat) return aCat - bCat;

            return 0;
          });
          setCommandSuggestions(matches);

          // Ghost text logic
          if (matches.length > 0 && query.length > 0) {
            const firstMatch = matches[0].command;
            if (firstMatch.toLowerCase().startsWith(searchValue.toLowerCase())) {
              setAutocompleteHint(firstMatch);
            } else {
              setAutocompleteHint('');
            }
          } else {
            setAutocompleteHint('');
          }
        }
      };

      fetchFlattenedSuggestions();
      setSearchSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    // Clear autocomplete hint for non-slash commands
    setAutocompleteHint('');

    // If input is effectively empty or just command triggers, clear everything
    if (!searchValue || searchValue.trim() === '' || (searchValue.startsWith('!') && searchValue.length < 2) || (searchValue.startsWith('/') && searchValue.length < 2) || /^https?:\/\//i.test(searchValue)) {
      setSearchSuggestions([]);
      setCommandSuggestions([]);
      return;
    }

    const query = searchValue.toLowerCase();

    const fetchSuggestions = async () => {
      try {
        const allSuggestions = [];
        const seenUrls = new Set();

        // Check if this looks like a natural language query
        const useNLSearch = isNaturalLanguageQuery(searchValue);
        setIsAISearch(useNLSearch);

        // If NL query, try AI-powered search first
        if (useNLSearch) {
          try {
            const nlResults = await naturalLanguageSearch(searchValue, 10);
            if (nlResults && nlResults.length > 0) {
              nlResults.forEach((item, index) => {
                if (!seenUrls.has(item.url)) {
                  allSuggestions.push({
                    title: item.title,
                    description: item.description || (item._aiRanked ? 'AI matched' : ''),
                    url: item.url,
                    type: item.type || 'search',
                    score: 2000 - index, // High priority for AI results
                    matchQuality: 100,
                    _aiRanked: item._aiRanked
                  });
                  seenUrls.add(item.url);
                }
              });
            }
          } catch (e) {
            console.warn('[CoolSearch] NL search failed, falling back:', e);
            setIsAISearch(false);
          }
        }

        // 1. Search workspace URLs (Using Cache + Fuse Instance)
        if (fuseInstance.current) {
          const results = fuseInstance.current.search(query);
          const combinedUrlMatches = results.map(r => r.item);

          // Convert to suggestions with scoring
          combinedUrlMatches.forEach((item, index) => {
            if (!seenUrls.has(item.url)) {
              allSuggestions.push({
                title: item.title,
                description: `${item.workspaceName} workspace`,
                url: item.url,
                workspace: item.workspaceName,
                favicon: item.favicon,
                type: 'workspace-url',
                score: 1000 - index,
                matchQuality: item.searchText && item.searchText.indexOf(query) === 0 ? 100 : 50
              });
              seenUrls.add(item.url);
            }
          });
        }

        // 2. Search history (Optimized: Max 20 results)
        try {
          if (chrome?.history?.search) {
            const historyResults = await chrome.history.search({
              text: query,
              maxResults: 20, // Reduced from 50
              startTime: 0
            });
            if (historyResults && historyResults.length > 0) {
              historyResults.forEach((item, index) => {
                if (!seenUrls.has(item.url)) {
                  const visitScore = Math.min(item.visitCount || 0, 100);
                  const recencyScore = item.lastVisitTime ?
                    Math.max(0, 100 - (Date.now() - item.lastVisitTime) / (1000 * 60 * 60 * 24)) : 0;

                  allSuggestions.push({
                    title: item.title || item.url,
                    url: item.url,
                    type: 'history',
                    visitCount: item.visitCount,
                    score: 500 + visitScore + recencyScore - index,
                    matchQuality: (item.title || '').toLowerCase().indexOf(query) === 0 ? 50 : 25
                  });
                  seenUrls.add(item.url);
                }
              });
            }
          }
        } catch (error) { console.warn('History search failed', error); }

        // 3. Search bookmarks (medium priority)
        try {
          if (chrome?.bookmarks?.search) {
            const bookmarkResults = await chrome.bookmarks.search(query);
            if (bookmarkResults && bookmarkResults.length > 0) {
              bookmarkResults
                .filter(item => item.url && !seenUrls.has(item.url))
                .forEach((item, index) => {
                  allSuggestions.push({
                    title: item.title || item.url,
                    url: item.url,
                    type: 'bookmark',
                    score: 750 - index,
                    matchQuality: (item.title || '').toLowerCase().indexOf(query) === 0 ? 75 : 35
                  });
                  seenUrls.add(item.url);
                });
            }
          }
        } catch (error) { console.warn('Bookmark search failed', error); }

        // 4. Smart ranking
        allSuggestions.sort((a, b) => {
          const scoreA = a.score + a.matchQuality;
          const scoreB = b.score + b.matchQuality;
          return scoreB - scoreA;
        });

        const finalSuggestions = allSuggestions.slice(0, 8);
        setSearchSuggestions(finalSuggestions);
      } catch (error) {
        console.warn('[CoolSearch] Failed to fetch suggestions:', error);
        setSearchSuggestions([]);
      }
    };

    // Stable debounce update
    const timeoutId = setTimeout(() => {
      React.startTransition(() => {
        fetchSuggestions();
      });
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [searchValue, activePill, setCommandSuggestions, setSearchSuggestions, aiChatMessages, isAiLoading, isDesktopApp]);

  useEffect(() => {
    // Global shortcuts
    const handleGlobalKeys = (e) => {
      // Focus on '/' if not in an input
      if (e.key === '/' &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA' &&
        !document.activeElement.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Blur on 'Escape'
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeys);
    };
  }, []);

  // Sync commandMode with input
  useEffect(() => {
    if (activePill) {
      if (['/add', '/share', 'ADD', 'SHARE'].includes(activePill.prefix || activePill.label)) {
        setCommandMode('action');
      } else {
        setCommandMode('nav');
      }
      return;
    }

    const val = searchValue.trim().toLowerCase();
    if (val.startsWith('!')) {
      setCommandMode('ai');
    } else if (val.startsWith('/')) {
      const mode = (val.startsWith('/add') || val.startsWith('/share')) ? 'action' : 'nav';
      setCommandMode(mode);
    } else {
      setCommandMode('default');
    }
  }, [searchValue, activePill]);




  // Initialize voice commands
  const initializeCommands = () => {
    if (!annyang) return null;

    try {
      const recognition = annyang.getSpeechRecognizer();
      if (recognition) {
        // Attempt to set local processing
        if ('processLocally' in recognition) {
          recognition.processLocally = true;
        }

        // Add direct error listener for fallback because annyang might swallow or abstract it
        // We need to capture the specific instance error to unset the flag
        const originalOnError = recognition.onerror;
        recognition.onerror = function (event) {
          if (event.error === 'language-not-supported' && recognition.processLocally) {
            console.warn('[CoolSearch] Local language pack missing, disabling processLocally and retrying...');
            recognition.processLocally = false;
            // We might need to restart annyang for this to take effect if it stopped
            try { annyang.abort(); setTimeout(() => annyang.start(), 100); } catch (e) { }
            // Do NOT propagate to originalOnError to avoid noise
            return;
          }
          if (originalOnError) originalOnError.apply(this, arguments);
        };
      }
    } catch (e) {
      console.warn('Failed to set processLocally on annyang recognizer', e);
    }

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
      // Navigation commands
      'go to overview': () => {
        console.log('[CoolSearch] Voice: Go to overview');
        if (onNavigate) onNavigate('overview');
      },
      'go to workspace': () => {
        console.log('[CoolSearch] Voice: Go to workspace');
        if (onNavigate) onNavigate('workspace');
      },
      'go to collections': () => {
        console.log('[CoolSearch] Voice: Go to workspace');
        if (onNavigate) onNavigate('workspace');
      },
      'go to chat': () => {
        console.log('[CoolSearch] Voice: Go to chat');
        if (onNavigate) onNavigate('chat');
      },
      'go to tabs': () => {
        console.log('[CoolSearch] Voice: Go to tabs');
        if (onNavigate) onNavigate('tabs');
      },
      'go to team': () => {
        console.log('[CoolSearch] Voice: Go to team');
        if (onNavigate) onNavigate('team');
      },
      'go to notes': () => {
        console.log('[CoolSearch] Voice: Go to notes');
        if (onNavigate) onNavigate('notes');
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
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const { pendingVoiceStart } = await chrome.storage.local.get('pendingVoiceStart');
          if (pendingVoiceStart) {
            console.log('[CoolSearch] Found pending voice start, activating...');
            await chrome.storage.local.remove('pendingVoiceStart');
            // Short delay to ensure components are ready
            setTimeout(() => toggleVoice(true), 500);
          }
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

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }
    return () => { };
  }, [isListening]); // Re-bind listener when isListening changes to capture correct state closure? 
  // Actually simpler: stick to a ref or functional update if needed, but isListening dependency is fine here for the check.
  // BUT: if we recreate listener on every state change, we might miss messages? No, it's fast.
  // Better: Use a ref for current listening state in the listener, OR rely on the toggleVoice function handling it correctly.

  const handleChange = (e) => {
    const value = e.target.value;

    // Detect space after command for Pill creation (only /ai supported)
    if (value.endsWith(' ')) {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === '/ai') {
        setActivePill({ label: 'AI', prefix: '/ai' });
        setSearchValue('');
        setAutocompleteHint('');
        setCommandSuggestions([]);
        return;
      }
    }

    setSearchValue(value);

    // Clear autocomplete if empty
    if (!value) {
      setAutocompleteHint('');
      setCommandSuggestions([]); // Explicitly clear
      setSearchSuggestions([]); // Explicitly clear
    }

    // Clear command feedback when user starts typing again
    if (commandFeedback && commandFeedback.type === 'help') {
      setCommandFeedback(null);
    }
  };

  const handleKeyDown = (e) => {
    // Backspace to remove pill
    if (e.key === 'Backspace' && activePill && searchValue === '') {
      e.preventDefault();
      setSearchValue(activePill.prefix + ' ');
      setActivePill(null);
      return;
    }

    // Sort active suggestions consistently to match visual layout
    const rawSuggestions = commandSuggestions.length > 0 ? commandSuggestions : searchSuggestions;

    // Helper to get category string
    const getCat = (s) => {
      if (s.category) return s.category.toUpperCase();
      if (s.type === 'workspace-url') return 'WORKSPACES';
      if (s.type === 'history') return 'HISTORY';
      if (s.type === 'bookmark') return 'BOOKMARKS';
      return 'SUGGESTIONS';
    };

    const activeSuggestions = [...rawSuggestions].sort((a, b) => {
      const catA = getCat(a);
      const catB = getCat(b);
      if (catA === catB) return 0;
      return catA.localeCompare(catB);
    });

    const isCommandMode = commandSuggestions.length > 0;

    // Tab key: Autocomplete or Pill conversion
    if (e.key === 'Tab') {
      if (activeSuggestions.length > 0) {
        e.preventDefault();
        const first = activeSuggestions[0];

        // Only /ai converts to pill
        if (first.command === '/ai' && !activePill) {
          setActivePill({ label: 'AI', prefix: '/ai' });
          setSearchValue('');
          setAutocompleteHint('');
          return;
        }

        if (isCommandMode && first.command) {
          setSearchValue(first.command);
          setSelectedSuggestionIndex(0);
        } else if (!isCommandMode && first.title) {
          setSelectedSuggestionIndex(0);
        }
        return;
      }
    }

    // Enter key
    if (e.key === 'Enter') {
      // 1. If we have a selected suggestion, handle it
      if (selectedSuggestionIndex >= 0 && activeSuggestions[selectedSuggestionIndex]) {
        e.preventDefault();
        onSelectSuggestion(activeSuggestions[selectedSuggestionIndex]);
        return;
      }

      // 2. If it's /ai with no args, convert to Pill
      const trimmed = searchValue.trim().toLowerCase();
      if (trimmed === '/ai' && !activePill) {
        e.preventDefault();
        setActivePill({ label: 'AI', prefix: '/ai' });
        setSearchValue('');
        setAutocompleteHint('');
        return;
      }

      // 3. Regular command execution
      if (searchValue.startsWith('/') || activePill) {
        e.preventDefault();

        // Don't execute if AI pill is active but no prompt entered
        if (activePill?.prefix === '/ai' && !searchValue.trim()) {
          return; // Just stay in the pill, waiting for input
        }

        handleSubmit(e);
        return;
      }

      // 4. If there are search suggestions with URLs, open the first one
      if (activeSuggestions.length > 0 && !isCommandMode) {
        const firstWithUrl = activeSuggestions.find(s => s.url);
        if (firstWithUrl) {
          e.preventDefault();
          onSelectSuggestion(firstWithUrl);
          return;
        }
      }
    }

    // Navigation through suggestions
    // Navigation through suggestions
    // Navigation through suggestions
    // Navigation through suggestions
    if (activeSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => {
          // Linear Down Navigation
          if (prev < 0 || prev >= activeSuggestions.length - 1) return 0;
          return prev + 1;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => {
          // Linear Up Navigation
          if (prev <= 0) return activeSuggestions.length - 1;
          return prev - 1;
        });
      } else if (e.key === 'ArrowRight') {
        // Optional: Can mimic Down or just move cursor. Let's make it mimic Down for grid flow?
        // Or just let it handle text. User preferred simple up/down.
        // Let's stick to Up/Down for navigation as requested.
      } else if (e.key === 'ArrowLeft') {
        // Same here.
      } else if (e.key === 'Escape') {
        setCommandSuggestions([]);
        setSearchSuggestions([]);
        setSelectedSuggestionIndex(-1);
      }
    }
  };

  const handleSubmit = React.useCallback(async (e, overrideQuery = null) => {
    if (e && e.preventDefault) e.preventDefault();

    let query = overrideQuery || searchValue.trim();
    if (!query && !activePill) return;

    if (activePill && !overrideQuery) {
      query = `${activePill.prefix} ${query}`.trim();
    }

    // Check if it's a command
    if (CommandParser.isCommand(query) || query.startsWith('/')) {
      try {
        // Special handling for slash commands that are just navigation
        // Only available in desktop app mode
        if (isDesktopApp) {
          const navigationMap = {
            '/notes': 'notes',
            '/workspace': 'workspace',
            '/chat': 'chat',
            '/tabs': 'tabs',
            '/team': 'team',
            '/overview': 'overview'
          };

          const ALIAS_MAP = {
            '/o': 'overview',
            '/n': 'notes',
            '/w': 'workspace',
            '/c': 'chat',
            '/t': 'tabs',
            '/tm': 'team'
          };

          const target = navigationMap[query] || ALIAS_MAP[query];

          if (target && onNavigate) {
            onNavigate(target);
            handleClose();
            setSearchValue('');
            setActivePill(null);
            return;
          }
        }

        // Handle Model Selection Command (/model or /model <modelname>)
        if (query.startsWith('/model')) {
          const modelName = query.slice(6).trim();

          if (!modelName) {
            // No model specified, enter model selection mode
            setActivePill({ label: 'Model', prefix: '/model', stage: 'MODEL_SELECT' });
            setSearchValue('');
            setAutocompleteHint('');
            setCommandSuggestions([]);
            return;
          }

          // Model name specified, load it
          try {
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
              setCommandFeedback({
                type: 'error',
                message: 'Desktop app not running. Please start CoolDesk desktop app.'
              });
              return;
            }

            setIsModelLoading(true);
            // Show loading state in suggestions panel
            setCommandSuggestions([{
              command: '/model',
              title: `Loading ${modelName}...`,
              description: 'Please wait while the model loads into memory',
              icon: faRobot,
              category: 'Loading',
              disabled: true,
              isLoading: true
            }]);

            await LocalAI.loadModel(modelName);

            setIsModelLoading(false);
            setCommandFeedback({
              type: 'success',
              message: `✓ Model loaded: ${modelName}`
            });

            handleClose();
            setSearchValue('');
            setActivePill(null);
          } catch (error) {
            console.error('[CoolSearch] Model load error:', error);
            setIsModelLoading(false);
            setCommandFeedback({
              type: 'error',
              message: error.message || 'Failed to load model'
            });
          }
          return;
        }

        // Handle AI Command (/ai <prompt>)
        if (query.startsWith('/ai')) {
          const prompt = query.slice(3).trim();

          if (!prompt) {
            setCommandFeedback({
              type: 'info',
              message: 'Usage: /ai <your prompt here>\nExample: /ai What is 2+2?'
            });
            return;
          }

          try {
            // Add user message to chat
            setAiChatMessages(prev => [...prev, { role: 'user', content: prompt }]);
            setIsAiLoading(true);
            setSearchValue(''); // Clear input immediately after sending

            // Clear suggestions to show chat panel
            setCommandSuggestions([]);
            setSearchSuggestions([]);

            // Check if Local AI is available (connects to sidecar WebSocket)
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
              setIsAiLoading(false);
              setAiChatMessages(prev => [
                ...prev,
                { role: 'error', content: 'Local AI not available. Ensure the CoolDesk desktop app is running.' }
              ]);
              return;
            }

            // Check if model is loaded, if not, load it automatically
            const status = await LocalAI.getStatus();
            console.log('[AI Chat] Status:', status);

            if (!status.modelLoaded) {
              // Show loading message
              setAiChatMessages(prev => [
                ...prev,
                { role: 'system', content: '🔄 Model not loaded. Loading model...' }
              ]);

              // Get available models
              const modelsResult = await LocalAI.getModels();
              console.log('[AI Chat] Models result:', modelsResult);

              // Models is an object: {filename: {status, displayName, ...}}
              // Get just the filenames (keys) of downloaded models
              const modelFilenames = Object.keys(modelsResult || {}).filter(
                name => modelsResult[name]?.downloaded
              );

              console.log('[AI Chat] Downloaded model filenames:', modelFilenames);

              // Find best available model: Phi-3 > Llama 3.2 > any other
              const modelToLoad = modelFilenames.find(name => name.toLowerCase().includes('phi-3'))
                || modelFilenames.find(name => name.toLowerCase().includes('llama-3.2'))
                || modelFilenames.find(name => name.toLowerCase().includes('llama'))
                || modelFilenames[0];

              console.log('[AI Chat] Model to load:', modelToLoad);

              if (!modelToLoad) {
                setIsAiLoading(false);
                setAiChatMessages(prev => [
                  ...prev,
                  { role: 'error', content: 'No AI models available. Please download a model from Settings → Local AI.' }
                ]);
                return;
              }

              // Load the model
              try {
                await LocalAI.loadModel(modelToLoad);
                // Update message to show model loaded
                setAiChatMessages(prev => {
                  const newMessages = [...prev];
                  const lastIdx = newMessages.length - 1;
                  if (newMessages[lastIdx]?.role === 'system') {
                    newMessages[lastIdx] = { role: 'system', content: `✅ ${modelToLoad} loaded successfully!` };
                  }
                  return newMessages;
                });
              } catch (loadError) {
                setIsAiLoading(false);
                setAiChatMessages(prev => [
                  ...prev,
                  { role: 'error', content: `Failed to load model: ${loadError.message}` }
                ]);
                return;
              }
            }

            // Chat with the model using LocalAI service
            console.log('[AI Chat] Sending prompt:', prompt);
            const responseText = await LocalAI.chat(prompt);
            console.log('[AI Chat] Response:', responseText);

            // Add AI response to chat
            setAiChatMessages(prev => [...prev, { role: 'assistant', content: responseText || 'No response received' }]);
            setIsAiLoading(false);

            // Clear input but keep pill active for follow-up questions
            setSearchValue('');

          } catch (error) {
            console.error('[AI Chat] Error:', error);
            setIsAiLoading(false);
            setAiChatMessages(prev => [
              ...prev,
              { role: 'error', content: error.message || 'Failed to get response. Is the desktop app running?' }
            ]);
          }
          return;
        }

        const parsed = CommandParser.parse(query.startsWith('/') ? `!${query.slice(1)}` : query);
        console.log('[CoolSearch] Executing command:', parsed);

        const result = await commandExecutor.execute(parsed);
        console.log('[CoolSearch] Command result:', result);

        // If workspace switch, trigger workspace change
        if (result.workspace) {
          window.dispatchEvent(new CustomEvent('workspaceChanged', {
            detail: { workspace: result.workspace }
          }));
        }

        handleClose();
        setSearchValue('');
        setActivePill(null);
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
        handleClose();
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

    handleClose();
    setSearchValue('');
  }, [searchValue, activePill, onNavigate, commandExecutor, handleClose, isDesktopApp]);

  const onSelectSuggestion = React.useCallback(async (item) => {
    if (!item) return;

    // 1. Handle Command Mode (Slash or Bang)
    if (item.command || item.category === 'Command' || (item.command && (item.command.startsWith('/') || item.command.startsWith('!')))) {
      const cmd = item.command;

      // Navigation Priority: Check for core navigation matches first (Desktop App Only)
      if (isDesktopApp) {
        const navigationMap = {
          '/notes': 'notes',
          '/workspace': 'workspace',
          '/chat': 'chat',
          '/tabs': 'tabs',
          '/team': 'team',
          '/overview': 'overview'
        };

        if (navigationMap[cmd] && onNavigate) {
          onNavigate(navigationMap[cmd]);
          handleClose();
          setSearchValue('');
          setActivePill(null);
          return;
        }
      }

      // Only /ai converts to pill mode
      if (cmd === '/ai') {
        setActivePill({ label: 'AI', prefix: '/ai' });
        setSearchValue('');
        setAutocompleteHint('');
        setCommandSuggestions([]);
        setSelectedSuggestionIndex(-1);
        return;
      }

      // /model triggers model selection mode
      if (cmd === '/model') {
        setActivePill({ label: 'Model', prefix: '/model', stage: 'MODEL_SELECT' });
        setSearchValue('');
        setAutocompleteHint('');
        setCommandSuggestions([]);
        setSelectedSuggestionIndex(-1);
        return;
      }

      // Handle model selection from the model picker
      if (item.modelName && item.category === 'Select Model') {
        // Skip if disabled, already loaded, or currently loading
        if (item.disabled || isModelLoading) {
          return;
        }

        if (item.isLoaded) {
          setCommandFeedback({
            type: 'info',
            message: `${item.title} is already loaded`
          });
          handleClose();
          setActivePill(null);
          return;
        }

        // Load the selected model
        try {
          setIsModelLoading(true);
          // Update suggestions to show loading state
          setCommandSuggestions([{
            command: '/model',
            title: `Loading ${item.title}...`,
            description: 'Please wait while the model loads into memory',
            icon: faRobot,
            category: 'Loading',
            disabled: true,
            isLoading: true
          }]);

          await LocalAI.loadModel(item.modelName);

          setIsModelLoading(false);
          setCommandFeedback({
            type: 'success',
            message: `✓ ${item.title} loaded successfully!`
          });

          handleClose();
          setSearchValue('');
          setActivePill(null);
        } catch (error) {
          console.error('[CoolSearch] Model load error:', error);
          setIsModelLoading(false);
          setCommandFeedback({
            type: 'error',
            message: error.message || 'Failed to load model'
          });
          // Re-fetch models to show the list again
          setActivePill({ label: 'Model', prefix: '/model', stage: 'MODEL_SELECT' });
        }
        return;
      }

      // Final fallback: Execute
      handleSubmit({ preventDefault: () => { } }, cmd);
    }
    // 2. Handle Search/URL Mode
    else {
      if (item.type === 'workspace') {
        if (onWorkspaceNavigate) onWorkspaceNavigate(item.workspace);
        else handleWorkspaceOpen(item.workspace);
      } else if (item.type === 'tab' && item.tabId) {
        // Switch to existing tab instead of creating new one
        if (chrome?.tabs?.update) {
          chrome.tabs.update(item.tabId, { active: true });
          chrome.tabs.get(item.tabId, (tab) => {
            if (tab?.windowId) chrome.windows.update(tab.windowId, { focused: true });
          });
        }
      } else if (item.type === 'workspace-url' || item.url) {
        if (chrome?.tabs?.create) chrome.tabs.create({ url: item.url });
        else window.open(item.url, '_blank');
      }
      handleClose();
      setSearchValue('');
    }
  }, [onNavigate, onWorkspaceNavigate, handleSubmit, handleClose, isDesktopApp]); // handleSubmit also needs to be stable or dependent.
  // This is getting deep. handleSubmit relies on state too.


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


  const handleSelect = React.useCallback(async (item, idx) => {
    onSelectSuggestion(item);
  }, [onSelectSuggestion]);

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
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: false }).catch(() => { });
      }
    } else {
      try {
        await startAudioAnalysis();
        annyang.start({ autoRestart: false, continuous: true });
        setIsListening(true);
        // Broadcast state
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: true }).catch(() => { });
        }
      } catch (e) {
        console.warn('Speech recognition error:', e);
        setIsListening(false);
        stopAudioAnalysis();
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: false }).catch(() => { });
        }
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

  // Ensure suggestions are sorted by category to match visual grid layout
  const sortedSuggestions = React.useMemo(() => {
    const raw = commandSuggestions.length > 0 ? commandSuggestions : searchSuggestions;

    // Helper to get category string
    const getCat = (s) => {
      if (s.category) return s.category.toUpperCase();
      if (s.type === 'workspace-url') return 'WORKSPACES';
      if (s.type === 'history') return 'HISTORY';
      if (s.type === 'bookmark') return 'BOOKMARKS';
      return 'SUGGESTIONS';
    };

    // Stable sort
    return [...raw].sort((a, b) => {
      const catA = getCat(a);
      const catB = getCat(b);
      if (catA === catB) return 0;
      // Optional: Define explicit category order if needed
      return catA.localeCompare(catB);
    });
  }, [commandSuggestions, searchSuggestions]);

  const isResultsOpen = sortedSuggestions.length > 0;

  return (
    <div className={`cooldesk-search-container mode-${commandMode}`} style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      position: 'relative',
      zIndex: 10002 // Ensure container is above other elements
    }}>
      {/* AI Chat - Futuristic Holographic Design */}
      {activePill?.prefix === '/ai' && aiChatMessages.length > 0 && (
        <div className="ai-chat-panel" style={{
          marginBottom: '12px',
          maxHeight: '500px',
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: 'linear-gradient(165deg, rgba(10, 10, 20, 0.97) 0%, rgba(15, 10, 30, 0.98) 50%, rgba(5, 15, 25, 0.99) 100%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: '1px solid transparent',
          borderRadius: '24px',
          boxShadow: `
            0 0 0 1px rgba(139, 92, 246, 0.15),
            0 0 60px -20px rgba(139, 92, 246, 0.4),
            0 30px 60px -30px rgba(0, 0, 0, 0.7),
            inset 0 1px 0 rgba(255, 255, 255, 0.05)
          `,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}>
          {/* Animated gradient border */}
          <div style={{
            position: 'absolute',
            inset: '-1px',
            borderRadius: '24px',
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.5), rgba(59, 130, 246, 0.3), rgba(236, 72, 153, 0.3), rgba(139, 92, 246, 0.5))',
            backgroundSize: '300% 300%',
            animation: 'gradientShift 8s ease infinite',
            zIndex: -1,
            opacity: 0.6,
            filter: 'blur(1px)'
          }} />

          {/* Inner glow effect */}
          <div style={{
            position: 'absolute',
            top: '0',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '80%',
            height: '120px',
            background: 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
            zIndex: 0
          }} />

          {/* Chat Header - Minimalist Floating */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)',
            position: 'relative',
            zIndex: 1
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Animated AI Icon */}
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden'
              }}>
                {/* Rotating ring */}
                <div style={{
                  position: 'absolute',
                  inset: '2px',
                  borderRadius: '12px',
                  border: '2px solid transparent',
                  borderTopColor: isAiLoading ? '#8B5CF6' : 'transparent',
                  borderRightColor: isAiLoading ? '#3B82F6' : 'transparent',
                  animation: isAiLoading ? 'spin 1s linear infinite' : 'none'
                }} />
                <FontAwesomeIcon
                  icon={faRobot}
                  style={{
                    color: '#A78BFA',
                    fontSize: '18px',
                    filter: 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.5))'
                  }}
                />
              </div>
              <div>
                <div style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #E0E7FF 0%, #C4B5FD 50%, #A78BFA 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  letterSpacing: '-0.02em'
                }}>
                  Neural Assistant
                </div>
                <div style={{
                  fontSize: '11px',
                  color: isAiLoading ? '#34D399' : 'rgba(148, 163, 184, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '2px'
                }}>
                  {isAiLoading ? (
                    <>
                      <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#34D399',
                        boxShadow: '0 0 8px #34D399',
                        animation: 'pulse 1.5s ease-in-out infinite'
                      }} />
                      <span style={{ fontWeight: 500 }}>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#8B5CF6',
                        boxShadow: '0 0 6px rgba(139, 92, 246, 0.5)'
                      }} />
                      <span>Local LLM • Ready</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setAiChatMessages([]);
                setActivePill(null);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '8px 14px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                letterSpacing: '0.02em'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                e.currentTarget.style.color = '#F87171';
                e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Clear
            </button>
          </div>

          {/* Messages Container */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '24px',
            gap: '24px',
            position: 'relative',
            zIndex: 1
          }}>
            {aiChatMessages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  gap: '16px',
                  animation: 'messageSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  animationFillMode: 'both',
                  animationDelay: `${idx * 0.08}s`
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: msg.role === 'user' ? '12px' : '16px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #818CF8 0%, #6366F1 100%)'
                    : msg.role === 'assistant'
                      ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)'
                      : msg.role === 'error'
                        ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.2) 100%)'
                        : 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.2) 100%)',
                  border: msg.role === 'user'
                    ? 'none'
                    : `1px solid ${msg.role === 'assistant' ? 'rgba(139, 92, 246, 0.3)' : msg.role === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: msg.role === 'user'
                    ? '0 4px 20px rgba(99, 102, 241, 0.4)'
                    : '0 4px 15px rgba(0, 0, 0, 0.2)',
                  fontSize: '14px',
                  color: '#fff'
                }}>
                  {msg.role === 'user' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : msg.role === 'assistant' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l2 4h4l-3 3 1 5-4-2-4 2 1-5-3-3h4l2-4z" />
                      <circle cx="12" cy="16" r="4" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={msg.role === 'error' ? '#F87171' : '#FBBF24'} strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4M12 16h.01" />
                    </svg>
                  )}
                </div>

                {/* Message Content */}
                <div style={{
                  flex: 1,
                  minWidth: 0,
                  maxWidth: msg.role === 'user' ? '75%' : '85%'
                }}>
                  {/* Message Bubble */}
                  <div style={{
                    fontSize: '14px',
                    lineHeight: '1.75',
                    color: msg.role === 'error' ? '#FCA5A5' : msg.role === 'user' ? '#F1F5F9' : '#E2E8F0',
                    padding: '16px 20px',
                    background: msg.role === 'user'
                      ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(139, 92, 246, 0.2) 100%)'
                      : msg.role === 'assistant'
                        ? 'linear-gradient(135deg, rgba(30, 35, 50, 0.6) 0%, rgba(20, 25, 40, 0.7) 100%)'
                        : 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.08) 100%)',
                    border: `1px solid ${msg.role === 'user'
                      ? 'rgba(99, 102, 241, 0.3)'
                      : msg.role === 'assistant'
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(239, 68, 68, 0.2)'}`,
                    borderRadius: msg.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxShadow: msg.role === 'user'
                      ? '0 4px 20px rgba(99, 102, 241, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                      : msg.role === 'assistant'
                        ? '0 4px 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.02)'
                        : 'none',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    {/* Subtle shine effect for assistant messages */}
                    {msg.role === 'assistant' && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: '-100%',
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.02), transparent)',
                        animation: 'shimmer 3s ease-in-out infinite'
                      }} />
                    )}
                    <span style={{ position: 'relative', zIndex: 1 }}>{msg.content}</span>
                  </div>

                  {/* Timestamp */}
                  <div style={{
                    fontSize: '10px',
                    color: 'rgba(148, 163, 184, 0.5)',
                    marginTop: '6px',
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                    paddingLeft: msg.role === 'user' ? 0 : '20px',
                    paddingRight: msg.role === 'user' ? '20px' : 0
                  }}>
                    just now
                  </div>
                </div>
              </div>
            ))}

            {/* Typing Indicator - Futuristic */}
            {isAiLoading && (
              <div style={{
                display: 'flex',
                gap: '16px',
                animation: 'messageSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
              }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.5" style={{ animation: 'pulse 2s ease-in-out infinite' }}>
                    <path d="M12 2l2 4h4l-3 3 1 5-4-2-4 2 1-5-3-3h4l2-4z" />
                    <circle cx="12" cy="16" r="4" />
                  </svg>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '16px 24px',
                  background: 'linear-gradient(135deg, rgba(30, 35, 50, 0.6) 0%, rgba(20, 25, 40, 0.7) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '20px 20px 20px 4px',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
                }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: `linear-gradient(135deg, ${i === 0 ? '#8B5CF6' : i === 1 ? '#6366F1' : '#3B82F6'}, ${i === 0 ? '#A78BFA' : i === 1 ? '#818CF8' : '#60A5FA'})`,
                          boxShadow: `0 0 10px ${i === 0 ? 'rgba(139, 92, 246, 0.5)' : i === 1 ? 'rgba(99, 102, 241, 0.5)' : 'rgba(59, 130, 246, 0.5)'}`,
                          animation: `bounce 1.4s ease-in-out ${i * 0.16}s infinite`
                        }}
                      />
                    ))}
                  </div>
                  <span style={{
                    fontSize: '12px',
                    color: 'rgba(148, 163, 184, 0.7)',
                    marginLeft: '4px',
                    fontWeight: 500
                  }}>
                    Generating response
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`cooldesk-search-box command-${commandMode} ${isListening ? 'listening' : ''}`}
        onClick={() => inputRef.current?.focus()}
        style={{
          cursor: 'text',
          position: 'relative',
          flexShrink: 0,
          borderBottomLeftRadius: isResultsOpen ? '0' : '12px',
          borderBottomRightRadius: isResultsOpen ? '0' : '12px',
          borderBottom: isResultsOpen ? 'none' : undefined,
          transition: 'border-radius 0.1s ease', // Faster transition for shape change
          zIndex: 10003
        }}
      >
        {/* Modern Accent Glow */}
        <div className="search-glow-effect" style={{
          position: 'absolute',
          inset: '-2px',
          borderRadius: '14px',
          background: commandMode === 'ai' ? 'linear-gradient(135deg, #F59E0B, #EF4444)' :
            commandMode === 'action' ? 'linear-gradient(135deg, #8B5CF6, #3B82F6)' :
              commandMode === 'nav' ? 'linear-gradient(135deg, #10B981, #3B82F6)' :
                'transparent',
          opacity: commandMode !== 'default' ? 0.2 : 0,
          filter: 'blur(10px)',
          zIndex: -1,
          transition: 'all 0.4s ease'
        }}></div>

        {activePill && (
          <div className="command-pill" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            marginRight: '8px',
            marginTop: '8px',
            alignSelf: 'flex-start',
            background: 'rgba(139, 92, 246, 0.2)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            borderRadius: '6px',
            color: '#A78BFA',
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '0.05em'
          }}>
            {activePill.label}
          </div>
        )}

        <span className="terminal-prompt" style={{
          fontFamily: "'Fira Code', monospace",
          fontWeight: '700',
          fontSize: '18px',
          color: isAISearch ? '#A78BFA' : 'var(--accent-color, #34C759)',
          marginRight: '4px',
          marginTop: '8px',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          alignSelf: 'flex-start',
          height: '24px',
          transition: 'color 0.2s ease'
        }}>
          {isAISearch ? (
            <FontAwesomeIcon icon={faRobot} style={{ fontSize: '14px' }} title="AI-powered search" />
          ) : '>'}
        </span>
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'flex-start', marginTop: '4px' }}>
          <textarea
            ref={inputRef}
            className="cooldesk-search-input cooldesk-search-textarea"
            placeholder={placeholder}
            value={searchValue}
            onChange={handleChange}
            onKeyDown={(e) => {
              // Allow Shift+Enter for new lines, Enter alone submits
              if (e.key === 'Enter' && !e.shiftKey) {
                handleKeyDown(e);
              } else if (e.key === 'Enter' && e.shiftKey) {
                // Allow newline insertion - don't prevent default
              } else {
                handleKeyDown(e);
              }
            }}
            onInput={(e) => {
              // Auto-resize textarea
              e.target.style.height = 'auto';
              const newHeight = Math.min(e.target.scrollHeight, 200); // Max 200px (~5-6 lines)
              e.target.style.height = `${newHeight}px`;
            }}
            rows={1}
            style={{
              position: 'relative',
              zIndex: 2,
              background: 'transparent',
              caretColor: 'var(--text-primary, #F8FAFC)',
              resize: 'none',
              overflow: 'hidden',
              minHeight: '24px',
              maxHeight: '200px',
              lineHeight: '24px',
              paddingTop: '0',
              paddingBottom: '8px'
            }}
          />
          {/* Ghost text for autocomplete hint */}
          {autocompleteHint && autocompleteHint !== searchValue && !searchValue.includes('\n') && (
            <div style={{
              position: 'absolute',
              left: '0',
              top: '0',
              fontSize: 'var(--font-lg)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              pointerEvents: 'none',
              zIndex: 1,
              whiteSpace: 'pre',
              fontFamily: 'inherit',
              display: 'flex',
              lineHeight: '24px',
              color: 'transparent'
            }}>
              {/* Invisible spacer matching typed text */}
              <span style={{
                visibility: 'hidden',
                color: 'transparent'
              }}>{searchValue}</span>
              {/* Visible ghost text */}
              <span style={{
                color: 'rgba(148, 163, 184, 0.5)',
                fontStyle: 'italic'
              }}>{autocompleteHint.slice(searchValue.length)}</span>
            </div>
          )}
          {/* Multi-line hint */}
          {searchValue.length > 50 && !searchValue.includes('\n') && (
            <div style={{
              position: 'absolute',
              right: '0',
              bottom: '-18px',
              fontSize: '10px',
              color: 'rgba(148, 163, 184, 0.4)',
              pointerEvents: 'none',
              zIndex: 1
            }}>
              Shift+Enter for new line
            </div>
          )}
        </div>
      </form>

      {/* Unified Expanded Search Panel */}
      <ExpandedSearchPanel
        isOpen={isResultsOpen}
        suggestions={commandSuggestions.length > 0 ? commandSuggestions : searchSuggestions}
        selectedIndex={selectedSuggestionIndex}
        searchValue={searchValue}
        activePill={activePill}
        onHover={handleHover}
        onClose={handleClose}
        onSelect={handleSelect}
        isResultsOpen={isResultsOpen}
      />

      {/* Command Feedback */}
      {commandFeedback && commandSuggestions.length === 0 && searchSuggestions.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '8px',
          padding: '10px 16px',
          borderRadius: '10px',
          background: commandFeedback.type === 'error' ? 'rgba(239, 68, 68, 0.15)' :
            commandFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' :
              'rgba(59, 130, 246, 0.15)',
          border: `1px solid ${commandFeedback.type === 'error' ? 'rgba(239, 68, 68, 0.3)' :
            commandFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.3)' :
              'rgba(59, 130, 246, 0.3)'}`,
          color: commandFeedback.type === 'error' ? '#F87171' :
            commandFeedback.type === 'success' ? '#4ADE80' :
              '#60A5FA',
          fontSize: '12px',
          fontWeight: 500,
          zIndex: 1001,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ flex: 1 }}>{commandFeedback.message}</div>
          <button onClick={() => setCommandFeedback(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px', opacity: 0.6 }}>✕</button>
        </div>
      )}
    </div>
  );
}
