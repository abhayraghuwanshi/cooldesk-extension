/**
 * Real-time URL categorization on tab changes
 */

import { addUrlToWorkspace, listWorkspaces, saveWorkspace } from '../db';
import GenericUrlParser from './GenericUrlParser.js';
import categoryManager from '../data/categories.js';

/**
 * Set up real-time URL categorization
 * Listens to tab updates and categorizes URLs instantly
 */
// Cross-browser API detection
function getBrowserAPI() {
  // Chrome/Chromium
  if (typeof chrome !== 'undefined' && chrome?.tabs) {
    return chrome;
  }

  // Firefox/Mozilla
  if (typeof browser !== 'undefined' && browser?.tabs) {
    return browser;
  }

  // Edge Legacy
  if (typeof msBrowser !== 'undefined' && msBrowser?.tabs) {
    return msBrowser;
  }

  return null;
}

/**
 * Get ChatGPT conversation title from browser history
 * @param {string} url - The ChatGPT URL to search for
 * @returns {Promise<string|null>} - The title from history or null
 */
async function getChatGPTTitleFromHistory(url) {
  const browserAPI = getBrowserAPI();

  if (!browserAPI?.history) {
    console.warn('Browser history API not available');
    return null;
  }

  try {
    // Get conversation ID first
    const conversationMatch = url.match(/\/c\/([a-f0-9-]+)/);
    const conversationId = conversationMatch ? conversationMatch[1] : null;
    let fallbackTitle = null;

    console.log('🔍 Looking for ChatGPT title for URL:', url, 'Conversation ID:', conversationId);

    // Try multiple search approaches - start with broad searches to find all ChatGPT history
    const searchApproaches = [
      { text: 'chatgpt.com', description: 'domain search', maxResults: 100 },
      { text: 'chat.openai.com', description: 'old domain search', maxResults: 100 },
      { text: conversationId, description: 'conversation ID', maxResults: 20 },
      { text: url, description: 'exact URL', maxResults: 10 }
    ];

    for (const approach of searchApproaches) {
      if (!approach.text) continue;

      console.log(`🔍 Searching history by ${approach.description}:`, approach.text);

      const historyItems = await browserAPI.history.search({
        text: approach.text,
        maxResults: approach.maxResults || 50,
        startTime: Date.now() - (30 * 24 * 60 * 60 * 1000) // Last 30 days
      });

      console.log(`📚 Found ${historyItems?.length || 0} results for ${approach.description}`);

      if (historyItems && historyItems.length > 0) {
        for (const historyItem of historyItems) {
          console.log('📖 Checking history item:', {
            title: historyItem.title,
            url: historyItem.url,
            visitCount: historyItem.visitCount,
            lastVisitTime: new Date(historyItem.lastVisitTime || 0).toLocaleString()
          });

          // Check if this is the right conversation
          if (conversationId && historyItem.url && historyItem.url.includes(conversationId)) {
            if (historyItem.title &&
              historyItem.title !== 'ChatGPT' &&
              historyItem.title !== 'New chat' &&
              historyItem.title.length > 3) {

              // Prefer non-generic titles, but accept "Chat [ID]" as last resort
              if (!historyItem.title.startsWith('Chat ') || approach.description === 'exact URL') {
                console.log('✅ Found good title from history:', historyItem.title);
                return historyItem.title;
              } else {
                console.log('📝 Found generic title, continuing search:', historyItem.title);
                // Continue searching for better title, but store this as fallback
                if (!fallbackTitle) {
                  fallbackTitle = historyItem.title;
                }
              }
            }
          }
        }
      }
    }

    // Return fallback title if we found one
    if (typeof fallbackTitle !== 'undefined') {
      console.log('📝 Using fallback title from history:', fallbackTitle);
      return fallbackTitle;
    }

    console.log('❌ No title found in history for:', url);
    return null;

  } catch (error) {
    console.error('Error accessing browser history:', error);
    return null;
  }
}

/**
 * Extract ChatGPT title from tab by injecting content script
 * @param {number} tabId - The tab ID to extract title from
 * @returns {Promise<string|null>} - The extracted title or null
 */
async function extractChatGPTTitleFromTab(tabId) {
  const browserAPI = getBrowserAPI();

  if (!browserAPI?.scripting || !tabId) {
    console.warn('Browser scripting API not available or no tabId');
    return null;
  }

  try {
    // Inject content script to extract title
    const results = await browserAPI.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Try multiple selectors that ChatGPT uses for conversation titles
        const selectors = [
          // ChatGPT conversation title in sidebar
          'nav a[href*="/c/"] .overflow-hidden',
          'nav a[href*="/c/"] div:not([class*="icon"])',
          // Active conversation title
          'nav a[aria-current="page"] .overflow-hidden',
          'nav a[aria-current="page"] div:not([class*="icon"])',
          // Main content area title
          '.text-token-text-primary h1',
          '.text-token-text-primary .text-xl',
          // Sidebar conversation list active item
          '.bg-token-sidebar-surface-secondary .overflow-hidden',
          // Generic conversation title selectors
          '[data-testid="conversation-title"]',
          '.conversation-title'
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent?.trim();
            if (text &&
              text !== 'ChatGPT' &&
              text !== 'New chat' &&
              !text.startsWith('Chat ') && // Skip generic "Chat ID" titles
              text.length > 3 &&
              text.length < 200 &&
              !text.includes('GPT-') && // Skip model indicators
              !text.includes('●')) { // Skip status indicators
              return text;
            }
          }
        }

        return null;
      }
    });

    if (results && results[0] && results[0].result) {
      console.log('✅ Extracted title from page:', results[0].result);
      return results[0].result;
    }

  } catch (error) {
    console.warn('Error extracting title from tab:', error);
  }

  return null;
}

export function setupRealTimeCategorizor() {
  const browserAPI = getBrowserAPI();

  if (!browserAPI) {
    console.log('Real-time categorization requires WebExtension context (Chrome/Firefox/Edge)');
    return null;
  }

  console.log(`Using ${browserAPI === chrome ? 'Chrome' : browserAPI === browser ? 'Firefox' : 'Edge'} WebExtensions API`);

  let isSetup = false;

  const categorizeUrl = async (url, title = '', tabId = null) => {
    if (!url || GenericUrlParser.shouldExclude(url)) {
      return;
    }

    try {
      let enhancedTitle = title;

      // Enrich with history for *all* URLs, not just ChatGPT
      const enriched = await GenericUrlParser.enrichWithHistory(url, enhancedTitle, browserAPI);
      enhancedTitle = enriched.title;

      // ChatGPT-specific fallback if title is still generic
      if ((url.includes('chat.openai.com') || url.includes('chatgpt.com')) && tabId) {
        if (!enhancedTitle || enhancedTitle === 'ChatGPT' || enhancedTitle === 'New chat') {
          const tabTitle = await extractChatGPTTitleFromTab(tabId);
          if (tabTitle) enhancedTitle = tabTitle;
        }
      }

      const parsed = GenericUrlParser.parse(url, enhancedTitle);
      if (!parsed) {
        console.log(`No platform detected for: ${url}`);
        return;
      }
      console.log(`Detected ${parsed.platform.name} URL: ${url}`, parsed);

      // Check if workspace already exists
      const existingWorkspaces = await listWorkspaces();
      const existingWorkspace = existingWorkspaces.find(ws =>
        ws.name?.toLowerCase() === parsed.workspace.toLowerCase()
      );

      if (!existingWorkspace) {
        // Create new workspace
        const workspace = {
          id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: parsed.workspace,
          description: `${parsed.platform.name} workspace`,
          createdAt: Date.now(),
          urls: [{
            url: parsed.url,
            title: enhancedTitle || parsed.title || 'Untitled',
            addedAt: Date.now(),
            favicon: parsed.favicon
          }],
          context: {
            platform: parsed.platform,
            details: parsed.details,
            createdFrom: 'real_time',
            autoCreated: true
          }
        };

        await saveWorkspace(workspace);
        console.log(`Created workspace: ${workspace.name}`);

        // Index URL
        await addUrlToWorkspace(url, workspace.id, {
          title: enhancedTitle || parsed.title || 'Untitled',
          favicon: parsed.favicon,
          addedAt: Date.now()
        });

        // Broadcast change
        try {
          const bc = new BroadcastChannel('ws_db_changes');
          bc.postMessage({ type: 'workspacesChanged', realTime: true });
          bc.close();
        } catch (e) {
          console.warn('Failed to broadcast workspace change:', e);
        }
      } else {
        // Add URL to existing workspace
        try {
          await addUrlToWorkspace(url, existingWorkspace.id, {
            title: enhancedTitle || parsed.title || 'Untitled',
            favicon: parsed.favicon,
            addedAt: Date.now()
          });
          console.log(`Added URL to existing ${parsed.workspace} workspace`);
        } catch (indexError) {
          console.warn(`Failed to index URL to existing workspace:`, indexError);
        }
      }

    } catch (error) {
      console.error('Error in real-time categorization:', error);
    }
  };

  const setupListeners = () => {
    if (isSetup) return;
    isSetup = true;

    // Listen to tab updates (when URL changes)
    browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        categorizeUrl(tab.url, tab.title, tabId);
      }
    });

    // Listen to tab activation (when switching tabs)
    browserAPI.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await browserAPI.tabs.get(activeInfo.tabId);
        if (tab.url) {
          categorizeUrl(tab.url, tab.title, activeInfo.tabId);
        }
      } catch (e) {
        // Tab might be closed already
      }
    });

    // Listen to new tabs
    browserAPI.tabs.onCreated.addListener((tab) => {
      if (tab.url && !isInternalUrl(tab.url)) {
        categorizeUrl(tab.url, tab.title, tab.id);
      }
    });

    console.log('Real-time URL categorization enabled');
  };

  // Helper function to detect internal/system URLs across browsers
  function isInternalUrl(url) {
    if (!url) return true;

    const internalPatterns = [
      /^chrome:\/\//,      // Chrome internal pages
      /^chrome-extension:\/\//, // Chrome extensions  
      /^moz-extension:\/\//, // Firefox extensions
      /^about:/,           // Firefox about pages
      /^edge:\/\//,        // Edge internal pages
      /^extension:\/\//,   // Generic extension protocol
      /^resource:\/\//,    // Firefox resource protocol
      /^data:/,            // Data URLs
      /^javascript:/       // JavaScript URLs
    ];

    return internalPatterns.some(pattern => pattern.test(url));
  }

  return {
    enable: setupListeners,
    categorizeNow: categorizeUrl,
    isSetup: () => isSetup
  };
}

/**
 * Categorize current active tab immediately
 */
export async function categorizeCurrentTab() {
  const browserAPI = getBrowserAPI();

  if (!browserAPI) {
    console.warn('Browser tabs API not available');
    return false;
  }

  try {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !GenericUrlParser.shouldExclude(tab.url)) {
      const categorizer = setupRealTimeCategorizor();
      await categorizer.categorizeNow(tab.url, tab.title);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to categorize current tab:', error);
    return false;
  }
}

// Auto-setup when module loads in any WebExtension context
const browserAPI = getBrowserAPI();
if (browserAPI) {
  const categorizer = setupRealTimeCategorizor();
  // Auto-enable after short delay to avoid setup conflicts
  setTimeout(() => {
    try {
      categorizer?.enable();
    } catch (e) {
      console.warn('Failed to auto-enable real-time categorization:', e);
    }
  }, 1000);
}

// Export for console usage
if (typeof window !== 'undefined') {
  window.realTimeCategorizor = {
    setup: setupRealTimeCategorizor,
    categorizeNow: categorizeCurrentTab
  };
}