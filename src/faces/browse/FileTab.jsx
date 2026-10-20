import { faArrowUpRightFromSquare, faCheck, faCopy, faFolder, faFolderOpen, faLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useState } from 'react';
import { FileManager } from '../../features/file-manager/FileManager';
import { getFileVisual } from '../../utils/fileIcons';
import { getPreviewItem } from '../../utils/filePreviewKind.js';

// A Browse tab showing something from disk in the main area: a file at full
// size (the spotlight's PreviewPane — code, images, PDF, video) or a folder
// (the file manager, full width; opening a file in it opens a file tab).

const PreviewPane = lazy(() => import('../../features/spotlight/PreviewPane'));

const baseName = (p) => p.split(/[/\\]/).filter(Boolean).pop() || p;
const parentDir = (p) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
};

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
 */
export function FileTab({ file, active, onOpenFile, onShowInFiles, toolbarStart = null, toolbarEnd = null }) {
  const preview = file.isDir ? null : getPreviewItem(file.path);
  const isText = preview?.previewKind === 'code';

  return (
    <div className="bp-root ft-root">
      <div className="bp-toolbar">
        {toolbarStart}
        <div className="bp-address ft-address" title={file.path}>
          <FileIcon path={file.path} isDir={file.isDir} className="ft-address-icon" />
          <span className="bp-host">{baseName(file.path)}</span>
          <span className="bp-path ft-dir">{parentDir(file.path)}</span>
        </div>
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
      <div className="ft-body">
        {file.isDir ? (
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
