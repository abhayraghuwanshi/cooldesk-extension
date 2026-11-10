// "Active" — everything open right now (the dock bar's Active view, the
// sidebar's Active card) — as a place of its own for todos and notes that
// don't belong to any saved workspace. It isn't a workspace record: todos and
// notes are stored with `workspaceId: ACTIVE_SPACE_ID` in the same stores as a
// workspace's, so the same panels read and write them.
export const ACTIVE_SPACE_ID = '__active__';

export const isActiveSpace = (id) => id === ACTIVE_SPACE_ID;

// Todos / notes changed for a workspace (or Active). Panels showing that
// workspace reload. Fired in this window (a DOM event) and, in the desktop
// app, to the other windows too (a Tauri event) — the spotlight is its own
// window, and its edits must show up in the sidebar.
const DOM_EVENT = 'cooldesk-ws-content-changed';
const TAURI_EVENT = 'cooldesk-ws-content-changed';
const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export function notifyWsContentChanged(workspaceId) {
    if (!workspaceId) return;
    const local = () => {
        try { window.dispatchEvent(new CustomEvent(DOM_EVENT, { detail: { workspaceId } })); } catch { /* no window */ }
    };
    // A Tauri event reaches every window, this one included — so it's one or
    // the other, never both (that would reload twice).
    if (isTauri()) {
        import('@tauri-apps/api/event')
            .then(({ emit }) => emit(TAURI_EVENT, { workspaceId }))
            .catch(local);
    } else {
        local();
    }
}

/** Calls `cb()` when `workspaceId`'s todos/notes change, here or in another
 *  window. Returns the unsubscribe function. */
export function onWsContentChanged(workspaceId, cb) {
    if (!workspaceId) return () => { };
    const onDom = (e) => { if (e.detail?.workspaceId === workspaceId) cb(); };
    window.addEventListener(DOM_EVENT, onDom);
    let unlisten = null;
    let disposed = false;
    if (isTauri()) {
        import('@tauri-apps/api/event')
            .then(({ listen }) => listen(TAURI_EVENT, (e) => { if (e.payload?.workspaceId === workspaceId) cb(); }))
            .then((fn) => { if (disposed) fn(); else unlisten = fn; })
            .catch(() => { });
    }
    return () => {
        disposed = true;
        window.removeEventListener(DOM_EVENT, onDom);
        unlisten?.();
    };
}
