import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from './useNativePane';

// Keeps the in-app pages from taking the Mac down with them, the way Safari
// and Chrome's Memory Saver do: every page is its own WebKit process
// (100–300 MB, sometimes far more), and a hidden one keeps running.
//
// One poll of browser_pane_stats (src-tauri/src/browser_pane/stats.rs) feeds
// both the Page tab's meter and these rules. Background tabs are put to sleep
// (page closed, reloads when opened) when they:
//   - haven't been opened for IDLE_MS,
//   - keep burning CPU while hidden (WebKit already throttles hidden pages,
//     so that's a runaway script or a miner, not real work),
//   - crashed (nothing to keep), or
//   - are the least recently used while pages are over the memory budget or
//     the system is short on memory — one per poll, so the next sample shows
//     what that freed before another goes.
// A tab playing sound or using the camera / mic is never put to sleep.
// The page on screen is never closed; if it spins a core for HEAVY_MS the
// host is told (heavyPaneId) so it can offer to stop it.

const POLL_MS = 5000;
const METER_POLL_MS = 3000;       // the Page tab's meter is on screen
const BACKGROUND_POLL_MS = 15000; // Browse is off-screen: only idle / memory matter
const IDLE_MS = 30 * 60 * 1000;
const HOT_CPU = 50;               // % of one core, hidden page
const HOT_MS = 30 * 1000;
const HEAVY_CPU = 90;             // % of one core, page on screen
const HEAVY_MS = 20 * 1000;
const GB = 1024 ** 3;
// Pages together may use this share of RAM (within the bounds) before the
// oldest background ones go to sleep.
const BUDGET_SHARE = 0.3;
const BUDGET_MIN = 1.5 * GB;
const BUDGET_MAX = 8 * GB;
// Below this share of RAM free + reclaimable, the system is under pressure.
const LOW_AVAILABLE_SHARE = 0.08;

/** Bytes used by pages, counting a process shared by several panes once. */
export function pagesMemoryOf(panes) {
  const seen = new Set();
  return panes.reduce((n, p) => {
    if (p.pid == null || seen.has(p.pid)) return n;
    seen.add(p.pid);
    return n + (p.memory || 0);
  }, 0);
}

/**
 * @param browseTabs   useBrowseTabs() (tabs, live, activeId, sleep, idleFor)
 * @param paneIdOf     tab id → pane id
 * @param shownPaneId  pane on screen right now (the active tab's), or null
 * @param enabled      false when no page is open (nothing to watch)
 * @param meterShown   the Page tab's meter is visible (poll faster)
 * @param onScreen     the Browse face is on screen
 */
export function usePaneGuard({ browseTabs, paneIdOf, shownPaneId, enabled, meterShown, onScreen }) {
  const [stats, setStats] = useState(null);
  const [heavyPaneId, setHeavyPaneId] = useState(null);
  const hotSince = useRef(new Map());   // paneId -> ms, hidden and over HOT_CPU
  const heavySince = useRef(new Map()); // paneId -> ms, on screen and over HEAVY_CPU
  const dismissed = useRef(new Set());  // heavy notices closed until it calms down

  const inputs = useRef(null);
  inputs.current = { browseTabs, paneIdOf, shownPaneId };

  const decide = useCallback((next) => {
    const { browseTabs: bt, paneIdOf: paneOf, shownPaneId: shown } = inputs.current;
    const now = Date.now();
    const byPane = new Map(next.panes.map(p => [p.id, p]));

    const track = (map, id, over) => {
      if (over) { if (!map.has(id)) map.set(id, now); } else map.delete(id);
    };
    for (const p of next.panes) {
      const cpu = p.cpu || 0;
      track(hotSince.current, p.id, p.id !== shown && cpu >= HOT_CPU);
      track(heavySince.current, p.id, p.id === shown && cpu >= HEAVY_CPU);
      if (!heavySince.current.has(p.id)) dismissed.current.delete(p.id);
    }
    for (const map of [hotSince.current, heavySince.current]) {
      for (const id of map.keys()) if (!byPane.has(id)) map.delete(id);
    }

    const heavy = shown && now - (heavySince.current.get(shown) ?? now) >= HEAVY_MS && !dismissed.current.has(shown)
      ? shown : null;
    setHeavyPaneId(heavy);

    // Background tabs whose page is open and may be closed.
    const candidates = bt.tabs
      .filter(t => t.id !== bt.activeId && bt.live.has(t.id) && !t.file && !t.term && !t.note)
      .map(t => ({ tab: t, pane: byPane.get(paneOf(t.id)) }))
      .filter(({ pane }) => !pane?.audible && !pane?.capturing);

    const reasons = new Map(); // tab id -> why
    for (const { tab, pane } of candidates) {
      if (pane?.crashed) reasons.set(tab.id, 'crashed');
      else if (bt.idleFor(tab.id) >= IDLE_MS) reasons.set(tab.id, 'idle');
      else if (pane && now - (hotSince.current.get(pane.id) ?? now) >= HOT_MS) reasons.set(tab.id, `cpu ${Math.round(pane.cpu)}%`);
    }

    const total = next.total_memory || 0;
    const used = pagesMemoryOf(next.panes);
    const budget = Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, total * BUDGET_SHARE));
    const low = total > 0 && next.available_memory < total * LOW_AVAILABLE_SHARE;
    if (used > budget || low) {
      const oldest = candidates
        .filter(({ tab }) => !reasons.has(tab.id))
        .sort((a, b) => bt.idleFor(b.tab.id) - bt.idleFor(a.tab.id))[0];
      if (oldest) {
        reasons.set(oldest.tab.id, low
          ? `system memory low (${(next.available_memory / GB).toFixed(1)} GB free)`
          : `pages over budget (${(used / GB).toFixed(1)} / ${(budget / GB).toFixed(1)} GB)`);
      }
    }

    if (reasons.size) {
      for (const [id, why] of reasons) {
        const tab = bt.tabs.find(t => t.id === id);
        console.info(`[PaneGuard] sleeping ${tab?.url || id}: ${why}`);
      }
      bt.sleep([...reasons.keys()]);
    }
  }, []);

  const rate = meterShown ? METER_POLL_MS : onScreen ? POLL_MS : BACKGROUND_POLL_MS;
  useEffect(() => {
    if (!enabled && !meterShown) {
      setStats(null);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const next = await invoke('browser_pane_stats');
        if (cancelled) return;
        setStats(next);
        decide(next);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    load();
    const timer = setInterval(load, rate);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enabled, meterShown, rate, decide]);

  const dismissHeavy = useCallback(() => {
    if (!heavyPaneId) return;
    dismissed.current.add(heavyPaneId);
    setHeavyPaneId(null);
  }, [heavyPaneId]);

  return { stats, heavyPaneId, dismissHeavy };
}
