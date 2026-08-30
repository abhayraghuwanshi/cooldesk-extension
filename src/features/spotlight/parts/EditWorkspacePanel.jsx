import { faBold, faCode, faItalic, faListOl, faListUl, faQuoteRight, faStrikethrough, faTasks, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useRef } from 'react';
import { ResultItem } from './ResultItem';

// Same rich-text editor WorkspaceContextPanel.jsx uses for notes — reused
// here rather than a second, plain-text editor, so a note edited from either
// place round-trips through the exact same HTML shape.
const TiptapEditor = lazy(() => import('../../../faces/workspace/parts/editor/TiptapEditor'));

// /edit-workspace — typing an existing workspace's own name opens it here:
// items as removable chips (search the main box to add more, same
// interaction as /new-workspace's folder step), notes and todos with their
// own small inputs (the main box stays dedicated to "search to add an item").
export function EditWorkspacePanel({
    editWorkspace, editWorkspaceItems, query, selectedIndex, setSelectedIndex,
    openExistingWorkspaceItem, formatUrl, getBadgeLabel, getAppIcon,
}) {
    // TiptapEditor's own getEditor() handle, without TiptapEditor.jsx itself
    // needing to know anything about this panel's toolbar.
    const noteEditorRef = useRef(null);

    const itemsCount = (editWorkspace.workspace.urls?.length || 0) + (editWorkspace.workspace.apps?.length || 0);
    const todosCount = editWorkspace.todos.length;
    const items = editWorkspaceItems.slice(0, itemsCount);
    const activeNote = editWorkspace.activeNoteId
        ? editWorkspace.notes.find(n => n.id === editWorkspace.activeNoteId)
        : null;
    // Formatting commands run straight against the live Tiptap
    // instance via its own ref handle — TiptapEditor.jsx only
    // renders floating/bubble menus (on selection), no fixed
    // toolbar, so this is a small one of our own rather than
    // changing that shared component.
    const runNoteCommand = (fn) => {
        const editor = noteEditorRef.current?.getEditor();
        if (editor) fn(editor.chain().focus());
    };
    const toolbarButtons = [
        { icon: faBold, title: 'Bold', run: (c) => c.toggleBold().run() },
        { icon: faItalic, title: 'Italic', run: (c) => c.toggleItalic().run() },
        { icon: faStrikethrough, title: 'Strikethrough', run: (c) => c.toggleStrike().run() },
        { icon: faListUl, title: 'Bullet list', run: (c) => c.toggleBulletList().run() },
        { icon: faListOl, title: 'Numbered list', run: (c) => c.toggleOrderedList().run() },
        { icon: faQuoteRight, title: 'Quote', run: (c) => c.toggleBlockquote().run() },
        { icon: faCode, title: 'Code', run: (c) => c.toggleCode().run() },
    ];
    return (
    <div className="spotlight-ai-mode spotlight-agent-mode">
        {/* No header — the input row's chip already names the
            workspace; repeating it here was redundant. */}
        {activeNote ? (
            // Note editor — same Tiptap component WorkspaceContextPanel.jsx
            // uses, so this reads/writes the identical HTML shape.
            // "Command stays on top" (the search input above), the
            // note surfaces below it, replacing the list until closed.
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                        placeholder="Untitled note"
                        value={activeNote.title || ''}
                        onChange={(e) => editWorkspace.updateNoteTitle(activeNote.id, e.target.value)}
                        style={{
                            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                            padding: '10px 4px 8px 12px', fontSize: 15, fontWeight: 600,
                            color: 'rgba(255, 255, 255, 0.92)', letterSpacing: '-0.01em',
                        }}
                    />
                    {/* Explicit close — Esc from inside the Tiptap
                        editor doesn't reliably reach the window-level
                        handler (ProseMirror stops it bubbling), so
                        going back can't depend on a keystroke alone. */}
                    <button
                        type="button"
                        className="spotlight-add-badge-exit"
                        style={{ marginRight: 10 }}
                        onMouseDown={(e) => { e.preventDefault(); editWorkspace.closeNote(); }}
                        title="Back to list (Esc)"
                        aria-label="Back to list"
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 2, padding: '0 8px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {toolbarButtons.map(({ icon, title, run }) => (
                        <button
                            key={title}
                            type="button"
                            className="spotlight-agent-chip"
                            style={{ padding: '4px 8px' }}
                            title={title}
                            onMouseDown={(e) => { e.preventDefault(); runNoteCommand(run); }}
                        >
                            <FontAwesomeIcon icon={icon} />
                        </button>
                    ))}
                </div>
                {/* .spotlight-note-editor scopes a tighter override of
                    .ProseMirror's own padding (GlobalSpotlight.css) —
                    that default (1rem 2rem) is sized for the full-page
                    editor in WorkspaceContextPanel.jsx and, stacked on
                    top of this box's own padding, left a wide empty
                    margin around a short note here.
                    The click-to-focus handler matters because this
                    wrapper is taller than a short note's actual text —
                    clicking the empty space below it hit plain dead
                    space otherwise, and whatever had focus before (the
                    search input) silently kept it, which looked like
                    typing in the note went nowhere. */}
                <div
                    className="spotlight-note-editor"
                    style={{ minHeight: 90, maxHeight: 320, overflowY: 'auto', cursor: 'text' }}
                    onMouseDown={(e) => {
                        if (e.target.closest('.ProseMirror')) return; // let it place the cursor normally
                        e.preventDefault();
                        noteEditorRef.current?.focus();
                    }}
                >
                    <Suspense fallback={<div className="spotlight-ai-hint">Loading editor…</div>}>
                        <TiptapEditor
                            ref={noteEditorRef}
                            content={activeNote.text}
                            onChange={(html) => editWorkspace.updateNoteContent(activeNote.id, html)}
                            showFloatingMenu={false}
                            showBubbleMenu={false}
                        />
                    </Suspense>
                </div>
            </div>
        ) : (
        <div className="spotlight-results" style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Items, todos and notes all render as ResultItem rows —
                the same component/styling the normal search results
                list uses — so this reads as one consistent list
                instead of a separate custom style per section.
                Reuses .spotlight-results (not .spotlight-ai-messages,
                which is chat-bubble spacing built for /agent's
                transcript) so row density matches normal search exactly.
                Items are always the first `itemsCount` entries of
                editWorkspaceItems, so index i here already is the
                combined ↑↓ index. */}
            {items.length === 0 && (
                <div className="spotlight-ai-hint">No links or apps yet — search above to add one.</div>
            )}
            {items.map((it, i) => {
                const resultItem = it.kind === 'url'
                    ? { id: `url:${it.url}`, type: 'bookmark', title: it.name, url: it.url }
                    : { id: `app:${it.path}`, type: it.appType === 'folder' ? 'folder' : (it.appType === 'file' ? 'file' : 'app'), title: it.name, path: it.path, icon: it.icon };
                return (
                    <ResultItem
                        key={resultItem.id}
                        item={resultItem}
                        index={i}
                        isSelected={!query.trim() && i === selectedIndex}
                        onSelect={() => openExistingWorkspaceItem(it)}
                        onHover={setSelectedIndex}
                        onRemove={() => (it.kind === 'url' ? editWorkspace.removeUrl(it.url) : editWorkspace.removeApp(it.path))}
                        formatUrl={formatUrl}
                        getBadgeLabel={getBadgeLabel}
                        getAppIcon={getAppIcon}
                    />
                );
            })}

            {/* Todos — the "Todo"/"Done" badge (see getBadgeLabel)
                already identifies these rows; Enter edits the text
                inline, Space toggles done. */}
            {editWorkspace.todos.map((t, tIdx) => {
                const combinedIdx = itemsCount + tIdx;
                const isEditing = editWorkspace.editingTodoId === t.id;
                // Same shell (icon box, padding, left accent) as
                // ResultItem in both states, so editing a todo
                // doesn't visually jump out of the list.
                return isEditing ? (
                    <div key={t.id} className="result-item result-todo" style={{ cursor: 'text' }}>
                        <div className="result-icon"><FontAwesomeIcon icon={faTasks} /></div>
                        <input
                            autoFocus
                            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', font: 'inherit' }}
                            defaultValue={t.text}
                            onBlur={(e) => editWorkspace.updateTodoText(t.id, e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); editWorkspace.updateTodoText(t.id, e.target.value); }
                                if (e.key === 'Escape') { e.preventDefault(); editWorkspace.cancelEditTodo(); }
                            }}
                        />
                    </div>
                ) : (
                    <ResultItem
                        key={t.id}
                        item={{
                            id: `todo:${t.id}`, type: 'todo', title: t.text, done: t.done,
                            description: t.done ? 'Done — click to reopen' : 'Click to mark done',
                        }}
                        index={combinedIdx}
                        isSelected={!query.trim() && combinedIdx === selectedIndex}
                        onSelect={() => editWorkspace.toggleTodo(t.id)}
                        onHover={setSelectedIndex}
                        onRemove={() => editWorkspace.removeTodo(t.id)}
                        formatUrl={formatUrl}
                        getBadgeLabel={getBadgeLabel}
                        getAppIcon={getAppIcon}
                    />
                );
            })}

            {/* Notes — the "Note" badge already identifies these
                rows; Enter opens the Tiptap editor above. */}
            {editWorkspace.notes.map((n, nIdx) => {
                const combinedIdx = itemsCount + todosCount + nIdx;
                return (
                    <ResultItem
                        key={n.id}
                        item={{
                            id: `note:${n.id}`, type: 'note',
                            title: n.title || editWorkspace.stripHtml(n.text).slice(0, 60) || 'Untitled',
                        }}
                        index={combinedIdx}
                        isSelected={!query.trim() && combinedIdx === selectedIndex}
                        onSelect={() => editWorkspace.openNote(n.id)}
                        onHover={setSelectedIndex}
                        onRemove={() => editWorkspace.removeNote(n.id)}
                        formatUrl={formatUrl}
                        getBadgeLabel={getBadgeLabel}
                        getAppIcon={getAppIcon}
                    />
                );
            })}
        </div>
        )}
    </div>
    );
}
