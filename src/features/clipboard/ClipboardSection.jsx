import { faCheck, faChevronLeft, faCopy, faXmark, faCode, faChevronDown, faChevronRight, faClipboard, faEye, faEyeSlash, faFile, faFileLines, faImage, faLink, faPalette, faPause, faPlay, faThumbtack, faTrashCan, faBoxArchive } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { IS_TAURI, startNativeDrag } from '../../utils/nativeDrag.js';
import { clipFileUrl, fullClipText, useClipboardHistory, useClipboardStatus } from './useClipboardHistory';
import './clipboard.css';
import { t, useT } from '../../shared/i18n';

// Clipboard history in the side dock, between the workspaces and the
// folders. Three recent clips by default ("Show all" lists the rest with a
// filter); click copies, the eye previews inline, and a row drags out — text
// as text, images and copied files as real files — into other apps, the
// in-app browser, or (links) onto a workspace card to add it there.
// Renders nothing until history is turned on in Settings.

const COLLAPSED_KEY = 'cooldesk.clipboard.collapsed';
const PEEK = 3;
const GRID_PEEK = 6;
const CLIP_TYPE = 'application/x-cooldesk-clip';
const LINK_TYPE = 'application/x-cooldesk-link';
const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

// The link being dragged out of the card, for the Windows drop fallback in
// useLinkDropOnWorkspaces (a dragend can't read the drag's data).
let draggingLink = null;

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return t('cb.now');
  if (s < 3600) return t('cb.m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('cb.h', { n: Math.floor(s / 3600) });
  return t('cb.d', { n: Math.floor(s / 86400) });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

function linkParts(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ''), rest: `${u.pathname}${u.search}`.replace(/^\/$/, '') };
  } catch { return { host: url, rest: '' }; }
}

/** One-line label for a row, shaped per kind so a mixed list scans by type:
 *  the clip's own content first, never a generic "Image 604×338". */
function RowTitle({ clip }) {
  switch (clip.kind) {
    case 'image': return clip.source || t('cb.cat.image');
    case 'files': {
      const files = clip.files || [];
      return files.length > 1
        ? <>{baseName(files[0])} <span className="cb-title-dim">+{files.length - 1}</span></>
        : baseName(files[0]);
    }
    case 'link': {
      const { host, rest } = linkParts(clip.text.trim());
      return <>{host}{rest && <span className="cb-title-dim">{rest}</span>}</>;
    }
    case 'color': return (clip.text || '').trim().toUpperCase();
    default:
      return (clip.text || '').trim().split('\n').find(l => l.trim()) || '';
  }
}

/** Second line: what the title doesn't already say. */
function rowMeta(clip) {
  switch (clip.kind) {
    case 'image': return [`${clip.width} × ${clip.height}`, clip.size ? formatSize(clip.size) : null];
    case 'files': return [clip.files?.[0] ? baseName(String(clip.files[0]).replace(/[\\/]+[^\\/]*[\\/]*$/, '')) : null, clip.source];
    default: return [clip.source];
  }
}

/** Same look as the side dock's other section titles (TabManagement's
 *  SectionHeader, which is private to that face). */
function SectionHeader({ children }) {
  return (
    <h3 className="cb-title">
      {children}
    </h3>
  );
}

const KIND_ICON = { text: faFileLines, code: faCode, link: faLink, color: faPalette, image: faImage, files: faFile };

/** Category chips, in display order. */
const CATEGORIES = ['text', 'code', 'link', 'image', 'files', 'color'].map(kind => ({ kind }));

/** Display URL for an image clip's stored file (null until resolved). */
function useClipImage(clip) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (clip.kind !== 'image' || !clip.path) return undefined;
    let live = true;
    clipFileUrl(clip.path).then(u => live && setSrc(u)).catch(() => { });
    return () => { live = false; };
  }, [clip.kind, clip.path]);
  return src;
}

function Thumb({ clip }) {
  const src = useClipImage(clip);
  if (clip.kind === 'color') return <span className="cb-thumb cb-swatch" style={{ background: clip.text.trim() }} />;
  if (src) return <img className="cb-thumb cb-thumb-img" src={src} alt="" draggable={false} />;
  return <span className={`cb-thumb cb-thumb-${clip.kind}`}><FontAwesomeIcon icon={KIND_ICON[clip.kind] || faFileLines} /></span>;
}

function Preview({ clip }) {
  useT();
  const [text, setText] = useState(clip.long ? null : clip.text);
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    if (clip.long) fullClipText(clip.id).then(t => live && setText(t)).catch(() => live && setText(clip.text));
    if (clip.kind === 'image' && clip.path) clipFileUrl(clip.path).then(u => live && setSrc(u)).catch(() => { });
    return () => { live = false; };
  }, [clip]);

  if (clip.kind === 'image') {
    return (
      <div className="cb-preview">
        {src && <img className="cb-preview-img" src={src} alt="" draggable={false} />}
        <div className="cb-preview-meta">{clip.width}×{clip.height} · {formatSize(clip.size)}</div>
      </div>
    );
  }
  if (clip.kind === 'color') {
    return (
      <div className="cb-preview">
        <div className="cb-preview-swatch" style={{ background: clip.text.trim() }} />
        <div className="cb-preview-meta">{clip.text.trim()}</div>
      </div>
    );
  }
  if (clip.kind === 'files') {
    return (
      <div className="cb-preview">
        <ul className="cb-preview-files">
          {(clip.files || []).map(f => <li key={f} title={f}>{f}</li>)}
        </ul>
      </div>
    );
  }
  if (clip.kind === 'link') {
    return (
      <div className="cb-preview">
        <div className="cb-preview-link">{clip.text}</div>
        <button type="button" className="cb-preview-btn" onClick={() => workspaceActivityService.activate({ url: clip.text.trim() })}>
          {t('cb.open')}
        </button>
      </div>
    );
  }
  const lines = (text || '').split('\n').length;
  return (
    <div className="cb-preview">
      <pre className="cb-preview-text">{text ?? t('cb.loading')}</pre>
      <div className="cb-preview-meta">{t('cb.chars', { n: clip.size.toLocaleString() })} · {t(lines === 1 ? 'cb.lines1' : 'cb.linesN', { n: lines })}</div>
    </div>
  );
}

function IconBtn({ icon, label, onClick, active = false, danger = false }) {
  return (
    <button
      type="button"
      className={`cb-icon-btn${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`}
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}

/** Copy-on-click (with a brief "copied" state) and drag-out, shared by list
 *  rows and image tiles. */
function useClipActions(clip, history) {
  const [copied, setCopied] = useState(false);
  const fullText = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    history.copy(clip.id).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    }).catch(() => { });
  };

  // A drag has to be set up synchronously, so long text is fetched ahead
  // of time, on hover.
  const prefetch = () => {
    if (clip.long && fullText.current == null) fullClipText(clip.id).then(t => { fullText.current = t; }).catch(() => { });
  };

  const onDragStart = (e) => {
    if (clip.kind === 'image' && clip.path) return startNativeDrag(e, clip.path);
    if (clip.kind === 'files' && clip.files?.length) return startNativeDrag(e, clip.files);
    const text = (clip.long && fullText.current) || clip.text || '';
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData(CLIP_TYPE, clip.id);
    if (clip.kind === 'link') {
      e.dataTransfer.setData('text/uri-list', text.trim());
      e.dataTransfer.setData(LINK_TYPE, text.trim());
      draggingLink = text.trim();
    }
  };

  return { copied, copy, prefetch, onDragStart };
}

/** One image in the Images grid: the picture is the whole tile. */
function ImageTile({ clip, history, previewing, onTogglePreview }) {
  useT();
  const src = useClipImage(clip);
  const { copied, copy, onDragStart } = useClipActions(clip, history);
  return (
    <li
      className={`cb-tile${previewing ? ' is-previewing' : ''}${copied ? ' is-copied' : ''}`}
      role="button"
      tabIndex={0}
      draggable={IS_TAURI}
      onDragStart={onDragStart}
      onClick={copy}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // keys on the action buttons are theirs
        if (e.key === 'Enter') { e.preventDefault(); copy(); }
        if (e.key === ' ') { e.preventDefault(); onTogglePreview(); }
      }}
      title={[clip.source, `${clip.width} × ${clip.height}`, ago(clip.added)].filter(Boolean).join(' · ')}
    >
      {src
        ? <img className="cb-tile-img" src={src} alt="" draggable={false} />
        : <span className="cb-tile-img cb-tile-placeholder"><FontAwesomeIcon icon={faImage} /></span>}
      <span className="cb-tile-dims">{clip.width}×{clip.height}</span>
      {clip.pinned && <FontAwesomeIcon icon={faThumbtack} className="cb-tile-pin" />}
      <div className="cb-tile-actions">
        <IconBtn icon={previewing ? faEyeSlash : faEye} label={previewing ? t('cb.hidePreview') : t('cb.preview')} onClick={onTogglePreview} active={previewing} />
        <IconBtn icon={faThumbtack} label={clip.pinned ? t('cb.unpin') : t('cb.pin')} active={clip.pinned} onClick={() => history.pin(clip.id, !clip.pinned).catch(() => { })} />
        <IconBtn icon={faBoxArchive} label={t('cb.saveShelf')} onClick={() => history.saveToShelf(clip.id).catch(() => { })} />
        <IconBtn icon={faTrashCan} label={t('cb.delete')} danger onClick={() => history.remove(clip.id).catch(() => { })} />
      </div>
      {copied && (
        <span className="cb-tile-copied"><FontAwesomeIcon icon={faCheck} /> {t('cb.copied')}</span>
      )}
    </li>
  );
}

/** Full-window viewer for the Images grid, so the preview can't end up
 *  scrolled out of sight under a long grid. Esc / backdrop closes, ← → steps. */
function ImageLightbox({ clip, clips, history, onNavigate, onClose }) {
  useT();
  const src = useClipImage(clip);
  const { copied, copy } = useClipActions(clip, history);
  const index = clips.findIndex(c => c.id === clip.id);
  const prev = index > 0 ? clips[index - 1] : null;
  const next = index >= 0 && index < clips.length - 1 ? clips[index + 1] : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id);
      else if (e.key === 'ArrowRight' && next) onNavigate(next.id);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [prev, next, onNavigate, onClose]);

  const remove = () => {
    // Step to a neighbour first so the viewer stays open on the next image.
    const after = next || prev;
    history.remove(clip.id).catch(() => { });
    if (after) onNavigate(after.id); else onClose();
  };

  return createPortal(
    <div className="cb-lightbox" role="dialog" aria-modal="true" aria-label={t('cb.preview')} onClick={onClose}>
      <div className="cb-lightbox-panel" onClick={e => e.stopPropagation()}>
        <div className="cb-lightbox-bar">
          <span className="cb-lightbox-meta">
            {[clip.source, `${clip.width} × ${clip.height}`, formatSize(clip.size), ago(clip.added)].filter(Boolean).join(' · ')}
          </span>
          <span className="cb-lightbox-count">{index + 1} / {clips.length}</span>
          <IconBtn icon={faXmark} label={t('cb.close')} onClick={onClose} />
        </div>
        <div className="cb-lightbox-stage">
          {src && <img className="cb-lightbox-img" src={src} alt="" draggable={false} />}
          {prev && (
            <button type="button" className="cb-lightbox-nav is-prev" aria-label={t('cb.prevImage')} onClick={() => onNavigate(prev.id)}>
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
          )}
          {next && (
            <button type="button" className="cb-lightbox-nav is-next" aria-label={t('cb.nextImage')} onClick={() => onNavigate(next.id)}>
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          )}
        </div>
        <div className="cb-lightbox-actions">
          <button type="button" className={`cb-lightbox-copy${copied ? ' is-copied' : ''}`} onClick={copy}>
            <FontAwesomeIcon icon={copied ? faCheck : faCopy} /> {copied ? t('cb.copied') : t('cb.copy')}
          </button>
          <IconBtn icon={faThumbtack} label={clip.pinned ? t('cb.unpin') : t('cb.pin')} active={clip.pinned} onClick={() => history.pin(clip.id, !clip.pinned).catch(() => { })} />
          <IconBtn icon={faBoxArchive} label={t('cb.saveShelf')} onClick={() => history.saveToShelf(clip.id).catch(() => { })} />
          <IconBtn icon={faTrashCan} label={t('cb.delete')} danger onClick={remove} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ClipRow({ clip, history, previewing, onTogglePreview }) {
  useT();
  const { copied, copy, prefetch, onDragStart } = useClipActions(clip, history);

  const meta = rowMeta(clip).filter(Boolean).join(' · ');
  return (
    <li className={`cb-row${previewing ? ' is-previewing' : ''}`}>
      <div
        className={`cb-row-main cb-kind-${clip.kind}`}
        role="button"
        tabIndex={0}
        draggable={IS_TAURI}
        onDragStart={onDragStart}
        onMouseEnter={prefetch}
        onClick={copy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); copy(); }
          if (e.key === ' ') { e.preventDefault(); onTogglePreview(); }
        }}
        title={t('cb.rowTitle')}
      >
        <Thumb clip={clip} />
        <div className="cb-row-text">
          <div className={`cb-row-title${copied ? ' is-copied' : ''}`}>{copied ? t('cb.copied') : <RowTitle clip={clip} />}</div>
          {meta && <div className="cb-row-meta">{meta}</div>}
        </div>
        {!copied && !clip.pinned && <span className="cb-row-time">{ago(clip.added)}</span>}
        {copied
          ? <FontAwesomeIcon icon={faCheck} className="cb-copied" />
          : (
            <div className="cb-row-actions">
              <IconBtn icon={previewing ? faEyeSlash : faEye} label={previewing ? t('cb.hidePreview') : t('cb.preview')} onClick={onTogglePreview} active={previewing} />
              <IconBtn icon={faThumbtack} label={clip.pinned ? t('cb.unpin') : t('cb.pin')} active={clip.pinned} onClick={() => history.pin(clip.id, !clip.pinned).catch(() => { })} />
              {(clip.kind === 'image' || clip.kind === 'files') && (
                <IconBtn icon={faBoxArchive} label={t('cb.saveShelf')} onClick={() => history.saveToShelf(clip.id).catch(() => { })} />
              )}
              <IconBtn icon={faTrashCan} label={t('cb.delete')} danger onClick={() => history.remove(clip.id).catch(() => { })} />
            </div>
          )}
        {clip.pinned && !copied && <FontAwesomeIcon icon={faThumbtack} className="cb-pin-mark" />}
      </div>
      {previewing && <Preview clip={clip} />}
    </li>
  );
}

async function addLinkToWorkspace(workspaceId, url, onToast) {
  try {
    const { getWorkspace, saveWorkspace } = await import('../../db/index.js');
    const res = await getWorkspace(workspaceId);
    const ws = res?.success ? res.data : res;
    if (!ws?.id) throw new Error('workspace not found');
    if ((ws.urls || []).some(u => u.url === url)) {
      onToast(t('cb.already', { name: ws.name }), 'info');
      return;
    }
    const { host } = linkParts(url);
    await saveWorkspace({
      ...ws,
      urls: [...(ws.urls || []), { url, title: host, addedAt: Date.now() }],
      updatedAt: Date.now(),
    });
    onToast(t('cb.added', { host, name: ws.name }));
  } catch (err) {
    console.error('[Clipboard] add link to workspace failed:', err);
    onToast(t('cb.addFailed'), 'error');
  }
}

/**
 * Links dragged from the card onto a workspace card (anything with
 * `data-workspace-id`) are added to that workspace's URLs. OS file drags are
 * handled separately by WorkspaceFileDrop.
 *
 * Windows: the window's drop target is Tauri's, which only takes file drags,
 * so the page never sees dragover/drop for a link. There the drop is read
 * off the drag's own dragend instead — refused (dropEffect "none") and
 * released over a workspace card means it was dropped on that card. No hover
 * highlight on Windows, just the toast.
 */
function useLinkDropOnWorkspaces(onToast) {
  useEffect(() => {
    let hover = null;
    const setHover = (el) => {
      if (hover === el) return;
      hover?.classList.remove('is-file-drop-target');
      hover = el;
      el?.classList.add('is-file-drop-target');
    };
    const targetOf = (e) => (e.dataTransfer?.types?.includes(LINK_TYPE) ? e.target?.closest?.('[data-workspace-id]') : null);

    const onOver = (e) => {
      const target = targetOf(e);
      setHover(target);
      if (target) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    };
    const onDrop = async (e) => {
      const target = targetOf(e);
      setHover(null);
      if (!target) return;
      e.preventDefault();
      draggingLink = null;
      await addLinkToWorkspace(target.dataset.workspaceId, e.dataTransfer.getData(LINK_TYPE), onToast);
    };
    const onEnd = (e) => {
      setHover(null);
      const url = draggingLink;
      draggingLink = null;
      if (!IS_WINDOWS || !url || e.dataTransfer?.dropEffect !== 'none') return;
      const { clientX: x, clientY: y } = e;
      if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) return;
      const target = document.elementFromPoint(x, y)?.closest?.('[data-workspace-id]');
      if (target) addLinkToWorkspace(target.dataset.workspaceId, url, onToast);
    };

    document.addEventListener('dragover', onOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', onEnd);
    return () => {
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', onEnd);
      setHover(null);
    };
  }, [onToast]);
}

export function ClipboardSection() {
  useT();
  const { status, setPaused } = useClipboardStatus();
  const enabled = !!status?.enabled;
  const history = useClipboardHistory({ active: enabled });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState(null); // null = all
  const [previewId, setPreviewId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((text, kind = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useLinkDropOnWorkspaces(showToast);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      try { localStorage.setItem(COLLAPSED_KEY, String(!c)); } catch { /* ignore */ }
      return !c;
    });
  };

  // Pinned first, then newest.
  const ordered = useMemo(() => {
    const items = history.items;
    return [...items.filter(c => c.pinned), ...items.filter(c => !c.pinned)];
  }, [history.items]);

  const counts = useMemo(() => {
    const n = {};
    for (const c of ordered) n[c.kind] = (n[c.kind] || 0) + 1;
    return n;
  }, [ordered]);
  const chips = CATEGORIES.filter(c => counts[c.kind]);

  // Chips sit on one scrollable line: map a plain vertical mouse wheel to a
  // horizontal scroll while the strip overflows (trackpads already scroll it).
  const chipsRef = useCallback(el => {
    if (!el) return;
    el.addEventListener('wheel', e => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }, { passive: false });
  }, []);
  // A category that's emptied out (last clip deleted) falls back to All.
  const activeCategory = category && counts[category] ? category : null;
  // Images get a grid of thumbnails instead of rows; two rows of it in the peek.
  const grid = activeCategory === 'image';
  const peek = grid ? GRID_PEEK : PEEK;

  const visible = useMemo(() => {
    const inCategory = activeCategory ? ordered.filter(c => c.kind === activeCategory) : ordered;
    if (!showAll) return inCategory.slice(0, peek);
    const q = filter.trim().toLowerCase();
    if (!q) return inCategory;
    return inCategory.filter(c => [c.text, c.source, ...(c.files || [])].some(v => v && v.toLowerCase().includes(q)));
  }, [ordered, activeCategory, showAll, filter, peek]);
  const shownTotal = activeCategory ? counts[activeCategory] : ordered.length;

  if (!IS_TAURI || !enabled) return null;

  return (
    <section className="home-stack-clipboard cb-section">
      <div className="cb-header">
        {/* Not a <button>: the title is an <h3>, which can't sit inside one. */}
        <div
          className="cb-header-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(); } }}
        >
          <SectionHeader>
            {t('cb.title')}{history.items.length ? ` (${history.items.length})` : ''}
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} className="cb-chevron" />
          </SectionHeader>
        </div>
        <div className="cb-header-actions">
          {status.paused && <span className="cb-paused-label">{t('cb.paused')}</span>}
          <IconBtn
            icon={status.paused ? faPlay : faPause}
            label={status.paused ? t('cb.resume') : t('cb.pause')}
            active={status.paused}
            onClick={() => setPaused(!status.paused).catch(() => { })}
          />
        </div>
      </div>

      {!collapsed && (
        <div className="cb-card">
          {showAll && (
            <input
              className="cb-filter"
              type="search"
              placeholder={t('cb.filter')}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              autoFocus
            />
          )}
          {chips.length > 1 && (
            <div ref={chipsRef} className="cb-chips" role="tablist" aria-label={t('cb.categories')}>
              <button
                type="button"
                role="tab"
                aria-selected={!activeCategory}
                className={`cb-chip${!activeCategory ? ' is-active' : ''}`}
                onClick={() => setCategory(null)}
              >
                {t('cb.all')}
              </button>
              {chips.map(c => (
                <button
                  key={c.kind}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === c.kind}
                  className={`cb-chip${activeCategory === c.kind ? ' is-active' : ''}`}
                  onClick={e => {
                    e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                    setCategory(k => (k === c.kind ? null : c.kind));
                  }}
                >
                  <FontAwesomeIcon icon={KIND_ICON[c.kind]} />
                  {t(`cb.cat.${c.kind}`)}
                  <span className="cb-chip-count">{counts[c.kind]}</span>
                </button>
              ))}
            </div>
          )}
          {visible.length && grid ? (
            <>
              <ul className={`cb-grid${showAll ? ' is-all' : ''}`}>
                {visible.map(clip => (
                  <ImageTile
                    key={clip.id}
                    clip={clip}
                    history={history}
                    previewing={previewId === clip.id}
                    onTogglePreview={() => setPreviewId(id => (id === clip.id ? null : clip.id))}
                  />
                ))}
              </ul>
              {visible.some(c => c.id === previewId) && (
                <ImageLightbox
                  clip={visible.find(c => c.id === previewId)}
                  clips={visible}
                  history={history}
                  onNavigate={setPreviewId}
                  onClose={() => setPreviewId(null)}
                />
              )}
            </>
          ) : visible.length ? (
            <ul className={`cb-list${showAll ? ' is-all' : ''}`}>
              {visible.map(clip => (
                <ClipRow
                  key={clip.id}
                  clip={clip}
                  history={history}
                  previewing={previewId === clip.id}
                  onTogglePreview={() => setPreviewId(id => (id === clip.id ? null : clip.id))}
                />
              ))}
            </ul>
          ) : (
            <div className="cb-empty">
              <span className="cb-empty-icon"><FontAwesomeIcon icon={faClipboard} /></span>
              {filter ? t('cb.noMatch') : t('cb.empty')}
            </div>
          )}
          {shownTotal > peek && (
            <div className="cb-footer">
              <button type="button" className="cb-link-btn" onClick={() => { setShowAll(s => !s); setFilter(''); }}>
                {showAll ? t('cb.showLess') : t('cb.showAll', { n: shownTotal })}
              </button>
              {showAll && (
                <button type="button" className="cb-link-btn is-danger" onClick={() => history.clear(false).catch(() => { })}>
                  {t('cb.clearUnpinned')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className={`workspace-drop-toast is-${toast.kind}`} role="status" aria-live="polite">{toast.text}</div>
      )}
    </section>
  );
}
