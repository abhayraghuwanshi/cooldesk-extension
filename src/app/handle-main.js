// Collapsed edge-handle for the Workspace drawer. Clicking it asks the backend
// to slide the panel in (dock_expand); the backend hides this handle window.
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

el.addEventListener('click', () => {
  invoke('dock_expand').catch((e) => console.error('[Handle] dock_expand failed:', e));
});
