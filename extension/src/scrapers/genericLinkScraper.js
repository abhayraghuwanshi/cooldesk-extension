/**
 * Generic Link Scraper - URL Pattern Detection & Clustering
 *
 * Instead of exclusion lists, this scraper:
 * 1. Extracts URL templates (e.g., /users/{id} from /users/123, /users/456)
 * 2. Clusters links by their URL pattern
 * 3. Scores patterns based on content likelihood
 * 4. Returns grouped results for easy filtering
 *
 * Based on research from:
 * - Scrapinghub page_clustering algorithm
 * - WHATWG URL Pattern Standard
 * - Web usage mining pattern detection
 */

/**
 * ============================================
 * URL PATTERN DETECTION
 * ============================================
 */

/**
 * Detect the type of a URL segment
 */
function detectSegmentType(segment) {
  if (!segment) return { type: 'empty', pattern: '' };

  // UUID: 8-4-4-4-12 hex format
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(segment)) {
    return { type: 'uuid', pattern: '{uuid}' };
  }

  // Hex hash: 7-40 hex characters (git commits, short IDs)
  if (/^[a-f0-9]{7,40}$/i.test(segment)) {
    return { type: 'hash', pattern: '{hash}' };
  }

  // Numeric ID
  if (/^\d+$/.test(segment)) {
    return { type: 'numeric', pattern: '{id}' };
  }

  // Slug with ID suffix (e.g., "my-project-abc123")
  if (/^[a-z0-9-]+-[a-z0-9]{6,}$/i.test(segment)) {
    return { type: 'slug-id', pattern: '{slug}' };
  }

  // Base64-like (long alphanumeric, often IDs)
  if (/^[A-Za-z0-9_-]{20,}$/.test(segment)) {
    return { type: 'base64', pattern: '{token}' };
  }

  // Static segment
  return { type: 'static', pattern: segment };
}

/**
 * Convert a URL path to a pattern template
 * /users/123/posts/456 -> /users/{id}/posts/{id}
 */
function urlToPattern(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const patternSegments = segments.map(seg => detectSegmentType(seg).pattern);
  return '/' + patternSegments.join('/');
}

/**
 * Calculate pattern score - higher = more likely to be content
 */
function scorePattern(pattern, urls) {
  let score = 0;

  // Patterns with dynamic segments are likely content lists
  const dynamicCount = (pattern.match(/\{[^}]+\}/g) || []).length;
  score += dynamicCount * 20;

  // More URLs matching = more confidence it's a real pattern
  score += Math.min(urls.length * 5, 50);

  // Depth bonus - deeper paths often more specific
  const depth = pattern.split('/').filter(Boolean).length;
  score += depth * 5;

  // Penalize patterns that are too generic (just /{id})
  if (pattern === '/{id}' || pattern === '/{uuid}' || pattern === '/{hash}') {
    score -= 30;
  }

  // Penalize very shallow paths
  if (depth < 2) {
    score -= 20;
  }

  return score;
}

/**
 * ============================================
 * LINK EXTRACTION & CLUSTERING
 * ============================================
 */

/**
 * Known platforms with their display names
 */
const PLATFORMS = {
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
  'supabase.com': 'Supabase',
  'planetscale.com': 'PlanetScale',
  'neon.tech': 'Neon',
  'notion.so': 'Notion',
  'linear.app': 'Linear',
  'figma.com': 'Figma',
  'miro.com': 'Miro',
  'trello.com': 'Trello',
  'asana.com': 'Asana',
  'monday.com': 'Monday',
  'clickup.com': 'ClickUp',
};

/**
 * Detect platform name from hostname
 */
function detectPlatform(hostname) {
  const clean = hostname.replace(/^www\./, '');

  if (PLATFORMS[clean]) return PLATFORMS[clean];

  for (const [domain, name] of Object.entries(PLATFORMS)) {
    if (clean.includes(domain.split('.')[0])) return name;
  }

  // Capitalize hostname
  const name = clean.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Extract title from link element
 */
function extractTitle(linkEl) {
  // Priority order for title extraction
  const title =
    linkEl.getAttribute('title') ||
    linkEl.getAttribute('aria-label') ||
    linkEl.querySelector('[title]')?.getAttribute('title') ||
    linkEl.querySelector('.truncate, .text-truncate, [class*="truncate"]')?.textContent?.trim() ||
    linkEl.textContent?.trim();

  if (!title || title.length < 2 || title.length > 200) return null;

  // Clean whitespace
  return title.replace(/\s+/g, ' ').trim();
}

/**
 * Check if link is likely a navigation/action link (not content)
 */
function isNavigationLink(linkEl, pathname) {
  // Check if in header/footer
  if (linkEl.closest('header, footer, [role="banner"], [role="contentinfo"]')) {
    return true;
  }

  // Action keywords in path
  const actionKeywords = ['login', 'logout', 'signin', 'signup', 'settings', 'preferences',
    'account', 'profile', 'help', 'support', 'contact', 'about', 'privacy', 'terms'];
  const lowerPath = pathname.toLowerCase();
  if (actionKeywords.some(kw => lowerPath.includes(kw))) {
    return true;
  }

  return false;
}

/**
 * Check if URL is a preview/branch deployment (Vercel, Netlify, etc.)
 */
function isPreviewDeployment(href, hostname) {
  const lowerHref = href.toLowerCase();
  const lowerHost = hostname.toLowerCase();

  // Vercel preview patterns: project-git-branch-user.vercel.app
  // These contain -git- in the subdomain
  if (lowerHost.includes('.vercel.app') && lowerHost.includes('-git-')) {
    return true;
  }

  // Netlify deploy previews: deploy-preview-123--sitename.netlify.app
  if (lowerHost.includes('.netlify.app') && lowerHost.includes('deploy-preview')) {
    return true;
  }

  // Edit/branch URLs often contain these patterns
  if (lowerHref.includes('/edit/') || lowerHref.includes('/edt-') ||
      lowerHref.includes('-edit-') || lowerHref.includes('-edt-')) {
    return true;
  }

  return false;
}

/**
 * Check if this is an external link (different domain than current page)
 */
function isExternalLink(linkHostname, currentHostname) {
  // Normalize hostnames
  const linkHost = linkHostname.replace(/^www\./, '').toLowerCase();
  const currentHost = currentHostname.replace(/^www\./, '').toLowerCase();

  // Direct match
  if (linkHost === currentHost) return false;

  // Check if it's a subdomain of the current host
  // e.g., api.example.com is not external to example.com
  if (linkHost.endsWith('.' + currentHost)) return false;

  // On platform dashboards (vercel.com, netlify.com), links to deployed apps
  // (*.vercel.app, *.netlify.app) should be considered external since they're
  // just links to the deployed sites, not project management pages
  return true;
}

/**
 * Parse and validate URL
 */
function parseUrl(href, origin, currentHostname) {
  try {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      return null;
    }

    const url = new URL(href, origin);

    // Skip external links
    if (isExternalLink(url.hostname, currentHostname)) {
      return null;
    }

    // Skip preview/branch deployments
    if (isPreviewDeployment(url.href, url.hostname)) {
      return null;
    }

    return {
      href: url.href,
      pathname: url.pathname,
      hostname: url.hostname,
    };
  } catch {
    return null;
  }
}

/**
 * Main scraping function with pattern clustering
 */
async function scrapeLinksGeneric(options = {}) {
  const {
    maxLinks = 200,
    waitTime = 2000,
    minPatternScore = 10,
  } = options;

  const origin = window.location.origin;
  const hostname = window.location.hostname.replace(/^www\./, '');
  const platform = detectPlatform(hostname);

  console.log(`[GenericScraper] Scanning ${platform} (${hostname})...`);

  // Wait for dynamic content
  await new Promise(resolve => setTimeout(resolve, waitTime));

  // Collect all links
  const allLinks = document.querySelectorAll('a[href]');
  console.log(`[GenericScraper] Found ${allLinks.length} total links`);

  // Group links by pattern
  const patternGroups = new Map(); // pattern -> { urls: [], links: [] }
  const seenUrls = new Set();

  for (const linkEl of allLinks) {
    const href = linkEl.getAttribute('href');
    const parsed = parseUrl(href, origin, hostname);
    if (!parsed) continue;

    // Skip duplicates
    if (seenUrls.has(parsed.href)) continue;
    seenUrls.add(parsed.href);

    // Skip navigation links
    if (isNavigationLink(linkEl, parsed.pathname)) continue;

    // Extract title
    const title = extractTitle(linkEl);
    if (!title) continue;

    // Get pattern for this URL
    const pattern = urlToPattern(parsed.pathname);

    // Add to pattern group
    if (!patternGroups.has(pattern)) {
      patternGroups.set(pattern, { urls: [], links: [] });
    }

    const group = patternGroups.get(pattern);
    group.urls.push(parsed.href);
    group.links.push({
      url: parsed.href,
      pathname: parsed.pathname,
      title,
      pattern,
    });

    if (seenUrls.size >= maxLinks) break;
  }

  // Score and filter patterns
  const scoredPatterns = [];
  for (const [pattern, group] of patternGroups) {
    const score = scorePattern(pattern, group.urls);

    if (score >= minPatternScore) {
      scoredPatterns.push({
        pattern,
        score,
        count: group.links.length,
        links: group.links,
        // Generate a readable label
        label: generatePatternLabel(pattern),
      });
    }
  }

  // Sort by score (best patterns first)
  scoredPatterns.sort((a, b) => b.score - a.score);

  // Flatten links for backwards compatibility, but include pattern info
  const allFilteredLinks = [];
  for (const pg of scoredPatterns) {
    for (const link of pg.links) {
      allFilteredLinks.push({
        ...link,
        patternScore: pg.score,
        patternLabel: pg.label,
        platform,
        scrapedAt: Date.now(),
        linkId: extractLinkId(link.pathname),
      });
    }
  }

  console.log(`[GenericScraper] Found ${scoredPatterns.length} patterns, ${allFilteredLinks.length} links`);

  return {
    success: true,
    platform,
    hostname,
    // Pattern-grouped results (new)
    patterns: scoredPatterns,
    // Flat link list (backwards compatible)
    links: allFilteredLinks,
    totalFound: allLinks.length,
    filteredCount: allFilteredLinks.length,
    scrapedAt: Date.now(),
  };
}

/**
 * Generate human-readable label for a pattern
 */
function generatePatternLabel(pattern) {
  // Remove leading slash and replace patterns with readable names
  return pattern
    .replace(/^\//, '')
    .replace(/\{uuid\}/g, '*')
    .replace(/\{hash\}/g, '*')
    .replace(/\{id\}/g, '*')
    .replace(/\{slug\}/g, '*')
    .replace(/\{token\}/g, '*')
    || '/';
}

/**
 * Extract a unique ID from pathname
 */
function extractLinkId(pathname) {
  const segments = pathname.split('/').filter(Boolean);

  // Find first dynamic segment
  for (const seg of segments) {
    const type = detectSegmentType(seg);
    if (type.type !== 'static') {
      return seg;
    }
  }

  // Fallback to last segment
  return segments[segments.length - 1] || pathname;
}

/**
 * ============================================
 * ALLOWLIST MANAGEMENT
 * ============================================
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
  const clean = hostname.replace(/^www\./, '');

  return allowlist.some(pattern => {
    if (pattern === clean) return true;
    if (pattern.startsWith('*.') && clean.endsWith(pattern.slice(1))) return true;
    return false;
  });
}

async function addDomainToAllowlist(hostname) {
  try {
    const allowlist = await getAllowlist();
    const clean = hostname.replace(/^www\./, '');

    if (!allowlist.includes(clean)) {
      allowlist.push(clean);
      await chrome.storage.local.set({ genericScraperAllowlist: allowlist });
    }
    return true;
  } catch {
    return false;
  }
}

async function removeDomainFromAllowlist(hostname) {
  try {
    const allowlist = await getAllowlist();
    const clean = hostname.replace(/^www\./, '');
    const index = allowlist.indexOf(clean);

    if (index > -1) {
      allowlist.splice(index, 1);
      await chrome.storage.local.set({ genericScraperAllowlist: allowlist });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * ============================================
 * EXPORTS
 * ============================================
 */

// Configuration exposed for customization
const CONFIG = {
  PLATFORMS,
};

// Export for global access
window.GenericLinkScraper = {
  scrapeLinksGeneric,
  getAllowlist,
  isDomainAllowed,
  addDomainToAllowlist,
  removeDomainFromAllowlist,
  detectPlatform,
  urlToPattern,
  detectSegmentType,
  CONFIG,
};

// CommonJS export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.GenericLinkScraper;
}
