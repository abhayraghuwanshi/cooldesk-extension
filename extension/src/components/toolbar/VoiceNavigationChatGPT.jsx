import { faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import { useEffect, useRef, useState } from 'react';
import { VoiceCommandProcessor } from '../../services/voiceCommandProcessor.js';
import '../../styles/voicenavigationstyles.css';
import { vDebug, vError, vInfo, vWarn } from '../../utils/logger.js';
import { fuzzySearch } from '../../utils/searchUtils.js';
import VoiceNavigationHelp from './VoiceNavigationHelp.jsx';


const VoiceNavigationChatGPT = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceLevel, setVoiceLevel] = useState(0);

  const [waveformData, setWaveformData] = useState(Array(5).fill(0));
  const [showEnergyWave, setShowEnergyWave] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [connectionExpired, setConnectionExpired] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const MAX_RECONNECT_ATTEMPTS = 3;
  const reconnectAttemptsRef = useRef(0);

  // Initialize voice command processor
  const commandProcessorRef = useRef(null);
  const [workspaceData, setWorkspaceData] = useState(null);
  // Track user intent for stopping voice navigation
  const userIntentStoppedRef = useRef(false);

  // Connection management refs
  const sessionTimerRef = useRef(null);
  const keepAliveTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const timeDisplayTimerRef = useRef(null);
  const sessionStartTimeRef = useRef(null);
  const endDebounceTimerRef = useRef(null);
  const isReconnectingRef = useRef(false);

  const showFeedback = (message, type = 'success') => {
    setFeedback(message);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback('');
      setTranscript('');
    }, 3000);
  };
  const recognitionRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Trigger energy wave effect
  const triggerEnergyWave = () => {
    setShowEnergyWave(true);
    setTimeout(() => setShowEnergyWave(false), 1000);
  };

  // Connection management functions
  const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes (increased from 10)
  const KEEP_ALIVE_INTERVAL = 60 * 1000; // 60 seconds (less aggressive)
  const RECONNECT_DELAY = 3000; // 3 seconds

  const clearAllTimers = () => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (keepAliveTimerRef.current) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (timeDisplayTimerRef.current) {
      clearInterval(timeDisplayTimerRef.current);
      timeDisplayTimerRef.current = null;
    }
    if (endDebounceTimerRef.current) {
      clearTimeout(endDebounceTimerRef.current);
      endDebounceTimerRef.current = null;
    }
  };

  const updateTimeRemaining = () => {
    if (sessionStartTimeRef.current && !connectionExpired) {
      const elapsed = Date.now() - sessionStartTimeRef.current;
      const remaining = Math.max(0, SESSION_DURATION - elapsed);
      setTimeRemaining(Math.ceil(remaining / 1000));

      if (remaining <= 0) {
        expireSession();
      }
    }
  };

  const expireSession = () => {
    vWarn('expireSession triggered');
    setConnectionExpired(true);
    setTimeRemaining(0);

    // Don't mark as user intent when session expires automatically
    const wasUserIntent = userIntentStoppedRef.current;
    stopListening();
    // Reset the flag since this was an automatic expiration, not user intent
    userIntentStoppedRef.current = wasUserIntent;
    clearAllTimers();
    setFeedback('Voice session expired after 30 minutes. Click to reconnect.', 'warning');
  };

  const startSession = () => {
    vInfo('startSession');
    sessionStartTimeRef.current = Date.now();
    setConnectionExpired(false);
    setTimeRemaining(1800); // 30 minutes

    // 30-minute session timer
    sessionTimerRef.current = setTimeout(() => {
      expireSession();
    }, SESSION_DURATION);

    // Update time display every second
    timeDisplayTimerRef.current = setInterval(updateTimeRemaining, 1000);

    // Keep-alive mechanism (less aggressive, only resume if needed)
    keepAliveTimerRef.current = setInterval(() => {
      if (isListening && annyang && !connectionExpired) {
        vDebug('[KeepAlive] tick');
        try {
          console.log('[KeepAlive] Voice recognition still active');
          // Resume audio context if suspended
          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
              console.log('[KeepAlive] Audio context resumed');
            }).catch(err => {
              console.warn('[KeepAlive] Failed to resume audio context:', err);
            });
          }
        } catch (error) {
          console.warn('[KeepAlive] Keep-alive check failed:', error);
        }
      }
    }, KEEP_ALIVE_INTERVAL);
  };

  const attemptReconnect = () => {
    vDebug('attemptReconnect called', { isListening, connectionExpired, attempts: reconnectAttemptsRef.current });
    // Don't auto-reconnect if user intentionally stopped
    if (userIntentStoppedRef.current) {
      console.log('[Reconnect] Cancelled: User intentionally stopped voice navigation');
      vInfo('reconnect cancelled - user intent');
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      return;
    }

    // Skip if a reconnect is already in-flight or scheduled
    if (isReconnectingRef.current || reconnectTimerRef.current) {
      vDebug('attemptReconnect skipped - already reconnecting or scheduled');
      return;
    }

    // Limit reconnection attempts
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[Reconnect] Max attempts reached, stopping auto-reconnect');
      vWarn('max reconnect attempts reached');
      setError('Voice recognition disconnected. Click microphone to restart.');
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      stopAudioAnalysis();
      return;
    }

    if (!connectionExpired && annyang && !isListening) {
      isReconnectingRef.current = true;
      vDebug('scheduling reconnect', { delay: RECONNECT_DELAY });
      reconnectTimerRef.current = setTimeout(() => {
        // Check again in case user stopped during the timeout
        if (userIntentStoppedRef.current) {
          console.log('[Reconnect] Cancelled during timeout: User stopped voice navigation');
          reconnectAttemptsRef.current = 0;
          isReconnectingRef.current = false;
          stopAudioAnalysis();
          return;
        }

        try {
          reconnectAttemptsRef.current++;
          console.log(`[Reconnect] Attempting reconnection (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
          // Clean restart sequence: abort first, then start with autoRestart disabled
          try { annyang.abort(); } catch { }
          setTimeout(() => {
            annyang.start({ autoRestart: false, continuous: true });
          }, 100);
          setError('');
          // Reset counter and flag on successful reconnect
          setTimeout(() => {
            if (isListening) {
              reconnectAttemptsRef.current = 0;
              isReconnectingRef.current = false;
            }
          }, 5000);
        } catch (error) {
          console.warn('[Reconnect] Failed:', error);
          // Try again with exponential backoff
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1);
            console.log(`[Reconnect] Will retry in ${delay}ms`);
            vInfo('will retry reconnect', { delay });
            isReconnectingRef.current = false;
            setTimeout(attemptReconnect, delay);
          } else {
            vError('failed to reconnect voice recognition after max attempts');
            setError('Failed to reconnect voice recognition. Please restart manually.');
            reconnectAttemptsRef.current = 0;
            isReconnectingRef.current = false;
            stopAudioAnalysis();
          }
        }
      }, RECONNECT_DELAY);
    } else {
      isReconnectingRef.current = false;
    }
  };

  // Fetch workspace data for voice commands
  const fetchWorkspaceData = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getWorkspaceData'
      });

      if (response?.success) {
        setWorkspaceData(response.data);
        // Update command processor if it exists
        if (commandProcessorRef.current) {
          commandProcessorRef.current.updateWorkspaceData(response.data);
        }
      }
    } catch (error) {
      console.warn('Failed to fetch workspace data:', error);
    }
  };

  // Initialize speech recognition and command processor
  useEffect(() => {
    vInfo('VoiceNavigationChatGPT mounted');
    // Fetch workspace data on component mount
    fetchWorkspaceData();

    // Initialize the command processor
    if (!commandProcessorRef.current) {
      commandProcessorRef.current = new VoiceCommandProcessor(showFeedback, workspaceData);
    }

    if (annyang) {
      // Simple bridge pattern - delegate all commands to processor
      const commands = {
        // Special handling for numbered commands (annyang pattern)
        'switch to tab :num': async (num) => {
          await commandProcessorRef.current.processVoiceCommand(`switch to tab ${num}`);
        },
        'go to tab :num': async (num) => {
          await commandProcessorRef.current.processVoiceCommand(`go to tab ${num}`);
        },
        'click :num': (num) => {
          console.log('[VoiceNav] "click [num]" command triggered, num:', num);
          clickByNumber(`click ${num}`);
        },
        'click number :num': (num) => {
          console.log('[VoiceNav] "click number [num]" command triggered, num:', num);
          clickByNumber(`click number ${num}`);
        },
        // Commands with parameters
        'find tab *term': async (term) => {
          await commandProcessorRef.current.processVoiceCommand(`find tab ${term}`);
        },
        'search tab *term': async (term) => {
          await commandProcessorRef.current.processVoiceCommand(`search tab ${term}`);
        },
        'search for *term': async (term) => {
          await commandProcessorRef.current.processVoiceCommand(`search for ${term}`);
        },
        'google search *term': async (term) => {
          await commandProcessorRef.current.processVoiceCommand(`google search ${term}`);
        },
        'search *term': async (term) => {
          await commandProcessorRef.current.processVoiceCommand(`search ${term}`);
        },
        // Open commands
        'open *term': async (term) => {
          await commandProcessorRef.current.processVoiceCommand(`open ${term}`);
        },
        'click *text': async (text) => {
          await commandProcessorRef.current.processVoiceCommand(`click ${text}`);
        },
        'click on *text': async (text) => {
          await commandProcessorRef.current.processVoiceCommand(`click on ${text}`);
        },

        // Special UI commands that need to stay in the component
        'show numbers': () => {
          console.log('[VoiceNav] "show numbers" command triggered');
          showElementNumbers();
        },
        'show numbers.': () => {
          console.log('[VoiceNav] "show numbers." command triggered');
          showElementNumbers();
        },
        'show numbers!': () => {
          console.log('[VoiceNav] "show numbers!" command triggered');
          showElementNumbers();
        },
        'number elements': () => {
          console.log('[VoiceNav] "number elements" command triggered');
          showElementNumbers();
        },
        'number elements.': () => {
          console.log('[VoiceNav] "number elements." command triggered');
          showElementNumbers();
        },
        'number elements!': () => {
          console.log('[VoiceNav] "number elements!" command triggered');
          showElementNumbers();
        },
        'hide numbers': () => {
          console.log('[VoiceNav] "hide numbers" command triggered');
          hideElementNumbers();
        },
        'hide numbers.': () => {
          console.log('[VoiceNav] "hide numbers." command triggered');
          hideElementNumbers();
        },
        'hide numbers!': () => {
          console.log('[VoiceNav] "hide numbers!" command triggered');
          hideElementNumbers();
        },
        'clear numbers': () => {
          console.log('[VoiceNav] "clear numbers" command triggered');
          hideElementNumbers();
        },
        'clear numbers.': () => {
          console.log('[VoiceNav] "clear numbers." command triggered');
          hideElementNumbers();
        },
        'clear numbers!': () => {
          console.log('[VoiceNav] "clear numbers!" command triggered');
          hideElementNumbers();
        },
        // Media controls
        'play': async () => {
          await commandProcessorRef.current.processVoiceCommand('play');
        },
        'play.': async () => {
          await commandProcessorRef.current.processVoiceCommand('play');
        },
        'play!': async () => {
          await commandProcessorRef.current.processVoiceCommand('play');
        },
        'pause': async () => {
          await commandProcessorRef.current.processVoiceCommand('pause');
        },
        'pause.': async () => {
          await commandProcessorRef.current.processVoiceCommand('pause');
        },
        'pause!': async () => {
          await commandProcessorRef.current.processVoiceCommand('pause');
        },
        'spacebar': async () => {
          await commandProcessorRef.current.processVoiceCommand('spacebar');
        },
        'click play': async () => {
          await commandProcessorRef.current.processVoiceCommand('click play');
        },
        'click pause': async () => {
          await commandProcessorRef.current.processVoiceCommand('click pause');
        },
        // New workspace and note commands
        'add note *note': async (note) => {
          await commandProcessorRef.current.processVoiceCommand(`add note ${note}`);
        },
        'create note *note': async (note) => {
          await commandProcessorRef.current.processVoiceCommand(`create note ${note}`);
        },
        'add todo *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
        },
        'add todo. *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
        },
        'add todo! *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
        },
        'add to do *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
        },
        'add to do. *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
        },
        'add to do! *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`add todo ${todo}`);
        },
        'create todo *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`create todo ${todo}`);
        },
        'create todo. *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`create todo ${todo}`);
        },
        'create todo! *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`create todo ${todo}`);
        },
        'create to do *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`create todo ${todo}`);
        },
        'create to do. *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`create todo ${todo}`);
        },
        'create to do! *todo': async (todo) => {
          await commandProcessorRef.current.processVoiceCommand(`create todo ${todo}`);
        },
        'save url to workspace': async () => {
          await commandProcessorRef.current.processVoiceCommand('save url to workspace');
        },
        'save to workspace': async () => {
          await commandProcessorRef.current.processVoiceCommand('save to workspace');
        },
        'pin this page': async () => {
          await commandProcessorRef.current.processVoiceCommand('pin this page');
        },
        'add to pins': async () => {
          await commandProcessorRef.current.processVoiceCommand('add to pins');
        },
        'pin page': async () => {
          await commandProcessorRef.current.processVoiceCommand('pin page');
        },
        // Navigation commands
        'next tab': async () => {
          await commandProcessorRef.current.processVoiceCommand('next tab');
        },
        'next tab.': async () => {
          await commandProcessorRef.current.processVoiceCommand('next tab');
        },
        'next tab!': async () => {
          await commandProcessorRef.current.processVoiceCommand('next tab');
        },
        'previous tab': async () => {
          await commandProcessorRef.current.processVoiceCommand('previous tab');
        },
        'previous tab.': async () => {
          await commandProcessorRef.current.processVoiceCommand('previous tab');
        },
        'previous tab!': async () => {
          await commandProcessorRef.current.processVoiceCommand('previous tab');
        },
        'prev tab': async () => {
          await commandProcessorRef.current.processVoiceCommand('prev tab');
        },
        'prev tab.': async () => {
          await commandProcessorRef.current.processVoiceCommand('prev tab');
        },
        'prev tab!': async () => {
          await commandProcessorRef.current.processVoiceCommand('prev tab');
        },
        'close tab': async () => {
          await commandProcessorRef.current.processVoiceCommand('close tab');
        },
        'close tab.': async () => {
          await commandProcessorRef.current.processVoiceCommand('close tab');
        },
        'close tab!': async () => {
          await commandProcessorRef.current.processVoiceCommand('close tab');
        },
        'new tab': async () => {
          await commandProcessorRef.current.processVoiceCommand('new tab');
        },
        'new tab.': async () => {
          await commandProcessorRef.current.processVoiceCommand('new tab');
        },
        'new tab!': async () => {
          await commandProcessorRef.current.processVoiceCommand('new tab');
        },
        'scroll down': async () => {
          await commandProcessorRef.current.processVoiceCommand('scroll down');
        },
        'scroll down.': async () => {
          await commandProcessorRef.current.processVoiceCommand('scroll down');
        },
        'scroll down!': async () => {
          await commandProcessorRef.current.processVoiceCommand('scroll down');
        },
        'scroll up': async () => {
          await commandProcessorRef.current.processVoiceCommand('scroll up');
        },
        'scroll up.': async () => {
          await commandProcessorRef.current.processVoiceCommand('scroll up');
        },
        'scroll up!': async () => {
          await commandProcessorRef.current.processVoiceCommand('scroll up');
        },
        'go back': async () => {
          await commandProcessorRef.current.processVoiceCommand('go back');
        },
        'go back.': async () => {
          await commandProcessorRef.current.processVoiceCommand('go back');
        },
        'go back!': async () => {
          await commandProcessorRef.current.processVoiceCommand('go back');
        },
        'go forward': async () => {
          await commandProcessorRef.current.processVoiceCommand('go forward');
        },
        'go forward.': async () => {
          await commandProcessorRef.current.processVoiceCommand('go forward');
        },
        'go forward!': async () => {
          await commandProcessorRef.current.processVoiceCommand('go forward');
        },
        'reload': async () => {
          await commandProcessorRef.current.processVoiceCommand('reload');
        },
        'reload.': async () => {
          await commandProcessorRef.current.processVoiceCommand('reload');
        },
        'reload!': async () => {
          await commandProcessorRef.current.processVoiceCommand('reload');
        },
        'refresh': async () => {
          await commandProcessorRef.current.processVoiceCommand('refresh');
        },
        'refresh.': async () => {
          await commandProcessorRef.current.processVoiceCommand('refresh');
        },
        'refresh!': async () => {
          await commandProcessorRef.current.processVoiceCommand('refresh');
        }
      };

      // Add commands to annyang
      annyang.addCommands(commands);

      // Set language
      annyang.setLanguage('en-US');

      // Handle results and errors
      annyang.addCallback('result', (phrases) => {
        if (phrases.length > 0) {
          const command = phrases[0];
          console.log('[VoiceNav] Voice command recognized:', command);
          vDebug('annyang result', phrases);
          setTranscript(command);
          setInterimTranscript('');
          // Feedback is set by the command action
        }
      });

      annyang.addCallback('resultNoMatch', (phrases) => {
        if (phrases.length > 0) {
          vWarn('annyang resultNoMatch', phrases);
          const command = phrases[0];
          setTranscript(command);
          setFeedback(`Command "${command}" not recognized. Try "show numbers", "search for cats", "open youtube", "add note [text]", "add todo [text]", "save url to workspace", "pin this page", or "switch to tab 2"`);
          // Clear feedback after 3 seconds
          if (feedbackTimeoutRef.current) {
            clearTimeout(feedbackTimeoutRef.current);
          }
          feedbackTimeoutRef.current = setTimeout(() => {
            setFeedback('');
            setTranscript('');
          }, 3000);
        }
      });

      annyang.addCallback('error', (error) => {
        vWarn('annyang error', error);
        // Log benign no-speech at debug level; warn for others
        if (error?.error === 'no-speech') {
          console.debug('Speech recognition no-speech:', error);
        } else {
          console.warn('Speech recognition error:', error);
        }

        // Don't set error state if user intentionally stopped
        if (userIntentStoppedRef.current) {
          console.log('Ignoring error - user intentionally stopped voice navigation');
          return;
        }

        // Gracefully handle frequent benign errors
        if (error?.error === 'no-speech') {
          // Do not surface as an error; just try to continue
          console.log('[VoiceNav] No speech detected; keeping audio active');
          vDebug('no-speech: not scheduling reconnect here (handled by end)');
          // Avoid duplicate reconnects; rely on the debounced 'end' handler to reconnect
          return;
        }

        // Default handling for other errors
        setIsListening(false);
        setError(`Speech recognition error: ${error.error}`);
        setFeedback('');
        setInterimTranscript('');
        setVoiceLevel(0);
        setWaveformData(Array(5).fill(0));
        stopAudioAnalysis();
      });

      annyang.addCallback('start', () => {
        vInfo('annyang start');
        setIsListening(true);
        setError('');
        setFeedback('Listening...');
        startAudioAnalysis();
        // Reset reconnect flags on successful start
        isReconnectingRef.current = false;
        reconnectAttemptsRef.current = 0;
      });

      annyang.addCallback('end', () => {
        vDebug('annyang end event');
        // Debounce the end event - speech recognition fires 'end' frequently during normal pauses
        if (endDebounceTimerRef.current) {
          clearTimeout(endDebounceTimerRef.current);
        }

        endDebounceTimerRef.current = setTimeout(() => {
          // Only process if we're not already reconnecting
          if (isReconnectingRef.current) {
            console.log('[VoiceNav] Ignoring end event - already reconnecting');
            return;
          }

          vInfo('annyang end (debounced)');
          console.log('[VoiceNav] Voice recognition ended (debounced)');
          setIsListening(false);
          setInterimTranscript('');
          setVoiceLevel(0);
          setWaveformData(Array(5).fill(0));

          // Don't stop audio analysis immediately - let reconnect handle it if needed
          // This prevents the audio from stopping and starting repeatedly

          // Auto-reconnect only if session is active and user hasn't manually stopped
          if (!connectionExpired && !userIntentStoppedRef.current) {
            console.log('[VoiceNav] Attempting auto-reconnect...');
            vInfo('auto-reconnect initiating');
            attemptReconnect();
          } else if (userIntentStoppedRef.current) {
            console.log('[VoiceNav] Ended by user intent, stopping audio analysis');
            vInfo('ended by user intent - stop audio');
            stopAudioAnalysis();
          } else {
            console.log('[VoiceNav] Session expired, stopping audio analysis');
            vInfo('session expired - stop audio');
            stopAudioAnalysis();
          }

          // Clear feedback after a short delay when recognition ends
          setTimeout(() => {
            if (!isListening) {
              setFeedback('');
            }
          }, 2000);
        }, 1500); // 1.5 second debounce to avoid rapid end/start cycles
      });

    } else {
      setError('Speech recognition not supported in this browser');
    }

    return () => {
      vInfo('VoiceNavigationChatGPT cleanup');
      if (annyang) {
        annyang.removeCommands();
        annyang.removeCallback('result');
        annyang.removeCallback('resultNoMatch');
        annyang.removeCallback('error');
        annyang.removeCallback('start');
        annyang.removeCallback('end');
        annyang.abort();
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      stopAudioAnalysis();
      clearAllTimers();
    };
  }, []);

  // Update command processor when workspace data changes
  useEffect(() => {
    if (commandProcessorRef.current && workspaceData) {
      commandProcessorRef.current.updateWorkspaceData(workspaceData);
    }
  }, [workspaceData]);

  // Audio analysis functions
  const startAudioAnalysis = async (retryCount = 0) => {
    vInfo('startAudioAnalysis', { retryCount });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneRef.current = stream;
      try {
        vInfo('getUserMedia success', { tracks: stream.getAudioTracks().map(t => t.label) });
      } catch { }
      if (audioContextRef.current && audioContextRef.current.state === 'running') {
        return; // Reuse existing context
      }
      // Close suspended contexts before creating new ones
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.close();
      }

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      vDebug('AudioContext created', audioContextRef.current?.state);
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      updateAudioData();
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        vError('getUserMedia NotAllowedError');
        setError('Microphone permission denied');
      } else if (retryCount < 2) {
        vWarn('getUserMedia error - retrying', error);
        setTimeout(() => startAudioAnalysis(retryCount + 1), 1000);
      }
    }
  };

  const stopAudioAnalysis = async () => {
    vInfo('stopAudioAnalysis begin');
    console.log('[AudioAnalysis] Stopping audio analysis');

    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop microphone stream
    if (microphoneRef.current) {
      microphoneRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('[AudioAnalysis] Stopped track:', track.label);
      });
      microphoneRef.current = null;
    }

    // Close audio context properly
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
          console.log('[AudioAnalysis] Audio context closed');
        }
      } catch (error) {
        console.warn('[AudioAnalysis] Error closing audio context:', error);
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

  const startListening = async () => {
    // Reset user intent flag when user starts listening
    userIntentStoppedRef.current = false;
    vInfo('startListening called', { isListening, connectionExpired, hasAnnyang: !!annyang });

    // Clear any previous errors
    setError('');

    if (connectionExpired) {
      // Restart the session
      startSession();
    }

    if (annyang && !isListening) {
      try {
        // Preflight mic so permission prompt occurs and audio flows before recognition starts
        await startAudioAnalysis();
        vInfo('[Start] Calling annyang.start', { autoRestart: false, continuous: true });
        annyang.start({ autoRestart: false, continuous: true });

        // Start session management if not already started
        if (!sessionStartTimeRef.current) {
          startSession();
        }
      } catch (error) {
        console.error('Failed to start voice recognition:', error);
        vError('Failed to start voice recognition', error);
        setError('Failed to start voice recognition');
        setIsListening(false);
      }
    }
  };

  const stopListening = () => {
    console.log('[VoiceNav] stopListening called');
    vInfo('stopListening called');
    // Mark that user intentionally stopped the voice navigation
    userIntentStoppedRef.current = true;
    isReconnectingRef.current = false;

    // Clear debounce timer
    if (endDebounceTimerRef.current) {
      clearTimeout(endDebounceTimerRef.current);
      endDebounceTimerRef.current = null;
    }

    if (annyang && isListening) {
      annyang.abort();
      vDebug('annyang.abort called');
    }
    // Force reset all states
    setIsListening(false);
    setTranscript('');
    setInterimTranscript('');
    setFeedback('Voice navigation stopped. Click to start listening again.', 'info');
    setError('');
    console.log('[VoiceNav] Error cleared in stopListening');
    setVoiceLevel(0);
    setWaveformData(Array(5).fill(0));
    setShowEnergyWave(false);
    stopAudioAnalysis();
    vDebug('stopAudioAnalysis completed');

    // Clear reconnection attempts
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      vDebug('reconnect timer cleared');
    }
  };

  const showElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: addNumbersToElementsAdvanced
      });

      if (results && results[0] && results[0].result) {
        const elementCount = results[0].result.count;
        setFeedback(`Showing numbers on ${elementCount} clickable elements (up to 40). Say "click 1" to "click ${elementCount}"`);
      }
    } catch (error) {
      setFeedback(`Failed to show numbers: ${error.message}`);
    }
  };

  const hideElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: removeNumbersAdvanced
      });
      setFeedback('Numbers hidden');
    } catch (error) {
      setFeedback(`Failed to hide numbers: ${error.message}`);
    }
  };

  const clickByNumber = async (command) => {
    try {
      const numberMatch = command.match(/click (\d+)/) || command.match(/click number (\d+)/);
      if (!numberMatch) {
        setFeedback('Please specify a number to click');
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
          setFeedback(`Clicked element ${clickNumber}: ${result.elementText}`);
        } else {
          setFeedback(`Element ${clickNumber} not found. Say "show numbers" first.`);
        }
      }
    } catch (error) {
      setFeedback(`Failed to click by number: ${error.message}`);
    }
  };

  const clickLink = async (command) => {
    try {
      let linkText = '';
      if (command.includes('click on')) {
        linkText = command.replace(/.*click on\s+/, '').trim();
      } else if (command.includes('click')) {
        linkText = command.replace(/.*click\s+/, '').trim();
      }

      if (!linkText) {
        setFeedback('Please specify what to click');
        return;
      }

      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: findAndClickLink,
        args: [linkText]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          setFeedback(`Clicked: ${result.elementText || linkText}`);
        } else {
          setFeedback(`Could not find clickable element: "${linkText}"`);
        }
      }
    } catch (error) {
      setFeedback(`Failed to click link: ${error.message}`);
    }
  };


  const findAndClickLink = (searchText) => {
    const elements = document.querySelectorAll('a, button, [role="button"], [onclick]');
    const searchLower = searchText.toLowerCase();

    // Create an array of elements with their text content for fuzzy search
    const elementList = Array.from(elements).map((el, index) => ({
      index,
      text: el.textContent?.toLowerCase() || '',
      title: el.getAttribute('title')?.toLowerCase() || '',
      label: el.getAttribute('aria-label')?.toLowerCase() || ''
    }));

    // Use fuzzy search to find the best match
    const results = fuzzySearch(elementList, searchLower, ['text', 'title', 'label'], { threshold: 0.3 });

    if (results.length > 0) {
      const bestMatch = elements[results[0].index];
      bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => bestMatch.click(), 200);
      return {
        success: true,
        elementText: bestMatch.textContent?.trim() || bestMatch.getAttribute('title') || 'Link'
      };
    }

    return { success: false };
  };

  // Advanced page-injected functions (inspired by Untitled-1)
  const addNumbersToElementsAdvanced = () => {
    // Cleanup existing overlays and listeners
    document.querySelectorAll('.voice-nav-number').forEach(el => el.remove());
    const oldContainer = document.querySelector('.voice-nav-container');
    if (oldContainer) oldContainer.remove();
    if (window.voiceNavScrollHandler) {
      window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
      delete window.voiceNavScrollHandler;
    }
    if (window.voiceNavMutationObserver) {
      window.voiceNavMutationObserver.disconnect();
      delete window.voiceNavMutationObserver;
    }

    // Broad selectors for interactive elements
    const selectors = [
      'a:not([style*="display: none"]):not([hidden])',
      'button:not([disabled]):not([style*="display: none"]):not([hidden])',
      '[role="button"]:not([aria-hidden="true"]):not([style*="display: none"])',
      '[onclick]:not([style*="display: none"]):not([hidden])',
      'input[type="submit"]:not([disabled]):not([style*="display: none"])',
      'input[type="button"]:not([disabled]):not([style*="display: none"])',

      // UI component patterns
      '[class*="btn"]:not([disabled]):not([style*="display: none"]):not([hidden])',
      '[class*="button"]:not([disabled]):not([style*="display: none"]):not([hidden])',
      '[class*="link"]:not([style*="display: none"]):not([hidden])',
      '[tabindex="0"]:not([aria-hidden="true"]):not([style*="display: none"])',

      // Collapsible and expandable elements
      '[aria-expanded]', '[data-toggle]', '[data-collapse]',
      '[class*="collapse"]:not(.collapsed)', '[class*="expand"]',
      '[class*="toggle"]:not([disabled]):not([hidden])',
      '[class*="dropdown"]:not([style*="display: none"])',
      '[class*="accordion"]:not([disabled])',

      // Icon-only and interactive containers
      '[class*="icon"]:not([aria-hidden="true"])',
      '[class*="hamburger"]', '[class*="menu-toggle"]',
      '[class*="nav-toggle"]', '[class*="sidebar-toggle"]',
      'svg[role="button"]', 'svg[onclick]', 'svg[class*="clickable"]',

      // Form controls
      'select:not([disabled])', 'input[type="checkbox"]', 'input[type="radio"]',
      '[role="tab"]:not([aria-hidden="true"])', '[role="menuitem"]',
      '[role="option"]', '[role="treeitem"]',

      // GitHub-specific selectors
      '[class*="js-"]:not([disabled]):not([hidden])',
      '[data-hydro-click]',
      'button[name="button"]',
      '.btn-block:not([disabled])',
      '.octicon-button:not([disabled])'
    ];

    let elements = [];
    selectors.forEach(selector => {
      try { elements.push(...document.querySelectorAll(selector)); } catch { }
    });

    // Visibility + interactivity filters
    const visibleElements = elements.filter((el, index, arr) => {
      if (arr.indexOf(el) !== index) return false;

      // Parent visibility chain
      let parent = el.parentElement;
      while (parent) {
        const ps = window.getComputedStyle(parent);
        if (ps.display === 'none' || ps.visibility === 'hidden' || ps.opacity === '0') return false;
        parent = parent.parentElement;
      }

      // Check scrollable containers bounds
      let sp = el.parentElement;
      while (sp) {
        const st = window.getComputedStyle(sp);
        if (st.overflow === 'auto' || st.overflow === 'scroll' ||
          st.overflowY === 'auto' || st.overflowY === 'scroll') {
          const pr = sp.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          if (er.top < pr.top - 50 || er.bottom > pr.bottom + 50) return false;
          break;
        }
        sp = sp.parentElement;
      }

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isDisplayVisible = style.display !== 'none';
      const isVisibilityVisible = style.visibility !== 'hidden';
      const hasOpacity = parseFloat(style.opacity) > 0.1;
      const hasSize = rect.width > 5 && rect.height > 5;
      const notBehind = !style.pointerEvents || style.pointerEvents !== 'none';
      const isInViewport = rect.top < window.innerHeight + 100 &&
        rect.bottom > -100 &&
        rect.left < window.innerWidth + 100 &&
        rect.right > -100;

      const hasContent = el.textContent?.trim().length > 0 ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('data-tooltip') ||
        el.getAttribute('data-title') ||
        ['button', 'a', 'select', 'input'].includes(el.tagName.toLowerCase()) ||
        el.querySelector('svg, i, [class*="icon"], [class*="fa-"]') ||
        el.hasAttribute('aria-expanded') ||
        el.hasAttribute('data-toggle') ||
        el.hasAttribute('data-collapse') ||
        ['tab', 'menuitem', 'option', 'treeitem'].includes(el.getAttribute('role'));

      const isNotDecorative = !el.classList.contains('overlay') &&
        !el.classList.contains('backdrop') &&
        !el.classList.contains('mask') &&
        !el.classList.contains('decoration') &&
        !el.classList.contains('spacer') &&
        !el.getAttribute('aria-hidden') &&
        (getComputedStyle(el).cursor === 'pointer' || hasContent);

      return isDisplayVisible && isVisibilityVisible && hasOpacity &&
        hasSize && notBehind && isInViewport && hasContent && isNotDecorative;
    });

    // Priority scoring + sorting
    const sortedElements = visibleElements.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();

      let aScore = 0, bScore = 0;
      if (a.tagName.toLowerCase() === 'button') aScore += 10;
      if (b.tagName.toLowerCase() === 'button') bScore += 10;
      if (a.tagName.toLowerCase() === 'a') aScore += 8;
      if (b.tagName.toLowerCase() === 'a') bScore += 8;

      if (a.textContent?.trim().length > 0) aScore += 5;
      if (b.textContent?.trim().length > 0) bScore += 5;

      if (a.hasAttribute('aria-expanded') || a.hasAttribute('data-toggle')) aScore += 7;
      if (b.hasAttribute('aria-expanded') || b.hasAttribute('data-toggle')) bScore += 7;

      if (a.querySelector('svg, i, [class*="icon"], [class*="fa-"]') &&
        getComputedStyle(a).cursor === 'pointer') aScore += 6;
      if (b.querySelector('svg, i, [class*="icon"], [class*="fa-"]') &&
        getComputedStyle(b).cursor === 'pointer') bScore += 6;

      if (a.getAttribute('role') === 'menuitem' || a.classList.contains('dropdown')) aScore += 4;
      if (b.getAttribute('role') === 'menuitem' || b.classList.contains('dropdown')) bScore += 4;

      aScore += Math.max(0, 10 - Math.floor(aRect.top / 100));
      bScore += Math.max(0, 10 - Math.floor(bRect.top / 100));

      const aArea = aRect.width * aRect.height;
      const bArea = bRect.width * bRect.height;
      if (aArea > 1000) aScore += 3;
      if (bArea > 1000) bScore += 3;

      if (a.classList.contains('toggle') || a.classList.contains('hamburger') || a.classList.contains('menu-toggle')) aScore += 5;
      if (b.classList.contains('toggle') || b.classList.contains('hamburger') || b.classList.contains('menu-toggle')) bScore += 5;

      return bScore - aScore;
    });

    // Build overlay and markers
    const limitedElements = sortedElements.slice(0, 20);
    const numberContainer = document.createElement('div');
    numberContainer.className = 'voice-nav-container';
    numberContainer.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 10000;
  `;
    document.body.appendChild(numberContainer);

    const numbered = [];
    limitedElements.forEach((element, index) => {
      const number = index + 1;

      const numberEl = document.createElement('div');
      numberEl.className = 'voice-nav-number';
      numberEl.textContent = number;
      numberEl.setAttribute('data-element-index', number);
      numberEl.setAttribute('data-target-element', number);

      Object.assign(numberEl.style, {
        position: 'absolute',
        height: '22px',
        minWidth: '22px',
        padding: '0 6px',
        borderRadius: '9999px',
        background: 'rgba(17,24,39,0.75)',             // glassy dark
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: '700',
        letterSpacing: '0.2px',
        border: '1px solid rgba(255,255,255,0.35)',
        boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease',
        zIndex: '10001'
      });

      numberContainer.appendChild(numberEl);
      element.setAttribute('data-voice-nav-number', number);
      numbered.push({ number, element, numberEl });
    });

    // Smart positioning that avoids overlap
    const updateNumberPositions = () => {
      const usedPositions = new Set();
      numbered.forEach(item => {
        const rect = item.element.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        const isVisible = rect.top < window.innerHeight && rect.bottom > 0 &&
          rect.left < window.innerWidth && rect.right > 0;

        if (isVisible && rect.width > 0 && rect.height > 0) {
          const positions = [
            { top: rect.top + scrollTop - 12, left: rect.left + scrollLeft - 12 },
            { top: rect.top + scrollTop - 12, left: rect.right + scrollLeft - 10 },
            { top: rect.bottom + scrollTop - 10, left: rect.left + scrollLeft - 12 },
            { top: rect.top + scrollTop + rect.height / 2 - 11, left: rect.left + scrollLeft - 12 },
            { top: rect.top + scrollTop - 12, left: rect.left + scrollLeft + rect.width / 2 - 11 }
          ];

          let bestPosition = positions[0];
          let positionFound = false;

          for (const pos of positions) {
            const posKey = `${Math.floor(pos.top / 25)}-${Math.floor(pos.left / 25)}`;
            if (!usedPositions.has(posKey)) {
              bestPosition = pos;
              usedPositions.add(posKey);
              positionFound = true;
              break;
            }
          }

          if (!positionFound) {
            bestPosition.top += (item.number % 3) * 5;
            bestPosition.left += (item.number % 3) * 5;
          }

          item.numberEl.style.top = `${bestPosition.top}px`;
          item.numberEl.style.left = `${bestPosition.left}px`;
          item.numberEl.style.opacity = '1';
        } else {
          item.numberEl.style.opacity = '0.3';
        }
      });
    };

    updateNumberPositions();

    // Scroll/resize listeners with throttle
    let scrollTimeout;
    const scrollHandler = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateNumberPositions, 16);
    };
    window.voiceNavScrollHandler = scrollHandler;
    window.addEventListener('scroll', scrollHandler, true);
    const autoScrollContainers = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.overflow === 'auto' || style.overflow === 'scroll' ||
        style.overflowY === 'auto' || style.overflowY === 'scroll';
    });
    autoScrollContainers.forEach(container => {
      container.addEventListener('scroll', scrollHandler, { passive: true });
    });
    window.addEventListener('resize', scrollHandler);

    // Mutation observer to auto-refresh numbers when DOM changes
    const mutationObserver = new MutationObserver((mutations) => {
      let shouldRefresh = false;

      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const interactiveSelectors = 'a, button, [role="button"], [onclick], input[type="submit"], input[type="button"], [class*="btn"], select, [role="tab"], [role="menuitem"]';
              if ((node.matches && node.matches(interactiveSelectors)) ||
                (node.querySelector && node.querySelector(interactiveSelectors))) {
                shouldRefresh = true;
                break;
              }
            }
          }
        }

        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (['class', 'style', 'aria-expanded', 'aria-hidden'].includes(mutation.attributeName)) {
            const interactiveSelectors = 'a, button, [role="button"], [onclick], input[type="submit"], input[type="button"], [class*="btn"], select';
            if ((target.matches && target.matches(interactiveSelectors)) ||
              (target.querySelector && target.querySelector(interactiveSelectors))) {
              shouldRefresh = true;
            }
          }
        }
      });

      if (shouldRefresh && !window.voiceNavRefreshPending) {
        window.voiceNavRefreshPending = true;
        setTimeout(() => {
          if (document.querySelector('.voice-nav-container')) {
            document.querySelectorAll('.voice-nav-number').forEach(el => el.remove());
            const currentContainer = document.querySelector('.voice-nav-container');
            if (currentContainer) currentContainer.remove();
            try { addNumbersToElementsAdvanced(); } catch (e) { console.error('Error refreshing numbers:', e); }
          }
          window.voiceNavRefreshPending = false;
        }, 1000);
      }
    });
    window.voiceNavMutationObserver = mutationObserver;
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'hidden']
    });

    return { count: limitedElements.length };
  };

  const removeNumbersAdvanced = () => {
    document.querySelectorAll('.voice-nav-number').forEach(el => el.remove());
    const container = document.querySelector('.voice-nav-container');
    if (container) container.remove();
    if (window.voiceNavScrollHandler) {
      window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
      delete window.voiceNavScrollHandler;
    }
    if (window.voiceNavMutationObserver) {
      window.voiceNavMutationObserver.disconnect();
      delete window.voiceNavMutationObserver;
    }
  };

  // // Helper functions for injection
  // const addNumbersToElements = () => {
  //   const existingNumbers = document.querySelectorAll('.voice-nav-number');
  //   existingNumbers.forEach(el => el.remove());

  //   // Expanded selectors for comprehensive coverage
  //   const selectors = [
  //     // Basic interactive elements
  //     'a', 'button', '[role="button"]', '[onclick]',
  //     'input[type="submit"]', 'input[type="button"]',
  //     '[class*="btn"]', '[class*="button"]',

  //     // YouTube specific selectors
  //     'a[href*="/watch"]', // Video links
  //     'a[href*="/channel/"]', // Channel links
  //     'a[href*="/c/"]', // Channel links (new format)
  //     'a[href*="/@"]', // Handle-based channels
  //     'a[href*="/playlist"]', // Playlist links
  //     '.yt-lockup-view-model__content-image', // Video thumbnails
  //     '.ytd-compact-video-renderer', // Sidebar videos
  //     '.ytd-rich-item-renderer', // Home page videos
  //     '.ytd-video-renderer', // Search results videos

  //     // Common website patterns
  //     '[class*="card"]', '[class*="item"]', '[class*="tile"]',
  //     '[class*="post"]', '[class*="article"]', '[class*="entry"]',
  //     '[class*="link"]', '[class*="nav"]', '[class*="menu"]',
  //     '[class*="tab"]', '[class*="thumb"]', '[class*="preview"]',

  //     // Social media patterns
  //     '[data-testid*="tweet"]', '[data-testid*="post"]',
  //     '[aria-label*="like"]', '[aria-label*="share"]', '[aria-label*="comment"]',

  //     // E-commerce patterns
  //     '[class*="product"]', '[class*="item"]', '[class*="listing"]',
  //     '[class*="add-to-cart"]', '[class*="buy"]', '[class*="purchase"]',

  //     // Generic clickable patterns
  //     '[class*="clickable"]', '[data-href]', '[data-url]',
  //     '[tabindex="0"]', '[tabindex="-1"]', // Focusable elements

  //     // Media controls and interactive elements
  //     '[class*="play"]', '[class*="pause"]', '[class*="video"]',
  //     '[class*="audio"]', '[class*="media"]', '[class*="control"]'
  //   ];

  //   let elements = [];
  //   selectors.forEach(selector => {
  //     try {
  //       const found = document.querySelectorAll(selector);
  //       elements.push(...Array.from(found));
  //     } catch (e) {
  //       // Skip invalid selectors
  //       console.warn('Invalid selector:', selector);
  //     }
  //   });

  //   // Enhanced visibility and interactivity filtering
  //   const visibleElements = elements.filter((el, index, arr) => {
  //     // Remove duplicates
  //     if (arr.indexOf(el) !== index) return false;

  //     // Check basic visibility
  //     const style = window.getComputedStyle(el);
  //     const rect = el.getBoundingClientRect();

  //     if (style.display === 'none' || style.visibility === 'hidden') return false;
  //     if (rect.width < 3 || rect.height < 3) return false;

  //     // Check if element is in viewport (with some buffer)
  //     const viewportBuffer = 100;
  //     if (rect.bottom < -viewportBuffer ||
  //       rect.top > window.innerHeight + viewportBuffer ||
  //       rect.right < 0 ||
  //       rect.left > window.innerWidth) return false;

  //     // Check if element is actually interactive
  //     const isClickable = el.tagName === 'A' ||
  //       el.tagName === 'BUTTON' ||
  //       el.onclick !== null ||
  //       el.hasAttribute('data-href') ||
  //       el.hasAttribute('data-url') ||
  //       el.getAttribute('role') === 'button' ||
  //       el.getAttribute('tabindex') !== null ||
  //       el.className.includes('clickable') ||
  //       el.className.includes('btn') ||
  //       el.className.includes('link') ||
  //       el.className.includes('card') ||
  //       el.className.includes('item') ||
  //       getComputedStyle(el).cursor === 'pointer';

  //     return isClickable;
  //   });

  //   // Sort by position (top to bottom, left to right) for more intuitive numbering
  //   visibleElements.sort((a, b) => {
  //     const rectA = a.getBoundingClientRect();
  //     const rectB = b.getBoundingClientRect();

  //     // If elements are roughly on the same line (within 20px), sort by x position
  //     if (Math.abs(rectA.top - rectB.top) < 20) {
  //       return rectA.left - rectB.left;
  //     }
  //     // Otherwise sort by y position
  //     return rectA.top - rectB.top;
  //   });

  //   // Increase limit to 40 elements
  //   visibleElements.slice(0, 40).forEach((element, index) => {
  //     const number = index + 1;
  //     const numberEl = document.createElement('div');
  //     numberEl.className = 'voice-nav-number';
  //     numberEl.textContent = number;

  //     // Enhanced styling with better visibility
  //     numberEl.style.cssText = `
  //       position: absolute;
  //       width: 22px; height: 22px;
  //       border-radius: 50%;
  //       background: linear-gradient(135deg, #ff4444, #cc0000);
  //       color: white;
  //       display: flex;
  //       align-items: center;
  //       justify-content: center;
  //       font-size: 11px;
  //       font-weight: bold;
  //       font-family: Arial, sans-serif;
  //       border: 2px solid white;
  //       box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  //       z-index: 999999;
  //       pointer-events: none;
  //       text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  //     `;

  //     const rect = element.getBoundingClientRect();

  //     // Better positioning logic
  //     let top = rect.top + window.scrollY - 11;
  //     let left = rect.left + window.scrollX - 11;

  //     // Ensure numbers stay within viewport
  //     if (left < 5) left = 5;
  //     if (top < 5) top = rect.top + window.scrollY + 5;

  //     numberEl.style.top = `${top}px`;
  //     numberEl.style.left = `${left}px`;

  //     document.body.appendChild(numberEl);
  //     element.setAttribute('data-voice-nav-number', number);
  //   });

  //   return { count: Math.min(40, visibleElements.length) };
  // };

  const removeNumbersFromElements = () => {
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

  // Helper function to format time remaining
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Background video source (prefer extension URL if available)
  const videoSrc = (typeof chrome !== 'undefined' && chrome?.runtime?.getURL)
    ? chrome.runtime.getURL('assets/Voice_Listening_Animation_Generation.mp4')
    : 'assets/Voice_Listening_Animation_Generation.mp4';

  return (
    <div className="voice-navigation-chatgpt">
      {/* Background animation video (shown only while listening) */}
      <div className="voice-content">
        {/* Section Title */}

        <div className="voice-button-container">
          <button
            className={`voice-sphere ${isListening ? 'listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
            disabled={error === 'Microphone permission denied'}
          >
            {!isListening ? (
              /* Simple Microphone Button */
              <div className="mic-button-container">
                <FontAwesomeIcon icon={faMicrophone} className="mic-button-icon" />
              </div>
            ) : (
              /* Celestial Orb Animation */
              <div className="sphere-container">
                <div className="celestial-orb-container">
                  {/* Enhanced celestrial rings with Dynamic Rotations */}
                  <div className="celestial-ring ring-1"
                    style={{
                      width: '120px',
                      height: '120px',
                      transform: 'translate(-50%, -50%) rotateX(70deg)',
                      opacity: 0.8 + voiceLevel * 0.4,
                      boxShadow: `0 0 ${10 + voiceLevel * 20}px rgba(124, 58, 237, ${0.3 + voiceLevel * 0.3})`
                    }}>
                    <div className="ring-particles">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="ring-particle"
                          style={{ '--delay': `${i * 0.25}s`, '--angle': `${i * 45}deg` }} />
                      ))}
                    </div>
                  </div>

                  <div className="celestial-ring ring-2"
                    style={{
                      width: '100px',
                      height: '100px',
                      transform: 'translate(-50%, -50%) rotateX(70deg) rotateY(60deg)',
                      opacity: 0.6 + voiceLevel * 0.4,
                      filter: `blur(${Math.max(0, 1 - voiceLevel * 2)}px)`
                    }}>
                    <div className="ring-glow"></div>
                  </div>

                  <div className="celestial-ring ring-3"
                    style={{
                      width: '140px',
                      height: '140px',
                      transform: 'translate(-50%, -50%) rotateX(70deg) rotateY(120deg)',
                      opacity: 0.7 + voiceLevel * 0.3
                    }}>
                    <div className="particle-orbit advanced-orbit">
                      <div className="orbit-trail"></div>
                    </div>
                  </div>

                  {/* Additional Dynamic Rings */}
                  <div className="celestial-ring ring-4"
                    style={{
                      width: '80px',
                      height: '80px',
                      transform: 'translate(-50%, -50%) rotateX(70deg) rotateY(-45deg)',
                      opacity: 0.5 + voiceLevel * 0.5
                    }}>
                  </div>
                  {/* Enhanced Central Orb */}
                  <div className="sphere-core" style={{
                    transform: `translate(-50%, -50%) scale(${1 + voiceLevel * 0.4})`,
                    filter: `brightness(${1 + voiceLevel * 0.5}) saturate(${1 + voiceLevel * 0.3})`,
                    animationDuration: `${Math.max(1.5, 4 - voiceLevel * 2.5)}s`,
                    boxShadow: `
                      inset 0 0 20px rgba(255, 255, 255, 0.2),
                      0 0 ${30 + voiceLevel * 40}px ${5 + voiceLevel * 15}px rgba(124, 58, 237, ${0.4 + voiceLevel * 0.4}),
                      0 0 ${15 + voiceLevel * 20}px ${2 + voiceLevel * 8}px rgba(255, 255, 255, ${0.1 + voiceLevel * 0.3})
                    `
                  }}>
                    {/* Voice-reactive surface patterns */}
                    {voiceLevel > 0.2 && (
                      <div className="voice-surface-effects">
                        {Array.from({ length: 12 }, (_, i) => (
                          <div
                            key={i}
                            className="surface-ripple"
                            style={{
                              '--angle': `${i * 30}deg`,
                              '--intensity': voiceLevel,
                              '--delay': `${i * 0.08}s`
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* Enhanced Energy Wave Effects */}
                {showEnergyWave && (
                  <div className="energy-wave-container">
                    <div className="energy-wave energy-wave-1">
                      <div className="wave-inner"></div>
                    </div>
                    <div className="energy-wave energy-wave-2">
                      <div className="wave-inner"></div>
                    </div>
                    <div className="energy-wave energy-wave-3">
                      <div className="wave-inner"></div>
                    </div>
                    {/* Additional wave patterns */}
                    <div className="energy-wave energy-wave-hex">
                      <div className="hex-pattern"></div>
                    </div>
                    <div className="energy-wave energy-wave-spiral">
                      <div className="spiral-pattern"></div>
                    </div>
                  </div>
                )}

                {/* Continuous subtle waves when listening */}
                {isListening && (
                  <div className="continuous-waves">
                    <div className="wave-ring wave-ring-1"></div>
                    <div className="wave-ring wave-ring-2"></div>
                    <div className="wave-ring wave-ring-3"></div>
                  </div>
                )}
                <div className="particle-field">
                  {/* Enhanced Particle System with Multiple Types */}
                  {Array.from({ length: 20 }, (_, i) => {
                    const particleType = i % 4;
                    const intensity = 0.5 + voiceLevel * 1.5;
                    return (
                      <div
                        key={i}
                        className={`particle particle-type-${particleType}`}
                        style={{
                          '--delay': `${i * 0.15}s`,
                          '--duration': `${1.5 + Math.random() * 2}s`,
                          '--intensity': intensity,
                          '--start-x': `${Math.random() * 100}%`,
                          '--end-x': `${Math.random() * 100}%`,
                          '--size': `${2 + voiceLevel * 3 + Math.random() * 2}px`,
                          '--opacity': Math.max(0.3, voiceLevel + 0.2)
                        }}
                      />
                    );
                  })}

                  {/* Spiral Particles */}
                  {Array.from({ length: 6 }, (_, i) => (
                    <div
                      key={`spiral-${i}`}
                      className="spiral-particle"
                      style={{
                        '--angle': `${i * 60}deg`,
                        '--radius': `${45 + voiceLevel * 20}px`,
                        '--speed': `${3 + voiceLevel * 2}s`,
                        '--delay': `${i * 0.5}s`
                      }}
                    />
                  ))}

                  {/* Voice-Reactive Burst Particles */}
                  {voiceLevel > 0.3 && Array.from({ length: 8 }, (_, i) => (
                    <div
                      key={`burst-${i}`}
                      className="burst-particle"
                      style={{
                        '--burst-angle': `${i * 45}deg`,
                        '--burst-distance': `${40 + voiceLevel * 40}px`,
                        '--burst-delay': `${i * 0.1}s`
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </button>

          {/* Input volume meter (uses waveformData) */}
          {isListening && (
            <div className="mic-level-meter" title="Input level">
              {waveformData.map((v, i) => (
                <div
                  key={i}
                  className="mic-level-bar"
                  style={{ height: `${8 + v * 24}px`, opacity: 0.6 + v * 0.4 }}
                />
              ))}
            </div>
          )}


        </div>


        {/* Minimal Status Display */}
        {feedback && (
          <div className="status-display">
            <div className="status-message feedback">
              <span>{feedback}</span>
            </div>
          </div>
        )}
      </div>

      <VoiceNavigationHelp />

    </div>
  );
};

export default VoiceNavigationChatGPT;