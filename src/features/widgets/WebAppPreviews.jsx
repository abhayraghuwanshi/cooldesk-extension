import { faArrowPointer, faChevronDown, faChevronRight, faCompress, faExpand, faGlobe, faPlus, faRotateRight, faUpRightFromSquare, faWindowRestore, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFaviconUrl } from '../../utils/helpers.js';
import './WebAppCanvas.css';

// Web app widgets on a freeform canvas: draggable, resizable tiles that are
// live views of web apps. Three rendering tiers per tile:
//   1. iframe preview   — sites that allow framing (checked via the sidecar)
//   2. static app face  — sites that refuse framing; tile is a launcher
//   3. glue-embed       — a real `--app` browser window pinned over the tile
//      (Windows/Tauri only; user's own profile → already signed in, and the
//      CoolDesk extension keeps instrumenting it)
// The canvas has its own isolated stylesheet (WebAppCanvas.css) and does not
// follow the rest of the app's layout conventions.

const STORAGE_KEY = 'webAppPreviews';
const COLLAPSED_KEY = 'webAppPreviewsCollapsed';

const GCAL_EMBED = 'https://calendar.google.com/calendar/embed?mode=AGENDA&showTitle=0&showNav=0&showPrint=0&showTabs=0&showCalendars=0&showTz=0';

const HEADER_H = 30;
const MIN_W = 220;
const MIN_H = 140;
const GRID = 8;
const CANVAS_MIN_H = 280;
const snap = (v) => Math.round(v / GRID) * GRID;

function defaultLayout(index) {
  return {
    x: 12 + (index % 3) * 352,
    y: 12 + Math.floor(index / 3) * 272,
    w: 340,
    h: 256,
  };
}

const DEFAULT_APPS = [
  {
    id: 'google-calendar',
    name: 'Calendar',
    embedUrl: GCAL_EMBED,
    openUrl: 'https://calendar.google.com',
    darkInvert: true, // the embed is white-only; invert it into the dark theme
    layout: defaultLayout(0),
  },
];

// Upgrade well-known URLs to their frameable embed variants.
function normalizeWebApp(rawUrl, index) {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === 'calendar.google.com') {
    return { id: `app-${Date.now()}`, name: 'Calendar', embedUrl: GCAL_EMBED, openUrl: 'https://calendar.google.com', darkInvert: true, layout: defaultLayout(index) };
  }
  const name = host.split('.')[0].replace(/^./, c => c.toUpperCase());
  return { id: `app-${Date.now()}`, name, embedUrl: url, openUrl: url, darkInvert: false, layout: defaultLayout(index) };
}

function storageGet(keys) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(keys, res => resolve(res || {}));
    } catch {
      resolve({});
    }
  });
}

function storageSet(obj) {
  try { chrome.storage.local.set(obj); } catch { /* no storage in this context */ }
}

// Ask the sidecar whether a URL allows framing (X-Frame-Options / CSP
// frame-ancestors, checked server-side without cookies). Returns:
//   true  → frameable, render the iframe preview
//   false → site refuses framing, render the static app face
//   null  → unknown (sidecar unreachable) — optimistically try the iframe
const frameCheckCache = new Map();

// Glue-embedding (Windows-only): the Rust side spawns the user's browser in
// --app mode and pins the real window over the tile. Which tiles are in
// embed mode survives remounts (face switches) so the loop resumes instead of
// orphaning a hidden window.
const IS_WINDOWS = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
const embeddedIds = new Set();

async function checkFrameable(url) {
  if (frameCheckCache.has(url)) return frameCheckCache.get(url);
  try {
    const res = await fetch(`http://localhost:4545/webapp/frame-check?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const result = data?.ok ? !!data.frameable : null;
    if (result !== null) frameCheckCache.set(url, result);
    return result;
  } catch {
    return null;
  }
}

// Fired whenever the canvas pans or toggles fullscreen so embed sync loops
// re-pin their glued windows immediately instead of on the next heartbeat.
const PAN_EVENT = 'webapps-canvas-pan';

// Shared cache of the Tauri window's position/state. Tile drags sync at
// 60fps; without this every tile fired three IPC round-trips per frame.
// The window itself rarely moves, so one refresh per ~300ms serves all
// tiles; tauri://move / resize listeners invalidate it eagerly.
let winStateCache = { t: 0, pos: null, minimized: false, visible: true };
function invalidateWinState() { winStateCache.t = 0; }
async function getWinState() {
  if (!winStateCache.pos || Date.now() - winStateCache.t > 300) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    const [pos, minimized, visible] = await Promise.all([
      w.innerPosition(), w.isMinimized(), w.isVisible(),
    ]);
    winStateCache = { t: Date.now(), pos, minimized, visible };
  }
  return winStateCache;
}

function PreviewCard({ app, isTauriApp, canvasRef, unbounded, onRemove, onLayoutChange }) {
  const [hovered, setHovered] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Interactive mode: lets clicks reach the framed page itself. Needed for
  // one-time prompts like Google's "Allow cookies" (Storage Access API
  // requires a user gesture *inside* the iframe) or signing in.
  const [interactive, setInteractive] = useState(false);
  // Framing policy of the target (true/false/null=unknown). When false the
  // iframe is doomed — show the static face and skip the request entirely.
  const [frameable, setFrameable] = useState(() => frameCheckCache.get(app.embedUrl) ?? null);
  // Glue-embed mode: a real --app browser window is pinned over the slot.
  const [embedded, setEmbedded] = useState(() => embeddedIds.has(app.id));
  const [dragging, setDragging] = useState(false);
  const slotRef = useRef(null);
  // Set by the embed effect; lets drag/resize push bounds updates immediately
  // instead of waiting for the 250ms heartbeat.
  const syncNowRef = useRef(null);

  const layout = app.layout || defaultLayout(0);

  useEffect(() => {
    let cancelled = false;
    checkFrameable(app.embedUrl).then(result => {
      if (!cancelled && result !== null) setFrameable(result);
    });
    return () => { cancelled = true; };
  }, [app.embedUrl]);

  // Bounds-sync loop: pin the glued window to the slot's screen rect.
  // Scroll/resize are event-driven; window drags have no DOM event, so a
  // 250ms interval covers them (visible as slight lag — accepted for glue).
  useEffect(() => {
    if (!embedded) return;
    let stopped = false;
    let raf = 0;

    const sync = async () => {
      if (stopped) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const slot = slotRef.current;
        const rect = slot?.getBoundingClientRect();
        if (!rect) return;

        // Visible sub-rect: intersect the slot with every ancestor that clips
        // (scroll containers, overflow:hidden cards/canvas) and the viewport.
        // Chromium renders via DirectComposition, which ignores SetWindowRgn
        // clipping — so instead of clipping we size the window to exactly the
        // visible sub-rect. Scrolling shrinks it edge-by-edge; it can never
        // paint over the toolbar or section headers.
        let top = 0, left = 0, bottom = window.innerHeight, right = window.innerWidth;
        for (let el = slot.parentElement; el; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (/(auto|scroll|hidden)/.test(style.overflowY) || /(auto|scroll|hidden)/.test(style.overflowX)) {
            const r = el.getBoundingClientRect();
            if (r.top > top) top = r.top;
            if (r.left > left) left = r.left;
            if (r.bottom < bottom) bottom = r.bottom;
            if (r.right < right) right = r.right;
          }
        }
        const visLeft = Math.max(rect.left, left);
        const visTop = Math.max(rect.top, top);
        const visW = Math.min(rect.right, right) - visLeft;
        const visH = Math.min(rect.bottom, bottom) - visTop;

        const { pos, minimized, visible: winVisible } = await getWinState();
        const dpr = window.devicePixelRatio || 1;
        const visible = winVisible && !minimized && !document.hidden && visW > 24 && visH > 24;
        await invoke('webapp_embed_set_bounds', {
          id: app.id,
          x: Math.round(pos.x + visLeft * dpr),
          y: Math.round(pos.y + visTop * dpr),
          width: Math.round(visW * dpr),
          height: Math.round(visH * dpr),
          visible,
        });
      } catch (e) {
        // User closed the app window (its ✕, Ctrl+W, …) — drop embed mode.
        const msg = String(e);
        if (msg.includes('window gone') || msg.includes('not embedded')) {
          stopped = true;
          embeddedIds.delete(app.id);
          setEmbedded(false);
        }
      }
    };

    const requestSync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    syncNowRef.current = requestSync;

    // Window-level changes must bypass the cached window state.
    const invalidateAndSync = () => { invalidateWinState(); requestSync(); };

    sync();
    const interval = setInterval(sync, 250);
    window.addEventListener('scroll', requestSync, true);
    window.addEventListener('resize', invalidateAndSync);
    window.addEventListener(PAN_EVENT, requestSync);
    document.addEventListener('visibilitychange', invalidateAndSync);

    // Tile resizes (our own resize grip) reported by the observer
    let ro = null;
    if (slotRef.current && 'ResizeObserver' in window) {
      ro = new ResizeObserver(requestSync);
      ro.observe(slotRef.current);
    }

    // Tauri window move/resize events tighten tracking during drags
    let unlisteners = [];
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      Promise.all([
        w.listen('tauri://move', invalidateAndSync),
        w.listen('tauri://resize', invalidateAndSync),
      ]).then(us => { if (stopped) us.forEach(u => u()); else unlisteners = us; });
    }).catch(() => { });

    return () => {
      stopped = true;
      syncNowRef.current = null;
      clearInterval(interval);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', requestSync, true);
      window.removeEventListener('resize', invalidateAndSync);
      window.removeEventListener(PAN_EVENT, requestSync);
      document.removeEventListener('visibilitychange', invalidateAndSync);
      ro?.disconnect();
      unlisteners.forEach(u => u());
      // Hide (don't close) on unmount: navigating to another face shouldn't
      // kill the app. embeddedIds keeps the intent, so remount resumes it.
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('webapp_embed_set_bounds', { id: app.id, x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => { })
      ).catch(() => { });
    };
  }, [embedded, app.id]);

  const toggleEmbed = async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    if (embedded) {
      embeddedIds.delete(app.id);
      setEmbedded(false);
      await invoke('webapp_embed_close', { id: app.id }).catch(() => { });
      return;
    }
    try {
      await invoke('webapp_embed_open', { id: app.id, url: app.openUrl });
      embeddedIds.add(app.id);
      setEmbedded(true);
    } catch (e) {
      console.error('[WebAppPreviews] embed failed:', e);
    }
  };

  const openApp = async () => {
    if (isTauriApp) {
      // Dedicated webview window = real top-level context: log in there once
      // and the session persists in the WebView profile (no third-party
      // cookie wall like the inline preview).
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_webapp_window', { id: app.id, url: app.openUrl, title: app.name });
        return;
      } catch (e) {
        console.error('[WebAppPreviews] open_webapp_window failed, falling back to browser:', e);
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('open_url', { url: app.openUrl });
          return;
        } catch { /* fall through to window.open */ }
      }
    }
    window.open(app.openUrl, '_blank');
  };

  // ── Canvas drag / resize ────────────────────────────────────────────────
  const clampLayout = (l) => {
    if (unbounded) {
      // Fullscreen canvas is infinite — pan reaches anything, so no clamping
      // beyond minimum size.
      return { x: snap(l.x), y: snap(l.y), w: Math.max(MIN_W, snap(l.w)), h: Math.max(MIN_H, snap(l.h)) };
    }
    const canvasW = canvasRef.current?.clientWidth || 1200;
    const w = Math.max(MIN_W, Math.min(l.w, canvasW - 24));
    return {
      x: Math.max(0, Math.min(snap(l.x), canvasW - w)),
      y: Math.max(0, snap(l.y)),
      w: snap(w),
      h: Math.max(MIN_H, snap(l.h)),
    };
  };

  // Shared pointer-drag runner: captures the pointer on the handle element
  // (so events keep flowing even over iframes/native windows), batches layout
  // updates to one per animation frame, and persists once on release.
  const runPointerDrag = (e, computeLayout) => {
    e.preventDefault();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    setDragging(true);
    const startX = e.clientX, startY = e.clientY;
    const orig = { ...layout };
    let pending = null;
    let raf = 0;

    const onMove = (ev) => {
      pending = clampLayout(computeLayout(orig, ev.clientX - startX, ev.clientY - startY));
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pending) {
            onLayoutChange(app.id, pending, false);
            syncNowRef.current?.();
          }
        });
      }
    };
    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      cancelAnimationFrame(raf);
      setDragging(false);
      const next = clampLayout(computeLayout(orig, ev.clientX - startX, ev.clientY - startY));
      onLayoutChange(app.id, next, true);
      syncNowRef.current?.();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    runPointerDrag(e, (orig, dx, dy) => ({ ...orig, x: orig.x + dx, y: orig.y + dy }));
  };

  const startResize = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    runPointerDrag(e, (orig, dx, dy) => ({ ...orig, w: orig.w + dx, h: orig.h + dy }));
  };

  const favicon = getFaviconUrl(app.openUrl, 32, null, true);
  const iconBtn = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary, #94A3B8)',
    cursor: 'pointer',
    padding: '3px 5px',
    borderRadius: '5px',
    fontSize: '11px',
    lineHeight: 1,
    opacity: hovered ? 0.9 : 0.45,
    transition: 'opacity 0.15s ease',
  };
  const activeBtn = {
    color: '#C4B5FD',
    background: 'rgba(139, 92, 246, 0.18)',
    opacity: 1,
  };

  return (
    <div
      className={`webapps-canvas__card${dragging ? ' webapps-canvas__card--active' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h }}
    >
      {/* Card header — doubles as the drag handle */}
      <div className="webapps-canvas__card-header" style={{ height: HEADER_H }} onPointerDown={startDrag}>
        {favicon
          ? <img src={favicon} alt="" width="14" height="14" style={{ borderRadius: '3px' }} onError={e => { e.target.style.display = 'none'; }} />
          : <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '12px', color: '#94A3B8' }} />}
        <span style={{
          fontSize: 'var(--font-sm, 12px)',
          fontWeight: 600,
          color: 'var(--text-primary, #E2E8F0)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {app.name}
        </span>
        {isTauriApp && IS_WINDOWS && <button
          onClick={toggleEmbed}
          style={{ ...iconBtn, ...(embedded ? activeBtn : {}) }}
          title={embedded
            ? 'Embedded — a real browser window is pinned here. Click to close it.'
            : 'Embed the real app here (your browser in app mode — already signed in)'}
        >
          <FontAwesomeIcon icon={faWindowRestore} />
        </button>}
        {!embedded && frameable !== false && <button
          onClick={() => setInteractive(v => !v)}
          style={{ ...iconBtn, ...(interactive ? activeBtn : {}) }}
          title={interactive
            ? 'Interactive — clicks go to the page. Click to lock back to preview mode.'
            : 'Interact with the page (needed once for sign-in / "Allow cookies" prompts)'}
        >
          <FontAwesomeIcon icon={faArrowPointer} />
        </button>}
        <button onClick={() => setReloadNonce(n => n + 1)} style={iconBtn} title="Refresh preview">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
        <button onClick={openApp} style={iconBtn} title={`Open ${app.name}`}>
          <FontAwesomeIcon icon={faUpRightFromSquare} />
        </button>
        <button
          onClick={() => {
            if (embedded) {
              embeddedIds.delete(app.id);
              import('@tauri-apps/api/core').then(({ invoke }) =>
                invoke('webapp_embed_close', { id: app.id }).catch(() => { })
              ).catch(() => { });
            }
            onRemove(app.id);
          }}
          style={{ ...iconBtn, opacity: hovered ? 0.7 : 0 }}
          title="Remove preview"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {/* Tile body */}
      <div className="webapps-canvas__body" style={{ background: app.darkInvert ? '#0d0d12' : 'rgba(255, 255, 255, 0.02)' }}>
        {embedded ? (
          /* Slot the glued native window is pinned over. Visible only for a
             frame or when the window is hidden (e.g. tile scrolled away). */
          <div ref={slotRef} style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary, #475569)',
            fontSize: 'var(--font-xs, 11px)',
          }}>
            Live {app.name} window pinned here
          </div>
        ) : frameable !== false ? (
          /* Framed preview — rendered at 2x size scaled to 50% so more of the
             page fits; input is disabled unless interactive mode is on. */
          <iframe
            key={reloadNonce}
            src={app.embedUrl}
            title={app.name}
            referrerPolicy="no-referrer"
            style={{
              width: '200%',
              height: '200%',
              border: 'none',
              transform: 'scale(0.5)',
              transformOrigin: '0 0',
              pointerEvents: interactive ? 'auto' : 'none',
              filter: app.darkInvert ? 'invert(0.9) hue-rotate(180deg) saturate(0.85)' : 'none',
            }}
          />
        ) : (
          /* Static app face — the site refuses framing; the tile is a launcher */
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
          }}>
            {favicon
              ? <img src={favicon} alt="" width="36" height="36" style={{ borderRadius: '8px', opacity: 0.9 }} onError={e => { e.target.style.display = 'none'; }} />
              : <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '30px', color: '#64748B' }} />}
            <span style={{ fontSize: 'var(--font-md, 13px)', fontWeight: 600, color: 'var(--text-primary, #E2E8F0)' }}>
              {app.name}
            </span>
            <span style={{ fontSize: 'var(--font-xs, 11px)', color: 'var(--text-secondary, #64748B)' }}>
              Site blocks previews — click to open
            </span>
          </div>
        )}
        {!embedded && !interactive && <div
          onClick={openApp}
          title={`Open ${app.name}`}
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: hovered ? 'rgba(0, 0, 0, 0.25)' : 'transparent',
            transition: 'background 0.15s ease',
          }}
        >
          {hovered && (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '99px',
              background: 'rgba(12, 12, 16, 0.85)',
              border: '1px solid rgba(139, 92, 246, 0.5)',
              color: '#C4B5FD',
              fontSize: 'var(--font-xs, 11px)',
              fontWeight: 600,
            }}>
              <FontAwesomeIcon icon={faUpRightFromSquare} style={{ fontSize: '10px' }} />
              Open {app.name}
            </span>
          )}
        </div>}
      </div>

      {/* Resize grip */}
      <div className="webapps-canvas__resize" onPointerDown={startResize} title="Resize" />
    </div>
  );
}

export function WebAppPreviews({ isTauriApp }) {
  const [apps, setApps] = useState(null); // null = not loaded yet
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  // Fullscreen canvas: rendered in a body portal covering the viewport, so
  // there is no scroll container anywhere above the tiles — glued native
  // windows have nothing to overlap. Pan the layer instead of scrolling.
  const [fullscreen, setFullscreen] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  // Esc exits fullscreen; re-pin glued windows whenever the mode flips.
  useEffect(() => {
    window.dispatchEvent(new Event(PAN_EVENT));
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Drag the canvas background to pan (fullscreen only).
  const startPan = (e) => {
    if (e.button !== 0 || e.target.closest('.webapps-canvas__card')) return;
    e.preventDefault();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    const sx = e.clientX, sy = e.clientY;
    const orig = { x: pan.x, y: pan.y };
    let next = orig;
    let raf = 0;
    const onMove = (ev) => {
      next = { x: orig.x + ev.clientX - sx, y: orig.y + ev.clientY - sy };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setPan(next);
          window.dispatchEvent(new Event(PAN_EVENT));
        });
      }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(raf);
      setPan(next);
      window.dispatchEvent(new Event(PAN_EVENT));
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // Wheel pans the fullscreen canvas (native listener — React's onWheel is
  // passive, so preventDefault wouldn't stick). Trackpads pan both axes;
  // Shift+wheel pans horizontally for mice.
  useEffect(() => {
    if (!fullscreen) return;
    const el = canvasRef.current;
    if (!el) return;
    let raf = 0;
    const onWheel = (e) => {
      e.preventDefault();
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      setPan(p => ({ x: p.x - dx, y: p.y - dy }));
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          window.dispatchEvent(new Event(PAN_EVENT));
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(raf);
    };
  }, [fullscreen]);

  useEffect(() => {
    storageGet([STORAGE_KEY, COLLAPSED_KEY]).then(res => {
      const stored = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : DEFAULT_APPS;
      // Migrate tiles saved before the canvas existed (no layout yet)
      setApps(stored.map((a, i) => (a.layout ? a : { ...a, layout: defaultLayout(i) })));
      setCollapsed(!!res[COLLAPSED_KEY]);
    });
  }, []);

  const saveApps = (next) => {
    setApps(next);
    storageSet({ [STORAGE_KEY]: next });
  };

  const handleLayoutChange = (id, layout, persist) => {
    setApps(prev => {
      const next = prev.map(a => (a.id === id ? { ...a, layout } : a));
      if (persist) storageSet({ [STORAGE_KEY]: next });
      return next;
    });
  };

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      storageSet({ [COLLAPSED_KEY]: !prev });
      return !prev;
    });
  };

  const addApp = () => {
    const app = normalizeWebApp(draftUrl, apps?.length || 0);
    if (!app) return;
    saveApps([...(apps || []), app]);
    setDraftUrl('');
    setAdding(false);
  };

  if (apps === null) return null;

  const canvasHeight = Math.max(
    CANVAS_MIN_H,
    ...apps.map(a => (a.layout?.y || 0) + (a.layout?.h || 256) + 16)
  );

  const iconBtn = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '8px',
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    color: 'var(--text-secondary, #94A3B8)',
    fontSize: 'var(--font-sm, 12px)',
    cursor: 'pointer',
  };

  const addControl = adding ? (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      borderRadius: '8px',
      background: 'rgba(18, 18, 24, 0.75)',
      border: '1px solid rgba(139, 92, 246, 0.5)',
    }}>
      <input
        autoFocus
        value={draftUrl}
        onChange={e => setDraftUrl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') addApp();
          if (e.key === 'Escape') { setAdding(false); setDraftUrl(''); }
          e.stopPropagation();
        }}
        placeholder="app URL, e.g. calendar.google.com"
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text-primary, #E2E8F0)',
          fontSize: 'var(--font-sm, 12px)',
          width: '220px',
          caretColor: '#8b5cf6',
        }}
      />
      <button
        onClick={addApp}
        style={{
          background: 'rgba(139, 92, 246, 0.18)',
          border: '1px solid rgba(139, 92, 246, 0.4)',
          borderRadius: '6px',
          color: '#C4B5FD',
          fontSize: 'var(--font-xs, 11px)',
          fontWeight: 600,
          padding: '3px 10px',
          cursor: 'pointer',
        }}
      >
        Add
      </button>
    </div>
  ) : (
    <button
      onClick={() => setAdding(true)}
      style={{ ...iconBtn, border: '1px dashed rgba(255, 255, 255, 0.15)' }}
      title="Add a web app to the canvas"
    >
      <FontAwesomeIcon icon={faPlus} style={{ fontSize: '10px' }} />
      Add app
    </button>
  );

  const canvasBody = (
    <div
      className={`webapps-canvas${fullscreen ? ' webapps-canvas--fullscreen' : ''}`}
      ref={canvasRef}
      style={fullscreen ? undefined : { height: canvasHeight }}
      onPointerDown={fullscreen ? startPan : undefined}
    >
      <div
        className="webapps-canvas__layer"
        style={{ transform: `translate(${fullscreen ? pan.x : 0}px, ${fullscreen ? pan.y : 0}px)` }}
      >
        {apps.map(app => (
          <PreviewCard
            key={app.id}
            app={app}
            isTauriApp={isTauriApp}
            canvasRef={canvasRef}
            unbounded={fullscreen}
            onRemove={(id) => saveApps(apps.filter(a => a.id !== id))}
            onLayoutChange={handleLayoutChange}
          />
        ))}
      </div>
      {apps.length === 0 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary, #475569)',
          fontSize: 'var(--font-sm, 12px)',
        }}>
          No web apps yet — use “Add app” to pin one to the canvas
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="webapps-canvas-overlay">
        <div className="webapps-canvas-overlay__bar">
          <span style={{
            fontSize: 'var(--font-sm, 12px)',
            fontWeight: 600,
            color: 'var(--text-secondary, #94A3B8)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Web Apps canvas
          </span>
          <span style={{ fontSize: 'var(--font-xs, 11px)', color: 'var(--text-secondary, #64748B)' }}>
            drag the background to pan
          </span>
          {addControl}
          <div style={{ flex: 1 }} />
          {(pan.x !== 0 || pan.y !== 0) && (
            <button
              onClick={() => { setPan({ x: 0, y: 0 }); window.dispatchEvent(new Event(PAN_EVENT)); }}
              style={iconBtn}
              title="Reset pan to origin"
            >
              Reset view
            </button>
          )}
          <button onClick={() => setFullscreen(false)} style={iconBtn} title="Exit fullscreen (Esc)">
            <FontAwesomeIcon icon={faCompress} />
            Exit
          </button>
        </div>
        {canvasBody}
      </div>,
      document.body
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: collapsed ? 0 : '8px' }}>
        <h3
          onClick={toggleCollapsed}
          style={{
            fontSize: 'var(--font-2xl, 20px)',
            fontWeight: 600,
            color: 'var(--text-secondary, #94A3B8)',
            margin: 0,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title={collapsed ? 'Show web app canvas' : 'Hide web app canvas'}
        >
          <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} style={{ opacity: 0.6, fontSize: '0.7em' }} />
          Web Apps{apps.length > 0 ? ` (${apps.length})` : ''}
        </h3>

        {!collapsed && addControl}
        {!collapsed && (
          <button
            onClick={() => setFullscreen(true)}
            style={iconBtn}
            title="Fullscreen canvas — unlimited space, no scrolling"
          >
            <FontAwesomeIcon icon={faExpand} />
            Fullscreen
          </button>
        )}
      </div>

      {!collapsed && canvasBody}
    </div>
  );
}
