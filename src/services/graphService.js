const SIDECAR_URL = 'http://127.0.0.1:4545';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30_000;

let _cache = null;
let _cacheTs = 0;

export async function fetchGraph(forceRefresh = false, signal = null) {
  const now = Date.now();
  if (!forceRefresh && _cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  // Combine caller's AbortSignal with the internal timeout signal
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const res = await fetch(`${SIDECAR_URL}/graph`, { signal: combinedSignal });
    if (!res.ok) return null;
    _cache = await res.json();
    _cacheTs = now;
    return _cache;
  } catch (err) {
    if (err.name === 'AbortError') throw err; // re-throw so caller can detect abort
    return null;
  }
}

export function invalidateGraphCache() {
  _cache = null;
}

/** Compare two graph snapshots — true if nodes or edges changed */
export function graphChanged(prev, next) {
  if (!prev || !next) return true;
  if (prev.nodes.length !== next.nodes.length) return true;
  if ((prev.edges || []).length !== (next.edges || []).length) return true;
  const prevIds = new Set(prev.nodes.map(n => n.id));
  return next.nodes.some(n => !prevIds.has(n.id));
}
