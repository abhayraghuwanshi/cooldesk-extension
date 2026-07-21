/**
 * CoolDesk workspace-folder service.
 *
 * Reads a project's committed `.cooldesk/` folder (authored by the CoolDesk Claude Code
 * plugin) via the Rust sidecar and normalizes it for the UI. Read-only: the app renders
 * this project knowledge but does not write it — the plugin/AI owns authoring.
 */

const SIDECAR_URL = 'http://localhost:4545';

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
            docs: raw.docs || {},
        };
    } catch (err) {
        // Sidecar down or not a cooldesk project — degrade quietly.
        console.warn('[cooldesk] fetch failed:', err?.message || err);
        return { exists: false, path: projectPath, ...emptyShape() };
    }
}

/** Convenience: just the open (non-done) shared todos for a project. */
export async function fetchCooldeskTodos(projectPath) {
    const cd = await fetchCooldesk(projectPath);
    return cd.todos.filter((t) => t.status !== 'done');
}

function emptyShape() {
    return {
        project: null, resources: [], dock: null, sidebar: null, auto: null,
        todos: [], commands: [], services: [],
        readme: null, architecture: null, decisions: null, docs: {},
    };
}
