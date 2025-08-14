export const getDomainFromUrl = (url) => {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
};

export const getUrlParts = (url) => {
  try {
    const u = new URL(url)
    const key = `${u.protocol}//${u.hostname}`
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
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=${size}` } catch { return null }
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
