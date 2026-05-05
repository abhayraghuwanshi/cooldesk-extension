import { useState, useCallback, useRef } from 'react';
import * as LocalAIService from '../../../services/localAIService';
import { safeGetHostname } from '../../../utils/helpers';

// Resolve the best available chat function: cloud → local → null
async function resolveChatFn() {
  try {
    const cloud = await LocalAIService.getCloudStatus();
    if (cloud?.configured) return LocalAIService.cloudSimpleChat;
  } catch { /* ignore */ }
  try {
    const local = await LocalAIService.isAvailable();
    if (local) return LocalAIService.simpleChat;
  } catch { /* ignore */ }
  return null;
}

// Cache for related URLs suggestions (persists across hook instances)
const suggestionsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(workspace) {
  // Cache key based on workspace ID + hash of URLs (invalidate if URLs change)
  const urlsHash = (workspace.urls || [])
    .slice(0, 10)
    .map(u => u.url)
    .sort()
    .join('|');
  return `${workspace.id}:${urlsHash}`;
}

export function useAISuggestions(tabs, workspaces) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const pendingRequests = useRef(new Map());

  // Auto-generation is now driven by index.jsx (after memory context is loaded).
  // This hook no longer auto-fires — the parent calls generateSuggestions directly.

  /**
   * @param {string} customPrompt      - user's typed prompt (empty string for auto-generate)
   * @param {string} memoryContext     - enriched hint string from useMemory.loadMemoryContext
   * @param {Object|null} workspaceContext - current workspace being edited/created (id, name, description, urls)
   * @param {string} syncContext       - cleaned user data from sidecar (workspaces + activity)
   */
  const generateSuggestions = useCallback(async (customPrompt, memoryContext = '', workspaceContext = null, syncContext = '') => {
    console.log('[useAISuggestions] generateSuggestions called', { customPrompt, tabsCount: tabs.length });

    // Require tabs for auto-generation, but allow explicit prompts even with no tabs
    if (tabs.length < 2 && !customPrompt) {
      console.log('[useAISuggestions] Skipping - not enough tabs and no prompt');
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Resolve best available chat function (cloud AI first, then local)
      console.log('[useAISuggestions] Resolving AI backend...');
      const chatFn = await resolveChatFn();
      console.log('[useAISuggestions] Chat function resolved:', chatFn ? chatFn.name : 'none');
      if (!chatFn) {
        throw new Error('AI not available. Please configure a cloud AI key in Settings, or ensure the local AI model is loaded.');
      }

      // Format tabs for AI
      const tabsForGrouping = tabs.length > 0
        ? tabs
            .slice(0, 20)
            .map((t, i) => `${i + 1}. ${t.title || safeGetHostname(t.url)} (${safeGetHostname(t.url)})`)
            .join('\n')
        : '(No browser tabs available)';

      // Build prompt — three cases:
      // 1. Workspace-context prompt: user asked something specific about a known workspace
      // 2. Custom prompt: user typed a free-form prompt (no workspace context)
      // 3. Auto-generate: no prompt, group open tabs
      let prompt;

      // Shared context block prepended to all prompts when available
      const contextBlock = syncContext
        ? `User context:\n${syncContext}\n\n`
        : (memoryContext ? `Context: ${memoryContext}\n\n` : '');

      if (workspaceContext?.name && customPrompt) {
        // Case 1: suggest relevant URLs for a specific workspace
        const existingUrls = (workspaceContext.urls || [])
          .slice(0, 8)
          .map(u => `- ${u.title || safeGetHostname(u.url)} (${safeGetHostname(u.url)})`)
          .join('\n') || '(none yet)';

        const tabsSection = tabs.length > 0
          ? `\nOpen tabs for context:\n${tabsForGrouping}`
          : '';

        prompt = `${contextBlock}Workspace: "${workspaceContext.name}"${workspaceContext.description ? ` — ${workspaceContext.description}` : ''}
Current URLs in workspace:
${existingUrls}${tabsSection}

User request: ${customPrompt}

Suggest 4-6 relevant websites to add to the "${workspaceContext.name}" workspace. Include tools, docs, APIs, or resources directly related to this topic.

Return JSON only:
{"groups": [{"name": "${workspaceContext.name}", "description": "Relevant resources", "items": [], "suggestedUrls": [{"url": "https://example.com", "title": "Site Name", "reason": "Why it fits this workspace"}]}]}`;

      } else if (customPrompt) {
        // Case 2: free-form prompt — group tabs with user's framing
        prompt = `${contextBlock}${customPrompt}

Tabs:
${tabsForGrouping}

Group these tabs into 2-4 workspaces. For each workspace, suggest 3-4 popular related websites.

Return JSON only:
{"groups": [{"name": "Name", "description": "Brief desc", "items": [1,2], "suggestedUrls": [{"url": "https://example.com", "title": "Site Name", "reason": "Why useful"}]}]}`;

      } else {
        // Case 3: auto-generate from open tabs
        prompt = `${contextBlock}Tabs:
${tabsForGrouping}

Group these into 2-4 logical workspaces. For each workspace, suggest 3-4 popular related websites that would be useful.

Return JSON only:
{"groups": [{"name": "Name", "description": "Brief desc", "items": [1,2], "suggestedUrls": [{"url": "https://example.com", "title": "Site Name", "reason": "Why useful"}]}]}`;
      }

      // Use resolved chat endpoint
      console.log('[useAISuggestions] Calling chat...');
      const result = await chatFn(prompt);
      console.log('[useAISuggestions] chat result:', result);

      if (!result.ok) {
        throw new Error(result.error || 'AI request failed');
      }

      // Parse JSON from response
      const response = result.response || '';
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.groups && Array.isArray(parsed.groups)) {
            setSuggestions(parsed.groups.map(g => ({
              ...g,
              suggestions: parsed.suggestions || []
            })));
            return;
          }
        } catch (parseErr) {
          console.warn('[useAISuggestions] JSON parse failed:', parseErr);
        }
      }

      // If no valid JSON, show as a single suggestion
      if (response.trim()) {
        setSuggestions([{
          name: 'AI Suggestion',
          description: response.slice(0, 200),
          items: []
        }]);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('[useAISuggestions] Error generating suggestions:', err);
      setError(err.message);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [tabs]);

  // Simple prompt change handler - no auto-trigger, only updates state
  const handlePromptChange = useCallback((value) => {
    setAiPrompt(value);
  }, []);

  const classifyUrl = useCallback(async (url, title = '') => {
    try {
      const workspaceNames = workspaces.map(ws => ws.name);
      const prompt = `Classify this URL into the best matching workspace.
URL: ${url}
Title: ${title || 'Unknown'}
Available workspaces: ${workspaceNames.join(', ')}

Return JSON: {"workspace": "Best Workspace Name", "confidence": 0.8}`;

      const chatFn = await resolveChatFn();
      if (!chatFn) return null;
      const result = await chatFn(prompt);
      if (result.ok && result.response) {
        const jsonMatch = result.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
      return null;
    } catch (err) {
      console.error('[useAISuggestions] Error classifying URL:', err);
      return null;
    }
  }, [workspaces]);

  /**
   * Suggest related URLs for a workspace based on user's ACTUAL browsing history.
   * Only suggests URLs the user has actually visited.
   * @param {Object} workspace - The workspace to suggest for
   * @param {Array} userHistory - User's browser history
   * @param {Array} userBookmarks - User's bookmarks
   */
  const suggestRelatedUrls = useCallback(async (workspace, userHistory = [], userBookmarks = []) => {
    try {
      const workspaceUrls = workspace.urls?.map(u => ({
        url: u.url,
        title: u.title || safeGetHostname(u.url)
      })) || [];

      if (workspaceUrls.length === 0) return [];

      // Build set of existing URLs in workspace
      const existingUrls = new Set(workspaceUrls.map(u => u.url?.toLowerCase()));

      // Combine history and bookmarks, filter out existing
      const candidateUrls = [];
      const seenUrls = new Set();

      // Add from history (most recent/frequent)
      userHistory.forEach(h => {
        const urlLower = h.url?.toLowerCase();
        if (h.url && !existingUrls.has(urlLower) && !seenUrls.has(urlLower)) {
          seenUrls.add(urlLower);
          candidateUrls.push({
            url: h.url,
            title: h.title || safeGetHostname(h.url),
            source: 'history',
            visitCount: h.visitCount || 1
          });
        }
      });

      // Add from bookmarks
      userBookmarks.forEach(b => {
        const urlLower = b.url?.toLowerCase();
        if (b.url && !existingUrls.has(urlLower) && !seenUrls.has(urlLower)) {
          seenUrls.add(urlLower);
          candidateUrls.push({
            url: b.url,
            title: b.title || safeGetHostname(b.url),
            source: 'bookmark'
          });
        }
      });

      // If no candidates, return empty
      if (candidateUrls.length === 0) {
        console.log('[useAISuggestions] No candidate URLs from history/bookmarks');
        return [];
      }

      // Check cache first
      const cacheKey = getCacheKey(workspace);
      const cached = suggestionsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[useAISuggestions] Using cached suggestions for:', workspace.name);
        return cached.suggestions;
      }

      // Check if request is already pending
      if (pendingRequests.current.has(cacheKey)) {
        console.log('[useAISuggestions] Request already pending for:', workspace.name);
        return pendingRequests.current.get(cacheKey);
      }

      // Create the request promise
      const requestPromise = (async () => {
        // Format workspace URLs
        const workspaceList = workspaceUrls
          .slice(0, 8)
          .map(u => `- ${u.title} (${safeGetHostname(u.url)})`)
          .join('\n');

        // Format candidate URLs (from user's actual history)
        const candidateList = candidateUrls
          .slice(0, 30) // Limit candidates
          .map((u, i) => `${i + 1}. ${u.title} (${safeGetHostname(u.url)})`)
          .join('\n');

        const prompt = `Workspace "${workspace.name}" contains:
${workspaceList}

From the user's browsing history below, pick 3-5 URLs that would fit this workspace:
${candidateList}

Return JSON with indices from the list above:
{"picks": [{"index": 1, "reason": "Brief reason why it fits"}]}`;

        console.log('[useAISuggestions] suggestRelatedUrls for:', workspace.name, 'with', candidateUrls.length, 'candidates');
        const chatFn = await resolveChatFn();
        if (!chatFn) return [];
        const result = await chatFn(prompt);

        let suggestions = [];
        if (result.ok && result.response) {
          const jsonMatch = result.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            suggestions = (parsed.picks || [])
              .map(pick => {
                const idx = pick.index - 1;
                if (idx >= 0 && idx < candidateUrls.length) {
                  const candidate = candidateUrls[idx];
                  return {
                    url: candidate.url,
                    title: candidate.title,
                    reason: pick.reason || `From your ${candidate.source}`,
                    source: candidate.source,
                    _aiSuggested: true
                  };
                }
                return null;
              })
              .filter(Boolean);
          }
        }

        // Cache the result
        suggestionsCache.set(cacheKey, {
          suggestions,
          timestamp: Date.now()
        });

        return suggestions;
      })();

      // Store pending request
      pendingRequests.current.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;
        return result;
      } finally {
        pendingRequests.current.delete(cacheKey);
      }
    } catch (err) {
      console.error('[useAISuggestions] Error suggesting related URLs:', err);
      return [];
    }
  }, []);

  /**
   * Classify installed desktop apps into workspaces using local AI.
   * Thin wrapper around appCategorizationService — uses the same simpleChat fn.
   */
  const classifyAppsToWorkspaces = useCallback(async (installedApps, targetWorkspaces) => {
    try {
      const chatFn = await resolveChatFn();
      if (!chatFn) return {};

      const { classifyAppsToWorkspaces: classify } = await import('../../../services/appCategorizationService');
      return await classify(installedApps, targetWorkspaces, chatFn);
    } catch (err) {
      console.error('[useAISuggestions] classifyAppsToWorkspaces error:', err);
      return {};
    }
  }, []);

  return {
    aiPrompt,
    setAiPrompt: handlePromptChange,
    suggestions,
    isLoading,
    error,
    generateSuggestions,
    classifyUrl,
    suggestRelatedUrls,
    classifyAppsToWorkspaces
  };
}
