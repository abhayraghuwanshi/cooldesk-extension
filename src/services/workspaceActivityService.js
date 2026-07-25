/**
 * Maps workspace elements (apps, urls) to their live state on this machine:
 * which apps are currently running, which urls are open in a synced browser
 * tab. One shared poll loop + one set of matching heuristics, so every surface
 * (dock bar, workspace cards, panels) shows the same "active" answer without
 * its own polling.
 *
 * Running apps ride on runningAppsService's existing poll; open tabs come from
 * the sidecar (`electronAPI.getTabs()` → GET /tabs), refreshed while at least
 * one subscriber is attached.
 */

import { runningAppsService } from './runningAppsService';

const TABS_POLL_MS = 8000;

// Editor-style apps store a folder/file as `path`, so path matching fails —
// match the editor process by its appType instead ("code" → "Visual Studio Code").
const CUSTOM_EDITORS = ['vscode', 'code', 'cursor', 'windsurf', 'idea', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rider', 'clion', 'rubymine', 'fleet', 'zed'];
const editorProcessNeedle = (app) => {
    const t = app?.appType?.toLowerCase();
    if (!t || !CUSTOM_EDITORS.includes(t)) return null;
    return t === 'vscode' ? 'code' : t;
};

/** Normalize a URL for "is this tab open" comparison: hostname + path, no
 *  www/protocol/trailing-slash/query noise. */
export const normalizeUrl = (raw) => {
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').toLowerCase();
    } catch {
        return String(raw || '').toLowerCase();
    }
};

class WorkspaceActivityService {
    constructor() {
        this.runningApps = [];
        this.openTabs = [];
        /** path (lowercased) → shell display name (lowercased), null while pending */
        this.folderNames = new Map();
        this.subscribers = new Set();
        this.unsubRunning = null;
        this.tabsTimer = null;
    }

    /**
     * @param {Function} callback - Called with { runningApps, openTabs } now and
     *   on every refresh.
     * @returns {Function} Unsubscribe function.
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        if (this.subscribers.size === 1) this.start();
        callback(this.snapshot());
        return () => {
            this.subscribers.delete(callback);
            if (this.subscribers.size === 0) this.stop();
        };
    }

    snapshot() {
        return { runningApps: this.runningApps, openTabs: this.openTabs };
    }

    start() {
        this.unsubRunning = runningAppsService.subscribe(({ runningApps }) => {
            this.runningApps = runningApps || [];
            this.notify();
        });
        const loadTabs = async () => {
            try {
                const tabs = await window.electronAPI?.getTabs?.();
                if (Array.isArray(tabs)) {
                    this.openTabs = tabs;
                    this.notify();
                }
            } catch { /* sidecar not up / extension offline — keep last known */ }
        };
        loadTabs();
        this.tabsTimer = setInterval(loadTabs, TABS_POLL_MS);
    }

    stop() {
        if (this.unsubRunning) { this.unsubRunning(); this.unsubRunning = null; }
        if (this.tabsTimer) { clearInterval(this.tabsTimer); this.tabsTimer = null; }
    }

    notify() {
        const snap = this.snapshot();
        for (const cb of this.subscribers) {
            try { cb(snap); } catch (e) { console.error('[WorkspaceActivity] Subscriber error:', e); }
        }
    }

    /**
     * Find the running-app entry backing a workspace app, or null. The returned
     * entry carries pid/hwnd, so callers can focus instead of relaunching.
     *
     * Matching runs in strict-to-loose passes, each sweeping the *whole* list
     * before the next is tried. A single pass testing every rule per entry lets
     * a weak match on an early entry beat the exact match sitting later in the
     * list — e.g. a workspace app named "Code" claimed by any running window
     * whose name merely contains "code", never reaching the entry whose path
     * actually matches.
     */
    findRunningApp(app) {
        if (!app) return null;
        const path = (app.path || '').toLowerCase();
        const name = (app.name || '').toLowerCase().trim();
        const needle = editorProcessNeedle(app);
        const entries = this.runningApps;
        const rPath = (r) => (r.path || '').toLowerCase();
        const rName = (r) => (r.name || '').toLowerCase().trim();

        // 1. Exact executable path — the only unambiguous signal.
        if (path) {
            const exact = entries.find((r) => rPath(r) && rPath(r) === path);
            if (exact) return exact;
        }

        // 2. Editor processes, for entries whose `path` is a folder/file the
        //    editor opens rather than the editor binary itself.
        if (needle) {
            const editor = entries.find((r) => rName(r).includes(needle));
            if (editor) return editor;
        }

        // Files and folders have no process of their own: `path` is a document
        // or directory, and `name` is a filename that collides freely with
        // process names ("Code.md" contains "Code"). Without an exact path or
        // editor hit above, there is nothing legitimate left to match — falling
        // through to names would focus an unrelated window instead of opening
        // the item. Folders additionally have findOpenFolder for the real lookup.
        if (app.appType === 'file' || app.appType === 'folder') return null;

        // 3. Name equality, then containment — last resort for apps whose
        //    recorded path differs from the running binary's (shims, updaters,
        //    store installs that relocate between versions).
        if (name) {
            const exactName = entries.find((r) => rName(r) && rName(r) === name);
            if (exactName) return exactName;
            return entries.find((r) => {
                const n = rName(r);
                return n && (n.includes(name) || name.includes(n));
            }) || null;
        }

        return null;
    }

    /**
     * Find the File Explorer window/tab already showing a workspace folder, or
     * null.
     *
     * Folders can't go through findRunningApp: that matches a workspace entry
     * against *process* path/name, and a folder's path is a directory no process
     * ever reports. Explorer instead identifies a folder by window title — the
     * matcher deliberately keeps explorer.exe windows unclaimed (matcher.rs:231)
     * so they survive whole and get split per tab, giving one entry per open
     * folder with `tabIndex` set.
     *
     * The returned entry carries hwnd + tabIndex, so callers can focus the exact
     * tab instead of spawning another window.
     */
    findOpenFolder(folderPath) {
        const raw = String(folderPath || '').replace(/[\\/]+$/, '');
        if (!raw) return null;
        const base = raw.split(/[\\/]/).pop()?.toLowerCase();
        if (!base) return null;
        const full = raw.toLowerCase();
        // Kick off (once) the shell lookup for special folders; until it lands
        // we still match ordinary folders by basename.
        const display = this.folderDisplayName(raw);
        return this.runningApps.find((r) => {
            const exe = (r.path || '').toLowerCase();
            const name = (r.name || '').toLowerCase();
            const isExplorer = exe.endsWith('explorer.exe') || name.includes('explorer');
            if (!isExplorer) return false;
            // Explorer titles a tab with the folder's display name, or the full
            // path when "display full path in title bar" is enabled.
            const title = (r.title || '').trim().toLowerCase();
            return title === base || title === full || (!!display && title === display);
        }) || null;
    }

    /**
     * Cached shell display name for a folder, lowercased — "documents",
     * "local disk (c:)" — which is what Explorer actually titles the tab.
     *
     * Synchronous by necessity: this feeds render (the active dot). Returns null
     * on the first call for a path and starts the async lookup; the resulting
     * notify() re-renders subscribers with the answer in place. Basename
     * matching covers ordinary folders in the meantime.
     */
    folderDisplayName(path) {
        const key = path.toLowerCase();
        if (this.folderNames.has(key)) return this.folderNames.get(key);

        this.folderNames.set(key, null); // pending — don't re-request
        window.electronAPI?.folderDisplayName?.(path)
            .then((name) => {
                const value = name ? String(name).trim().toLowerCase() : null;
                // Only notify when this actually adds something basename didn't.
                if (value && value !== this.folderNames.get(key)) {
                    this.folderNames.set(key, value);
                    this.notify();
                }
            })
            .catch(() => { /* keep null; basename matching still applies */ });
        return null;
    }

    /** Find the open tab showing a workspace url (or a page under it), or null. */
    findOpenTab(url) {
        if (!url) return null;
        const target = normalizeUrl(url);
        if (!target) return null;
        return this.openTabs.find((t) => {
            const open = normalizeUrl(t.url);
            return open === target || open.startsWith(`${target}/`);
        }) || null;
    }

    /** Convenience: active-state summary for a whole workspace. */
    getWorkspaceActivity(workspace) {
        const apps = workspace?.apps || [];
        const urls = workspace?.urls || [];
        // Folders resolve through Explorer window titles, not process matching —
        // findRunningApp deliberately returns null for them.
        const activeApps = apps.filter((a) =>
            a?.appType === 'folder' ? this.findOpenFolder(a.path) : this.findRunningApp(a)
        );
        const openUrls = urls.filter((u) => this.findOpenTab(u.url));
        return { activeApps, openUrls, activeCount: activeApps.length + openUrls.length };
    }
}

export const workspaceActivityService = new WorkspaceActivityService();
