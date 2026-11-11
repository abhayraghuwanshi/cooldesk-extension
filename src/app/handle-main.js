// Collapsed edge-handle for one dock surface — the sidebar's
// ("sidebar-handle") or the dock bar's ("bar-handle"); both windows load this
// page. Hovering it (past a short intent delay) or clicking it asks the
// backend to slide that surface's panel in (dock_expand); the backend hides
// this handle window. Collapsing back down happens on the panel side (see
// src-tauri/src/surfaces.rs).
import { invoke } from '@tauri-apps/api/core';

const el = document.getElementById('handle');

const label = (() => {
  try {
    return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || '';
  } catch {
    return '';
  }
})();
const surface = label.startsWith('bar') ? 'bar' : 'sidebar';

// Reflect the docked side so the tab's rounded corner faces inward (and the
// grip dots run horizontally for top/bottom docks). Re-read whenever the
// state changes so moving the surface to another edge restyles the handle
// without a reload.
const applySide = (side) => {
  el.classList.remove('left', 'top', 'bottom');
  if (side === 'left' || side === 'top' || side === 'bottom') el.classList.add(side);
};
const applyState = (st) => applySide(st?.[surface]?.side || (surface === 'bar' ? 'bottom' : 'right'));

invoke('dock_get_state')
  .then(applyState)
  .catch(() => {});

import('@tauri-apps/api/event')
  .then(({ listen }) => listen('dock-state-changed', (e) => applyState(e.payload)))
  .catch(() => {});

// Pending update: badge the grip so it's visible while the drawer is collapsed
// (the sidebar's own update button is only on screen when it's open). The
// main window owns the check and broadcasts it; ask once on load in case it
// already finished before this listener existed.
const applyUpdate = (payload) => {
  const has = !!payload?.hasUpdate;
  el.classList.toggle('has-update', has);
  el.title = has
    ? `Open CoolDesk — update${payload.latest ? ` ${payload.latest}` : ''} available`
    : 'Open CoolDesk';
};

import('@tauri-apps/api/event')
  .then(async ({ listen, emit }) => {
    await listen('update-state', (e) => applyUpdate(e.payload));
    emit('update-state-request').catch(() => {});
  })
  .catch(() => {});

const expand = () => {
  invoke('dock_expand', { surface }).catch((e) => console.error('[Handle] dock_expand failed:', e));
};

el.addEventListener('click', expand);

// Hover-intent: wait a beat before expanding so just passing the cursor over
// the edge (reaching for a traffic-light button, Mission Control, a scroll
// edge) doesn't pop the panel open. Cancel the timer on mouseleave so a
// stray touch-and-go never fires — this window closes the instant
// `dock_expand` hides it anyway, so there's nothing to "un-cancel".
const HOVER_INTENT_MS = 200;
let hoverTimer = null;

el.addEventListener('mouseenter', () => {
  hoverTimer = window.setTimeout(expand, HOVER_INTENT_MS);
});

el.addEventListener('mouseleave', () => {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
});
