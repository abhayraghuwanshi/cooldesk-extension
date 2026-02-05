/**
 * High-Speed Search Service
 * Implements Federated Search pattern:
 * 1. Local Index (Instant, from chrome.storage.local)
 * 2. Background Fallback (Slow, IPC)
 * 3. Desktop Integration (Future)
 */

const DB_NAME = 'cooldesk-unified-db';
const DB_VERSION = 2;
const SEARCH_INDEX_KEY = 'search_index';

// --- HELPER: Is Content Script? ---
function isContentScript() {
  return typeof chrome !== 'undefined' && chrome.runtime && !chrome.tabs;
}

// --- HELPER: Fuzzy Scoring (Client Side) ---
export function fuzzyScore(text, query) {
  if (!text || !query) return 0;
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  if (textLower === queryLower) return 100;
  if (textLower.startsWith(queryLower)) return 90;
  if (textLower.includes(queryLower)) return 70;

  const textWords = textLower.split(/\s+/);
  if (textWords.some(w => w.startsWith(queryLower))) return 60;

  // Multi-word query matching: check if all query words appear in text
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
  if (queryWords.length > 1) {
    const allWordsMatch = queryWords.every(qw =>
      textLower.includes(qw) || textWords.some(tw => tw.startsWith(qw))
    );
    if (allWordsMatch) return 65; // Good match for multi-word queries
  }

  // Simple character match walk
  let queryIdx = 0;
  let score = 0;
  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      score += 10;
      queryIdx++;
    }
  }
  if (queryIdx === queryLower.length) {
    return Math.min(50, score);
  }

  return 0;
}

// --- PROVIDER 1: Local Index (High Speed) ---
// Returns NULL if the index is completely missing or corrupted.
// Returns ARRAY (possibly empty) if index exists.
async function searchLocalIndex(query, typeFilter = null) {
  try {
    const data = await chrome.storage.local.get(SEARCH_INDEX_KEY);
    const indexData = data[SEARCH_INDEX_KEY];

    if (!indexData || !indexData.items) {
      // console.warn('[SearchService] Local index empty or missing');
      return null; // SIGNAL: Index Missing
    }

    // Check freshness (optional warning)
    // if (Date.now() - indexData.timestamp > 10 * 60 * 1000) console.warn('[SearchService] Index stale');

    const items = indexData.items;
    const results = [];

    // Filter Loop (Synchronous & Fast)
    for (const item of items) {
      // Filter by type if requested
      if (typeFilter && item.t !== typeFilter) continue;

      // Match
      // Start with base score from indexer
      let baseScore = item.scoreBase || 0;

      // Compute fuzzy score based on query
      // Search across all relevant fields including category
      const matchScore = Math.max(
        fuzzyScore(item.l, query), // l = label/title
        fuzzyScore(item.d, query), // d = description
        fuzzyScore(item.u, query), // u = url
        fuzzyScore(item.c, query)  // c = category (e.g., workspace name)
      );

      if (matchScore > 0) {
        // Expand item back to Full Result Format
        results.push({
          id: item.i,
          title: item.l,
          url: item.u,
          description: item.d,
          type: item.t,
          icon: getIconForType(item.t), // Use stored icon 'f' if available? Indexer stores 'f' as favicon
          favicon: item.f,
          category: item.c,
          tabId: item.tabId, // Include tabId for tab switching
          score: baseScore + matchScore
        });
      }
    }

    // Sort by combined score
    return results.sort((a, b) => b.score - a.score);

  } catch (e) {
    console.error('[SearchService] Local index search failed', e);
    return null; // Treat as missing
  }
}

// --- PROVIDER 2: Desktop App (Placeholder) ---
async function searchDesktop(query) {
  // TODO: Implement chrome.runtime.sendNativeMessage
  // For now, return empty to not block
  return [];
}


// --- MAIN API: Quick Search ---
export async function quickSearch(query, maxResults = 15) {
  if (!query || !query.trim()) return [];

  console.log('[SearchService] quickSearch: ' + query);

  // 1. Try Local Index FIRST
  // This is the "High Speed Center" strategy
  const localResults = await searchLocalIndex(query);

  if (localResults !== null) {
    // Index Exists. Even if 0 results, we trust it.
    console.log(`[SearchService] Fast local hit: ${localResults.length} results`);
    // Log workspace results for debugging
    const wsResults = localResults.filter(r => r.type === 'workspace' || r.type === 'workspace-url');
    if (wsResults.length > 0) {
      console.log('[SearchService] Workspace results:', wsResults.map(r => ({ title: r.title, type: r.type })));
    }
    return localResults.slice(0, maxResults);
  }

  // 2. Index Missing -> Rebuild Trigger + Fallback
  console.log('[SearchService] Local index missing, triggering rebuild & fallback...');

  // Trigger rebuild in background (fire and forget)
  chrome.runtime.sendMessage({ type: 'REBUILD_INDEX' }).catch(() => { });

  // Use Fallback while index builds
  try {
    const [tabs, history, bookmarks] = await Promise.all([
      searchTabsFallback(query),
      searchHistoryFallback(query),
      searchBookmarksFallback(query)
    ]);

    const all = [...tabs, ...history, ...bookmarks];
    return all.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, maxResults);

  } catch (e) {
    console.warn('[SearchService] Fallback failed', e);
    return [];
  }
}

// --- Specific API wrappers (Used by other components or granular UI) ---

export async function searchTabs(query) {
  // Try local first
  const local = await searchLocalIndex(query, 'tab');
  if (local !== null) return local; // Trust index (even if empty)
  return searchTabsFallback(query); // Only if index bad
}

export async function searchHistory(query) {
  const local = await searchLocalIndex(query, 'history');
  if (local !== null) return local;
  return searchHistoryFallback(query);
}

export async function searchBookmarks(query) {
  const local = await searchLocalIndex(query, 'bookmark');
  if (local !== null) return local;
  return searchBookmarksFallback(query);
}

export async function searchWorkspaces(query) {
  // Try local first (workspace and workspace-url)
  const localWs = await searchLocalIndex(query, 'workspace');
  const localUrls = await searchLocalIndex(query, 'workspace-url');

  // If index exists (not null), rely on it.
  if (localWs !== null || localUrls !== null) {
    const ws = localWs || [];
    const urls = localUrls || [];
    return [...ws, ...urls].sort((a, b) => b.score - a.score);
  }

  // No fallback for workspaces needed really, as indexer uses DB.
  // But if we wanted, we could read IndexedDB directly here.
  return [];
}


// --- FALLBACKS (Old Logic) ---

function searchTabsFallback(query) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      let responded = false;
      chrome.runtime.sendMessage({ type: 'SEARCH_TABS', query }, (response) => {
        if (responded) return;
        responded = true;
        resolve(response?.results || []);
      });
      setTimeout(() => { if (!responded) { responded = true; resolve([]); } }, 1000);
    });
  }
  return Promise.resolve([]);
}

function searchHistoryFallback(query) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      let responded = false;
      chrome.runtime.sendMessage({ type: 'SEARCH_HISTORY', query, maxResults: 10 }, (response) => {
        if (responded) return;
        responded = true;
        resolve(response?.results || []);
      });
      setTimeout(() => { if (!responded) { responded = true; resolve([]); } }, 1000);
    });
  }
  return Promise.resolve([]);
}

function searchBookmarksFallback(query) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      let responded = false;
      chrome.runtime.sendMessage({ type: 'SEARCH_BOOKMARKS', query, maxResults: 10 }, (response) => {
        if (responded) return;
        responded = true;
        resolve(response?.results || []);
      });
      setTimeout(() => { if (!responded) { responded = true; resolve([]); } }, 1000);
    });
  }
  return Promise.resolve([]);
}

// --- Helpers ---

function getIconForType(type) {
  const icons = {
    'tab': '🔵',
    'history': '📜',
    'bookmark': '⭐',
    'workspace': '📁',
    'workspace-url': '🔗',
    'note': '📝',
    'url-note': '📌',
    'highlight': '🖍️',
    'scraped-chat': '💬',
    'command': '⚡'
  };
  return icons[type] || '🔍';
}

// --- Legacy DB Helpers (kept for reference or deep integration) ---
// Not used by default quickSearch anymore, but might be needed if direct DB access is restored.
function openDatabase() { /* ... */ }

// --- Natural Language Search (Nano AI Enhanced) ---

/**
 * Detect if a query is natural language (vs simple keyword)
 * @param {string} query - Search query
 * @returns {boolean}
 */
export function isNaturalLanguageQuery(query) {
  if (!query || query.length < 10) return false;

  // Check for question words
  const questionWords = ['what', 'where', 'how', 'when', 'why', 'which', 'find', 'show', 'get'];
  const queryLower = query.toLowerCase();
  if (questionWords.some(w => queryLower.startsWith(w + ' '))) return true;

  // Check for question mark
  if (query.includes('?')) return true;

  // Check for phrases (3+ words)
  const words = query.trim().split(/\s+/);
  if (words.length >= 3) return true;

  return false;
}

/**
 * Natural language search using Nano AI for semantic ranking
 * Falls back to quickSearch if Nano is unavailable
 * @param {string} query - Natural language query
 * @param {number} maxResults - Max results to return
 * @returns {Promise<Array>} Search results with AI ranking
 */
export async function naturalLanguageSearch(query, maxResults = 15) {
  if (!query || !query.trim()) return [];

  console.log('[SearchService] naturalLanguageSearch:', query);

  // First, get regular search results
  const baseResults = await quickSearch(query, 30);

  // If not a natural language query or no results, return base results
  if (!isNaturalLanguageQuery(query) || baseResults.length === 0) {
    return baseResults.slice(0, maxResults);
  }

  // Try to use Nano AI for semantic ranking
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NANO_AI_SEARCH',
      query: query,
      items: baseResults.map(r => ({
        title: r.title || '',
        url: r.url || '',
        description: r.description || '',
        type: r.type
      })),
      limit: maxResults
    });

    if (response?.success && response.results?.length > 0) {
      console.log('[SearchService] Nano AI ranked results:', response.results.length);

      // Map back to full result objects
      return response.results.map((aiResult, idx) => {
        const original = baseResults.find(r =>
          r.title === aiResult.title && r.url === aiResult.url
        ) || baseResults[idx];

        return {
          ...original,
          ...aiResult,
          _aiRanked: true
        };
      });
    }
  } catch (e) {
    console.warn('[SearchService] Nano AI search failed, using base results:', e);
  }

  return baseResults.slice(0, maxResults);
}

export default {
  quickSearch,
  searchTabs,
  searchHistory,
  searchBookmarks,
  searchWorkspaces,
  naturalLanguageSearch,
  isNaturalLanguageQuery
};
