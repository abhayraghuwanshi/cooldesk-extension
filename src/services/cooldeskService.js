import { SIDECAR_HTTP } from '../shared/config/sidecar.js';
/**
 * CoolDesk workspace-folder service.
 *
 * Reads a project's committed `.cooldesk/` folder (authored by the CoolDesk Claude Code
 * plugin) via the Rust sidecar and normalizes it for the UI. Read-only with one exception:
 * `linkCooldeskProject()` writes group membership (see its docblock). Everything else is
 * authored by the plugin/AI, and the app only renders it.
 */

const SIDECAR_URL = SIDECAR_HTTP;

/**
 * Fetch and normalize the `.cooldesk/` workspace for a project folder path.
 * @param {string} projectPath absolute path to the project root (the folder that contains `.cooldesk/`)
 * @returns {Promise<{
 *   exists: boolean,
 *   path: string,
 *   project: object|null,
 *   resources: Array,
 *   dock: object|null,
 *   sidebar: object|null,
 *   todos: Array,
 *   commands: Array,
 *   services: Array,
 *   readme: string|null,
 *   architecture: string|null,
 *   decisions: string|null,
 *   docs: object,
 * }>}
 */
export async function fetchCooldesk(projectPath) {
    if (!projectPath) return { exists: false, path: projectPath, ...emptyShape() };
    try {
        const res = await fetch(`${SIDECAR_URL}/cooldesk?path=${encodeURIComponent(projectPath)}`);
        if (!res.ok) return { exists: false, path: projectPath, ...emptyShape() };
        const raw = await res.json();
        if (!raw?.exists) return { exists: false, path: projectPath, ...emptyShape() };

        const m = raw.manifest || {};
        return {
            exists: true,
            path: raw.path,
            project: m.project || null,
            resources: Array.isArray(m.resources) ? m.resources : [],
            dock: m.dock || null,
            sidebar: m.sidebar || null,
            auto: m.auto || null,
            todos: Array.isArray(raw.todos?.todos) ? raw.todos.todos : [],
            commands: Array.isArray(raw.commands?.commands) ? raw.commands.commands : [],
            services: Array.isArray(raw.services?.services) ? raw.services.services : [],
            readme: raw.readme ?? null,
            architecture: raw.architecture ?? null,
            decisions: raw.decisions ?? null,
            // `.cooldesk/notes/*.md` with contents ([{ name, content }]).
            notes: Array.isArray(raw.notes) ? raw.notes : [],
            // Personal resources from `.cooldesk/local/resources.json` —
            // gitignored, so local file paths and browsing-derived links live
            // here instead of the committed manifest above.
            localResources: Array.isArray(raw.local?.resources) ? raw.local.resources : [],
            docs: raw.docs || {},
            // Linking: a hub project's group + resolved member projects (star model).
            group: raw.group || null,
            // The other side of the star: a member's single back-pointer to its
            // hub, resolved to an absolute path by the reader.
            hub: raw.hub || null,
            members: Array.isArray(raw.members)
                ? raw.members.map(mem => ({
                    name: mem.name || mem.project?.name || null,
                    path: mem.path,
                    repo: mem.repo || null,
                    exists: !!mem.exists,
                    project: mem.project || null,
                    resources: Array.isArray(mem.resources) ? mem.resources : [],
                    todos: Array.isArray(mem.todos?.todos) ? mem.todos.todos : [],
                    commands: Array.isArray(mem.commands?.commands) ? mem.commands.commands : [],
                    services: Array.isArray(mem.services?.services) ? mem.services.services : [],
                    docs: mem.docs || {},
                    readme: mem.readme ?? null,
                    architecture: mem.architecture ?? null,
                    decisions: mem.decisions ?? null,
                    notes: Array.isArray(mem.notes) ? mem.notes : [],
                }))
                : [],
        };
    } catch (err) {
        // Sidecar down or not a cooldesk project — degrade quietly.
        console.warn('[cooldesk] fetch failed:', err?.message || err);
        return { exists: false, path: projectPath, ...emptyShape() };
    }
}

/**
 * Link (or unlink) another project into this one's group — the single exception
 * to this service being read-only. The sidecar writes the same `group.json` +
 * member back-pointer that the `/cd-link` plugin command produces, so a group
 * built here and one built by the plugin are indistinguishable.
 *
 * @param {string} hubPath project that owns the group (the one being viewed)
 * @param {string} memberPath project to add to / remove from that group
 * @param {{ unlink?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, cooldesk?: object }>}
 */
export async function linkCooldeskProject(hubPath, memberPath, opts = {}) {
    if (!hubPath || !memberPath) return { ok: false, error: 'Missing project path' };
    try {
        const res = await fetch(`${SIDECAR_URL}/cooldesk/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hub: hubPath, member: memberPath, unlink: !!opts.unlink }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) {
            return { ok: false, error: body?.error || `Request failed (${res.status})` };
        }
        return { ok: true, cooldesk: body.cooldesk };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

/**
 * Announce that a project's `.cooldesk/` folder was just created or changed,
 * so a running app picks it up immediately instead of waiting for a component
 * to remount. This is the same endpoint the plugin's hooks used to POST after
 * every write — calling it directly from `/create-workspace` is what makes a
 * freshly scaffolded project show up (and, if no workspace pointed at that
 * folder yet, get one auto-created — see `useCooldeskAutoWorkspace`) without
 * installing the plugin at all.
 *
 * @param {string} projectPath project root that owns the `.cooldesk/` folder
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
/**
 * Add/remove a project's resources.
 *
 * `scope: 'local'` → `.cooldesk/local/resources.json`, personal and gitignored
 * (the sidecar adds the ignore rule itself and refuses to write if git would
 * still pick the file up). `scope: 'shared'` → `cooldesk.json` resources,
 * committed for teammates; the sidecar rejects absolute/`file:` paths there.
 * Announces on success so every open `.cooldesk/` reader refreshes.
 *
 * @param {string} projectPath
 * @param {{scope: 'local'|'shared', add?: object[], remove?: string[]}} change
 * @returns {Promise<{ok: true, cooldesk: object} | {ok: false, error: string}>}
 */
export async function updateCooldeskResources(projectPath, { scope, add = [], remove = [] }) {
    if (!projectPath) return { ok: false, error: 'Missing project path' };
    try {
        const res = await fetch(`${SIDECAR_URL}/cooldesk/resources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath, scope, add, remove }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) {
            return { ok: false, error: body?.error || `Request failed (${res.status})` };
        }
        await announceCooldesk(projectPath);
        return { ok: true, cooldesk: body.cooldesk };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

export async function announceCooldesk(projectPath) {
    if (!projectPath) return { ok: false, error: 'Missing project path' };
    try {
        const res = await fetch(`${SIDECAR_URL}/cooldesk/announce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) {
            return { ok: false, error: body?.error || `Request failed (${res.status})` };
        }
        return { ok: true, path: body.path };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

/**
 * Scan the usual project folders for committed `.cooldesk/` workspaces.
 *
 * `fetchCooldesk` can only read a project whose path you already know, and the
 * only other source is the plugin's live announce — so a repo initialised while
 * the app was closed was never seen at all. This asks the sidecar to go find
 * them, which is what turns `.cooldesk/` folders into workspaces on first launch.
 *
 * @param {string[]} [roots] extra folders to scan, on top of the default dev dirs
 * @returns {Promise<Array<{ path: string, name: string, project: object|null, isHub: boolean }>>}
 */
export async function discoverCooldeskProjects(roots = []) {
    try {
        const qs = new URLSearchParams();
        if (roots.length) qs.set('roots', roots.filter(Boolean).join(','));
        const url = `${SIDECAR_URL}/cooldesk/discover${qs.toString() ? `?${qs}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const body = await res.json();
        return Array.isArray(body?.projects) ? body.projects : [];
    } catch (err) {
        console.warn('[cooldesk] discover failed:', err?.message || err);
        return [];
    }
}

/** Convenience: just the open (non-done) shared todos for a project. */
export async function fetchCooldeskTodos(projectPath) {
    const cd = await fetchCooldesk(projectPath);
    return collectSharedTodos(cd);
}

/**
 * All open shared todos across the hub project and any linked group members,
 * each tagged with the originating project name. Falls back to just the hub's
 * todos when the project isn't part of a group.
 */
export function collectSharedTodos(cd) {
    if (!cd?.exists) return [];
    const out = [];
    const hubName = cd.project?.name || 'this project';
    for (const t of cd.todos) out.push({ ...t, project: hubName });
    for (const mem of linkedMembers(cd)) {
        const memName = mem.project?.name || mem.name || 'linked';
        for (const t of mem.todos) out.push({ ...t, project: memName });
    }
    return out.filter((t) => t.status !== 'done');
}

/** Members excluding the hub itself (the hub is often listed in its own group.json). */
function linkedMembers(cd) {
    const hubId = cd.project?.id;
    return (cd.members || []).filter(m => (m.project?.id || m.name) !== hubId);
}

/** True when this project links out to other projects as a group hub. */
export function isGrouped(cd) {
    return !!(cd?.group && (cd.members?.length || 0) > 1);
}

/**
 * All run commands across the hub and any linked members, each tagged with its
 * project name. Falls back to just the hub's commands for a single project.
 */
export function collectCommands(cd) {
    if (!cd?.exists) return [];
    const out = [];
    const hubName = cd.project?.name || 'this project';
    for (const c of cd.commands) out.push({ ...c, project: hubName, projectPath: cd.path });
    for (const mem of linkedMembers(cd)) {
        const memName = mem.project?.name || mem.name || 'linked';
        for (const c of mem.commands || []) out.push({ ...c, project: memName, projectPath: mem.path });
    }
    return out;
}

/**
 * Shared docs files (notes/knowledge/prompts/workflows) across the hub and members,
 * flattened to { kind, file, project }.
 */
export function collectDocs(cd) {
    if (!cd?.exists) return [];
    const out = [];
    const push = (docs, project) => {
        for (const kind of ['notes', 'knowledge', 'prompts', 'workflows']) {
            for (const file of (docs?.[kind] || [])) out.push({ kind, file, project });
        }
    };
    push(cd.docs, cd.project?.name || 'this project');
    for (const mem of linkedMembers(cd)) push(mem.docs, mem.project?.name || mem.name || 'linked');
    return out;
}

function emptyShape() {
    return {
        project: null, resources: [], dock: null, sidebar: null, auto: null,
        todos: [], commands: [], services: [],
        readme: null, architecture: null, decisions: null, notes: [], docs: {},
        localResources: [],
        group: null, members: [],
    };
}
