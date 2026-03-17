import { useState, useCallback, useRef } from 'react';
import * as LocalAIService from '../../../services/localAIService';
import { safeGetHostname } from '../../../utils/helpers';

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
   * @param {string} customPrompt  - user's typed prompt (empty string for auto-generate)
   * @param {string} memoryContext - enriched hint string from useMemory.loadMemoryContext
   */
  const generateSuggestions = useCallback(async (customPrompt, memoryContext = '') => {
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
      // Check if local AI is available
      console.log('[useAISuggestions] Checking AI availability...');
      const isAvailable = await LocalAIService.isAvailable();
      console.log('[useAISuggestions] AI available:', isAvailable);
      if (!isAvailable) {
        throw new Error('AI not available. Please ensure CoolDesk desktop app is running.');
      }

      // Format tabs for AI
      const tabsForGrouping = tabs.length > 0
        ? tabs
            .slice(0, 20)
            .map((t, i) => `${i + 1}. ${t.title || safeGetHostname(t.url)} (${safeGetHostname(t.url)})`)
            .join('\n')
        : '(No browser tabs available)';

      // Build prompt for workspace grouping AND URL suggestions
      const prompt = customPrompt
        ? `${customPrompt}

Tabs:
${tabsForGrouping}

Group these tabs into 2-4 workspaces. For each workspace, suggest 3-4 popular related websites.

Return JSON only:
{"groups": [{"name": "Name", "description": "Brief desc", "items": [1,2], "suggestedUrls": [{"url": "https://example.com", "title": "Site Name", "reason": "Why useful"}]}]}`
        : `Tabs:
${tabsForGrouping}

Group these into 2-4 logical workspaces. For each workspace, suggest 3-4 popular related websites that would be useful.

Return JSON only:
{"groups": [{"name": "Name", "description": "Brief desc", "items": [1,2], "suggestedUrls": [{"url": "https://example.com", "title": "Site Name", "reason": "Why useful"}]}]}`;

      // Use simple chat endpoint
      console.log('[useAISuggestions] Calling simpleChat...');
      const result = await LocalAIService.simpleChat(prompt);
      console.log('[useAISuggestions] simpleChat result:', result);

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

      const result = await LocalAIService.simpleChat(prompt);
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
   * Suggest related URLs for a workspace based on its current URLs.
   * Uses caching to avoid repeated AI calls.
   */
  const suggestRelatedUrls = useCallback(async (workspace) => {
    try {
      const workspaceUrls = workspace.urls?.map(u => ({
        url: u.url,
        title: u.title || safeGetHostname(u.url)
      })) || [];

      if (workspaceUrls.length === 0) return [];

      // Check cache first
      const cacheKey = getCacheKey(workspace);
      const cached = suggestionsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[useAISuggestions] Using cached suggestions for:', workspace.name);
        return cached.suggestions;
      }

      // Check if request is already pending (dedup concurrent calls)
      if (pendingRequests.current.has(cacheKey)) {
        console.log('[useAISuggestions] Request already pending for:', workspace.name);
        return pendingRequests.current.get(cacheKey);
      }

      // Create the request promise
      const requestPromise = (async () => {
        // Simple prompt: ask AI to suggest related URLs based on workspace theme
        const urlList = workspaceUrls
          .slice(0, 10)
          .map(u => `- ${u.title} (${safeGetHostname(u.url)})`)
          .join('\n');

        const prompt = `Workspace "${workspace.name}" contains:
${urlList}

Suggest 3-5 related websites that would fit this workspace. Return JSON only:
{"suggestions": [{"url": "https://...", "title": "Site name", "reason": "Why it fits"}]}`;

        console.log('[useAISuggestions] suggestRelatedUrls for:', workspace.name);
        const result = await LocalAIService.simpleChat(prompt);

        let suggestions = [];
        if (result.ok && result.response) {
          const jsonMatch = result.response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            suggestions = (parsed.suggestions || []).map(s => ({
              url: s.url,
              title: s.title,
              reason: s.reason,
              _aiSuggested: true
            })).filter(s => s.url);
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

  return {
    aiPrompt,
    setAiPrompt: handlePromptChange,
    suggestions,
    isLoading,
    error,
    generateSuggestions,
    classifyUrl,
    suggestRelatedUrls
  };
}
