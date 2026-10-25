import { faArrowLeft, faArrowRight, faArrowUpRightFromSquare, faCheck, faCopy, faFolder, faFolderOpen, faLink, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useEffect, useState } from 'react';
import { RenderedPreview } from './RenderedPreview';
import { ARCHIVE_RE, AUDIO_RE, ArchiveView, AudioView, CsvView, JsonView } from './FileViewers';
import { FileManager } from '../../features/file-manager/FileManager';
import { getFileVisual } from '../../utils/fileIcons';
import { getPreviewItem } from '../../utils/filePreviewKind.js';
import { TabAddressBar } from './TabAddressBar';

// A Browse tab showing something from disk in the main area: a file at full
// size (the spotlight's PreviewPane — code, images, PDF, video) or a folder
// (the file manager, full width; opening a file in it opens a file tab).

const PreviewPane = lazy(() => import('../../features/spotlight/PreviewPane'));

const baseName = (p) => p.split(/[/\\]/).filter(Boolean).pop() || p;
const parentDir = (p) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
};

// Files with a rendered view next to their source: the bar on top switches.
// name: the bar's label; alt: the second view's name; start: the view a
// file opens in until you pick one (remembered per kind).
const VIEWS = {
  markdown: { name: 'Markdown', alt: 'Preview', start: 'source' },
  html: { name: 'HTML', alt: 'Preview', start: 'source' },
  json: { name: 'JSON', alt: 'Formatted', start: 'preview' },
  csv: { name: 'CSV', alt: 'Table', start: 'preview' },
};
const RENDERABLE = { md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', json: 'json', csv: 'csv', tsv: 'csv' };
const VIEW_KEY = (kind) => `cooldesk.browse.view.${kind}`;
function storedView(kind) {
  try {
    const v = localStorage.getItem(VIEW_KEY(kind));
    return v === 'preview' || v === 'source' ? v : VIEWS[kind].start;
  } catch { return VIEWS[kind].start; }
}

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

function CopyButton({ icon, label, run }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`bp-btn ${done ? 'on' : ''}`}
      title={label}
      onClick={async () => {
        try {
          await run();
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch (err) {
          console.warn(`[FileTab] ${label} failed:`, err);
        }
      }}
    >
      <FontAwesomeIcon icon={done ? faCheck : icon} />
    </button>
  );
}

export function FileIcon({ path, isDir, className = '' }) {
  if (isDir) return <FontAwesomeIcon icon={faFolder} className={className} style={{ color: '#fbbf24' }} />;
  const v = getFileVisual(baseName(path));
  return v.kind === 'si'
    ? <v.Icon className={className} style={{ color: v.color }} />
    : <FontAwesomeIcon icon={v.Icon} className={className} style={{ color: v.color }} />;
}

/**
 * @param file        { path, isDir }
 * @param active      this tab is on screen
 * @param onOpenFile  (path) → open a file from the folder view as a tab
 * @param onShowInFiles(path) → reveal in the side panel's Files tab
 * @param onOpenTerminal(dir) → a terminal tab in this folder (or the file's)
 * @param onBack / onForward  the tab's history (null when there's nowhere to go)
 * @param onOpenUrl   (url) → a web link clicked in a Markdown / HTML preview
 * @param onShowFolder (dir) → a folder in the Files panel (after Extract)
 */
export function FileTab({ file, active, onOpenFile, onOpenUrl, onShowFolder, onBack, onForward, onShowInFiles, onOpenTerminal, toolbarStart = null, toolbarEnd = null }) {
  const preview = file.isDir ? null : getPreviewItem(file.path);
  const isText = preview?.previewKind === 'code';
  const renderKind = file.isDir ? null : RENDERABLE[(file.path.split('.').pop() || '').toLowerCase()] || null;
  const [view, setViewState] = useState(() => (renderKind ? storedView(renderKind) : 'source'));
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY(renderKind), v); } catch { /* per session then */ }
  };
  // Back / Forward can swap a .md for an .html in the same tab.
  useEffect(() => {
    if (renderKind) setViewState(storedView(renderKind));
  }, [renderKind]);

  return (
    <div className="bp-root ft-root">
      <div className="bp-toolbar">
        {toolbarStart}
        <div className="bp-capsule">
          <button className="bp-btn" onClick={() => onBack?.()} disabled={!onBack} title="Back (⌘[)">
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <button className="bp-btn" onClick={() => onForward?.()} disabled={!onForward} title="Forward (⌘])">
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </div>
        <TabAddressBar
          icon={<FileIcon path={file.path} isDir={file.isDir} className="ft-address-icon" />}
          label={baseName(file.path)}
          sub={parentDir(file.path)}
          title={file.path}
          onOpenUrl={onOpenUrl}
          onOpenPath={(path, isDir) => (isDir ? onShowFolder?.(path) : onOpenFile?.(path))}
          onOpenShell={onOpenTerminal}
        />
        <div className="bp-capsule">
          {isText && (
            <CopyButton
              icon={faCopy}
              label="Copy contents"
              run={async () => {
                const { content } = await invoke('preview_text_file', { path: file.path });
                await navigator.clipboard.writeText(content);
              }}
            />
          )}
          <CopyButton icon={faLink} label="Copy path" run={() => navigator.clipboard.writeText(file.path)} />
          {onOpenTerminal && (
            <button className="bp-btn" onClick={() => onOpenTerminal(file.isDir ? file.path : parentDir(file.path))} title="Open a shell here">
              <FontAwesomeIcon icon={faTerminal} />
            </button>
          )}
          {onShowInFiles && (
            <button className="bp-btn" onClick={() => onShowInFiles(file.path)} title="Show in the Files panel">
              <FontAwesomeIcon icon={faFolderOpen} />
            </button>
          )}
          <button className="bp-btn" onClick={() => invoke('open_folder', { path: file.path }).catch(() => { })} title="Open with default app">
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
        </div>
        {toolbarEnd}
      </div>
      {renderKind && (
        <div className="ft-viewbar">
          <span className="ft-viewbar-label">
            {VIEWS[renderKind].name}
            {view === 'preview' && renderKind === 'html' && <span className="ft-viewbar-note"> · scripts don’t run in the preview</span>}
          </span>
          <div className="bp-capsule bp-modes" role="tablist" aria-label="View">
            <button className={`bp-btn ${view === 'source' ? 'on' : ''}`} role="tab" aria-selected={view === 'source'} onClick={() => setView('source')}>
              Source
            </button>
            <button className={`bp-btn ${view === 'preview' ? 'on' : ''}`} role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>
              {VIEWS[renderKind].alt}
            </button>
          </div>
        </div>
      )}
      <div className="ft-body">
        {renderKind && view === 'preview' ? (
          renderKind === 'json' ? <JsonView key={file.path} path={file.path} />
            : renderKind === 'csv' ? <CsvView key={file.path} path={file.path} />
              : <RenderedPreview key={file.path} path={file.path} kind={renderKind} onOpenUrl={onOpenUrl} onOpenPath={onOpenFile} />
        ) : !file.isDir && ARCHIVE_RE.test(file.path) ? (
          <ArchiveView key={file.path} path={file.path} onOpenFile={onOpenFile} onShowFolder={onShowFolder} />
        ) : !file.isDir && AUDIO_RE.test(file.path) ? (
          <AudioView key={file.path} path={file.path} />
        ) : file.isDir ? (
          <FileManager embedded isOpen={active} initialPath={file.path} onOpenFile={onOpenFile} />
        ) : preview ? (
          <Suspense fallback={<div className="bp-empty">Opening…</div>}>
            <PreviewPane key={file.path} item={preview} />
          </Suspense>
        ) : (
          <div className="fv-nopreview">
            <FileIcon path={file.path} className="ft-icon" />
            <strong>{baseName(file.path)}</strong>
            <span>CoolDesk can’t show this kind of file here.</span>
            <div className="fv-actions">
              <button className="browse-chip" onClick={() => invoke('open_folder', { path: file.path }).catch(() => { })}>
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} /> Open with default app
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
