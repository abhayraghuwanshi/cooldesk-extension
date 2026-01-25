export const getDomainFromUrl = (url) => {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
};

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
  // Fallback: last two labels
  const labels = String(host).split('.');
  return labels.length >= 2 ? labels.slice(-2).join('.') : host;
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

export const getFaviconUrl = (url, size = 32, favIconUrl = null) => {
  try {
    // 1️⃣ Chrome cached favicon (best quality, works offline)
    if (favIconUrl && favIconUrl.startsWith('http')) {
      return favIconUrl;
    }

    const u = new URL(url);
    // Only resolve favicons for http/https pages
    if (!['http:', 'https:'].includes(u.protocol)) return null;

    const hostname = u.hostname.replace('www.', '');
    const s = Math.max(16, Math.min(256, Number(size) || 32));

    // 2️⃣ Custom high-quality favicons for known AI platforms and services
    const customFavicons = {
      'chat.openai.com': 'https://cdn.oaistatic.com/_next/static/media/apple-touch-icon.59f2e898.png',
      'chatgpt.com': 'https://cdn.oaistatic.com/_next/static/media/apple-touch-icon.59f2e898.png',
      'claude.ai': 'https://claude.ai/images/claude_app_icon.png',
      'gemini.google.com': 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
      'perplexity.ai': 'https://www.google.com/s2/favicons?domain=perplexity.ai&sz=128',
      'x.com': 'https://abs.twimg.com/favicons/twitter.3.ico',
      'twitter.com': 'https://abs.twimg.com/favicons/twitter.3.ico',
      'web.whatsapp.com': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/WhatsApp.svg/120px-WhatsApp.svg.png',
      'mail.google.com': 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
      // Google Services
      'google.com': 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png',
      'search.google.com': 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png',
      'analytics.google.com': 'https://www.gstatic.com/analytics-suite/header/suite/v2/ic_analytics.svg',
      'calendar.google.com': 'https://ssl.gstatic.com/calendar/images/favicons/calendar_2020q4_32dp.png',
      'drive.google.com': 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
      'docs.google.com': 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
      'sheets.google.com': 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico',
      'slides.google.com': 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico',
      'keep.google.com': 'https://www.gstatic.com/images/branding/product/1x/keep_2020q4_32dp.png',
      'meet.google.com': 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v6/web-32dp/logo_meet_2020q4_color_1x_web_32dp.png',
      'photos.google.com': 'https://www.gstatic.com/images/branding/product/1x/photos_32dp.png',
      'maps.google.com': 'https://www.google.com/images/branding/product/ico/maps15_bnuw3a_32dp.ico',
      'youtube.com': 'https://www.youtube.com/s/desktop/f506bd45/img/favicon_32x32.png',
      'studio.youtube.com': 'https://www.gstatic.com/youtube/img/creator/favicon/favicon_32.png',
    };

    if (customFavicons[hostname]) {
      return customFavicons[hostname];
    }

    // 3️⃣ Try multiple sources in order of quality
    // We'll use Google's S2 service which aggregates from multiple sources
    // and provides high-quality favicons with proper fallbacks
    const googleS2 = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`;

    // For better quality, we prefer Google S2 with higher resolution
    // It automatically tries: apple-touch-icon, favicon.ico, and other sources
    return googleS2;
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