import { faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import React, { useEffect, useRef, useState } from 'react';
import { VoiceCommandProcessor } from '../../services/voiceCommandProcessor.js';
import { fuzzySearch } from '../../utils/searchUtils.js';
import RandomVoiceCommandTip from './RandomVoiceCommandTip.jsx';
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
    // Don't auto-reconnect if user intentionally stopped
    if (userIntentStoppedRef.current) {
      console.log('[Reconnect] Cancelled: User intentionally stopped voice navigation');
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      return;
    }

    // Limit reconnection attempts
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[Reconnect] Max attempts reached, stopping auto-reconnect');
      setError('Voice recognition disconnected. Click microphone to restart.');
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      stopAudioAnalysis();
      return;
    }

    if (!connectionExpired && annyang && !isListening) {
      isReconnectingRef.current = true;
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
          annyang.start({ autoRestart: true, continuous: true });
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
            isReconnectingRef.current = false;
            setTimeout(attemptReconnect, delay);
          } else {
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
          setTranscript(command);
          setInterimTranscript('');
          // Feedback is set by the command action
        }
      });

      annyang.addCallback('resultNoMatch', (phrases) => {
        if (phrases.length > 0) {
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
          console.log('[VoiceNav] No speech detected; keeping audio active and attempting gentle reconnect');
          // Avoid stopping audio analysis; schedule a reconnect if session is active
          if (!connectionExpired) {
            setTimeout(() => {
              if (!userIntentStoppedRef.current && !isListening) {
                attemptReconnect();
              }
            }, 800);
          }
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
        setIsListening(true);
        setError('');
        setFeedback('Listening...');
        startAudioAnalysis();
      });

      annyang.addCallback('end', () => {
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
            attemptReconnect();
          } else if (userIntentStoppedRef.current) {
            console.log('[VoiceNav] Ended by user intent, stopping audio analysis');
            stopAudioAnalysis();
          } else {
            console.log('[VoiceNav] Session expired, stopping audio analysis');
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        setError('Microphone permission denied');
      } else if (retryCount < 2) {
        setTimeout(() => startAudioAnalysis(retryCount + 1), 1000);
      }
    }
  };

  const stopAudioAnalysis = async () => {
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

  const startListening = () => {
    // Reset user intent flag when user starts listening
    userIntentStoppedRef.current = false;

    // Clear any previous errors
    setError('');

    if (connectionExpired) {
      // Restart the session
      startSession();
    }

    if (annyang && !isListening) {
      try {
        annyang.start({ autoRestart: true, continuous: true });

        // Start session management if not already started
        if (!sessionStartTimeRef.current) {
          startSession();
        }
      } catch (error) {
        console.error('Failed to start voice recognition:', error);
        setError('Failed to start voice recognition');
        setIsListening(false);
      }
    }
  };

  const stopListening = () => {
    console.log('[VoiceNav] stopListening called');
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

    // Clear reconnection attempts
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const showElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: addNumbersToElements
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
        func: removeNumbersFromElements
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

  // Helper functions for injection
  const addNumbersToElements = () => {
    const existingNumbers = document.querySelectorAll('.voice-nav-number');
    existingNumbers.forEach(el => el.remove());

    // Expanded selectors for comprehensive coverage
    const selectors = [
      // Basic interactive elements
      'a', 'button', '[role="button"]', '[onclick]',
      'input[type="submit"]', 'input[type="button"]',
      '[class*="btn"]', '[class*="button"]',

      // YouTube specific selectors
      'a[href*="/watch"]', // Video links
      'a[href*="/channel/"]', // Channel links
      'a[href*="/c/"]', // Channel links (new format)
      'a[href*="/@"]', // Handle-based channels
      'a[href*="/playlist"]', // Playlist links
      '.yt-lockup-view-model__content-image', // Video thumbnails
      '.ytd-compact-video-renderer', // Sidebar videos
      '.ytd-rich-item-renderer', // Home page videos
      '.ytd-video-renderer', // Search results videos

      // Common website patterns
      '[class*="card"]', '[class*="item"]', '[class*="tile"]',
      '[class*="post"]', '[class*="article"]', '[class*="entry"]',
      '[class*="link"]', '[class*="nav"]', '[class*="menu"]',
      '[class*="tab"]', '[class*="thumb"]', '[class*="preview"]',

      // Social media patterns
      '[data-testid*="tweet"]', '[data-testid*="post"]',
      '[aria-label*="like"]', '[aria-label*="share"]', '[aria-label*="comment"]',

      // E-commerce patterns
      '[class*="product"]', '[class*="item"]', '[class*="listing"]',
      '[class*="add-to-cart"]', '[class*="buy"]', '[class*="purchase"]',

      // Generic clickable patterns
      '[class*="clickable"]', '[data-href]', '[data-url]',
      '[tabindex="0"]', '[tabindex="-1"]', // Focusable elements

      // Media controls and interactive elements
      '[class*="play"]', '[class*="pause"]', '[class*="video"]',
      '[class*="audio"]', '[class*="media"]', '[class*="control"]'
    ];

    let elements = [];
    selectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Skip invalid selectors
        console.warn('Invalid selector:', selector);
      }
    });

    // Enhanced visibility and interactivity filtering
    const visibleElements = elements.filter((el, index, arr) => {
      // Remove duplicates
      if (arr.indexOf(el) !== index) return false;

      // Check basic visibility
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (rect.width < 3 || rect.height < 3) return false;

      // Check if element is in viewport (with some buffer)
      const viewportBuffer = 100;
      if (rect.bottom < -viewportBuffer ||
        rect.top > window.innerHeight + viewportBuffer ||
        rect.right < 0 ||
        rect.left > window.innerWidth) return false;

      // Check if element is actually interactive
      const isClickable = el.tagName === 'A' ||
        el.tagName === 'BUTTON' ||
        el.onclick !== null ||
        el.hasAttribute('data-href') ||
        el.hasAttribute('data-url') ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('tabindex') !== null ||
        el.className.includes('clickable') ||
        el.className.includes('btn') ||
        el.className.includes('link') ||
        el.className.includes('card') ||
        el.className.includes('item') ||
        getComputedStyle(el).cursor === 'pointer';

      return isClickable;
    });

    // Sort by position (top to bottom, left to right) for more intuitive numbering
    visibleElements.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();

      // If elements are roughly on the same line (within 20px), sort by x position
      if (Math.abs(rectA.top - rectB.top) < 20) {
        return rectA.left - rectB.left;
      }
      // Otherwise sort by y position
      return rectA.top - rectB.top;
    });

    // Increase limit to 40 elements
    visibleElements.slice(0, 40).forEach((element, index) => {
      const number = index + 1;
      const numberEl = document.createElement('div');
      numberEl.className = 'voice-nav-number';
      numberEl.textContent = number;

      // Enhanced styling with better visibility
      numberEl.style.cssText = `
        position: absolute;
        width: 22px; height: 22px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ff4444, #cc0000);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
        font-family: Arial, sans-serif;
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        z-index: 999999;
        pointer-events: none;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
      `;

      const rect = element.getBoundingClientRect();

      // Better positioning logic
      let top = rect.top + window.scrollY - 11;
      let left = rect.left + window.scrollX - 11;

      // Ensure numbers stay within viewport
      if (left < 5) left = 5;
      if (top < 5) top = rect.top + window.scrollY + 5;

      numberEl.style.top = `${top}px`;
      numberEl.style.left = `${left}px`;

      document.body.appendChild(numberEl);
      element.setAttribute('data-voice-nav-number', number);
    });

    return { count: Math.min(40, visibleElements.length) };
  };

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

  return (
    <div className="voice-navigation-chatgpt">
      <div className="voice-content">
        {/* Section Title */}

        <div className="voice-button-container">
          <button
            className={`voice-sphere ${isListening ? 'listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
            disabled={!!error}
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
                  {/* Enhanced Celestial Rings with Dynamic Rotations */}
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

          <div className="button-label">
            {isListening ? 'Listening...' : connectionExpired ? 'Session Expired - Click to Reconnect' : 'Voice Navigation'}
          </div>

          {/* Session Timer */}
          {(isListening || connectionExpired) && (
            <div className="session-timer" style={{
              fontSize: '12px',
              color: connectionExpired ? '#ff4444' : timeRemaining < 60 ? '#ff6666' : '#888',
              marginTop: '4px',
              textAlign: 'center'
            }}>
              {connectionExpired
                ? '⚠️ Session Expired'
                : `⏱️ ${formatTime(timeRemaining)} remaining`
              }
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

      <div style={{ marginTop: 6 }}>
        <RandomVoiceCommandTip />
      </div>

      {/* Command Help Sidebar */}
      {showHelp && (
        <VoiceNavigationHelp />
      )}

      <style jsx>{`
        .voice-navigation-chatgpt {
          display: flex;
          gap: 16px;
          padding: 16px;
          background: var(--glass-bg);
          backdrop-filter: var(--glass-backdrop);
          border-radius: 12px;
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-md);
          margin: 12px 0;
          transition: all 0.3s ease;
        }

        .voice-navigation-chatgpt:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
          box-shadow: var(--shadow-lg);
        }

        .voice-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          min-width: 200px;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-secondary);
          width: 100%;
          justify-content: center;
          position: relative;
        }

        .section-icon {
          font-size: var(--font-size-xl);
          color: var(--accent-primary);
        }

        .section-title {
          font-size: var(--font-size-xl);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .voice-button-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .voice-sphere {
          width: 65px;
          height: 65px;
          border: none;
          background: transparent;
          cursor: pointer;
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transform-style: preserve-3d;
          perspective: 1000px;
        }

        .voice-sphere:not(.listening) {
          animation: idleFloat 6s ease-in-out infinite;
        }

        .voice-sphere.listening {
          animation: listeningPulse 2s ease-in-out infinite;
        }

        @keyframes idleFloat {
          0%, 100% {
            transform: translateY(0px) rotateX(0deg);
          }
          50% {
            transform: translateY(-3px) rotateX(2deg);
          }
        }

        @keyframes listeningPulse {
          0%, 100% {
            transform: scale(1) rotateX(0deg);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.02) rotateX(1deg);
            filter: brightness(1.1);
          }
        }

        .voice-sphere:hover:not(:disabled) {
          transform: translateY(-3px);
        }

        .voice-sphere:active:not(:disabled) {
          transform: translateY(0);
        }

        .voice-sphere:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .mic-button-container {
          width: 45px;
          height: 45px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #ec4899, #7c3aed, #2563eb);
          box-shadow:
            inset 0 0 20px rgba(255, 255, 255, 0.2),
            0 0 30px 5px rgba(124, 58, 237, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
          transform-style: preserve-3d;
        }

        .mic-button-container::before {
          content: '';
          position: absolute;
          top: 5%;
          left: 10%;
          width: 80%;
          height: 80%;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 60%);
          border-radius: 50%;
        }

        .mic-button-container::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          box-shadow: inset -15px -8px 30px rgba(0, 0, 0, 0.4);
        }

        .mic-button-icon {
        
          color: rgba(255, 255, 255, 0.9);
          text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
          z-index: 2;
          position: relative;
        }

        .voice-sphere:hover .mic-button-container {
          transform: scale(1.05);
          box-shadow:
            inset 0 0 20px rgba(255, 255, 255, 0.3),
            0 0 40px 8px rgba(124, 58, 237, 0.6);
        }

        .sphere-container {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          transform-style: preserve-3d;
          perspective: 800px;
        }

        .celestial-orb-container {
          transform-style: preserve-3d;
          perspective: 800px;
          animation: container-wobble 20s infinite ease-in-out alternate;
          position: absolute;
          width: 100%;
          height: 100%;
        }

        @keyframes container-wobble {
          from {
            transform: rotateY(-20deg) rotateX(10deg);
          }
          to {
            transform: rotateY(20deg) rotateX(-10deg);
          }
        }

        .sphere-core {
          position: absolute;
          width: 30px;
          height: 30px;
          top: 50%;
          left: 50%;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #ec4899, #7c3aed, #2563eb);
          box-shadow:
            inset 0 0 20px rgba(255, 255, 255, 0.2),
            0 0 50px 10px rgba(124, 58, 237, 0.4);
          transition: all 0.3s ease;
          overflow: hidden;
          transform-style: preserve-3d;
          animation: orbBreathing 4s ease-in-out infinite;
        }

        @keyframes orbBreathing {
          0%, 100% {
            transform: translate(-50%, -50%) scale(1);
            box-shadow:
              inset 0 0 20px rgba(255, 255, 255, 0.2),
              0 0 50px 10px rgba(124, 58, 237, 0.4);
          }
          50% {
            transform: translate(-50%, -50%) scale(1.05);
            box-shadow:
              inset 0 0 25px rgba(255, 255, 255, 0.3),
              0 0 60px 15px rgba(124, 58, 237, 0.6);
          }
        }

        .voice-sphere.listening .sphere-core {
          background: radial-gradient(circle at 30% 30%, #ff4444, #cc2200, #660000);
          box-shadow:
            inset 0 0 20px rgba(255, 255, 255, 0.2),
            0 0 50px 10px rgba(255, 68, 68, 0.6);
        }

        .sphere-core::before {
          content: '';
          position: absolute;
          top: 5%;
          left: 10%;
          width: 80%;
          height: 80%;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 60%);
          border-radius: 50%;
        }

        .sphere-core::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          box-shadow: inset -20px -10px 40px rgba(0, 0, 0, 0.5);
        }

        .celestial-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          transform-style: preserve-3d;
          transform-origin: center center;
          transition: all 0.3s ease;
        }

        .voice-sphere.listening .celestial-ring {
          border-color: rgba(255, 68, 68, 0.4);
          box-shadow: 0 0 10px rgba(255, 68, 68, 0.3);
        }

        /* Enhanced Ring Animations */
        .ring-1 {
          animation: ring1Rotate 20s linear infinite, ring1Wobble 8s ease-in-out infinite alternate;
        }

        .ring-2 {
          animation: ring2Rotate 15s linear infinite reverse, ring2Pulse 6s ease-in-out infinite;
        }

        .ring-3 {
          animation: ring3Rotate 25s linear infinite, ring3Tilt 10s ease-in-out infinite alternate;
        }

        .ring-4 {
          animation: ring4Rotate 18s linear infinite reverse, ring4Spin 12s ease-in-out infinite;
        }

        @keyframes ring1Rotate {
          from { transform: translate(-50%, -50%) rotateX(70deg) rotateZ(0deg); }
          to { transform: translate(-50%, -50%) rotateX(70deg) rotateZ(360deg); }
        }

        @keyframes ring1Wobble {
          0%, 100% { transform: translate(-50%, -50%) rotateX(70deg) rotateY(0deg); }
          50% { transform: translate(-50%, -50%) rotateX(70deg) rotateY(20deg); }
        }

        @keyframes ring2Rotate {
          from { transform: translate(-50%, -50%) rotateX(70deg) rotateY(60deg) rotateZ(0deg); }
          to { transform: translate(-50%, -50%) rotateX(70deg) rotateY(60deg) rotateZ(-360deg); }
        }

        @keyframes ring2Pulse {
          0%, 100% { opacity: 0.6; border-width: 1px; }
          50% { opacity: 1; border-width: 2px; }
        }

        @keyframes ring3Rotate {
          from { transform: translate(-50%, -50%) rotateX(70deg) rotateY(120deg) rotateZ(0deg); }
          to { transform: translate(-50%, -50%) rotateX(70deg) rotateY(120deg) rotateZ(360deg); }
        }

        @keyframes ring3Tilt {
          0%, 100% { transform: translate(-50%, -50%) rotateX(70deg) rotateY(120deg); }
          50% { transform: translate(-50%, -50%) rotateX(85deg) rotateY(120deg); }
        }

        @keyframes ring4Rotate {
          from { transform: translate(-50%, -50%) rotateX(70deg) rotateY(-45deg) rotateZ(0deg); }
          to { transform: translate(-50%, -50%) rotateX(70deg) rotateY(-45deg) rotateZ(-360deg); }
        }

        @keyframes ring4Spin {
          0%, 100% { transform: translate(-50%, -50%) rotateX(70deg) rotateY(-45deg); }
          50% { transform: translate(-50%, -50%) rotateX(55deg) rotateY(-45deg); }
        }

        /* Ring Particles */
        .ring-particles {
          position: relative;
          width: 100%;
          height: 100%;
        }

        .ring-particle {
          position: absolute;
          width: 3px;
          height: 3px;
          background: rgba(124, 58, 237, 0.8);
          border-radius: 50%;
          box-shadow: 0 0 6px rgba(124, 58, 237, 0.6);
          animation: ringParticleOrbit 4s linear infinite;
          transform-origin: 110px 110px;
          left: 50%;
          top: 0;
          margin-left: -1.5px;
          animation-delay: var(--delay);
        }

        @keyframes ringParticleOrbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .ring-glow {
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border-radius: 50%;
          background: radial-gradient(circle, transparent 60%, rgba(124, 58, 237, 0.2) 80%, transparent 100%);
          animation: ringGlowPulse 3s ease-in-out infinite;
        }

        @keyframes ringGlowPulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }

        .particle-orbit {
          position: absolute;
          width: 100%;
          height: 100%;
          animation: particle-spin 10s infinite linear;
          transform-style: preserve-3d;
        }

        @keyframes particle-spin {
          from {
            transform: rotateZ(0deg);
          }
          to {
            transform: rotateZ(360deg);
          }
        }

        .particle-orbit::after {
          content: '';
          position: absolute;
          top: -2px;
          left: 50%;
          width: 4px;
          height: 4px;
          background: #fff;
          border-radius: 50%;
          box-shadow: 0 0 5px #fff;
          transform: translateX(-50%);
        }

        .energy-wave-container {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 1;
        }

        .energy-wave {
          position: absolute;
          top: 50%;
          left: 50%;
          border: 2px solid rgba(52, 199, 89, 0.8);
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: energyWaveExpand 1s ease-out forwards;
        }

        .energy-wave-1 {
          animation-delay: 0s;
        }

        .energy-wave-2 {
          animation-delay: 0.2s;
        }

        .energy-wave-3 {
          animation-delay: 0.4s;
        }

        @keyframes energyWaveExpand {
          0% {
            width: 80px;
            height: 80px;
            opacity: 1;
            border-width: 3px;
          }
          100% {
            width: 200px;
            height: 200px;
            opacity: 0;
            border-width: 1px;
          }
        }

        /* Enhanced Wave Effects */
        .wave-inner {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 60%;
          height: 60%;
          border: 1px solid rgba(52, 199, 89, 0.4);
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: waveInnerPulse 1s ease-out forwards;
        }

        @keyframes waveInnerPulse {
          0% {
            width: 60%;
            height: 60%;
            opacity: 0.8;
          }
          100% {
            width: 90%;
            height: 90%;
            opacity: 0;
          }
        }

        .energy-wave-hex {
          clip-path: polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%);
          border: none;
          background: linear-gradient(45deg, transparent, rgba(52, 199, 89, 0.3), transparent);
        }

        .hex-pattern {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 80%;
          height: 80%;
          transform: translate(-50%, -50%);
          clip-path: polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%);
          background: rgba(52, 199, 89, 0.2);
          animation: hexRotate 1s ease-out forwards;
        }

        @keyframes hexRotate {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) rotate(360deg) scale(2);
            opacity: 0;
          }
        }

        .energy-wave-spiral {
          border: none;
          background: conic-gradient(from 0deg, transparent, rgba(52, 199, 89, 0.6), transparent, rgba(52, 199, 89, 0.4), transparent);
          border-radius: 50%;
        }

        .spiral-pattern {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 90%;
          height: 90%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: conic-gradient(from 90deg, transparent, rgba(52, 199, 89, 0.3), transparent);
          animation: spiralSpin 1s ease-out forwards;
        }

        @keyframes spiralSpin {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) scale(0.3);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) rotate(720deg) scale(1.5);
            opacity: 0;
          }
        }

        /* Continuous Wave Rings */
        .continuous-waves {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 0;
        }

        .wave-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          border: 1px solid rgba(255, 68, 68, 0.2);
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: continuousWave 3s ease-in-out infinite;
        }

        .wave-ring-1 {
          width: 100px;
          height: 100px;
          animation-delay: 0s;
        }

        .wave-ring-2 {
          width: 140px;
          height: 140px;
          animation-delay: 1s;
        }

        .wave-ring-3 {
          width: 180px;
          height: 180px;
          animation-delay: 2s;
        }

        @keyframes continuousWave {
          0%, 100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.8);
          }
          50% {
            opacity: 0.4;
            transform: translate(-50%, -50%) scale(1.2);
          }
        }

        /* Voice-Reactive Surface Effects */
        .voice-surface-effects {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          overflow: hidden;
          pointer-events: none;
        }

        .surface-ripple {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.2) 50%, transparent 100%);
          border-radius: 50%;
          transform-origin: 0 0;
          animation: surfaceRipple calc(0.5s + var(--intensity, 0.5) * 1s) ease-out infinite;
          animation-delay: var(--delay, 0s);
          opacity: var(--intensity, 0.5);
        }

        @keyframes surfaceRipple {
          0% {
            transform: translate(-50%, -50%)
                      rotate(var(--angle, 0deg))
                      translateX(10px)
                      scale(0);
            opacity: 1;
          }
          50% {
            transform: translate(-50%, -50%)
                      rotate(var(--angle, 0deg))
                      translateX(25px)
                      scale(1.5);
            opacity: 0.8;
          }
          100% {
            transform: translate(-50%, -50%)
                      rotate(var(--angle, 0deg))
                      translateX(35px)
                      scale(0);
            opacity: 0;
          }
        }

        /* Enhanced State Transitions */
        .celestial-orb-container {
          transform-style: preserve-3d;
          perspective: 800px;
          animation: container-wobble 20s infinite ease-in-out alternate;
          position: absolute;
          width: 100%;
          height: 100%;
          transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .voice-sphere:not(.listening) .celestial-orb-container {
          filter: brightness(0.8) saturate(0.7);
          transform: scale(0.95);
        }

        .voice-sphere.listening .celestial-orb-container {
          filter: brightness(1.2) saturate(1.3);
          transform: scale(1);
        }

        /* Advanced Orbit Trail */
        .advanced-orbit {
          overflow: visible;
        }

        .orbit-trail {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            transparent 0%,
            rgba(255, 255, 255, 0.1) 10%,
            rgba(124, 58, 237, 0.3) 20%,
            transparent 30%,
            transparent 70%,
            rgba(124, 58, 237, 0.2) 80%,
            rgba(255, 255, 255, 0.1) 90%,
            transparent 100%
          );
          animation: orbitTrailRotate 8s linear infinite;
        }

        @keyframes orbitTrailRotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .sphere-grid {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: repeat(5, 1fr);
          gap: 2px;
          padding: 8px;
          z-index: 2;
        }

        .grid-dot {
          width: 3px;
          height: 3px;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 50%;
          animation: pixelPulse 2s ease-in-out infinite;
          box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
        }

        @keyframes pixelPulse {
          0%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }

        .sphere-glow {
          position: absolute;
          top: -10px;
          left: -10px;
          width: calc(100% + 20px);
          height: calc(100% + 20px);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(0, 191, 255, 0.3), transparent 70%);
          animation: sphereGlow 3s ease-in-out infinite;
          z-index: 1;
        }

        .voice-sphere.listening .sphere-glow {
          background: radial-gradient(circle, rgba(255, 68, 68, 0.4), transparent 70%);
        }

        @keyframes sphereGlow {
          0%, 100% {
            transform: scale(0.9);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }

        .particle-field {
          position: absolute;
          width: 140px;
          height: 140px;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 0;
        }

        .particle {
          position: absolute;
          width: var(--size, 2px);
          height: var(--size, 2px);
          background: rgba(0, 191, 255, var(--opacity, 0.8));
          border-radius: 50%;
          animation: particleFloat var(--duration, 3s) linear infinite;
          animation-delay: var(--delay, 0s);
          box-shadow: 0 0 6px rgba(0, 191, 255, 0.6);
          left: var(--start-x, 50%);
        }

        .voice-sphere.listening .particle {
          background: rgba(255, 68, 68, var(--opacity, 0.8));
          box-shadow: 0 0 6px rgba(255, 68, 68, 0.6);
        }

        /* Different particle types */
        .particle-type-0 {
          background: radial-gradient(circle, rgba(0, 191, 255, var(--opacity, 0.8)) 0%, transparent 70%);
          animation-name: particleFloat;
        }

        .particle-type-1 {
          background: radial-gradient(circle, rgba(124, 58, 237, var(--opacity, 0.8)) 0%, transparent 70%);
          animation-name: particleFloatSlow;
          width: calc(var(--size, 2px) * 0.8);
          height: calc(var(--size, 2px) * 0.8);
        }

        .particle-type-2 {
          background: radial-gradient(circle, rgba(236, 72, 153, var(--opacity, 0.8)) 0%, transparent 70%);
          animation-name: particleFloatFast;
          border-radius: 0;
          transform: rotate(45deg);
        }

        .particle-type-3 {
          background: linear-gradient(45deg, rgba(52, 199, 89, var(--opacity, 0.8)), rgba(0, 191, 255, var(--opacity, 0.8)));
          animation-name: particleFloatSpiral;
          width: calc(var(--size, 2px) * 1.2);
          height: calc(var(--size, 2px) * 1.2);
        }

        /* Spiral Particles */
        .spiral-particle {
          position: absolute;
          width: 4px;
          height: 4px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(124, 58, 237, 0.8) 50%, transparent 100%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform-origin: 0 0;
          animation: spiralOrbit var(--speed, 3s) linear infinite;
          animation-delay: var(--delay, 0s);
          box-shadow: 0 0 8px rgba(124, 58, 237, 0.6);
        }

        @keyframes spiralOrbit {
          0% {
            transform: translate(-50%, -50%)
                      rotate(0deg)
                      translateX(var(--radius, 60px))
                      rotate(0deg);
            opacity: 1;
          }
          50% {
            opacity: 0.8;
          }
          100% {
            transform: translate(-50%, -50%)
                      rotate(360deg)
                      translateX(var(--radius, 60px))
                      rotate(-360deg);
            opacity: 1;
          }
        }

        /* Burst Particles */
        .burst-particle {
          position: absolute;
          width: 3px;
          height: 3px;
          background: radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(255, 68, 68, 0.9) 40%, transparent 70%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          animation: burstExpand 0.8s ease-out forwards;
          animation-delay: var(--burst-delay, 0s);
          transform-origin: center;
          opacity: 0;
          box-shadow: 0 0 10px rgba(255, 68, 68, 0.8);
        }

        @keyframes burstExpand {
          0% {
            transform: translate(-50%, -50%) rotate(var(--burst-angle, 0deg)) translateX(0) scale(0);
            opacity: 1;
          }
          50% {
            opacity: 0.8;
            transform: translate(-50%, -50%) rotate(var(--burst-angle, 0deg)) translateX(calc(var(--burst-distance, 40px) * 0.7)) scale(1.2);
          }
          100% {
            transform: translate(-50%, -50%) rotate(var(--burst-angle, 0deg)) translateX(var(--burst-distance, 40px)) scale(0);
            opacity: 0;
          }
        }

        @keyframes particleFloat {
          0% {
            transform: translateY(75px) translateX(0) scale(0);
            opacity: 0;
          }
          10% {
            opacity: 1;
            transform: translateY(60px) translateX(5px) scale(1);
          }
          90% {
            opacity: 1;
            transform: translateY(-60px) translateX(-10px) scale(1);
          }
          100% {
            transform: translateY(-75px) translateX(-15px) scale(0);
            opacity: 0;
          }
        }

        @keyframes particleFloatSlow {
          0% {
            transform: translateY(85px) translateX(var(--start-x, 0)) scale(0) rotate(0deg);
            opacity: 0;
          }
          15% {
            opacity: var(--opacity, 0.8);
            transform: translateY(70px) translateX(calc(var(--start-x, 0) + 10px)) scale(1) rotate(90deg);
          }
          85% {
            opacity: var(--opacity, 0.8);
            transform: translateY(-70px) translateX(var(--end-x, -20px)) scale(1) rotate(270deg);
          }
          100% {
            transform: translateY(-85px) translateX(calc(var(--end-x, -20px) - 10px)) scale(0) rotate(360deg);
            opacity: 0;
          }
        }

        @keyframes particleFloatFast {
          0% {
            transform: translateY(60px) translateX(var(--start-x, 10px)) scale(0);
            opacity: 0;
          }
          5% {
            opacity: var(--opacity, 0.9);
            transform: translateY(50px) translateX(calc(var(--start-x, 10px) + 3px)) scale(1.2);
          }
          95% {
            opacity: var(--opacity, 0.9);
            transform: translateY(-50px) translateX(var(--end-x, -5px)) scale(1.2);
          }
          100% {
            transform: translateY(-60px) translateX(calc(var(--end-x, -5px) - 3px)) scale(0);
            opacity: 0;
          }
        }

        @keyframes particleFloatSpiral {
          0% {
            transform: translateY(80px) translateX(0) scale(0) rotate(0deg);
            opacity: 0;
          }
          20% {
            opacity: var(--opacity, 0.7);
            transform: translateY(60px) translateX(15px) scale(1) rotate(72deg);
          }
          40% {
            transform: translateY(20px) translateX(-10px) scale(1.1) rotate(144deg);
          }
          60% {
            transform: translateY(-20px) translateX(20px) scale(1) rotate(216deg);
          }
          80% {
            opacity: var(--opacity, 0.7);
            transform: translateY(-60px) translateX(-15px) scale(1) rotate(288deg);
          }
          100% {
            transform: translateY(-80px) translateX(0) scale(0) rotate(360deg);
            opacity: 0;
          }
        }

        .particle:nth-child(odd) {
          left: 45%;
          animation-direction: reverse;
        }

        .particle:nth-child(even) {
          right: 45%;
        }

        .particle:nth-child(3n) {
          left: 50%;
          animation-duration: 3s;
        }

        .orbital-actions {
          position: absolute;
          width: 200px;
          height: 200px;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 4;
        }

        .orbital-btn {
          position: absolute;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(10px);
          color: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          pointer-events: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow:
            0 4px 15px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
          animation: orbitalEntrance 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          transform-origin: center;
          opacity: 0;
          scale: 0;
        }

        .orbital-btn:hover {
          background: rgba(255, 255, 255, 0.25);
          transform: scale(1.1);
          box-shadow:
            0 6px 20px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            0 0 15px rgba(255, 255, 255, 0.3);
        }

        .orbital-btn:active {
          transform: scale(0.95);
        }

        @keyframes orbitalEntrance {
          0% {
            opacity: 0;
            scale: 0;
            transform: rotate(-180deg);
          }
          60% {
            opacity: 1;
            scale: 1.2;
          }
          100% {
            opacity: 1;
            scale: 1;
            transform: rotate(0deg);
          }
        }

        /* Position orbital buttons in circle */
        .orbital-btn-1 {
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          animation-delay: 0.1s;
        }

        .orbital-btn-2 {
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          animation-delay: 0.2s;
        }

        .orbital-btn-3 {
          top: 50%;
          right: 10px;
          transform: translateY(-50%);
          animation-delay: 0.3s;
        }

        .orbital-btn-4 {
          top: 50%;
          left: 10px;
          transform: translateY(-50%);
          animation-delay: 0.4s;
        }

        .orbital-btn-5 {
          top: 30px;
          right: 30px;
          animation-delay: 0.5s;
        }

        .orbital-btn-6 {
          bottom: 30px;
          left: 30px;
          animation-delay: 0.6s;
        }

        .voice-shortcuts-overlay {
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(15px);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 12px;
          min-width: 280px;
          box-shadow:
            0 8px 25px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          animation: shortcutsSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          z-index: 10;
        }

        @keyframes shortcutsSlideIn {
          0% {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px) scale(0.95);
          }
          100% {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }

        .shortcuts-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .shortcuts-icon {
          color: var(--accent-warning);
          font-size: var(--font-size-sm);
        }

        .shortcuts-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .shortcut-item {
          display: flex;
          flex-direction: column;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: center;
        }

        .shortcut-item:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: var(--accent-primary);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(52, 199, 89, 0.2);
        }

        .shortcut-voice {
          font-size: var(--font-size-xs);
          font-weight: 600;
          color: var(--accent-primary);
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          margin-bottom: 2px;
        }

        .shortcut-desc {
          font-size: calc(var(--font-size-xs) * 0.85);
          color: var(--text-secondary);
          line-height: 1.2;
        }

        .microphone-icon {
          position: absolute;
          font-size: var(--font-size-xl);
          color: rgba(255, 255, 255, 0.9);
          text-shadow:
            0 0 10px rgba(255, 255, 255, 0.8),
            0 2px 4px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3;
          transition: all 0.3s ease;
        }

        .voice-sphere.listening .microphone-icon {
          animation: microphonePulse 1.5s ease-in-out infinite;
          color: rgba(255, 255, 255, 1);
          text-shadow:
            0 0 15px rgba(255, 255, 255, 1),
            0 0 25px rgba(255, 68, 68, 0.8);
        }

        .mic-icon-container,
        .spiral-container {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          opacity: 0;
          transform: scale(0.8);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .mic-icon-container.active,
        .spiral-container.active {
          opacity: 1;
          transform: scale(1);
        }

        .mic-icon-container.active {
          transition-delay: 0.1s;
        }

        .spiral-container.active {
          transition-delay: 0.2s;
        }

        .ai-spiral-animation {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
          filter: brightness(1.2) contrast(1.1);
          box-shadow:
            0 0 20px rgba(255, 20, 147, 0.6),
            0 0 40px rgba(255, 20, 147, 0.3);
          transition: all 0.3s ease;
          animation: spiralGlow 2s ease-in-out infinite;
        }

        @keyframes spiralGlow {
          0%, 100% {
            filter: brightness(1.2) contrast(1.1) saturate(1.2);
            box-shadow:
              0 0 20px rgba(255, 20, 147, 0.6),
              0 0 40px rgba(255, 20, 147, 0.3);
          }
          50% {
            filter: brightness(1.5) contrast(1.3) saturate(1.5);
            box-shadow:
              0 0 30px rgba(255, 20, 147, 0.8),
              0 0 60px rgba(255, 20, 147, 0.5);
          }
        }

        @keyframes microphonePulse {
          0%, 100% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.1);
            filter: brightness(1.3);
          }
        }

        .button-label {
          font-size: var(--font-size-base);
          font-weight: 500;
          color: var(--text-secondary);
          text-align: center;
        }

        .help-toggle-btn {
          background: transparent;
          border-radius: 50%;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-secondary);
          transition: all 0.3s ease;
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          font-size: var(--font-size-sm);
        }

        .help-toggle-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          border-color: var(--accent-primary);
          color: var(--accent-primary);
          transform: translateY(-50%) scale(1.1);
        }

        .status-display {
          margin-top: 8px;
          width: 100%;
          max-width: 260px;
        }

        .status-message {
          padding: 6px 12px;
          border-radius: 6px;
          font-size: var(--font-size-sm);
          background: rgba(52, 199, 89, 0.1);
          color: var(--accent-primary);
          border: 1px solid var(--border-accent);
          text-align: center;
        }

        .command-help {
          flex: 0 0 auto;
          width: 200px;
          padding-left: 16px;
          border-left: 1px solid var(--border-primary);
        }

        .help-header {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--border-secondary);
        }

        .help-icon {
          font-size: var(--font-size-base);
          color: var(--accent-warning);
        }

        .help-title {
          font-size: var(--font-size-base);
          font-weight: 600;
          color: var(--text-primary);
        }

        .command-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .command-item {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 6px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-secondary);
          border-radius: 4px;
          transition: all 0.2s ease;
          font-size: calc(var(--font-size-xs) * 0.9);
          line-height: 1.2;
        }

        .command-icon {
          font-size: calc(var(--font-size-xs) * 0.85);
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .command-item:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: var(--border-accent);
        }

        .command-text {
          font-weight: 600;
          color: var(--accent-primary);
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }

        .command-desc {
          color: var(--text-secondary);
          margin-left: 4px;
        }


        @media (max-width: 768px) {
          .voice-navigation-chatgpt {
            flex-direction: column;
            padding: 12px;
            gap: 12px;
          }

          .voice-content {
            min-width: auto;
          }

          .command-help {
            padding-left: 0;
            border-left: none;
            border-top: 1px solid var(--border-primary);
            padding-top: 12px;
            width: 100%;
          }

          .voice-sphere {
            width: 70px;
            height: 70px;
          }

          .sphere-core {
            width: 50px;
            height: 50px;
          }

          .particle-field {
            width: 90px;
            height: 90px;
          }

          .microphone-icon {
            font-size: var(--font-size-base);
          }
        }

        @media (max-width: 600px) {
          .voice-navigation-chatgpt {
            flex-direction: column;
            padding: 10px;
            gap: 10px;
            margin: 8px 0;
          }

          .voice-content {
            min-width: auto;
            width: 100%;
          }

          .command-help {
            padding-left: 0;
            border-left: none;
            border-top: 1px solid var(--border-primary);
            padding-top: 8px;
            width: 100%;
          }

          .voice-sphere {
            width: 60px;
            height: 60px;
          }

          .sphere-core {
            width: 45px;
            height: 45px;
          }

          .particle-field {
            width: 80px;
            height: 80px;
          }

          .microphone-icon {
            font-size: var(--font-size-sm);
          }

          .section-header {
            margin-bottom: 8px;
            padding-bottom: 4px;
          }

          .section-title {
            font-size: var(--font-size-base);
          }

          .voice-level-container,
          .waveform-container {
            max-width: 160px;
            margin-top: 6px;
          }

          .voice-preview {
            max-width: 200px;
            margin-top: 6px;
            padding: 6px;
          }

          .status-display {
            margin-top: 6px;
            max-width: 240px;
          }

          .status-message {
            padding: 6px 8px;
            font-size: calc(var(--font-size-sm) * 0.9);
          }

          .command-list {
            gap: 3px;
          }

          .command-item {
            padding: 3px 4px;
            font-size: calc(var(--font-size-xs) * 0.8);
            flex-wrap: wrap;
            line-height: 1.1;
          }

          .command-text {
            font-size: calc(var(--font-size-xs) * 0.75);
          }

          .command-desc {
            font-size: calc(var(--font-size-xs) * 0.7);
            margin-left: 1px;
          }
        }

        @media (max-width: 480px) {
          .voice-navigation-chatgpt {
            padding: 8px;
            gap: 8px;
            margin: 6px 0;
          }

          .voice-sphere {
            width: 50px;
            height: 50px;
          }

          .sphere-core {
            width: 40px;
            height: 40px;
          }

          .particle-field {
            width: 70px;
            height: 70px;
          }

          .microphone-icon {
            font-size: calc(var(--font-size-sm) * 0.9);
          }

          .section-title {
            font-size: var(--font-size-sm);
          }

          .voice-level-container,
          .waveform-container {
            max-width: 140px;
          }

          .voice-preview {
            max-width: 180px;
            padding: 6px;
          }

          .status-display {
            max-width: 220px;
          }

          .command-item {
            padding: 2px 3px;
            font-size: calc(var(--font-size-xs) * 0.75);
          }

          .command-text {
            font-size: calc(var(--font-size-xs) * 0.7);
          }

          .command-desc {
            font-size: calc(var(--font-size-xs) * 0.65);
            display: block;
            width: 100%;
            margin-left: 0;
            margin-top: 1px;
          }

          .help-title {
            font-size: calc(var(--font-size-sm) * 0.9);
          }
        }
      `}</style>
    </div>
  );
};

export default VoiceNavigationChatGPT;