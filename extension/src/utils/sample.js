
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


