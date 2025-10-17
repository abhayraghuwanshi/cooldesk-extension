/**
 * Chat Link Scraper - Content Script
 * Scrapes chat links from AI platform pages (ChatGPT, Claude, Gemini)
 * Based on DOM structure analysis
 */

const PLATFORM_CONFIGS = {
  'chat.openai.com': {
    name: 'ChatGPT',
    selectors: {
      // Based on your HTML example: <a class="__menu-item" href="/c/...">
      chatItems: 'a.__menu-item[href*="/c/"], a[href^="/c/"]',
      titleElement: '.truncate',
      titleAttribute: 'title',
      waitFor: 'nav, [role="navigation"]',
    },
    extractChatId: (href) => {
      const match = href.match(/\/c\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },
  
  'chatgpt.com': {
    name: 'ChatGPT',
    selectors: {
      chatItems: 'a.__menu-item[href*="/c/"], a[href^="/c/"]',
      titleElement: '.truncate',
      titleAttribute: 'title',
      waitFor: 'nav, [role="navigation"]',
    },
    extractChatId: (href) => {
      const match = href.match(/\/c\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },
  
  'claude.ai': {
    name: 'Claude',
    selectors: {
      chatItems: 'a[href*="/chat/"]',
      titleElement: '[data-testid="chat-title"], .chat-title, div[title]',
      titleAttribute: 'title',
      waitFor: '[data-testid="chat-history"], .sidebar, nav',
    },
    extractChatId: (href) => {
      const match = href.match(/\/chat\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },
  
  'gemini.google.com': {
    name: 'Gemini',
    selectors: {
      chatItems: 'a[href*="/app/"]',
      titleElement: '.conversation-title, [data-conversation-title], div[title]',
      titleAttribute: 'title',
      waitFor: '.conversation-list, [role="navigation"], nav',
    },
    extractChatId: (href) => {
      const match = href.match(/\/app\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },
};

/**
 * Wait for element to appear in DOM
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

/**
 * Extract chat title from element
 * Handles multiple fallback strategies
 */
function extractTitle(element, config) {
  // Strategy 1: Try title attribute on nested div (from your HTML example)
  const titleDiv = element.querySelector('[title]');
  if (titleDiv) {
    const title = titleDiv.getAttribute('title');
    if (title && title.trim()) return title.trim();
  }
  
  // Strategy 2: Try titleElement selector
  if (config.selectors.titleElement) {
    const titleEl = element.querySelector(config.selectors.titleElement);
    if (titleEl) {
      const text = titleEl.textContent?.trim();
      if (text) return text;
    }
  }
  
  // Strategy 3: Try title attribute on main element
  if (config.selectors.titleAttribute) {
    const titleAttr = element.getAttribute(config.selectors.titleAttribute);
    if (titleAttr && titleAttr.trim()) return titleAttr.trim();
  }
  
  // Strategy 4: Fallback to element text content
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length < 200) {
    return text;
  }
  
  return 'Untitled Chat';
}

/**
 * Scrape chats from current page
 */
async function scrapeChats() {
  const hostname = window.location.hostname.replace('www.', '');
  const config = PLATFORM_CONFIGS[hostname];
  
  if (!config) {
    console.log('[ChatScraper] Not an AI platform page:', hostname);
    return { success: false, error: 'Not an AI platform' };
  }
  
  console.log(`[ChatScraper] Scraping ${config.name} chats...`);
  
  try {
    // Wait for sidebar/navigation to load
    if (config.selectors.waitFor) {
      console.log('[ChatScraper] Waiting for sidebar...');
      await waitForElement(config.selectors.waitFor, 10000);
      console.log('[ChatScraper] Sidebar loaded');
    }
    
    // Small delay to ensure content is rendered
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Find all chat items
    const chatElements = document.querySelectorAll(config.selectors.chatItems);
    console.log(`[ChatScraper] Found ${chatElements.length} chat elements`);
    
    const chats = [];
    const seenIds = new Set();
    
    chatElements.forEach((element) => {
      try {
        const href = element.getAttribute('href');
        if (!href) return;
        
        // Build full URL
        const url = href.startsWith('http') ? href : `${window.location.origin}${href}`;
        
        // Extract chat ID
        const chatId = config.extractChatId(href);
        if (!chatId || seenIds.has(chatId)) return;
        
        seenIds.add(chatId);
        
        // Extract title
        const title = extractTitle(element, config);
        
        // Skip generic titles
        if (title === 'New Chat' || title === 'Untitled' || title.length < 3) {
          console.log(`[ChatScraper] Skipping generic title: "${title}"`);
          return;
        }
        
        chats.push({
          url,
          chatId,
          title,
          platform: config.name,
          scrapedAt: Date.now(),
        });
        
        console.log(`[ChatScraper] ✓ ${title.substring(0, 50)}...`);
      } catch (err) {
        console.warn('[ChatScraper] Error processing chat element:', err);
      }
    });
    
    console.log(`[ChatScraper] ✅ Scraped ${chats.length} unique chats from ${config.name}`);
    
    return {
      success: true,
      platform: config.name,
      hostname,
      chats,
      scrapedAt: Date.now(),
    };
    
  } catch (error) {
    console.error('[ChatScraper] Error scraping chats:', error);
    return {
      success: false,
      error: error.message,
      platform: config.name,
    };
  }
}

/**
 * Get last scrape timestamp from IndexedDB UI_STATE store
 */
async function getLastScrapeTime() {
  try {
    const hostname = window.location.hostname.replace('www.', '');
    const config = PLATFORM_CONFIGS[hostname];
    if (!config) return 0;
    
    // Request last scrape time from background (which has DB access)
    const result = await chrome.runtime.sendMessage({
      type: 'GET_LAST_SCRAPE_TIME',
      data: { platform: config.name }
    });
    
    return result?.timestamp || 0;
  } catch (error) {
    console.warn('[ChatScraper] Failed to get last scrape time:', error);
    return 0;
  }
}

/**
 * Update last scrape timestamp in IndexedDB UI_STATE store
 */
async function updateLastScrapeTime(timestamp) {
  try {
    const hostname = window.location.hostname.replace('www.', '');
    const config = PLATFORM_CONFIGS[hostname];
    if (!config) return;
    
    // Send update to background
    await chrome.runtime.sendMessage({
      type: 'UPDATE_LAST_SCRAPE_TIME',
      data: { 
        platform: config.name,
        timestamp 
      }
    });
    
    console.log(`[ChatScraper] Updated last scrape time: ${new Date(timestamp).toLocaleString()}`);
  } catch (error) {
    console.warn('[ChatScraper] Failed to update last scrape time:', error);
  }
}

/**
 * Scrape only new chats (created after last scrape time)
 */
async function scrapeNewChats() {
  const hostname = window.location.hostname.replace('www.', '');
  const config = PLATFORM_CONFIGS[hostname];
  
  if (!config) {
    console.log('[ChatScraper] Not an AI platform page:', hostname);
    return { success: false, error: 'Not an AI platform' };
  }
  
  console.log(`[ChatScraper] Scraping new ${config.name} chats...`);
  
  try {
    // Get last scrape timestamp from IndexedDB
    const lastScrapeTime = await getLastScrapeTime();
    const lastScrapeDate = lastScrapeTime ? new Date(lastScrapeTime).toLocaleString() : 'Never';
    console.log(`[ChatScraper] Last scraped: ${lastScrapeDate}`);
    
    // Wait for sidebar/navigation to load
    if (config.selectors.waitFor) {
      console.log('[ChatScraper] Waiting for sidebar...');
      await waitForElement(config.selectors.waitFor, 10000);
      console.log('[ChatScraper] Sidebar loaded');
    }
    
    // Small delay to ensure content is rendered
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Find all chat items
    const chatElements = document.querySelectorAll(config.selectors.chatItems);
    console.log(`[ChatScraper] Found ${chatElements.length} chat elements`);
    
    const allChats = [];
    const newChats = [];
    const seenIds = new Set();
    const currentScrapeTime = Date.now();
    
    chatElements.forEach((element) => {
      try {
        const href = element.getAttribute('href');
        if (!href) return;
        
        // Build full URL
        const url = href.startsWith('http') ? href : `${window.location.origin}${href}`;
        
        // Extract chat ID
        const chatId = config.extractChatId(href);
        if (!chatId || seenIds.has(chatId)) return;
        
        seenIds.add(chatId);
        
        // Extract title
        const title = extractTitle(element, config);
        
        // Skip generic titles
        if (title === 'New Chat' || title === 'Untitled' || title.length < 3) {
          console.log(`[ChatScraper] Skipping generic title: "${title}"`);
          return;
        }
        
        const chat = {
          url,
          chatId,
          title,
          platform: config.name,
          scrapedAt: currentScrapeTime,
        };
        
        allChats.push(chat);
        
        // For first scrape (lastScrapeTime === 0), mark all as new
        // Otherwise, we'll let the background check against existing DB entries
        if (lastScrapeTime === 0) {
          newChats.push(chat);
          console.log(`[ChatScraper] ✓ NEW: ${title.substring(0, 50)}...`);
        } else {
          // Send all chats to background, it will check against DB
          newChats.push(chat);
          console.log(`[ChatScraper] 📋 ${title.substring(0, 50)}...`);
        }
      } catch (err) {
        console.warn('[ChatScraper] Error processing chat element:', err);
      }
    });
    
    console.log(`[ChatScraper] ✅ Found ${allChats.length} total chats`);
    
    return {
      success: true,
      platform: config.name,
      hostname,
      chats: newChats, // Send all chats, background will deduplicate
      totalChats: allChats.length,
      newChatsCount: newChats.length,
      scrapedAt: currentScrapeTime,
      lastScrapeTime, // Include for background processing
    };
    
  } catch (error) {
    console.error('[ChatScraper] Error scraping chats:', error);
    return {
      success: false,
      error: error.message,
      platform: config.name,
    };
  }
}

/**
 * Auto-scrape on page load (with debounce to avoid multiple triggers)
 */
let autoScrapeTimeout = null;
async function autoScrape() {
  // Clear any pending auto-scrape
  if (autoScrapeTimeout) {
    clearTimeout(autoScrapeTimeout);
  }
  
  // Debounce: wait 3 seconds after page settles
  autoScrapeTimeout = setTimeout(async () => {
    console.log('[ChatScraper] Auto-scraping new chats...');
    
    const result = await scrapeNewChats();
    
    if (result.success && result.newChatsCount > 0) {
      // Send new chats to background for storage
      try {
        console.log(`[ChatScraper] 📤 Sending ${result.newChatsCount} chats to background...`);
        const response = await chrome.runtime.sendMessage({
          type: 'AUTO_SCRAPED_CHATS',
          data: result
        });
        console.log(`[ChatScraper] ✅ Auto-scraped ${result.newChatsCount} new chats`);
        console.log('[ChatScraper] Background response:', response);
      } catch (error) {
        console.error('[ChatScraper] ❌ Failed to send auto-scraped chats:', error);
        console.error('[ChatScraper] Error details:', error.message, error.stack);
      }
    } else if (result.success) {
      console.log('[ChatScraper] ℹ️ No new chats found');
    }
  }, 3000);
}

/**
 * Listen for scrape requests from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_CHATS') {
    console.log('[ChatScraper] Received manual scrape request');
    
    // Manual scrape: get ALL chats (not just new ones)
    scrapeChats()
      .then(result => {
        console.log('[ChatScraper] Manual scrape complete:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[ChatScraper] Manual scrape failed:', error);
        sendResponse({
          success: false,
          error: error.message,
        });
      });
    
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'SCRAPE_NEW_CHATS') {
    console.log('[ChatScraper] Received new chats scrape request');
    
    // Scrape only new chats
    scrapeNewChats()
      .then(result => {
        console.log('[ChatScraper] New chats scrape complete:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[ChatScraper] New chats scrape failed:', error);
        sendResponse({
          success: false,
          error: error.message,
        });
      });
    
    return true;
  }
});

// Auto-scrape when content script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[ChatScraper] Content script loaded and ready');
    autoScrape();
  });
} else {
  console.log('[ChatScraper] Content script loaded and ready');
  autoScrape();
}

// Also auto-scrape when URL changes (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[ChatScraper] URL changed, triggering auto-scrape');
    autoScrape();
  }
}).observe(document, { subtree: true, childList: true });
