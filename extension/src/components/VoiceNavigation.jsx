import React, { useState, useEffect, useRef } from 'react';

const VoiceNavigation = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [showNumbers, setShowNumbers] = useState(false);
  const [numberedElements, setNumberedElements] = useState([]);
  const [currentUrl, setCurrentUrl] = useState('');
  const [currentTabId, setCurrentTabId] = useState(null);
  const recognitionRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);

  useEffect(() => {
    // Check if browser supports speech recognition
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Speech recognition not supported in this browser');
      return;
    }

    // Initialize speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setError('');
      showFeedback('Listening...', 'info');
    };

    recognition.onend = () => {
      setIsListening(false);
      showFeedback('Stopped listening', 'info');
    };

    recognition.onerror = (event) => {
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      setTranscript(finalTranscript || interimTranscript);

      if (finalTranscript) {
        processVoiceCommand(finalTranscript.trim().toLowerCase());
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Monitor tab changes and clean up numbers when page changes
  useEffect(() => {
    const checkTabChanges = async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
          // If this is a different tab or URL, clean up numbers
          if (currentTabId && (currentTabId !== activeTab.id || currentUrl !== activeTab.url)) {
            if (showNumbers) {
              // Clean up numbers on the previous tab/page
              try {
                if (currentTabId !== activeTab.id && chrome.tabs.get) {
                  // Different tab - clean up the old tab
                  await chrome.scripting.executeScript({
                    target: { tabId: currentTabId },
                    func: removeNumbersFromElements
                  });
                }
              } catch (e) {
                // Tab might be closed, ignore error
              }
              
              // Reset state
              setShowNumbers(false);
              setNumberedElements([]);
              showFeedback('Page changed - numbers cleared');
            }
          }
          
          // Update current tab info
          setCurrentTabId(activeTab.id);
          setCurrentUrl(activeTab.url);
        }
      } catch (error) {
        // Ignore errors - might happen if tabs API is restricted
      }
    };

    // Check immediately
    checkTabChanges();

    // Set up interval to check for tab changes
    const interval = setInterval(checkTabChanges, 1000);

    return () => clearInterval(interval);
  }, [currentTabId, currentUrl, showNumbers]);

  // Also listen for tab activation changes
  useEffect(() => {
    const handleTabChange = () => {
      // Small delay to ensure tab info is updated
      setTimeout(async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab && currentTabId && currentTabId !== activeTab.id && showNumbers) {
            // Different tab activated, clean up numbers
            setShowNumbers(false);
            setNumberedElements([]);
            showFeedback('Switched tabs - numbers cleared');
          }
        } catch (e) {
          // Ignore errors
        }
      }, 100);
    };

    // Listen for window focus changes (which might indicate tab switches)
    window.addEventListener('focus', handleTabChange);
    window.addEventListener('visibilitychange', handleTabChange);

    return () => {
      window.removeEventListener('focus', handleTabChange);
      window.removeEventListener('visibilitychange', handleTabChange);
    };
  }, [currentTabId, showNumbers]);

  const showFeedback = (message, type = 'success') => {
    setFeedback(message);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback('');
    }, 3000);
  };

  const processVoiceCommand = async (command) => {
    try {
      console.log('Processing command:', command);
      
      // Tab switching commands
      if (command.includes('switch to tab') || command.includes('go to tab')) {
        await handleTabSwitch(command);
      }
      // Next/Previous tab
      else if (command.includes('next tab')) {
        await switchToNextTab();
      }
      else if (command.includes('previous tab') || command.includes('prev tab')) {
        await switchToPreviousTab();
      }
      // Tab management
      else if (command.includes('close tab')) {
        await closeCurrentTab();
      }
      else if (command.includes('new tab')) {
        await createNewTab();
      }
      else if (command.includes('duplicate tab')) {
        await duplicateCurrentTab();
      }
      else if (command.includes('reload tab') || command.includes('refresh tab')) {
        await reloadCurrentTab();
      }
      // Window management
      else if (command.includes('new window')) {
        await createNewWindow();
      }
      else if (command.includes('close window')) {
        await closeCurrentWindow();
      }
      // Tab search
      else if (command.includes('find tab') || command.includes('search tab')) {
        await findTab(command);
      }
      else if (command.includes('go to') && !command.includes('tab')) {
        await findTabByName(command);
      }
      // Search commands
      else if (command.includes('search for') || command.includes('google search') || command.includes('search google')) {
        await performWebSearch(command, 'google');
      }
      else if (command.includes('search') && (command.includes('youtube') || command.includes('you tube'))) {
        await performWebSearch(command, 'youtube');
      }
      else if (command.includes('search') && command.includes('perplexity')) {
        await performWebSearch(command, 'perplexity');
      }
      else if (command.includes('search') && (command.includes('chatgpt') || command.includes('chat gpt'))) {
        await performWebSearch(command, 'chatgpt');
      }
      else if (command.includes('search') && !command.includes('tab')) {
        await performWebSearch(command, 'google');
      }
      // Open specific websites
      else if (command.includes('open gmail') || command.includes('go to gmail')) {
        await openWebsite('https://mail.google.com');
      }
      else if (command.includes('open calendar') || command.includes('go to calendar')) {
        await openWebsite('https://calendar.google.com');
      }
      else if (command.includes('open youtube') || command.includes('go to youtube')) {
        await openWebsite('https://youtube.com');
      }
      else if (command.includes('open') || command.includes('go to website')) {
        await openWebsiteByName(command);
      }
      // Numbered clicking commands
      else if (command.match(/click (\d+)/) || command.match(/click number (\d+)/)) {
        await clickByNumber(command);
      }
      else if (command.includes('show numbers') || command.includes('number elements')) {
        await showElementNumbers();
      }
      else if (command.includes('hide numbers') || command.includes('clear numbers')) {
        await hideElementNumbers();
      }
      else if (command.includes('refresh numbers') || command.includes('reset numbers')) {
        await refreshNumbers();
      }
      // Link clicking commands
      else if (command.includes('click') || command.includes('click on')) {
        await clickLink(command);
      }
      else if (command.includes('follow') || command.includes('follow link')) {
        await clickLink(command.replace('follow link', 'click').replace('follow', 'click'));
      }
      // Page interaction commands
      else if (command.includes('scroll down')) {
        await scrollPage('down');
      }
      else if (command.includes('scroll up')) {
        await scrollPage('up');
      }
      else if (command.includes('go back') || command.includes('back')) {
        await goBack();
      }
      else if (command.includes('go forward') || command.includes('forward')) {
        await goForward();
      }
      else {
        showFeedback('Command not recognized. Try "switch to tab 2", "search for cats", "click subscribe", or "open gmail"', 'error');
      }
    } catch (error) {
      console.error('Error processing voice command:', error);
      showFeedback(`Error: ${error.message}`, 'error');
    }
  };

  // Tab switching functions
  const handleTabSwitch = async (command) => {
    const numberMatch = command.match(/tab (\d+)/);
    if (numberMatch) {
      const tabIndex = parseInt(numberMatch[1]) - 1;
      await switchToTabByIndex(tabIndex);
    } else {
      const nameMatch = command.match(/(?:switch to|go to) (.+?) tab/) || command.match(/(?:switch to|go to) (.+)/);
      if (nameMatch) {
        await findTabByName(nameMatch[1]);
      }
    }
  };

  const switchToTabByIndex = async (index) => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      if (index >= 0 && index < tabs.length) {
        await chrome.tabs.update(tabs[index].id, { active: true });
        showFeedback(`Switched to tab ${index + 1}: ${tabs[index].title}`);
      } else {
        showFeedback(`Tab ${index + 1} not found. Available tabs: 1-${tabs.length}`, 'error');
      }
    } catch (error) {
      throw new Error(`Failed to switch to tab: ${error.message}`);
    }
  };

  const switchToNextTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = tabs.find(tab => tab.active);
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
      const nextIndex = (currentIndex + 1) % tabs.length;
      
      await chrome.tabs.update(tabs[nextIndex].id, { active: true });
      showFeedback(`Switched to next tab: ${tabs[nextIndex].title}`);
    } catch (error) {
      throw new Error(`Failed to switch to next tab: ${error.message}`);
    }
  };

  const switchToPreviousTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = tabs.find(tab => tab.active);
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
      const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
      
      await chrome.tabs.update(tabs[prevIndex].id, { active: true });
      showFeedback(`Switched to previous tab: ${tabs[prevIndex].title}`);
    } catch (error) {
      throw new Error(`Failed to switch to previous tab: ${error.message}`);
    }
  };

  const findTabByName = async (searchTerm) => {
    try {
      const tabs = await chrome.tabs.query({});
      const cleanSearchTerm = searchTerm.replace(/^(go to|switch to)\s+/, '').trim();
      
      // Enhanced matching with multiple strategies
      const matchingTab = tabs.find(tab => {
        const title = tab.title.toLowerCase();
        const url = tab.url.toLowerCase();
        const search = cleanSearchTerm.toLowerCase();
        
        // Strategy 1: Direct word match (word boundaries)
        const wordMatch = new RegExp(`\\b${search}\\b`, 'i').test(title) || 
                         new RegExp(`\\b${search}\\b`, 'i').test(url);
        
        // Strategy 2: Starts with match
        const startsWithMatch = title.startsWith(search) || 
                               title.split(' ').some(word => word.startsWith(search));
        
        // Strategy 3: Contains match (original)
        const containsMatch = title.includes(search) || url.includes(search);
        
        return wordMatch || startsWithMatch || containsMatch;
      });

      if (matchingTab) {
        await chrome.tabs.update(matchingTab.id, { active: true });
        await chrome.windows.update(matchingTab.windowId, { focused: true });
        showFeedback(`Switched to: ${matchingTab.title}`);
      } else {
        // Enhanced error message with suggestions
        const similarTabs = tabs.filter(tab => {
          const title = tab.title.toLowerCase();
          return title.split(' ').some(word => 
            word.includes(cleanSearchTerm.toLowerCase()) || 
            cleanSearchTerm.toLowerCase().includes(word.substring(0, 3))
          );
        }).slice(0, 3);
        
        if (similarTabs.length > 0) {
          const suggestions = similarTabs.map(tab => `"${tab.title.split(' ')[0]}"`).join(', ');
          showFeedback(`No exact match for "${cleanSearchTerm}". Try: ${suggestions}`, 'error');
        } else {
          showFeedback(`No tab found matching "${cleanSearchTerm}"`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to find tab: ${error.message}`);
    }
  };

  // Tab management functions
  const closeCurrentTab = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.remove(activeTab.id);
      showFeedback('Tab closed');
    } catch (error) {
      throw new Error(`Failed to close tab: ${error.message}`);
    }
  };

  const createNewTab = async () => {
    try {
      const newTab = await chrome.tabs.create({});
      showFeedback('New tab created');
    } catch (error) {
      throw new Error(`Failed to create new tab: ${error.message}`);
    }
  };

  const duplicateCurrentTab = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.duplicate(activeTab.id);
      showFeedback(`Tab duplicated: ${activeTab.title}`);
    } catch (error) {
      throw new Error(`Failed to duplicate tab: ${error.message}`);
    }
  };

  const reloadCurrentTab = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.reload(activeTab.id);
      showFeedback('Tab reloaded');
    } catch (error) {
      throw new Error(`Failed to reload tab: ${error.message}`);
    }
  };

  // Window management functions
  const createNewWindow = async () => {
    try {
      await chrome.windows.create({});
      showFeedback('New window created');
    } catch (error) {
      throw new Error(`Failed to create new window: ${error.message}`);
    }
  };

  const closeCurrentWindow = async () => {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.windows.remove(currentWindow.id);
      showFeedback('Window closed');
    } catch (error) {
      throw new Error(`Failed to close window: ${error.message}`);
    }
  };

  const findTab = async (command) => {
    try {
      const searchMatch = command.match(/find tab (.+)/) || command.match(/search tab (.+)/);
      if (searchMatch) {
        const searchTerm = searchMatch[1].trim();
        const tabs = await chrome.tabs.query({});
        
        const matchingTabs = tabs.filter(tab => {
          const title = tab.title.toLowerCase();
          const url = tab.url.toLowerCase();
          const search = searchTerm.toLowerCase();
          
          // Enhanced matching with multiple strategies
          const wordMatch = new RegExp(`\\b${search}\\b`, 'i').test(title) || 
                           new RegExp(`\\b${search}\\b`, 'i').test(url);
          const startsWithMatch = title.startsWith(search) || 
                                 title.split(' ').some(word => word.startsWith(search));
          const containsMatch = title.includes(search) || url.includes(search);
          
          return wordMatch || startsWithMatch || containsMatch;
        });

        if (matchingTabs.length > 0) {
          const tabInfo = matchingTabs.map((tab, index) => `${index + 1}. ${tab.title}`).join(', ');
          showFeedback(`Found ${matchingTabs.length} tab(s): ${tabInfo}`);
          
          // Automatically switch to first match
          await chrome.tabs.update(matchingTabs[0].id, { active: true });
          await chrome.windows.update(matchingTabs[0].windowId, { focused: true });
        } else {
          showFeedback(`No tabs found matching "${searchTerm}"`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to search tabs: ${error.message}`);
    }
  };

  // Search and website functions
  const performWebSearch = async (command, engine = 'google') => {
    try {
      let searchTerm = '';
      
      // Extract search term from various command patterns
      if (command.includes('search for')) {
        searchTerm = command.replace(/.*search for\s+/, '').trim();
      } else if (command.includes('google search')) {
        searchTerm = command.replace(/.*google search\s+/, '').trim();
      } else if (command.includes('search google')) {
        searchTerm = command.replace(/.*search google\s+/, '').trim();
      } else if (command.includes('search')) {
        searchTerm = command.replace(/.*search\s+/, '').trim();
      }

      if (!searchTerm) {
        showFeedback('Please specify what to search for', 'error');
        return;
      }

      let searchUrl = '';
      let engineName = '';

      switch (engine.toLowerCase()) {
        case 'google':
          searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
          engineName = 'Google';
          break;
        case 'youtube':
          searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`;
          engineName = 'YouTube';
          break;
        case 'perplexity':
          searchUrl = `https://www.perplexity.ai/search?q=${encodeURIComponent(searchTerm)}`;
          engineName = 'Perplexity';
          break;
        case 'chatgpt':
          searchUrl = `https://chat.openai.com/?q=${encodeURIComponent(searchTerm)}`;
          engineName = 'ChatGPT';
          break;
        default:
          searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
          engineName = 'Google';
      }

      await chrome.tabs.create({ url: searchUrl });
      showFeedback(`Searching ${engineName} for "${searchTerm}"`);
    } catch (error) {
      throw new Error(`Failed to perform web search: ${error.message}`);
    }
  };

  const openWebsite = async (url) => {
    try {
      await chrome.tabs.create({ url });
      const domain = new URL(url).hostname.replace('www.', '');
      showFeedback(`Opened ${domain}`);
    } catch (error) {
      throw new Error(`Failed to open website: ${error.message}`);
    }
  };

  const openWebsiteByName = async (command) => {
    try {
      let siteName = '';
      
      if (command.includes('open')) {
        siteName = command.replace(/.*open\s+/, '').trim();
      } else if (command.includes('go to website')) {
        siteName = command.replace(/.*go to website\s+/, '').trim();
      }

      if (!siteName) {
        showFeedback('Please specify which website to open', 'error');
        return;
      }

      // Common website mappings
      const websiteMap = {
        'facebook': 'https://facebook.com',
        'twitter': 'https://twitter.com',
        'instagram': 'https://instagram.com',
        'linkedin': 'https://linkedin.com',
        'github': 'https://github.com',
        'stackoverflow': 'https://stackoverflow.com',
        'reddit': 'https://reddit.com',
        'wikipedia': 'https://wikipedia.org',
        'amazon': 'https://amazon.com',
        'netflix': 'https://netflix.com',
        'spotify': 'https://spotify.com',
        'discord': 'https://discord.com',
        'slack': 'https://slack.com',
        'zoom': 'https://zoom.us'
      };

      const normalizedName = siteName.toLowerCase().replace(/\s+/g, '');
      let url = websiteMap[normalizedName];

      if (!url) {
        // Try to construct URL if not in mapping
        if (!siteName.includes('.')) {
          url = `https://${siteName}.com`;
        } else {
          url = siteName.startsWith('http') ? siteName : `https://${siteName}`;
        }
      }

      await chrome.tabs.create({ url });
      showFeedback(`Opened ${siteName}`);
    } catch (error) {
      throw new Error(`Failed to open website: ${error.message}`);
    }
  };

  // Link clicking and page interaction functions
  const clickLink = async (command) => {
    try {
      let linkText = '';
      
      if (command.includes('click on')) {
        linkText = command.replace(/.*click on\s+/, '').trim();
      } else if (command.includes('click')) {
        linkText = command.replace(/.*click\s+/, '').trim();
      }

      if (!linkText) {
        showFeedback('Please specify what to click', 'error');
        return;
      }

      // Get the active tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Inject script to find and click the link
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: findAndClickLink,
        args: [linkText]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          showFeedback(`Clicked: ${result.elementText || linkText}`);
        } else {
          showFeedback(`Could not find clickable element: "${linkText}". ${result.suggestions || ''}`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to click link: ${error.message}`);
    }
  };

  const scrollPage = async (direction) => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: scrollPageFunction,
        args: [direction]
      });

      showFeedback(`Scrolled ${direction}`);
    } catch (error) {
      throw new Error(`Failed to scroll: ${error.message}`);
    }
  };

  const goBack = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => window.history.back()
      });
      showFeedback('Went back');
    } catch (error) {
      throw new Error(`Failed to go back: ${error.message}`);
    }
  };

  const goForward = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => window.history.forward()
      });
      showFeedback('Went forward');
    } catch (error) {
      throw new Error(`Failed to go forward: ${error.message}`);
    }
  };

  // Helper functions that will be injected into the page
  const findAndClickLink = (searchText) => {
    const searchLower = searchText.toLowerCase();
    
    // Strategy 1: Find by exact text match
    let elements = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]'));
    
    // Add clickable elements with common classes
    elements = elements.concat(Array.from(document.querySelectorAll('[class*="btn"], [class*="button"], [class*="link"], [class*="click"]')));
    
    // Find best match
    let bestMatch = null;
    let bestScore = 0;
    
    for (const element of elements) {
      if (!element.offsetParent && element.style.display !== 'none') continue; // Skip hidden elements
      
      const texts = [
        element.textContent || '',
        element.innerText || '',
        element.getAttribute('title') || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('alt') || '',
        element.getAttribute('value') || ''
      ];
      
      for (const text of texts) {
        if (!text) continue;
        const textLower = text.toLowerCase().trim();
        
        // Exact match gets highest score
        if (textLower === searchLower) {
          bestMatch = element;
          bestScore = 100;
          break;
        }
        
        // Word boundary match
        if (new RegExp(`\\b${searchLower}\\b`).test(textLower)) {
          const score = 80;
          if (score > bestScore) {
            bestMatch = element;
            bestScore = score;
          }
        }
        
        // Starts with match
        if (textLower.startsWith(searchLower)) {
          const score = 60;
          if (score > bestScore) {
            bestMatch = element;
            bestScore = score;
          }
        }
        
        // Contains match
        if (textLower.includes(searchLower)) {
          const score = 40;
          if (score > bestScore) {
            bestMatch = element;
            bestScore = score;
          }
        }
      }
      
      if (bestScore === 100) break; // Stop if we found exact match
    }
    
    if (bestMatch) {
      // Scroll element into view
      bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Highlight the element briefly
      const originalStyle = bestMatch.style.cssText;
      bestMatch.style.outline = '3px solid #ff4444';
      bestMatch.style.outlineOffset = '2px';
      
      setTimeout(() => {
        bestMatch.style.cssText = originalStyle;
      }, 1000);
      
      // Click the element
      setTimeout(() => {
        bestMatch.click();
      }, 200);
      
      return {
        success: true,
        elementText: bestMatch.textContent?.trim() || bestMatch.getAttribute('title') || bestMatch.getAttribute('aria-label')
      };
    } else {
      // Find suggestions for similar elements
      const suggestions = elements
        .filter(el => el.offsetParent || el.style.display !== 'none')
        .map(el => el.textContent?.trim() || el.getAttribute('title') || el.getAttribute('aria-label'))
        .filter(text => text && text.toLowerCase().includes(searchLower.substring(0, 3)))
        .slice(0, 3);
      
      return {
        success: false,
        suggestions: suggestions.length > 0 ? `Try: ${suggestions.join(', ')}` : ''
      };
    }
  };

  const scrollPageFunction = (direction) => {
    const scrollAmount = window.innerHeight * 0.8;
    window.scrollBy({
      top: direction === 'down' ? scrollAmount : -scrollAmount,
      behavior: 'smooth'
    });
  };

  // Numbered clicking functions
  const showElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: addNumbersToElements
      });

      if (results && results[0] && results[0].result) {
        const elementCount = results[0].result.count;
        setShowNumbers(true);
        setNumberedElements(results[0].result.elements || []);
        showFeedback(`Showing numbers on ${elementCount} clickable elements. Say "click 1" to "click ${elementCount}"`);
      }
    } catch (error) {
      throw new Error(`Failed to show numbers: ${error.message}`);
    }
  };

  const hideElementNumbers = async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: removeNumbersFromElements
      });

      setShowNumbers(false);
      setNumberedElements([]);
      showFeedback('Numbers hidden');
    } catch (error) {
      throw new Error(`Failed to hide numbers: ${error.message}`);
    }
  };

  const refreshNumbers = async () => {
    try {
      // First hide any existing numbers
      await hideElementNumbers();
      
      // Small delay to ensure cleanup is complete
      setTimeout(async () => {
        // Then show fresh numbers
        await showElementNumbers();
      }, 100);
      
    } catch (error) {
      throw new Error(`Failed to refresh numbers: ${error.message}`);
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
      
      if (clickNumber < 1) {
        showFeedback('Please use numbers starting from 1', 'error');
        return;
      }

      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: clickElementByNumber,
        args: [clickNumber]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          showFeedback(`Clicked element ${clickNumber}: ${result.elementText}`);
        } else {
          if (result.maxNumber) {
            showFeedback(`Element ${clickNumber} not found. Available: 1-${result.maxNumber}. Say "show numbers" first.`, 'error');
          } else {
            showFeedback('No numbered elements found. Say "show numbers" first.', 'error');
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to click by number: ${error.message}`);
    }
  };

  // Helper functions for numbered clicking
  const addNumbersToElements = () => {
    // Remove existing numbers first
    const existingNumbers = document.querySelectorAll('.voice-nav-number');
    existingNumbers.forEach(el => el.remove());

    // Remove existing scroll listener
    if (window.voiceNavScrollHandler) {
      window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
      delete window.voiceNavScrollHandler;
    }

    // Find all clickable elements
    const selectors = [
      'a', 'button', '[role="button"]', '[onclick]',
      'input[type="submit"]', 'input[type="button"]',
      '[class*="btn"]', '[class*="button"]', '[class*="link"]',
      '[tabindex="0"]', '[aria-clickable="true"]'
    ];
    
    let elements = [];
    selectors.forEach(selector => {
      const found = document.querySelectorAll(selector);
      elements.push(...Array.from(found));
    });

    // Filter visible and unique elements
    const visibleElements = elements.filter((el, index, arr) => {
      // Remove duplicates
      if (arr.indexOf(el) !== index) return false;
      
      // Check if element is visible
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && 
                       window.getComputedStyle(el).display !== 'none' &&
                       window.getComputedStyle(el).visibility !== 'hidden';
      
      // Check if element is in viewport or near it
      const isInViewport = rect.top < window.innerHeight + 200 && rect.bottom > -200;
      
      return isVisible && isInViewport;
    });

    // Limit to top 20 elements to avoid clutter
    const limitedElements = visibleElements.slice(0, 20);

    // Create container for all numbers
    const numberContainer = document.createElement('div');
    numberContainer.className = 'voice-nav-container';
    numberContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10000;
    `;
    document.body.appendChild(numberContainer);

    // Add numbers to elements
    const numberedElements = [];
    limitedElements.forEach((element, index) => {
      const number = index + 1;
      
      // Create number overlay with absolute positioning relative to document
      const numberEl = document.createElement('div');
      numberEl.className = 'voice-nav-number';
      numberEl.textContent = number;
      numberEl.setAttribute('data-element-index', number);
      numberEl.setAttribute('data-target-element', number);
      
      // Style the number with absolute positioning
      Object.assign(numberEl.style, {
        position: 'absolute',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        backgroundColor: '#ff4444',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 'bold',
        border: '2px solid white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        fontFamily: 'Arial, sans-serif',
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease'
      });

      numberContainer.appendChild(numberEl);
      
      // Store element reference
      element.setAttribute('data-voice-nav-number', number);
      numberedElements.push({
        number: number,
        element: element,
        numberEl: numberEl,
        text: element.textContent?.trim() || element.getAttribute('title') || element.getAttribute('aria-label') || `Element ${number}`
      });
    });

    // Function to update positions
    const updateNumberPositions = () => {
      numberedElements.forEach(item => {
        const rect = item.element.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        // Check if element is still visible in viewport
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0 && 
                          rect.left < window.innerWidth && rect.right > 0;
        
        if (isVisible && rect.width > 0 && rect.height > 0) {
          // Position relative to document
          item.numberEl.style.top = `${rect.top + scrollTop - 8}px`;
          item.numberEl.style.left = `${rect.left + scrollLeft - 8}px`;
          item.numberEl.style.opacity = '1';
        } else {
          // Hide numbers for elements not in viewport
          item.numberEl.style.opacity = '0.3';
        }
      });
    };

    // Initial positioning
    updateNumberPositions();

    // Add scroll listener with throttling
    let scrollTimeout;
    const scrollHandler = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(updateNumberPositions, 16); // ~60fps
    };

    // Store handler for cleanup
    window.voiceNavScrollHandler = scrollHandler;
    
    // Listen to scroll events on window and all scrollable elements
    window.addEventListener('scroll', scrollHandler, true);
    
    // Also listen for resize events
    window.addEventListener('resize', scrollHandler);

    return {
      count: limitedElements.length,
      elements: numberedElements.map(item => ({
        number: item.number,
        text: item.text
      }))
    };
  };

  const removeNumbersFromElements = () => {
    // Remove number elements and container
    const numberContainer = document.querySelector('.voice-nav-container');
    if (numberContainer) {
      numberContainer.remove();
    }
    
    const numberElements = document.querySelectorAll('.voice-nav-number');
    numberElements.forEach(el => el.remove());
    
    // Remove scroll listener
    if (window.voiceNavScrollHandler) {
      window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
      window.removeEventListener('resize', window.voiceNavScrollHandler);
      delete window.voiceNavScrollHandler;
    }
    
    // Clean up element attributes
    const numberedElements = document.querySelectorAll('[data-voice-nav-number]');
    numberedElements.forEach(el => el.removeAttribute('data-voice-nav-number'));
  };

  const clickElementByNumber = (number) => {
    const element = document.querySelector(`[data-voice-nav-number="${number}"]`);
    
    if (!element) {
      const maxNumber = document.querySelectorAll('[data-voice-nav-number]').length;
      return {
        success: false,
        maxNumber: maxNumber > 0 ? maxNumber : null
      };
    }

    // Scroll element into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Highlight the element briefly
    const originalStyle = element.style.cssText;
    element.style.outline = '3px solid #00ff00';
    element.style.outlineOffset = '2px';
    
    setTimeout(() => {
      element.style.cssText = originalStyle;
    }, 1000);
    
    // Click the element
    setTimeout(() => {
      element.click();
    }, 200);
    
    return {
      success: true,
      elementText: element.textContent?.trim() || element.getAttribute('title') || element.getAttribute('aria-label') || `Element ${number}`
    };
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setTranscript('');
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  };

  return (
    <div className="voice-navigation">
      <div className="voice-controls">
        <button
          onClick={startListening}
          disabled={isListening || !!error}
          className={`voice-btn ${isListening ? 'listening' : ''}`}
        >
          {isListening ? '<� Listening...' : '<� Start Voice Control'}
        </button>
        
        {isListening && (
          <button onClick={stopListening} className="voice-btn stop-btn">
            � Stop
          </button>
        )}

        <button
          onClick={showNumbers ? hideElementNumbers : showElementNumbers}
          className={`voice-btn ${showNumbers ? 'active-numbers' : ''}`}
          title={showNumbers ? "Hide element numbers" : "Show element numbers for easy clicking"}
        >
          {showNumbers ? '🔢 Hide Numbers' : '🔢 Show Numbers'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      
      {transcript && (
        <div className="transcript">
          <strong>You said:</strong> {transcript}
        </div>
      )}

      {feedback && (
        <div className={`feedback ${feedback.includes('Error') || feedback.includes('not found') || feedback.includes('not recognized') ? 'error' : 'success'}`}>
          {feedback}
        </div>
      )}

      <div className="voice-commands-help">
        <h3>Voice Commands:</h3>
        <ul>
          <li><strong>Tab Navigation:</strong> "Switch to tab 2", "Next tab", "Previous tab"</li>
          <li><strong>Tab Search:</strong> "Go to Gmail", "Find tab YouTube"</li>
          <li><strong>Tab Management:</strong> "Close tab", "New tab", "Duplicate tab", "Reload tab"</li>
          <li><strong>Window Management:</strong> "New window", "Close window"</li>
          <li><strong>Web Search:</strong> "Search for cats", "Google search dogs", "Search YouTube music"</li>
          <li><strong>Open Websites:</strong> "Open Gmail", "Open YouTube", "Open Facebook", "Open GitHub"</li>
          <li><strong>AI Search:</strong> "Search Perplexity AI", "Search ChatGPT machine learning"</li>
          <li><strong>Click Links:</strong> "Click subscribe", "Click on login", "Follow link", "Click next"</li>
          <li><strong>Numbered Clicking:</strong> "Show numbers", "Click 3", "Hide numbers", "Refresh numbers"</li>
          <li><strong>Page Navigation:</strong> "Scroll down", "Scroll up", "Go back", "Go forward"</li>
        </ul>
      </div>

      <style jsx>{`
        .voice-navigation {
          padding: 20px;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 8px;
          margin: 10px 0;
        }

        .voice-controls {
          display: flex;
          gap: 10px;
          margin-bottom: 15px;
        }

        .voice-btn {
          padding: 12px 20px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .voice-btn:not(.stop-btn) {
          background: #4CAF50;
          color: white;
        }

        .voice-btn.listening {
          background: #ff4444;
          animation: pulse 1.5s infinite;
        }

        .stop-btn {
          background: #f44336;
          color: white;
        }

        .voice-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .voice-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .voice-btn.active-numbers {
          background: #2196F3;
          color: white;
        }

        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
        }

        .error-message {
          background: #ffebee;
          color: #c62828;
          padding: 10px;
          border-radius: 4px;
          margin: 10px 0;
          border-left: 4px solid #c62828;
        }

        .transcript {
          background: #e3f2fd;
          color: #1565c0;
          padding: 10px;
          border-radius: 4px;
          margin: 10px 0;
          border-left: 4px solid #1565c0;
        }

        .feedback {
          padding: 10px;
          border-radius: 4px;
          margin: 10px 0;
          border-left: 4px solid;
        }

        .feedback.success {
          background: #e8f5e8;
          color: #2e7d32;
          border-left-color: #2e7d32;
        }

        .feedback.error {
          background: #ffebee;
          color: #c62828;
          border-left-color: #c62828;
        }

        .voice-commands-help {
          background: var(--bg-primary, white);
          padding: 15px;
          border-radius: 6px;
          margin-top: 20px;
          border: 1px solid var(--border-color, #e0e0e0);
        }

        .voice-commands-help h3 {
          margin-top: 0;
          color: var(--text-primary, #333);
        }

        .voice-commands-help ul {
          margin: 10px 0;
          padding-left: 20px;
        }

        .voice-commands-help li {
          margin: 8px 0;
          color: var(--text-secondary, #666);
        }
      `}</style>
    </div>
  );
};

export default VoiceNavigation;