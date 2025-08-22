// Workspace management and related message handlers
import { listWorkspaces, listAllUrls } from '../db.js';
import { setHostWorkspaces, setHostUrls } from '../services/extensionApi.js';

// Initialize workspace functionality
export function initializeWorkspaces() {
    // One-time backfill: mirror workspaces to host so Electron app sees them after host restart
    (async () => {
        try {
            const { workspacesMirroredOnce } = await chrome.storage.local.get(['workspacesMirroredOnce']);
            if (!workspacesMirroredOnce) {
                const all = await listWorkspaces();
                if (Array.isArray(all) && all.length) {
                    try { await setHostWorkspaces(all); } catch { }
                    await chrome.storage.local.set({ workspacesMirroredOnce: true });
                    console.log('[Background] Backfilled workspaces to host:', all.length);
                }
            }
        } catch (e) {
            console.warn('[Background] Workspaces backfill failed', e);
        }
    })();

    // One-time backfill: mirror canonical URL index to host (titles, favicons, memberships)
    (async () => {
        try {
            const { urlsMirroredOnce } = await chrome.storage.local.get(['urlsMirroredOnce']);
            if (!urlsMirroredOnce) {
                const urls = await listAllUrls();
                if (Array.isArray(urls) && urls.length) {
                    // Send in modest chunks to avoid large payloads
                    const CHUNK = 100;
                    for (let i = 0; i < urls.length; i += CHUNK) {
                        const slice = urls.slice(i, i + CHUNK);
                        try { await setHostUrls(slice); } catch { }
                    }
                    await chrome.storage.local.set({ urlsMirroredOnce: true });
                    console.log('[Background] Backfilled URLs to host:', urls.length);
                }
            }
        } catch (e) {
            console.warn('[Background] URLs backfill failed', e);
        }
    })();
}
