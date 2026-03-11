/**
 * Chat Link Scraper - Content Script
 * Scrapes chat links from AI platform pages (ChatGPT, Claude, Gemini)
 * Also supports generic link scraping for any website
 * Based on DOM structure analysis
 */

// Import generic scraper functions (will be loaded alongside this script)
// The generic scraper provides automatic link detection for non-configured sites

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
      titleElement: '.truncate', // Title is in a div with class "truncate"
      titleAttribute: null, // Title is in text content, not attribute
      waitFor: 'a[href*="/chat/"]', // Wait for chat links to appear
    },
    extractChatId: (href) => {
      // Extract UUID from /chat/1bca9c6a-4485-48d8-ac31-bbc36dd4b1c6
      const match = href.match(/\/chat\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },

  'grok.com': {
    name: 'Grok',
    selectors: {
      // Select the parent container div that contains both link and title
      chatItems: 'div[data-selected]',
      titleElement: '.truncate.text-primary, .truncate', // Title in truncate div with text-primary class
      titleAttribute: null, // Title is in text content, not attribute
      waitFor: 'div[data-selected]', // Wait for chat containers to appear
    },
    extractChatId: (element) => {
      // Find the link inside the container
      const link = element.querySelector('a[href*="/c/"]');
      if (!link) return null;

      const href = link.getAttribute('href');
      if (!href) return null;

      // Extract UUID from /c/39aab857-be5c-4bab-a7dc-e50c0d23f9f4
      const match = href.match(/\/c\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },

  'gemini.google.com': {
    name: 'Gemini',
    selectors: {
      // Gemini uses <a> elements with data-test-id="conversation"
      chatItems: 'a[data-test-id="conversation"]',
      titleElement: '.conversation-title',
      titleAttribute: null,
      waitFor: '.conversation-items-container, [role="navigation"], nav',
    },
    extractChatId: (href) => {
      // Extract ID from /app/ae75e5427dbb3832
      // Support both full URL and relative path
      const match = href.match(/\/app\/([a-f0-9]+)/);
      return match ? match[1] : null;
    },
  },

  'perplexity.ai': {
    name: 'Perplexity',
    selectors: {
      chatItems: 'a[href^="/search/"]',
      titleElement: 'div[data-testid^="thread-title-"]',
      titleAttribute: null,
      waitFor: 'a[href^="/search/"]',
    },
    extractChatId: (href) => {
      // Extract UUID/slug from /search/role-you-are-a-cloud-pricing-s-hlF5adzTS4aBsnpCaFLfnw
      const match = href.match(/\/search\/([a-zA-Z0-9-_]+)/);
      return match ? match[1] : null;
    },
  },

  'aistudio.google.com': {
    name: 'AI Studio',
    selectors: {
      chatItems: 'a.applet-link',
      titleElement: null, // Title is the link text itself
      titleAttribute: null,
      waitFor: '.recently-viewed-applets-container, a.applet-link',
    },
    extractChatId: (href) => {
      // Extract ID from /apps/bundled/promptdj?showPreview=true...
      // or /apps/prompts/saved/123456
      const match = href.match(/\/apps\/(?:bundled\/|prompts\/saved\/)?([^/?]+)/);
      return match ? match[1] : null;
    },
  },

  'lovable.dev': {
    name: 'Lovable',
    selectors: {
      chatItems: 'a[href^="/projects/"]',
      titleElement: '.truncate',
      titleAttribute: null,
      waitFor: 'a[href^="/projects/"]',
    },
    extractChatId: (href) => {
      // Extract UUID from /projects/f2fa5106-245f-4c18-9096-12ff6a9976d1
      const match = href.match(/\/projects\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    },
  },
  'figma.com': {
    name: 'Figma',
    urlPrefix: '/design/',
    selectors: {
      // Figma Dashboard: role="listitem" or cards with specific classes
      chatItems: '[role="listitem"], .card-primitive__root__h5a39, [class*="card-primitive__root"]',
      titleElement: 'h2, [aria-label], .xxrns5j, .card-primitive__interactive__9-8aA',
      titleAttribute: 'aria-label',
      waitFor: '[role="listitem"], .card-primitive__root__h5a39',
    },
    extractChatId: (element) => {
      // If it's just a string (href), extract the ID from it
      if (typeof element === 'string') {
        const match = element.match(/\/(?:file|design)\/([a-zA-Z0-9-]+)/);
        return match ? match[1] : null;
      }

      // If it's an element (card)
      // 1. Try to find a link inside
      const link = element.querySelector('a[href*="/file/"], a[href*="/design/"]');
      if (link) {
        const href = link.getAttribute('href');
        const match = href.match(/\/(?:file|design)\/([a-zA-Z0-9-]+)/);
        if (match) return match[1];
      }

      // 2. Try thumbnail ID (very reliable in Figma)
      const img = element.querySelector('img[src*="/thumbnails/"]');
      if (img) {
        const src = img.getAttribute('src');
        const match = src.match(/\/thumbnails\/([a-f0-9-]+)/);
        if (match) return match[1];
      }

      // 3. Try to find it in data-testid or aria-labelledby context
      const titleSpan = element.querySelector('[data-testid="thumbnail-container"]');
      if (titleSpan && titleSpan.nextElementSibling) {
        // IDs are sometimes hidden in siblings
      }

      return null;
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
    console.log(`[ChatScraper] Selector used: "${config.selectors.chatItems}"`);
    console.log(`[ChatScraper] chatElements type:`, typeof chatElements, chatElements.constructor.name);
    console.log(`[ChatScraper] First element:`, chatElements[0]);

    // Convert NodeList to Array for better compatibility
    const chatElementsArray = Array.from(chatElements);
    console.log(`[ChatScraper] Converted to array, length: ${chatElementsArray.length}`);

    const chats = [];
    const seenIds = new Set();

    console.log(`[ChatScraper] Starting forEach loop...`);
    chatElementsArray.forEach((element, index) => {
      console.log(`[ChatScraper] Processing element ${index}/${chatElementsArray.length}`);
      try {
        // Handle both link-based (ChatGPT, Claude) and div-based (Gemini, Grok) items
        const href = element.getAttribute('href');
        let url, chatId;

        if (href) {
          // Link-based chat item (ChatGPT, Claude) - element IS the link
          url = href.startsWith('http') ? href : `${window.location.origin}${href}`;
          chatId = config.extractChatId(href);
          console.log(`[ChatScraper] Chat ${index}: href="${href}", chatId="${chatId}"`);
        } else {
          // Container-based chat item (Gemini, Grok) - element is a container
          console.log(`[ChatScraper] Chat ${index}: No href on element, trying extractChatId on container`);

          chatId = config.extractChatId(element);
          console.log(`[ChatScraper] Chat ${index}: Extracted chatId="${chatId}"`);

          if (!chatId) {
            console.log(`[ChatScraper] Chat ${index}: No chatId, skipping`);
            return;
          }

          // Dynamic Discovery: Search the document for ANY link containing this ID
          // This avoids hardcoding platform-specific URL structures
          const id = extractIdFromElement(element);
          if (id) {
            const foundLink = document.querySelector(`a[href*="${id}"]`);
            if (foundLink) {
              url = foundLink.href;
            } else if (window.location.hostname.includes('figma.com')) {
              // Minimal fallback for Figma cards where links are only active on click
              url = `${window.location.origin}/design/${id}`;
            } else if (window.location.hostname.includes('gemini.google.com')) {
              url = `${window.location.origin}/app/${id}`;
            }
          }

          if (!url) {
            // Fallback to constructing URL if not found dynamically
            const prefix = config.urlPrefix || '/app/';
            url = `${window.location.origin}${prefix}${chatId}`;
            console.log(`[ChatScraper] Chat ${index}: Constructed url="${url}"`);
          }
        }

        if (!chatId) {
          console.log(`[ChatScraper] Chat ${index}: chatId is null/undefined, skipping`);
          return;
        }

        if (seenIds.has(chatId)) {
          console.log(`[ChatScraper] Chat ${index}: Duplicate chatId="${chatId}", skipping`);
          return;
        }

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
        console.error(`[ChatScraper] Error processing element ${index}:`, err);
        console.error('[ChatScraper] Element:', element);
        console.error('[ChatScraper] Stack:', err.stack);
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
 * Send message to background with retry logic
 */
async function sendMessageWithRetry(message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check if runtime is available
      if (!chrome?.runtime?.id) {
        console.warn('[ChatScraper] Extension context invalidated');
        return null;
      }

      const result = await chrome.runtime.sendMessage(message);

      // Check for lastError after successful send
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const isConnectionError = error.message?.includes('Could not establish connection') ||
        error.message?.includes('Receiving end does not exist') ||
        error.message?.includes('message port closed');

      if (isConnectionError && !isLastAttempt) {
        console.log(`[ChatScraper] Connection error on attempt ${attempt}/${maxRetries}, retrying...`);
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        continue;
      }

      // For last attempt or non-connection errors, log and return null
      console.warn(`[ChatScraper] Message failed after ${attempt} attempts:`, error.message);
      return null;
    }
  }
  return null;
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
    const result = await sendMessageWithRetry({
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
    const result = await sendMessageWithRetry({
      type: 'UPDATE_LAST_SCRAPE_TIME',
      data: {
        platform: config.name,
        timestamp
      }
    });

    if (result?.success) {
      console.log(`[ChatScraper] Updated last scrape time: ${new Date(timestamp).toLocaleString()}`);
    }
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

    chatElements.forEach((element, index) => {
      try {
        // Handle both link-based (ChatGPT, Claude) and container-based (Gemini, Grok) items
        const href = element.getAttribute('href');
        let url, chatId;
        let extractionMethod = 'unknown';

        if (href) {
          extractionMethod = 'link';
          // Link-based chat item (ChatGPT, Claude) - element IS the link
          url = href.startsWith('http') ? href : `${window.location.origin}${href}`;
          chatId = config.extractChatId(href);
          console.debug(`[ChatScraper] #${index} Link extraction: href="${href}" -> chatId="${chatId}"`);
        } else {
          extractionMethod = 'container';
          // Container-based chat item (Gemini, Grok) - element is a container
          chatId = config.extractChatId(element);
          console.debug(`[ChatScraper] #${index} Container extraction: chatId="${chatId}"`);

          if (!chatId) {
            console.debug(`[ChatScraper] #${index} Failed to extract ID from container`);
            // console.debug(element.outerHTML.substring(0, 200)); // Careful with PII
            return;
          }

          // Dynamic Discovery: Search the document for ANY link containing this ID
          // This avoids hardcoding platform-specific URL structures
          const id = extractIdFromElement(element);
          if (id) {
            const foundLink = document.querySelector(`a[href*="${id}"]`);
            if (foundLink) {
              url = foundLink.href;
            } else if (window.location.hostname.includes('figma.com')) {
              // Minimal fallback for Figma cards where links are only active on click
              url = `${window.location.origin}/design/${id}`;
            } else if (window.location.hostname.includes('gemini.google.com')) {
              url = `${window.location.origin}/app/${id}`;
            }
          }

          if (!url) {
            // Fallback to constructing URL if not found dynamically
            const prefix = config.urlPrefix || '/app/';
            url = `${window.location.origin}${prefix}${chatId}`;
            console.log(`[ChatScraper] Chat ${index}: Constructed url="${url}"`);
          }
        }

        if (!chatId) {
          console.debug(`[ChatScraper] #${index} Skipped: No chatId found (method: ${extractionMethod})`);
          return;
        }

        if (seenIds.has(chatId)) {
          // console.debug(`[ChatScraper] #${index} Skipped: Duplicate chatId "${chatId}"`);
          return;
        }

        seenIds.add(chatId);

        // Extract title
        const title = extractTitle(element, config);
        console.debug(`[ChatScraper] #${index} Extracted title: "${title}"`);

        // Skip generic titles
        if (title === 'New Chat' || title === 'Untitled' || title.length < 3) {
          console.debug(`[ChatScraper] #${index} Skipped: Generic title "${title}"`);
          return;
        }

        const chat = {
          url,
          chatId,
          title,
          platform: config.name,
          scrapedAt: currentScrapeTime - index,
        };

        allChats.push(chat);

        // For first scrape (lastScrapeTime === 0), mark all as new
        // Otherwise, we'll let the background check against existing DB entries
        if (lastScrapeTime === 0) {
          newChats.push(chat);
          console.log(`[ChatScraper] ✓ NEW: ${title.substring(0, 50)}... (${chatId})`);
        } else {
          // Send all chats to background, it will check against DB
          newChats.push(chat);
          console.log(`[ChatScraper] 📋 FOUND: ${title.substring(0, 50)}... (${chatId})`);
        }
      } catch (err) {
        console.warn(`[ChatScraper] Error processing chat element #${index}:`, err);
      }
    });

    console.log(`[ChatScraper] ✅ Analysis complete: Found ${allChats.length} valid chats, ${newChats.length} passed to background`);

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
  // Check settings
  try {
    const settings = await chrome.storage.local.get(['autoScrapeEnabled', 'platformSettings', 'domainSelectors']);

    // 1. Global Auto-Scrape Check
    if (settings.autoScrapeEnabled === false) {
      console.log('[ChatScraper] Auto-scraping is disabled globally');
      return;
    }

    const hostname = window.location.hostname.replace('www.', '');

    // 2. Domain-Specific (DB-Synced) Check
    // This is the preferred method as it comes from the unified DB
    if (settings.domainSelectors && settings.domainSelectors[hostname]) {
      if (settings.domainSelectors[hostname].enabled === false) {
        console.log(`[ChatScraper] Scraping is disabled for this domain (via DB): ${hostname}`);
        return;
      }
    }

    // 3. Platform Name Check (Legacy/Fallback)
    const config = PLATFORM_CONFIGS[hostname];
    if (config && settings.platformSettings) {
      const platformName = config.name;
      if (settings.platformSettings[platformName] === false) {
        console.log(`[ChatScraper] Scraping is disabled for platform: ${platformName}`);
        return;
      }
    }
  } catch (e) {
    console.debug('[ChatScraper] Could not check settings, defaulting to enabled', e);
  }

  // Clear any pending auto-scrape
  if (autoScrapeTimeout) {
    clearTimeout(autoScrapeTimeout);
  }

  // Debounce: wait 5 seconds after page settles to ensure background is ready
  autoScrapeTimeout = setTimeout(async () => {
    console.log('[ChatScraper] Auto-scraping new chats...');

    const result = await scrapeNewChats();

    if (result.success && result.newChatsCount > 0) {
      // Send new chats to background for storage
      try {
        console.log(`[ChatScraper] 📤 Sending ${result.newChatsCount} chats to background...`);
        const response = await sendMessageWithRetry({
          type: 'AUTO_SCRAPED_CHATS',
          data: result
        });

        if (response !== null) {
          console.log(`[ChatScraper] ✅ Auto-scraped ${result.newChatsCount} new chats`);
        } else {
          console.warn('[ChatScraper] ⚠️ Failed to send chats to background (no response)');
        }
      } catch (error) {
        console.error('[ChatScraper] ❌ Failed to send auto-scraped chats:', error);
      }
    } else if (result.success) {
      console.log('[ChatScraper] ℹ️ No new chats found');
    }
  }, 5000); // Wait 5 seconds to ensure background is ready
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
    // Prevent running in iframes or service worker helpers
    if (window.self !== window.top || window.location.pathname.includes('sw_iframe')) {
      return;
    }
    console.log('[ChatScraper] Content script loaded and ready');
    try {
      autoScrape();
    } catch (e) {
      console.warn('[ChatScraper] Auto-scrape failed:', e);
    }
  });
} else {
  // Prevent running in iframes or service worker helpers
  if (window.self !== window.top || window.location.pathname.includes('sw_iframe')) {
    // console.debug('[ChatScraper] Skipping execution in iframe/sw_iframe'); 
  } else {
    console.log('[ChatScraper] Content script loaded and ready');
    try {
      autoScrape();
    } catch (e) {
      console.warn('[ChatScraper] Auto-scrape failed:', e);
    }
  }
}

// Also auto-scrape when URL changes (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
  if (window.self !== window.top) return;

  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[ChatScraper] URL changed, triggering auto-scrape');
    autoScrape();
  }
}).observe(document, { subtree: true, childList: true });

/**
 * ============================================
 * GENERIC LINK SCRAPING (for non-AI platforms)
 * ============================================
 */

/**
 * Helper to extract an ID from an element (for dynamic URL discovery)
 */
function extractIdFromElement(el) {
  // Try platform specific ID targets
  if (window.location.hostname.includes('figma.com')) {
    const img = el.querySelector('img[src*="/thumbnails/"]');
    if (img) {
      const match = img.src.match(/\/thumbnails\/([a-f0-9-]+)/);
      if (match) return match[1];
    }
  }

  // Try common ID attributes
  const idAttr = el.id || el.getAttribute('data-id') || el.getAttribute('data-chat-id');
  if (idAttr) return idAttr;

  return null;
}

/**
 * Check if current site has a specific config or needs generic scraping
 */
function hasSpecificConfig() {
  const hostname = window.location.hostname.replace('www.', '');
  return PLATFORM_CONFIGS.hasOwnProperty(hostname);
}

/**
 * Scrape links using generic auto-detection
 * Used for sites like GitHub, Vercel, Cloud Run, etc.
 */
async function scrapeLinksGeneric(options = {}) {
  // Check if GenericLinkScraper is loaded
  if (window.GenericLinkScraper?.scrapeLinksGeneric) {
    return await window.GenericLinkScraper.scrapeLinksGeneric(options);
  }

  // Fallback: inline implementation for when generic scraper isn't loaded
  const {
    minScore = 10,
    maxLinks = 100,
    waitTime = 2000,
  } = options;

  const hostname = window.location.hostname.replace('www.', '');
  console.log(`[ChatScraper] Generic scraping for ${hostname}...`);

  // Wait for page to load
  await new Promise(resolve => setTimeout(resolve, waitTime));

  // Simple heuristic: find links in nav/sidebar areas
  const navSelectors = [
    'nav a[href]',
    'aside a[href]',
    '[role="navigation"] a[href]',
    '.sidebar a[href]',
    '[class*="sidebar"] a[href]',
    '[class*="nav"] a[href]:not(header a):not(footer a)',
  ];

  const links = [];
  const seenUrls = new Set();

  for (const selector of navSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const href = el.getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript:')) continue;

      const fullUrl = href.startsWith('http') ? href : `${window.location.origin}${href}`;

      // Skip external links
      try {
        if (new URL(fullUrl).hostname !== window.location.hostname) continue;
      } catch {
        continue;
      }

      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);

      const title = el.getAttribute('title') ||
        el.getAttribute('aria-label') ||
        el.querySelector('.truncate')?.textContent?.trim() ||
        el.textContent?.trim();

      if (title && title.length > 2 && title.length < 150) {
        links.push({
          url: fullUrl,
          linkId: extractGenericId(fullUrl),
          title: title.substring(0, 100),
          platform: detectPlatformName(hostname),
          scrapedAt: Date.now(),
        });
      }

      if (links.length >= maxLinks) break;
    }
    if (links.length >= maxLinks) break;
  }

  console.log(`[ChatScraper] Generic scrape found ${links.length} links`);

  return {
    success: true,
    platform: detectPlatformName(hostname),
    hostname,
    links,
    isGeneric: true,
    scrapedAt: Date.now(),
  };
}

/**
 * Extract an ID from URL
 */
function extractGenericId(url) {
  try {
    const pathname = new URL(url).pathname;

    // UUID pattern
    const uuid = pathname.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuid) return uuid[1];

    // Hex hash pattern
    const hex = pathname.match(/\/([a-f0-9]{7,40})(?:\/|$)/i);
    if (hex) return hex[1];

    // Numeric ID
    const num = pathname.match(/\/(\d+)(?:\/|$)/);
    if (num) return num[1];

    // Last path segment
    const segments = pathname.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : pathname;
  } catch {
    return url;
  }
}

/**
 * Detect platform name from hostname
 */
function detectPlatformName(hostname) {
  const platforms = {
    'github.com': 'GitHub',
    'gitlab.com': 'GitLab',
    'bitbucket.org': 'Bitbucket',
    'vercel.com': 'Vercel',
    'netlify.com': 'Netlify',
    'render.com': 'Render',
    'railway.app': 'Railway',
    'heroku.com': 'Heroku',
    'console.cloud.google.com': 'Google Cloud',
    'console.firebase.google.com': 'Firebase',
    'console.aws.amazon.com': 'AWS',
    'portal.azure.com': 'Azure',
    'supabase.com': 'Supabase',
    'notion.so': 'Notion',
    'linear.app': 'Linear',
    'figma.com': 'Figma',
    'trello.com': 'Trello',
    'jira.atlassian.com': 'Jira',
  };

  for (const [domain, name] of Object.entries(platforms)) {
    if (hostname.includes(domain.split('.')[0])) {
      return name;
    }
  }

  // Capitalize first letter of hostname
  const name = hostname.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Unified scrape function - uses specific config or generic fallback
 */
async function scrapeAny() {
  if (hasSpecificConfig()) {
    return await scrapeChats();
  } else {
    return await scrapeLinksGeneric();
  }
}

/**
 * Listen for generic scrape requests
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_LINKS_GENERIC') {
    console.log('[ChatScraper] Received generic scrape request');

    scrapeLinksGeneric(message.options || {})
      .then(result => {
        console.log('[ChatScraper] Generic scrape complete:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[ChatScraper] Generic scrape failed:', error);
        sendResponse({
          success: false,
          error: error.message,
        });
      });

    return true;
  }

  if (message.type === 'SCRAPE_ANY') {
    console.log('[ChatScraper] Received unified scrape request');

    scrapeAny()
      .then(result => {
        console.log('[ChatScraper] Unified scrape complete:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[ChatScraper] Unified scrape failed:', error);
        sendResponse({
          success: false,
          error: error.message,
        });
      });

    return true;
  }
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLATFORM_CONFIGS,
    scrapeChats,
    scrapeNewChats,
    scrapeLinksGeneric,
    scrapeAny,
    hasSpecificConfig,
    detectPlatformName,
  };
}
