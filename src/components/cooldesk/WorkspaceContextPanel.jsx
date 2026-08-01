import { faArrowLeft, faBolt, faChevronDown, faChevronUp, faCompass, faPause, faPlus, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { AccentColorPicker } from './AccentColorPicker.jsx';
import { CooldeskSection } from './CooldeskSection.jsx';
import { fetchCooldesk, collectSharedTodos } from '../../services/cooldeskService.js';
import { useCooldeskVersion } from '../../hooks/useCooldeskProjects.js';
import {
  deleteNote,
  deleteWorkspaceTodo,
  listWorkspaceNotes,
  listWorkspaceTodos,
  saveWorkspace,
  saveWorkspaceNote,
  saveWorkspaceTodo,
} from '../../db/index.js';
// Heavy: @tiptap/* (a dozen extensions). Only load when a note is actually opened.
const TiptapEditor = lazy(() => import('../spatial/editor/TiptapEditor'));

// Editor appTypes: a project folder added as "open in <editor>" is stored with the
// editor's key rather than 'folder', but its path is still the project root.
const CUSTOM_EDITORS = ['vscode', 'code', 'cursor', 'windsurf', 'idea', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rider', 'clion', 'rubymine', 'fleet', 'zed'];

const STATUS_OPTIONS = [
  { key: 'active',   label: 'Active',   color: '#22c55e', icon: faBolt },
  { key: 'planning', label: 'Planning', color: '#60a5fa', icon: faCompass },
  { key: 'on-hold',  label: 'On Hold',  color: '#f59e0b', icon: faPause },
];

const formatAge = (ts) => {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
};

const stripHtml = (html) =>
  (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

// Wrap legacy plain text so Tiptap renders it as a paragraph
const toEditorContent = (text) => {
  if (!text) return '';
  return /<[a-z][^>]*>/i.test(text)
    ? text
    : `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;
};

export const WorkspaceContextPanel = memo(function WorkspaceContextPanel({ workspace }) {
  const { id: workspaceId, name } = workspace;

  // ── CoolDesk (.cooldesk) — committed project knowledge from the workspace folder ──
  // A project folder may be stored as a plain 'folder' app OR as an editor app
  // (appType 'vscode' / 'cursor' / … when added as "open the folder in <editor>").
  // Both name a directory root that can hold a committed .cooldesk/, so both are
  // valid candidates — prefer a plain folder, then fall back to an editor folder.
  const folderPath = useMemo(() => {
    const apps = workspace?.apps || [];
    const plain = apps.find(a => a.appType?.toLowerCase() === 'folder' && a.path);
    if (plain) return plain.path;
    const editorFolder = apps.find(a => CUSTOM_EDITORS.includes(a.appType?.toLowerCase()) && a.path);
    return editorFolder?.path || null;
  }, [workspace]);
  const [cooldesk, setCooldesk] = useState(null);
  // Which committed README is open in the reader, or null for the notes list.
  // Holds the selected doc ({ name, readme }) so grouped workspaces can surface
  // each linked project's README, not only the hub's.
  const [readmeDoc, setReadmeDoc] = useState(null);

  // Re-read when the plugin announces a write to this project's .cooldesk/.
  const cdVersion = useCooldeskVersion(folderPath);
  useEffect(() => {
    if (!folderPath) { setCooldesk(null); return; }
    let cancelled = false;
    fetchCooldesk(folderPath)
      .then(d => { if (!cancelled) setCooldesk(d?.exists ? d : null); })
      .catch(() => { if (!cancelled) setCooldesk(null); });
    return () => { cancelled = true; };
  }, [folderPath, cdVersion]);

  const sharedTodos = useMemo(() => collectSharedTodos(cooldesk), [cooldesk]);
  // Group shared todos by project ("category-wise"), so the Next Up list reads as
  // folder-style sections instead of a flat list with a repeated tag on every row.
  const sharedByProject = useMemo(() => {
    const map = new Map();
    for (const t of sharedTodos) {
      if (!map.has(t.project)) map.set(t.project, []);
      map.get(t.project).push(t);
    }
    return [...map.entries()].map(([project, items]) => ({ project, items }));
  }, [sharedTodos]);
  const showCatHeads = sharedTodos.length > 0;

  // Every committed README available for this workspace: the hub's own, plus each
  // linked group member that ships one. Members often include the hub itself
  // (path "."), so dedupe it out by project id / name.
  const readmeDocs = useMemo(() => {
    if (!cooldesk) return [];
    const out = [];
    const hubId = cooldesk.project?.id;
    if (cooldesk.readme) {
      out.push({ id: hubId || 'hub', name: cooldesk.project?.name || 'This project', readme: cooldesk.readme });
    }
    for (const m of (cooldesk.members || [])) {
      if ((m.project?.id || m.name) === hubId) continue; // skip the hub's own member entry
      if (m.readme) {
        out.push({ id: m.project?.id || m.path || m.name, name: m.project?.name || m.name || 'Linked project', readme: m.readme });
      }
    }
    return out;
  }, [cooldesk]);

  const readmeHtml = useMemo(
    () => (readmeDoc?.readme ? marked.parse(readmeDoc.readme, { breaks: true }) : ''),
    [readmeDoc],
  );

  // Status
  const [status, setStatus] = useState(workspace.status || null);

  // Accent color (optimistic; persisted to the workspace record so the card
  // and panel stay in sync on reload).
  const [accent, setAccent] = useState(workspace.color || null);
  const [colorOpen, setColorOpen] = useState(false);

  // Todos
  const [todos, setTodos] = useState([]);
  const [newTodoText, setNewTodoText] = useState('');

  // Notes
  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const noteSaveTimer = useRef(null);

  // Load todos + notes when panel mounts
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    listWorkspaceTodos(workspaceId)
      .then(data => { if (!cancelled) setTodos(data?.data || data || []); })
      .catch(() => {});
    listWorkspaceNotes(workspaceId)
      .then(data => { if (!cancelled) setNotes(data?.data || data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);

  // ── Status ──────────────────────────────────────────────────────────────
  const handleStatusChange = useCallback((next) => {
    setStatus(next);
    saveWorkspace({ ...workspace, status: next, updatedAt: Date.now() })
      .catch(err => console.error('[WorkspaceContextPanel] saveWorkspace failed:', err));
  }, [workspace]);

  // ── Accent color ──────────────────────────────────────────────────────────
  const applyAccent = useCallback((color) => {
    setAccent(color);
    const next = { ...workspace, updatedAt: Date.now() };
    if (color) next.color = color; else delete next.color;
    saveWorkspace(next)
      .catch(err => console.error('[WorkspaceContextPanel] save accent failed:', err));
  }, [workspace]);

  // ── Todos ───────────────────────────────────────────────────────────────
  const handleAddTodo = useCallback(async (text) => {
    if (!text.trim() || !workspaceId) return;
    const todo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspaceId,
      text: text.trim(),
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setTodos(prev => [...prev, todo]);
    setNewTodoText('');
    saveWorkspaceTodo(todo).catch(() => {});
  }, [workspaceId]);

  const handleToggleTodo = useCallback((id) => {
    setTodos(prev => {
      const next = prev.map(t => t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t);
      const updated = next.find(t => t.id === id);
      if (updated) saveWorkspaceTodo(updated).catch(() => {});
      return next;
    });
  }, []);

  const handleDeleteTodo = useCallback((id) => {
    setTodos(prev => prev.filter(t => t.id !== id));
    deleteWorkspaceTodo(id).catch(() => {});
  }, []);

  // ── Notes ───────────────────────────────────────────────────────────────
  const openNote = useCallback((note) => {
    setReadmeDoc(null);
    setActiveNote(note);
    setNoteTitle(note.title || '');
    setNoteContent(note.text || '');
  }, []);

  const newNote = useCallback(() => {
    setReadmeDoc(null);
    const blank = {
      id: `wsnote_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspaceId,
      title: '',
      text: '',
      folder: name,
      type: 'richtext',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      _isNew: true,
    };
    setActiveNote(blank);
    setNoteTitle('');
    setNoteContent('');
  }, [workspaceId, name]);

  const persistNote = useCallback((note, title, text) => {
    if (!title.trim() && !stripHtml(text)) return;
    // Strip UI-only flags before persisting (schema is strict; unknown fields fail)
    const { _isNew, ...rest } = note;
    const updated = {
      ...rest,
      title: title.trim() || 'Untitled',
      text,
      updatedAt: Date.now(),
    };
    saveWorkspaceNote(updated)
      .catch(err => console.error('[WorkspaceContextPanel] saveWorkspaceNote failed:', err));
    setNotes(prev => {
      const idx = prev.findIndex(n => n.id === updated.id);
      return idx >= 0
        ? prev.map(n => n.id === updated.id ? updated : n)
        : [updated, ...prev];
    });
    // Keep the editor open on the saved note (preserve _isNew=false implicitly)
    setActiveNote(updated);
  }, []);

  const handleNoteChange = useCallback((field, value) => {
    if (field === 'title') setNoteTitle(value);
    else setNoteContent(value);

    clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      const title = field === 'title' ? value : noteTitle;
      const text  = field === 'text'  ? value : noteContent;
      if (activeNote) persistNote(activeNote, title, text);
    }, 800);
  }, [activeNote, noteTitle, noteContent, persistNote]);

  const backToList = useCallback(() => {
    clearTimeout(noteSaveTimer.current);
    if (activeNote) persistNote(activeNote, noteTitle, noteContent);
    setActiveNote(null);
  }, [activeNote, noteTitle, noteContent, persistNote]);

  const handleTogglePin = useCallback((note) => {
    // Don't touch updatedAt — pin/unpin shouldn't disturb chronological position
    const { _isNew, ...rest } = note;
    const updated = { ...rest, pinned: !note.pinned };
    setNotes(prev => prev.map(n => n.id === note.id ? updated : n));
    saveWorkspaceNote(updated)
      .catch(err => console.error('[WorkspaceContextPanel] toggle pin failed:', err));
  }, []);

  // Pinned first, then by updatedAt desc
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }, [notes]);

  const handleDeleteNote = useCallback((noteId) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (activeNote?.id === noteId) {
      clearTimeout(noteSaveTimer.current);
      setActiveNote(null);
    }
    deleteNote(noteId).catch(() => {});
  }, [activeNote]);

  const openCount = todos.filter(t => !t.done).length + sharedTodos.length;

  return (
    <div
      className={`workspace-context-panel ${accent ? 'has-accent' : ''}`}
      style={accent ? { '--card-accent': accent } : undefined}
      onClick={e => e.stopPropagation()}
    >
      <div className="wcp-grid">

        {/* ── LEFT RAIL: project (.cooldesk) + status + todos ───────────── */}
        <aside className="wcp-rail">

          <CooldeskSection cooldesk={cooldesk} />

          <section className="wcp-section">
            <header className="wcp-section-head" data-accent="status">
              <span className="wcp-section-bar" aria-hidden="true" />
              <h4 className="wcp-section-title">Status</h4>
            </header>
            <div className="wcp-status-seg" role="radiogroup" aria-label="Workspace status">
              {STATUS_OPTIONS.map(({ key, label, color }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={status === key}
                  className={`wcp-status-pill ${status === key ? 'is-active' : ''}`}
                  style={{ '--seg-color': color }}
                  onClick={() => handleStatusChange(status === key ? null : key)}
                >
                  <span className="wcp-status-dot" aria-hidden="true" />
                  <span className="wcp-status-pill-label">{label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="wcp-section">
            <button
              type="button"
              className="wcp-color-trigger"
              data-accent="color"
              onClick={() => setColorOpen(v => !v)}
              aria-expanded={colorOpen}
            >
              <span className="wcp-section-bar" aria-hidden="true" />
              <span className="wcp-section-title">Card Color</span>
              <span
                className="wcp-color-current"
                style={{ background: accent || 'transparent' }}
                aria-hidden="true"
              />
              <FontAwesomeIcon
                icon={colorOpen ? faChevronUp : faChevronDown}
                className="wcp-color-chevron"
              />
            </button>
            {colorOpen && (
              <AccentColorPicker
                className="wcp-accent-picker"
                value={accent}
                onSelect={(color, source) => {
                  applyAccent(color);
                  if (source !== 'custom') setColorOpen(false);
                }}
              />
            )}
          </section>

          <section className="wcp-section wcp-todos-section">
            <header className="wcp-section-head" data-accent="todos">
              <span className="wcp-section-bar" aria-hidden="true" />
              <h4 className="wcp-section-title">Next Up</h4>
              {openCount > 0 && <span className="wcp-section-count">{openCount}</span>}
            </header>
            <div className="wcp-todos">
              {sharedByProject.map(g => (
                <div key={g.project} className="wcp-todo-cat">
                  {showCatHeads && <div className="wcp-todo-cat-head">{g.project}</div>}
                  {g.items.map((todo, i) => (
                    <div key={`${g.project}:${todo.id}:${i}`} className={`wcp-todo-row is-shared ${todo.status === 'in_progress' ? 'is-active' : ''}`}>
                      <span className="wcp-todo-shared-dot" aria-hidden="true" />
                      <span className="wcp-todo-text">{todo.title}</span>
                    </div>
                  ))}
                </div>
              ))}
              {todos.length > 0 && (
                <div className="wcp-todo-cat">
                  {showCatHeads && <div className="wcp-todo-cat-head">Personal</div>}
                  {todos.map(todo => (
                    <div key={todo.id} className={`wcp-todo-row ${todo.done ? 'is-done' : ''}`}>
                      <button
                        type="button"
                        className="wcp-todo-check"
                        onClick={() => handleToggleTodo(todo.id)}
                        aria-label={todo.done ? 'Mark undone' : 'Mark done'}
                        aria-pressed={todo.done}
                      >
                        <svg viewBox="0 0 14 14" width="9" height="9" aria-hidden="true">
                          <path
                            d="M2 7.5L5.5 11L12 3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <span className="wcp-todo-text">{todo.text}</span>
                      <button
                        type="button"
                        className="wcp-todo-del"
                        onClick={() => handleDeleteTodo(todo.id)}
                        aria-label="Delete task"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              {todos.length === 0 && sharedTodos.length === 0 && (
                <div className="wcp-todos-empty">Nothing queued. Capture one below.</div>
              )}
              <div className="wcp-todo-add">
                <input
                  className="wcp-todo-input"
                  placeholder="What's next…"
                  value={newTodoText}
                  onChange={e => setNewTodoText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddTodo(newTodoText); }}
                />
                <button
                  type="button"
                  className="wcp-todo-add-btn"
                  onClick={() => handleAddTodo(newTodoText)}
                  disabled={!newTodoText.trim()}
                  aria-label="Add task"
                >
                  <FontAwesomeIcon icon={faPlus} />
                </button>
              </div>
            </div>
          </section>

        </aside>

        {/* ── RIGHT COLUMN: notes ───────────────────────────────────────── */}
        <section className="wcp-notes-col">
          <header className="wcp-section-head" data-accent="notes">
            <span className="wcp-section-bar" aria-hidden="true" />
            <h4 className="wcp-section-title">
              {readmeDoc ? `README · ${readmeDoc.name}` : activeNote ? 'Drafting' : 'Notes'}
            </h4>
            {readmeDoc && (
              <span className="wcp-notes-readonly-tag" title="Read-only — from .cooldesk">shared</span>
            )}
            {!activeNote && !readmeDoc && notes.length > 0 && (
              <span className="wcp-section-count">{notes.length}</span>
            )}
            {!activeNote && !readmeDoc && (
              <button
                type="button"
                className="wcp-notes-new-btn"
                onClick={newNote}
                title="New note"
                aria-label="New note"
              >
                <FontAwesomeIcon icon={faPlus} />
                <span>New</span>
              </button>
            )}
            {readmeDoc && (
              <div className="wcp-notes-actions">
                <button type="button" className="wcp-notes-back" onClick={() => setReadmeDoc(null)}>
                  <FontAwesomeIcon icon={faArrowLeft} />
                  <span>Back</span>
                </button>
              </div>
            )}
            {activeNote && (
              <div className="wcp-notes-actions">
                {!activeNote._isNew && (
                  <button
                    type="button"
                    className="wcp-notes-del"
                    onClick={() => handleDeleteNote(activeNote.id)}
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                )}
                <button type="button" className="wcp-notes-back" onClick={backToList}>
                  <FontAwesomeIcon icon={faArrowLeft} />
                  <span>Back</span>
                </button>
              </div>
            )}
          </header>

          {readmeDoc ? (
            <div className="wcp-note-editor wcp-readme-view">
              <div className="wcp-note-tiptap">
                <Suspense fallback={<div className="wcp-note-loading">Loading…</div>}>
                  <TiptapEditor content={readmeHtml} isEditable={false} onChange={() => {}} />
                </Suspense>
              </div>
            </div>
          ) : activeNote ? (
            <div className="wcp-note-editor">
              <input
                className="wcp-note-title"
                placeholder="Untitled note"
                value={noteTitle}
                onChange={e => handleNoteChange('title', e.target.value)}
                autoFocus={activeNote._isNew}
              />
              <div className="wcp-note-tiptap">
                <Suspense fallback={<div className="wcp-note-loading">Loading editor…</div>}>
                  <TiptapEditor
                    content={toEditorContent(noteContent)}
                    onChange={(html) => handleNoteChange('text', html)}
                  />
                </Suspense>
              </div>
            </div>
          ) : (
            <div className="wcp-notes-list">
              {readmeDocs.map(doc => (
                <div
                  key={doc.id}
                  className="wcp-note-card is-readme"
                  onClick={() => setReadmeDoc(doc)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReadmeDoc(doc); } }}
                >
                  <div className="wcp-note-card-row">
                    <span className="wcp-note-card-title">README · {doc.name}</span>
                    <span className="wcp-note-readme-tag">.cooldesk</span>
                  </div>
                  <span className="wcp-note-card-preview">Committed project readme — read-only</span>
                </div>
              ))}
              {notes.length === 0 ? (
                <button type="button" className="wcp-notes-empty" onClick={newNote}>
                  <span className="wcp-notes-empty-glyph">✎</span>
                  <span className="wcp-notes-empty-text">
                    Nothing here yet. Start your first note.
                  </span>
                </button>
              ) : (
                sortedNotes.map(note => {
                  const preview = stripHtml(note.text);
                  return (
                    <div
                      key={note.id}
                      className={`wcp-note-card${note.pinned ? ' is-pinned' : ''}`}
                      onClick={() => openNote(note)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNote(note); } }}
                    >
                      <div className="wcp-note-card-row">
                        <span className="wcp-note-card-title">
                          {note.title || 'Untitled'}
                        </span>
                        <span className="wcp-note-card-age">{formatAge(note.updatedAt)}</span>
                      </div>
                      {preview && (
                        <span className="wcp-note-card-preview">{preview}</span>
                      )}
                      <div className="wcp-note-card-actions">
                        <button
                          type="button"
                          className={`wcp-note-card-pin${note.pinned ? ' is-pinned' : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleTogglePin(note); }}
                          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                          aria-pressed={!!note.pinned}
                          title={note.pinned ? 'Unpin' : 'Pin'}
                        >
                          <FontAwesomeIcon icon={faThumbtack} />
                        </button>
                        <button
                          type="button"
                          className="wcp-note-card-del"
                          onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                          aria-label="Delete note"
                          title="Delete note"
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});
