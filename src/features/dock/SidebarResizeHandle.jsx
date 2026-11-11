import { useRef } from 'react';

const MIN = 220;
const MAX = 900;

async function resize(size, done) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('dock_resize', { surface: 'sidebar', size, done });
}

/**
 * Sidebar window: a grip on the inner edge (the one facing the screen) —
 * drag it to make the sidebar wider or narrower. The window is borderless
 * and pinned to the screen edge, so the OS gives it no resize border of its
 * own. Screen coordinates, since the window moves under the pointer as it
 * grows; one resize per frame; the final width is saved on release
 * (dock_resize in src-tauri/src/surfaces.rs).
 */
export function SidebarResizeHandle({ side = 'right', width = 320 }) {
  const drag = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.screenX, start: width, size: width, frame: 0 };
    document.documentElement.classList.add('sidebar-resizing');
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.x;
    // Right-docked: dragging the left edge leftwards widens it.
    const next = Math.round(Math.min(MAX, Math.max(MIN, d.start + (side === 'left' ? dx : -dx))));
    if (next === d.size) return;
    d.size = next;
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      resize(d.size, false).catch(() => { });
    });
  };

  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.frame) cancelAnimationFrame(d.frame);
    document.documentElement.classList.remove('sidebar-resizing');
    resize(d.size, true).catch((err) => console.warn('[Sidebar] resize failed:', err));
  };

  return (
    <div
      className={`sidebar-resize-handle sidebar-resize-handle--${side === 'left' ? 'right-edge' : 'left-edge'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      title="Drag to resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
    />
  );
}
