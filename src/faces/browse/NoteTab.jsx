import { faNoteSticky, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { deleteNote, listWorkspaceNotes, saveWorkspaceNote } from '../../db/index.js';
import { TabAddressBar } from './TabAddressBar';

// A Browse tab holding one workspace note in the main area, the way a file
// tab holds a file: title + TipTap editor at full size, autosaved. Opened
// from the workspace's Notes list (WorkspaceContextPanel → onOpenNote); a new
// note arrives as just an id and is saved once it has a title or text.

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

/**
 * @param note     { id, workspaceId, workspaceName } from the tab
 * @param onTitle  the tab's title follows the note's
 * @param onClose  close the tab (after Delete)
 */
export function NoteTab({ note, onTitle, onClose, onOpenUrl, onOpenPath, onOpenShell, toolbarStart = null, toolbarEnd = null }) {
  const [record, setRecord] = useState(null); // the stored note, or a blank one
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);
  const latest = useRef({ record: null, title: '', text: '' });
  latest.current = { record, title, text };

  useEffect(() => {
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
    if (!rec || (!t.trim() && !hasText(body))) return;
    const updated = { ...rec, title: t.trim() || 'Untitled', text: body, updatedAt: Date.now() };
    setRecord(updated);
    saveWorkspaceNote(updated)
      .then(() => announce(rec.workspaceId))
      .catch(err => console.error('[NoteTab] save failed:', err));
  }, []);

  const schedule = useCallback(() => {
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
    if (loaded) onTitleRef.current?.(title.trim() || 'New note');
  }, [title, loaded]);

  const remove = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
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
          label={title.trim() || 'New note'}
          sub={note.workspaceName || null}
          title={note.workspaceName ? `Note in ${note.workspaceName}` : 'Note'}
          onOpenUrl={onOpenUrl}
          onOpenPath={onOpenPath}
          onOpenShell={onOpenShell}
        />
        <div className="bp-capsule">
          <button className="bp-btn" onClick={remove} title="Delete note">
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
              placeholder="Untitled note"
              value={title}
              onChange={e => { setTitle(e.target.value); schedule(); }}
              autoFocus={!record?.text && !record?.title}
            />
            <div className="wcp-note-tiptap note-tab-editor">
              <Suspense fallback={<div className="note-tab-loading">Loading editor…</div>}>
                <TiptapEditor
                  content={toEditorContent(text)}
                  onChange={(html) => { setText(html); schedule(); }}
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
