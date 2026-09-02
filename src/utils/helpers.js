// Prefer robust public suffix parsing for base domain (psl)
// Works if bundled with `psl` or if `window.psl` is injected. Falls back gracefully otherwise.
let pslLib = null;
try {
  // Avoid require() in service worker context where it's not available
  if (typeof importScripts === 'undefined') {
    // eslint-disable-next-line global-require
    pslLib = require('psl');
  }
} catch (_) {
  pslLib = null;
}

const getBaseDomain = (host) => {
  if (!host) return '';
  try {
    // Check for window in a way that works in both browser and non-browser environments
    let maybePsl = pslLib || null;

    // Only check window if we're in a browser context (not service worker)
    if (typeof window !== 'undefined' && typeof window.psl !== 'undefined') {
      maybePsl = window.psl;
    }

    if (maybePsl && typeof maybePsl.parse === 'function') {
      const res = maybePsl.parse(host);
      if (res && res.domain) return res.domain; // eTLD+1
    }
  } catch (e) {
    console.warn('PSL parsing failed:', e);
  }
  // Fallback: handle common second-level domains like .co.uk, .com.au
  const labels = String(host).split('.');
  if (labels.length >= 3) {
    const secondLevel = labels[labels.length - 2];
    const commonSLDs = ['co', 'com', 'org', 'net', 'gov', 'edu'];
    if (commonSLDs.includes(secondLevel)) {
      return labels.slice(-3).join('.');
    }
  }
  return labels.length >= 2 ? labels.slice(-2).join('.') : host;
};

export const getDomainFromUrl = (url) => {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
};

/**
 * Safely get hostname from a URL, handling URLs without protocol
 * @param {string} url - URL string (with or without protocol)
 * @returns {string} hostname or the original string if parsing fails
 */
export const safeGetHostname = (url) => {
  if (!url || typeof url !== 'string') return 'unknown';
  try {
    // If URL doesn't have a protocol, add https://
    const urlWithProtocol = url.startsWith('http://') || url.startsWith('https://')
      ? url
      : `https://${url}`;
    return new URL(urlWithProtocol).hostname;
  } catch {
    // If still fails, try to extract domain-like part
    const match = url.match(/^(?:https?:\/\/)?([^\/\s]+)/i);
    return match ? match[1] : url;
  }
};

export const getBaseDomainFromUrl = (url) => {
  if (!url) return 'Unknown';
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'Local Files';
    if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'about:') return 'System';

    // Handle IP addresses and localhost
    const hostname = u.hostname;
    if (!hostname) return 'Local';

    const base = getBaseDomain(hostname);
    return base || hostname || 'Other';
  } catch {
    // Try safe extraction
    const hostname = safeGetHostname(url);
    if (hostname && hostname !== 'unknown') {
      return getBaseDomain(hostname) || hostname;
    }
    return 'Other';
  }
};

/**
 * Grouping key for tab sections. Like getBaseDomainFromUrl, but keeps the
 * subdomain.
 *
 * eTLD+1 is the right answer for "what site is this" (ranking, dedupe, URL
 * qualification) and the wrong one for "should these tabs sit together":
 * analytics.google.com and chromewebstore.google.com are both google.com, so
 * grouping by base domain filed unrelated products under one heading. Large
 * hosts put genuinely separate products on separate subdomains, so for grouping
 * the subdomain is the signal, not noise.
 *
 * www./m. are dropped so the apex and its canonical alias stay one group. The
 * tradeoff is that per-locale subdomains (en./de.wikipedia.org) now split —
 * accepted, since sites that shard by subdomain usually shard by product too.
 * Returns the same sentinels as getBaseDomainFromUrl so SKIP_GROUP_DOMAINS and
 * the rest of the grouping code keep working unchanged.
 */
export const getGroupDomainFromUrl = (url) => {
  if (!url) return 'Unknown';
  const fromHostname = (hostname) => {
    if (!hostname) return 'Local';
    return hostname.replace(/^(www|m)\./i, '') || hostname;
  };
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'Local Files';
    if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'about:') return 'System';
    return fromHostname(u.hostname);
  } catch {
    const hostname = safeGetHostname(url);
    if (hostname && hostname !== 'unknown') return fromHostname(hostname);
    return 'Other';
  }
};

export const getUrlParts = (url) => {
  try {
    const u = new URL(url)
    const host = u.hostname || ''
    const baseDomain = getBaseDomain(host)
    const key = `${u.protocol}//${baseDomain}`
    const remainder = `${u.pathname || ''}${u.search || ''}${u.hash || ''}`
    const hasFullPath = (u.pathname && u.pathname !== '/') || !!u.search || !!u.hash
    const pathSegments = (u.pathname || '').split('/').filter(Boolean)
    const queryEntries = []
    if (u.searchParams && [...u.searchParams.keys()].length) {
      u.searchParams.forEach((v, k) => queryEntries.push({ k, v }))
    }
    const hashRaw = (u.hash || '').replace(/^#/, '')
    const hashSegments = hashRaw ? hashRaw.split('/').filter(Boolean) : []
    return { key, remainder, hasFullPath, pathSegments, queryEntries, hashSegments }
  } catch {
    return { key: url, remainder: '', hasFullPath: false, pathSegments: [], queryEntries: [], hashSegments: [] }
  }
}

/**
 * Site key for grouping activity by destination: scheme + eTLD+1
 * (e.g. `https://github.com`), falling back to the bare hostname, then null.
 *
 * Distinct from `getDomainFromUrl` here, which returns a display-friendly
 * hostname — this one is a grouping key and must stay stable, since stored
 * activity records are keyed on it.
 */
export const cleanUrl = (url) => {
  try {
    const parts = getUrlParts(url)
    return parts?.key || new URL(url).hostname
  } catch {
    try { return new URL(url).hostname } catch { return null }
  }
}

export const getFaviconUrl = (url, _size = 32, favIconUrl = null, useBaseDomain = false) => {
  try {
    // 1️⃣ Chrome cached favicon (best quality, works offline)
    if (favIconUrl && favIconUrl.startsWith('http')) {
      return favIconUrl;
    }

    const u = new URL(url);
    // Only resolve favicons for http/https pages
    if (!['http:', 'https:'].includes(u.protocol)) return null;

    // 2️⃣ Use base domain for more consistent favicon matching
    // e.g., mail.google.com -> google.com favicon
    const domain = useBaseDomain ? getBaseDomain(u.hostname) : u.hostname;

    // 3️⃣ Use DuckDuckGo - simpler and often more reliable for varied domains
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  } catch {
    return null;
  }
};

// Simple hash function for generating colors from hostnames
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

export const formatTime = (ms) => {
  if (!ms || ms < 60000) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
};


/**
 * Enriches running apps with icons and friendly names from installed apps
 * @param {Array} runningApps - Array of running app objects from getRunningApps()
 * @param {Array} installedApps - Array of installed app objects from getInstalledApps()
 * @returns {Array} - Running apps enriched with icons and display names
 */
export const enrichRunningAppsWithIcons = (runningApps, installedApps) => {
  if (!Array.isArray(runningApps)) return [];
  if (!Array.isArray(installedApps) || installedApps.length === 0) return runningApps;

  return runningApps.map(app => {
    let icon = app.icon;
    let displayName = app.name;
    const runningName = (app.name || '').toLowerCase().replace('.exe', '');
    const runningPath = (app.path || '').toLowerCase();

    if (!icon) {
      // Try to find matching installed app for icon and friendly name
      const installed = installedApps.find(ia => {
        const installedName = (ia.name || '').toLowerCase();
        const installedPath = (ia.path || '').toLowerCase();

        // Best match: same exe path
        if (runningPath && installedPath && runningPath === installedPath) return true;

        // Match by exe filename
        const runningExe = runningPath.split(/[/\\]/).pop()?.replace('.exe', '');
        const installedExe = installedPath.split(/[/\\]/).pop()?.replace('.exe', '');
        if (runningExe && installedExe && runningExe === installedExe) return true;

        // Exact name match
        if (installedName === runningName) return true;

        // Running app name contains installed name or vice versa
        if (runningName.length > 2 && installedName.length > 2) {
          if (runningName.includes(installedName) || installedName.includes(runningName)) return true;
        }

        return false;
      });

      if (installed) {
        if (installed.icon) icon = installed.icon;
        // Use friendly name from installed apps (e.g., "Google Chrome" instead of "chrome.exe")
        if (installed.name) displayName = installed.name;
      }
    }

    return { ...app, icon, name: displayName };
  });
};

// Simple Circuit Breaker for Gemini calls (module-local)
export const createCircuitBreaker = ({ failureThreshold = 3, cooldownMs = 60_000, halfOpenMaxRequests = 1 } = {}) => {
  let state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
  let failures = 0;
  let nextTryAt = 0;
  let halfOpenInFlight = 0;

  const canRequest = () => {
    const now = Date.now();
    if (state === 'OPEN') {
      if (now >= nextTryAt) {
        state = 'HALF_OPEN';
        failures = 0;
        halfOpenInFlight = 0;
        return true;
      }
      return false;
    }
    if (state === 'HALF_OPEN') {
      return halfOpenInFlight < halfOpenMaxRequests;
    }
    return true;
  };

  const onSuccess = () => {
    failures = 0;
    if (state !== 'CLOSED') state = 'CLOSED';
  };

  const onFailure = () => {
    failures += 1;
    if (state === 'HALF_OPEN' || failures >= failureThreshold) {
      state = 'OPEN';
      nextTryAt = Date.now() + cooldownMs;
    }
  };

  const exec = async (fn) => {
    if (!canRequest()) {
      const err = new Error('CircuitBreaker: OPEN');
      err.code = 'CIRCUIT_OPEN';
      throw err;
    }
    if (state === 'HALF_OPEN') halfOpenInFlight += 1;
    try {
      const res = await fn();
      onSuccess();
      return res;
    } catch (e) {
      onFailure();
      throw e;
    } finally {
      if (state === 'HALF_OPEN') {
        halfOpenInFlight = Math.max(halfOpenInFlight - 1, 0);
      }
    }
  };

  return {
    exec,
    get state() { return state; },
    get failures() { return failures; },
    get nextTryAt() { return nextTryAt; },
  };
}

// Chromium re-fires `mouseenter` on whatever row ends up under a *stationary*
// cursor whenever the layout shifts beneath it (e.g. a results column
// narrowing, or a grid reflowing to a new column count). A real hover always
// carries coordinates that differ from the last recorded mouse position; a
// reflow-triggered one repeats the same coordinates because the pointer
// device never moved. `lastPos` is a mutable `{ x, y }` ref the caller owns
// (module-level or a useRef) so it can persist across remounts/reflows.
export function isRealPointerMove(lastPos, e) {
  const moved = e.clientX !== lastPos.x || e.clientY !== lastPos.y;
  lastPos.x = e.clientX;
  lastPos.y = e.clientY;
  return moved;
}

// Detect localhost / local dev server URLs (localhost, loopback, private LAN
// IPs, *.local mDNS). Shared by TabManagement's "Local Dev" section and
// ActivityFeed's "Local" section so a dev server (any port) groups the same
// way in both places instead of scattering into per-host domain groups.
export function isLocalhostUrl(url) {
  if (!url) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (h.endsWith('.local')) return true; // mDNS / Bonjour
  if (h.startsWith('127.')) return true; // loopback range
  // Private LAN ranges (RFC 1918): 10.x, 192.168.x, 172.16–31.x
  if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

// "localhost:3000" style label — the port is the only thing that tells two
// local dev servers apart, since the hostname is almost always "localhost".
export function getLocalUrlLabel(url) {
  try {
    const u = new URL(url);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `${u.hostname}:${port}`;
  } catch {
    return url;
  }
}