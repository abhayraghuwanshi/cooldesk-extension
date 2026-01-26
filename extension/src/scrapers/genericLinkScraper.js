/**
 * Generic Link Scraper - Auto-detects navigation links on any website
 * No CSS knowledge required - uses heuristics to find meaningful links
 *
 * Uses URL API instead of regex for cleaner, more maintainable code
 */

/**
 * Configuration for navigation detection - pure data, no regex
 */
const CONFIG = {
  // CSS selectors for finding navigation areas
  navSelectors: [
    'nav', 'aside',
    '[role="navigation"]', '[role="complementary"]', '[role="menu"]',
    '.sidebar', '#sidebar', '.sidenav', '.side-nav',
    '.menu', '.nav-menu', '.navigation',
    '.tree', '.tree-view',
    '.repo-list', '.project-list', '.workspace-list',
  ],

  // Keywords in class/id that indicate navigation
  navKeywords: ['sidebar', 'sidenav', 'menu', 'nav', 'tree', 'list', 'repo', 'project', 'workspace'],

  // URL path segments to exclude (non-content pages)
  excludePaths: [
    'login', 'signin', 'sign-in', 'signup', 'sign-up', 'register',
    'logout', 'signout', 'sign-out',
    'about', 'contact', 'privacy', 'terms', 'legal', 'tos',
    'help', 'support', 'faq', 'docs', 'documentation',
    'pricing', 'plans', 'subscribe', 'upgrade', 'billing',
    'settings', 'preferences', 'account', 'profile',
    'blog', 'news', 'press', 'careers', 'jobs',
    'enterprise', 'business', 'teams',
  ],

  // Known platforms with their display names
  platforms: {
    'github.com': 'GitHub',
    'gitlab.com': 'GitLab',
    'bitbucket.org': 'Bitbucket',
    'vercel.com': 'Vercel',
    'netlify.app': 'Netlify',
    'netlify.com': 'Netlify',
    'render.com': 'Render',
    'railway.app': 'Railway',
    'heroku.com': 'Heroku',
    'fly.io': 'Fly.io',
    'console.cloud.google.com': 'Google Cloud',
    'console.firebase.google.com': 'Firebase',
    'console.aws.amazon.com': 'AWS',
    'portal.azure.com': 'Azure',
    'supabase.com': 'Supabase',
    'planetscale.com': 'PlanetScale',
    'neon.tech': 'Neon',
    'notion.so': 'Notion',
    'linear.app': 'Linear',
    'figma.com': 'Figma',
    'miro.com': 'Miro',
    'slack.com': 'Slack',
    'discord.com': 'Discord',
    'trello.com': 'Trello',
    'asana.com': 'Asana',
    'monday.com': 'Monday',
    'clickup.com': 'ClickUp',
    'jira.atlassian.com': 'Jira',
    'confluence.atlassian.com': 'Confluence',
  },
};

/**
 * Parse URL using the built-in URL API (no regex needed)
 */
function parseUrl(href, baseOrigin) {
  try {
    // Handle relative URLs
    const url = new URL(href, baseOrigin);
    return {
      valid: true,
      href: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
      segments: url.pathname.split('/').filter(Boolean),
      isExternal: url.hostname !== new URL(baseOrigin).hostname,
      isAnchor: href.startsWith('#'),
      isJavascript: href.toLowerCase().startsWith('javascript:'),
      isMailto: href.toLowerCase().startsWith('mailto:'),
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Check if a URL path contains excluded segments
 */
function hasExcludedPath(segments) {
  const lowerSegments = segments.map(s => s.toLowerCase());
  return CONFIG.excludePaths.some(excluded =>
    lowerSegments.includes(excluded)
  );
}

/**
 * Extract a unique ID from URL path segments (no regex)
 */
function extractIdFromSegments(segments) {
  // Look for UUID-like segments (8-4-4-4-12 format)
  for (const segment of segments) {
    if (isUUID(segment)) {
      return segment;
    }
  }

  // Look for hex hash segments (7-40 chars, all hex)
  for (const segment of segments) {
    if (isHexHash(segment)) {
      return segment;
    }
  }

  // Look for numeric IDs
  for (const segment of segments) {
    if (isNumericId(segment)) {
      return segment;
    }
  }

  // Return last meaningful segment
  const meaningful = segments.filter(s => s.length > 1 && !CONFIG.excludePaths.includes(s.toLowerCase()));
  return meaningful.length > 0 ? meaningful[meaningful.length - 1] : null;
}

/**
 * Check if string is a UUID (without regex)
 */
function isUUID(str) {
  if (str.length !== 36) return false;
  const parts = str.split('-');
  if (parts.length !== 5) return false;
  if (parts[0].length !== 8 || parts[1].length !== 4 ||
      parts[2].length !== 4 || parts[3].length !== 4 ||
      parts[4].length !== 12) return false;
  return parts.every(part => isHexString(part));
}

/**
 * Check if string is a hex hash (7-40 hex chars)
 */
function isHexHash(str) {
  if (str.length < 7 || str.length > 40) return false;
  return isHexString(str);
}

/**
 * Check if string contains only hex characters
 */
function isHexString(str) {
  const hexChars = '0123456789abcdefABCDEF';
  for (const char of str) {
    if (!hexChars.includes(char)) return false;
  }
  return true;
}

/**
 * Check if string is a numeric ID
 */
function isNumericId(str) {
  if (str.length === 0 || str.length > 20) return false;
  for (const char of str) {
    if (char < '0' || char > '9') return false;
  }
  return true;
}

/**
 * Detect platform name from hostname
 */
function detectPlatform(hostname) {
  // Direct match
  if (CONFIG.platforms[hostname]) {
    return CONFIG.platforms[hostname];
  }

  // Check if hostname ends with a known platform domain
  for (const [domain, name] of Object.entries(CONFIG.platforms)) {
    if (hostname.endsWith(domain) || hostname.includes(domain.split('.')[0])) {
      return name;
    }
  }

  // Capitalize first part of hostname as fallback
  const name = hostname.replace(/^www\./, '').split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Check if element is inside a navigation area
 */
function isInNavArea(element) {
  // Check direct selector match
  const navSelector = CONFIG.navSelectors.join(', ');
  const navParent = element.closest(navSelector);
  if (navParent) return true;

  // Check if any parent has nav-related class/id
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const className = (parent.className || '').toLowerCase();
    const id = (parent.id || '').toLowerCase();

    for (const keyword of CONFIG.navKeywords) {
      if (className.includes(keyword) || id.includes(keyword)) {
        return true;
      }
    }
    parent = parent.parentElement;
  }

  return false;
}

/**
 * Check if element is in header/footer area
 */
function isInHeaderFooter(element) {
  return !!element.closest('header, footer, [role="banner"], [role="contentinfo"]');
}

/**
 * Extract title from link element using multiple strategies
 */
function extractTitle(linkEl) {
  const strategies = [
    () => linkEl.getAttribute('title'),
    () => linkEl.getAttribute('aria-label'),
    () => linkEl.querySelector('[title]')?.getAttribute('title'),
    () => linkEl.querySelector('.truncate')?.textContent?.trim(),
    () => linkEl.querySelector('span:not(.icon)')?.textContent?.trim(),
    () => {
      const text = linkEl.textContent?.trim();
      // Only use if reasonable length
      return (text && text.length > 1 && text.length < 150) ? text : null;
    },
  ];

  for (const strategy of strategies) {
    try {
      const title = strategy();
      if (title && title.trim().length > 1) {
        // Clean up whitespace
        return title.trim().replace(/\s+/g, ' ');
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Score a link element to determine usefulness
 */
function scoreLink(linkEl, parsedUrl) {
  let score = 0;

  // Invalid or special links
  if (!parsedUrl.valid || parsedUrl.isAnchor || parsedUrl.isJavascript || parsedUrl.isMailto) {
    return -100;
  }

  // External links (lower priority but not excluded)
  if (parsedUrl.isExternal) {
    score -= 50;
  }

  // In navigation area = strong signal
  if (isInNavArea(linkEl)) {
    score += 30;
  }

  // In header/footer = likely not content
  if (isInHeaderFooter(linkEl)) {
    score -= 40;
  }

  // Has excluded path segments
  if (hasExcludedPath(parsedUrl.segments)) {
    score -= 30;
  }

  // Has meaningful text
  const text = linkEl.textContent?.trim() || '';
  if (text.length > 2 && text.length < 100) {
    score += 20;
  }

  // In a list item = likely navigation
  if (linkEl.closest('li, [role="listitem"]')) {
    score += 10;
  }

  // Has truncate class = likely list item
  if (linkEl.querySelector('.truncate') || linkEl.classList.contains('truncate')) {
    score += 15;
  }

  // Has icon/avatar = often meaningful
  if (linkEl.querySelector('svg, img')) {
    score += 5;
  }

  // Has ID-like segment in URL = content link
  const hasId = parsedUrl.segments.some(s => isUUID(s) || isHexHash(s) || isNumericId(s));
  if (hasId) {
    score += 10;
  }

  return score;
}

/**
 * Main scraping function - finds meaningful links automatically
 */
async function scrapeLinksGeneric(options = {}) {
  const {
    minScore = 10,
    maxLinks = 100,
    waitTime = 2000,
  } = options;

  const hostname = window.location.hostname.replace(/^www\./, '');
  const origin = window.location.origin;
  const platform = detectPlatform(hostname);

  console.log(`[GenericScraper] Scanning ${platform} (${hostname})...`);

  // Wait for dynamic content
  await new Promise(resolve => setTimeout(resolve, waitTime));

  // Find all links
  const allLinks = document.querySelectorAll('a[href]');
  console.log(`[GenericScraper] Found ${allLinks.length} total links`);

  const results = [];
  const seenUrls = new Set();

  for (const linkEl of allLinks) {
    const href = linkEl.getAttribute('href');
    if (!href) continue;

    const parsed = parseUrl(href, origin);
    if (!parsed.valid) continue;

    // Skip duplicates
    if (seenUrls.has(parsed.href)) continue;
    seenUrls.add(parsed.href);

    // Score the link
    const score = scoreLink(linkEl, parsed);
    if (score < minScore) continue;

    // Extract title
    const title = extractTitle(linkEl);
    if (!title) continue;

    // Extract ID
    const linkId = extractIdFromSegments(parsed.segments) ||
                   parsed.segments.join('/') ||
                   btoa(parsed.href).substring(0, 16);

    results.push({
      url: parsed.href,
      linkId,
      title,
      platform,
      score,
      scrapedAt: Date.now(),
    });

    if (results.length >= maxLinks) break;
  }

  // Sort by score (highest first)
  results.sort((a, b) => b.score - a.score);

  console.log(`[GenericScraper] Found ${results.length} meaningful links`);

  return {
    success: true,
    platform,
    hostname,
    links: results,
    totalFound: allLinks.length,
    filteredCount: results.length,
    scrapedAt: Date.now(),
  };
}

/**
 * Allowlist management functions
 */
async function getAllowlist() {
  try {
    const result = await chrome.storage.local.get('genericScraperAllowlist');
    return result.genericScraperAllowlist || [];
  } catch {
    return [];
  }
}

async function isDomainAllowed(hostname) {
  const allowlist = await getAllowlist();
  const cleanHostname = hostname.replace(/^www\./, '');

  return allowlist.some(pattern => {
    // Exact match
    if (pattern === cleanHostname) return true;
    // Wildcard match (*.example.com)
    if (pattern.startsWith('*.')) {
      return cleanHostname.endsWith(pattern.slice(1));
    }
    return false;
  });
}

async function addDomainToAllowlist(hostname) {
  try {
    const allowlist = await getAllowlist();
    const cleanHostname = hostname.replace(/^www\./, '');

    if (!allowlist.includes(cleanHostname)) {
      allowlist.push(cleanHostname);
      await chrome.storage.local.set({ genericScraperAllowlist: allowlist });
      console.log(`[GenericScraper] Added ${cleanHostname} to allowlist`);
    }
    return true;
  } catch (error) {
    console.error('[GenericScraper] Failed to add domain:', error);
    return false;
  }
}

async function removeDomainFromAllowlist(hostname) {
  try {
    const allowlist = await getAllowlist();
    const cleanHostname = hostname.replace(/^www\./, '');
    const index = allowlist.indexOf(cleanHostname);

    if (index > -1) {
      allowlist.splice(index, 1);
      await chrome.storage.local.set({ genericScraperAllowlist: allowlist });
      console.log(`[GenericScraper] Removed ${cleanHostname} from allowlist`);
    }
    return true;
  } catch (error) {
    console.error('[GenericScraper] Failed to remove domain:', error);
    return false;
  }
}

// Export for global access
window.GenericLinkScraper = {
  scrapeLinksGeneric,
  getAllowlist,
  isDomainAllowed,
  addDomainToAllowlist,
  removeDomainFromAllowlist,
  detectPlatform,
  CONFIG,
};

// CommonJS export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.GenericLinkScraper;
}
