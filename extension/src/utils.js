export const getDomainFromUrl = (url) => {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
};

// Prefer robust public suffix parsing for base domain (psl)
// Works if bundled with `psl` or if `window.psl` is injected. Falls back gracefully otherwise.
let pslLib = null;
try {
  // eslint-disable-next-line global-require
  pslLib = require('psl');
} catch (_) {
  pslLib = null;
}

const getBaseDomain = (host) => {
  if (!host) return '';
  try {
    const maybePsl = (typeof window !== 'undefined' && window.psl) ? window.psl : pslLib;
    if (maybePsl && typeof maybePsl.parse === 'function') {
      const res = maybePsl.parse(host);
      if (res && res.domain) return res.domain; // eTLD+1
    }
  } catch {}
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

export const getFaviconUrl = (url, size = 32) => {
  // Use a highly cached provider to avoid repeated network requests during re-renders.
  // DuckDuckGo ip3 is lightweight and generally returns long-lived cache headers.
  try {
    const host = new URL(url).hostname;
    // Note: ip3 endpoint ignores size, but serves a reasonable favicon; keeping size for future flexibility.
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return null;
  }
};

export const formatTime = (ms) => {
  if (!ms || ms < 60000) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
};
