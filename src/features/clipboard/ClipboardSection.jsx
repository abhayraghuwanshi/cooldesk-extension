import { faCheck, faChevronDown, faChevronRight, faClipboard, faEye, faEyeSlash, faFile, faFileLines, faImage, faLink, faPalette, faPause, faPlay, faThumbtack, faTrashCan, faBoxArchive } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { IS_TAURI, startNativeDrag } from '../../utils/nativeDrag.js';
import { clipFileUrl, fullClipText, useClipboardHistory, useClipboardStatus } from './useClipboardHistory';
import './clipboard.css';

// Clipboard history in the side dock, between the workspaces and the
// folders. Three recent clips by default ("Show all" lists the rest with a
// filter); click copies, the eye previews inline, and a row drags out — text
// as text, images and copied files as real files — into other apps, the
// in-app browser, or (links) onto a workspace card to add it there.
// Renders nothing until history is turned on in Settings.

const COLLAPSED_KEY = 'cooldesk.clipboard.collapsed';
const PEEK = 3;
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
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
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

/** One-line label for a row. */
function titleOf(clip) {
  switch (clip.kind) {
    case 'image': return `Image ${clip.width}×${clip.height}`;
    case 'files': {
      const files = clip.files || [];
      return files.length > 1 ? `${baseName(files[0])} +${files.length - 1}` : baseName(files[0]);
    }
    case 'link': {
      const { host, rest } = linkParts(clip.text);
      return `${host}${rest}`;
    }
    default:
      return (clip.text || '').trim().split('\n').find(l => l.trim()) || '';
  }
}

/** Same look as the side dock's other section titles (TabManagement's
 *  SectionHeader, which is private to that face). */
function SectionHeader({ icon, children }) {
  return (
    <h3 className="cb-title">
      <FontAwesomeIcon icon={icon} style={{ opacity: 0.6 }} />
      {children}
    </h3>
  );
}

const KIND_ICON = { text: faFileLines, link: faLink, color: faPalette, image: faImage, files: faFile };

function Thumb({ clip }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (clip.kind !== 'image' || !clip.path) return undefined;
    let live = true;
    clipFileUrl(clip.path).then(u => live && setSrc(u)).catch(() => { });
    return () => { live = false; };
  }, [clip.kind, clip.path]);
  if (clip.kind === 'color') return <span className="cb-thumb cb-swatch" style={{ background: clip.text.trim() }} />;
  if (src) return <img className="cb-thumb cb-thumb-img" src={src} alt="" draggable={false} />;
  return <span className={`cb-thumb cb-thumb-${clip.kind}`}><FontAwesomeIcon icon={KIND_ICON[clip.kind] || faFileLines} /></span>;
}

function Preview({ clip }) {
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
          Open
        </button>
      </div>
    );
  }
  const lines = (text || '').split('\n').length;
  return (
    <div className="cb-preview">
      <pre className="cb-preview-text">{text ?? 'Loading…'}</pre>
      <div className="cb-preview-meta">{clip.size.toLocaleString()} chars · {lines} line{lines === 1 ? '' : 's'}</div>
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

function ClipRow({ clip, history, previewing, onTogglePreview }) {
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

  const meta = [clip.source, ago(clip.added)].filter(Boolean).join(' · ');
  return (
    <li className={`cb-row${previewing ? ' is-previewing' : ''}`}>
      <div
        className="cb-row-main"
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
        title="Click to copy · drag to drop it somewhere"
      >
        <Thumb clip={clip} />
        <div className="cb-row-text">
          <div className="cb-row-title">{copied ? 'Copied' : titleOf(clip)}</div>
          <div className="cb-row-meta">{meta}</div>
        </div>
        {copied
          ? <FontAwesomeIcon icon={faCheck} className="cb-copied" />
          : (
            <div className="cb-row-actions">
              <IconBtn icon={previewing ? faEyeSlash : faEye} label={previewing ? 'Hide preview' : 'Preview'} onClick={onTogglePreview} active={previewing} />
              <IconBtn icon={faThumbtack} label={clip.pinned ? 'Unpin' : 'Pin'} active={clip.pinned} onClick={() => history.pin(clip.id, !clip.pinned).catch(() => { })} />
              {(clip.kind === 'image' || clip.kind === 'files') && (
                <IconBtn icon={faBoxArchive} label="Save to Shelf" onClick={() => history.saveToShelf(clip.id).catch(() => { })} />
              )}
              <IconBtn icon={faTrashCan} label="Delete" danger onClick={() => history.remove(clip.id).catch(() => { })} />
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
      onToast(`Already in “${ws.name}”`, 'info');
      return;
    }
    const { host } = linkParts(url);
    await saveWorkspace({
      ...ws,
      urls: [...(ws.urls || []), { url, title: host, addedAt: Date.now() }],
      updatedAt: Date.now(),
    });
    onToast(`Added ${host} to “${ws.name}”`);
  } catch (err) {
    console.error('[Clipboard] add link to workspace failed:', err);
    onToast('Couldn’t add to workspace — see console', 'error');
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
  const { status, setPaused } = useClipboardStatus();
  const enabled = !!status?.enabled;
  const history = useClipboardHistory({ active: enabled });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
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

  const visible = useMemo(() => {
    if (!showAll) return ordered.slice(0, PEEK);
    const q = filter.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(c => [c.text, c.source, ...(c.files || [])].some(v => v && v.toLowerCase().includes(q)));
  }, [ordered, showAll, filter]);

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
          <SectionHeader icon={faClipboard}>
            Clipboard{history.items.length ? ` (${history.items.length})` : ''}
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} className="cb-chevron" />
          </SectionHeader>
        </div>
        <div className="cb-header-actions">
          {status.paused && <span className="cb-paused-label">Paused</span>}
          <IconBtn
            icon={status.paused ? faPlay : faPause}
            label={status.paused ? 'Resume recording copies' : 'Pause recording copies'}
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
              placeholder="Filter clips…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              autoFocus
            />
          )}
          {visible.length ? (
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
            <div className="cb-empty">{filter ? 'No matching clips' : 'Copy something — it shows up here.'}</div>
          )}
          {ordered.length > PEEK && (
            <div className="cb-footer">
              <button type="button" className="cb-link-btn" onClick={() => { setShowAll(s => !s); setFilter(''); }}>
                {showAll ? 'Show less' : `Show all (${ordered.length})`}
              </button>
              {showAll && (
                <button type="button" className="cb-link-btn is-danger" onClick={() => history.clear(false).catch(() => { })}>
                  Clear unpinned
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
