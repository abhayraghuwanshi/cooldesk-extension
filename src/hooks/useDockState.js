import { useEffect, useState } from 'react';

const isTauri = () =>
  typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

/**
 * Live view of the backend dock state ({enabled, mode, side, width, barHeight}).
 * Reads it once on mount and stays in sync via the `dock-state-changed` event
 * the dock commands emit — so tray toggles and other windows are reflected too.
 * Returns null outside the desktop app (or before the first read resolves).
 */
export function useDockState() {
  const [dockState, setDockState] = useState(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten = null;

    (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import('@tauri-apps/api/core'),
          import('@tauri-apps/api/event'),
        ]);
        unlisten = await listen('dock-state-changed', (e) => {
          if (!cancelled && e.payload) setDockState(e.payload);
        });
        const state = await invoke('dock_get_state');
        if (!cancelled && state) setDockState((prev) => prev || state);
      } catch (e) {
        console.warn('[DockState] Failed to read dock state:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return dockState;
}
