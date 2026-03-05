/**
 * URL Qualification Module
 * Determines if a URL has enough engagement to be added to a workspace
 *
 * Qualification requires EITHER:
 * 1. Strong recurrence signal: 3-4+ unique days visited (category-dependent)
 * 2. Combined engagement: 4-5+ visits AND 5-10 min time spent
 *
 * These thresholds are intentionally high to only capture truly important URLs.
 * Casual browsing should not clutter workspaces.
 */

import { getUrlAnalytics, listWorkspaces, saveWorkspace } from '../db/index.js';

// Category-specific qualification thresholds
// Significantly increased to reduce workspace clutter - only truly important URLs qualify
export const CATEGORY_RULES = {
  // Utilities are often quick one-off visits - require strong recurrence
  utilities: { minDays: 4, minVisits: 5, minTimeMs: 300000 },  // 5 min, 4 days or 5 visits

  // Travel research often happens in bursts - need return visits to show importance
  travel: { minDays: 3, minVisits: 4, minTimeMs: 360000 },     // 6 min, 3 days or 4 visits

  // Shopping - many one-off purchases, only save recurring stores
  shopping: { minDays: 3, minVisits: 4, minTimeMs: 300000 },   // 5 min, 3 days or 4 visits

  // Finance - sensitive, should only save if truly used regularly
  finance: { minDays: 3, minVisits: 4, minTimeMs: 300000 },    // 5 min, 3 days or 4 visits

  // Entertainment - lots of casual browsing, need strong signal
  entertainment: { minDays: 4, minVisits: 5, minTimeMs: 420000 }, // 7 min, 4 days or 5 visits

  // Social - very casual, need strong recurrence
  social: { minDays: 4, minVisits: 5, minTimeMs: 300000 },     // 5 min, 4 days or 5 visits

  // Education/Learning - often deep-dive sessions
  education: { minDays: 2, minVisits: 3, minTimeMs: 600000 },  // 10 min, 2 days or 3 visits

  // Productivity tools - should show regular work usage
  productivity: { minDays: 3, minVisits: 5, minTimeMs: 300000 }, // 5 min, 3 days or 5 visits

  // AI tools - frequent usage expected if important
  ai: { minDays: 3, minVisits: 4, minTimeMs: 300000 },         // 5 min, 3 days or 4 visits

  // Default for uncategorized - strict to avoid clutter
  default: { minDays: 4, minVisits: 4, minTimeMs: 360000 }     // 6 min, 4 days or 4 visits
};

/**
 * Check if a URL is qualified for workspace inclusion based on activity data
 * @param {string} url - The URL to check
 * @param {string} category - The category (utilities, travel, etc.)
 * @returns {Promise<boolean>} True if URL meets qualification thresholds
 */
export async function isUrlQualified(url, category = 'default') {
  try {
    const analytics = await getUrlAnalytics(url);
    if (!analytics) return false;

    const rules = CATEGORY_RULES[category] || CATEGORY_RULES.default;

    // Count unique days with actual activity (time > 0)
    const uniqueDays = analytics.dailyStats?.filter(d => d.time > 0).length || 0;

    // Qualification: Either strong recurrence OR combined engagement
    const hasRecurrence = uniqueDays >= rules.minDays;
    const hasCombinedEngagement = (
      analytics.totalVisits >= rules.minVisits &&
      analytics.totalTime >= rules.minTimeMs
    );

    const qualified = hasRecurrence || hasCombinedEngagement;

    // Always log qualification status for debugging
    const timeInSec = Math.round(analytics.totalTime / 1000);
    const minTimeInSec = Math.round(rules.minTimeMs / 1000);

    if (qualified) {
      console.log(`[Qualification] ✅ ${url.slice(0, 50)} qualified: days=${uniqueDays}/${rules.minDays}, visits=${analytics.totalVisits}/${rules.minVisits}, time=${timeInSec}s/${minTimeInSec}s`);
    } else {
      console.debug(`[Qualification] ❌ ${url.slice(0, 50)} not qualified: days=${uniqueDays}/${rules.minDays}, visits=${analytics.totalVisits}/${rules.minVisits}, time=${timeInSec}s/${minTimeInSec}s`);
    }

    return qualified;
  } catch (e) {
    console.warn('[Qualification] Error checking URL:', e);
    return false;
  }
}

/**
 * Normalize URL for category-based workspaces
 * Strips paths and query strings, keeps protocol and hostname (including subdomain)
 *
 * @param {string} url - The URL to normalize
 * @param {boolean} isCategoryBased - Whether this is for a category-based workspace
 * @returns {string} Normalized URL
 */
export function normalizeUrlForCategory(url, isCategoryBased = false) {
  if (!isCategoryBased) return url;

  try {
    const urlObj = new URL(url);
    // Keep subdomain (mail.google.com stays separate from docs.google.com)
    // But strip all paths and query strings
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch {
    return url;
  }
}

// ===== ONE-TIME CLEANUP =====

const CLEANUP_FLAG_KEY = 'cooldesk_workspace_cleanup_v2'; // v2: stricter thresholds

/**
 * Run one-time cleanup of existing workspaces
 * Removes URLs that don't meet qualification thresholds
 * Only runs once per extension install (tracked via chrome.storage)
 *
 * @param {Object} options - Options
 * @param {boolean} options.force - Force cleanup even if already ran
 * @returns {Promise<{skipped?: boolean, totalRemoved?: number, workspacesModified?: number}>}
 */
export async function runWorkspaceCleanup(options = {}) {
  try {
    // Check if cleanup already ran (unless forced)
    if (!options.force) {
      const storage = await chrome.storage.local.get(CLEANUP_FLAG_KEY);
      if (storage[CLEANUP_FLAG_KEY]) {
        console.log('[Cleanup] Workspace cleanup already completed');
        return { skipped: true };
      }
    }

    console.log('[Cleanup] Starting one-time workspace URL cleanup...');

    const wsResult = await listWorkspaces();
    const workspaces = wsResult?.success ? wsResult.data : (Array.isArray(wsResult) ? wsResult : []);

    let totalRemoved = 0;
    let workspacesModified = 0;

    for (const ws of workspaces) {
      if (!ws.urls || ws.urls.length === 0) continue;

      const category = ws.context?.category || 'default';
      const qualifiedUrls = [];
      const removedUrls = [];

      for (const urlEntry of ws.urls) {
        const qualified = await isUrlQualified(urlEntry.url, category);
        if (qualified) {
          qualifiedUrls.push(urlEntry);
        } else {
          removedUrls.push(urlEntry.url);
        }
      }

      if (removedUrls.length > 0) {
        console.log(`[Cleanup] ${ws.name}: Removing ${removedUrls.length} unqualified URLs:`, removedUrls.slice(0, 5).map(u => u.slice(0, 50)));
        ws.urls = qualifiedUrls;
        ws.updatedAt = Date.now();
        await saveWorkspace(ws);
        totalRemoved += removedUrls.length;
        workspacesModified++;
      }
    }

    // Mark cleanup as complete
    await chrome.storage.local.set({ [CLEANUP_FLAG_KEY]: Date.now() });

    console.log(`[Cleanup] Complete: Removed ${totalRemoved} URLs from ${workspacesModified} workspaces`);

    // Notify UI of changes
    try {
      const bc = new BroadcastChannel('ws_db_changes');
      bc.postMessage({ type: 'workspacesChanged', cleanup: true });
      bc.close();
    } catch { /* ignore */ }

    return { totalRemoved, workspacesModified };
  } catch (e) {
    console.error('[Cleanup] Error during workspace cleanup:', e);
    return { error: e.message };
  }
}
