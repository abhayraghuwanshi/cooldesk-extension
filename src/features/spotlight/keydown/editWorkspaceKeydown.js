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
        if (editWorkspace.activeNoteId) editWorkspace.closeNote();
        else editWorkspace.exit();
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
        if (e.key === 'ArrowDown' && editWorkspaceItems.length > 0) {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % editWorkspaceItems.length);
            return;
        }
        if (e.key === 'ArrowUp' && editWorkspaceItems.length > 0) {
            e.preventDefault();
            setSelectedIndex(prev => (prev <= 0 ? editWorkspaceItems.length - 1 : prev - 1));
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
