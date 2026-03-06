/**
 * URL Qualification Module
 * Determines qualification tier for a URL based on engagement data.
 *
 * Two-tier system:
 *   'draft'  — Shows interest; visible in workspace as "upcoming"
 *   'active' — Committed; shown normally in workspace
 *   'none'   — Not yet qualified; tracked but not shown
 *
 * Browser URL thresholds:
 *   Draft:  2+ visits  OR  2+ min total time
 *   Active: 4+ days visited  OR  (4+ visits AND 6+ min)
 *
 * Desktop App thresholds:
 *   Draft:  3+ opens  OR  5+ min
 *   Active: 10+ opens  OR  30+ min
 */

import { getUrlAnalytics } from '../db/index.js';
import { getBaseDomainFromUrl } from './helpers.js';

/**
 * Universal qualification thresholds (replaces category-specific CATEGORY_RULES)
 */
export const QUALIFICATION_THRESHOLDS = {
  url: {
    draft: {
      minVisits: 2,
      minTimeMs: 120_000 // 2 min
    },
    active: {
      minDays: 4,
      minVisits: 4,
      minTimeMs: 360_000 // 6 min
    }
  },
  app: {
    draft: {
      minVisits: 3,
      minTimeMs: 300_000 // 5 min
    },
    active: {
      minVisits: 10,
      minTimeMs: 1_800_000 // 30 min
    }
  }
};

/**
 * Check the qualification tier for a URL based on its activity data.
 *
 * @param {string} url - The URL to check
 * @param {'url'|'app'} type - The type of resource
 * @returns {Promise<'none'|'draft'|'active'>}
 */
export async function getUrlQualificationStatus(url, type = 'url') {
  try {
    const analytics = await getUrlAnalytics(url);
    if (!analytics) return 'none';

    const thresholds = QUALIFICATION_THRESHOLDS[type] ?? QUALIFICATION_THRESHOLDS.url;

    if (type === 'app') {
      // Active: 10+ opens OR 30+ min
      if (
        analytics.totalVisits >= thresholds.active.minVisits ||
        analytics.totalTime >= thresholds.active.minTimeMs
      ) {
        console.log(`[Qualification] ✅ APP active: ${url.slice(0, 50)} visits=${analytics.totalVisits} time=${Math.round(analytics.totalTime / 1000)}s`);
        return 'active';
      }
      // Draft: 3+ opens OR 5+ min
      if (
        analytics.totalVisits >= thresholds.draft.minVisits ||
        analytics.totalTime >= thresholds.draft.minTimeMs
      ) {
        console.log(`[Qualification] 📋 APP draft: ${url.slice(0, 50)} visits=${analytics.totalVisits} time=${Math.round(analytics.totalTime / 1000)}s`);
        return 'draft';
      }
    } else {
      const uniqueDays = analytics.dailyStats?.filter(d => d.time > 0).length || 0;

      // Active: 4+ unique days OR (4+ visits AND 6+ min)
      const isActiveByDays = uniqueDays >= thresholds.active.minDays;
      const isActiveByEngagement = (
        analytics.totalVisits >= thresholds.active.minVisits &&
        analytics.totalTime >= thresholds.active.minTimeMs
      );

      if (isActiveByDays || isActiveByEngagement) {
        console.log(`[Qualification] ✅ URL active: ${url.slice(0, 50)} days=${uniqueDays} visits=${analytics.totalVisits} time=${Math.round(analytics.totalTime / 1000)}s`);
        return 'active';
      }

      // Draft: 2+ visits OR 2+ min
      if (
        analytics.totalVisits >= thresholds.draft.minVisits ||
        analytics.totalTime >= thresholds.draft.minTimeMs
      ) {
        console.log(`[Qualification] 📋 URL draft: ${url.slice(0, 50)} days=${uniqueDays} visits=${analytics.totalVisits} time=${Math.round(analytics.totalTime / 1000)}s`);
        return 'draft';
      }
    }

    console.debug(`[Qualification] ❌ Not qualified: ${url.slice(0, 50)}`);
    return 'none';
  } catch (e) {
    console.warn('[Qualification] Error checking URL status:', e);
    return 'none';
  }
}

/**
 * Backward-compatible wrapper — returns true if URL has reached 'active' tier.
 * @param {string} url
 * @param {string} _category - Ignored (kept for API compatibility)
 * @returns {Promise<boolean>}
 */
export async function isUrlQualified(url, _category = 'default') {
  const status = await getUrlQualificationStatus(url, 'url');
  return status === 'active';
}

/**
 * Normalize URL for category-based workspaces.
 * Strips paths and query strings, keeps protocol and hostname.
 *
 * @param {string} url
 * @param {boolean} isCategoryBased
 * @returns {string}
 */
export function normalizeUrlForCategory(url, isCategoryBased = false) {
  if (!isCategoryBased) return url;
  try {
    // Use PSL-based root domain extraction (handles subdomains like info.producthunt.com → producthunt.com)
    const baseDomain = getBaseDomainFromUrl(url);
    if (baseDomain && baseDomain !== 'Unknown' && baseDomain !== 'Other') {
      return `https://${baseDomain}`;
    }
    // Fallback: just use hostname without www
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    return `https://${hostname}`;
  } catch {
    return url;
  }
}
