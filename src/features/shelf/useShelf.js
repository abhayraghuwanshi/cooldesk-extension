import { useCallback, useEffect, useState } from 'react';

// The Shelf (src-tauri/src/shelf.rs): a temporary space for downloads from
// the in-app browser, pasted text/images and dropped files. This hook keeps
// the list in sync (the Rust side emits `shelf-changed` after every change)
// and tracks downloads in flight (`shelf-download`).

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

async function listen(event, fn) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(event, fn);
}

/** ArrayBuffer → base64 without blowing the call stack on big files. */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** asset:// URL for a shelf file (thumbnails, image copy). */
export async function shelfFileUrl(path) {
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}

/**
 * Copy an image file to the clipboard as PNG (the one image type WebKit's
 * clipboard accepts). The ClipboardItem is built synchronously with a promise
 * so the click's user activation still counts when the data arrives.
 */
export function copyImageFile(path) {
  const png = (async () => {
    const blob = await (await fetch(await shelfFileUrl(path))).blob();
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'));
  })();
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export async function copyTextFile(path) {
  const { content } = await invoke('preview_text_file', { path });
  return navigator.clipboard.writeText(content);
}

const DOWNLOAD_LINGER_MS = 4000;

export function useShelf() {
  const [items, setItems] = useState([]);
  const [downloads, setDownloads] = useState([]); // { key, name, url, state }
  const [unseen, setUnseen] = useState(0);         // finished downloads not looked at yet

  const refresh = useCallback(() => {
    invoke('shelf_list').then(list => setItems(Array.isArray(list) ? list : [])).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
    const offs = [];
    let cancelled = false;
    listen('shelf-changed', refresh).then(off => (cancelled ? off() : offs.push(off)));
    listen('shelf-download', ({ payload }) => {
      if (!payload) return;
      const key = `${payload.url}|${payload.name}`;
      setDownloads(prev => {
        const rest = prev.filter(d => d.url !== payload.url);
        return [...rest, { key, ...payload }];
      });
      if (payload.state !== 'started') {
        if (payload.state === 'finished') setUnseen(n => n + 1);
        setTimeout(() => setDownloads(prev => prev.filter(d => !(d.url === payload.url && d.state !== 'started'))), DOWNLOAD_LINGER_MS);
      }
    }).then(off => (cancelled ? off() : offs.push(off)));
    return () => { cancelled = true; offs.forEach(off => off()); };
  }, [refresh]);

  const run = useCallback(async (cmd, args) => {
    try {
      return await invoke(cmd, args);
    } catch (err) {
      console.warn(`[Shelf] ${cmd} failed:`, err);
      return null;
    }
  }, []);

  const addText = useCallback((text, name) => run('shelf_add_text', { text, name: name || null }), [run]);
  const addFile = useCallback(async (file) => {
    const data = toBase64(await file.arrayBuffer());
    const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const name = file.name && file.name !== 'image.png' ? file.name : `Pasted ${new Date().toLocaleString().replace(/[/:]/g, '-')}.${ext}`;
    return run('shelf_add_bytes', { name, data, source: 'clipboard' });
  }, [run]);
  const importPaths = useCallback((paths) => run('shelf_import', { paths }), [run]);
  const remove = useCallback((id) => run('shelf_remove', { id }), [run]);
  const pin = useCallback((id, pinned) => run('shelf_pin', { id, pinned }), [run]);
  const clear = useCallback((includePinned = false) => run('shelf_clear', { includePinned }), [run]);
  const saveTo = useCallback((id, destDir) => run('shelf_save_to', { id, destDir: destDir || null }), [run]);

  return {
    items, downloads, unseen, markSeen: () => setUnseen(0),
    refresh, addText, addFile, importPaths, remove, pin, clear, saveTo,
  };
}
