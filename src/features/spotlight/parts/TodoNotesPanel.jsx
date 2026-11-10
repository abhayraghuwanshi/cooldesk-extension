import { faCheck, faListCheck, faNoteSticky, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { orderedTodos } from './todoOrder';

// Same rich-text editor the workspace panel uses, so a note round-trips
// through the exact same HTML shape wherever it's opened.
const TiptapEditor = lazy(() => import('../../../faces/workspace/parts/editor/TiptapEditor'));

// /todo and /notes — a panel of their own (edit-workspace mode with a
// `focus`, see useEditWorkspaceMode). Laid out like /shell: a strip on top
// to switch list (Todos | Notes) and place (Active first, then each saved
// workspace), the content below. The search box above adds: Enter turns the
// typed text into a todo, or a new note that opens on the right.
//
//   Todos  a checklist — click the circle to tick, the text to edit in place;
//          done ones sink to the bottom.
//   Notes  list on the left, the selected note's editor on the right, so
//          editing never hides the list.
//
// `selectedIndex` is the keyboard row (↑↓ from the search box), indexing the
// same order rendered here: open todos then done ones; notes newest first.

const ago = (ts) => {
    if (!ts) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    return d < 30 ? `${d}d` : new Date(ts).toLocaleDateString();
};

export function TodoNotesPanel({ editWorkspace, places, selectedIndex, setSelectedIndex, inputRef }) {
    const { focus, workspace } = editWorkspace;
    const switchTo = (ws, nextFocus = focus) => {
        if (!ws) return;
        editWorkspace.enter(ws, { focus: nextFocus });
        setSelectedIndex(-1);
        requestAnimationFrame(() => inputRef?.current?.focus());
    };

    return (
        <div className="sp-tn">
            <div className="sp-tn-bar">
                <div className="sp-tn-kind" role="tablist" aria-label="List">
                    {[
                        { id: 'todo', label: 'Todos', icon: faListCheck },
                        { id: 'notes', label: 'Notes', icon: faNoteSticky },
                    ].map(k => (
                        <button
                            key={k.id}
                            type="button"
                            role="tab"
                            aria-selected={focus === k.id}
                            className={`sp-tn-kind-btn${focus === k.id ? ' is-on' : ''}`}
                            onClick={() => focus !== k.id && switchTo(workspace, k.id)}
                        >
                            <FontAwesomeIcon icon={k.icon} />
                            {k.label}
                        </button>
                    ))}
                </div>
                <div className="sp-tn-places" role="tablist" aria-label="Where">
                    {places.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            role="tab"
                            aria-selected={p.id === workspace?.id}
                            className={`sp-tn-place${p.id === workspace?.id ? ' is-on' : ''}`}
                            onClick={() => p.id !== workspace?.id && switchTo(p)}
                            title={p.id === places[0]?.id ? 'Not tied to a workspace — shown on the Active card' : p.name}
                        >
                            {p.name}
                        </button>
                    ))}
                </div>
            </div>
            {focus === 'todo'
                ? <TodoList editWorkspace={editWorkspace} selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex} />
                : <NoteBoard editWorkspace={editWorkspace} selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex} inputRef={inputRef} />}
        </div>
    );
}

function TodoList({ editWorkspace, selectedIndex, setSelectedIndex }) {
    const todos = orderedTodos(editWorkspace.todos);
    const listRef = useRef(null);
    useEffect(() => {
        listRef.current?.querySelector('.sp-todo.is-sel')?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (todos.length === 0) {
        return (
            <div className="sp-tn-empty">
                Nothing to do in <b>{editWorkspace.workspace?.name}</b>. Type above and press Enter to add one.
            </div>
        );
    }
    return (
        <div className="sp-todos" ref={listRef}>
            {todos.map((t, i) => {
                const editing = editWorkspace.editingTodoId === t.id;
                return (
                    <div
                        key={t.id}
                        className={`sp-todo${t.done ? ' is-done' : ''}${i === selectedIndex ? ' is-sel' : ''}`}
                        onMouseEnter={() => setSelectedIndex(i)}
                    >
                        <button
                            type="button"
                            className="sp-todo-check"
                            onClick={() => editWorkspace.toggleTodo(t.id)}
                            aria-label={t.done ? 'Mark not done' : 'Mark done'}
                            title={t.done ? 'Mark not done' : 'Mark done (Space)'}
                        >
                            {t.done && <FontAwesomeIcon icon={faCheck} />}
                        </button>
                        {editing ? (
                            <input
                                className="sp-todo-input"
                                autoFocus
                                defaultValue={t.text}
                                onBlur={(e) => editWorkspace.updateTodoText(t.id, e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') { e.preventDefault(); editWorkspace.updateTodoText(t.id, e.target.value); }
                                    if (e.key === 'Escape') { e.preventDefault(); editWorkspace.cancelEditTodo(); }
                                }}
                            />
                        ) : (
                            <span className="sp-todo-text" onClick={() => editWorkspace.startEditTodo(t.id)} title="Click to edit">
                                {t.text}
                            </span>
                        )}
                        <button
                            type="button"
                            className="sp-row-del"
                            onClick={() => editWorkspace.removeTodo(t.id)}
                            aria-label="Delete todo"
                            title="Delete"
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

function NoteBoard({ editWorkspace, selectedIndex, setSelectedIndex, inputRef }) {
    const { notes, stripHtml } = editWorkspace;
    const editorRef = useRef(null);
    const listRef = useRef(null);
    // The note on the right: the one picked (click, or just created), else
    // the keyboard row, else the newest.
    const shown = notes.find(n => n.id === editWorkspace.activeNoteId)
        || notes[selectedIndex]
        || notes[0]
        || null;
    const shownIndex = shown ? notes.indexOf(shown) : -1;

    useEffect(() => {
        listRef.current?.querySelector('.sp-note.is-on')?.scrollIntoView({ block: 'nearest' });
    }, [shownIndex]);

    if (notes.length === 0) {
        return (
            <div className="sp-tn-empty">
                No notes in <b>{editWorkspace.workspace?.name}</b> yet. Type above and press Enter to start one.
            </div>
        );
    }
    const pick = (n, i) => {
        editWorkspace.openNote(n.id);
        setSelectedIndex(i);
    };
    return (
        <div className="sp-notes">
            <div className="sp-notes-list" ref={listRef}>
                {notes.map((n, i) => {
                    const body = stripHtml(n.text);
                    const title = n.title || body.slice(0, 60) || 'Untitled';
                    return (
                        <div
                            key={n.id}
                            role="button"
                            tabIndex={-1}
                            className={`sp-note${n === shown ? ' is-on' : ''}`}
                            onClick={() => pick(n, i)}
                        >
                            <div className="sp-note-title">{title}</div>
                            <div className="sp-note-meta">
                                <span>{ago(n.updatedAt || n.createdAt)}</span>
                                {body && body !== title && <span className="sp-note-snippet">{body.slice(0, 80)}</span>}
                            </div>
                            <button
                                type="button"
                                className="sp-row-del"
                                onClick={(e) => { e.stopPropagation(); editWorkspace.removeNote(n.id); }}
                                aria-label="Delete note"
                                title="Delete"
                            >
                                <FontAwesomeIcon icon={faXmark} />
                            </button>
                        </div>
                    );
                })}
            </div>
            {shown && (
                <div className="sp-note-edit">
                    <input
                        className="sp-note-title-input"
                        placeholder="Untitled"
                        value={shown.title || ''}
                        onChange={(e) => editWorkspace.updateNoteTitle(shown.id, e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); editorRef.current?.focus(); }
                            if (e.key === 'Escape') { e.preventDefault(); inputRef?.current?.focus(); }
                        }}
                    />
                    {/* Clicking the empty space under a short note still
                        focuses it, instead of leaving focus in the search box. */}
                    <div
                        className="sp-note-body spotlight-note-editor"
                        onMouseDown={(e) => {
                            if (e.target.closest('.ProseMirror')) return;
                            e.preventDefault();
                            editorRef.current?.focus();
                        }}
                    >
                        <Suspense fallback={<div className="sp-tn-empty">Loading editor…</div>}>
                            <TiptapEditor
                                key={shown.id}
                                ref={editorRef}
                                content={shown.text}
                                onChange={(html) => editWorkspace.updateNoteContent(shown.id, html)}
                                showFloatingMenu={false}
                                showBubbleMenu
                            />
                        </Suspense>
                    </div>
                </div>
            )}
        </div>
    );
}
