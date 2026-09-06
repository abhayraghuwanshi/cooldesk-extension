import { useCallback, useState } from 'react';

// Same plain-text ↔ rich-text bridge WorkspaceContextPanel.jsx uses, so a note
// created here reads correctly when later opened in its Tiptap editor there,
// and a note written there previews correctly here.
const stripHtml = (html) =>
    (html || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
const wrapPlain = (text) => `<p>${(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;

/**
 * Typing an existing workspace's own name directly as a command (e.g.
 * "/cool-verse") opens it here. One input does everything: search text
 * attaches a link/folder (see addItem), and three in-box commands cover
 * everything else — `/name <title>` renames, `/todo <text>` adds a todo,
 * `/notes <text>` adds a note — no separate add-fields to tab between.
 * Existing links/apps/todos/notes render as one navigable list (see
 * editWorkspaceItems in GlobalSpotlight.jsx); notes and todos use the same
 * fields the full WorkspaceContextPanel uses, so nothing round-trips oddly
 * if you later open it there.
 *
 * Every mutation goes through `applyActions`/`workspaceActions.js` — the same
 * validated whitelist /agent's own proposals use — rather than a second
 * hand-rolled save path.
 */
export function useEditWorkspaceMode({ showFeedback, setCommandMode, setQuery, setWorkspaces, onExit }) {
    const [workspaceId, setWorkspaceId] = useState(null);
    const [workspace, setWorkspace] = useState(null); // the live record
    const [notes, setNotes] = useState([]);
    const [todos, setTodos] = useState([]);
    const [renaming, setRenaming] = useState(false);
    // A note open in the Tiptap editor (replaces the list view) — id only,
    // the live record is read back out of `notes` so edits stay in sync with
    // the list underneath it.
    const [activeNoteId, setActiveNoteId] = useState(null);
    // A todo whose text is being edited inline (its row swaps to an input).
    const [editingTodoId, setEditingTodoId] = useState(null);

    const enter = useCallback(async (ws) => {
        setCommandMode('edit-workspace');
        setWorkspaceId(ws.id);
        setWorkspace(ws); // shown immediately; replaced below once the fresh copy lands
        setActiveNoteId(null);
        setEditingTodoId(null);
        setQuery('');
        try {
            const [{ listWorkspaces, listWorkspaceNotes, listWorkspaceTodos }] = await Promise.all([
                import('../../db/index.js'),
            ]);
            const [wsRes, n, t] = await Promise.all([
                listWorkspaces(), listWorkspaceNotes(ws.id), listWorkspaceTodos(ws.id),
            ]);
            const list = wsRes?.success ? wsRes.data : (Array.isArray(wsRes) ? wsRes : []);
            const fresh = list.find(w => w.id === ws.id);
            if (fresh) setWorkspace(fresh); // the cached row passed in may be stale
            setNotes(n?.data || n || []);
            setTodos(t?.data || t || []);
        } catch (e) {
            console.warn('[Spotlight] edit-workspace: failed to load notes/todos', e);
        }
    }, [setCommandMode, setQuery]);

    const exit = useCallback(() => {
        setCommandMode(null);
        setQuery('');
        setWorkspaceId(null);
        setWorkspace(null);
        setNotes([]);
        setTodos([]);
        setActiveNoteId(null);
        setEditingTodoId(null);
        // Lets an external trigger (a workspace card's right-click "Edit" —
        // see GlobalSpotlight.jsx's editTarget prop) know the mode closed, so
        // it can clear its own target and the same trigger works again.
        onExit?.();
    }, [setCommandMode, setQuery, onExit]);

    /** Open a note in the Tiptap editor — replaces the list view until closed. */
    const openNote = useCallback((id) => setActiveNoteId(id), []);
    const closeNote = useCallback(() => setActiveNoteId(null), []);

    /** Re-read the workspace record after a mutation (id is stable across rename). */
    const refreshWorkspace = useCallback(async () => {
        const { listWorkspaces } = await import('../../db/index.js');
        const res = await listWorkspaces();
        const list = res?.success ? res.data : (Array.isArray(res) ? res : []);
        const fresh = list.find(w => w.id === workspaceId);
        if (fresh) setWorkspace(fresh);
        // Keep the spotlight's own workspace list in sync too — the
        // "type an existing workspace's name" detection reads that cached
        // list, and a rename here must be visible to it immediately.
        setWorkspaces?.(list);
        return fresh || null;
    }, [workspaceId, setWorkspaces]);

    /** Add a picked search result (url or app/folder/file) as a workspace item. */
    const addItem = useCallback(async (mapped) => {
        if (!mapped || !workspace) return;
        const { applyActions } = await import('../../services/workspaceActions');
        const action = mapped.kind === 'url'
            ? { type: 'add_url', workspace: workspace.name, url: mapped.url, title: mapped.title }
            : { type: 'add_app', workspace: workspace.name, path: mapped.path, name: mapped.name, appType: mapped.appType };
        const { errors } = await applyActions([action], [workspace]);
        if (errors.length) { showFeedback(errors[0], 'error'); return; }
        await refreshWorkspace();
    }, [workspace, refreshWorkspace, showFeedback]);

    const removeUrl = useCallback(async (url) => {
        if (!workspace) return;
        const { applyActions } = await import('../../services/workspaceActions');
        await applyActions([{ type: 'remove_url', workspace: workspace.name, url }], [workspace]);
        await refreshWorkspace();
    }, [workspace, refreshWorkspace]);

    const removeApp = useCallback(async (path) => {
        if (!workspace) return;
        const { applyActions } = await import('../../services/workspaceActions');
        await applyActions([{ type: 'remove_app', workspace: workspace.name, path }], [workspace]);
        await refreshWorkspace();
    }, [workspace, refreshWorkspace]);

    const rename = useCallback(async (newName) => {
        const name = (newName || '').trim();
        if (!name || !workspace || name === workspace.name) return;
        setRenaming(true);
        try {
            const { applyActions } = await import('../../services/workspaceActions');
            const { applied, errors } = await applyActions(
                [{ type: 'rename_workspace', from: workspace.name, to: name }], [workspace]
            );
            if (errors.length) { showFeedback(errors[0], 'error'); return; }
            if (applied) {
                await refreshWorkspace();
                showFeedback(`Renamed to "${name}"`, 'success');
            }
        } finally {
            setRenaming(false);
        }
    }, [workspace, refreshWorkspace, showFeedback]);

    // ── Todos — same shape/store WorkspaceContextPanel.jsx uses directly ──
    const addTodo = useCallback(async (text) => {
        const trimmed = (text || '').trim();
        if (!trimmed || !workspaceId) return;
        const { saveWorkspaceTodo } = await import('../../db/index.js');
        const todo = {
            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            workspaceId, text: trimmed, done: false, createdAt: Date.now(), updatedAt: Date.now(),
        };
        setTodos(prev => [...prev, todo]);
        saveWorkspaceTodo(todo).catch(() => { });
    }, [workspaceId]);

    const toggleTodo = useCallback(async (id) => {
        const { saveWorkspaceTodo } = await import('../../db/index.js');
        setTodos(prev => {
            const next = prev.map(t => (t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t));
            const updated = next.find(t => t.id === id);
            if (updated) saveWorkspaceTodo(updated).catch(() => { });
            return next;
        });
    }, []);

    const removeTodo = useCallback(async (id) => {
        const { deleteWorkspaceTodo } = await import('../../db/index.js');
        setTodos(prev => prev.filter(t => t.id !== id));
        deleteWorkspaceTodo(id).catch(() => { });
    }, []);

    // ── Notes — plain text in this compact panel; stored as the same
    // richtext-shaped record WorkspaceContextPanel.jsx reads/writes, so
    // opening one there later isn't a surprise. ──
    const addNote = useCallback(async (text) => {
        const trimmed = (text || '').trim();
        if (!trimmed || !workspaceId) return;
        const { saveWorkspaceNote } = await import('../../db/index.js');
        const note = {
            id: `wsnote_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            workspaceId,
            title: trimmed.slice(0, 40),
            text: wrapPlain(trimmed),
            type: 'richtext',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        setNotes(prev => [note, ...prev]);
        saveWorkspaceNote(note).catch(() => { });
    }, [workspaceId]);

    const removeNote = useCallback(async (id) => {
        const { deleteNote } = await import('../../db/index.js');
        setNotes(prev => prev.filter(n => n.id !== id));
        if (activeNoteId === id) setActiveNoteId(null);
        deleteNote(id).catch(() => { });
    }, [activeNoteId]);

    /** Tiptap's onChange — HTML, debounced 150ms on its own side already. */
    const updateNoteContent = useCallback(async (id, html) => {
        const { saveWorkspaceNote } = await import('../../db/index.js');
        setNotes(prev => {
            const note = prev.find(n => n.id === id);
            if (!note) return prev;
            const updated = { ...note, text: html, updatedAt: Date.now() };
            saveWorkspaceNote(updated).catch(() => { });
            return prev.map(n => (n.id === id ? updated : n));
        });
    }, []);

    const updateNoteTitle = useCallback(async (id, title) => {
        const { saveWorkspaceNote } = await import('../../db/index.js');
        setNotes(prev => {
            const note = prev.find(n => n.id === id);
            if (!note) return prev;
            const updated = { ...note, title, updatedAt: Date.now() };
            saveWorkspaceNote(updated).catch(() => { });
            return prev.map(n => (n.id === id ? updated : n));
        });
    }, []);

    // ── Todo inline text edit (separate from toggling done) ──
    const startEditTodo = useCallback((id) => setEditingTodoId(id), []);
    const cancelEditTodo = useCallback(() => setEditingTodoId(null), []);
    const updateTodoText = useCallback(async (id, text) => {
        const trimmed = (text || '').trim();
        setEditingTodoId(null);
        if (!trimmed) return;
        const { saveWorkspaceTodo } = await import('../../db/index.js');
        setTodos(prev => {
            const next = prev.map(t => (t.id === id ? { ...t, text: trimmed, updatedAt: Date.now() } : t));
            const updated = next.find(t => t.id === id);
            if (updated) saveWorkspaceTodo(updated).catch(() => { });
            return next;
        });
    }, []);

    return {
        workspaceId, workspace, notes, todos, renaming,
        activeNoteId, openNote, closeNote, updateNoteContent, updateNoteTitle,
        editingTodoId, startEditTodo, cancelEditTodo, updateTodoText,
        enter, exit, addItem, removeUrl, removeApp, rename,
        addTodo, toggleTodo, removeTodo, addNote, removeNote,
        stripHtml,
    };
}
