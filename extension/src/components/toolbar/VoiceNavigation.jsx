// import React, { useEffect, useRef, useState } from 'react';


// const VoiceNavigation = () => {
//   const [isListening, setIsListening] = useState(false);
//   const [transcript, setTranscript] = useState('');
//   const [feedback, setFeedback] = useState('');
//   const [error, setError] = useState('');
//   const [showNumbers, setShowNumbers] = useState(false);
//   const [numberedElements, setNumberedElements] = useState([]);
//   const [currentUrl, setCurrentUrl] = useState('');
//   const [currentTabId, setCurrentTabId] = useState(null);
//   const [markingMode, setMarkingMode] = useState('interactive'); // 'interactive' or 'content'
//   const [isCollapsed, setIsCollapsed] = useState(true); // Start collapsed
//   const [showHelp, setShowHelp] = useState(false); // Help section toggle
//   const [currentTheme, setCurrentTheme] = useState('ai-midnight-nebula');
//   const recognitionRef = useRef(null);
//   const feedbackTimeoutRef = useRef(null);

//   useEffect(() => {
//     // Check if browser supports speech recognition
//     if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
//       setError('Speech recognition not supported in this browser');
//       return;
//     }

//     // Initialize speech recognition
//     const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
//     const recognition = new SpeechRecognition();

//     recognition.continuous = true;
//     recognition.interimResults = true;
//     recognition.lang = 'en-US';

//     recognition.onstart = () => {
//       setIsListening(true);
//       setError('');
//       showFeedback('Listening...', 'info');
//     };

//     recognition.onend = () => {
//       setIsListening(false);
//       showFeedback('Stopped listening', 'info');
//     };

//     recognition.onerror = (event) => {
//       setError(`Speech recognition error: ${event.error}`);
//       setIsListening(false);
//     };

//     recognition.onresult = (event) => {
//       let finalTranscript = '';
//       let interimTranscript = '';

//       for (let i = event.resultIndex; i < event.results.length; i++) {
//         if (event.results[i].isFinal) {
//           finalTranscript += event.results[i][0].transcript;
//         } else {
//           interimTranscript += event.results[i][0].transcript;
//         }
//       }

//       setTranscript(finalTranscript || interimTranscript);

//       if (finalTranscript) {
//         processVoiceCommand(finalTranscript.trim().toLowerCase());
//       }
//     };

//     recognitionRef.current = recognition;

//     return () => {
//       if (recognitionRef.current) {
//         recognitionRef.current.stop();
//       }
//     };
//   }, []);

//   // Load theme from localStorage
//   useEffect(() => {
//     const savedTheme = localStorage.getItem('cooldesk-theme');
//     if (savedTheme) {
//       setCurrentTheme(savedTheme);
//     }
//   }, []);

//   // Listen for theme changes
//   useEffect(() => {
//     const handleStorageChange = (e) => {
//       if (e.key === 'cooldesk-theme') {
//         setCurrentTheme(e.newValue || 'ai-midnight-nebula');
//       }
//     };

//     window.addEventListener('storage', handleStorageChange);

//     // Also listen for custom theme change events
//     const handleThemeChange = (e) => {
//       setCurrentTheme(e.detail || 'ai-midnight-nebula');
//     };

//     window.addEventListener('themeChanged', handleThemeChange);

//     return () => {
//       window.removeEventListener('storage', handleStorageChange);
//       window.removeEventListener('themeChanged', handleThemeChange);
//     };
//   }, []);

//   // Monitor tab changes and clean up numbers when page changes
//   useEffect(() => {
//     const checkTabChanges = async () => {
//       try {
//         const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//         if (activeTab) {
//           // If this is a different tab or URL, clean up numbers
//           if (currentTabId && (currentTabId !== activeTab.id || currentUrl !== activeTab.url)) {
//             if (showNumbers) {
//               // Clean up numbers on the previous tab/page
//               try {
//                 if (currentTabId !== activeTab.id && chrome.tabs.get) {
//                   // Different tab - clean up the old tab
//                   await chrome.scripting.executeScript({
//                     target: { tabId: currentTabId },
//                     func: removeNumbersFromElements
//                   });
//                 }
//               } catch (e) {
//                 // Tab might be closed, ignore error
//               }

//               // Reset state
//               setShowNumbers(false);
//               setNumberedElements([]);
//               showFeedback('Page changed - numbers cleared');
//             }
//           }

//           // Update current tab info
//           setCurrentTabId(activeTab.id);
//           setCurrentUrl(activeTab.url);
//         }
//       } catch (error) {
//         // Ignore errors - might happen if tabs API is restricted
//       }
//     };

//     // Check immediately
//     checkTabChanges();

//     // Set up interval to check for tab changes
//     const interval = setInterval(checkTabChanges, 1000);

//     return () => clearInterval(interval);
//   }, [currentTabId, currentUrl, showNumbers]);

//   // Also listen for tab activation changes
//   useEffect(() => {
//     const handleTabChange = () => {
//       // Small delay to ensure tab info is updated
//       setTimeout(async () => {
//         try {
//           const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//           if (activeTab && currentTabId && currentTabId !== activeTab.id && showNumbers) {
//             // Different tab activated, clean up numbers
//             setShowNumbers(false);
//             setNumberedElements([]);
//             showFeedback('Switched tabs - numbers cleared');
//           }
//         } catch (e) {
//           // Ignore errors
//         }
//       }, 100);
//     };

//     // Listen for window focus changes (which might indicate tab switches)
//     window.addEventListener('focus', handleTabChange);
//     window.addEventListener('visibilitychange', handleTabChange);

//     return () => {
//       window.removeEventListener('focus', handleTabChange);
//       window.removeEventListener('visibilitychange', handleTabChange);
//     };
//   }, [currentTabId, showNumbers]);

//   const showFeedback = (message, type = 'success') => {
//     setFeedback(message);
//     if (feedbackTimeoutRef.current) {
//       clearTimeout(feedbackTimeoutRef.current);
//     }
//     feedbackTimeoutRef.current = setTimeout(() => {
//       setFeedback('');
//     }, 3000);
//   };

//   const processVoiceCommand = async (command) => {
//     try {
//       console.log('Processing command:', command);

//       // Tab switching commands
//       if (command.includes('switch to tab') || command.includes('go to tab')) {
//         await handleTabSwitch(command);
//       }
//       // Next/Previous tab
//       else if (command.includes('next tab')) {
//         await switchToNextTab();
//       }
//       else if (command.includes('previous tab') || command.includes('prev tab')) {
//         await switchToPreviousTab();
//       }
//       // Tab management
//       else if (command.includes('close tab')) {
//         await closeCurrentTab();
//       }
//       else if (command.includes('new tab')) {
//         await createNewTab();
//       }
//       else if (command.includes('duplicate tab')) {
//         await duplicateCurrentTab();
//       }
//       else if (command.includes('reload tab') || command.includes('refresh tab')) {
//         await reloadCurrentTab();
//       }
//       // Window management
//       else if (command.includes('new window')) {
//         await createNewWindow();
//       }
//       else if (command.includes('close window')) {
//         await closeCurrentWindow();
//       }
//       // Tab search
//       else if (command.includes('find tab') || command.includes('search tab')) {
//         await findTab(command);
//       }
//       else if (command.includes('go to') && !command.includes('tab')) {
//         await findTabByName(command);
//       }
//       // Search commands
//       else if (command.includes('search for') || command.includes('google search') || command.includes('search google')) {
//         await performWebSearch(command, 'google');
//       }
//       else if (command.includes('search') && (command.includes('youtube') || command.includes('you tube'))) {
//         await performWebSearch(command, 'youtube');
//       }
//       else if (command.includes('search') && command.includes('perplexity')) {
//         await performWebSearch(command, 'perplexity');
//       }
//       else if (command.includes('search') && (command.includes('chatgpt') || command.includes('chat gpt'))) {
//         await performWebSearch(command, 'chatgpt');
//       }
//       else if (command.includes('search') && !command.includes('tab')) {
//         await performWebSearch(command, 'google');
//       }
//       // Open specific websites
//       else if (command.includes('open gmail') || command.includes('go to gmail')) {
//         await openWebsite('https://mail.google.com');
//       }
//       else if (command.includes('open calendar') || command.includes('go to calendar')) {
//         await openWebsite('https://calendar.google.com');
//       }
//       else if (command.includes('open youtube') || command.includes('go to youtube')) {
//         await openWebsite('https://youtube.com');
//       }
//       else if (command.includes('open') || command.includes('go to website')) {
//         await openWebsiteByName(command);
//       }
//       // Numbered clicking commands
//       else if (command.match(/click (\d+)/) || command.match(/click number (\d+)/)) {
//         await clickByNumber(command);
//       }
//       else if (command.includes('show numbers') || command.includes('number elements')) {
//         await showElementNumbers();
//       }
//       else if (command.includes('hide numbers') || command.includes('clear numbers')) {
//         await hideElementNumbers();
//       }
//       else if (command.includes('refresh numbers') || command.includes('reset numbers')) {
//         await refreshNumbers();
//       }
//       else if (command.includes('update numbers') || command.includes('reload numbers')) {
//         await refreshNumbers();
//       }
//       else if (command.includes('mark content') || command.includes('show content') || command.includes('content mode')) {
//         await switchToContentMode();
//       }
//       else if (command.includes('mark buttons') || command.includes('interactive mode') || command.includes('button mode')) {
//         await switchToInteractiveMode();
//       }
//       else if (command.includes('read') && command.match(/read (\\d+)/)) {
//         await readContentByNumber(command);
//       }
//       // Link clicking commands
//       else if (command.includes('click') || command.includes('click on')) {
//         await clickLink(command);
//       }
//       else if (command.includes('follow') || command.includes('follow link')) {
//         await clickLink(command.replace('follow link', 'click').replace('follow', 'click'));
//       }
//       // Page interaction commands
//       else if (command.includes('scroll down')) {
//         await scrollPage('down');
//       }
//       else if (command.includes('scroll up')) {
//         await scrollPage('up');
//       }
//       else if (command.includes('go back') || command.includes('back')) {
//         await goBack();
//       }
//       else if (command.includes('go forward') || command.includes('forward')) {
//         await goForward();
//       }
//       else {
//         showFeedback('Command not recognized. Try "switch to tab 2", "search for cats", "click subscribe", or "open gmail"', 'error');
//       }
//     } catch (error) {
//       console.error('Error processing voice command:', error);
//       showFeedback(`Error: ${error.message}`, 'error');
//     }
//   };

//   // Tab switching functions
//   const handleTabSwitch = async (command) => {
//     const numberMatch = command.match(/tab (\d+)/);
//     if (numberMatch) {
//       const tabIndex = parseInt(numberMatch[1]) - 1;
//       await switchToTabByIndex(tabIndex);
//     } else {
//       const nameMatch = command.match(/(?:switch to|go to) (.+?) tab/) || command.match(/(?:switch to|go to) (.+)/);
//       if (nameMatch) {
//         await findTabByName(nameMatch[1]);
//       }
//     }
//   };

//   const switchToTabByIndex = async (index) => {
//     try {
//       const tabs = await chrome.tabs.query({ currentWindow: true });
//       if (index >= 0 && index < tabs.length) {
//         await chrome.tabs.update(tabs[index].id, { active: true });
//         showFeedback(`Switched to tab ${index + 1}: ${tabs[index].title}`);
//       } else {
//         showFeedback(`Tab ${index + 1} not found. Available tabs: 1-${tabs.length}`, 'error');
//       }
//     } catch (error) {
//       throw new Error(`Failed to switch to tab: ${error.message}`);
//     }
//   };

//   const switchToNextTab = async () => {
//     try {
//       const tabs = await chrome.tabs.query({ currentWindow: true });
//       const activeTab = tabs.find(tab => tab.active);
//       const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
//       const nextIndex = (currentIndex + 1) % tabs.length;

//       await chrome.tabs.update(tabs[nextIndex].id, { active: true });
//       showFeedback(`Switched to next tab: ${tabs[nextIndex].title}`);
//     } catch (error) {
//       throw new Error(`Failed to switch to next tab: ${error.message}`);
//     }
//   };

//   const switchToPreviousTab = async () => {
//     try {
//       const tabs = await chrome.tabs.query({ currentWindow: true });
//       const activeTab = tabs.find(tab => tab.active);
//       const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
//       const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;

//       await chrome.tabs.update(tabs[prevIndex].id, { active: true });
//       showFeedback(`Switched to previous tab: ${tabs[prevIndex].title}`);
//     } catch (error) {
//       throw new Error(`Failed to switch to previous tab: ${error.message}`);
//     }
//   };

//   const findTabByName = async (searchTerm) => {
//     try {
//       const tabs = await chrome.tabs.query({});
//       const cleanSearchTerm = searchTerm.replace(/^(go to|switch to)\s+/, '').trim();

//       // Enhanced matching with multiple strategies
//       const matchingTab = tabs.find(tab => {
//         const title = tab.title.toLowerCase();
//         const url = tab.url.toLowerCase();
//         const search = cleanSearchTerm.toLowerCase();

//         // Strategy 1: Direct word match (word boundaries)
//         const wordMatch = new RegExp(`\\b${search}\\b`, 'i').test(title) ||
//           new RegExp(`\\b${search}\\b`, 'i').test(url);

//         // Strategy 2: Starts with match
//         const startsWithMatch = title.startsWith(search) ||
//           title.split(' ').some(word => word.startsWith(search));

//         // Strategy 3: Contains match (original)
//         const containsMatch = title.includes(search) || url.includes(search);

//         return wordMatch || startsWithMatch || containsMatch;
//       });

//       if (matchingTab) {
//         await chrome.tabs.update(matchingTab.id, { active: true });
//         await chrome.windows.update(matchingTab.windowId, { focused: true });
//         showFeedback(`Switched to: ${matchingTab.title}`);
//       } else {
//         // Enhanced error message with suggestions
//         const similarTabs = tabs.filter(tab => {
//           const title = tab.title.toLowerCase();
//           return title.split(' ').some(word =>
//             word.includes(cleanSearchTerm.toLowerCase()) ||
//             cleanSearchTerm.toLowerCase().includes(word.substring(0, 3))
//           );
//         }).slice(0, 3);

//         if (similarTabs.length > 0) {
//           const suggestions = similarTabs.map(tab => `"${tab.title.split(' ')[0]}"`).join(', ');
//           showFeedback(`No exact match for "${cleanSearchTerm}". Try: ${suggestions}`, 'error');
//         } else {
//           showFeedback(`No tab found matching "${cleanSearchTerm}"`, 'error');
//         }
//       }
//     } catch (error) {
//       throw new Error(`Failed to find tab: ${error.message}`);
//     }
//   };

//   // Tab management functions
//   const closeCurrentTab = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//       await chrome.tabs.remove(activeTab.id);
//       showFeedback('Tab closed');
//     } catch (error) {
//       throw new Error(`Failed to close tab: ${error.message}`);
//     }
//   };

//   const createNewTab = async () => {
//     try {
//       const newTab = await chrome.tabs.create({});
//       showFeedback('New tab created');
//     } catch (error) {
//       throw new Error(`Failed to create new tab: ${error.message}`);
//     }
//   };

//   const duplicateCurrentTab = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//       await chrome.tabs.duplicate(activeTab.id);
//       showFeedback(`Tab duplicated: ${activeTab.title}`);
//     } catch (error) {
//       throw new Error(`Failed to duplicate tab: ${error.message}`);
//     }
//   };

//   const reloadCurrentTab = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//       await chrome.tabs.reload(activeTab.id);
//       showFeedback('Tab reloaded');
//     } catch (error) {
//       throw new Error(`Failed to reload tab: ${error.message}`);
//     }
//   };

//   // Window management functions
//   const createNewWindow = async () => {
//     try {
//       await chrome.windows.create({});
//       showFeedback('New window created');
//     } catch (error) {
//       throw new Error(`Failed to create new window: ${error.message}`);
//     }
//   };

//   const closeCurrentWindow = async () => {
//     try {
//       const currentWindow = await chrome.windows.getCurrent();
//       await chrome.windows.remove(currentWindow.id);
//       showFeedback('Window closed');
//     } catch (error) {
//       throw new Error(`Failed to close window: ${error.message}`);
//     }
//   };

//   const findTab = async (command) => {
//     try {
//       const searchMatch = command.match(/find tab (.+)/) || command.match(/search tab (.+)/);
//       if (searchMatch) {
//         const searchTerm = searchMatch[1].trim();
//         const tabs = await chrome.tabs.query({});

//         const matchingTabs = tabs.filter(tab => {
//           const title = tab.title.toLowerCase();
//           const url = tab.url.toLowerCase();
//           const search = searchTerm.toLowerCase();

//           // Enhanced matching with multiple strategies
//           const wordMatch = new RegExp(`\\b${search}\\b`, 'i').test(title) ||
//             new RegExp(`\\b${search}\\b`, 'i').test(url);
//           const startsWithMatch = title.startsWith(search) ||
//             title.split(' ').some(word => word.startsWith(search));
//           const containsMatch = title.includes(search) || url.includes(search);

//           return wordMatch || startsWithMatch || containsMatch;
//         });

//         if (matchingTabs.length > 0) {
//           const tabInfo = matchingTabs.map((tab, index) => `${index + 1}. ${tab.title}`).join(', ');
//           showFeedback(`Found ${matchingTabs.length} tab(s): ${tabInfo}`);

//           // Automatically switch to first match
//           await chrome.tabs.update(matchingTabs[0].id, { active: true });
//           await chrome.windows.update(matchingTabs[0].windowId, { focused: true });
//         } else {
//           showFeedback(`No tabs found matching "${searchTerm}"`, 'error');
//         }
//       }
//     } catch (error) {
//       throw new Error(`Failed to search tabs: ${error.message}`);
//     }
//   };

//   // Search and website functions
//   const performWebSearch = async (command, engine = 'google') => {
//     try {
//       let searchTerm = '';

//       // Extract search term from various command patterns
//       if (command.includes('search for')) {
//         searchTerm = command.replace(/.*search for\s+/, '').trim();
//       } else if (command.includes('google search')) {
//         searchTerm = command.replace(/.*google search\s+/, '').trim();
//       } else if (command.includes('search google')) {
//         searchTerm = command.replace(/.*search google\s+/, '').trim();
//       } else if (command.includes('search')) {
//         searchTerm = command.replace(/.*search\s+/, '').trim();
//       }

//       if (!searchTerm) {
//         showFeedback('Please specify what to search for', 'error');
//         return;
//       }

//       let searchUrl = '';
//       let engineName = '';

//       switch (engine.toLowerCase()) {
//         case 'google':
//           searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
//           engineName = 'Google';
//           break;
//         case 'youtube':
//           searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`;
//           engineName = 'YouTube';
//           break;
//         case 'perplexity':
//           searchUrl = `https://www.perplexity.ai/search?q=${encodeURIComponent(searchTerm)}`;
//           engineName = 'Perplexity';
//           break;
//         case 'chatgpt':
//           searchUrl = `https://chat.openai.com/?q=${encodeURIComponent(searchTerm)}`;
//           engineName = 'ChatGPT';
//           break;
//         default:
//           searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
//           engineName = 'Google';
//       }

//       await chrome.tabs.create({ url: searchUrl });
//       showFeedback(`Searching ${engineName} for "${searchTerm}"`);
//     } catch (error) {
//       throw new Error(`Failed to perform web search: ${error.message}`);
//     }
//   };

//   const openWebsite = async (url) => {
//     try {
//       await chrome.tabs.create({ url });
//       const domain = new URL(url).hostname.replace('www.', '');
//       showFeedback(`Opened ${domain}`);
//     } catch (error) {
//       throw new Error(`Failed to open website: ${error.message}`);
//     }
//   };

//   const openWebsiteByName = async (command) => {
//     try {
//       let siteName = '';

//       if (command.includes('open')) {
//         siteName = command.replace(/.*open\s+/, '').trim();
//       } else if (command.includes('go to website')) {
//         siteName = command.replace(/.*go to website\s+/, '').trim();
//       }

//       if (!siteName) {
//         showFeedback('Please specify which website to open', 'error');
//         return;
//       }

//       // Common website mappings
//       const websiteMap = {
//         'facebook': 'https://facebook.com',
//         'twitter': 'https://twitter.com',
//         'instagram': 'https://instagram.com',
//         'linkedin': 'https://linkedin.com',
//         'github': 'https://github.com',
//         'stackoverflow': 'https://stackoverflow.com',
//         'reddit': 'https://reddit.com',
//         'wikipedia': 'https://wikipedia.org',
//         'amazon': 'https://amazon.com',
//         'netflix': 'https://netflix.com',
//         'spotify': 'https://spotify.com',
//         'discord': 'https://discord.com',
//         'slack': 'https://slack.com',
//         'zoom': 'https://zoom.us'
//       };

//       const normalizedName = siteName.toLowerCase().replace(/\s+/g, '');
//       let url = websiteMap[normalizedName];

//       if (!url) {
//         // Try to construct URL if not in mapping
//         if (!siteName.includes('.')) {
//           url = `https://${siteName}.com`;
//         } else {
//           url = siteName.startsWith('http') ? siteName : `https://${siteName}`;
//         }
//       }

//       await chrome.tabs.create({ url });
//       showFeedback(`Opened ${siteName}`);
//     } catch (error) {
//       throw new Error(`Failed to open website: ${error.message}`);
//     }
//   };

//   // Link clicking and page interaction functions
//   const clickLink = async (command) => {
//     try {
//       let linkText = '';

//       if (command.includes('click on')) {
//         linkText = command.replace(/.*click on\s+/, '').trim();
//       } else if (command.includes('click')) {
//         linkText = command.replace(/.*click\s+/, '').trim();
//       }

//       if (!linkText) {
//         showFeedback('Please specify what to click', 'error');
//         return;
//       }

//       // Get the active tab
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       // Inject script to find and click the link
//       const results = await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: findAndClickLink,
//         args: [linkText]
//       });

//       if (results && results[0] && results[0].result) {
//         const result = results[0].result;
//         if (result.success) {
//           showFeedback(`Clicked: ${result.elementText || linkText}`);
//         } else {
//           showFeedback(`Could not find clickable element: "${linkText}". ${result.suggestions || ''}`, 'error');
//         }
//       }
//     } catch (error) {
//       throw new Error(`Failed to click link: ${error.message}`);
//     }
//   };

//   const scrollPage = async (direction) => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: scrollPageFunction,
//         args: [direction]
//       });

//       showFeedback(`Scrolled ${direction}`);
//     } catch (error) {
//       throw new Error(`Failed to scroll: ${error.message}`);
//     }
//   };

//   const goBack = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//       await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: () => window.history.back()
//       });
//       showFeedback('Went back');
//     } catch (error) {
//       throw new Error(`Failed to go back: ${error.message}`);
//     }
//   };

//   const goForward = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//       await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: () => window.history.forward()
//       });
//       showFeedback('Went forward');
//     } catch (error) {
//       throw new Error(`Failed to go forward: ${error.message}`);
//     }
//   };

//   // Helper functions that will be injected into the page
//   const findAndClickLink = (searchText) => {
//     const searchLower = searchText.toLowerCase();

//     // Strategy 1: Find by exact text match
//     let elements = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]'));

//     // Add clickable elements with common classes
//     elements = elements.concat(Array.from(document.querySelectorAll('[class*="btn"], [class*="button"], [class*="link"], [class*="click"]')));

//     // Find best match
//     let bestMatch = null;
//     let bestScore = 0;

//     for (const element of elements) {
//       if (!element.offsetParent && element.style.display !== 'none') continue; // Skip hidden elements

//       const texts = [
//         element.textContent || '',
//         element.innerText || '',
//         element.getAttribute('title') || '',
//         element.getAttribute('aria-label') || '',
//         element.getAttribute('alt') || '',
//         element.getAttribute('value') || ''
//       ];

//       for (const text of texts) {
//         if (!text) continue;
//         const textLower = text.toLowerCase().trim();

//         // Exact match gets highest score
//         if (textLower === searchLower) {
//           bestMatch = element;
//           bestScore = 100;
//           break;
//         }

//         // Word boundary match
//         if (new RegExp(`\\b${searchLower}\\b`).test(textLower)) {
//           const score = 80;
//           if (score > bestScore) {
//             bestMatch = element;
//             bestScore = score;
//           }
//         }

//         // Starts with match
//         if (textLower.startsWith(searchLower)) {
//           const score = 60;
//           if (score > bestScore) {
//             bestMatch = element;
//             bestScore = score;
//           }
//         }

//         // Contains match
//         if (textLower.includes(searchLower)) {
//           const score = 40;
//           if (score > bestScore) {
//             bestMatch = element;
//             bestScore = score;
//           }
//         }
//       }

//       if (bestScore === 100) break; // Stop if we found exact match
//     }

//     if (bestMatch) {
//       // Scroll element into view
//       bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

//       // Highlight the element briefly
//       const originalStyle = bestMatch.style.cssText;
//       bestMatch.style.outline = '3px solid #ff4444';
//       bestMatch.style.outlineOffset = '2px';

//       setTimeout(() => {
//         bestMatch.style.cssText = originalStyle;
//       }, 1000);

//       // Click the element
//       setTimeout(() => {
//         bestMatch.click();
//       }, 200);

//       return {
//         success: true,
//         elementText: bestMatch.textContent?.trim() || bestMatch.getAttribute('title') || bestMatch.getAttribute('aria-label')
//       };
//     } else {
//       // Find suggestions for similar elements
//       const suggestions = elements
//         .filter(el => el.offsetParent || el.style.display !== 'none')
//         .map(el => el.textContent?.trim() || el.getAttribute('title') || el.getAttribute('aria-label'))
//         .filter(text => text && text.toLowerCase().includes(searchLower.substring(0, 3)))
//         .slice(0, 3);

//       return {
//         success: false,
//         suggestions: suggestions.length > 0 ? `Try: ${suggestions.join(', ')}` : ''
//       };
//     }
//   };

//   const scrollPageFunction = (direction) => {
//     const scrollAmount = window.innerHeight * 0.8;
//     window.scrollBy({
//       top: direction === 'down' ? scrollAmount : -scrollAmount,
//       behavior: 'smooth'
//     });
//   };

//   // Numbered clicking functions
//   const showElementNumbers = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       const results = await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: addNumbersToElements
//       });

//       if (results && results[0] && results[0].result) {
//         const elementCount = results[0].result.count;
//         setShowNumbers(true);
//         setNumberedElements(results[0].result.elements || []);
//         showFeedback(`Showing numbers on ${elementCount} clickable elements. Say "click 1" to "click ${elementCount}"`);
//       }
//     } catch (error) {
//       throw new Error(`Failed to show numbers: ${error.message}`);
//     }
//   };

//   const hideElementNumbers = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: removeNumbersFromElements
//       });

//       setShowNumbers(false);
//       setNumberedElements([]);
//       showFeedback('Numbers hidden');
//     } catch (error) {
//       throw new Error(`Failed to hide numbers: ${error.message}`);
//     }
//   };

//   const refreshNumbers = async () => {
//     try {
//       // First hide any existing numbers
//       await hideElementNumbers();

//       // Small delay to ensure cleanup is complete
//       setTimeout(async () => {
//         // Then show fresh numbers
//         await showElementNumbers();
//       }, 100);

//     } catch (error) {
//       throw new Error(`Failed to refresh numbers: ${error.message}`);
//     }
//   };

//   const clickByNumber = async (command) => {
//     try {
//       const numberMatch = command.match(/click (\d+)/) || command.match(/click number (\d+)/);
//       if (!numberMatch) {
//         showFeedback('Please specify a number to click', 'error');
//         return;
//       }

//       const clickNumber = parseInt(numberMatch[1]);

//       if (clickNumber < 1) {
//         showFeedback('Please use numbers starting from 1', 'error');
//         return;
//       }

//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       const results = await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: clickElementByNumber,
//         args: [clickNumber]
//       });

//       if (results && results[0] && results[0].result) {
//         const result = results[0].result;
//         if (result.success) {
//           showFeedback(`Clicked element ${clickNumber}: ${result.elementText}`);
//         } else {
//           if (result.maxNumber) {
//             showFeedback(`Element ${clickNumber} not found. Available: 1-${result.maxNumber}. Say "show numbers" first.`, 'error');
//           } else {
//             showFeedback('No numbered elements found. Say "show numbers" first.', 'error');
//           }
//         }
//       }
//     } catch (error) {
//       throw new Error(`Failed to click by number: ${error.message}`);
//     }
//   };

//   // Mode switching functions
//   const switchToContentMode = async () => {
//     try {
//       setMarkingMode('content');
//       if (showNumbers) {
//         await hideElementNumbers();
//         setTimeout(async () => {
//           await showContentElements();
//         }, 100);
//       }
//       showFeedback('Switched to content mode - numbers will mark paragraphs, headings, and sections');
//     } catch (error) {
//       throw new Error(`Failed to switch to content mode: ${error.message}`);
//     }
//   };

//   const switchToInteractiveMode = async () => {
//     try {
//       setMarkingMode('interactive');
//       if (showNumbers) {
//         await hideElementNumbers();
//         setTimeout(async () => {
//           await showElementNumbers();
//         }, 100);
//       }
//       showFeedback('Switched to interactive mode - numbers will mark clickable elements');
//     } catch (error) {
//       throw new Error(`Failed to switch to interactive mode: ${error.message}`);
//     }
//   };

//   const showContentElements = async () => {
//     try {
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       const results = await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: addNumbersToContentElements
//       });

//       if (results && results[0] && results[0].result) {
//         const elementCount = results[0].result.count;
//         setShowNumbers(true);
//         setNumberedElements(results[0].result.elements || []);
//         showFeedback(`Showing numbers on ${elementCount} content sections. Say "read 1" to "read ${elementCount}"`);
//       }
//     } catch (error) {
//       throw new Error(`Failed to show content: ${error.message}`);
//     }
//   };

//   const readContentByNumber = async (command) => {
//     try {
//       const numberMatch = command.match(/read (\\d+)/);
//       if (!numberMatch) {
//         showFeedback('Please specify a number to read', 'error');
//         return;
//       }

//       const contentNumber = parseInt(numberMatch[1]);
//       const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

//       const results = await chrome.scripting.executeScript({
//         target: { tabId: activeTab.id },
//         func: readContentElementByNumber,
//         args: [contentNumber]
//       });

//       if (results && results[0] && results[0].result) {
//         const result = results[0].result;
//         if (result.success) {
//           // Use text-to-speech to read the content
//           if ('speechSynthesis' in window) {
//             const utterance = new SpeechSynthesisUtterance(result.content);
//             utterance.rate = 0.8;
//             utterance.pitch = 1;
//             speechSynthesis.speak(utterance);
//           }
//           showFeedback(`Reading: ${result.title || 'Content'}`);
//         } else {
//           showFeedback(`Content ${contentNumber} not found`, 'error');
//         }
//       }
//     } catch (error) {
//       throw new Error(`Failed to read content: ${error.message}`);
//     }
//   };

//   // Helper functions for numbered clicking
//   const addNumbersToElements = () => {
//     // Remove existing numbers first
//     const existingNumbers = document.querySelectorAll('.voice-nav-number');
//     existingNumbers.forEach(el => el.remove());

//     // Remove existing scroll listener
//     if (window.voiceNavScrollHandler) {
//       window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
//       delete window.voiceNavScrollHandler;
//     }

//     // Remove existing mutation observer
//     if (window.voiceNavMutationObserver) {
//       window.voiceNavMutationObserver.disconnect();
//       delete window.voiceNavMutationObserver;
//     }

//     // Find all clickable elements with improved selectors
//     const selectors = [
//       // Basic interactive elements
//       'a:not([style*="display: none"]):not([hidden])',
//       'button:not([disabled]):not([style*="display: none"]):not([hidden])',
//       '[role="button"]:not([aria-hidden="true"]):not([style*="display: none"])',
//       '[onclick]:not([style*="display: none"]):not([hidden])',
//       'input[type="submit"]:not([disabled]):not([style*="display: none"])',
//       'input[type="button"]:not([disabled]):not([style*="display: none"])',

//       // UI component patterns
//       '[class*="btn"]:not([disabled]):not([style*="display: none"]):not([hidden])',
//       '[class*="button"]:not([disabled]):not([style*="display: none"]):not([hidden])',
//       '[class*="link"]:not([style*="display: none"]):not([hidden])',
//       '[tabindex="0"]:not([aria-hidden="true"]):not([style*="display: none"])',

//       // Collapsible and expandable elements
//       '[aria-expanded]', '[data-toggle]', '[data-collapse]',
//       '[class*="collapse"]:not(.collapsed)', '[class*="expand"]',
//       '[class*="toggle"]:not([disabled]):not([hidden])',
//       '[class*="dropdown"]:not([style*="display: none"])',
//       '[class*="accordion"]:not([disabled])',

//       // Icon-only elements and interactive containers
//       '[class*="icon"]:not([aria-hidden="true"])',
//       '[class*="hamburger"]', '[class*="menu-toggle"]',
//       '[class*="nav-toggle"]', '[class*="sidebar-toggle"]',
//       'svg[role="button"]', 'svg[onclick]', 'svg[class*="clickable"]',

//       // Form controls and interactive elements
//       'select:not([disabled])', 'input[type="checkbox"]', 'input[type="radio"]',
//       '[role="tab"]:not([aria-hidden="true"])', '[role="menuitem"]',
//       '[role="option"]', '[role="treeitem"]',

//       // GitHub-specific selectors
//       '[class*="js-"]:not([disabled]):not([hidden])', // GitHub JS hooks
//       '[data-hydro-click]', // GitHub analytics tracking
//       'button[name="button"]', // GitHub button name attribute
//       '.btn-block:not([disabled])', // GitHub block buttons
//       '.octicon-button:not([disabled])', // GitHub icon buttons
//     ];

//     let elements = [];
//     selectors.forEach(selector => {
//       try {
//         const found = document.querySelectorAll(selector);
//         elements.push(...Array.from(found));
//       } catch (e) {
//         console.warn('Invalid selector:', selector, e);
//       }
//     });

//     // Debug logging for GitHub buttons specifically
//     const debugButtons = document.querySelectorAll('button[class*="btn"]');
//     console.log(`🔍 Found ${debugButtons.length} buttons with 'btn' class:`,
//       Array.from(debugButtons).map(btn => ({
//         text: btn.textContent?.trim(),
//         classes: btn.className,
//         visible: btn.offsetParent !== null,
//         rect: btn.getBoundingClientRect()
//       }))
//     );

//     // Enhanced visibility filtering
//     const visibleElements = elements.filter((el, index, arr) => {
//       // Remove duplicates
//       if (arr.indexOf(el) !== index) return false;

//       // Debug specific GitHub buttons
//       const isGitHubEditButton = el.textContent?.trim().includes('Edit profile') ||
//         el.classList.contains('js-profile-editable-edit-button');
//       if (isGitHubEditButton) {
//         console.log('🎯 GitHub Edit Profile Button Analysis:', {
//           text: el.textContent?.trim(),
//           classes: el.className,
//           disabled: el.disabled,
//           hidden: el.hidden,
//           offsetParent: el.offsetParent,
//           computedStyle: {
//             display: window.getComputedStyle(el).display,
//             visibility: window.getComputedStyle(el).visibility,
//             opacity: window.getComputedStyle(el).opacity
//           },
//           rect: el.getBoundingClientRect(),
//           parentHidden: el.parentElement ? window.getComputedStyle(el.parentElement).display : 'none'
//         });
//       }

//       // Skip if parent is hidden
//       let parent = el.parentElement;
//       while (parent) {
//         const parentStyle = window.getComputedStyle(parent);
//         if (parentStyle.display === 'none' ||
//           parentStyle.visibility === 'hidden' ||
//           parentStyle.opacity === '0') {
//           return false;
//         }
//         parent = parent.parentElement;
//       }

//       // Special handling for scrollable containers (Gmail, etc.)
//       let scrollableParent = el.parentElement;
//       while (scrollableParent) {
//         const scrollStyle = window.getComputedStyle(scrollableParent);
//         if (scrollStyle.overflow === 'auto' ||
//           scrollStyle.overflow === 'scroll' ||
//           scrollStyle.overflowY === 'auto' ||
//           scrollStyle.overflowY === 'scroll') {

//           const parentRect = scrollableParent.getBoundingClientRect();
//           const elRect = el.getBoundingClientRect();

//           // Element should be within scrollable container bounds
//           if (elRect.top < parentRect.top - 50 ||
//             elRect.bottom > parentRect.bottom + 50) {
//             return false; // Element is outside visible scroll area
//           }
//           break;
//         }
//         scrollableParent = scrollableParent.parentElement;
//       }

//       // Get computed styles
//       const style = window.getComputedStyle(el);
//       const rect = el.getBoundingClientRect();

//       // Enhanced visibility checks
//       const isDisplayVisible = style.display !== 'none';
//       const isVisibilityVisible = style.visibility !== 'hidden';
//       const hasOpacity = parseFloat(style.opacity) > 0.1;
//       const hasSize = rect.width > 5 && rect.height > 5;
//       const notBehindOtherElements = !style.pointerEvents || style.pointerEvents !== 'none';

//       // Check if element is actually in viewport
//       const isInViewport = rect.top < window.innerHeight + 100 &&
//         rect.bottom > -100 &&
//         rect.left < window.innerWidth + 100 &&
//         rect.right > -100;

//       // Enhanced content detection for icon-only and collapsible elements
//       const hasContent = el.textContent?.trim().length > 0 ||
//         el.getAttribute('aria-label') ||
//         el.getAttribute('title') ||
//         el.getAttribute('data-tooltip') ||
//         el.getAttribute('data-title') ||
//         el.tagName.toLowerCase() === 'button' ||
//         el.tagName.toLowerCase() === 'a' ||
//         el.tagName.toLowerCase() === 'select' ||
//         el.tagName.toLowerCase() === 'input' ||
//         // Icon-only elements
//         el.querySelector('svg, i, [class*="icon"], [class*="fa-"]') ||
//         // Collapsible elements
//         el.hasAttribute('aria-expanded') ||
//         el.hasAttribute('data-toggle') ||
//         el.hasAttribute('data-collapse') ||
//         // Interactive roles
//         ['tab', 'menuitem', 'option', 'treeitem'].includes(el.getAttribute('role'));

//       // Enhanced decorative element detection
//       const isNotDecorative = !el.classList.contains('overlay') &&
//         !el.classList.contains('backdrop') &&
//         !el.classList.contains('mask') &&
//         !el.classList.contains('decoration') &&
//         !el.classList.contains('spacer') &&
//         !el.getAttribute('aria-hidden') &&
//         // Allow elements with interactive indicators
//         (el.style.cursor === 'pointer' ||
//           window.getComputedStyle(el).cursor === 'pointer' ||
//           hasContent);

//       return isDisplayVisible &&
//         isVisibilityVisible &&
//         hasOpacity &&
//         hasSize &&
//         notBehindOtherElements &&
//         isInViewport &&
//         hasContent &&
//         isNotDecorative;
//     });

//     // Sort elements by importance and position
//     const sortedElements = visibleElements.sort((a, b) => {
//       const aRect = a.getBoundingClientRect();
//       const bRect = b.getBoundingClientRect();

//       // Priority scoring system
//       let aScore = 0, bScore = 0;

//       // Higher priority for interactive elements
//       if (a.tagName.toLowerCase() === 'button') aScore += 10;
//       if (b.tagName.toLowerCase() === 'button') bScore += 10;
//       if (a.tagName.toLowerCase() === 'a') aScore += 8;
//       if (b.tagName.toLowerCase() === 'a') bScore += 8;

//       // Priority for elements with clear text or interactive indicators
//       if (a.textContent?.trim().length > 0) aScore += 5;
//       if (b.textContent?.trim().length > 0) bScore += 5;

//       // Priority for collapsible/expandable elements (often important UI controls)
//       if (a.hasAttribute('aria-expanded') || a.hasAttribute('data-toggle')) aScore += 7;
//       if (b.hasAttribute('aria-expanded') || b.hasAttribute('data-toggle')) bScore += 7;

//       // Priority for icon-only interactive elements
//       if (a.querySelector('svg, i, [class*="icon"], [class*="fa-"]') &&
//         (a.style.cursor === 'pointer' || window.getComputedStyle(a).cursor === 'pointer')) aScore += 6;
//       if (b.querySelector('svg, i, [class*="icon"], [class*="fa-"]') &&
//         (b.style.cursor === 'pointer' || window.getComputedStyle(b).cursor === 'pointer')) bScore += 6;

//       // Priority for dropdown/menu elements
//       if (a.getAttribute('role') === 'menuitem' || a.classList.contains('dropdown')) aScore += 4;
//       if (b.getAttribute('role') === 'menuitem' || b.classList.contains('dropdown')) bScore += 4;

//       // Priority for elements closer to top and left (reading order)
//       aScore += Math.max(0, 10 - Math.floor(aRect.top / 100));
//       bScore += Math.max(0, 10 - Math.floor(bRect.top / 100));

//       // Priority for larger elements (likely more important)
//       const aArea = aRect.width * aRect.height;
//       const bArea = bRect.width * bRect.height;
//       if (aArea > 1000) aScore += 3;
//       if (bArea > 1000) bScore += 3;

//       // Bonus for elements that might reveal hidden content
//       if (a.classList.contains('toggle') || a.classList.contains('hamburger') ||
//         a.classList.contains('menu-toggle')) aScore += 5;
//       if (b.classList.contains('toggle') || b.classList.contains('hamburger') ||
//         b.classList.contains('menu-toggle')) bScore += 5;

//       return bScore - aScore;
//     });

//     // Debug: Log how many elements we found vs. will show
//     console.log(`📊 Element Detection Summary:
//     - Total found: ${elements.length}
//     - After visibility filter: ${visibleElements.length}
//     - After sorting: ${sortedElements.length}
//     - Will show: ${Math.min(20, sortedElements.length)}`);

//     // Limit to top 20 elements to avoid clutter (increased from 15)
//     const limitedElements = sortedElements.slice(0, 20);

//     // Create container for all numbers
//     const numberContainer = document.createElement('div');
//     numberContainer.className = 'voice-nav-container';
//     numberContainer.style.cssText = `
//       position: absolute;
//       top: 0;
//       left: 0;
//       width: 100%;
//       height: 100%;
//       pointer-events: none;
//       z-index: 10000;
//     `;
//     document.body.appendChild(numberContainer);

//     // Add numbers to elements
//     const numberedElements = [];
//     limitedElements.forEach((element, index) => {
//       const number = index + 1;

//       // Create number overlay with absolute positioning relative to document
//       const numberEl = document.createElement('div');
//       numberEl.className = 'voice-nav-number';
//       numberEl.textContent = number;
//       numberEl.setAttribute('data-element-index', number);
//       numberEl.setAttribute('data-target-element', number);

//       // Style the number with absolute positioning
//       Object.assign(numberEl.style, {
//         position: 'absolute',
//         width: '22px',
//         height: '22px',
//         borderRadius: '50%',
//         backgroundColor: '#ff4444',
//         color: 'white',
//         display: 'flex',
//         alignItems: 'center',
//         justifyContent: 'center',
//         fontSize: '11px',
//         fontWeight: 'bold',
//         border: '2px solid white',
//         boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
//         fontFamily: 'Arial, sans-serif',
//         pointerEvents: 'none',
//         transition: 'opacity 0.2s ease',
//         zIndex: '10001'
//       });

//       numberContainer.appendChild(numberEl);

//       // Store element reference
//       element.setAttribute('data-voice-nav-number', number);
//       numberedElements.push({
//         number: number,
//         element: element,
//         numberEl: numberEl,
//         text: element.textContent?.trim() || element.getAttribute('title') || element.getAttribute('aria-label') || `Element ${number}`
//       });
//     });

//     // Function to update positions with smart placement
//     const updateNumberPositions = () => {
//       const usedPositions = new Set();

//       numberedElements.forEach(item => {
//         const rect = item.element.getBoundingClientRect();
//         const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
//         const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

//         // Check if element is still visible in viewport
//         const isVisible = rect.top < window.innerHeight && rect.bottom > 0 &&
//           rect.left < window.innerWidth && rect.right > 0;

//         if (isVisible && rect.width > 0 && rect.height > 0) {
//           // Try different positioning strategies to avoid overlaps
//           const positions = [
//             { top: rect.top + scrollTop - 12, left: rect.left + scrollLeft - 12 }, // Top-left (default)
//             { top: rect.top + scrollTop - 12, left: rect.right + scrollLeft - 10 }, // Top-right
//             { top: rect.bottom + scrollTop - 10, left: rect.left + scrollLeft - 12 }, // Bottom-left
//             { top: rect.top + scrollTop + rect.height / 2 - 11, left: rect.left + scrollLeft - 12 }, // Middle-left
//             { top: rect.top + scrollTop - 12, left: rect.left + scrollLeft + rect.width / 2 - 11 } // Top-center
//           ];

//           let bestPosition = positions[0];
//           let positionFound = false;

//           // Find a position that doesn't overlap with existing numbers
//           for (const pos of positions) {
//             const posKey = `${Math.floor(pos.top / 25)}-${Math.floor(pos.left / 25)}`;
//             if (!usedPositions.has(posKey)) {
//               bestPosition = pos;
//               usedPositions.add(posKey);
//               positionFound = true;
//               break;
//             }
//           }

//           // If all positions are taken, use default but with slight offset
//           if (!positionFound) {
//             bestPosition.top += (item.number % 3) * 5;
//             bestPosition.left += (item.number % 3) * 5;
//           }

//           item.numberEl.style.top = `${bestPosition.top}px`;
//           item.numberEl.style.left = `${bestPosition.left}px`;
//           item.numberEl.style.opacity = '1';
//         } else {
//           // Hide numbers for elements not in viewport
//           item.numberEl.style.opacity = '0.3';
//         }
//       });
//     };

//     // Initial positioning
//     updateNumberPositions();

//     // Add scroll listener with throttling
//     let scrollTimeout;
//     const scrollHandler = () => {
//       if (scrollTimeout) {
//         clearTimeout(scrollTimeout);
//       }
//       scrollTimeout = setTimeout(updateNumberPositions, 16); // ~60fps
//     };

//     // Store handler for cleanup
//     window.voiceNavScrollHandler = scrollHandler;

//     // Listen to scroll events on window and all scrollable elements
//     window.addEventListener('scroll', scrollHandler, true);

//     // Find and listen to scrollable containers specifically
//     const scrollableContainers = document.querySelectorAll('[style*="overflow"], [style*="scroll"]');
//     const autoScrollContainers = Array.from(document.querySelectorAll('*')).filter(el => {
//       const style = window.getComputedStyle(el);
//       return style.overflow === 'auto' || style.overflow === 'scroll' ||
//         style.overflowY === 'auto' || style.overflowY === 'scroll';
//     });

//     [...scrollableContainers, ...autoScrollContainers].forEach(container => {
//       container.addEventListener('scroll', scrollHandler, { passive: true });
//     });

//     // Also listen for resize events
//     window.addEventListener('resize', scrollHandler);

//     // Set up mutation observer for dynamic content changes
//     const mutationObserver = new MutationObserver((mutations) => {
//       let shouldRefresh = false;

//       mutations.forEach((mutation) => {
//         // Check for added nodes that might be interactive
//         if (mutation.addedNodes.length > 0) {
//           for (const node of mutation.addedNodes) {
//             if (node.nodeType === Node.ELEMENT_NODE) {
//               // Check if added node or its children contain interactive elements
//               const interactiveSelectors = 'a, button, [role="button"], [onclick], input[type="submit"], input[type="button"], [class*="btn"], select, [role="tab"], [role="menuitem"]';

//               if (node.matches && node.matches(interactiveSelectors)) {
//                 shouldRefresh = true;
//                 break;
//               } else if (node.querySelector && node.querySelector(interactiveSelectors)) {
//                 shouldRefresh = true;
//                 break;
//               }
//             }
//           }
//         }

//         // Check for attribute changes that might affect visibility
//         if (mutation.type === 'attributes') {
//           const target = mutation.target;
//           if (mutation.attributeName === 'class' ||
//             mutation.attributeName === 'style' ||
//             mutation.attributeName === 'aria-expanded' ||
//             mutation.attributeName === 'aria-hidden') {

//             // Check if this affects interactive elements
//             const interactiveSelectors = 'a, button, [role="button"], [onclick], input[type="submit"], input[type="button"], [class*="btn"], select';
//             if (target.matches && target.matches(interactiveSelectors)) {
//               shouldRefresh = true;
//             } else if (target.querySelector && target.querySelector(interactiveSelectors)) {
//               shouldRefresh = true;
//             }
//           }
//         }
//       });

//       // Throttled refresh to avoid excessive updates
//       if (shouldRefresh && !window.voiceNavRefreshPending) {
//         window.voiceNavRefreshPending = true;
//         setTimeout(() => {
//           // Re-run the numbering if numbers are currently shown
//           if (document.querySelector('.voice-nav-container')) {
//             console.log('🔄 Auto-refreshing numbers due to DOM changes');

//             // Clean up current numbers
//             const currentNumbers = document.querySelectorAll('.voice-nav-number');
//             currentNumbers.forEach(el => el.remove());
//             const currentContainer = document.querySelector('.voice-nav-container');
//             if (currentContainer) currentContainer.remove();

//             // Re-add numbers with current function context
//             try {
//               const result = addNumbersToElements();
//               // Signal that numbers were refreshed
//               if (window.voiceNavRefreshCallback) {
//                 window.voiceNavRefreshCallback(result.count);
//               }
//             } catch (e) {
//               console.error('Error refreshing numbers:', e);
//             }
//           }
//           window.voiceNavRefreshPending = false;
//         }, 1000); // Wait 1 second to batch multiple changes
//       }
//     });

//     // Observe the entire document for changes
//     mutationObserver.observe(document.body, {
//       childList: true,
//       subtree: true,
//       attributes: true,
//       attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'hidden']
//     });

//     // Store observer for cleanup
//     window.voiceNavMutationObserver = mutationObserver;

//     return {
//       count: limitedElements.length,
//       elements: numberedElements.map(item => ({
//         number: item.number,
//         text: item.text
//       }))
//     };
//   };

//   const removeNumbersFromElements = () => {
//     // Remove number elements and container
//     const numberContainer = document.querySelector('.voice-nav-container');
//     if (numberContainer) {
//       numberContainer.remove();
//     }

//     const numberElements = document.querySelectorAll('.voice-nav-number');
//     numberElements.forEach(el => el.remove());

//     // Remove scroll listener
//     if (window.voiceNavScrollHandler) {
//       window.removeEventListener('scroll', window.voiceNavScrollHandler, true);
//       window.removeEventListener('resize', window.voiceNavScrollHandler);
//       delete window.voiceNavScrollHandler;
//     }

//     // Clean up element attributes
//     const numberedElements = document.querySelectorAll('[data-voice-nav-number]');
//     numberedElements.forEach(el => el.removeAttribute('data-voice-nav-number'));
//   };

//   const clickElementByNumber = (number) => {
//     const element = document.querySelector(`[data-voice-nav-number="${number}"]`);

//     if (!element) {
//       const maxNumber = document.querySelectorAll('[data-voice-nav-number]').length;
//       return {
//         success: false,
//         maxNumber: maxNumber > 0 ? maxNumber : null
//       };
//     }

//     // Scroll element into view
//     element.scrollIntoView({ behavior: 'smooth', block: 'center' });

//     // Highlight the element briefly
//     const originalStyle = element.style.cssText;
//     element.style.outline = '3px solid #00ff00';
//     element.style.outlineOffset = '2px';

//     setTimeout(() => {
//       element.style.cssText = originalStyle;
//     }, 1000);

//     // Enhanced click handling for collapsible elements
//     setTimeout(() => {
//       element.click();

//       // For collapsible elements, wait and refresh numbers if content is revealed
//       if (element.hasAttribute('aria-expanded') ||
//         element.hasAttribute('data-toggle') ||
//         element.classList.contains('dropdown') ||
//         element.classList.contains('collapse') ||
//         element.classList.contains('toggle') ||
//         element.classList.contains('hamburger') ||
//         element.classList.contains('menu-toggle')) {

//         // Wait for potential DOM changes
//         setTimeout(() => {
//           // Check if new content appeared
//           const newElements = document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]');
//           const currentCount = document.querySelectorAll('[data-voice-nav-number]').length;

//           if (newElements.length > currentCount) {
//             // Auto-refresh numbers if new interactive content appeared
//             setTimeout(() => {
//               if (window.voiceNavAutoRefresh) {
//                 // Remove old numbers
//                 const oldNumbers = document.querySelectorAll('.voice-nav-number');
//                 oldNumbers.forEach(el => el.remove());
//                 const oldContainer = document.querySelector('.voice-nav-container');
//                 if (oldContainer) oldContainer.remove();

//                 // Add fresh numbers (this would need to be called from the React component)
//                 console.log('New interactive content detected - consider refreshing numbers');
//               }
//             }, 500);
//           }
//         }, 300);
//       }
//     }, 200);

//     return {
//       success: true,
//       elementText: element.textContent?.trim() ||
//         element.getAttribute('title') ||
//         element.getAttribute('aria-label') ||
//         element.getAttribute('data-tooltip') ||
//         `Element ${number}`
//     };
//   };

//   // Content marking function (injected into page)
//   const addNumbersToContentElements = () => {
//     // Remove existing numbers first
//     const existingNumbers = document.querySelectorAll('.voice-nav-number');
//     existingNumbers.forEach(el => el.remove());

//     // Remove existing container
//     const existingContainer = document.querySelector('.voice-nav-container');
//     if (existingContainer) existingContainer.remove();

//     // Content element selectors with semantic meaning
//     const contentSelectors = [
//       // Primary content structures
//       'article', 'section', 'main', '[role="main"]',

//       // Headings (high priority)
//       'h1', 'h2', 'h3', 'h4', 'h5', 'h6',

//       // Content blocks
//       'p:not(:empty)', 'blockquote', 'pre', 'code',

//       // Lists and structured content
//       'ul:not(:empty)', 'ol:not(:empty)', 'dl:not(:empty)',
//       'li:not(:empty)', 'dt', 'dd',

//       // Rich content
//       'figure', 'figcaption', 'table', 'thead', 'tbody',

//       // Semantic content
//       '[role="article"]', '[role="region"]', '[role="complementary"]',
//       '.content', '.post', '.article', '.section',
//       '.paragraph', '.text-block', '.description',

//       // Forms as content
//       'fieldset', 'legend', 'label:not(:empty)',

//       // Navigation content
//       'nav:not(:empty)', '[role="navigation"]:not(:empty)',

//       // Media with captions
//       'video + p', 'img + p', 'iframe + p'
//     ];

//     let contentElements = [];
//     contentSelectors.forEach(selector => {
//       try {
//         const found = document.querySelectorAll(selector);
//         contentElements.push(...Array.from(found));
//       } catch (e) {
//         console.warn('Invalid content selector:', selector, e);
//       }
//     });

//     // Enhanced content filtering and prioritization
//     const validContent = contentElements.filter((el, index, arr) => {
//       // Remove duplicates
//       if (arr.indexOf(el) !== index) return false;

//       // Skip if parent is hidden
//       let parent = el.parentElement;
//       while (parent) {
//         const parentStyle = window.getComputedStyle(parent);
//         if (parentStyle.display === 'none' ||
//           parentStyle.visibility === 'hidden' ||
//           parentStyle.opacity === '0') {
//           return false;
//         }
//         parent = parent.parentElement;
//       }

//       // Basic visibility checks
//       const style = window.getComputedStyle(el);
//       const rect = el.getBoundingClientRect();

//       const isVisible = style.display !== 'none' &&
//         style.visibility !== 'hidden' &&
//         parseFloat(style.opacity) > 0.1 &&
//         rect.width > 10 && rect.height > 10;

//       // Content quality checks
//       const textContent = el.textContent?.trim() || '';
//       const hasSubstantialContent = textContent.length > 10; // At least 10 characters

//       // Skip navigation-only elements in content mode
//       const isNavigationOnly = el.tagName.toLowerCase() === 'nav' &&
//         el.querySelectorAll('a, button').length > textContent.split(' ').length;

//       // Skip if it's just a container with no direct text content
//       const hasDirectText = textContent.length > 0 &&
//         (el.children.length === 0 ||
//           textContent.length > Array.from(el.children).reduce((sum, child) =>
//             sum + (child.textContent?.length || 0), 0) * 0.3);

//       return isVisible && hasSubstantialContent && !isNavigationOnly && hasDirectText;
//     });

//     // Smart content prioritization
//     const prioritizedContent = validContent.sort((a, b) => {
//       let aScore = 0, bScore = 0;

//       // Heading hierarchy (highest priority)
//       const headingScores = { h1: 100, h2: 90, h3: 80, h4: 70, h5: 60, h6: 50 };
//       aScore += headingScores[a.tagName.toLowerCase()] || 0;
//       bScore += headingScores[b.tagName.toLowerCase()] || 0;

//       // Main content areas
//       if (a.tagName.toLowerCase() === 'main' || a.getAttribute('role') === 'main') aScore += 95;
//       if (b.tagName.toLowerCase() === 'main' || b.getAttribute('role') === 'main') bScore += 95;

//       // Articles and sections
//       if (a.tagName.toLowerCase() === 'article') aScore += 85;
//       if (b.tagName.toLowerCase() === 'article') bScore += 85;
//       if (a.tagName.toLowerCase() === 'section') aScore += 75;
//       if (b.tagName.toLowerCase() === 'section') bScore += 75;

//       // Content length (substantial content gets priority)
//       const aLength = a.textContent?.trim().length || 0;
//       const bLength = b.textContent?.trim().length || 0;
//       if (aLength > 100) aScore += Math.min(20, Math.floor(aLength / 100));
//       if (bLength > 100) bScore += Math.min(20, Math.floor(bLength / 100));

//       // Semantic classes
//       const contentClasses = ['content', 'post', 'article', 'main-text', 'description'];
//       contentClasses.forEach(cls => {
//         if (a.classList.contains(cls)) aScore += 15;
//         if (b.classList.contains(cls)) bScore += 15;
//       });

//       // Reading order (top to bottom)
//       const aRect = a.getBoundingClientRect();
//       const bRect = b.getBoundingClientRect();
//       aScore += Math.max(0, 10 - Math.floor(aRect.top / 100));
//       bScore += Math.max(0, 10 - Math.floor(bRect.top / 100));

//       return bScore - aScore;
//     });

//     // Limit to top 15 content elements
//     const limitedContent = prioritizedContent.slice(0, 15);

//     // Create container for numbers
//     const numberContainer = document.createElement('div');
//     numberContainer.className = 'voice-nav-container';
//     numberContainer.style.cssText = `
//       position: absolute;
//       top: 0;
//       left: 0;
//       width: 100%;
//       height: 100%;
//       pointer-events: none;
//       z-index: 10000;
//     `;
//     document.body.appendChild(numberContainer);

//     // Add numbers to content elements
//     const numberedContent = [];
//     limitedContent.forEach((element, index) => {
//       const number = index + 1;

//       // Create number overlay
//       const numberEl = document.createElement('div');
//       numberEl.className = 'voice-nav-number voice-nav-content';
//       numberEl.textContent = number;
//       numberEl.setAttribute('data-content-number', number);

//       // Style for content numbers (different color)
//       Object.assign(numberEl.style, {
//         position: 'absolute',
//         width: '24px',
//         height: '24px',
//         borderRadius: '50%',
//         backgroundColor: '#2196F3', // Blue for content
//         color: 'white',
//         display: 'flex',
//         alignItems: 'center',
//         justifyContent: 'center',
//         fontSize: '11px',
//         fontWeight: 'bold',
//         border: '2px solid white',
//         boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
//         fontFamily: 'Arial, sans-serif',
//         pointerEvents: 'none',
//         zIndex: '10001'
//       });

//       numberContainer.appendChild(numberEl);

//       // Position the number
//       const rect = element.getBoundingClientRect();
//       const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
//       const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

//       numberEl.style.top = `${rect.top + scrollTop - 12}px`;
//       numberEl.style.left = `${rect.left + scrollLeft - 12}px`;

//       // Store element reference
//       element.setAttribute('data-voice-content-number', number);
//       numberedContent.push({
//         number: number,
//         element: element,
//         title: element.tagName.toLowerCase() === 'h1' || element.tagName.toLowerCase() === 'h2' ||
//           element.tagName.toLowerCase() === 'h3' || element.tagName.toLowerCase() === 'h4' ||
//           element.tagName.toLowerCase() === 'h5' || element.tagName.toLowerCase() === 'h6' ?
//           element.textContent?.trim().substring(0, 50) :
//           element.tagName.toLowerCase() + ' content',
//         content: element.textContent?.trim().substring(0, 500) || ''
//       });
//     });

//     return {
//       count: limitedContent.length,
//       elements: numberedContent
//     };
//   };

//   // Read content by number function (injected into page)
//   const readContentElementByNumber = (number) => {
//     const element = document.querySelector(`[data-voice-content-number="${number}"]`);

//     if (!element) {
//       return { success: false };
//     }

//     // Scroll element into view
//     element.scrollIntoView({ behavior: 'smooth', block: 'start' });

//     // Highlight the content briefly
//     const originalStyle = element.style.cssText;
//     element.style.outline = '3px solid #2196F3';
//     element.style.outlineOffset = '2px';
//     element.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';

//     setTimeout(() => {
//       element.style.cssText = originalStyle;
//     }, 2000);

//     const title = element.tagName.match(/h[1-6]/i) ?
//       element.textContent?.trim().substring(0, 50) :
//       `${element.tagName.toLowerCase()} content`;

//     return {
//       success: true,
//       title: title,
//       content: element.textContent?.trim() || ''
//     };
//   };

//   const startListening = () => {
//     if (recognitionRef.current && !isListening) {
//       setTranscript('');
//       recognitionRef.current.start();
//     }
//   };

//   const stopListening = () => {
//     if (recognitionRef.current && isListening) {
//       recognitionRef.current.stop();
//     }
//   };

//   // Get theme-based colors
//   const getThemeColors = (theme) => {
//     const themes = {
//       'ai-midnight-nebula': {
//         primaryBg: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
//         cardBg: 'rgba(15, 23, 42, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#34C759'
//       },
//       'cosmic-aurora': {
//         primaryBg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
//         cardBg: 'rgba(15, 23, 42, 0.95)',
//         buttonBg: 'rgba(16, 185, 129, 0.12)',
//         buttonBgHover: 'rgba(16, 185, 129, 0.18)',
//         buttonBorder: 'rgba(16, 185, 129, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#10b981'
//       },
//       'deep-ocean': {
//         primaryBg: 'linear-gradient(135deg, #164e63 0%, #0891b2 100%)',
//         cardBg: 'rgba(8, 51, 68, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#0891b2'
//       },
//       'sunset-glow': {
//         primaryBg: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)',
//         cardBg: 'rgba(124, 45, 18, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#f97316'
//       },
//       'forest-whisper': {
//         primaryBg: 'linear-gradient(135deg, #15803d 0%, #166534 100%)',
//         cardBg: 'rgba(20, 83, 45, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#22c55e'
//       },
//       'royal-purple': {
//         primaryBg: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
//         cardBg: 'rgba(88, 28, 135, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#a855f7'
//       },
//       'electric-blue': {
//         primaryBg: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
//         cardBg: 'rgba(30, 58, 138, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#3b82f6'
//       },
//       'warm-amber': {
//         primaryBg: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
//         cardBg: 'rgba(146, 64, 14, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#fbbf24'
//       },
//       'rose-gold': {
//         primaryBg: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)',
//         cardBg: 'rgba(159, 18, 57, 0.95)',
//         buttonBg: 'rgba(255, 255, 255, 0.12)',
//         buttonBgHover: 'rgba(255, 255, 255, 0.18)',
//         buttonBorder: 'rgba(255, 255, 255, 0.25)',
//         textColor: '#ffffff',
//         textSecondary: 'rgba(255, 255, 255, 0.7)',
//         accentColor: '#fb7185'
//       }
//     };
//     return themes[theme] || themes['ai-midnight-nebula'];
//   };

//   const themeColors = getThemeColors(currentTheme);

//   return (
//     <div className={`voice-navigation ${isCollapsed ? 'collapsed' : 'expanded'}`}>
//       {/* Compact Header - Always Visible */}
//       <div className="voice-header" onClick={() => setIsCollapsed(!isCollapsed)}>
//         <div className="header-content">
//           <h2 className="voice-title">🎤 Voice Navigation</h2>
//           <div className="header-right">
//             <div className="status-indicator">
//               <span className={`status-dot ${isListening ? 'listening' : error ? 'error' : 'ready'}`}></span>
//               <span className="status-text">
//                 {isListening ? 'Listening' : error ? 'Error' : 'Ready'}
//               </span>
//             </div>
//             <button className="collapse-btn" title={isCollapsed ? 'Expand' : 'Collapse'}>
//               <span className={`collapse-icon ${isCollapsed ? 'collapsed' : 'expanded'}`}>▼</span>
//             </button>
//           </div>
//         </div>

//         {/* Compact Controls Row - Only when collapsed */}
//         {isCollapsed && (
//           <div className="compact-controls">
//             <button
//               onClick={(e) => {
//                 e.stopPropagation();
//                 startListening();
//               }}
//               disabled={isListening || !!error}
//               className={`voice-btn compact primary ${isListening ? 'listening' : ''}`}
//             >
//               <span className="btn-icon">{isListening ? '🔴' : '🎙️'}</span>
//               {isListening ? 'Listening...' : 'Start'}
//             </button>

//             {isListening && (
//               <button
//                 onClick={(e) => {
//                   e.stopPropagation();
//                   stopListening();
//                 }}
//                 className="voice-btn compact stop"
//               >
//                 ⏹️
//               </button>
//             )}

//             <button
//               onClick={(e) => {
//                 e.stopPropagation();
//                 showNumbers ? hideElementNumbers() : (markingMode === 'content' ? showContentElements() : showElementNumbers());
//               }}
//               className={`voice-btn compact marking ${showNumbers ? 'active' : ''}`}
//             >
//               <span className="btn-icon">{showNumbers ? '👁️‍🗨️' : '🔢'}</span>
//             </button>

//             <span className="current-mode-compact">{markingMode === 'content' ? '📄' : '🔘'}</span>
//           </div>
//         )}
//       </div>

//       {/* Expandable Content */}
//       <div className={`expandable-content ${isCollapsed ? 'hidden' : 'visible'}`}>
//         {/* Main Controls Section */}
//         <div className="controls-section">
//           <div className="primary-controls">
//             <button
//               onClick={startListening}
//               disabled={isListening || !!error}
//               className={`voice-btn primary ${isListening ? 'listening' : ''}`}
//             >
//               <span className="btn-icon">{isListening ? '🔴' : '🎙️'}</span>
//               {isListening ? 'Listening...' : 'Start Voice Control'}
//             </button>

//             {isListening && (
//               <button onClick={stopListening} className="voice-btn stop">
//                 <span className="btn-icon">⏹️</span>
//                 Stop
//               </button>
//             )}
//           </div>

//           <div className="mode-controls">
//             <div className="mode-selector">
//               <span className="mode-label">Mode:</span>
//               <button
//                 onClick={() => markingMode === 'content' ? switchToInteractiveMode() : switchToContentMode()}
//                 className={`mode-btn ${markingMode}`}
//                 title={`Switch to ${markingMode === 'content' ? 'interactive' : 'content'} mode`}
//               >
//                 <span className="mode-icon">
//                   {markingMode === 'content' ? '📄' : '🔘'}
//                 </span>
//                 <span className="mode-text">
//                   {markingMode === 'content' ? 'Content' : 'Interactive'}
//                 </span>
//               </button>
//             </div>

//             <button
//               onClick={showNumbers ? hideElementNumbers : (markingMode === 'content' ? showContentElements : showElementNumbers)}
//               className={`voice-btn marking ${showNumbers ? 'active' : ''}`}
//               title={showNumbers ? "Hide numbers" : `Show numbers for ${markingMode} elements`}
//             >
//               <span className="btn-icon">{showNumbers ? '👁️‍🗨️' : '🔢'}</span>
//               {showNumbers ? 'Hide Numbers' : 'Show Numbers'}
//             </button>
//           </div>
//         </div>

//         {/* Status Messages */}
//         <div className="status-messages">
//           {error && (
//             <div className="message error">
//               <span className="message-icon">❌</span>
//               <span className="message-text">{error}</span>
//             </div>
//           )}

//           {transcript && (
//             <div className="message transcript">
//               <span className="message-icon">💬</span>
//               <div className="message-content">
//                 <strong>You said:</strong> "{transcript}"
//               </div>
//             </div>
//           )}

//           {feedback && (
//             <div className={`message feedback ${feedback.includes('Error') || feedback.includes('not found') || feedback.includes('not recognized') ? 'error' : 'success'}`}>
//               <span className="message-icon">
//                 {feedback.includes('Error') || feedback.includes('not found') || feedback.includes('not recognized') ? '⚠️' : '✅'}
//               </span>
//               <span className="message-text">{feedback}</span>
//             </div>
//           )}
//         </div>

//         {/* Help Toggle */}
//         <div className="help-toggle-section">
//           <button
//             onClick={() => setShowHelp(!showHelp)}
//             className="help-toggle-btn"
//           >
//             <span className="help-icon">❓</span>
//             <span>{showHelp ? 'Hide Commands' : 'Show Commands'}</span>
//             <span className={`toggle-arrow ${showHelp ? 'open' : 'closed'}`}>▼</span>
//           </button>
//         </div>

//         {/* Help Section - Collapsible */}
//         {showHelp && (
//           <div className="help-section">
//             <div className="help-header">
//               <h3>🎯 Voice Commands Guide</h3>
//               <span className="current-mode">Current mode: <strong>{markingMode === 'content' ? '📄 Content' : '🔘 Interactive'}</strong></span>
//             </div>

//             <div className="commands-compact">
//               <div className="command-group">
//                 <h4>🎯 Quick Commands</h4>
//                 <div className="command-items">
//                   <span>"Switch to tab 2" • "Next tab" • "Close tab"</span>
//                   <span>"Show numbers" • "Click 3" • "Click subscribe"</span>
//                   <span>"Search for cats" • "Open Gmail" • "Go back"</span>
//                 </div>
//               </div>

//               <div className="command-group">
//                 <h4>📄 Content Mode</h4>
//                 <div className="command-items">
//                   <span>"Content mode" • "Read 1" • "Interactive mode"</span>
//                 </div>
//               </div>
//             </div>

//             <div className="help-tip">
//               <span className="tip-icon">💡</span>
//               <strong>Tip:</strong> Speak clearly and use natural language. The system recognizes variations of these commands.
//             </div>
//           </div>
//         )}
//       </div>

//       <style jsx>{`
//         .voice-navigation {
//           width: 100%;
//           max-width: 500px;
//           margin: 8px auto;
//           background: ${themeColors.primaryBg};
//           border-radius: 16px;
//           box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
//           color: ${themeColors.textColor};
//           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
//           position: relative;
//           z-index: 1;
//           transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
//           overflow: hidden;
//         }

//         .voice-navigation.collapsed {
//           max-height: 120px;
//         }

//         .voice-navigation.expanded {
//           max-height: none;
//         }

//         /* Header Styles - Compact and Clickable */
//         .voice-header {
//           cursor: pointer;
//           padding: 16px 20px;
//           border-bottom: 1px solid ${themeColors.buttonBorder};
//           transition: background-color 0.2s ease;
//         }

//         .voice-header:hover {
//           background: ${themeColors.buttonBg};
//         }

//         .header-content {
//           display: flex;
//           justify-content: space-between;
//           align-items: center;
//           margin-bottom: 0;
//         }

//         .header-right {
//           display: flex;
//           align-items: center;
//           gap: 12px;
//         }

//         .collapse-btn {
//           background: none;
//           border: none;
//           color: ${themeColors.textColor};
//           cursor: pointer;
//           padding: 4px;
//           border-radius: 4px;
//           transition: all 0.2s ease;
//         }

//         .collapse-btn:hover {
//           background: ${themeColors.buttonBg};
//         }

//         .collapse-icon {
//           font-size: 12px;
//           transition: transform 0.3s ease;
//         }

//         .collapse-icon.collapsed {
//           transform: rotate(-90deg);
//         }

//         .collapse-icon.expanded {
//           transform: rotate(0deg);
//         }

//         /* Compact Controls Row */
//         .compact-controls {
//           display: flex;
//           align-items: center;
//           gap: 8px;
//           margin-top: 12px;
//           padding-top: 12px;
//           border-top: 1px solid ${themeColors.buttonBorder};
//         }

//         .current-mode-compact {
//           font-size: 20px;
//           padding: 6px;
//           background: ${themeColors.buttonBg};
//           border-radius: 8px;
//           margin-left: auto;
//         }

//         /* Expandable Content */
//         .expandable-content {
//           overflow: hidden;
//           transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
//         }

//         .expandable-content.hidden {
//           max-height: 0;
//           opacity: 0;
//           padding: 0;
//         }

//         .expandable-content.visible {
//           max-height: 2000px;
//           opacity: 1;
//           padding: 20px;
//           padding-top: 0;
//         }

//         .voice-title {
//           margin: 0;
//           font-size: 20px;
//           font-weight: 600;
//           background: linear-gradient(45deg, ${themeColors.textColor}, ${themeColors.accentColor});
//           -webkit-background-clip: text;
//           -webkit-text-fill-color: transparent;
//           background-clip: text;
//         }

//         .status-indicator {
//           display: flex;
//           align-items: center;
//           gap: 8px;
//           padding: 8px 16px;
//           background: ${themeColors.buttonBg};
//           border-radius: 20px;
//           backdrop-filter: blur(10px);
//         }

//         .status-dot {
//           width: 8px;
//           height: 8px;
//           border-radius: 50%;
//           animation: pulse-dot 2s infinite;
//         }

//         .status-dot.ready { background: ${themeColors.accentColor}; }
//         .status-dot.listening { background: #ff4444; }
//         .status-dot.error { background: #ff9800; }

//         .status-text {
//           font-size: 14px;
//           font-weight: 500;
//         }

//         /* Controls Section */
//         .controls-section {
//           display: flex;
//           flex-direction: column;
//           gap: 20px;
//           margin-bottom: 24px;
//         }

//         .primary-controls {
//           display: flex;
//           gap: 16px;
//           justify-content: center;
//         }

//         .mode-controls {
//           display: flex;
//           justify-content: space-between;
//           align-items: center;
//           padding: 20px;
//           background: ${themeColors.buttonBg};
//           border-radius: 12px;
//           backdrop-filter: blur(10px);
//         }

//         .mode-selector {
//           display: flex;
//           align-items: center;
//           gap: 12px;
//         }

//         .mode-label {
//           font-size: 14px;
//           font-weight: 500;
//           opacity: 0.9;
//         }

//         /* Button Styles */
//         .voice-btn {
//           display: flex;
//           align-items: center;
//           gap: 8px;
//           padding: 10px 16px;
//           border: none;
//           border-radius: 10px;
//           font-size: 14px;
//           font-weight: 600;
//           cursor: pointer;
//           transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
//           position: relative;
//           overflow: hidden;
//         }

//         /* Compact Button Styles */
//         .voice-btn.compact {
//           padding: 8px 12px;
//           font-size: 13px;
//           border-radius: 8px;
//           min-width: auto;
//         }

//         .voice-btn.compact.primary {
//           min-width: 80px;
//           font-size: 13px;
//         }

//         .voice-btn.primary {
//           background: linear-gradient(135deg, ${themeColors.accentColor}, ${themeColors.accentColor}dd);
//           color: ${themeColors.textColor};
//           min-width: 160px;
//           justify-content: center;
//           font-size: 14px;
//           padding: 12px 20px;
//         }

//         .voice-btn.primary.listening {
//           background: linear-gradient(135deg, #ff4444, #d32f2f);
//           animation: listening-pulse 1.5s infinite;
//         }

//         .voice-btn.stop {
//           background: linear-gradient(135deg, #f44336, #d32f2f);
//           color: ${themeColors.textColor};
//           min-width: 120px;
//           justify-content: center;
//         }

//         .voice-btn.marking {
//           background: ${themeColors.buttonBg};
//           color: ${themeColors.textColor};
//           border: 2px solid ${themeColors.buttonBorder};
//           backdrop-filter: blur(10px);
//         }

//         .voice-btn.marking.active {
//           background: linear-gradient(135deg, ${themeColors.accentColor}, ${themeColors.accentColor}dd);
//           border-color: transparent;
//         }

//         .mode-btn {
//           display: flex;
//           align-items: center;
//           gap: 8px;
//           padding: 10px 16px;
//           border: 2px solid ${themeColors.buttonBorder};
//           border-radius: 24px;
//           background: ${themeColors.buttonBg};
//           color: ${themeColors.textColor};
//           cursor: pointer;
//           transition: all 0.3s ease;
//           backdrop-filter: blur(10px);
//         }

//         .mode-btn.content {
//           border-color: ${themeColors.accentColor};
//           background: linear-gradient(135deg, ${themeColors.accentColor}, ${themeColors.accentColor}dd);
//         }

//         .mode-btn.interactive {
//           border-color: ${themeColors.accentColor};
//           background: linear-gradient(135deg, ${themeColors.accentColor}, ${themeColors.accentColor}dd);
//         }

//         .btn-icon, .mode-icon {
//           font-size: 18px;
//           line-height: 1;
//         }

//         .mode-text {
//           font-weight: 500;
//         }

//         .voice-btn:hover:not(:disabled) {
//           transform: translateY(-2px);
//           box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
//         }

//         .voice-btn:disabled {
//           opacity: 0.5;
//           cursor: not-allowed;
//           transform: none;
//         }

//         /* Help Toggle Section */
//         .help-toggle-section {
//           margin: 16px 0;
//           padding: 16px 0;
//           border-top: 1px solid ${themeColors.buttonBorder};
//         }

//         .help-toggle-btn {
//           display: flex;
//           align-items: center;
//           gap: 8px;
//           width: 100%;
//           padding: 12px 16px;
//           background: ${themeColors.buttonBg};
//           border: none;
//           border-radius: 10px;
//           color: ${themeColors.textColor};
//           font-size: 14px;
//           font-weight: 500;
//           cursor: pointer;
//           transition: all 0.2s ease;
//           backdrop-filter: blur(10px);
//         }

//         .help-toggle-btn:hover {
//           background: ${themeColors.buttonBgHover};
//           transform: translateY(-1px);
//         }

//         .help-icon {
//           font-size: 16px;
//         }

//         .toggle-arrow {
//           margin-left: auto;
//           font-size: 12px;
//           transition: transform 0.3s ease;
//         }

//         .toggle-arrow.open {
//           transform: rotate(180deg);
//         }

//         .toggle-arrow.closed {
//           transform: rotate(0deg);
//         }

//         /* Status Messages */
//         .status-messages {
//           display: flex;
//           flex-direction: column;
//           gap: 8px;
//           margin-bottom: 16px;
//         }

//         .message {
//           display: flex;
//           align-items: flex-start;
//           gap: 8px;
//           padding: 12px;
//           border-radius: 10px;
//           backdrop-filter: blur(10px);
//           animation: slideIn 0.3s ease;
//           font-size: 13px;
//         }

//         .message.error {
//           background: rgba(244, 67, 54, 0.15);
//           border: 1px solid rgba(244, 67, 54, 0.3);
//         }

//         .message.success {
//           background: rgba(76, 175, 80, 0.15);
//           border: 1px solid rgba(76, 175, 80, 0.3);
//         }

//         .message.transcript {
//           background: rgba(33, 150, 243, 0.15);
//           border: 1px solid rgba(33, 150, 243, 0.3);
//         }

//         .message.feedback {
//           background: ${themeColors.buttonBg};
//           border: 1px solid ${themeColors.buttonBorder};
//         }

//         .message-icon {
//           font-size: 20px;
//           line-height: 1;
//         }

//         .message-text, .message-content {
//           flex: 1;
//           line-height: 1.5;
//         }

//         /* Help Section */
//         .help-section {
//           background: ${themeColors.cardBg};
//           border-radius: 12px;
//           padding: 16px;
//           backdrop-filter: blur(20px);
//           border: 1px solid ${themeColors.buttonBorder};
//           margin-top: 12px;
//           animation: slideIn 0.3s ease;
//         }

//         .help-header {
//           display: flex;
//           justify-content: space-between;
//           align-items: center;
//           margin-bottom: 16px;
//           padding-bottom: 12px;
//           border-bottom: 1px solid ${themeColors.buttonBorder};
//         }

//         .help-header h3 {
//           margin: 0;
//           font-size: 16px;
//           font-weight: 600;
//         }

//         .current-mode {
//           font-size: 12px;
//           padding: 4px 8px;
//           background: ${themeColors.buttonBg};
//           border-radius: 12px;
//           color: ${themeColors.textColor};
//         }

//         .commands-compact {
//           display: flex;
//           flex-direction: column;
//           gap: 16px;
//           margin-bottom: 12px;
//         }

//         .command-group {
//           background: ${themeColors.cardBg};
//           border-radius: 8px;
//           padding: 12px;
//           border: 1px solid ${themeColors.buttonBorder};
//         }

//         .command-group h4 {
//           margin: 0 0 8px 0;
//           font-size: 14px;
//           font-weight: 600;
//           color: ${themeColors.textColor};
//           display: flex;
//           align-items: center;
//           gap: 6px;
//         }

//         .command-items {
//           display: flex;
//           flex-direction: column;
//           gap: 6px;
//         }

//         .command-items span {
//           color: ${themeColors.textSecondary};
//           font-size: 12px;
//           line-height: 1.4;
//           padding: 4px 0;
//         }

//         .help-tip {
//           display: flex;
//           align-items: center;
//           gap: 6px;
//           padding: 10px;
//           background: ${themeColors.cardBg};
//           border: 1px solid ${themeColors.accentColor};
//           border-radius: 8px;
//           font-size: 12px;
//           color: ${themeColors.textColor};
//         }

//         .tip-icon {
//           font-size: 18px;
//         }

//         /* Animations */
//         @keyframes pulse-dot {
//           0%, 100% { opacity: 1; transform: scale(1); }
//           50% { opacity: 0.5; transform: scale(1.2); }
//         }

//         @keyframes listening-pulse {
//           0% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7); }
//           70% { box-shadow: 0 0 0 15px rgba(255, 68, 68, 0); }
//           100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
//         }

//         @keyframes slideIn {
//           from {
//             opacity: 0;
//             transform: translateY(-10px);
//           }
//           to {
//             opacity: 1;
//             transform: translateY(0);
//           }
//         }

//         /* Responsive Design */
//         @media (max-width: 768px) {
//           .voice-navigation {
//             margin: 4px;
//             max-width: calc(100% - 8px);
//           }

//           .voice-header {
//             padding: 12px 16px;
//           }

//           .header-content {
//             flex-direction: row;
//           }

//           .voice-title {
//             font-size: 18px;
//           }

//           .compact-controls {
//             gap: 6px;
//             flex-wrap: wrap;
//           }

//           .voice-btn.compact {
//             padding: 6px 10px;
//             font-size: 12px;
//           }

//           .voice-btn.compact.primary {
//             min-width: 70px;
//             font-size: 12px;
//           }

//           .expandable-content.visible {
//             padding: 16px;
//           }

//           .primary-controls {
//             flex-direction: column;
//             gap: 12px;
//           }

//           .mode-controls {
//             flex-direction: column;
//             gap: 12px;
//           }

//           .commands-compact {
//             gap: 12px;
//           }

//           .voice-btn.primary {
//             font-size: 13px;
//             padding: 10px 16px;
//             min-width: 140px;
//           }

//           .current-mode-compact {
//             font-size: 16px;
//             padding: 4px;
//           }

//           .status-indicator {
//             gap: 6px;
//             padding: 6px 12px;
//           }

//           .status-text {
//             font-size: 12px;
//           }
//         }
//       `}</style>
//     </div>
//   );
// };

// export default VoiceNavigation;