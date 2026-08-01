import annyang from 'annyang';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceCommandProcessor } from '../../services/voiceCommandProcessor.js';

// Voice command stack extracted from the old CoolSearch so any search surface
// can opt in (enabled: true) without carrying the annyang/audio plumbing.
// Returns mic state + waveform levels for rendering a listening indicator.
//
//   const voice = useVoiceCommands({ enabled, onNavigate, onSearch, showFeedback });
//   voice.toggleVoice(); voice.isListening; voice.waveformData; ...
//
// onNavigate(face)  — optional; enables "go to overview/workspace/..." commands
// onSearch(term)    — receives dictated search terms ("search for react hooks")
// showFeedback(msg, type) — surface command results to the user

// ---- page-injected functions (extension mode only; run inside the page) ----
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

export function useVoiceCommands({ enabled = false, onNavigate, onSearch, showFeedback }) {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [voiceLevel, setVoiceLevel] = useState(0);
    const [waveformData, setWaveformData] = useState(Array(5).fill(0));

    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const microphoneRef = useRef(null);
    const animationFrameRef = useRef(null);
    const commandProcessorRef = useRef(null);

    // Keep callbacks in refs so the annyang effect doesn't re-bind on every render
    const onNavigateRef = useRef(onNavigate);
    const onSearchRef = useRef(onSearch);
    const showFeedbackRef = useRef(showFeedback);
    useEffect(() => {
        onNavigateRef.current = onNavigate;
        onSearchRef.current = onSearch;
        showFeedbackRef.current = showFeedback;
    });

    const feedback = useCallback((message, type = 'success') => {
        showFeedbackRef.current?.(message, type);
        setTranscript('');
    }, []);

    // ---- audio level visualization ----
    const updateAudioData = useCallback(() => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setVoiceLevel(Math.min(average / 128, 1));

        const barCount = 5;
        const barSize = Math.floor(dataArray.length / barCount);
        const waveform = [];
        for (let i = 0; i < barCount; i++) {
            const barData = dataArray.slice(i * barSize, (i + 1) * barSize);
            const barAverage = barData.reduce((sum, value) => sum + value, 0) / barData.length;
            waveform.push(Math.min(barAverage / 128, 1));
        }
        setWaveformData(waveform);

        animationFrameRef.current = requestAnimationFrame(updateAudioData);
    }, []);

    const startAudioAnalysis = useCallback(async (retryCount = 0) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });

            microphoneRef.current = stream;

            if (audioContextRef.current && audioContextRef.current.state === 'running') {
                return; // Reuse existing context
            }
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
                console.error('[Voice] Microphone permission denied');
            } else if (retryCount < 2) {
                console.warn('[Voice] getUserMedia error - retrying', error);
                setTimeout(() => startAudioAnalysis(retryCount + 1), 1000);
            }
        }
    }, [updateAudioData]);

    const stopAudioAnalysis = useCallback(async () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (microphoneRef.current) {
            microphoneRef.current.getTracks().forEach(track => track.stop());
            microphoneRef.current = null;
        }
        if (audioContextRef.current) {
            try {
                if (audioContextRef.current.state !== 'closed') {
                    await audioContextRef.current.close();
                }
            } catch (error) {
                console.warn('[Voice] Error closing audio context:', error);
            }
            audioContextRef.current = null;
        }
        analyserRef.current = null;
        setVoiceLevel(0);
        setWaveformData(Array(5).fill(0));
    }, []);

    // ---- "show numbers / click N" page interaction (extension mode) ----
    const showElementNumbers = useCallback(async () => {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const results = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: addNumbersToElements
            });
            if (results?.[0]?.result) {
                feedback(`Showing numbers on ${results[0].result.count} clickable elements`, 'success');
            }
        } catch (error) {
            feedback(`Failed to show numbers: ${error.message}`, 'error');
        }
    }, [feedback]);

    const hideElementNumbers = useCallback(async () => {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: removeNumbers
            });
            feedback('Numbers hidden', 'success');
        } catch (error) {
            feedback(`Failed to hide numbers: ${error.message}`, 'error');
        }
    }, [feedback]);

    const clickByNumber = useCallback(async (command) => {
        try {
            const numberMatch = command.match(/click (\d+)/) || command.match(/click number (\d+)/);
            if (!numberMatch) {
                feedback('Please specify a number to click', 'error');
                return;
            }
            const clickNumber = parseInt(numberMatch[1]);
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const results = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: clickElementByNumber,
                args: [clickNumber]
            });
            if (results?.[0]?.result) {
                const result = results[0].result;
                if (result.success) {
                    feedback(`Clicked element ${clickNumber}: ${result.elementText}`, 'success');
                } else {
                    feedback(`Element ${clickNumber} not found. Say "show numbers" first.`, 'error');
                }
            }
        } catch (error) {
            feedback(`Failed to click by number: ${error.message}`, 'error');
        }
    }, [feedback]);

    // ---- annyang command grammar ----
    const initializeCommands = useCallback(() => {
        if (!annyang) return null;

        try {
            const recognition = annyang.getSpeechRecognizer();
            if (recognition) {
                if ('processLocally' in recognition) {
                    recognition.processLocally = true;
                }
                // Fallback if the local language pack is missing (annyang may swallow the error)
                const originalOnError = recognition.onerror;
                recognition.onerror = function (event) {
                    if (event.error === 'language-not-supported' && recognition.processLocally) {
                        console.warn('[Voice] Local language pack missing, disabling processLocally and retrying...');
                        recognition.processLocally = false;
                        try { annyang.abort(); setTimeout(() => annyang.start(), 100); } catch (e) { }
                        return;
                    }
                    if (originalOnError) originalOnError.apply(this, arguments);
                };
            }
        } catch (e) {
            console.warn('[Voice] Failed to set processLocally on annyang recognizer', e);
        }

        const processor = () => commandProcessorRef.current;
        const navigate = (face) => onNavigateRef.current?.(face);

        return {
            // Number commands
            'show numbers': () => showElementNumbers(),
            'hide numbers': () => hideElementNumbers(),
            'click :num': (num) => clickByNumber(`click ${num}`),
            'click number :num': (num) => clickByNumber(`click number ${num}`),
            // Face navigation
            'go to overview': () => navigate('overview'),
            'go to workspace': () => navigate('workspace'),
            'go to collections': () => navigate('workspace'),
            'go to chat': () => navigate('chat'),
            'go to tabs': () => navigate('tabs'),
            // Tab switching - MUST come before general search commands
            'switch to tab :num': async (num) => { await processor()?.processVoiceCommand(`switch to tab ${num}`); },
            'go to tab :num': async (num) => { await processor()?.processVoiceCommand(`go to tab ${num}`); },
            'find tab *term': async (term) => { await processor()?.processVoiceCommand(`find tab ${term}`); },
            'search tab *term': async (term) => { await processor()?.processVoiceCommand(`search tab ${term}`); },
            // Tab navigation
            'next tab': async () => { await processor()?.processVoiceCommand('next tab'); },
            'previous tab': async () => { await processor()?.processVoiceCommand('previous tab'); },
            'close tab': async () => { await processor()?.processVoiceCommand('close tab'); },
            'new tab': async () => { await processor()?.processVoiceCommand('new tab'); },
            // Search commands - come AFTER tab commands to avoid conflicts
            'search for *term': async (term) => { onSearchRef.current?.(term); },
            'google search *term': async (term) => { await processor()?.processVoiceCommand(`google search ${term}`); },
            'search *term': async (term) => {
                if (!term.toLowerCase().startsWith('tab ')) onSearchRef.current?.(term);
            },
            'open *term': async (term) => { await processor()?.processVoiceCommand(`open ${term}`); },
            'go to *term': async (term) => { await processor()?.processVoiceCommand(`go to ${term}`); },
            // Page navigation
            'scroll down': async () => { await processor()?.processVoiceCommand('scroll down'); },
            'scroll up': async () => { await processor()?.processVoiceCommand('scroll up'); },
            'go back': async () => { await processor()?.processVoiceCommand('go back'); },
            'go forward': async () => { await processor()?.processVoiceCommand('go forward'); },
            // Notes and todos
            'add note *note': async (note) => { await processor()?.processVoiceCommand(`add note ${note}`); },
            'add todo *todo': async (todo) => { await processor()?.processVoiceCommand(`add todo ${todo}`); }
        };
    }, [showElementNumbers, hideElementNumbers, clickByNumber]);

    // ---- workspace/history data for the VoiceCommandProcessor ----
    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        const loadProcessorData = async () => {
            try {
                const { listWorkspaces } = await import('../../db/index.js');
                const [workspacesResult, storageResult] = await Promise.all([
                    listWorkspaces(),
                    (typeof chrome !== 'undefined' && chrome.storage?.local)
                        ? chrome.storage.local.get(['dashboardData'])
                        : Promise.resolve({})
                ]);

                const workspaces = workspacesResult?.success ? workspacesResult.data : [];
                const dashboardData = storageResult?.dashboardData || {};

                const consolidatedData = {
                    allItems: [
                        ...(dashboardData.history || []),
                        ...(dashboardData.bookmarks || [])
                    ],
                    savedItems: (Array.isArray(workspaces) ? workspaces : []).flatMap(ws =>
                        (ws.urls || []).map(u => ({
                            ...u,
                            workspaceGroup: ws.name,
                            id: `${ws.id}-${u.url}`
                        }))
                    )
                };

                if (cancelled) return;
                if (commandProcessorRef.current) {
                    commandProcessorRef.current.updateWorkspaceData(consolidatedData);
                } else {
                    commandProcessorRef.current = new VoiceCommandProcessor(feedback, consolidatedData);
                }
            } catch (error) {
                console.warn('[Voice] Failed to load workspace data:', error);
            }
        };

        loadProcessorData();
        const onFocus = () => loadProcessorData();
        window.addEventListener('focus', onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
    }, [enabled, feedback]);

    // ---- annyang lifecycle ----
    useEffect(() => {
        if (!enabled || !annyang) return;

        if (!commandProcessorRef.current) {
            commandProcessorRef.current = new VoiceCommandProcessor(feedback, null);
        }

        const commands = initializeCommands();
        if (commands) annyang.addCommands(commands);
        annyang.setLanguage('en-US');

        annyang.addCallback('result', (phrases) => {
            if (phrases.length > 0) {
                const command = phrases[0];
                setTranscript(command);
                if (command.toLowerCase().startsWith('search')) {
                    const searchTerm = command.replace(/^search\s+(for\s+)?/i, '').trim();
                    onSearchRef.current?.(searchTerm);
                }
            }
        });
        annyang.addCallback('error', (error) => {
            console.warn('[Voice] Speech recognition error:', error);
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

        return () => {
            annyang.removeCommands();
            annyang.removeCallback('result');
            annyang.removeCallback('error');
            annyang.removeCallback('start');
            annyang.removeCallback('end');
            annyang.abort();
            stopAudioAnalysis();
        };
    }, [enabled, initializeCommands, startAudioAnalysis, stopAudioAnalysis, feedback]);

    const toggleVoice = useCallback(async (forceStart = false) => {
        if (!annyang) {
            showFeedbackRef.current?.('Speech recognition is not supported in this browser.', 'error');
            return;
        }

        const shouldListen = forceStart ? true : !isListening;
        const broadcast = (listening) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening: listening }).catch(() => { });
            }
        };

        if (!shouldListen) {
            annyang.abort();
            setIsListening(false);
            stopAudioAnalysis();
            broadcast(false);
        } else {
            try {
                await startAudioAnalysis();
                annyang.start({ autoRestart: false, continuous: true });
                setIsListening(true);
                broadcast(true);
            } catch (e) {
                console.warn('[Voice] Speech recognition error:', e);
                setIsListening(false);
                stopAudioAnalysis();
                broadcast(false);
            }
        }
    }, [isListening, startAudioAnalysis, stopAudioAnalysis]);

    // ---- external triggers (footer bar / background service worker) ----
    const toggleVoiceRef = useRef(toggleVoice);
    useEffect(() => { toggleVoiceRef.current = toggleVoice; });

    useEffect(() => {
        if (!enabled) return;

        // Pending voice start left by the background/footer before this surface mounted
        const checkPendingVoice = async () => {
            try {
                if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    const { pendingVoiceStart } = await chrome.storage.local.get('pendingVoiceStart');
                    if (pendingVoiceStart) {
                        await chrome.storage.local.remove('pendingVoiceStart');
                        setTimeout(() => toggleVoiceRef.current(true), 500);
                    }
                }
            } catch (e) {
                console.warn('[Voice] Error checking pending voice:', e);
            }
        };
        checkPendingVoice();

        const messageListener = (msg) => {
            if (msg.action === 'toggleVoice') {
                if (msg.forceStart) toggleVoiceRef.current(true);
                else toggleVoiceRef.current();
            } else if (msg.action === 'checkVoiceState') {
                chrome.runtime.sendMessage({ type: 'voiceStateChange', isListening }).catch(() => { });
            }
        };

        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener(messageListener);
            return () => chrome.runtime.onMessage.removeListener(messageListener);
        }
        return () => { };
    }, [enabled, isListening]);

    return {
        voiceSupported: !!annyang,
        isListening,
        transcript,
        voiceLevel,
        waveformData,
        toggleVoice,
    };
}
