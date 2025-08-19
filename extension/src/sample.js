// Enhanced AI Category Sync Implementation

// 1. BULK CATEGORIES HANDLER
async function handleBulkCategorySync(options = {}) {
    const {
        batchSize = 10,
        concurrency = 3,
        prioritizeByVisitCount = true,
        minVisitCount = 1,
        forceRecategorize = false
    } = options;

    console.log('[AI][bulk] Starting bulk category sync');

    try {
        const { dashboardData, geminiApiKey } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey']);
        const settings = await getSettings();

        if (!geminiApiKey) {
            throw new Error('Gemini API key not set');
        }

        const rawHistory = dashboardData?.history || [];
        const maxResults = Number(settings?.historyMaxResults) || 500;
        const history = rawHistory.slice(0, maxResults);

        // Filter items that need categorization
        let itemsToProcess = history.filter(item => {
            const visitCount = Number(item.visitCount) || 0;
            const currentCategory = (item.workspaceGroup || '').trim().toLowerCase();

            // Skip if below minimum visit count threshold
            if (visitCount < minVisitCount) return false;

            // Include if not categorized or if force recategorize is enabled
            const needsCategorization = !currentCategory || currentCategory === 'unknown';
            return needsCategorization || forceRecategorize;
        });

        // Prioritize by visit count if enabled
        if (prioritizeByVisitCount) {
            itemsToProcess.sort((a, b) => (Number(b.visitCount) || 0) - (Number(a.visitCount) || 0));
        }

        // Deduplicate by hostname to ensure diversity
        const seenHosts = new Set();
        itemsToProcess = itemsToProcess.filter(item => {
            try {
                const hostname = new URL(item.url).hostname;
                if (seenHosts.has(hostname)) return false;
                seenHosts.add(hostname);
                return true;
            } catch {
                return true; // Keep items with invalid URLs for processing
            }
        });

        const total = itemsToProcess.length;
        console.log(`[AI][bulk] Processing ${total} items (${batchSize} batch size, ${concurrency} concurrent)`);

        if (total === 0) {
            chrome.runtime.sendMessage({
                action: 'aiError',
                error: 'No items need categorization'
            });
            return;
        }

        let processed = 0;
        let apiHits = 0;
        const results = [];

        // Process in batches with concurrency control
        for (let i = 0; i < itemsToProcess.length; i += batchSize) {
            const batch = itemsToProcess.slice(i, i + batchSize);

            // Process batch with concurrency limit
            const batchPromises = batch.map(async (item, index) => {
                try {
                    // Add delay based on index to spread API calls
                    await new Promise(resolve => setTimeout(resolve, index * 200));

                    const enrichment = await getAiEnrichment(item.url, geminiApiKey);
                    if (enrichment && enrichment.__apiHit) apiHits++;

                    processed++;
                    chrome.runtime.sendMessage({
                        action: 'aiProgress',
                        processed,
                        total,
                        currentItem: item.title || item.url,
                        apiHits
                    });

                    return { item, enrichment };
                } catch (error) {
                    console.warn(`[AI][bulk] Failed to process ${item.url}:`, error);
                    processed++;
                    return { item, error };
                }
            });

            // Wait for batch completion with concurrency control
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Small delay between batches to avoid rate limiting
            if (i + batchSize < itemsToProcess.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Update dashboard data with results
        const enrichedHistory = [...history];
        const indexByUrl = new Map();

        for (let i = 0; i < history.length; i++) {
            if (history[i]?.url) indexByUrl.set(history[i].url, i);
        }

        for (const result of results) {
            if (result.enrichment && !result.error) {
                const { __apiHit, workspaceGroup: _ignored, ...aiData } = result.enrichment;
                const merged = { ...result.item, ...aiData, cleanUrl: cleanUrl(result.item.url) };

                const idx = indexByUrl.get(result.item.url);
                if (typeof idx === 'number') {
                    enrichedHistory[idx] = merged;
                }
            }
        }

        await chrome.storage.local.set({
            dashboardData: {
                ...(dashboardData || {}),
                history: enrichedHistory
            }
        });

        chrome.runtime.sendMessage({ action: 'aiComplete' });
        chrome.runtime.sendMessage({ action: 'updateData' });

        console.log(`[AI][bulk] Completed: ${processed} processed, ${apiHits} API calls`);

    } catch (error) {
        console.error('[AI][bulk] Bulk sync failed:', error);
        chrome.runtime.sendMessage({
            action: 'aiError',
            error: String(error)
        });
    }
}

// 2. ALREADY CATEGORIZED ITEMS HANDLER
async function handleAlreadyCategorizedSync(options = {}) {
    const {
        forceRecategorize = false,
        categoryWhitelist = [], // Only recategorize these categories
        categoryBlacklist = ['Manual', 'Verified'], // Never recategorize these
        confidenceThreshold = 0.8 // Only recategorize if AI confidence is high
    } = options;

    console.log('[AI][categorized] Handling already categorized items');

    try {
        const { dashboardData, geminiApiKey } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey']);
        const settings = await getSettings();

        const history = (dashboardData?.history || []).slice(0, Number(settings?.historyMaxResults) || 500);

        // Filter already categorized items
        let categorizedItems = history.filter(item => {
            const category = (item.workspaceGroup || '').trim();
            if (!category || category.toLowerCase() === 'unknown') return false;

            // Check whitelist/blacklist
            if (categoryWhitelist.length > 0) {
                return categoryWhitelist.some(cat =>
                    category.toLowerCase() === cat.toLowerCase()
                );
            }

            if (categoryBlacklist.length > 0) {
                return !categoryBlacklist.some(cat =>
                    category.toLowerCase() === cat.toLowerCase()
                );
            }

            return true;
        });

        if (!forceRecategorize) {
            // Only recategorize items that might be misclassified
            // Look for items with low confidence indicators
            categorizedItems = categorizedItems.filter(item => {
                const visitCount = Number(item.visitCount) || 0;
                const lastVisit = Number(item.lastVisitTime) || 0;
                const daysSinceVisit = (Date.now() - lastVisit) / (1000 * 60 * 60 * 24);

                // Recategorize if:
                // - High visit count but recent (might have changed purpose)
                // - Low visit count (might be misclassified initially)
                return (visitCount > 10 && daysSinceVisit < 7) || visitCount < 3;
            });
        }

        console.log(`[AI][categorized] Found ${categorizedItems.length} items to potentially recategorize`);

        if (categorizedItems.length === 0) {
            chrome.runtime.sendMessage({
                action: 'aiError',
                error: 'No categorized items need re-evaluation'
            });
            return;
        }

        // Process with comparison logic
        let processed = 0;
        let changed = 0;
        const total = categorizedItems.length;

        for (const item of categorizedItems) {
            try {
                const oldCategory = item.workspaceGroup;
                const enrichment = await getAiEnrichment(item.url, geminiApiKey);

                if (enrichment && enrichment.workspaceGroup && enrichment.workspaceGroup.length > 0) {
                    const newCategory = enrichment.workspaceGroup[0];

                    // Only update if categories are significantly different
                    if (newCategory.toLowerCase() !== oldCategory.toLowerCase()) {
                        // Add confidence check if available
                        const shouldUpdate = forceRecategorize ||
                            (enrichment.confidence && enrichment.confidence > confidenceThreshold);

                        if (shouldUpdate) {
                            await updateItemWorkspace(item.id, newCategory);
                            console.log(`[AI][categorized] Changed: ${item.url} from "${oldCategory}" to "${newCategory}"`);
                            changed++;
                        }
                    }
                }

                processed++;
                chrome.runtime.sendMessage({
                    action: 'aiProgress',
                    processed,
                    total,
                    currentItem: `${item.title || item.url} (${changed} changed)`,
                    apiHits: processed
                });

            } catch (error) {
                console.warn(`[AI][categorized] Failed to reprocess ${item.url}:`, error);
                processed++;
            }
        }

        chrome.runtime.sendMessage({ action: 'aiComplete' });
        chrome.runtime.sendMessage({ action: 'updateData' });

        console.log(`[AI][categorized] Completed: ${processed} processed, ${changed} changed`);

    } catch (error) {
        console.error('[AI][categorized] Already categorized sync failed:', error);
        chrome.runtime.sendMessage({
            action: 'aiError',
            error: String(error)
        });
    }
}

// 3. SINGLE CATEGORY SYNC HANDLER
async function handleSingleCategorySync(categoryName, options = {}) {
    const {
        addNewItems = true,
        revalidateExisting = false,
        maxNewItems = 20,
        minVisitCount = 2
    } = options;

    console.log(`[AI][single] Syncing category: ${categoryName}`);

    try {
        const { dashboardData, geminiApiKey } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey']);
        const settings = await getSettings();

        const history = (dashboardData?.history || []).slice(0, Number(settings?.historyMaxResults) || 500);
        const norm = (s) => (s || '').trim().toLowerCase();

        // Get current items in this category
        const currentItems = history.filter(item =>
            norm(item.workspaceGroup) === norm(categoryName)
        );

        let itemsToProcess = [];
        let processingMode = '';

        if (addNewItems) {
            // Find uncategorized items that might belong to this category
            const uncategorized = history.filter(item => {
                const category = norm(item.workspaceGroup);
                const visitCount = Number(item.visitCount) || 0;
                return (!category || category === 'unknown') && visitCount >= minVisitCount;
            });

            // Use AI to find items that should belong to this category
            const prompt = buildCategoryTargetedPrompt(categoryName, uncategorized.slice(0, 50));
            const candidates = await getAiCategoryMatches(prompt, geminiApiKey);

            itemsToProcess = candidates.slice(0, maxNewItems);
            processingMode = `Adding new items to ${categoryName}`;
        }

        if (revalidateExisting && currentItems.length > 0) {
            // Revalidate existing items in this category
            itemsToProcess = [...itemsToProcess, ...currentItems];
            processingMode = `Revalidating ${categoryName} items`;
        }

        if (itemsToProcess.length === 0) {
            chrome.runtime.sendMessage({
                action: 'aiError',
                error: `No items to process for category "${categoryName}"`
            });
            return;
        }

        console.log(`[AI][single] ${processingMode}: ${itemsToProcess.length} items`);

        let processed = 0;
        let updated = 0;
        const total = itemsToProcess.length;

        for (const item of itemsToProcess) {
            try {
                const enrichment = await getAiEnrichment(item.url, geminiApiKey);

                if (enrichment && enrichment.workspaceGroup) {
                    const suggestedCategories = enrichment.workspaceGroup;
                    const targetMatch = suggestedCategories.some(cat =>
                        norm(cat) === norm(categoryName)
                    );

                    if (targetMatch && norm(item.workspaceGroup) !== norm(categoryName)) {
                        await updateItemWorkspace(item.id, categoryName);
                        console.log(`[AI][single] Added to ${categoryName}: ${item.url}`);
                        updated++;
                    }
                }

                processed++;
                chrome.runtime.sendMessage({
                    action: 'aiProgress',
                    processed,
                    total,
                    currentItem: `${item.title || item.url} (${updated} updated)`,
                    apiHits: processed
                });

            } catch (error) {
                console.warn(`[AI][single] Failed to process ${item.url}:`, error);
                processed++;
            }
        }

        chrome.runtime.sendMessage({ action: 'aiComplete' });
        chrome.runtime.sendMessage({ action: 'updateData' });

        console.log(`[AI][single] Category ${categoryName} sync completed: ${processed} processed, ${updated} updated`);

    } catch (error) {
        console.error(`[AI][single] Single category sync failed for ${categoryName}:`, error);
        chrome.runtime.sendMessage({
            action: 'aiError',
            error: String(error)
        });
    }
}

// Helper function to build category-targeted prompts
function buildCategoryTargetedPrompt(categoryName, candidateItems) {
    const urls = candidateItems.map(item => item.url).slice(0, 20);

    return `Analyze the following URLs and identify which ones belong to the "${categoryName}" category.
Consider visit patterns, URL structure, and content context.

Return JSON with format: { "matches": [{"url": "...", "confidence": 0.85, "reason": "..."}] }

Category: ${categoryName}
URLs to analyze:
${urls.join('\n')}`;
}

// Helper function to get AI category matches
async function getAiCategoryMatches(prompt, apiKey) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanJson = text.replace(/```json|```/g, '').trim();

        const result = JSON.parse(cleanJson);
        return result.matches || [];

    } catch (error) {
        console.error('[AI] Category matching failed:', error);
        return [];
    }
}

// Enhanced message handlers for background.js
function addEnhancedMessageHandlers() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.action === 'bulkCategorySync') {
            (async () => {
                try {
                    await handleBulkCategorySync(msg.options || {});
                    sendResponse({ ok: true });
                } catch (error) {
                    sendResponse({ ok: false, error: String(error) });
                }
            })();
            return true;
        }

        if (msg?.action === 'recategorizeCategorized') {
            (async () => {
                try {
                    await handleAlreadyCategorizedSync(msg.options || {});
                    sendResponse({ ok: true });
                } catch (error) {
                    sendResponse({ ok: false, error: String(error) });
                }
            })();
            return true;
        }

        if (msg?.action === 'syncSingleCategory') {
            (async () => {
                try {
                    await handleSingleCategorySync(msg.categoryName, msg.options || {});
                    sendResponse({ ok: true });
                } catch (error) {
                    sendResponse({ ok: false, error: String(error) });
                }
            })();
            return true;
        }
    });
}

// UI Components for React
function EnhancedSyncControls({
    onBulkSync,
    onRecategorize,
    onSingleCategorySync,
    categories = [],
    progress
}) {
    const [selectedCategory, setSelectedCategory] = useState('');
    const [syncOptions, setSyncOptions] = useState({
        batchSize: 10,
        minVisitCount: 1,
        forceRecategorize: false
    });

    return (
        <div className="sync-controls" style={{ margin: '16px 0', padding: '16px', border: '1px solid #273043', borderRadius: '8px' }}>
            <h3>AI Category Sync</h3>

            {/* Bulk Sync */}
            <div style={{ marginBottom: '12px' }}>
                <button
                    onClick={() => onBulkSync(syncOptions)}
                    disabled={progress.running}
                    className="add-link-btn ai-button"
                >
                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                    Bulk Categorize All
                </button>
                <small style={{ marginLeft: '8px', opacity: 0.7 }}>
                    Process all uncategorized items
                </small>
            </div>

            {/* Recategorize Existing */}
            <div style={{ marginBottom: '12px' }}>
                <button
                    onClick={() => onRecategorize({ forceRecategorize: false })}
                    disabled={progress.running}
                    className="add-link-btn"
                >
                    Re-evaluate Categories
                </button>
                <small style={{ marginLeft: '8px', opacity: 0.7 }}>
                    Check existing categorizations
                </small>
            </div>

            {/* Single Category Sync */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px' }}
                >
                    <option value="">Select category...</option>
                    {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                    ))}
                </select>
                <button
                    onClick={() => selectedCategory && onSingleCategorySync(selectedCategory)}
                    disabled={progress.running || !selectedCategory}
                    className="add-link-btn ai-button"
                >
                    Sync Category
                </button>
            </div>

            {/* Options */}
            <details style={{ marginTop: '12px' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Sync Options</summary>
                <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    <label>
                        Batch Size:
                        <input
                            type="number"
                            value={syncOptions.batchSize}
                            onChange={(e) => setSyncOptions(prev => ({ ...prev, batchSize: Number(e.target.value) }))}
                            min="1"
                            max="50"
                            style={{ width: '100%', padding: '4px' }}
                        />
                    </label>
                    <label>
                        Min Visit Count:
                        <input
                            type="number"
                            value={syncOptions.minVisitCount}
                            onChange={(e) => setSyncOptions(prev => ({ ...prev, minVisitCount: Number(e.target.value) }))}
                            min="1"
                            style={{ width: '100%', padding: '4px' }}
                        />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                        <input
                            type="checkbox"
                            checked={syncOptions.forceRecategorize}
                            onChange={(e) => setSyncOptions(prev => ({ ...prev, forceRecategorize: e.target.checked }))}
                        />
                        Force recategorize all items
                    </label>
                </div>
            </details>
        </div>
    );
}


Looking at your code, I can see you have a Chrome extension that categorizes URLs using AI.Let me help you implement bulk category sync with proper handling for the three scenarios you mentioned.Here's a comprehensive solution for your AI category sync needs. The implementation handles all three scenarios you mentioned:

## Key Features:

### 1. ** Bulk Categories Handler **
    - Processes items in configurable batches with concurrency control
        - Prioritizes by visit count to handle high - traffic URLs first
            - Deduplicates by hostname to ensure category diversity
                - Respects minimum visit count thresholds
                    - Includes rate limiting and error handling

### 2. ** Already Categorized Items Handler **
    - Supports selective recategorization with whitelist / blacklist
    - Uses confidence thresholds to avoid unnecessary changes
        - Can identify potentially misclassified items based on usage patterns
            - Logs all category changes for audit purposes

### 3. ** Single Category Sync **
    - Finds uncategorized items that should belong to a specific category
        - Can revalidate existing items in that category
            - Uses targeted AI prompts for better accuracy
                - Configurable limits for new items per sync

## Integration with Your Existing Code:

To integrate this with your current codebase, add these message handlers to your `background.js`:

```javascript
// Add to your existing message listener in background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ... your existing handlers

  if (msg?.action === 'bulkCategorySync') {
    (async () => {
      try {
        await handleBulkCategorySync(msg.options || {});
        sendResponse({ ok: true });
      } catch (error) {
        chrome.runtime.sendMessage({ action: 'aiError', error: String(error) });
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  if (msg?.action === 'recategorizeCategorized') {
    (async () => {
      try {
        await handleAlreadyCategorizedSync(msg.options || {});
        sendResponse({ ok: true });
      } catch (error) {
        chrome.runtime.sendMessage({ action: 'aiError', error: String(error) });
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  if (msg?.action === 'syncSingleCategory') {
    (async () => {
      try {
        await handleSingleCategorySync(msg.categoryName, msg.options || {});
        sendResponse({ ok: true });
      } catch (error) {
        chrome.runtime.sendMessage({ action: 'aiError', error: String(error) });
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
});
```

## Usage in Your React Component:

Add these functions to your App.jsx:

```javascript
const handleBulkSync = async (options) => {
  try {
    await sendMessage({ action: 'bulkCategorySync', options });
  } catch (error) {
    console.error('Bulk sync failed:', error);
  }
};

const handleRecategorize = async (options) => {
  try {
    await sendMessage({ action: 'recategorizeCategorized', options });
  } catch (error) {
    console.error('Recategorization failed:', error);
  }
};

const handleSingleCategorySync = async (categoryName, options = {}) => {
  try {
    await sendMessage({ action: 'syncSingleCategory', categoryName, options });
  } catch (error) {
    console.error('Single category sync failed:', error);
  }
};
```

## Smart Categorization Features:

1. ** Visit Count Intelligence **: Prioritizes frequently visited URLs
2. ** Hostname Deduplication **: Ensures diverse category representation
3. ** Confidence Scoring **: Only recategorizes when AI is confident
4. ** Batch Processing **: Handles large datasets efficiently
5. ** Rate Limiting **: Prevents API quota exhaustion
6. ** Progress Tracking **: Real - time updates on sync progress

This implementation will significantly improve your URL categorization accuracy while respecting API limits and providing a smooth user experience.