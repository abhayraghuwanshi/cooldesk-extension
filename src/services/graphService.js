const SIDECAR_URL = 'http://127.0.0.1:4545';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30_000;

let _cache = null;
let _cacheTs = 0;

export async function fetchGraph() {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  try {
    const res = await fetch(`${SIDECAR_URL}/graph`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    _cache = await res.json();
    _cacheTs = now;
    return _cache;
  } catch {
    return null;
  }
}

export function invalidateGraphCache() {
  _cache = null;
}
