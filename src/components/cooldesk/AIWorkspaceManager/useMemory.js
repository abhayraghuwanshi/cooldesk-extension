/**
 * useMemory — memory layer for AI workspace categorization.
 *
 * Records user interactions (accept / ignore / save) to the feedback store
 * and retrieves learned workspace patterns to enrich future AI suggestions.
 *
 * All writes are fire-and-forget: a feedback failure never blocks the UI.
 */

import {
  recordFeedbackEvent,
  recordUrlWorkspace,
  recordGroupingFeedback,
  suggestWorkspaceForUrl,
  recordAppWorkspace,
} from '../../../services/feedbackService';

export function useMemory() {
  /**
   * Build an enriched context string from previously learned workspace patterns.
   * Queries /feedback/suggest-workspace for the top-N tab URLs in parallel,
   * then assembles a human-readable hint string the LLM can use as context.
   *
   * Returns "" on error or when the memory store is cold (no learned data yet).
   *
   * @param {Array<{url: string, title: string}>} tabs
   * @param {number} topN  how many distinct URLs to probe
   * @returns {Promise<string>}
   */
  async function loadMemoryContext(tabs, topN = 6) {
    if (!tabs || tabs.length === 0) return '';

    try {
      // Deduplicate by hostname to avoid querying the same domain multiple times
      const seen = new Set();
      const uniqueTabs = [];
      for (const tab of tabs) {
        try {
          const host = new URL(tab.url).hostname;
          if (!seen.has(host)) {
            seen.add(host);
            uniqueTabs.push(tab);
          }
        } catch { /* skip invalid URLs */ }
        if (uniqueTabs.length >= topN) break;
      }

      // Fetch workspace suggestions for each unique tab in parallel
      const results = await Promise.allSettled(
        uniqueTabs.map(tab => suggestWorkspaceForUrl(tab.url, tab.title, 2))
      );

      // Collect meaningful suggestions (score >= 0.3)
      const hints = [];
      results.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        const suggestions = result.value || [];
        for (const s of suggestions) {
          if (s.score >= 0.3) {
            try {
              const host = new URL(uniqueTabs[i].url).hostname.replace('www.', '');
              hints.push({ host, workspace: s.workspace_name, score: s.score });
            } catch { /* skip */ }
          }
        }
      });

      if (hints.length === 0) return '';

      // Deduplicate hints by host+workspace pair, sort by score
      const dedupedHints = hints
        .filter((h, i, arr) =>
          arr.findIndex(x => x.host === h.host && x.workspace === h.workspace) === i
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      const hintLines = dedupedHints
        .map(h => `- ${h.host} → "${h.workspace}" (confidence: ${h.score.toFixed(2)})`)
        .join('\n');

      return `Learned workspace patterns from your history:\n${hintLines}`;
    } catch (e) {
      console.debug('[useMemory] loadMemoryContext error:', e.message);
      return '';
    }
  }

  /**
   * Record that the user accepted a suggested workspace group.
   * - Records a positive workspace_group feedback event
   * - Records pairwise URL grouping affinity for all URLs in the group
   *   (capped at 10 pairs to avoid combinatorial explosion)
   *
   * @param {{ name: string, items: number[] }} group  1-based tab indices
   * @param {Array<{url: string, title: string}>} tabs
   */
  function recordAcceptedSuggestion(group, tabs) {
    const groupTabs = (group.items || [])
      .map(idx => tabs[idx - 1])
      .filter(Boolean);

    // Fire-and-forget — don't block the UI
    Promise.allSettled([
      // Positive event for the workspace group itself
      recordFeedbackEvent({
        suggestionType: 'workspace_group',
        action: 'accepted',
        suggestionContent: group.name,
        contextUrls: groupTabs.map(t => t.url),
      }),
      // Pairwise URL affinity: URLs in the same suggested group should stick together
      ...buildPairs(groupTabs, 10).map(([a, b]) =>
        recordGroupingFeedback(a.url, b.url, true)
      ),
    ]).catch(() => { /* swallow */ });
  }

  /**
   * Record that suggestions were shown but the user closed without accepting any.
   * Sends an 'ignored' event for each suggestion name (capped at 5).
   *
   * @param {Array<{ name: string }>} suggestions
   */
  function recordIgnoredSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return;

    Promise.allSettled(
      suggestions.slice(0, 5).map(s =>
        recordFeedbackEvent({
          suggestionType: 'workspace_group',
          action: 'ignored',
          suggestionContent: s.name,
        })
      )
    ).catch(() => { /* swallow */ });
  }

  /**
   * Record all URL → workspace and app → workspace associations when a workspace is saved.
   * Should be called after every successful workspace save.
   *
   * @param {{ name: string, urls: Array<{url: string, title: string}>, apps: Array<{name: string, path: string}> }} workspaceData
   */
  function recordWorkspaceSaved(workspaceData) {
    if (!workspaceData?.name) return;

    const promises = [];

    // Record URL associations
    if (workspaceData.urls?.length > 0) {
      promises.push(
        ...workspaceData.urls.map(urlItem =>
          recordUrlWorkspace(urlItem.url, urlItem.title || '', workspaceData.name)
        )
      );
    }

    // Record app associations
    if (workspaceData.apps?.length > 0) {
      promises.push(
        ...workspaceData.apps.map(app =>
          recordAppWorkspace(app.name || '', app.path, workspaceData.name)
        )
      );
    }

    if (promises.length > 0) {
      Promise.allSettled(promises).catch(() => { /* swallow */ });
    }
  }

  /**
   * Record individual URL → workspace mappings (e.g. when manually adding URLs
   * via URLSelector while editing an existing workspace).
   *
   * @param {Array<{url: string, title: string}>} urls
   * @param {string} workspaceName
   */
  function recordUrlsAddedToWorkspace(urls, workspaceName) {
    if (!workspaceName || !urls?.length) return;

    Promise.allSettled(
      urls.map(u => recordUrlWorkspace(u.url, u.title || '', workspaceName))
    ).catch(() => { /* swallow */ });
  }

  return {
    loadMemoryContext,
    recordAcceptedSuggestion,
    recordIgnoredSuggestions,
    recordWorkspaceSaved,
    recordUrlsAddedToWorkspace,
  };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Generate up to `maxPairs` unique pairs from an array.
 * @param {any[]} arr
 * @param {number} maxPairs
 * @returns {[any, any][]}
 */
function buildPairs(arr, maxPairs) {
  const pairs = [];
  outer: for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      pairs.push([arr[i], arr[j]]);
      if (pairs.length >= maxPairs) break outer;
    }
  }
  return pairs;
}
