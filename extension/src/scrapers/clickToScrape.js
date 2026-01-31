/**
 * Click-to-Scrape - User clicks on a link, we scrape all similar links
 *
 * How it works:
 * 1. User activates "select mode"
 * 2. User clicks on ONE link in the sidebar/list they want to scrape
 * 3. We generate a CSS selector that matches that link and its siblings
 * 4. We save that selector for this domain
 * 5. Future scrapes use that selector automatically
 */

// State
let isSelectMode = false;
let highlightedElement = null;
let overlay = null;
let tooltip = null;

/**
 * Get the hostname for storage key
 */
function getHostKey() {
  return window.location.hostname.replace(/^www\./, '');
}

/**
 * Generate a CSS selector for an element that will match similar siblings
 * Focus on finding the repeating pattern (list items, links in nav, etc.)
 */
function generateSelector(element) {
  // Strategy: Find the parent container and the pattern of links within it

  // If clicked element is a link, use it directly
  // If not, find the closest link
  let link = element.tagName === 'A' ? element : element.closest('a');

  // Platform specific fallback: Figma uses buttons/divs for file cards
  if (!link && window.location.hostname.includes('figma.com')) {
    link = element.closest('[role="listitem"], [class*="card-primitive__root"]');
  }

  if (!link) {
    return null;
  }

  // Find the list container (ul, ol, nav, or div with multiple similar children)
  const container = findListContainer(link);
  if (!container) {
    // Fallback: just use the link's tag and class
    return buildSimpleSelector(link);
  }

  // Build selector: container > pattern to link
  const containerSelector = buildContainerSelector(container);
  const linkPattern = buildLinkPattern(link, container);

  return {
    container: containerSelector,
    links: linkPattern,
    full: `${containerSelector} ${linkPattern}`,
    sample: {
      title: extractTitle(link),
      url: link.href,
    }
  };
}

/**
 * Find the parent container that holds a list of similar items
 */
function findListContainer(link) {
  let current = link.parentElement;
  let bestContainer = null;
  let bestScore = 0;

  while (current && current !== document.body) {
    // Count how many links are direct or near-direct children
    const links = current.querySelectorAll('a[href]');
    const linkCount = links.length;

    // Good container has multiple links
    if (linkCount >= 3) {
      // Score based on link density and structure
      const score = linkCount;

      // Bonus for semantic containers
      if (current.tagName === 'NAV' ||
        current.tagName === 'UL' ||
        current.tagName === 'OL' ||
        current.getAttribute('role') === 'navigation' ||
        current.getAttribute('role') === 'menu') {
        if (score > bestScore) {
          bestScore = score;
          bestContainer = current;
        }
      } else if (score > bestScore * 1.5) {
        // Non-semantic container needs significantly more links
        bestScore = score;
        bestContainer = current;
      }
    }

    current = current.parentElement;
  }

  return bestContainer;
}

/**
 * Build a selector for the container element
 */
function buildContainerSelector(container) {
  const parts = [];

  // Use ID if available (most specific)
  if (container.id) {
    return `#${CSS.escape(container.id)}`;
  }

  // Use tag name
  parts.push(container.tagName.toLowerCase());

  // Add role if present
  const role = container.getAttribute('role');
  if (role) {
    parts.push(`[role="${role}"]`);
    return parts.join('');
  }

  // Add meaningful classes (skip utility classes)
  const meaningfulClasses = getMeaningfulClasses(container);
  if (meaningfulClasses.length > 0) {
    parts.push(`.${meaningfulClasses.map(c => CSS.escape(c)).join('.')}`);
  }

  // Add aria-label if present
  const ariaLabel = container.getAttribute('aria-label');
  if (ariaLabel) {
    parts.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
  }

  return parts.join('');
}

/**
 * Build a pattern to match links within the container
 */
function buildLinkPattern(link, container) {
  // Check if links are in list items
  const listItem = link.closest('li');
  if (listItem && container.contains(listItem)) {
    return 'li a[href]';
  }

  // Check for common wrapper patterns
  const wrapper = link.parentElement;
  if (wrapper && wrapper !== container) {
    const wrapperTag = wrapper.tagName.toLowerCase();
    if (wrapperTag === 'div' || wrapperTag === 'span') {
      const wrapperClasses = getMeaningfulClasses(wrapper);
      if (wrapperClasses.length > 0) {
        return `${wrapperTag}.${wrapperClasses[0]} a[href]`;
      }
    }
  }

  // Check if link has distinctive classes
  const linkClasses = getMeaningfulClasses(link);
  if (linkClasses.length > 0) {
    return `a.${linkClasses[0]}[href]`;
  }

  // Fallback: any link with href
  return 'a[href]';
}

/**
 * Build a simple selector for a single link (fallback)
 */
function buildSimpleSelector(link) {
  const parts = ['a'];

  // Add classes
  const classes = getMeaningfulClasses(link);
  if (classes.length > 0) {
    parts.push(`.${classes.slice(0, 2).map(c => CSS.escape(c)).join('.')}`);
  }

  // Must have href
  parts.push('[href]');

  return {
    container: null,
    links: parts.join(''),
    full: parts.join(''),
    sample: {
      title: extractTitle(link),
      url: link.href,
    }
  };
}

/**
 * Get meaningful class names (filter out utility classes)
 */
function getMeaningfulClasses(element) {
  const classList = Array.from(element.classList || []);

  // Skip common utility/styling classes
  const skipPatterns = [
    /^(p|m|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr)-/, // Tailwind spacing
    /^(w|h|min|max)-/, // Tailwind sizing
    /^(flex|grid|block|inline|hidden)/, // Tailwind display
    /^(text|font|bg|border|rounded|shadow)/, // Tailwind styling
    /^(hover|focus|active|disabled):/, // Tailwind states
    /^(sm|md|lg|xl|2xl):/, // Tailwind breakpoints
    /^(dark|light):/, // Tailwind themes
    /^_/, // Private/generated classes
    /^css-/, // CSS-in-JS
    /^sc-/, // Styled-components
    /^emotion-/, // Emotion
    /^[a-z]{1,2}$/, // Single/double letter classes (often generated)
  ];

  return classList.filter(cls => {
    if (cls.length < 2) return false;
    return !skipPatterns.some(pattern => pattern.test(cls));
  });
}

/**
 * Extract title from a link element
 */
function extractTitle(link) {
  // Priority order for title extraction
  const strategies = [
    () => link.getAttribute('title'),
    () => link.getAttribute('aria-label'),
    () => link.querySelector('[title]')?.getAttribute('title'),
    () => link.querySelector('.truncate, [class*="truncate"]')?.textContent?.trim(),
    () => link.querySelector('span, p')?.textContent?.trim(),
    () => {
      // Get text but exclude icon text
      const clone = link.cloneNode(true);
      clone.querySelectorAll('svg, img, [class*="icon"]').forEach(el => el.remove());
      const text = clone.textContent?.trim();
      return text && text.length > 0 && text.length < 200 ? text : null;
    },
  ];

  for (const strategy of strategies) {
    try {
      const title = strategy();
      if (title && title.trim().length > 0) {
        return title.trim().replace(/\s+/g, ' ');
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Create the overlay UI for select mode
 */
function createOverlay() {
  // Main overlay (blocks clicks outside)
  overlay = document.createElement('div');
  overlay.id = 'click-to-scrape-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2147483646;
    pointer-events: none;
  `;

  // Tooltip showing what will be selected
  tooltip = document.createElement('div');
  tooltip.id = 'click-to-scrape-tooltip';
  tooltip.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  `;
  tooltip.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-right: 8px; padding-right: 8px; border-right: 1px solid rgba(255,255,255,0.2);">
      <label style="font-size: 12px; opacity: 0.8;">Limit:</label>
      <input type="number" id="click-to-scrape-limit" value="20" min="1" style="
        width: 50px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        color: white;
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 12px;
      " />
    </div>
    <div id="click-to-scrape-status">
      <span>🎯 Click on any link you want to scrape</span>
    </div>
    <button id="click-to-scrape-cancel" style="
      background: #ff4757;
      border: none;
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-left: auto;
    ">Cancel (Esc)</button>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);

  // Cancel button handler
  document.getElementById('click-to-scrape-cancel').addEventListener('click', exitSelectMode);
}

/**
 * Remove the overlay UI
 */
function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  if (tooltip) {
    tooltip.remove();
    tooltip = null;
  }
}

/**
 * Highlight an element on hover
 */
function highlightElement(element) {
  // Remove previous highlight
  unhighlightElement();

  if (!element) return;

  // Find the link
  const link = element.tagName === 'A' ? element : element.closest('a');
  if (!link) return;

  highlightedElement = link;

  // Add highlight style
  link.style.outline = '3px solid #00d9ff';
  link.style.outlineOffset = '2px';
  link.style.backgroundColor = 'rgba(0, 217, 255, 0.1)';

  // Update tooltip with preview
  const title = extractTitle(link) || 'No title';
  const linkCount = estimateSimilarLinks(link);

  const statusEl = document.getElementById('click-to-scrape-status');
  if (statusEl) {
    statusEl.innerHTML = `
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 4px;">🎯 "${title.substring(0, 40)}${title.length > 40 ? '...' : ''}"</div>
          <div style="font-size: 12px; opacity: 0.8;">~${linkCount} similar links will be scraped</div>
        </div>
      `;
  }
}

/**
 * Remove highlight from element
 */
function unhighlightElement() {
  if (highlightedElement) {
    highlightedElement.style.outline = '';
    highlightedElement.style.outlineOffset = '';
    highlightedElement.style.backgroundColor = '';
    highlightedElement = null;
  }
}

/**
 * Estimate how many similar links will be matched
 */
function estimateSimilarLinks(link) {
  const selector = generateSelector(link);
  if (!selector) return 1;

  try {
    return document.querySelectorAll(selector.full).length;
  } catch {
    return 1;
  }
}

/**
 * Handle mouse move in select mode
 */
function handleMouseMove(e) {
  if (!isSelectMode) return;

  const element = document.elementFromPoint(e.clientX, e.clientY);
  if (element && element !== overlay && element !== tooltip && !tooltip?.contains(element)) {
    highlightElement(element);
  }
}

/**
 * Handle click in select mode
 */
function handleClick(e) {
  if (!isSelectMode) return;

  // Ignore clicks on our UI
  if (e.target === overlay || tooltip?.contains(e.target)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const element = document.elementFromPoint(e.clientX, e.clientY);
  const link = element?.tagName === 'A' ? element : element?.closest('a');

  if (!link) {
    showToast('Please click on a link', 'error');
    return;
  }

  // Generate and save selector
  const selectorInfo = generateSelector(link);
  if (!selectorInfo) {
    showToast('Could not generate selector for this link', 'error');
    return;
  }

  // Save selector for this domain
  saveSelectorForDomain(selectorInfo);

  // Exit select mode
  exitSelectMode();

  // Get limit from input
  const limitInput = document.getElementById('click-to-scrape-limit');
  const limit = limitInput ? parseInt(limitInput.value, 10) : 0;

  // Scrape using the new selector
  const results = scrapeWithSelector(selectorInfo.full, limit);

  showToast(`Found ${results.length} links!`, 'success');

  // Send results to background
  notifyBackground(results, selectorInfo);
}

/**
 * Handle keydown in select mode
 */
function handleKeyDown(e) {
  if (!isSelectMode) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    exitSelectMode();
  }
}

/**
 * Enter select mode - user can click to select links
 */
function enterSelectMode() {
  if (isSelectMode) return;

  isSelectMode = true;
  createOverlay();

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);

  console.log('[ClickToScrape] Select mode activated');
}

/**
 * Exit select mode
 */
function exitSelectMode() {
  if (!isSelectMode) return;

  isSelectMode = false;
  unhighlightElement();
  removeOverlay();

  // Remove event listeners
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);

  console.log('[ClickToScrape] Select mode deactivated');
}

/**
 * Save selector configuration for current domain
 */
async function saveSelectorForDomain(selectorInfo) {
  const hostKey = getHostKey();

  try {
    const result = await chrome.storage.local.get('domainSelectors');
    const selectors = result.domainSelectors || {};

    selectors[hostKey] = {
      selector: selectorInfo.full,
      container: selectorInfo.container,
      links: selectorInfo.links,
      sample: selectorInfo.sample,
      savedAt: Date.now(),
    };

    await chrome.storage.local.set({ domainSelectors: selectors });
    console.log(`[ClickToScrape] Saved selector for ${hostKey}:`, selectorInfo.full);
  } catch (error) {
    console.error('[ClickToScrape] Failed to save selector:', error);
  }
}

/**
 * Get saved selector for current domain
 */
async function getSelectorForDomain() {
  const hostKey = getHostKey();

  try {
    const result = await chrome.storage.local.get('domainSelectors');
    const selectors = result.domainSelectors || {};
    return selectors[hostKey] || null;
  } catch {
    return null;
  }
}

/**
 * Delete saved selector for current domain
 */
async function deleteSelectorForDomain() {
  const hostKey = getHostKey();

  try {
    const result = await chrome.storage.local.get('domainSelectors');
    const selectors = result.domainSelectors || {};
    delete selectors[hostKey];
    await chrome.storage.local.set({ domainSelectors: selectors });
    console.log(`[ClickToScrape] Deleted selector for ${hostKey}`);
  } catch (error) {
    console.error('[ClickToScrape] Failed to delete selector:', error);
  }
}

/**
 * Scrape links using a CSS selector
 */
function scrapeWithSelector(selector, limit = 0) {
  const links = [];
  const seenUrls = new Set();

  try {
    const elements = document.querySelectorAll(selector);
    console.log(`[ClickToScrape] Found ${elements.length} elements with selector: ${selector}`);

    let elementList = Array.from(elements);

    // Apply limit if specified (take latest/last items as they are usually new)
    if (limit > 0 && elementList.length > limit) {
      console.log(`[ClickToScrape] Limiting to last ${limit} items (from ${elementList.length})`);
      elementList = elementList.slice(-limit);
    } // turbo

    for (const el of elementList) {
      // Get the link element or platform-specific equivalent
      let link = el.tagName === 'A' ? el : el.querySelector('a[href]');
      let url = null;
      let title = null;

      if (link) {
        url = link.href;
      } else {
        // Dynamic Discovery: Search the document for ANY link containing this ID
        // This avoids hardcoding platform-specific URL structures
        const id = extractIdFromElement(el);
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
      }

      if (!url || seenUrls.has(url)) continue;

      // Skip non-http links
      if (!url.startsWith('http')) continue;

      seenUrls.add(url);

      title = extractTitle(link || el);
      if (!title) continue;

      links.push({
        url,
        title,
        linkId: extractIdFromUrl(url),
        platform: detectPlatform(),
        scrapedAt: Date.now(),
      });
    }
  } catch (error) {
    console.error('[ClickToScrape] Selector error:', error);
  }

  return links;
}

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
 * Extract an ID from URL
 */
function extractIdFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);

    // Look for UUID
    for (const seg of segments) {
      if (seg.length === 36 && seg.split('-').length === 5) {
        return seg;
      }
    }

    // Look for numeric ID
    for (const seg of segments) {
      if (/^\d+$/.test(seg) && seg.length < 20) {
        return seg;
      }
    }

    // Use last segment
    return segments[segments.length - 1] || pathname;
  } catch {
    return url;
  }
}

/**
 * Detect platform name
 */
function detectPlatform() {
  const hostname = getHostKey();
  const platforms = {
    'github.com': 'GitHub',
    'gitlab.com': 'GitLab',
    'vercel.com': 'Vercel',
    'netlify.com': 'Netlify',
    'console.cloud.google.com': 'Google Cloud',
    'console.firebase.google.com': 'Firebase',
    'notion.so': 'Notion',
    'linear.app': 'Linear',
    'figma.com': 'Figma',
  };

  for (const [domain, name] of Object.entries(platforms)) {
    if (hostname.includes(domain.split('.')[0])) {
      return name;
    }
  }

  return hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'error' ? '#ff4757' : type === 'success' ? '#2ed573' : '#1a1a2e'};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    animation: slideUp 0.3s ease;
  `;
  toast.textContent = message;

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { transform: translateX(-50%) translateY(20px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    style.remove();
  }, 3000);
}

/**
 * Notify background script of scraped results
 */
async function notifyBackground(links, selectorInfo) {
  try {
    await chrome.runtime.sendMessage({
      type: 'CLICK_SCRAPED_LINKS',
      data: {
        success: true,
        platform: detectPlatform(),
        hostname: getHostKey(),
        links,
        selector: selectorInfo,
        scrapedAt: Date.now(),
      }
    });
  } catch (error) {
    console.error('[ClickToScrape] Failed to notify background:', error);
  }
}

/**
 * Auto-scrape if we have a saved selector for this domain
 */
async function autoScrape() {
  // Check if auto-scraping is enabled in settings
  try {
    const settings = await chrome.storage.local.get(['autoScrapeEnabled']);
    if (settings.autoScrapeEnabled === false) {
      console.log('[ClickToScrape] Auto-scraping is disabled in settings');
      return null;
    }
  } catch (e) {
    console.debug('[ClickToScrape] Could not check autoScrapeEnabled setting, defaulting to enabled');
  }

  const saved = await getSelectorForDomain();
  if (!saved) {
    console.log('[ClickToScrape] No saved selector for this domain');
    return null;
  }

  console.log(`[ClickToScrape] Auto-scraping with saved selector: ${saved.selector}`);

  // Wait for page to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  const links = scrapeWithSelector(saved.selector);

  if (links.length > 0) {
    console.log(`[ClickToScrape] Auto-scraped ${links.length} links`);
    notifyBackground(links, saved);
  }

  return links;
}

/**
 * Listen for messages from background/popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ENTER_SELECT_MODE') {
    enterSelectMode();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'EXIT_SELECT_MODE') {
    exitSelectMode();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SCRAPE_WITH_SAVED_SELECTOR') {
    getSelectorForDomain().then(saved => {
      if (!saved) {
        sendResponse({ success: false, error: 'No saved selector' });
        return;
      }

      const links = scrapeWithSelector(saved.selector);
      sendResponse({
        success: true,
        links,
        selector: saved,
        platform: detectPlatform(),
        hostname: getHostKey(),
      });
    });
    return true;
  }

  if (message.type === 'GET_DOMAIN_SELECTOR') {
    getSelectorForDomain().then(saved => {
      sendResponse({ selector: saved });
    });
    return true;
  }

  if (message.type === 'DELETE_DOMAIN_SELECTOR') {
    deleteSelectorForDomain().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Auto-scrape on page load if selector exists
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.self === window.top) {
      setTimeout(autoScrape, 3000);
    }
  });
} else {
  if (window.self === window.top) {
    setTimeout(autoScrape, 3000);
  }
}

// Export for global access
window.ClickToScrape = {
  enterSelectMode,
  exitSelectMode,
  getSelectorForDomain,
  deleteSelectorForDomain,
  scrapeWithSelector,
  autoScrape,
};

console.log('[ClickToScrape] Content script loaded');
