import { resultToWorkspaceItem } from '../resultToWorkspaceItem';

// Keyboard grammar for /edit-workspace. Two distinct sub-grammars depending
// on whether the box is empty (browse existing items/todos/notes) or has
// text in it (search-to-attach, or one of the /name /todo /notes commands).
export function handleEditWorkspaceKeydown(e, {
    query, editWorkspace, editWorkspaceItems, selectedIndex, setSelectedIndex,
    openExistingWorkspaceItem, flatRows, setQuery, showFeedback,
}) {
    if (e.key === 'Escape') {
        e.preventDefault();
        // Close the innermost thing first: the note editor, then the
        // whole mode — same hierarchy Esc already follows elsewhere
        // (workspace picker → add mode → spotlight).
        // /todo · /notes keep the note beside the list, so there's no
        // editor to close first — Esc just leaves.
        if (editWorkspace.activeNoteId && !editWorkspace.focus) editWorkspace.closeNote();
        else editWorkspace.exit();
        return;
    }
    // /todo · /notes, empty box: ⌘/Ctrl+⌫ deletes the selected row.
    if (editWorkspace.focus && !query && e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const it = editWorkspaceItems[selectedIndex];
        if (it?.kind === 'todo') editWorkspace.removeTodo(it.id);
        else if (it?.kind === 'note') editWorkspace.removeNote(it.id);
        return;
    }
    // Backspace on an empty box closes it too — same grammar as
    // /agent and /new-workspace, not just Esc.
    if (e.key === 'Backspace' && !query) {
        e.preventDefault();
        editWorkspace.exit();
        return;
    }

    // Empty box: nothing to search for, so ↑↓/Enter navigate and open
    // the workspace's *existing* items instead (the chips above the
    // list) — the same "browse what's already here" the idle
    // workspace section supports, just inside this mode too.
    if (!query.trim()) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && editWorkspaceItems.length > 0) {
            e.preventDefault();
            const n = editWorkspaceItems.length;
            setSelectedIndex(prev => (e.key === 'ArrowDown'
                ? (prev + 1) % n
                : (prev <= 0 ? n - 1 : prev - 1)));
            // /notes shows the picked note beside the list: let the keyboard
            // row decide which one again.
            if (editWorkspace.focus === 'notes') editWorkspace.closeNote();
            return;
        }
        // Space *or* Shift+Enter toggles a todo's done state —
        // mouse-independent, doesn't require clicking the row — and
        // does nothing on any other row. Two keys rather than one so
        // whichever one you reach for works.
        if ((e.key === ' ' || (e.key === 'Enter' && e.shiftKey)) &&
            selectedIndex >= 0 && editWorkspaceItems[selectedIndex]?.kind === 'todo') {
            e.preventDefault();
            editWorkspace.toggleTodo(editWorkspaceItems[selectedIndex].id);
            return;
        }
        // Enter: open a url/app, edit a todo's text inline, or open a
        // note in the Tiptap editor below (see the render block).
        if (e.key === 'Enter' && !e.shiftKey && selectedIndex >= 0 && editWorkspaceItems[selectedIndex]) {
            e.preventDefault();
            const it = editWorkspaceItems[selectedIndex];
            if (it.kind === 'todo') editWorkspace.startEditTodo(it.id);
            else if (it.kind === 'note') editWorkspace.openNote(it.id);
            else openExistingWorkspaceItem(it);
            return;
        }
        return;
    }

    // /todo and /notes: the box is for adding to that list — Enter adds the
    // text as typed (no prefix needed), there's no search to attach from.
    // "/name …" still renames; "/todo …" / "/notes …" still add to that list.
    if (editWorkspace.focus && e.key === 'Enter' && !e.shiftKey && !/^\/(name|todo|notes?)\s/i.test(query.trim())) {
        e.preventDefault();
        if (editWorkspace.focus === 'todo') {
            editWorkspace.addTodo(query);
        } else {
            // A new note opens beside the list, ready to keep writing.
            Promise.resolve(editWorkspace.addNote(query)).then(id => {
                if (id) { editWorkspace.openNote(id); setSelectedIndex(0); }
            });
        }
        setQuery('');
        return;
    }
    if (editWorkspace.focus && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return;

    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = query.trim();
        // Three in-box commands cover everything besides "search to
        // attach a link/folder" — no separate add-fields to tab
        // between. "/name" matches /agent's own rename shortcut.
        const nameMatch = /^\/name\s+(.+)$/i.exec(trimmed);
        if (nameMatch) {
            editWorkspace.rename(nameMatch[1]);
            setQuery('');
            return;
        }
        const todoMatch = /^\/todo\s+(.+)$/i.exec(trimmed);
        if (todoMatch) {
            editWorkspace.addTodo(todoMatch[1]);
            setQuery('');
            return;
        }
        const noteMatch = /^\/notes?\s+(.+)$/i.exec(trimmed);
        if (noteMatch) {
            editWorkspace.addNote(noteMatch[1]);
            setQuery('');
            return;
        }
        // A highlighted result attaches as an item — same interaction
        // as /new-workspace's folder step and /agent's context chips.
        if (selectedIndex >= 0 && flatRows[selectedIndex]) {
            const mapped = resultToWorkspaceItem(flatRows[selectedIndex].item);
            if (mapped) {
                editWorkspace.addItem(mapped);
            } else {
                showFeedback("That can't be added to a workspace", 'error');
            }
            setQuery('');
        }
        return;
    }
    if (e.key === 'ArrowDown' && flatRows.length > 0) {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % flatRows.length);
        return;
    }
    if (e.key === 'ArrowUp' && flatRows.length > 0) {
        e.preventDefault();
        setSelectedIndex(prev => (prev <= 0 ? flatRows.length - 1 : prev - 1));
    }
}
