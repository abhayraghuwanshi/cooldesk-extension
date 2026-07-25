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

/** Editors launch with their folder/file as an argument (`code .`) rather than
 *  being focused. Exported so the surfaces share this list instead of each
 *  keeping a copy that has to be edited in lockstep. */
export const isEditorApp = (app) => CUSTOM_EDITORS.includes(app?.appType?.toLowerCase());

/** Normalize a URL for "is this tab open" comparison: hostname + path, no
 *  www/protocol/trailing-slash noise.
 *
 *  `keepQuery` decides whether the search string survives, and callers set it
 *  from the *saved* link rather than the tab: a saved link that carries a query
 *  is asking for that specific page (two YouTube searches differ only there, and
 *  dropping it collapsed them into one indistinguishable key), while a saved
 *  link without one should still match a tab that has picked up `?sort=new`. */
export const normalizeUrl = (raw, keepQuery = false) => {
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        const base = (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
        return (keepQuery ? base + u.search : base).toLowerCase();
    } catch {
        return String(raw || '').toLowerCase();
    }
};

/** True when a saved link pins a specific query string. */
const hasQuery = (raw) => {
    try {
        return !!new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).search;
    } catch {
        return false;
    }
};

/** Workspace items are urls or apps; apps are the ones carrying a `path`. */
const isUrlItem = (item) => !!item?.url && !item?.path;

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
    findRunningApp(app, { claimed, strictOnly = false } = {}) {
        if (!app) return null;
        const path = (app.path || '').toLowerCase();
        const name = (app.name || '').toLowerCase().trim();
        const needle = editorProcessNeedle(app);
        const entries = claimed ? this.runningApps.filter((r) => !claimed.has(r)) : this.runningApps;
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
        //    store installs that relocate between versions). Containment is the
        //    only rule loose enough for two workspace apps to claim the same
        //    window ("Code" and "Code Insiders"), so `strictOnly` lets
        //    resolveAll settle every stricter rule across the whole list first.
        if (name) {
            const exactName = entries.find((r) => rName(r) && rName(r) === name);
            if (exactName) return exactName;
            if (strictOnly) return null;
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
    findOpenFolder(folderPath, { claimed } = {}) {
        const raw = String(folderPath || '').replace(/[\\/]+$/, '');
        if (!raw) return null;
        const base = raw.split(/[\\/]/).pop()?.toLowerCase();
        if (!base) return null;
        const full = raw.toLowerCase();
        // Kick off (once) the shell lookup for special folders; until it lands
        // we still match ordinary folders by basename.
        const display = this.folderDisplayName(raw);
        return this.runningApps.find((r) => {
            if (claimed?.has(r)) return false;
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

    /**
     * Find the open tab showing a workspace url (or a page under it), or null.
     *
     * Ranked, not first-past-the-post: an exact match always beats a prefix
     * match anywhere in the list. Taking the first tab that satisfied either
     * test let a broad saved link ("reddit.com") claim a tab that belonged to a
     * narrower one ("reddit.com/r/rust") — both then painted active, and the
     * broad link could never be opened because clicking it jumped to the
     * sub-page instead.
     *
     * @param {string} url
     * @param {object} [opts]
     * @param {Set}    [opts.claimed] Tabs already spoken for by another item.
     * @param {'any'|'exact'|'prefix'} [opts.mode] Restrict to one rank, so
     *   `resolveAll` can let every exact match claim before any prefix does.
     */
    findOpenTab(url, { claimed, mode = 'any' } = {}) {
        if (!url) return null;
        // Normalize both sides with the *saved* link's query policy — see
        // normalizeUrl. `loose` is always query-free: prefix containment is a
        // path relationship, and a query never participates in it.
        const keepQuery = hasQuery(url);
        const target = normalizeUrl(url, keepQuery);
        const loose = normalizeUrl(url, false);
        if (!target) return null;

        let prefixHit = null;
        for (const t of this.openTabs) {
            if (claimed?.has(t)) continue;
            if (mode !== 'prefix' && normalizeUrl(t.url, keepQuery) === target) return t;
            if (mode !== 'exact' && !prefixHit && normalizeUrl(t.url, false).startsWith(`${loose}/`)) {
                prefixHit = t;
            }
        }
        return mode === 'exact' ? null : prefixHit;
    }

    /**
     * The live thing already backing a workspace item, or null.
     *
     * This is the single lookup behind both halves of the taskbar behavior: the
     * active dot is `!!resolve(item)` and the click is `activate(item)`. Deriving
     * both from one call is the point — when the dot ran its own lookup it drifted
     * out of step with the click's, and an item would paint active but relaunch.
     *
     * Prefer `resolveAll` when rendering a whole list; it additionally stops two
     * items from claiming the same window or tab.
     */
    resolve(item, opts) {
        if (!item) return null;
        if (isUrlItem(item)) return this.findOpenTab(item.url, opts);
        if (item.appType === 'folder') return this.findOpenFolder(item.path, opts);
        return this.findRunningApp(item, opts);
    }

    /**
     * Resolve a whole list at once, giving each live target to at most one item.
     *
     * Runs strictest-first across the *entire* list before any looser rule is
     * tried, and removes each hit from the pool as it's taken. Resolving items
     * one at a time can't do this: whichever item is asked first wins on a weak
     * rule, and the item that matched exactly is left with nothing.
     *
     * @param {Array} items Workspace urls and/or apps, in any order.
     * @returns {Map} item → live target (tab or running-app entry), or null.
     */
    resolveAll(items = []) {
        const out = new Map();
        const claimed = new Set();
        const urls = items.filter(isUrlItem);
        const apps = items.filter((i) => i && !isUrlItem(i));

        const take = (item, target) => {
            if (target) claimed.add(target);
            out.set(item, target || null);
            return !!target;
        };

        // Tabs: every exact URL match claims before any prefix match is allowed.
        for (const item of urls) {
            const hit = this.findOpenTab(item.url, { claimed, mode: 'exact' });
            if (hit) take(item, hit);
        }
        for (const item of urls) {
            if (out.has(item)) continue;
            take(item, this.findOpenTab(item.url, { claimed, mode: 'prefix' }));
        }

        // Folders match on window title and apps on process path/name; both draw
        // from the same runningApps pool, so they share one claim set. Folders go
        // first — their title match is the more specific of the two.
        const folders = apps.filter((a) => a.appType === 'folder');
        const processes = apps.filter((a) => a.appType !== 'folder');
        for (const item of folders) take(item, this.findOpenFolder(item.path, { claimed }));
        for (const item of processes) {
            const hit = this.findRunningApp(item, { claimed, strictOnly: true });
            if (hit) take(item, hit);
        }
        for (const item of processes) {
            if (out.has(item)) continue;
            take(item, this.findRunningApp(item, { claimed }));
        }

        return out;
    }

    /**
     * Find-or-create: focus what's already open, otherwise launch/navigate.
     *
     * @param {object} item Workspace url or app.
     * @param {object} [opts]
     * @param {object|null} [opts.target] A target resolved by the caller. Pass it
     *   when the list was resolved through `resolveAll` (so the click reuses the
     *   render's answer), or when the item already carries live identity from the
     *   backend — Spotlight's results arrive with pid/hwnd/tabIndex attached and
     *   never need a lookup.
     */
    activate(item, { target } = {}) {
        if (!item) return;
        const api = typeof window !== 'undefined' ? window.electronAPI : null;
        const live = target !== undefined ? target : this.resolve(item);

        if (isUrlItem(item)) {
            if (live && api?.sendMessage) {
                api.sendMessage({
                    type: 'JUMP_TO_TAB',
                    tabId: live.id,
                    windowId: live.windowId,
                    url: live.url,
                    _deviceId: live._deviceId,
                    browser: live.browser,
                });
                return;
            }
            // chrome.tabs.create is preferred in the extension: more reliable
            // than window.open there, and not subject to the popup blocker.
            const tabs = globalThis.chrome?.tabs;
            if (tabs?.create) tabs.create({ url: item.url });
            else if (api?.openExternal) api.openExternal(item.url);
            else window.open(item.url, '_blank');
            return;
        }

        if (!item.path || !api) return;

        // Focus beats launch for everything except editors: an editor is already
        // running with some *other* folder open, and focusing it would silently
        // ignore the folder this item points at. Each branch returns only once it
        // has actually dispatched — a build without the focus APIs has to fall
        // through and launch rather than swallow the click.
        if (live && !isEditorApp(item)) {
            if (live.tabIndex != null && live.hwnd && api.focusAppTab) {
                api.focusAppTab(live.hwnd, live.tabIndex, live.title);
                return;
            }
            if (api.focusApp) {
                api.focusApp(live.pid, live.name, live.hwnd);
                return;
            }
        }

        if (isEditorApp(item) && api.launchAppWithArgs) {
            const cmd = item.appType.toLowerCase() === 'vscode' ? 'code' : item.appType.toLowerCase();
            api.launchAppWithArgs(cmd, [item.path]);
        } else if (item.appType === 'folder' && api.openFolder) {
            api.openFolder(item.path);
        } else if (api.launchApp) {
            api.launchApp(item.path);
        }
    }

    /** Convenience: active-state summary for a whole workspace. */
    getWorkspaceActivity(workspace) {
        const apps = workspace?.apps || [];
        const urls = workspace?.urls || [];
        const resolved = this.resolveAll([...urls, ...apps]);
        const activeApps = apps.filter((a) => resolved.get(a));
        const openUrls = urls.filter((u) => resolved.get(u));
        return { activeApps, openUrls, activeCount: activeApps.length + openUrls.length };
    }
}

export const workspaceActivityService = new WorkspaceActivityService();
