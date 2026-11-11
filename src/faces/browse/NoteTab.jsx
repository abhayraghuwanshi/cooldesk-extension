import { faFloppyDisk, faLayerGroup, faNoteSticky, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { deleteNote, listWorkspaceNotes, saveWorkspaceNote } from '../../db/index.js';
import { TabAddressBar } from './TabAddressBar';
import { ToolbarMenu } from './ToolbarMenu';
import { SCRATCH_KEY } from './useBrowseTabs';

// A Browse tab holding one workspace note in the main area, the way a file
// tab holds a file: title + TipTap editor at full size, autosaved. Opened
// from the workspace's Notes list (WorkspaceContextPanel → onOpenNote); a new
// note arrives as just an id and is saved once it has a title or text.
// A scratch note (`workspaceId: null`, the Tabs "New note" button) is a
// notepad: it autosaves with the tab (localStorage) until you pick a
// workspace under Save, which turns it into that workspace's note.

// Heavy (a dozen @tiptap extensions) — same lazy chunk as the notes panel.
const TiptapEditor = lazy(() => import('../workspace/parts/editor/TiptapEditor'));

const SAVE_DELAY = 800;

const hasText = (html) => !!(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
// Older notes are plain text; the editor wants HTML.
const toEditorContent = (text) => {
  if (!text) return '';
  return /<[a-z][^>]*>/i.test(text) ? text : `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;
};
// Lists showing this workspace's notes reload on this (WorkspaceContextPanel).
const announce = (workspaceId) =>
  window.dispatchEvent(new CustomEvent('cooldesk-notes-changed', { detail: { workspaceId } }));

const readScratch = (id) => {
  try { return JSON.parse(localStorage.getItem(SCRATCH_KEY(id)) || 'null') || {}; } catch { return {}; }
};
const writeScratch = (id, title, text) => {
  try { localStorage.setItem(SCRATCH_KEY(id), JSON.stringify({ title, text })); } catch { /* keep in memory */ }
};
const dropScratch = (id) => {
  try { localStorage.removeItem(SCRATCH_KEY(id)); } catch { /* ignore */ }
};

/**
 * @param note     { id, workspaceId, workspaceName } from the tab
 * @param onTitle  the tab's title follows the note's
 * @param onClose  close the tab (after Delete)
 * @param workspaces       scratch notes: where Save can put it
 * @param activeWorkspaceId listed first under Save
 * @param onSaveToWorkspace (ws) — the scratch note now lives in `ws`
 */
export function NoteTab({ note, onTitle, onClose, onOpenUrl, onOpenPath, onOpenShell, workspaces = [], activeWorkspaceId = null, onSaveToWorkspace, toolbarStart = null, toolbarEnd = null }) {
  const scratch = !note.workspaceId;
  const [record, setRecord] = useState(null); // the stored note, or a blank one
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);
  const latest = useRef({ record: null, title: '', text: '' });
  latest.current = { record, title, text };

  useEffect(() => {
    if (!note.workspaceId) {
      const saved = readScratch(note.id);
      setRecord({ id: note.id, workspaceId: null });
      setTitle(saved.title || '');
      setText(saved.text || '');
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    listWorkspaceNotes(note.workspaceId)
      .then(data => data?.data || data || [])
      .catch(() => [])
      .then(list => {
        if (cancelled) return;
        const found = list.find(n => n.id === note.id);
        const base = found || {
          id: note.id,
          workspaceId: note.workspaceId,
          title: '',
          text: '',
          folder: note.workspaceName,
          type: 'richtext',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setRecord(base);
        setTitle(base.title === 'Untitled' && !found?.text ? '' : (base.title || ''));
        setText(base.text || '');
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [note.id, note.workspaceId, note.workspaceName]);

  const persist = useCallback(() => {
    const { record: rec, title: t, text: body } = latest.current;
    if (!rec) return;
    if (!rec.workspaceId) { writeScratch(rec.id, t, body); return; }
    if (!t.trim() && !hasText(body)) return;
    const updated = { ...rec, title: t.trim() || 'Untitled', text: body, updatedAt: Date.now() };
    setRecord(updated);
    saveWorkspaceNote(updated)
      .then(() => announce(rec.workspaceId))
      .catch(err => console.error('[NoteTab] save failed:', err));
  }, []);

  const schedule = useCallback(() => {
    // Scratch notes write to localStorage at once — cheap, and no pending
    // save is left to re-create the note after its tab closes.
    if (!latest.current.record?.workspaceId) { persist(); return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, SAVE_DELAY);
  }, [persist]);

  // Closing the tab (or switching it away) flushes a pending save.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      persist();
    }
  }, [persist]);

  // The tab's title follows the note's (a ref: the parent passes a new
  // callback every render).
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  useEffect(() => {
    if (loaded) onTitleRef.current?.(title.trim() || (scratch ? 'Scratch note' : 'New note'));
  }, [title, loaded, scratch]);

  // Save a scratch note into a workspace: stored there as a normal note,
  // then the tab follows it (NoteTab reloads it from the workspace).
  const saveTo = async (ws) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const { title: t, text: body } = latest.current;
    const now = Date.now();
    await saveWorkspaceNote({
      id: note.id,
      workspaceId: ws.id,
      title: t.trim() || 'Untitled',
      text: body,
      folder: ws.name,
      type: 'richtext',
      createdAt: now,
      updatedAt: now,
    });
    dropScratch(note.id);
    announce(ws.id);
    onSaveToWorkspace?.(ws);
  };
  const saveItems = [...workspaces]
    .sort((a, b) => (b.id === activeWorkspaceId) - (a.id === activeWorkspaceId))
    .map(ws => ({
      key: ws.id,
      icon: faLayerGroup,
      label: ws.name || 'Untitled workspace',
      hint: ws.id === activeWorkspaceId ? 'Current' : null,
      onSelect: () => saveTo(ws),
    }));

  const remove = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (scratch) { dropScratch(note.id); onClose?.(); return; }
    deleteNote(note.id)
      .then(() => announce(note.workspaceId))
      .catch(() => { });
    onClose?.();
  };

  return (
    <div className="bp-root ft-root note-tab">
      <div className="bp-toolbar">
        {toolbarStart}
        <TabAddressBar
          icon={<FontAwesomeIcon icon={faNoteSticky} className="ft-address-icon note-tab-icon" />}
          label={title.trim() || (scratch ? 'Scratch note' : 'New note')}
          sub={scratch ? 'Not in a workspace' : (note.workspaceName || null)}
          title={scratch ? 'Scratch note — kept with this tab until you save it to a workspace' : note.workspaceName ? `Note in ${note.workspaceName}` : 'Note'}
          onOpenUrl={onOpenUrl}
          onOpenPath={onOpenPath}
          onOpenShell={onOpenShell}
        />
        <div className="bp-capsule">
          {scratch && saveItems.length > 0 && (
            <ToolbarMenu
              icon={faFloppyDisk}
              label="Save to workspace"
              title="Save this note to a workspace"
              items={saveItems}
            />
          )}
          <button className="bp-btn" onClick={remove} title={scratch ? 'Discard note' : 'Delete note'}>
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </div>
        {toolbarEnd}
      </div>
      <div className="note-tab-body">
        {loaded && (
          <div className="note-tab-page">
            <input
              className="wcp-note-title note-tab-title"
              placeholder={scratch ? 'Scratch note' : 'Untitled note'}
              value={title}
              onChange={e => { setTitle(e.target.value); latest.current = { ...latest.current, title: e.target.value }; schedule(); }}
              autoFocus={!record?.text && !record?.title}
            />
            <div className="wcp-note-tiptap note-tab-editor">
              <Suspense fallback={<div className="note-tab-loading">Loading editor…</div>}>
                <TiptapEditor
                  content={toEditorContent(text)}
                  onChange={(html) => { setText(html); latest.current = { ...latest.current, text: html }; schedule(); }}
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
