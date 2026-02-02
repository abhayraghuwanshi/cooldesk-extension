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

export const getBaseDomainFromUrl = (url) => {
  try {
    const hostname = new URL(url).hostname;
    return getBaseDomain(hostname);
  } catch {
    return 'unknown';
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

export const getFaviconUrl = (url, _size = 32, favIconUrl = null) => {
  try {
    // 1️⃣ Chrome cached favicon (best quality, works offline)
    if (favIconUrl && favIconUrl.startsWith('http')) {
      return favIconUrl;
    }

    const u = new URL(url);
    // Only resolve favicons for http/https pages
    if (!['http:', 'https:'].includes(u.protocol)) return null;

    // 2️⃣ Use DuckDuckGo - simpler and often more reliable for varied domains
    return `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
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