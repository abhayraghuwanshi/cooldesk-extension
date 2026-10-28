import { useCallback, useEffect, useState } from 'react';

// Clipboard history (src-tauri/src/clipboard.rs). The Rust watcher records
// copies while history is on and emits `clipboard-changed` after every change
// and `clipboard-status` when it's turned on/off or paused.

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

async function listen(event, fn) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(event, fn);
}

/** asset:// URL for a clip's image file. */
export async function clipFileUrl(path) {
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}

export function fullClipText(id) {
  return invoke('clipboard_text', { id });
}

/** On/off + paused, for Settings and the card header. */
export function useClipboardStatus() {
  const [status, setStatus] = useState(null); // null until loaded
  useEffect(() => {
    if (!IS_TAURI) return undefined;
    let off = null;
    let cancelled = false;
    invoke('clipboard_status').then(s => !cancelled && setStatus(s)).catch(() => { });
    listen('clipboard-status', ({ payload }) => setStatus(payload))
      .then(fn => (cancelled ? fn() : (off = fn)));
    return () => { cancelled = true; off?.(); };
  }, []);

  const setEnabled = useCallback(enabled => invoke('clipboard_set_enabled', { enabled }).then(setStatus), []);
  const setPaused = useCallback(paused => invoke('clipboard_set_paused', { paused }).then(setStatus), []);
  return { status, setEnabled, setPaused };
}

export function useClipboardHistory({ active = true } = {}) {
  const [items, setItems] = useState([]);

  const refresh = useCallback(() => {
    invoke('clipboard_list').then(list => setItems(Array.isArray(list) ? list : [])).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!IS_TAURI || !active) return undefined;
    refresh();
    let off = null;
    let cancelled = false;
    listen('clipboard-changed', refresh).then(fn => (cancelled ? fn() : (off = fn)));
    return () => { cancelled = true; off?.(); };
  }, [active, refresh]);

  const run = useCallback(async (cmd, args) => {
    try {
      return await invoke(cmd, args);
    } catch (err) {
      console.warn(`[Clipboard] ${cmd} failed:`, err);
      throw err;
    }
  }, []);

  const copy = useCallback(id => run('clipboard_copy', { id }), [run]);
  const pin = useCallback((id, pinned) => run('clipboard_pin', { id, pinned }), [run]);
  const remove = useCallback(id => run('clipboard_remove', { id }), [run]);
  const clear = useCallback((includePinned = false) => run('clipboard_clear', { includePinned }), [run]);
  const saveToShelf = useCallback(id => run('clipboard_save_to_shelf', { id }), [run]);

  return { items, refresh, copy, pin, remove, clear, saveToShelf };
}
