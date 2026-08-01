// Shared "already handled" gate for jump-to-tab.
//
// Three receivers run inside the same extension service worker and every one of
// them sees the same jump: the bridge's WS push, the bridge's HTTP poll of
// /cmd/jump-next, and the sync WebSocket client. Each one activates a tab and
// asks the desktop app for OS-level focus, so an undeduped jump makes the
// browser fight itself for the foreground. Keep the gate in one module so all
// three share a single record of what has already been handled.

const recentJumps = new Map(); // key → timestamp

/** Stable key for a jump — the pair that identifies the target tab. */
export function jumpKeyOf(tabId, url) {
  return `${tabId ?? ''}:${url || ''}`;
}

export function markJumpHandled(key) {
  recentJumps.set(key, Date.now());
  // Drop entries older than 10s so the map can't grow unbounded
  for (const [k, t] of recentJumps) {
    if (Date.now() - t > 10000) recentJumps.delete(k);
  }
}

// Deliberately short. This exists to collapse a double *delivery* of one
// broadcast, which arrives within a second — not to rate-limit the user. A tab
// activated twice is idempotent, so an escaped duplicate costs nothing, whereas
// a window long enough to swallow a deliberate second click reads as "clicking
// the tab does nothing".
const DUPLICATE_DELIVERY_MS = 1200;

export function wasJumpRecentlyHandled(key) {
  const t = recentJumps.get(key);
  return !!t && Date.now() - t < DUPLICATE_DELIVERY_MS;
}
