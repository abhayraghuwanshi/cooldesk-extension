/**
 * Promotion Service
 * Background job that drives URL state transitions:
 *   activity (tracked) → draft (visible, upcoming) → active (committed, normal)
 *
 * This is the ONLY place where URLs are added to or upgraded in workspaces.
 * Real-time categorization only records activity; this job acts on it.
 *
 * Schedule: run on startup + every 30 minutes via chrome.alarms ('promotion_job')
 */

import categoryManager from '../data/categories.js';
import { getUnifiedDB, listWorkspaces, saveWorkspace } from '../db/index.js';
import { DB_CONFIG } from '../db/unified-db.js';
import GenericUrlParser from './GenericUrlParser.js';
import { getUrlQualificationStatus, normalizeUrlForCategory } from './urlQualification.js';

const PROMOTION_ALARM_NAME = 'promotion_job';
const PROMOTION_INTERVAL_MINUTES = 30;
// Look back this many days when scanning activity

// Category icons for auto-created workspaces
const CATEGORY_ICONS = {
    social: 'users',
    shopping: 'shopping-cart',
    entertainment: 'play-circle',
    news: 'newspaper',
    finance: 'dollar-sign',
    travel: 'plane',
    food: 'utensils',
    health: 'heart',
    education: 'graduation-cap',
    utilities: 'tool',
    productivity: 'briefcase',
    development: 'code',
    design: 'palette',
    communication: 'message-circle',
    gaming: 'gamepad-2',
    sports: 'trophy',
    music: 'music',
    video: 'video'
};
const ACTIVITY_LOOKBACK_DAYS = 7;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Schedule the promotion alarm (idempotent).
 * Call once from background.js on install/startup.
 */
export function schedulePromotion() {
    if (!chrome?.alarms) return;
    chrome.alarms.get(PROMOTION_ALARM_NAME, (existing) => {
        if (!existing) {
            chrome.alarms.create(PROMOTION_ALARM_NAME, {
                delayInMinutes: PROMOTION_INTERVAL_MINUTES,
                periodInMinutes: PROMOTION_INTERVAL_MINUTES
            });
            console.log(`[Promotion] Alarm scheduled: every ${PROMOTION_INTERVAL_MINUTES} min`);
        }
    });
}

/**
 * Wire up the alarm listener. Call once from background.js.
 */
export function listenForPromotionAlarm() {
    if (!chrome?.alarms?.onAlarm) return;
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === PROMOTION_ALARM_NAME) {
            console.log('[Promotion] Alarm fired — running promotion job');
            runPromotion().catch(e => console.error('[Promotion] Job error:', e));
        }
    });
}

/**
 * Main promotion job.
 * 1. Collect all URLs active in the last ACTIVITY_LOOKBACK_DAYS days
 * 2. Check qualification status for each unique URL
 * 3. Add as draft/active to matching workspace if not already there
 * 4. Upgrade draft → active when thresholds are met
 *
 * @returns {Promise<{promoted: number, upgraded: number, skipped: number}>}
 */
export async function runPromotion() {
    try {
        console.log('[Promotion] Starting promotion job...');

        // 1. Gather recent activity URLs from ACTIVITY_SERIES
        let recentUrls = await getRecentActivityUrls(ACTIVITY_LOOKBACK_DAYS);

        // If no activity data (fresh install), use Chrome history directly
        let usingHistoryFallback = false;
        let historyMap = new Map(); // url -> {visitCount, lastVisitTime}

        if (recentUrls.size === 0 && chrome?.history) {
            console.log('[Promotion] No activity data — using Chrome history for fresh install');
            usingHistoryFallback = true;

            const startTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days
            const historyItems = await chrome.history.search({
                text: '',
                startTime,
                maxResults: 2000
            });

            // Filter to qualified history items (visitCount >= 2)
            for (const item of historyItems) {
                if (item.url && (item.visitCount || 0) >= 2) {
                    recentUrls.add(item.url);
                    historyMap.set(item.url, {
                        visitCount: item.visitCount || 1,
                        lastVisitTime: item.lastVisitTime
                    });
                }
            }
            console.log(`[Promotion] Found ${recentUrls.size} qualified URLs from Chrome history`);
        }

        if (recentUrls.size === 0) {
            console.log('[Promotion] No URLs to promote');
            return { promoted: 0, upgraded: 0, skipped: 0 };
        }
        console.log(`[Promotion] Processing ${recentUrls.size} URLs`);

        // 2. Load all workspaces into a map for fast lookup
        const wsResult = await listWorkspaces();
        const workspaces = wsResult?.success ? wsResult.data : (Array.isArray(wsResult) ? wsResult : []);
        // Note: we no longer skip if no workspaces - we can create category workspaces as needed
        console.log(`[Promotion] Found ${workspaces.length} existing workspaces`);

        let promoted = 0;
        let upgraded = 0;
        let skipped = 0;

        let excludedCount = 0;
        let uncategorizedCount = 0;
        let qualificationFailCount = 0;

        for (const rawUrl of recentUrls) {
            try {
                // Skip system/internal URLs early
                if (GenericUrlParser.shouldExclude?.(rawUrl)) {
                    excludedCount++;
                    skipped++;
                    continue;
                }

                // Determine workspace for this URL (category-based)
                const category = categoryManager.categorizeUrl(rawUrl);
                if (!category || category === 'uncategorized') {
                    uncategorizedCount++;
                    // Log first 5 uncategorized URLs for debugging
                    if (uncategorizedCount <= 5) {
                        console.log(`[Promotion] ⚠️ Uncategorized: ${rawUrl.slice(0, 80)}`);
                    }
                    skipped++;
                    continue;
                }

                // Normalize to domain-level URL (strip paths for category workspaces)
                const normalizedUrl = normalizeUrlForCategory(rawUrl, true);

                // Find the matching workspace by category name
                const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
                let workspace = workspaces.find(ws =>
                    ws.name?.toLowerCase() === categoryName.toLowerCase()
                );

                // Create category workspace if it doesn't exist
                if (!workspace) {
                    workspace = await createCategoryWorkspace(categoryName, category);
                    if (workspace) {
                        workspaces.push(workspace); // Add to local cache
                        console.log(`[Promotion] 🆕 Created workspace: "${categoryName}"`);
                    } else {
                        skipped++;
                        continue;
                    }
                }

                // Check qualification status
                let status;
                if (usingHistoryFallback) {
                    // Use Chrome history visitCount directly for qualification
                    const historyData = historyMap.get(rawUrl);
                    const visitCount = historyData?.visitCount || 0;
                    // Draft: 2+ visits, Active: 4+ visits (simplified for history)
                    if (visitCount >= 4) {
                        status = 'active';
                    } else if (visitCount >= 2) {
                        status = 'draft';
                    } else {
                        status = 'none';
                    }
                } else {
                    status = await getUrlQualificationStatus(normalizedUrl, 'url');
                }
                if (status === 'none') {
                    qualificationFailCount++;
                    skipped++;
                    continue;
                }

                // Look for existing entry in this workspace
                const existingEntry = workspace.urls?.find(u => u.url === normalizedUrl);

                if (!existingEntry) {
                    // Not yet in workspace — add as draft or active
                    await addUrlWithStatus(normalizedUrl, workspace, status, rawUrl);
                    promoted++;
                    console.log(`[Promotion] ➕ ${status}: ${normalizedUrl.slice(0, 50)} → "${workspace.name}"`);
                } else if (existingEntry.status === 'draft' && status === 'active') {
                    // Upgrade draft → active
                    await upgradeUrlStatus(normalizedUrl, workspace, 'active');
                    upgraded++;
                    console.log(`[Promotion] ⬆️ draft→active: ${normalizedUrl.slice(0, 50)} in "${workspace.name}"`);
                } else {
                    skipped++;
                }
            } catch (urlErr) {
                console.warn('[Promotion] Error processing URL:', rawUrl, urlErr);
                skipped++;
            }
        }

        // Notify UI if anything changed
        if (promoted + upgraded > 0) {
            try {
                const bc = new BroadcastChannel('ws_db_changes');
                bc.postMessage({ type: 'workspacesChanged', promotion: true });
                bc.close();
            } catch { /* ignore */ }
        }

        console.log(`[Promotion] Done — promoted: ${promoted}, upgraded: ${upgraded}, skipped: ${skipped}`);
        console.log(`[Promotion] Skip breakdown — excluded: ${excludedCount}, uncategorized: ${uncategorizedCount}, qualification failed: ${qualificationFailCount}`);
        return { promoted, upgraded, skipped };
    } catch (err) {
        console.error('[Promotion] Fatal error in runPromotion:', err);
        return { promoted: 0, upgraded: 0, skipped: 0, error: err.message };
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a category-based workspace if it doesn't exist.
 * Used by promotion service to ensure URLs have a home.
 *
 * @param {string} displayName - Display name (e.g., "Social", "Shopping")
 * @param {string} category - Category key (e.g., "social", "shopping")
 * @returns {Promise<Object|null>} Created workspace or null on failure
 */
async function createCategoryWorkspace(displayName, category) {
    try {
        const workspace = {
            id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: displayName,
            icon: CATEGORY_ICONS[category] || 'globe',
            description: `${displayName} websites`,
            gridType: 'ItemGrid',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            urls: [],
            context: {
                category: category,
                autoCreated: true,
                createdBy: 'promotionService'
            }
        };

        await saveWorkspace(workspace, { skipNotify: true });
        return workspace;
    } catch (err) {
        console.warn(`[Promotion] Failed to create workspace "${displayName}":`, err);
        return null;
    }
}

/**
 * Collect unique URLs that had activity in the last N days.
 * Queries the ACTIVITY_SERIES store by timestamp.
 *
 * @param {number} days
 * @returns {Promise<Set<string>>}
 */
async function getRecentActivityUrls(days) {
    try {
        const db = await getUnifiedDB();
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const tx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readonly');
        const store = tx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
        const tsIndex = store.index('by_timestamp');

        const range = IDBKeyRange.lowerBound(cutoff);
        const urls = new Set();

        await new Promise((resolve, reject) => {
            const req = tsIndex.openCursor(range);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) { resolve(); return; }
                if (cursor.value?.url) urls.add(cursor.value.url);
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });

        return urls;
    } catch (err) {
        console.warn('[Promotion] Could not read activity series:', err);
        return new Set();
    }
}

/**
 * Add a URL to a workspace with a given status by mutating the workspace.urls array
 * and saving via saveWorkspace (which handles dedup + timestamps).
 */
async function addUrlWithStatus(url, workspace, status, originalUrl) {
    // Build URL entry
    let title = url;
    let favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;

    try {
        const parsed = GenericUrlParser.parse(originalUrl, '');
        if (parsed?.title) title = parsed.title;
        if (parsed?.favicon) favicon = parsed.favicon;
    } catch { /* ignore parse errors */ }

    if (!Array.isArray(workspace.urls)) workspace.urls = [];

    // Avoid duplicates (double-check before push)
    if (workspace.urls.some(u => u.url === url)) {
        console.log(`[Promotion] ⏭️ Duplicate skipped: ${url.slice(0, 50)} in "${workspace.name}"`);
        return;
    }

    workspace.urls.push({
        url,
        title,
        favicon,
        addedAt: Date.now(),
        status    // 'draft' | 'active'
    });
    workspace.updatedAt = Date.now();
    console.log(`[Promotion] ✅ Added URL to "${workspace.name}": ${url.slice(0, 50)} (status: ${status}, total: ${workspace.urls.length})`);
    await saveWorkspace(workspace, { skipNotify: true });
}

/**
 * Upgrade an existing URL's status field within a workspace.
 */
async function upgradeUrlStatus(url, workspace, newStatus) {
    if (!Array.isArray(workspace.urls)) return;

    const entry = workspace.urls.find(u => u.url === url);
    if (!entry) return;

    entry.status = newStatus;
    workspace.updatedAt = Date.now();
    await saveWorkspace(workspace, { skipNotify: true });
}

/**
 * One-time cleanup to remove bad URLs from existing workspaces.
 * Removes URLs that match shouldExclude patterns.
 *
 * @returns {Promise<{cleaned: number, workspacesModified: number}>}
 */
export async function cleanupBadUrls() {
    try {
        console.log('[Promotion] Starting bad URL cleanup...');

        const wsResult = await listWorkspaces();
        const workspaces = wsResult?.success ? wsResult.data : (Array.isArray(wsResult) ? wsResult : []);

        let totalCleaned = 0;
        let workspacesModified = 0;

        for (const ws of workspaces) {
            if (!ws.urls || ws.urls.length === 0) continue;

            const originalCount = ws.urls.length;
            const cleanedUrls = ws.urls.filter(urlEntry => {
                const url = urlEntry.url || urlEntry;
                // Keep URL only if it should NOT be excluded
                return !GenericUrlParser.shouldExclude(url);
            });

            const removedCount = originalCount - cleanedUrls.length;
            if (removedCount > 0) {
                ws.urls = cleanedUrls;
                ws.updatedAt = Date.now();
                await saveWorkspace(ws, { skipNotify: true });
                totalCleaned += removedCount;
                workspacesModified++;
                console.log(`[Promotion] Cleaned ${removedCount} bad URLs from "${ws.name}"`);
            }
        }

        // Notify UI
        if (totalCleaned > 0) {
            try {
                const bc = new BroadcastChannel('ws_db_changes');
                bc.postMessage({ type: 'workspacesChanged', cleanup: true });
                bc.close();
            } catch { /* ignore */ }
        }

        console.log(`[Promotion] Cleanup complete: removed ${totalCleaned} URLs from ${workspacesModified} workspaces`);
        return { cleaned: totalCleaned, workspacesModified };
    } catch (err) {
        console.error('[Promotion] Cleanup error:', err);
        return { cleaned: 0, workspacesModified: 0, error: err.message };
    }
}

