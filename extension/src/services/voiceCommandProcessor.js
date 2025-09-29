import * as pageInteraction from './pageInteractionService.js';
import { fuzzySearch } from '../utils/searchUtils.js';

export class VoiceCommandProcessor {
  constructor(showFeedback, workspaceData = null) {
    this.showFeedback = showFeedback;
    this.workspaceData = workspaceData;
  }

  // Update workspace data for dynamic access
  updateWorkspaceData(workspaceData) {
    this.workspaceData = workspaceData;
  }

  async processVoiceCommand(command) {
    try {
      console.log('Processing command:', command);

      // Tab switching commands
      if (command.includes('switch to tab') || command.includes('go to tab')) {
        await this.handleTabSwitch(command);
      }
      // Next/Previous tab
      else if (command.includes('next tab')) {
        await this.switchToNextTab();
      }
      else if (command.includes('previous tab') || command.includes('prev tab')) {
        await this.switchToPreviousTab();
      }
      // Tab management
      else if (command.includes('close tab')) {
        await this.closeCurrentTab();
      }
      else if (command.includes('new tab')) {
        await this.createNewTab();
      }
      else if (command.includes('duplicate tab')) {
        await this.duplicateCurrentTab();
      }
      else if (command.includes('reload tab') || command.includes('refresh tab')) {
        await this.reloadCurrentTab();
      }
      // Window management
      else if (command.includes('new window')) {
        await this.createNewWindow();
      }
      else if (command.includes('close window')) {
        await this.closeCurrentWindow();
      }
      // Tab search
      else if (command.includes('find tab') || command.includes('search tab')) {
        await this.findTab(command);
      }
      else if (command.includes('go to') && !command.includes('tab')) {
        await this.findTabByName(command);
      }
      // Search commands
      else if (command.includes('search for') || command.includes('google search') || command.includes('search google')) {
        await this.performWebSearch(command, 'google');
      }
      else if (command.includes('search') && (command.includes('youtube') || command.includes('you tube'))) {
        await this.performWebSearch(command, 'youtube');
      }
      else if (command.includes('search') && command.includes('perplexity')) {
        await this.performWebSearch(command, 'perplexity');
      }
      else if (command.includes('search') && (command.includes('chatgpt') || command.includes('chat gpt'))) {
        await this.performWebSearch(command, 'chatgpt');
      }
      else if (command.includes('search') && !command.includes('tab')) {
        await this.performWebSearch(command, 'google');
      }
      // Open specific websites
      else if (command.includes('open gmail') || command.includes('go to gmail')) {
        await this.openWebsite('https://mail.google.com');
      }
      else if (command.includes('open calendar') || command.includes('go to calendar')) {
        await this.openWebsite('https://calendar.google.com');
      }
      else if (command.includes('open youtube') || command.includes('go to youtube')) {
        await this.openWebsite('https://youtube.com');
      }
      // Open from workspace - handle various patterns
      else if (command.toLowerCase().includes('open') && !command.includes('go to website')) {
        console.log('Open command detected:', command);
        await this.openFromWorkspace(command);
      }
      else if (command.includes('go to website')) {
        await this.openWebsiteByName(command);
      }
      // Numbered clicking commands
      else if (command.match(/click (\d+)/) || command.match(/click number (\d+)/)) {
        await this.clickByNumber(command);
      }
      else if (command.includes('show numbers') || command.includes('number elements')) {
        return { action: 'showNumbers' };
      }
      else if (command.includes('hide numbers') || command.includes('clear numbers')) {
        return { action: 'hideNumbers' };
      }
      else if (command.includes('refresh numbers') || command.includes('reset numbers')) {
        return { action: 'refreshNumbers' };
      }
      else if (command.includes('update numbers') || command.includes('reload numbers')) {
        return { action: 'refreshNumbers' };
      }
      else if (command.includes('mark content') || command.includes('show content') || command.includes('content mode')) {
        return { action: 'switchToContentMode' };
      }
      else if (command.includes('mark buttons') || command.includes('interactive mode') || command.includes('button mode')) {
        return { action: 'switchToInteractiveMode' };
      }
      else if (command.includes('read') && command.match(/read (\\d+)/)) {
        await this.readContentByNumber(command);
      }
      // Link clicking commands
      else if (command.includes('click') || command.includes('click on')) {
        await this.clickLink(command);
      }
      else if (command.includes('follow') || command.includes('follow link')) {
        await this.clickLink(command.replace('follow link', 'click').replace('follow', 'click'));
      }
      // Page interaction commands
      else if (command.trim() === 'scroll down' || command.trim() === 'scroll down.' || command.trim() === 'scroll down!') {
        await this.scrollPage('down');
      }
      else if (command.trim() === 'scroll up' || command.trim() === 'scroll up.' || command.trim() === 'scroll up!') {
        await this.scrollPage('up');
      }
      else if (command.includes('go back') || command.includes('back')) {
        await this.goBack();
      }
      else if (command.includes('go forward') || command.includes('forward')) {
        await this.goForward();
      }
      // Page reload commands
      else if (command.includes('reload') || command.includes('refresh')) {
        await this.reloadCurrentTab();
      }
      // Media control commands
      else if (command.includes('play') && !command.includes('pause')) {
        await this.playMedia();
      }
      else if (command.includes('pause')) {
        await this.pauseMedia();
      }
      else if (command.includes('play pause') || command.includes('toggle play') || command.includes('spacebar')) {
        await this.togglePlayPause();
      }
      else if (command.includes('click play')) {
        await this.playMedia();
      }
      else if (command.includes('click pause')) {
        await this.pauseMedia();
      }
      else {
        this.showFeedback('Command not recognized. Try "switch to tab 2", "search for cats", "click subscribe", "play", "pause", or "open gmail"', 'error');
      }
    } catch (error) {
      console.error('Error processing voice command:', error);
      this.showFeedback(`Error: ${error.message}`, 'error');
    }
  }

  // Tab switching functions
  async handleTabSwitch(command) {
    const numberMatch = command.match(/tab (\d+)/);
    if (numberMatch) {
      const tabIndex = parseInt(numberMatch[1]) - 1;
      await this.switchToTabByIndex(tabIndex);
    } else {
      const nameMatch = command.match(/(?:switch to|go to) (.+?) tab/) || command.match(/(?:switch to|go to) (.+)/);
      if (nameMatch) {
        await this.findTabByName(nameMatch[1]);
      }
    }
  }

  async switchToTabByIndex(index) {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      if (index >= 0 && index < tabs.length) {
        await chrome.tabs.update(tabs[index].id, { active: true });
        this.showFeedback(`Switched to tab ${index + 1}: ${tabs[index].title}`);
      } else {
        this.showFeedback(`Tab ${index + 1} not found. Available tabs: 1-${tabs.length}`, 'error');
      }
    } catch (error) {
      throw new Error(`Failed to switch to tab: ${error.message}`);
    }
  }

  async switchToNextTab() {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = tabs.find(tab => tab.active);
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
      const nextIndex = (currentIndex + 1) % tabs.length;

      await chrome.tabs.update(tabs[nextIndex].id, { active: true });
      this.showFeedback(`Switched to next tab: ${tabs[nextIndex].title}`);
    } catch (error) {
      throw new Error(`Failed to switch to next tab: ${error.message}`);
    }
  }

  async switchToPreviousTab() {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = tabs.find(tab => tab.active);
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab.id);
      const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;

      await chrome.tabs.update(tabs[prevIndex].id, { active: true });
      this.showFeedback(`Switched to previous tab: ${tabs[prevIndex].title}`);
    } catch (error) {
      throw new Error(`Failed to switch to previous tab: ${error.message}`);
    }
  }

  async findTabByName(searchTerm) {
    try {
      const tabs = await chrome.tabs.query({});
      const cleanSearchTerm = searchTerm.replace(/^(go to|switch to)\s+/, '').trim();

      // Enhanced matching with multiple strategies
      const matchingTab = tabs.find(tab => {
        const title = tab.title.toLowerCase();
        const url = tab.url.toLowerCase();
        const search = cleanSearchTerm.toLowerCase();

        // Strategy 2: Starts with match
        const startsWithMatch = title.startsWith(search) ||
          title.split(' ').some(word => word.startsWith(search));

        // Strategy 1: Direct word match (word boundaries)
        const wordMatch = new RegExp(`\\b${search}\\b`, 'i').test(title) ||
          new RegExp(`\\b${search}\\b`, 'i').test(url);

        // Strategy 3: Contains match (original)
        const containsMatch = title.includes(search) || url.includes(search);

        return wordMatch || startsWithMatch || containsMatch;
      });

      if (matchingTab) {
        await chrome.tabs.update(matchingTab.id, { active: true });
        await chrome.windows.update(matchingTab.windowId, { focused: true });
        this.showFeedback(`Switched to: ${matchingTab.title}`);
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
          this.showFeedback(`No exact match for "${cleanSearchTerm}". Try: ${suggestions}`, 'error');
        } else {
          this.showFeedback(`No tab found matching "${cleanSearchTerm}"`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to find tab: ${error.message}`);
    }
  }

  // Tab management functions
  async closeCurrentTab() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.remove(activeTab.id);
      this.showFeedback('Tab closed');
    } catch (error) {
      throw new Error(`Failed to close tab: ${error.message}`);
    }
  }

  async createNewTab() {
    try {
      const newTab = await chrome.tabs.create({});
      this.showFeedback('New tab created');
    } catch (error) {
      throw new Error(`Failed to create new tab: ${error.message}`);
    }
  }

  async duplicateCurrentTab() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.duplicate(activeTab.id);
      this.showFeedback(`Tab duplicated: ${activeTab.title}`);
    } catch (error) {
      throw new Error(`Failed to duplicate tab: ${error.message}`);
    }
  }

  async reloadCurrentTab() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.reload(activeTab.id);
      this.showFeedback('Tab reloaded');
    } catch (error) {
      throw new Error(`Failed to reload tab: ${error.message}`);
    }
  }

  // Window management functions
  async createNewWindow() {
    try {
      await chrome.windows.create({});
      this.showFeedback('New window created');
    } catch (error) {
      throw new Error(`Failed to create new window: ${error.message}`);
    }
  }

  async closeCurrentWindow() {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.windows.remove(currentWindow.id);
      this.showFeedback('Window closed');
    } catch (error) {
      throw new Error(`Failed to close window: ${error.message}`);
    }
  }

  async findTab(command) {
    try {
      const searchMatch = command.match(/find tab (.+)/) || command.match(/search tab (.+)/);
      if (searchMatch) {
        const searchTerm = searchMatch[1].trim();
        const tabs = await chrome.tabs.query({});

        // Use fuzzySearch for better matching
        const matchingTabs = fuzzySearch(tabs, searchTerm, ['title', 'url'], {
          threshold: 0.3,
          includeScore: true
        });

        if (matchingTabs.length > 0) {
          const tabInfo = matchingTabs.map((tab, index) => `${index + 1}. ${tab.title}`).join(', ');
          this.showFeedback(`Found ${matchingTabs.length} tab(s): ${tabInfo}`);

          // Automatically switch to first match
          await chrome.tabs.update(matchingTabs[0].id, { active: true });
          await chrome.windows.update(matchingTabs[0].windowId, { focused: true });
        } else {
          this.showFeedback(`No tabs found matching "${searchTerm}"`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to search tabs: ${error.message}`);
    }
  }

  // Search and website functions
  async performWebSearch(command, engine = 'google') {
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
        this.showFeedback('Please specify what to search for', 'error');
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
      this.showFeedback(`Searching ${engineName} for "${searchTerm}"`);
    } catch (error) {
      throw new Error(`Failed to perform web search: ${error.message}`);
    }
  }

  async openWebsite(url) {
    try {
      await chrome.tabs.create({ url });
      const domain = new URL(url).hostname.replace('www.', '');
      this.showFeedback(`Opened ${domain}`);
    } catch (error) {
      throw new Error(`Failed to open website: ${error.message}`);
    }
  }

  async openFromWorkspace(command) {
    try {
      console.log('openFromWorkspace called with command:', command);

      let searchTerm = '';

      // Extract search term from command - handle punctuation
      if (command.includes('open')) {
        searchTerm = command.replace(/.*open\s+/, '').trim();
        // Remove trailing punctuation (., !, ?)
        searchTerm = searchTerm.replace(/[.!?]+$/, '').trim();
      }

      console.log('Extracted search term:', searchTerm);

      if (!searchTerm) {
        this.showFeedback('Please specify what to open', 'error');
        return;
      }

      // Get workspace data from chrome storage if not provided
      let workspaceData = this.workspaceData;
      console.log('Current workspace data from processor:', workspaceData);

      if (!workspaceData) {
        console.log('No workspace data, fetching from background...');
        try {
          // Try to get workspace data from chrome runtime message
          const response = await chrome.runtime.sendMessage({
            action: 'getWorkspaceData'
          });
          console.log('Background response:', response);
          if (response?.success) {
            workspaceData = response.data;
          }
        } catch (error) {
          console.warn('Could not get workspace data:', error);
        }
      }

      if (!workspaceData || (!workspaceData.allItems && !workspaceData.savedItems)) {
        console.log('No workspace data available, using fallback. WorkspaceData:', workspaceData);
        // Fallback to website mapping
        await this.openWebsiteByName(command);
        return;
      }

      // Combine all available items for search
      const allItems = [
        ...(workspaceData.allItems || []),
        ...(workspaceData.savedItems || [])
      ];

      console.log('Total items available for search:', allItems.length);
      console.log('Sample items:', allItems.slice(0, 3).map(item => ({ title: item.title, url: item.url })));

      if (allItems.length === 0) {
        console.log('No items found, using fallback');
        await this.openWebsiteByName(command);
        return;
      }

      // Use fuzzy search to find matching items
      const matches = fuzzySearch(allItems, searchTerm, ['title', 'url'], {
        threshold: 0.3,
        includeScore: true
      });

      console.log('Fuzzy search results:', matches.length, 'matches for term:', searchTerm);

      if (matches.length > 0) {
        const bestMatch = matches[0];
        const url = bestMatch.url;

        if (url) {
          await chrome.tabs.create({ url });
          this.showFeedback(`Opened: ${bestMatch.title || url}`);
        } else {
          this.showFeedback('No valid URL found for that item', 'error');
        }
      } else {
        // If no workspace matches, try website mapping as fallback
        this.showFeedback(`No workspace matches for "${searchTerm}". Trying website search...`);
        await this.openWebsiteByName(command);
      }
    } catch (error) {
      console.error('Error opening from workspace:', error);
      // Fallback to website mapping
      await this.openWebsiteByName(command);
    }
  }

  async openWebsiteByName(command) {
    try {
      let siteName = '';

      if (command.includes('open')) {
        siteName = command.replace(/.*open\s+/, '').trim();
      } else if (command.includes('go to website')) {
        siteName = command.replace(/.*go to website\s+/, '').trim();
      }

      if (!siteName) {
        this.showFeedback('Please specify which website to open', 'error');
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
      this.showFeedback(`Opened ${siteName}`);
    } catch (error) {
      throw new Error(`Failed to open website: ${error.message}`);
    }
  }

  // Link clicking and page interaction functions
  async clickLink(command) {
    try {
      let linkText = '';

      if (command.includes('click on')) {
        linkText = command.replace(/.*click on\s+/, '').trim();
      } else if (command.includes('click')) {
        linkText = command.replace(/.*click\s+/, '').trim();
      }

      if (!linkText) {
        this.showFeedback('Please specify what to click', 'error');
        return;
      }

      // Get the active tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Inject script to find and click the link
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.findAndClickLink,
        args: [linkText]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          this.showFeedback(`Clicked: ${result.elementText || linkText}`);
        } else {
          this.showFeedback(`Could not find clickable element: "${linkText}". ${result.suggestions || ''}`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to click link: ${error.message}`);
    }
  }

  async scrollPage(direction) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.scrollPageFunction,
        args: [direction]
      });

      this.showFeedback(`Scrolled ${direction}`);
    } catch (error) {
      throw new Error(`Failed to scroll: ${error.message}`);
    }
  }

  async goBack() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => window.history.back()
      });
      this.showFeedback('Went back');
    } catch (error) {
      throw new Error(`Failed to go back: ${error.message}`);
    }
  }

  async goForward() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => window.history.forward()
      });
      this.showFeedback('Went forward');
    } catch (error) {
      throw new Error(`Failed to go forward: ${error.message}`);
    }
  }

  async clickByNumber(command) {
    try {
      const numberMatch = command.match(/click (\d+)/) || command.match(/click number (\d+)/);
      if (!numberMatch) {
        this.showFeedback('Please specify a number to click', 'error');
        return;
      }

      const clickNumber = parseInt(numberMatch[1]);

      if (clickNumber < 1) {
        this.showFeedback('Please use numbers starting from 1', 'error');
        return;
      }

      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.clickElementByNumber,
        args: [clickNumber]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          this.showFeedback(`Clicked element ${clickNumber}: ${result.elementText}`);
        } else {
          if (result.maxNumber) {
            this.showFeedback(`Element ${clickNumber} not found. Available: 1-${result.maxNumber}. Say "show numbers" first.`, 'error');
          } else {
            this.showFeedback('No numbered elements found. Say "show numbers" first.', 'error');
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to click by number: ${error.message}`);
    }
  }

  async readContentByNumber(command) {
    try {
      const numberMatch = command.match(/read (\\d+)/);
      if (!numberMatch) {
        this.showFeedback('Please specify a number to read', 'error');
        return;
      }

      const contentNumber = parseInt(numberMatch[1]);
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.readContentElementByNumber,
        args: [contentNumber]
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        if (result.success) {
          // Use text-to-speech to read the content
          if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(result.content);
            utterance.rate = 0.8;
            utterance.pitch = 1;
            speechSynthesis.speak(utterance);
          }
          this.showFeedback(`Reading: ${result.title || 'Content'}`);
        } else {
          this.showFeedback(`Content ${contentNumber} not found`, 'error');
        }
      }
    } catch (error) {
      throw new Error(`Failed to read content: ${error.message}`);
    }
  }

  // Media control functions
  async playMedia() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.playMediaOnPage
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        this.showFeedback(result.message, result.success ? 'success' : 'error');
      }
    } catch (error) {
      throw new Error(`Failed to play media: ${error.message}`);
    }
  }

  async pauseMedia() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.pauseMediaOnPage
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        this.showFeedback(result.message, result.success ? 'success' : 'error');
      }
    } catch (error) {
      throw new Error(`Failed to pause media: ${error.message}`);
    }
  }

  async togglePlayPause() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: pageInteraction.togglePlayPauseOnPage
      });

      if (results && results[0] && results[0].result) {
        const result = results[0].result;
        this.showFeedback(result.message, result.success ? 'success' : 'error');
      }
    } catch (error) {
      throw new Error(`Failed to toggle play/pause: ${error.message}`);
    }
  }
}