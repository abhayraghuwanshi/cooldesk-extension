import React, { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLightbulb, faMicrophone, faArrowDown, faArrowUp, faArrowLeft, faRotateRight, faHashtag, faSearch, faExchangeAlt, faPlus, faTimes } from '@fortawesome/free-solid-svg-icons';

const VoiceNavigationChatGPT = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [waveformData, setWaveformData] = useState(Array(5).fill(0));
  const recognitionRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        setError('');
        setFeedback('Listening...');
        startAudioAnalysis();
      };

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setTranscript(finalTranscript);
          setInterimTranscript('');
          handleVoiceCommand(finalTranscript);
        } else {
          setInterimTranscript(interimText);
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        setInterimTranscript('');
        stopAudioAnalysis();
      };

      recognitionRef.current.onerror = (event) => {
        setIsListening(false);
        setError(`Speech recognition error: ${event.error}`);
        setFeedback('');
        setInterimTranscript('');
        stopAudioAnalysis();
      };
    } else {
      setError('Speech recognition not supported in this browser');
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      stopAudioAnalysis();
    };
  }, []);

  // Audio analysis functions
  const startAudioAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneRef.current = stream;

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      updateAudioData();
    } catch (error) {
      console.warn('Could not access microphone for audio analysis:', error);
    }
  };

  const stopAudioAnalysis = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (microphoneRef.current) {
      microphoneRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
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
    if (recognitionRef.current && !isListening) {
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  };

  const handleVoiceCommand = async (command) => {
    const lowerCommand = command.toLowerCase();

    try {
      // Tab management
      if (lowerCommand.includes('switch to tab') || lowerCommand.includes('go to tab')) {
        await handleTabSwitch(command);
      } else if (lowerCommand.includes('next tab')) {
        await switchToNextTab();
      } else if (lowerCommand.includes('previous tab') || lowerCommand.includes('prev tab')) {
        await switchToPreviousTab();
      } else if (lowerCommand.includes('close tab')) {
        await closeCurrentTab();
      } else if (lowerCommand.includes('new tab')) {
        await createNewTab();
      } else if (lowerCommand.includes('find tab') || lowerCommand.includes('search tab')) {
        await findTab(command);
      }
      // Search commands
      else if (lowerCommand.includes('search for') || lowerCommand.includes('google search')) {
        await performWebSearch(command);
      }
      // Element interaction
      else if (lowerCommand.includes('show numbers') || lowerCommand.includes('number elements')) {
        await showElementNumbers();
      } else if (lowerCommand.includes('hide numbers') || lowerCommand.includes('clear numbers')) {
        await hideElementNumbers();
      } else if (lowerCommand.match(/click (\d+)/) || lowerCommand.match(/click number (\d+)/)) {
        await clickByNumber(command);
      } else if (lowerCommand.includes('click')) {
        await clickLink(command);
      }
      // Basic navigation
      else if (lowerCommand.includes('scroll down')) {
        window.scrollBy(0, 500);
        setFeedback('Scrolled down');
      } else if (lowerCommand.includes('scroll up')) {
        window.scrollBy(0, -500);
        setFeedback('Scrolled up');
      } else if (lowerCommand.includes('go back')) {
        window.history.back();
        setFeedback('Going back');
      } else if (lowerCommand.includes('reload') || lowerCommand.includes('refresh')) {
        window.location.reload();
        setFeedback('Reloading page');
      } else {
        setFeedback(`Command "${command}" not recognized. Try "show numbers", "search for cats", or "switch to tab 2"`);
      }
    } catch (error) {
      console.error('Error processing voice command:', error);
      setFeedback(`Error: ${error.message}`);
    }

    // Clear feedback after 3 seconds
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback('');
      setTranscript('');
    }, 3000);
  };

  // Tab management functions
  const handleTabSwitch = async (command) => {
    const numberMatch = command.match(/tab (\d+)/);
    if (numberMatch) {
      const tabIndex = parseInt(numberMatch[1]) - 1;
      await switchToTabByIndex(tabIndex);
    }
  };

  const switchToTabByIndex = async (index) => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      if (index >= 0 && index < tabs.length) {
        await chrome.tabs.update(tabs[index].id, { active: true });
        setFeedback(`Switched to tab ${index + 1}: ${tabs[index].title}`);
      } else {
        setFeedback(`Tab ${index + 1} not found. Available tabs: 1-${tabs.length}`);
      }
    } catch (error) {
      setFeedback(`Failed to switch to tab: ${error.message}`);
    }
  };

  const switchToNextTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = tabs.find(tab => tab.active);
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
      const nextIndex = (currentIndex + 1) % tabs.length;
      await chrome.tabs.update(tabs[nextIndex].id, { active: true });
      setFeedback(`Switched to next tab: ${tabs[nextIndex].title}`);
    } catch (error) {
      setFeedback(`Failed to switch to next tab: ${error.message}`);
    }
  };

  const switchToPreviousTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = tabs.find(tab => tab.active);
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
      const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
      await chrome.tabs.update(tabs[prevIndex].id, { active: true });
      setFeedback(`Switched to previous tab: ${tabs[prevIndex].title}`);
    } catch (error) {
      setFeedback(`Failed to switch to previous tab: ${error.message}`);
    }
  };

  const closeCurrentTab = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.remove(activeTab.id);
      setFeedback('Tab closed');
    } catch (error) {
      setFeedback(`Failed to close tab: ${error.message}`);
    }
  };

  const createNewTab = async () => {
    try {
      await chrome.tabs.create({});
      setFeedback('New tab created');
    } catch (error) {
      setFeedback(`Failed to create new tab: ${error.message}`);
    }
  };

  const findTab = async (command) => {
    try {
      const searchMatch = command.match(/find tab (.+)/) || command.match(/search tab (.+)/);
      if (searchMatch) {
        const searchTerm = searchMatch[1].trim();
        const tabs = await chrome.tabs.query({});
        const matchingTab = tabs.find(tab =>
          tab.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tab.url.toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (matchingTab) {
          await chrome.tabs.update(matchingTab.id, { active: true });
          await chrome.windows.update(matchingTab.windowId, { focused: true });
          setFeedback(`Switched to: ${matchingTab.title}`);
        } else {
          setFeedback(`No tab found matching "${searchTerm}"`);
        }
      }
    } catch (error) {
      setFeedback(`Failed to search tabs: ${error.message}`);
    }
  };

  const performWebSearch = async (command) => {
    try {
      let searchTerm = '';
      if (command.includes('search for')) {
        searchTerm = command.replace(/.*search for\s+/, '').trim();
      } else if (command.includes('google search')) {
        searchTerm = command.replace(/.*google search\s+/, '').trim();
      } else if (command.includes('search')) {
        searchTerm = command.replace(/.*search\s+/, '').trim();
      }

      if (!searchTerm) {
        setFeedback('Please specify what to search for');
        return;
      }

      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
      await chrome.tabs.create({ url: searchUrl });
      setFeedback(`Searching Google for "${searchTerm}"`);
    } catch (error) {
      setFeedback(`Failed to perform web search: ${error.message}`);
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
        setFeedback(`Showing numbers on ${elementCount} clickable elements. Say "click 1" to "click ${elementCount}"`);
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

  // Helper functions for injection
  const addNumbersToElements = () => {
    const existingNumbers = document.querySelectorAll('.voice-nav-number');
    existingNumbers.forEach(el => el.remove());

    const selectors = ['a', 'button', '[role="button"]', '[onclick]', 'input[type="submit"]', 'input[type="button"]', '[class*="btn"]'];
    let elements = [];
    selectors.forEach(selector => {
      elements.push(...Array.from(document.querySelectorAll(selector)));
    });

    const visibleElements = elements.filter((el, index, arr) => {
      if (arr.indexOf(el) !== index) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
             rect.width > 5 && rect.height > 5 &&
             rect.top < window.innerHeight && rect.bottom > 0;
    });

    visibleElements.slice(0, 15).forEach((element, index) => {
      const number = index + 1;
      const numberEl = document.createElement('div');
      numberEl.className = 'voice-nav-number';
      numberEl.textContent = number;
      numberEl.style.cssText = `
        position: absolute;
        width: 20px; height: 20px;
        border-radius: 50%;
        background: #ff4444;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: calc(var(--font-size-xs) * 0.85);
        font-weight: bold;
        border: 2px solid white;
        z-index: 10000;
        pointer-events: none;
      `;

      const rect = element.getBoundingClientRect();
      numberEl.style.top = `${rect.top + window.scrollY - 10}px`;
      numberEl.style.left = `${rect.left + window.scrollX - 10}px`;

      document.body.appendChild(numberEl);
      element.setAttribute('data-voice-nav-number', number);
    });

    return { count: Math.min(15, visibleElements.length) };
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

  const findAndClickLink = (searchText) => {
    const elements = document.querySelectorAll('a, button, [role="button"], [onclick]');
    const searchLower = searchText.toLowerCase();

    for (const element of elements) {
      const text = element.textContent?.toLowerCase() || '';
      const title = element.getAttribute('title')?.toLowerCase() || '';
      const label = element.getAttribute('aria-label')?.toLowerCase() || '';

      if (text.includes(searchLower) || title.includes(searchLower) || label.includes(searchLower)) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => element.click(), 200);
        return {
          success: true,
          elementText: element.textContent?.trim() || element.getAttribute('title') || 'Link'
        };
      }
    }

    return { success: false };
  };

  return (
    <div className="voice-navigation-chatgpt">
      <div className="voice-content">
        {/* Section Title */}
        <div className="section-header">
          <FontAwesomeIcon icon={faMicrophone} className="section-icon" />
          <h3 className="section-title">Voice Navigation</h3>
        </div>
        <div className="voice-button-container">
          <button
            className={`voice-button ${isListening ? 'listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
            disabled={!!error}
          >
            <div className="button-content">
              {isListening ? (
                <div className="listening-animation">
                  <div className="pulse-ring" style={{ opacity: voiceLevel }}></div>
                  <div className="microphone-icon pulsing">
                    <FontAwesomeIcon icon={faMicrophone} />
                  </div>
                </div>
              ) : (
                <div className="microphone-icon">
                  <FontAwesomeIcon icon={faMicrophone} />
                </div>
              )}
            </div>
          </button>

          <div className="button-label">
            {isListening ? 'Listening...' : 'Voice Navigation'}
          </div>

          {/* Voice Level Indicator */}
          {isListening && (
            <div className="voice-level-container">
              <div className="voice-level-label">Voice Level</div>
              <div className="voice-level-bar">
                <div
                  className="voice-level-fill"
                  style={{ width: `${voiceLevel * 100}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Waveform Animation */}
          {isListening && (
            <div className="waveform-container">
              <div className="waveform-label">Audio Waveform</div>
              <div className="waveform">
                {waveformData.map((height, index) => (
                  <div
                    key={index}
                    className="waveform-bar"
                    style={{
                      height: `${Math.max(height * 100, 5)}%`,
                      animationDelay: `${index * 50}ms`
                    }}
                  ></div>
                ))}
              </div>
            </div>
          )}

          {/* Real-time Voice Command Preview */}
          {(interimTranscript || transcript) && (
            <div className="voice-preview">
              <div className="preview-label">Voice Input</div>
              <div className="preview-text">
                {transcript && <span className="final-text">"{transcript}"</span>}
                {interimTranscript && <span className="interim-text">"{interimTranscript}"</span>}
              </div>
            </div>
          )}
        </div>

        {/* Status Display */}
        {(transcript || feedback || error) && (
          <div className="status-display">
            {error && (
              <div className="status-message error">
                <span className="status-icon">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {transcript && (
              <div className="status-message transcript">
                <span className="status-icon">💬</span>
                <span>"{transcript}"</span>
              </div>
            )}

            {feedback && !error && (
              <div className="status-message feedback">
                <span className="status-icon">✅</span>
                <span>{feedback}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Command Help Sidebar */}
      <div className="command-help">
        <div className="help-header">
          <FontAwesomeIcon icon={faLightbulb} className="help-icon" />
          <span className="help-title">Commands</span>
        </div>

        <div className="command-list">
          <div className="command-item">
            <FontAwesomeIcon icon={faHashtag} className="command-icon" />
            <span className="command-text">"show numbers"</span> → <span className="command-desc">mark clickable elements</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faHashtag} className="command-icon" />
            <span className="command-text">"click 3"</span> → <span className="command-desc">click numbered element</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faExchangeAlt} className="command-icon" />
            <span className="command-text">"switch to tab 2"</span> → <span className="command-desc">switch tabs</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faSearch} className="command-icon" />
            <span className="command-text">"search for cats"</span> → <span className="command-desc">google search</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faSearch} className="command-icon" />
            <span className="command-text">"find tab gmail"</span> → <span className="command-desc">search tabs</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faArrowDown} className="command-icon" />
            <span className="command-text">"scroll down"</span> → <span className="command-desc">scroll page</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faPlus} className="command-icon" />
            <span className="command-text">"new tab"</span> → <span className="command-desc">create new tab</span>
          </div>

          <div className="command-item">
            <FontAwesomeIcon icon={faTimes} className="command-icon" />
            <span className="command-text">"close tab"</span> → <span className="command-desc">close current tab</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .voice-navigation-chatgpt {
          display: flex;
          gap: 24px;
          padding: 24px;
          background: var(--glass-bg);
          backdrop-filter: var(--glass-backdrop);
          border-radius: 16px;
          border: 1px solid var(--glass-border);
          box-shadow: var(--shadow-md);
          margin: 16px 0;
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
          gap: 12px;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-secondary);
          width: 100%;
          justify-content: center;
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
          gap: 12px;
        }

        .voice-button {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          box-shadow: 0 8px 25px rgba(52, 199, 89, 0.3);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(52, 199, 89, 0.4);
        }

        .voice-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .voice-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .voice-button.listening {
          background: linear-gradient(135deg, var(--accent-error), #dc2626);
          box-shadow: 0 8px 25px rgba(239, 68, 68, 0.3);
        }

        .button-content {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .microphone-icon {
          font-size: var(--font-size-3xl);
          color: white;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .microphone-icon.pulsing {
          animation: microphonePulse 1.5s ease-in-out infinite;
        }

        @keyframes microphonePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }

        .listening-animation {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .pulse-ring {
          position: absolute;
          width: 100px;
          height: 100px;
          border: 2px solid rgba(255, 255, 255, 0.4);
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          100% {
            transform: scale(1.2);
            opacity: 0;
          }
        }

        .button-label {
          font-size: var(--font-size-base);
          font-weight: 500;
          color: var(--text-secondary);
          text-align: center;
        }

        .status-display {
          margin-top: 16px;
          width: 100%;
          max-width: 300px;
        }

        .status-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: var(--font-size-base);
          margin-bottom: 8px;
          background: var(--glass-bg);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border-primary);
        }

        .status-message.error {
          background: rgba(239, 68, 68, 0.1);
          color: var(--accent-error);
          border-color: rgba(239, 68, 68, 0.3);
        }

        .status-message.transcript {
          background: rgba(96, 165, 250, 0.1);
          color: var(--accent-blue);
          border-color: rgba(96, 165, 250, 0.3);
        }

        .status-message.feedback {
          background: rgba(52, 199, 89, 0.1);
          color: var(--accent-primary);
          border-color: var(--border-accent);
        }

        .status-icon {
          font-size: var(--font-size-lg);
          flex-shrink: 0;
        }

        .command-help {
          flex: 0 0 auto;
          width: 250px;
          padding-left: 20px;
          border-left: 1px solid var(--border-primary);
        }

        .help-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 12px;
          padding-bottom: 6px;
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
          gap: 6px;
        }

        .command-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-secondary);
          border-radius: 6px;
          transition: all 0.2s ease;
          font-size: var(--font-size-xs);
          line-height: 1.3;
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

        /* Voice UI Enhancements */
        .voice-level-container {
          margin-top: 16px;
          width: 100%;
          max-width: 200px;
        }

        .voice-level-label {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          margin-bottom: 6px;
          text-align: center;
        }

        .voice-level-bar {
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid var(--border-primary);
        }

        .voice-level-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
          border-radius: 3px;
          transition: width 0.1s ease;
        }

        .waveform-container {
          margin-top: 16px;
          width: 100%;
          max-width: 200px;
        }

        .waveform-label {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          margin-bottom: 8px;
          text-align: center;
        }

        .waveform {
          display: flex;
          justify-content: center;
          align-items: end;
          height: 40px;
          gap: 3px;
        }

        .waveform-bar {
          width: 6px;
          background: linear-gradient(180deg, var(--accent-primary), var(--accent-secondary));
          border-radius: 3px;
          min-height: 2px;
          animation: waveformPulse 1s ease-in-out infinite;
        }

        @keyframes waveformPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .voice-preview {
          margin-top: 16px;
          width: 100%;
          max-width: 250px;
          padding: 12px;
          background: var(--glass-bg);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
        }

        .preview-label {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          margin-bottom: 6px;
          text-align: center;
        }

        .preview-text {
          font-size: var(--font-size-sm);
          text-align: center;
          line-height: 1.4;
        }

        .final-text {
          color: var(--accent-primary);
          font-weight: 600;
        }

        .interim-text {
          color: var(--text-secondary);
          font-style: italic;
        }

        @media (max-width: 768px) {
          .voice-navigation-chatgpt {
            flex-direction: column;
            padding: 20px 16px;
            gap: 20px;
          }

          .voice-content {
            min-width: auto;
          }

          .command-help {
            padding-left: 0;
            border-left: none;
            border-top: 1px solid var(--border-primary);
            padding-top: 16px;
            width: 100%;
          }

          .voice-button {
            width: 70px;
            height: 70px;
          }

          .microphone-icon {
            font-size: calc(var(--font-size-xl) * 1.1);
          }

          .pulse-ring {
            width: 90px;
            height: 90px;
          }
        }
      `}</style>
    </div>
  );
};

export default VoiceNavigationChatGPT;