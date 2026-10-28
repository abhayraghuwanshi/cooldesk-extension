// Native drag-out (Tauri only): an element dragged out becomes a real OS file
// drag, so dropping it on Finder/Explorer copies the file there and dropping
// it on a web page's upload field (including the in-app browser pane) uploads
// it — what a plain HTML5 drag can't do, since it carries no actual file.
// Mode is "copy": the source is never moved. Statically imported because the
// native drag must start while the button is still held — awaiting a dynamic
// import first can miss it. Shared by the file manager, the Shelf and clipboard history.
import { startDrag } from '@crabnebula/tauri-plugin-drag';

export const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// The plugin needs a PNG (as a data URL) for the image under the cursor.
// Drawn once per kind and cached — a folder/file glyph on a rounded tile.
const dragIconCache = {};
function dragIconFor(isDir) {
  const key = isDir ? 'dir' : 'file';
  if (dragIconCache[key]) return dragIconCache[key];
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(30, 30, 40, 0.85)';
  g.beginPath();
  g.roundRect?.(4, 4, size - 8, size - 8, 12);
  g.fill();
  g.font = '34px -apple-system, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(isDir ? '📁' : '📄', size / 2, size / 2 + 2);
  dragIconCache[key] = c.toDataURL('image/png');
  return dragIconCache[key];
}

/** onDragStart handler body: replace the HTML5 drag with an OS file drag.
 *  `path` may be one path or several (copied files from clipboard history). */
export function startNativeDrag(e, path, isDir = false) {
  // Cancel the webview's own HTML5 drag — the OS drag replaces it.
  e.preventDefault();
  startDrag({ item: Array.isArray(path) ? path : [path], icon: dragIconFor(isDir), mode: 'copy' })
    .catch(err => console.warn('[nativeDrag] native drag failed:', err));
}
