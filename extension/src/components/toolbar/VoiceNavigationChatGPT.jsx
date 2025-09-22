import { faArrowDown, faExchangeAlt, faHashtag, faLightbulb, faMicrophone, faPlus, faQuestionCircle, faSearch, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import React, { useEffect, useRef, useState } from 'react';
import aiSpiralGif from '../../ai-spiral.gif';

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

  // Initialize speech recognition
  useEffect(() => {
    if (annyang) {
      // Define voice commands using annyang
      const commands = {
        'switch to tab :num': (num) => {
          switchToTabByIndex(parseInt(num) - 1);
        },
        'go to tab :num': (num) => {
          switchToTabByIndex(parseInt(num) - 1);
        },
        'next tab': switchToNextTab,
        'previous tab': switchToPreviousTab,
        'prev tab': switchToPreviousTab,
        'close tab': closeCurrentTab,
        'new tab': createNewTab,
        'find tab *term': findTab,
        'search tab *term': findTab,
        'search for *term': performWebSearch,
        'google search *term': performWebSearch,
        'search *term': performWebSearch,
        'show numbers': showElementNumbers,
        'number elements': showElementNumbers,
        'hide numbers': hideElementNumbers,
        'clear numbers': hideElementNumbers,
        'click :num': (num) => {
          clickByNumber(`click ${num}`);
        },
        'click number :num': (num) => {
          clickByNumber(`click number ${num}`);
        },
        'click *text': clickLink,
        'click on *text': clickLink,
        'scroll down': () => {
          window.scrollBy(0, 500);
          setFeedback('Scrolled down');
        },
        'scroll up': () => {
          window.scrollBy(0, -500);
          setFeedback('Scrolled up');
        },
        'go back': () => {
          window.history.back();
          setFeedback('Going back');
        },
        'reload': () => {
          window.location.reload();
          setFeedback('Reloading page');
        },
        'refresh': () => {
          window.location.reload();
          setFeedback('Reloading page');
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
          setTranscript(command);
          setInterimTranscript('');
          // Feedback is set by the command action
        }
      });

      annyang.addCallback('resultNoMatch', (phrases) => {
        if (phrases.length > 0) {
          const command = phrases[0];
          setTranscript(command);
          setFeedback(`Command "${command}" not recognized. Try "show numbers", "search for cats", or "switch to tab 2"`);
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
        setIsListening(false);
        setError(`Speech recognition error: ${error.error}`);
        setFeedback('');
        setInterimTranscript('');
        stopAudioAnalysis();
      });

      annyang.addCallback('start', () => {
        setIsListening(true);
        setError('');
        setFeedback('Listening...');
        startAudioAnalysis();
      });

      annyang.addCallback('end', () => {
        setIsListening(false);
        setInterimTranscript('');
        stopAudioAnalysis();
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
    if (annyang && !isListening) {
      annyang.start({ autoRestart: true, continuous: true });
    }
  };

  const stopListening = () => {
    if (annyang && isListening) {
      annyang.abort();
    }
  };

  // Tab management functions
  const switchToTabByIndex = async (index) => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      if (index >= 0 && index < tabs.length) {
        await chrome.tabs.update(tabs[index].id, { active: true });
        setFeedback(`Switched to tab ${index + 1}: ${tabs[index].title}`);
        triggerEnergyWave();
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
        // Use fuzzy search to find matching tabs
        const matchingTabs = fuzzySearch(tabs, searchTerm.toLowerCase(), ['title', 'url'], { threshold: 0.3 });

        if (matchingTabs.length > 0) {
          const matchingTab = matchingTabs[0]; // Take the best match
          await chrome.tabs.update(matchingTab.id, { active: true });
          await chrome.windows.update(matchingTab.windowId, { focused: true });
          setFeedback(`Switched to: ${matchingTab.title}`);
          triggerEnergyWave();
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

  return (
    <div className="voice-navigation-chatgpt">
      <div className="voice-content">
        {/* Section Title */}
        <div className="section-header">
          <FontAwesomeIcon icon={faMicrophone} className="section-icon" />
          <h3 className="section-title">Voice Navigation</h3>
          <button
            className="help-toggle-btn"
            onClick={() => setShowHelp(!showHelp)}
            title="Toggle command help"
          >
            <FontAwesomeIcon icon={faQuestionCircle} />
          </button>
        </div>
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
                  {/* Celestial Rings */}
                  <div className="celestial-ring"
                    style={{
                      width: '200px',
                      height: '200px',
                      transform: 'translate(-50%, -50%) rotateX(70deg)'
                    }}>
                  </div>
                  <div className="celestial-ring"
                    style={{
                      width: '150px',
                      height: '150px',
                      transform: 'translate(-50%, -50%) rotateX(70deg) rotateY(60deg)'
                    }}>
                  </div>
                  {/* Ring with Particle Trail */}
                  <div className="celestial-ring"
                    style={{
                      width: '170px',
                      height: '170px',
                      transform: 'translate(-50%, -50%) rotateX(70deg) rotateY(120deg)'
                    }}>
                    <div className="particle-orbit"></div>
                  </div>
                  {/* Central Orb */}
                  <div className="sphere-core" style={{
                    transform: `translate(-50%, -50%) scale(${1 + voiceLevel * 0.4})`,
                    filter: `brightness(${1 + voiceLevel * 0.5})`,
                    animationDuration: `${Math.max(2, 4 - voiceLevel * 2)}s`
                  }}>
                  </div>
                </div>
                {/* Energy Wave Effect */}
                {showEnergyWave && (
                  <div className="energy-wave-container">
                    <div className="energy-wave energy-wave-1"></div>
                    <div className="energy-wave energy-wave-2"></div>
                    <div className="energy-wave energy-wave-3"></div>
                  </div>
                )}
                <div className="particle-field">
                  {Array.from({ length: 12 }, (_, i) => (
                    <div
                      key={i}
                      className="particle"
                      style={{
                        animationDelay: `${i * 0.2}s`,
                        animationDuration: `${2 + Math.random() * 2}s`
                      }}
                    />
                  ))}
                </div>
                <div className="microphone-icon">
                  <div className="spiral-container active">
                    <img
                      src={aiSpiralGif}
                      alt="Listening..."
                      className="ai-spiral-animation"
                    />
                  </div>
                </div>
              </div>
            )}
          </button>

          <div className="button-label">
            {isListening ? 'Listening...' : 'Voice Navigation'}
          </div>

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

      {/* Command Help Sidebar */}
      {showHelp && (
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
          width: 90px;
          height: 90px;
          border: none;
          background: transparent;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
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
          width: 60px;
          height: 60px;
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
          width: 80px;
          height: 80px;
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
        }

        .voice-sphere.listening .celestial-ring {
          border-color: rgba(255, 68, 68, 0.4);
          box-shadow: 0 0 10px rgba(255, 68, 68, 0.3);
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
          width: 200px;
          height: 200px;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 0;
        }

        .particle {
          position: absolute;
          width: 2px;
          height: 2px;
          background: rgba(0, 191, 255, 0.8);
          border-radius: 50%;
          animation: particleFloat linear infinite;
          box-shadow: 0 0 6px rgba(0, 191, 255, 0.6);
        }

        .voice-sphere.listening .particle {
          background: rgba(255, 68, 68, 0.8);
          box-shadow: 0 0 6px rgba(255, 68, 68, 0.6);
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