// Collapsed edge-handle for the Workspace drawer. Hovering it (past a short
// intent delay) or clicking it asks the backend to slide the panel in
// (dock_expand); the backend hides this handle window. Collapsing back down
// happens on the panel side, via its own blur handler (see `lib.rs`).
import { invoke } from '@tauri-apps/api/core';

const el = document.getElementById('handle');

// Reflect the docked side so the tab's rounded corner faces inward (and the
// grip dots run horizontally for top/bottom docks). The backend stores side in
// dock state; re-read whenever it changes so re-docking to another edge
// restyles the handle without a reload.
const applySide = (side) => {
  el.classList.remove('left', 'top', 'bottom');
  if (side === 'left' || side === 'top' || side === 'bottom') el.classList.add(side);
};

invoke('dock_get_state')
  .then((st) => applySide(st?.side))
  .catch(() => {});

import('@tauri-apps/api/event')
  .then(({ listen }) => listen('dock-state-changed', (e) => applySide(e.payload?.side)))
  .catch(() => {});

const expand = () => {
  invoke('dock_expand').catch((e) => console.error('[Handle] dock_expand failed:', e));
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
