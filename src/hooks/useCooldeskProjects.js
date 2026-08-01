/**
 * Live `.cooldesk/` project updates.
 *
 * The CoolDesk Claude Code plugin only writes files — it has no idea the app is
 * running. It now POSTs `/cooldesk/announce` after each write, the sidecar
 * broadcasts `cooldesk-updated`, and these hooks turn that into UI state.
 *
 * Without them a `/cd-init` or `/cd-sync` only lands after a manual refresh,
 * because every `.cooldesk/` reader is a mount-time `useEffect`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { syncWebSocket } from '../services/syncWebSocket.js';
import { saveWorkspace } from '../db/unified-api';

/** Windows paths reach us from Rust, the DB and the plugin with different
 *  separators, trailing slashes and drive-letter case — compare them normalized. */
function samePath(a, b) {
    if (!a || !b) return false;
    const norm = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    return norm(a) === norm(b);
}

function baseName(p) {
    return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Project';
}

/**
 * A counter that increments whenever the given project's `.cooldesk/` folder is
 * announced as changed. Add it to a fetch effect's dependency array to re-read.
 *
 * @param {string|null} projectPath project root that owns the `.cooldesk/` folder
 * @returns {number} bumped on each announce for this path
 */
export function useCooldeskVersion(projectPath) {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        if (!projectPath) return;
        return syncWebSocket.on('cooldesk', (payload) => {
            if (samePath(payload?.path, projectPath)) setVersion((v) => v + 1);
        });
    }, [projectPath]);
    return version;
}

/** The folder a workspace calls its project root — same rule WorkspaceCard uses:
 *  a plain folder app first, then a folder opened via an editor app. */
function workspaceFolderPaths(ws) {
    return (ws?.apps || [])
        .filter((a) => a?.path)
        .map((a) => a.path);
}

/**
 * Auto-create a workspace for a `.cooldesk/` project the app has never seen.
 *
 * Running `/cd-init` in a repo that isn't a CoolDesk workspace yet used to
 * produce nothing visible: `.cooldesk/` only ever *decorated* a workspace that
 * already had a folder app pointing at that repo. Now the announce creates one.
 *
 * Existing workspaces are left completely alone — a matching folder path means
 * the card already renders the project, and it re-reads via `useCooldeskVersion`.
 *
 * @param {Array} savedWorkspaces current workspaces, used to detect "already known"
 */
export function useCooldeskAutoWorkspace(savedWorkspaces = []) {
    // Read the latest list from the event handler without resubscribing on every
    // workspace edit — the subscription must survive unrelated list churn.
    const workspacesRef = useRef(savedWorkspaces);
    workspacesRef.current = savedWorkspaces;

    // Paths already created in this session. The plugin's SessionStart and Stop
    // hooks both announce, so the same project arrives more than once and the
    // DB write is slower than the gap between them.
    const claimed = useRef(new Set());

    const handle = useCallback(async (payload) => {
        const path = payload?.path;
        if (!path) return;

        const key = String(path).toLowerCase();
        if (claimed.current.has(key)) return;

        const known = workspacesRef.current.some((ws) =>
            workspaceFolderPaths(ws).some((p) => samePath(p, path)));
        if (known) return;

        claimed.current.add(key);

        const project = payload.project || {};
        const name = project.name || baseName(path);
        // cooldesk.json is free-form about status; the workspace schema is not.
        const status = ['active', 'planning', 'on-hold'].includes(project.status)
            ? project.status
            : 'active';

        try {
            await saveWorkspace({
                id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name,
                description: project.description || `CoolDesk project at ${path}`,
                createdAt: Date.now(),
                gridType: 'ItemGrid',
                status,
                urls: [],
                // The folder app is what makes this a project workspace: every
                // `.cooldesk/` reader resolves its root from exactly this entry.
                apps: [{ name, path, appType: 'folder' }],
            });
            console.log('[cooldesk] auto-created workspace for', path);
        } catch (err) {
            // Let a later announce retry rather than swallowing the project.
            claimed.current.delete(key);
            console.warn('[cooldesk] auto-create failed for', path, err?.message || err);
        }
    }, []);

    useEffect(() => syncWebSocket.on('cooldesk', handle), [handle]);
}
