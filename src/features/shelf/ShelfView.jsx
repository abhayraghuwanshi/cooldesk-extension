import { faArrowDown, faCheck, faCopy, faDownload, faFile, faFileLines, faImage, faPaste, faSpinner, faThumbtack, faTrashCan, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { getPreviewItem } from '../../utils/filePreviewKind.js';
import { IS_TAURI, startNativeDrag } from '../../utils/nativeDrag.js';
import { copyImageFile, copyTextFile, shelfFileUrl } from './useShelf';
import './shelf.css';

// The Shelf, inside Browse's side panel. Things land here instead of on the
// computer: downloads from in-app pages, ⌘V'd text and images, files dropped
// in. Clicking an item opens it as a tab in the main view; each one can also
// be copied, dragged onto a page (a real file drag), saved out to Downloads,
// pinned, or left to expire.

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function expiresIn(ms) {
  const d = Math.ceil((ms - Date.now()) / 86400000);
  return d <= 1 ? 'expires today' : `expires in ${d}d`;
}

function sourceLabel(item) {
  if (item.source === 'clipboard') return 'Pasted';
  const host = item.source && hostOf(item.source);
  if (host) return host;
  return item.source ? 'Added' : '';
}

function Thumb({ item }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (item.kind !== 'image') return undefined;
    let live = true;
    shelfFileUrl(item.path).then(u => live && setSrc(u)).catch(() => { });
    return () => { live = false; };
  }, [item.kind, item.path]);
  if (src) return <img className="sh-thumb" src={src} alt="" draggable={false} />;
  const icon = item.kind === 'text' ? faFileLines : item.kind === 'image' ? faImage : faFile;
  return <span className={`sh-thumb sh-thumb-${item.kind}`}><FontAwesomeIcon icon={icon} /></span>;
}

/** Icon button that shows a check for a moment after its action succeeds. */
function Action({ icon, label, onRun, danger = false, active = false }) {
  const [done, setDone] = useState(false);
  const click = async (e) => {
    e.stopPropagation();
    try {
      const ok = await onRun();
      if (ok !== false) {
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }
    } catch (err) {
      console.warn(`[Shelf] ${label} failed:`, err);
    }
  };
  return (
    <button className={`bp-btn sh-act ${danger ? 'danger' : ''} ${active ? 'on' : ''}`} onClick={click} title={label}>
      <FontAwesomeIcon icon={done ? faCheck : icon} />
    </button>
  );
}

/**
 * @param shelf   from useShelf (owned by BrowseView, which also shows its badge)
 * @param active  the Shelf tab is on screen (drop target + paste)
 * @param onOpen  (path) → open an item as a main-view tab
 */
export function ShelfView({ shelf, active, onOpen }) {
  const rootRef = useRef(null);
  const [dropHover, setDropHover] = useState(false);
  const [note, setNote] = useState(null);
  const { items, downloads } = shelf;
  // useShelf returns a fresh object each render; effects read it through a
  // ref so they don't resubscribe every time.
  const shelfRef = useRef(shelf);
  useEffect(() => { shelfRef.current = shelf; });

  useEffect(() => { if (active) shelfRef.current.markSeen(); }, [active, shelf.unseen]);

  const flash = (text) => {
    setNote(text);
    setTimeout(() => setNote(n => (n === text ? null : n)), 2200);
  };

  // ⌘V while the shelf has focus.
  const onPaste = async (e) => {
    const files = [...(e.clipboardData?.files || [])];
    const text = e.clipboardData?.getData('text/plain');
    if (!files.length && !text) return;
    e.preventDefault();
    for (const f of files) await shelf.addFile(f);
    if (!files.length && text) await shelf.addText(text);
    flash(files.length ? `Added ${files.length} ${files.length === 1 ? 'item' : 'items'}` : 'Added text');
  };

  // Paste button: the async clipboard (WebKit shows its own "Paste" bubble).
  const pasteFromClipboard = async () => {
    try {
      const entries = await navigator.clipboard.read();
      let added = 0;
      for (const entry of entries) {
        const image = entry.types.find(t => t.startsWith('image/'));
        if (image) {
          const blob = await entry.getType(image);
          await shelf.addFile(new File([blob], '', { type: image }));
          added += 1;
        } else if (entry.types.includes('text/plain')) {
          const text = await (await entry.getType('text/plain')).text();
          if (text.trim()) { await shelf.addText(text); added += 1; }
        }
      }
      flash(added ? 'Added from clipboard' : 'Clipboard is empty');
    } catch {
      flash('Press ⌘V here to paste');
      rootRef.current?.focus();
    }
  };

  // Files dropped from Finder or the file manager arrive as a Tauri
  // drag-drop event with paths + cursor position (not as HTML5 drops).
  useEffect(() => {
    if (!active || !IS_TAURI) return undefined;
    let off = null;
    let cancelled = false;
    const inside = (position) => {
      const el = rootRef.current;
      if (!el || !position) return false;
      const scale = window.devicePixelRatio || 1;
      const hit = document.elementFromPoint(position.x / scale, position.y / scale);
      return !!hit && el.contains(hit);
    };
    import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(async (event) => {
        const { type, position, paths } = event.payload || {};
        if (type === 'over' || type === 'enter') setDropHover(inside(position));
        else if (type === 'leave') setDropHover(false);
        else if (type === 'drop') {
          setDropHover(false);
          // Ignore a shelf item dragged and let go over the shelf itself.
          const own = new Set(shelfRef.current.items.map(i => i.path));
          const fresh = (paths || []).filter(p => !own.has(p));
          if (inside(position) && fresh.length) {
            const added = await shelfRef.current.importPaths(fresh);
            flash(added?.length ? `Added ${added.length} ${added.length === 1 ? 'file' : 'files'}` : 'Folders can’t go on the shelf');
          }
        }
      }))
      .then(fn => { if (cancelled) fn(); else off = fn; })
      .catch(() => { });
    return () => { cancelled = true; off?.(); };
  }, [active]);

  const copyItem = (item) => (item.kind === 'image'
    ? copyImageFile(item.path)
    : (getPreviewItem(item.path)?.previewKind === 'code' || item.kind === 'text')
      ? copyTextFile(item.path)
      : navigator.clipboard.writeText(item.path));

  const saveOut = async (item) => {
    const dest = await shelf.saveTo(item.id);
    if (dest) flash(`Saved to ${dest.split(/[/\\]/).slice(-2, -1)[0] || 'Downloads'}`);
    return !!dest;
  };

  return (
    <div
      ref={rootRef}
      className={`sh-root ${dropHover ? 'drop-hover' : ''}`}
      tabIndex={-1}
      onPaste={onPaste}
    >
      <div className="sh-bar">
        <button className="browse-chip" onClick={pasteFromClipboard} title="Add what's on the clipboard (or press ⌘V here)">
          <FontAwesomeIcon icon={faPaste} /> Paste
        </button>
        <span className="sh-hint">{note || 'Downloads land here · drop or paste anything · 7 days unless pinned'}</span>
        {items.length > 0 && (
          <button className="bp-btn sh-act danger" onClick={() => shelf.clear(false)} title="Clear everything that isn't pinned">
            <FontAwesomeIcon icon={faTrashCan} />
          </button>
        )}
      </div>

      {downloads.length > 0 && (
        <div className="sh-downloads">
          {downloads.map(d => (
            <div key={d.key} className={`sh-dl sh-dl-${d.state}`}>
              <FontAwesomeIcon
                icon={d.state === 'started' ? faSpinner : d.state === 'failed' ? faTriangleExclamation : faArrowDown}
                spin={d.state === 'started'}
              />
              <span className="sh-dl-name">{d.name || hostOf(d.url) || 'Download'}</span>
              <span className="sh-dl-state">{d.state === 'started' ? 'Downloading…' : d.state === 'failed' ? 'Failed' : 'Saved'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sh-list">
        {items.length === 0 && downloads.length === 0 && (
          <div className="sh-empty">
            <FontAwesomeIcon icon={faDownload} />
            <strong>Your shelf is empty</strong>
            <span>Downloads from pages in CoolDesk land here instead of your Downloads folder. You can also press ⌘V or drop files here.</span>
          </div>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className="sh-item"
            onClick={() => onOpen?.(item.path)}
            draggable={IS_TAURI}
            onDragStart={IS_TAURI ? (e) => startNativeDrag(e, item.path, false) : undefined}
            title={`${item.name}\nClick to open · drag onto a page or into Finder`}
          >
            <Thumb item={item} />
            <span className="sh-text">
              <span className="sh-name">{item.name}</span>
              <span className="sh-meta">
                {[formatSize(item.size), sourceLabel(item), ago(item.added)].filter(Boolean).join(' · ')}
                <span className={`sh-expiry ${item.pinned ? 'pinned' : ''}`}>
                  {item.pinned ? 'Pinned' : expiresIn(item.expires)}
                </span>
              </span>
            </span>
            <span className="sh-actions">
              <Action icon={faThumbtack} label={item.pinned ? 'Unpin (expire again)' : 'Pin (keep)'} active={item.pinned} onRun={() => shelf.pin(item.id, !item.pinned)} />
              <Action icon={faCopy} label={item.kind === 'image' ? 'Copy image' : item.kind === 'file' && getPreviewItem(item.path)?.previewKind !== 'code' ? 'Copy path' : 'Copy text'} onRun={() => copyItem(item)} />
              <Action icon={faDownload} label="Save to Downloads" onRun={() => saveOut(item)} />
              <Action icon={faTrashCan} label="Delete" danger onRun={() => shelf.remove(item.id)} />
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}
