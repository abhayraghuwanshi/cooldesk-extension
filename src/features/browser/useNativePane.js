import { useCallback, useEffect, useRef, useState } from 'react';

// Binds one native child webview (src-tauri/src/browser_pane) to a DOM slot.
//
// The page is a separate layer *above* this document, so it can't be clipped
// or covered by HTML — anything that draws over the slot (modals, the header
// spotlight's dropdown, a face sliding away, a tile being dragged) has to hide
// it instead. Rather than every overlay opting in, the sync loop asks the DOM
// directly: if the slot isn't the topmost element at a grid of points across
// it, something is on top, so the webview hides until it's clear again. That
// also covers face transitions for free — `.workspace-faces.transitioning` is
// `pointer-events: none`, and elementFromPoint skips such elements.
//
// Several panes can be live at once (the Browse canvas); each is keyed by
// `paneId`, which is also its webview label on the Rust side.

const SYNC_MS = 120;
// A requested page (sidebar click, typed address) stays hidden behind the
// loading screen until it finishes loading — or this long at most, so a slow
// site's stray ad request can't keep it covered.
const REVEAL_MAX_MS = 6000;
const PROBES = [0.08, 0.5, 0.92];

// Closing is deferred one tick so an immediate remount (StrictMode's dev
// double-mount, HMR) reuses the live webview instead of destroying and
// rebuilding it — each rebuild is a full page reload.
const pendingClose = new Map(); // paneId -> timeout id
const lastRequest = new Map();  // paneId -> "url#requestKey" last sent to Rust

// Auto-fit: below this pane width, zoom the page out (down to FIT_MIN) so
// sites keep their desktop layout instead of collapsing into a cramped one.
const FIT_WIDTH = 1180;
const FIT_MIN = 0.6;
export const AUTO_FIT_KEY = 'cooldesk.browse.autoFit';

function fitZoom(width) {
  if (width >= FIT_WIDTH) return 1;
  return Math.max(FIT_MIN, Math.round((width / FIT_WIDTH) * 20) / 20);
}

// Ad blocking (native WebKit content blocker, src-tauri/src/browser_pane/adblock.rs)
// is on everywhere except hosts the user allowed from a shield.
const ADBLOCK_ALLOW_KEY = 'cooldesk.browse.adblockAllow';

function loadAllowed() {
  try { return new Set(JSON.parse(localStorage.getItem(ADBLOCK_ALLOW_KEY) || '[]')); } catch { return new Set(); }
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

/** Typed address → URL: keeps http(s), assumes https for bare hosts, else searches. */
export function normalizeAddress(input) {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)) return `http://${text}`;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

function slotIsUnobstructed(slot, rect) {
  for (const fx of PROBES) {
    for (const fy of PROBES) {
      const el = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
      if (!el || !slot.contains(el)) return false;
    }
  }
  return true;
}

// A native page can't be clipped by a scrolling container, so when the slot
// sticks out of it the page is sized to the part that's on screen instead
// (it reflows to that size), and hidden once too little of it is left.
const MIN_VISIBLE = 120;

function visiblePart(rect, clip) {
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.right, clip.right);
  const bottom = Math.min(rect.bottom, clip.bottom);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * @param paneId     webview id (unique per live pane)
 * @param url        requested page; changing it — or bumping requestKey — navigates
 * @param active     false hides the page (face off-screen, tile being dragged…)
 * @param clipRef    optional element the slot must sit fully inside to be shown
 *                   (a scrolling canvas: a native layer can't be clipped by it)
 * @param autoFit    zoom out to keep desktop layouts in narrow slots
 * @param onUrl      called with each in-page navigation's URL
 */
export function useNativePane({ paneId, url, requestKey = 0, active, clipRef = null, autoFit = true, onUrl }) {
  const slotRef = useRef(null);
  const openedRef = useRef(false);
  const lastBoundsRef = useRef('');
  const reasonRef = useRef(undefined); // last hide reason (dev diagnostics)
  const zoomSentRef = useRef(null);
  const [pageUrl, setPageUrl] = useState(url || '');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [shown, setShown] = useState(false);
  // Loading gate for requested navigations (not in-page clicks).
  const [revealing, setRevealing] = useState(false);
  const gateRef = useRef(null); // { started: bool, timer } while gated
  const [adblockSupported, setAdblockSupported] = useState(false);
  const [allowed, setAllowed] = useState(loadAllowed);
  const allowedRef = useRef(allowed);
  useEffect(() => { allowedRef.current = allowed; }, [allowed]);

  const onUrlRef = useRef(onUrl);
  useEffect(() => { onUrlRef.current = onUrl; }, [onUrl]);

  useEffect(() => {
    invoke('browser_pane_adblock_supported').then(setAdblockSupported).catch(() => { });
  }, []);

  const measure = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return null;
    const full = slot.getBoundingClientRect();
    const clip = clipRef?.current?.getBoundingClientRect();
    const r = clip ? visiblePart(full, clip) : full;
    // Each reason the page stays hidden, checked in order (dev builds log the
    // first failing one when visibility changes).
    const reason = !active ? 'inactive'
      : gateRef.current ? 'loading'
        : (r.width < 1 || r.height < 1) ? 'zero-size'
          : document.hidden ? 'document-hidden'
            : (clip && (r.width < MIN_VISIBLE || r.height < MIN_VISIBLE)) ? 'outside-clip'
              : !slotIsUnobstructed(slot, r) ? 'covered'
                : null;
    if (import.meta.env.DEV && reason !== reasonRef.current) {
      console.debug(`[BrowserPane] ${paneId} ${reason ? `hidden: ${reason}` : 'shown'}`,
        { slot: [r.left, r.top, r.width, r.height].map(Math.round), clip: clip && [clip.left, clip.top, clip.width, clip.height].map(Math.round) });
      reasonRef.current = reason;
    }
    return { x: r.left, y: r.top, width: r.width, height: r.height, visible: !reason, reason };
  }, [active, clipRef, paneId]);

  const sync = useCallback(() => {
    if (!openedRef.current) return;
    const b = measure();
    if (!b) return;
    const nextZoom = autoFit ? fitZoom(b.width) : 1;
    if (b.width >= 1 && nextZoom !== zoomSentRef.current) {
      zoomSentRef.current = nextZoom;
      setZoom(nextZoom);
      invoke('browser_pane_set_zoom', { id: paneId, zoom: nextZoom }).catch(() => { });
    }
    const key = b.visible ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}` : 'hidden';
    if (key === lastBoundsRef.current) return;
    lastBoundsRef.current = key;
    setShown(b.visible);
    const { reason, ...bounds } = b;
    invoke('browser_pane_set_bounds', { id: paneId, ...bounds, reason }).catch(() => { });
  }, [measure, paneId, autoFit]);

  const endGate = useCallback(() => {
    if (!gateRef.current) return;
    clearTimeout(gateRef.current.timer);
    gateRef.current = null;
    setRevealing(false);
    lastBoundsRef.current = '';
  }, []);
  useEffect(() => () => clearTimeout(gateRef.current?.timer), []);

  // Requested URL → open or navigate the native webview over the slot.
  useEffect(() => {
    if (!url) return;
    setPageUrl(url);
    setError(null);
    const b = measure();
    if (!b) return;
    // Same request as the live webview already has (remount): don't reload it.
    const requestId = `${url}#${requestKey}`;
    if (lastRequest.get(paneId) === requestId) {
      openedRef.current = true;
      lastBoundsRef.current = '';
      sync();
      return;
    }
    lastRequest.set(paneId, requestId);
    clearTimeout(gateRef.current?.timer);
    gateRef.current = { started: false, timer: setTimeout(endGate, REVEAL_MAX_MS) };
    setRevealing(true);
    lastBoundsRef.current = '';
    let cancelled = false;
    invoke('browser_pane_open', {
      id: paneId, url, x: b.x, y: b.y, width: b.width, height: b.height,
      adblock: !allowedRef.current.has(hostOf(url)),
    })
      .then(() => {
        if (cancelled) return;
        openedRef.current = true;
        lastBoundsRef.current = '';
        zoomSentRef.current = null; // a fresh webview starts at 100%
        sync();
      })
      .catch(err => {
        lastRequest.delete(paneId);
        endGate();
        console.warn('[BrowserPane] open failed:', err);
        if (!cancelled) setError(String(err));
      });
    return () => { cancelled = true; };
    // Only a new request should (re)open; bounds are the sync loop's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, requestKey, paneId]);

  // Keep the webview pinned: poll for overlays, follow resizes and scrolls
  // (of any ancestor — scroll doesn't bubble, so listen in capture) on the
  // next frame rather than waiting for the poll.
  useEffect(() => {
    let frame = 0;
    const syncSoon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    // A window resize can move the page inside the window (title bar shown or
    // hidden by the dock) without changing its CSS rect, so always re-place.
    const onWindowResize = () => { lastBoundsRef.current = ''; syncSoon(); };
    sync();
    const timer = setInterval(sync, SYNC_MS);
    const ro = new ResizeObserver(syncSoon);
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('scroll', syncSoon, { capture: true, passive: true });
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('scroll', syncSoon, { capture: true });
      document.removeEventListener('visibilitychange', sync);
    };
  }, [sync]);

  // In-page navigation / title updates from the Rust side.
  useEffect(() => {
    let unlisten = null;
    let cancelled = false;
    import('@tauri-apps/api/event').then(({ listen }) => listen('browser-pane-state', ({ payload }) => {
      if (payload?.id !== paneId) return;
      if (payload.url) {
        setPageUrl(payload.url);
        onUrlRef.current?.(payload.url);
      }
      if (payload.title != null) setTitle(payload.title);
      if (payload.loading != null) {
        setLoading(payload.loading);
        // Lift the loading gate once the requested page has started and
        // then finished (a Finished from the previous page doesn't count).
        const gate = gateRef.current;
        if (gate && payload.loading) gate.started = true;
        else if (gate?.started && !payload.loading) endGate();
      }
    })).then(fn => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  }, [paneId, endGate]);

  // The native webview outlives React state; close it with the component.
  useEffect(() => {
    clearTimeout(pendingClose.get(paneId));
    pendingClose.delete(paneId);
    return () => {
      openedRef.current = false;
      pendingClose.set(paneId, setTimeout(() => {
        pendingClose.delete(paneId);
        lastRequest.delete(paneId);
        invoke('browser_pane_close', { id: paneId }).catch(() => { });
      }, 0));
    };
  }, [paneId]);

  // In-page navigation onto a host with a different setting: switch blocking
  // so it applies from that site's next load.
  const currentHost = hostOf(pageUrl);
  const blocking = !allowed.has(currentHost);
  useEffect(() => {
    if (!openedRef.current || !currentHost) return;
    invoke('browser_pane_set_adblock', { id: paneId, enabled: blocking }).catch(() => { });
  }, [currentHost, blocking, paneId]);

  const toggleAdblock = useCallback(() => {
    if (!currentHost) return;
    const next = new Set(allowedRef.current);
    if (next.has(currentHost)) next.delete(currentHost); else next.add(currentHost);
    try { localStorage.setItem(ADBLOCK_ALLOW_KEY, JSON.stringify([...next])); } catch { /* keep in memory */ }
    allowedRef.current = next;
    setAllowed(next);
    invoke('browser_pane_set_adblock', { id: paneId, enabled: !next.has(currentHost) })
      .then(() => invoke('browser_pane_nav', { id: paneId, action: 'reload' }))
      .catch(() => { });
  }, [currentHost, paneId]);

  const nav = useCallback((action) => {
    if (openedRef.current) invoke('browser_pane_nav', { id: paneId, action }).catch(() => { });
  }, [paneId]);

  return {
    slotRef, pageUrl, title, loading, error, zoom, shown, revealing,
    adblockSupported, blocking, currentHost, toggleAdblock, nav,
  };
}
