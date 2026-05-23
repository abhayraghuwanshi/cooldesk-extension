const SIDECAR_URL = 'http://localhost:4545';
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30_000;

let _cache = null;
let _cacheTs = 0;

// AbortSignal.timeout / AbortSignal.any are Chrome 103/116+ — WebView2 may be older
function makeTimeoutSignal(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
  ctrl.signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  return ctrl.signal;
}

function combineSignals(signals) {
  const ctrl = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) { ctrl.abort(sig.reason); return ctrl.signal; }
    sig.addEventListener('abort', () => ctrl.abort(sig.reason), { once: true });
  }
  return ctrl.signal;
}

export async function fetchGraph(forceRefresh = false, signal = null) {
  const now = Date.now();
  if (!forceRefresh && _cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  const timeoutSignal = makeTimeoutSignal(FETCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? combineSignals([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const res = await fetch(`${SIDECAR_URL}/graph`, { signal: combinedSignal });
    if (!res.ok) { console.warn('[graphService] /graph responded', res.status); return null; }
    _cache = await res.json();
    _cacheTs = now;
    return _cache;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('[graphService] fetchGraph failed:', err?.message ?? err);
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
