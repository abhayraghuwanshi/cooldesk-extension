import { faArrowLeft, faArrowUpFromBracket, faCheck, faChevronLeft, faChevronRight, faEye, faFile, faFileLines, faFilm, faFilePdf, faFolderOpen, faImage, faTrashCan, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { FileManager } from '../file-manager/FileManager';
import { TabAddressBar } from '../../faces/browse/TabAddressBar';
import { getPreviewItem } from '../../utils/filePreviewKind.js';
import { shelfFileUrl } from '../shelf/useShelf';
import { invoke } from './useNativePane';
import './uploadPicker.css';

const PreviewPane = lazy(() => import('../spotlight/PreviewPane'));

// CoolDesk's file picker for uploads from in-app pages (an `<input type=file>`
// on Reddit, Gmail, …), shown as a tile beside the page in multi view rather
// than a dialog: nothing is blocked, and you can ignore it or close it.
// src-tauri/src/browser_pane/uploads.rs holds WebKit's request; BrowseView
// opens this tab for it. Upload answers with browser_pane_file_choose,
// "Use Finder" with browser_pane_file_system, and closing the tile cancels.
//
// One screen: recent Shelf items (downloads, screenshots, pasted images) as
// a strip on top, the file manager below, and what you've picked as a small
// thumbnail strip at the bottom — browsing keeps the room, so you can keep
// adding files. Click a thumbnail to check it large (ReviewSheet, over the
// browser, ←/→ through the selection). Picking only builds the selection;
// nothing is sent until Upload.

const LAST_DIR_KEY = 'cooldesk.upload.lastDir';
const SHELF_STRIP_MAX = 24;

function baseName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function dirName(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

function extOf(p) {
  const name = baseName(p);
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage off */ }
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  zip: 'application/zip',
};
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']);

/** The input's `accept` as a test on a path (null: anything goes). */
function acceptTest(extensions = [], mimeTypes = []) {
  const exts = new Set(extensions.map(e => e.replace(/^\./, '').toLowerCase()));
  const mimes = mimeTypes.map(m => m.toLowerCase());
  if (!exts.size && !mimes.length) return null;
  return (path) => {
    const ext = extOf(path);
    if (exts.has(ext)) return true;
    const mime = MIME_BY_EXT[ext];
    if (!mime) return false;
    return mimes.some(m => m === mime || (m.endsWith('/*') && mime.startsWith(m.slice(0, -1))));
  };
}

/** "images, videos" for the address bar, from the accept lists. */
function acceptLabel(extensions = [], mimeTypes = []) {
  const kinds = new Set();
  for (const m of mimeTypes) {
    const top = m.split('/')[0];
    if (['image', 'video', 'audio'].includes(top)) kinds.add(`${top}s`);
    else if (m === 'application/pdf') kinds.add('PDFs');
  }
  if (kinds.size) return [...kinds].join(', ');
  if (extensions.length) return extensions.slice(0, 6).map(e => `.${e.replace(/^\./, '')}`).join(' ');
  return '';
}

function iconForPath(path) {
  const kind = getPreviewItem(path)?.previewKind;
  if (kind === 'image' || IMAGE_EXTS.has(extOf(path))) return faImage;
  if (kind === 'video') return faFilm;
  if (kind === 'pdf') return faFilePdf;
  if (kind === 'code') return faFileLines;
  return faFile;
}

/** A small picture of a file: the image itself, else its kind's icon. */
function Thumb({ path, className = '' }) {
  const [src, setSrc] = useState(null);
  const isImage = IMAGE_EXTS.has(extOf(path));
  useEffect(() => {
    setSrc(null);
    if (!isImage) return undefined;
    let live = true;
    shelfFileUrl(path).then(u => live && setSrc(u)).catch(() => { });
    return () => { live = false; };
  }, [path, isImage]);
  if (src) return <img className={`up-thumb ${className}`} src={src} alt="" draggable={false} />;
  return (
    <span className={`up-thumb up-thumb-icon ${className}`}>
      <FontAwesomeIcon icon={iconForPath(path)} />
      {extOf(path) && <em>{extOf(path)}</em>}
    </span>
  );
}

/** Recent Shelf items as a strip of cards. */
function ShelfStrip({ items, picked, onToggle, accepts }) {
  return (
    <section className="up-shelf" aria-label="From your Shelf">
      <div className="up-section-head">
        <span>From your Shelf</span>
        <em>downloads, screenshots, pasted images</em>
      </div>
      <div className="up-strip">
        {items.map(item => {
          const on = picked.has(item.path);
          const fits = !accepts || accepts(item.path);
          return (
            <button
              key={item.id}
              className={`up-card ${on ? 'on' : ''} ${fits ? '' : 'is-off'}`}
              onClick={() => onToggle({ path: item.path, size: item.size })}
              aria-pressed={on}
              title={fits ? item.name : `${item.name}\nThis site may not accept this kind of file`}
            >
              <Thumb path={item.path} />
              <span className="up-card-name">{item.name}</span>
              {on && <span className="up-check"><FontAwesomeIcon icon={faCheck} /></span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Review a chosen file, large: image / video / PDF / text, else a file card.
 * Opened from the selection strip, over the file browser — picking files
 * never opens it, so browsing keeps all the room.
 */
function ReviewSheet({ files, index, accepts, onIndex, onRemove, onClose }) {
  const file = files[index];
  const item = getPreviewItem(file.path);
  const fits = !accepts || accepts(file.path);
  const many = files.length > 1;
  return (
    <div className="up-sheet" role="dialog" aria-label={`Preview of ${baseName(file.path)}`}>
      <div className="up-sheet-head">
        <button className="bp-btn" onClick={onClose} title="Back to files (Esc)" aria-label="Back to files">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <span className="up-sheet-title">
          <strong title={file.path}>{baseName(file.path)}</strong>
          <em>{[formatSize(file.size), dirName(file.path)].filter(Boolean).join(' · ')}</em>
        </span>
        {many && (
          <span className="up-sheet-nav">
            <button className="bp-btn" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous file" title="Previous (←)">
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
            <span>{index + 1} / {files.length}</span>
            <button className="bp-btn" onClick={() => onIndex(index + 1)} disabled={index === files.length - 1} aria-label="Next file" title="Next (→)">
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </span>
        )}
        <button className="up-link up-danger" onClick={() => onRemove(file.path)}>
          <FontAwesomeIcon icon={faTrashCan} /> Remove
        </button>
      </div>
      <div className="up-preview">
        {item ? (
          <Suspense fallback={<div className="up-preview-wait">Loading preview…</div>}>
            <PreviewPane key={file.path} item={item} markdownSource />
          </Suspense>
        ) : (
          <div className="up-preview-card">
            <Thumb path={file.path} className="is-large" />
            <span>No preview for this kind of file</span>
          </div>
        )}
        {!fits && <div className="up-warn">This site may not accept this kind of file.</div>}
      </div>
    </div>
  );
}

/**
 * The upload tile (a Browse tab with `special: 'upload'`).
 *
 * @param upload   the request: { request, label, url, multiple, extensions, mimeTypes }
 * @param active   this tile is the current tab (gets the keyboard)
 * @param visible  this tile is on screen
 * @param onClose  close the tile (BrowseView cancels the request if it's still open)
 */
export function UploadTab({ upload, active, visible, onClose, onOpenUrl, onOpenPath, onOpenShell, toolbarStart = null, toolbarEnd = null }) {
  const { request, multiple, url, extensions, mimeTypes } = upload;
  const [shelfItems, setShelfItems] = useState([]);
  const [startDir, setStartDir] = useState(() => readLocal(LAST_DIR_KEY) || '');
  const [selected, setSelected] = useState([]); // [{ path, size }]
  const [review, setReview] = useState(null);   // path open in the preview sheet, or null
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const accepts = useMemo(() => acceptTest(extensions, mimeTypes), [extensions, mimeTypes]);
  const kinds = acceptLabel(extensions, mimeTypes);
  const host = hostOf(url);
  const picked = useMemo(() => new Set(selected.map(f => f.path)), [selected]);

  // A new request from the same page starts a fresh selection.
  useEffect(() => { setSelected([]); setReview(null); setError(null); setSending(false); }, [request]);

  useEffect(() => {
    invoke('shelf_list')
      .then(list => setShelfItems(Array.isArray(list) ? list.slice(0, SHELF_STRIP_MAX) : []))
      .catch(() => setShelfItems([]));
  }, []);

  // No remembered folder: start in Downloads (else Home).
  useEffect(() => {
    if (startDir) return;
    invoke('get_user_places')
      .then(list => {
        const by = (n) => list?.find(p => p.name === n)?.path;
        setStartDir(by('Downloads') || by('Home') || '');
      })
      .catch(() => { });
  }, [startDir]);

  // Picking only adds to (or takes from) the selection; it never opens the
  // preview, so you can keep browsing for more.
  const toggle = useCallback((file) => {
    setError(null);
    if (selected.some(f => f.path === file.path)) setSelected(selected.filter(f => f.path !== file.path));
    else setSelected(multiple ? [...selected, file] : [file]);
  }, [selected, multiple]);

  // Removing the file under review moves the preview to its neighbour (or
  // closes it with nothing left).
  const remove = useCallback((path) => {
    const i = selected.findIndex(f => f.path === path);
    const rest = selected.filter(f => f.path !== path);
    setSelected(rest);
    if (review === path) setReview(rest[Math.min(i, rest.length - 1)]?.path || null);
  }, [selected, review]);

  // The tile closes itself once Rust reports the request done
  // (browser-pane-file-done, handled in BrowseView).
  const send = useCallback(async () => {
    if (!selected.length) return;
    setError(null);
    setSending(true);
    try {
      const paths = selected.map(f => f.path);
      await invoke('browser_pane_file_choose', { request, paths });
      writeLocal(LAST_DIR_KEY, dirName(paths[paths.length - 1]));
    } catch (err) {
      setError(String(err));
      setSending(false);
    }
  }, [request, selected]);

  const useSystem = useCallback(() => {
    invoke('browser_pane_file_system', { request }).catch(() => onClose());
  }, [request, onClose]);

  const count = selected.length;
  const reviewIndex = review ? selected.findIndex(f => f.path === review) : -1;

  // Preview keys while it's open in the current tile: Esc back, ←/→ step.
  useEffect(() => {
    if (!active || reviewIndex < 0) return undefined;
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') setReview(null);
      else if (e.key === 'ArrowLeft' && reviewIndex > 0) setReview(selected[reviewIndex - 1].path);
      else if (e.key === 'ArrowRight' && reviewIndex < selected.length - 1) setReview(selected[reviewIndex + 1].path);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, reviewIndex, selected]);
  const total = selected.reduce((n, f) => n + (f.size || 0), 0);
  const sub = [kinds && `accepts ${kinds}`, multiple ? 'several files OK' : 'one file'].filter(Boolean).join(' · ');

  return (
    <div className="bp-root ft-root up-tab">
      <div className="bp-toolbar">
        {toolbarStart}
        <TabAddressBar
          icon={<FontAwesomeIcon icon={faArrowUpFromBracket} className="ft-address-icon" />}
          label={host ? `Upload to ${host}` : 'Upload'}
          sub={sub}
          title="Pick files for the page's upload, or just close this"
          onOpenUrl={onOpenUrl}
          onOpenPath={onOpenPath}
          onOpenShell={onOpenShell}
        />
        {toolbarEnd}
      </div>

      <div className="up-main">
        {shelfItems.length > 0 && (
          <ShelfStrip items={shelfItems} picked={picked} onToggle={toggle} accepts={accepts} />
        )}
        {reviewIndex >= 0 && (
          <ReviewSheet
            files={selected}
            index={reviewIndex}
            accepts={accepts}
            onIndex={(i) => setReview(selected[i]?.path || null)}
            onRemove={remove}
            onClose={() => setReview(null)}
          />
        )}
        <section className="up-files" aria-label="Files on this Mac">
          {startDir && (
            <FileManager
              embedded
              compact
              isOpen={visible}
              keyboard={active}
              initialPath={startDir}
              onOpenFile={(path, entry) => toggle({ path, size: entry?.size })}
              picked={picked}
              projectBar={false}
              placesRow
              quickLook={false}
            />
          )}
        </section>
      </div>

      <section className={`up-tray ${count ? 'has-files' : ''}`} aria-label="Selected files">
        {count > 0 && (
          <div className="up-picks">
            <div className="up-section-head">
              <span>{count === 1 ? '1 selected' : `${count} selected`}</span>
              {total > 0 && <em>{formatSize(total)}</em>}
            </div>
            <div className="up-pick-strip">
              {selected.map(f => (
                <div key={f.path} className={`up-pick ${f.path === review ? 'is-open' : ''} ${!accepts || accepts(f.path) ? '' : 'is-off'}`}>
                  <button
                    className="up-pick-open"
                    onClick={() => setReview(f.path === review ? null : f.path)}
                    title={`${baseName(f.path)}${f.size != null ? ` · ${formatSize(f.size)}` : ''}\nClick to preview`}
                    aria-label={`Preview ${baseName(f.path)}`}
                  >
                    <Thumb path={f.path} />
                    <span className="up-pick-eye"><FontAwesomeIcon icon={faEye} /></span>
                  </button>
                  <button className="up-pick-x" onClick={() => remove(f.path)} aria-label={`Remove ${baseName(f.path)}`} title="Remove">
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="up-actions">
          <span className={`up-hint ${error ? 'is-error' : ''}`}>
            {error || (count ? (multiple ? 'Keep browsing to add more · click a thumbnail to preview' : 'Click the thumbnail to preview it') : multiple ? 'Click files to select them — pick as many as you like' : 'Click a file to select it')}
          </span>
          <button className="up-link" onClick={useSystem} title="Use the macOS file panel instead">
            <FontAwesomeIcon icon={faFolderOpen} /> Use Finder
          </button>
          <button className="browse-chip up-btn" onClick={onClose}>Cancel</button>
          <button className="browse-chip up-btn up-go" disabled={!count || sending} onClick={send}>
            <FontAwesomeIcon icon={faArrowUpFromBracket} />
            {sending ? 'Uploading…' : count > 1 ? `Upload ${count} files` : 'Upload'}
          </button>
        </div>
      </section>
    </div>
  );
}
