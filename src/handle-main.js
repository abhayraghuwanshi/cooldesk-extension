// Collapsed edge-handle for the Workspace drawer. Clicking it asks the backend
// to slide the panel in (dock_expand); the backend hides this handle window.
import { invoke } from '@tauri-apps/api/core';

const el = document.getElementById('handle');

// Reflect the docked side so the tab's rounded corner faces inward. The backend
// stores side in dock state; read it once so the handle looks right on the left.
invoke('dock_get_state')
  .then((st) => {
    if (st && st.side === 'left') el.classList.add('left');
  })
  .catch(() => {});

el.addEventListener('click', () => {
  invoke('dock_expand').catch((e) => console.error('[Handle] dock_expand failed:', e));
});
