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
     * Find the running-app entry backing a workspace app, or null. The match is
     * intentionally fuzzy: exact path first, then name equality/containment,
     * then editor-process matching for folder-path editor entries.
     * The returned entry carries pid/hwnd, so callers can focus instead of
     * relaunching.
     */
    findRunningApp(app) {
        if (!app) return null;
        const path = (app.path || '').toLowerCase();
        const name = (app.name || '').toLowerCase().trim();
        const needle = editorProcessNeedle(app);
        return this.runningApps.find((r) => {
            const rPath = (r.path || '').toLowerCase();
            const rName = (r.name || '').toLowerCase().trim();
            if (path && rPath && rPath === path) return true;
            if (name && rName && (rName === name || rName.includes(name) || name.includes(rName))) return true;
            if (needle && rName.includes(needle)) return true;
            return false;
        }) || null;
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
        const activeApps = apps.filter((a) => this.findRunningApp(a));
        const openUrls = urls.filter((u) => this.findOpenTab(u.url));
        return { activeApps, openUrls, activeCount: activeApps.length + openUrls.length };
    }
}

export const workspaceActivityService = new WorkspaceActivityService();
