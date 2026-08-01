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
import { syncWebSocket } from '../../services/syncWebSocket.js';
import { discoverCooldeskProjects } from '../../services/cooldeskService.js';
import { saveWorkspace } from '../../db/unified-api';

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
 * Create the workspace that makes a `.cooldesk/` project visible, unless the app
 * already has one for that folder.
 *
 * Shared by both discovery routes (live announce and disk scan) so a project
 * looks identical however it was found.
 *
 * @param {string} path project root that owns the `.cooldesk/` folder
 * @param {object} project the manifest's `project` block, if the caller has it
 * @param {Array} workspaces current workspaces, to detect "already known"
 * @param {Set<string>} claimed lowercased paths already handled this session
 * @returns {Promise<boolean>} true when a workspace was created
 */
async function ensureWorkspace(path, project, workspaces, claimed) {
    if (!path) return false;

    const key = String(path).toLowerCase();
    if (claimed.has(key)) return false;

    const known = workspaces.some((ws) =>
        workspaceFolderPaths(ws).some((p) => samePath(p, path)));
    if (known) return false;

    claimed.add(key);

    const p = project || {};
    const name = p.name || baseName(path);
    // cooldesk.json is free-form about status; the workspace schema is not.
    const status = ['active', 'planning', 'on-hold'].includes(p.status) ? p.status : 'active';

    try {
        await saveWorkspace({
            id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            description: p.description || `CoolDesk project at ${path}`,
            createdAt: Date.now(),
            gridType: 'ItemGrid',
            status,
            urls: [],
            // The folder app is what makes this a project workspace: every
            // `.cooldesk/` reader resolves its root from exactly this entry.
            apps: [{ name, path, appType: 'folder' }],
        });
        console.log('[cooldesk] auto-created workspace for', path);
        return true;
    } catch (err) {
        // Let a later announce/scan retry rather than swallowing the project.
        claimed.delete(key);
        console.warn('[cooldesk] auto-create failed for', path, err?.message || err);
        return false;
    }
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
        await ensureWorkspace(payload?.path, payload?.project, workspacesRef.current, claimed.current);
    }, []);

    useEffect(() => syncWebSocket.on('cooldesk', handle), [handle]);
}

/** Projects a scan has already offered, so deleting an auto-created workspace sticks. */
const SEEN_KEY = 'cooldesk.discovered.v1';

function loadSeen() {
    try {
        const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw.map((p) => String(p).toLowerCase()) : []);
    } catch {
        return new Set();
    }
}

function saveSeen(seen) {
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch { /* quota / private mode — the scan just repeats next launch */ }
}

/**
 * Find `.cooldesk/` projects already on disk and turn them into workspaces.
 *
 * The announce hook only covers projects touched while the app runs. Everything
 * initialised before CoolDesk was installed, on a reinstall, or on a second
 * machine after a `git pull`, was invisible — the folder is committed to the
 * repo, but nothing looked for it. This scans once per launch and fills the gap.
 *
 * A project is only ever *offered* once: paths are remembered in localStorage, so
 * a workspace the user deletes on purpose does not reappear on the next launch.
 *
 * @param {Array} savedWorkspaces current workspaces, used to detect "already known"
 * @param {{ enabled?: boolean, roots?: string[] }} [opts] `enabled` gates the scan
 *        to the desktop app (the sidecar doesn't exist in the extension).
 */
export function useCooldeskDiscovery(savedWorkspaces = [], opts = {}) {
    const { enabled = true, roots } = opts;

    const workspacesRef = useRef(savedWorkspaces);
    workspacesRef.current = savedWorkspaces;

    // Depend on a joined string, not the array itself, so an inline `roots={[]}`
    // from a caller can't restart the scan on every render.
    const rootsKey = (roots || []).join(',');

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        (async () => {
            // Workspaces load from IndexedDB after mount, and scanning against a
            // list that hasn't arrived yet would duplicate every project. Wait for
            // it — but not forever, since a genuinely empty install stays empty
            // and still needs its projects.
            for (let i = 0; i < 20 && !workspacesRef.current.length; i += 1) {
                await sleep(200);
                if (cancelled) return;
            }

            const projects = await discoverCooldeskProjects(rootsKey ? rootsKey.split(',') : []);
            if (cancelled || !projects.length) return;

            const seen = loadSeen();
            const claimed = new Set();
            let created = 0;
            for (const proj of projects) {
                if (cancelled) break;
                if (seen.has(String(proj.path).toLowerCase())) continue;
                const made = await ensureWorkspace(
                    proj.path, proj.project, workspacesRef.current, claimed);
                // Mark it seen either way: a project that already has a workspace
                // never needs offering again.
                seen.add(String(proj.path).toLowerCase());
                if (made) created += 1;
            }
            saveSeen(seen);
            if (created) console.log(`[cooldesk] discovery added ${created} project workspace(s)`);
        })();

        return () => { cancelled = true; };
    }, [enabled, rootsKey]);
}
