// Turning the sidebar / dock windows on and off, and getting back to the
// full app from them. Thin wrappers over the `dock_*` commands in
// src-tauri/src/surfaces.rs, shared by Settings, the header button, the
// sidebar's corner bar and the dock bar.
import { recordFeature } from '../../services/analytics';

async function invoke(cmd, args) {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke(cmd, args);
}

/** Turn a surface ('sidebar' | 'bar') on — or change its side/size/mode —
 *  and slide it in unless `expand: false`. */
export async function enableSurface(surface, { side, size, mode, expand = true } = {}) {
  const state = await invoke('dock_enable', { surface, side, size, mode, expand });
  recordFeature('dock_enabled');
  return state;
}

export function disableSurface(surface) {
  return invoke('dock_disable', { surface });
}

export function expandSurface(surface) {
  return invoke('dock_expand', { surface });
}

/** Sidebar width / dock height, in CSS px. */
export function setSurfaceSize(surface, size) {
  return invoke('dock_set_size', { surface, size });
}

/** On → off, off → on (and shown). */
export function toggleSurface(surface, dockState) {
  return dockState?.[surface]?.enabled ? disableSurface(surface) : enableSurface(surface);
}

/** Show the full app; `from` (a surface) collapses back to its handle. */
export function openFullApp(from) {
  return invoke('dock_open_main', { from: from || null });
}
