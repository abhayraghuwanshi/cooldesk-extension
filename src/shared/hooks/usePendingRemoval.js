import { useCallback, useMemo, useRef } from 'react';

/**
 * Tracks items removed from a list optimistically (a tab closed, an app
 * killed) whose backing action is fire-and-forget — the close/kill request
 * can resolve locally well before the OS/sync layer actually reflects it.
 * Without this, any externally-sourced list that lands in that gap (a poll,
 * a push event, a service subscription) would silently put the removed item
 * right back, which is exactly the "closes, then comes back" flicker this
 * exists to prevent.
 *
 * Call `tombstone(item)` the instant you optimistically remove something.
 * Then, for every externally-sourced list that could still contain it:
 *
 *   - If it's the same list you're about to setState with, just run it
 *     through `filter(list)` — prunes stale tombstones against it and
 *     returns the list with tombstoned items removed, in one step:
 *
 *       const { tombstone, filter } = usePendingRemoval(tab => `${tab.browser}-${tab.id}`);
 *       tombstone(closedTab);
 *       setTabs(prev => prev.filter(t => t.id !== closedTab.id)); // optimistic
 *       ...
 *       setTabs(filter(freshListFromSomewhereElse)); // every external refresh
 *
 *   - If the list you're filtering *into* isn't the same shape as the raw
 *     source list you want to prune against (e.g. pruning against a raw
 *     "running apps" list but testing membership on an already-enriched,
 *     differently-shaped list derived from it), use `prune(sourceList)`
 *     once against the raw source, then `has(item)` per item elsewhere:
 *
 *       closedApps.prune(rawRunningApps);
 *       const kept = enrichedApps.filter(a => !closedApps.has(a));
 *
 * Either way, a tombstone clears itself automatically once its key is no
 * longer present in whatever list it was last pruned against — nothing
 * needs to expire it manually.
 */
export function usePendingRemoval(keyFn) {
    const pendingRef = useRef(new Set());

    const tombstone = useCallback((item) => {
        pendingRef.current.add(keyFn(item));
    }, [keyFn]);

    const prune = useCallback((list) => {
        const pending = pendingRef.current;
        if (!pending.size) return;
        const presentKeys = new Set(list.map(keyFn));
        for (const k of [...pending]) if (!presentKeys.has(k)) pending.delete(k);
    }, [keyFn]);

    const has = useCallback((item) => pendingRef.current.has(keyFn(item)), [keyFn]);

    const filter = useCallback((list) => {
        prune(list);
        const pending = pendingRef.current;
        return pending.size ? list.filter(item => !pending.has(keyFn(item))) : list;
    }, [prune, keyFn]);

    // Memoized so consumers can safely put the returned object in their own
    // useCallback/useEffect deps without it churning every render.
    return useMemo(() => ({ tombstone, prune, has, filter }), [tombstone, prune, has, filter]);
}
