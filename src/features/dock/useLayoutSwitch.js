import { faGripLines, faTableColumns, faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
import { useCallback } from 'react';

// One button walks the window through three layouts:
//   full → side (drawer on the saved vertical edge) → bar (bottom strip) → full
// The button renders the *next* layout's icon, so it always reads as an
// action rather than a status light.
export const LAYOUTS = {
  full: { key: 'full', label: 'Full window', icon: faWindowMaximize, next: 'side' },
  side: { key: 'side', label: 'Side dock', icon: faTableColumns, next: 'bar' },
  bar: { key: 'bar', label: 'Bottom bar', icon: faGripLines, next: 'full' },
};

/**
 * Shared by every surface that offers the layout-cycle control (header,
 * sidebar corner bar, Tab Management toolbar, the workspace dock bar) plus
 * the Ctrl+Shift+D shortcut, so they read `dockState` the same way and can't
 * drift out of sync with each other.
 */
export function useLayoutSwitch(dockState) {
  const currentLayout = !dockState?.enabled
    ? 'full'
    : (dockState.side === 'bottom' || dockState.side === 'top') ? 'bar' : 'side';
  const currentLayoutInfo = LAYOUTS[currentLayout];
  const nextLayout = LAYOUTS[currentLayoutInfo.next];

  const applyLayout = useCallback(async (layout) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (layout === 'full') {
        await invoke('dock_disable');
        return;
      }
      // Keep the user's chosen vertical edge; the stored side may be "bottom"
      // from bar mode, in which case fall back to right.
      const side = layout === 'bar'
        ? 'bottom'
        : (dockState?.side === 'left' ? 'left' : 'right');
      await invoke('dock_enable', { mode: 'drawer', side });
      await invoke('dock_expand');
    } catch (e) {
      console.error(`[LayoutSwitch] Failed to switch layout to "${layout}":`, e);
    }
  }, [dockState]);

  const cycleLayout = useCallback(() => {
    applyLayout(LAYOUTS[currentLayout].next);
  }, [applyLayout, currentLayout]);

  return { currentLayout, currentLayoutInfo, nextLayout, applyLayout, cycleLayout };
}
