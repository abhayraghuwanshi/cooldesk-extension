// PSL library for proper domain parsing
const psl = {
    parse: (hostname) => {
        // Enhanced domain parsing for common TLDs
        if (hostname.includes('.')) {
            const parts = hostname.split('.');
            if (parts.length >= 2) {
                // Handle common multi-level TLDs
                const lastTwo = parts.slice(-2).join('.');
                const lastThree = parts.slice(-3).join('.');

                // Common multi-level TLDs
                const multiLevelTLDs = [
                    'co.uk', 'com.au', 'co.nz', 'co.za', 'co.in', 'co.jp',
                    'com.br', 'com.mx', 'com.sg', 'com.hk', 'com.tw',
                    'org.uk', 'net.uk', 'gov.uk', 'ac.uk',
                    'edu.au', 'gov.au', 'org.au',
                    'co.il', 'org.il', 'net.il',
                    'com.cn', 'org.cn', 'net.cn',
                    'co.kr', 'or.kr', 'go.kr'
                ];

                if (multiLevelTLDs.includes(lastThree) && parts.length >= 3) {
                    return { domain: parts.slice(-3).join('.') };
                }

                return { domain: lastTwo };
            }
        }
        return { domain: hostname };
    }
};

const thirtyDaysAgo = () => Date.now() - (30 * 24 * 60 * 60 * 1000);




// ---- Helpers to promisify chrome.* callback APIs ----
const getFromStorage = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setToStorage = (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve));
const queryTabs = (queryInfo) => new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
const updateTab = (tabId, updateProperties) => new Promise((resolve) => chrome.tabs.update(tabId, updateProperties, resolve));
const createTab = (createProperties) => new Promise((resolve) => chrome.tabs.create(createProperties, resolve));
const getBookmarksTree = () => new Promise((resolve) => chrome.bookmarks.getTree(resolve));
const searchHistory = (query) => new Promise((resolve) => chrome.history.search(query, resolve));

// ---- AI enrichment helpers ----
const aiCache = {};
const ENRICHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---- Active tab time tracking ----
let currentActive = { tabId: null, url: null, since: 0 };
let timeSpent = {};

// Load existing timeSpent from storage on startup
(async () => {
    try {
        const stored = await getFromStorage(['timeSpent']);
        if (stored && stored.timeSpent && typeof stored.timeSpent === 'object') {
            timeSpent = stored.timeSpent;
        }
    } catch {}
})();

function accumulateTime(url, now = Date.now()) {
    if (!url || !currentActive.since) return;
    const cleaned = cleanUrl(url);
    if (!cleaned) return;
    const delta = Math.max(0, now - currentActive.since);
    timeSpent[cleaned] = (timeSpent[cleaned] || 0) + delta;
    // Persist lightly (fire and forget)
    setToStorage({ timeSpent });
}

async function handleActivated(tabId) {
    const now = Date.now();
    // Stop previous
    if (currentActive.tabId && currentActive.url) accumulateTime(currentActive.url, now);
    // Start new
    try {
        const [tab] = await queryTabs({ active: true, currentWindow: true });
        currentActive = { tabId, url: tab?.url || null, since: now };
    } catch {
        currentActive = { tabId, url: null, since: now };
    }
}

function handleFocusChanged(windowId) {
    const now = Date.now();
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // Lost focus, stop tracking
        if (currentActive.url) accumulateTime(currentActive.url, now);
        currentActive.since = 0;
    } else {
        // Regained focus, restart timing
        if (currentActive.tabId && currentActive.url) currentActive.since = now;
    }
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (tabId !== currentActive.tabId) return;
    if (changeInfo.status === 'loading' && currentActive.url) {
        // Accumulate time for the old URL before navigating
        accumulateTime(currentActive.url, Date.now());
        currentActive.since = Date.now();
    }
    if (changeInfo.url) {
        // URL changed
        currentActive.url = changeInfo.url;
        if (!currentActive.since) currentActive.since = Date.now();
    }
}

chrome.tabs.onActivated.addListener(activeInfo => handleActivated(activeInfo.tabId));
chrome.windows.onFocusChanged.addListener(handleFocusChanged);
chrome.tabs.onUpdated.addListener(handleTabUpdated);

// IndexedDB persistent cache for AI enrichment
function openAiDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('devlink-ai', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('enrichments')) {
                const store = db.createObjectStore('enrichments', { keyPath: 'url' });
                store.createIndex('timestamp', 'timestamp');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getEnrichmentFromDb(cleanedUrl) {
    const db = await openAiDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('enrichments', 'readonly');
        const store = tx.objectStore('enrichments');
        const req = store.get(cleanedUrl);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function putEnrichmentToDb(record) {
    const db = await openAiDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('enrichments', 'readwrite');
        const store = tx.objectStore('enrichments');
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

const cleanUrl = (url) => {
    try {
        const urlObj = new URL(url);
        const parsed = psl.parse(urlObj.hostname);
        return `${urlObj.protocol}//${parsed.domain}`;
    } catch (e) {
        return null;
    }
};

async function getAiEnrichment(url, apiKey) {
    const cleaned = cleanUrl(url);
    if (!cleaned) return { summary: 'Invalid URL', category: 'Error' };

    // First, check non-expired IndexedDB cache
    try {
        const cached = await getEnrichmentFromDb(cleaned);
        if (cached && (Date.now() - cached.timestamp < ENRICHMENT_TTL_MS)) {
            return cached; // Return cached data if valid
        }
    } catch (e) {
        console.error('Error reading from IndexedDB', e);
    }

    console.log(`%cEnriching: ${cleaned}`, 'color: #4CAF50; font-weight: bold;');

    try {
        console.log(`AI Cache MISS for ${cleaned}. Calling Gemini directly...`);
        const ms = timeSpent[cleaned] || 0;
        const minutesSpent = Math.round(ms / 60000);
        const prompt = `### INSTRUCTIONS ###\n\n**Persona:**\nYou are an expert AI assistant specializing in software development tools and developer productivity workflows.\n\n**Core Task:**\nAnalyze the given URL and classify it according to the schema. Also provide a concise user-centric suggestion informed by how much time the user spent on this site.\n\n**Rules:**\n1. Determine the tool/platform the URL represents.\n2. Assign exactly one primary_category from the Category List.\n3. Assign zero or more secondary_categories.\n4. Assign exactly one workspace_group from the Workspace List.\n5. Provide a concise justification.\n6. Suggest 1 short actionable suggestion (max 140 chars) in plain text under the 'suggestion' field. Consider user time spent: ${minutesSpent} minutes.\n7. Suggest 3-5 relevant suggested_tags in lowercase.\n8. Return a single well-formed JSON using the Output Schema.\n\n**Output Schema (JSON):**\n{\n  "tool_name": "The common name of the tool or platform.",\n  "primary_category": "The single most fitting category from the list.",\n  "secondary_categories": ["An array of other relevant categories from the list."],\n  "workspace_group": "The single high-level bucket from the workspace list.",\n  "justification": "A brief, one-sentence explanation for your categorization choices.",\n  "suggested_tags": ["An array of 3-5 relevant lowercase keywords."],\n  "suggestion": "One concise actionable recommendation for the user."\n}\n\n**Category List:**\n*   Source Control & Versioning\n*   Cloud & Infrastructure\n*   Code Assistance & AI Coding\n*   Documentation & Knowledge Search\n*   Testing & QA Automation\n*   Project Management & Collaboration\n*   Data Analysis & Visualization\n*   DevOps & CI/CD\n*   UI/UX & Design\n*   APIs & Integrations\n*   Learning & Upskilling\n*   AI & Machine Learning\n*   Security & Compliance\n*   Monitoring & Observability\n*   Local Development & Environments\n*   Package Management\n*   Database Management\n*   Communication\n\n**Workspace List:**\n*   Code & Versioning\n*   Cloud & Infrastructure\n*   AI & ML\n*   DevOps & Automation\n*   Testing & Quality\n*   Data & Analytics\n*   Design & UX\n*   Project & Team\n\n### URL TO CLASSIFY ###\n\n${cleaned}`;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const rawJson = text.replace(/```json|```/g, '').trim();
        let aiData = {};
        try { aiData = JSON.parse(rawJson); } catch (_) { aiData = {}; }

        const adaptedEnrichment = {
            summary: aiData.justification || 'No summary available.',
            category: { name: aiData.primary_category || 'Uncategorized', icon: '✨' },
            tags: Array.isArray(aiData.suggested_tags) ? aiData.suggested_tags : [],
            toolName: aiData.tool_name || null,
            secondaryCategories: Array.isArray(aiData.secondary_categories) ? aiData.secondary_categories : [],
            workspaceGroup: aiData.workspace_group || null,
            suggestion: typeof aiData.suggestion === 'string' ? aiData.suggestion : null,
            timestamp: Date.now(),
        };

        // Store the new structure in IndexedDB
        await putEnrichmentToDb({ url: cleaned, ...adaptedEnrichment });

        const { url: _, ...enrichmentData } = adaptedEnrichment;
        return { ...enrichmentData, __apiHit: true };

    } catch (error) {
        console.error(`Failed to get AI enrichment for ${url}:`, error);
        return { summary: `Error: ${error.message}`, category: { name: 'Error', icon: '❌' }, tags: [] };
    }
}

async function enrichData(items, apiKey) {
    const results = [];
    for (const item of items) {
        const ai = await getAiEnrichment(item.url, apiKey);
        results.push({ ...item, ...ai, cleanUrl: cleanUrl(item.url) });
    }
    return results;
}

const syncData = async () => {
    console.log('syncData: Starting...');
    const { userId, geminiApiKey, visitCountThreshold: storedThreshold, historyMaxResults: storedMax } = await getFromStorage(['userId', 'geminiApiKey', 'visitCountThreshold', 'historyMaxResults']);

    let ensuredUserId = userId;
    if (!ensuredUserId) {
        ensuredUserId = 'user_' + Math.random().toString(36).substr(2, 9);
        await setToStorage({ userId: ensuredUserId });
    }

    const bookmarkTree = await getBookmarksTree();
    const visitCountThreshold = Number.isFinite(storedThreshold) ? storedThreshold : 10; // default 10
    const historyMaxResults = Number.isFinite(storedMax) ? storedMax : 1000; // default 1000
    const flatBookmarks = parseBookmarks(bookmarkTree[0]);

    const history = (await searchHistory({ text: '', maxResults: historyMaxResults, startTime: thirtyDaysAgo() }))
        .filter(item => item.visitCount > visitCountThreshold)
        .map(item => ({ ...item, type: 'History' }));

    // Store raw data without AI enrichment
    const dashboardData = {
        bookmarks: flatBookmarks.map(b => ({ ...b, type: 'Bookmark' })),
        history: history,
        lastSync: Date.now(),
        filters: {
            historyStart: thirtyDaysAgo(),
            visitCountThreshold,
            historyMaxResults
        }
    };
    await setToStorage({ dashboardData });

    console.log('syncData: Finished.');
    return dashboardData;
};

const enrichDataWithAI = async (progressCallback) => {
    console.log('enrichDataWithAI: Starting...');
    const { dashboardData, geminiApiKey } = await getFromStorage(['dashboardData', 'geminiApiKey']);

    if (!geminiApiKey) {
        throw new Error('No API key found');
    }

    // Enrich only History items; exclude bookmarks from AI calls
    const allItems = [...(dashboardData?.history || [])];
    const totalItems = allItems.length;
    let processedItems = 0;

    // Enrich items with progress updates
    const enrichedItems = [];
    let apiHits = 0;
    let errorCount = 0;
    for (const item of allItems) {
        const ai = await getAiEnrichment(item.url, geminiApiKey);
        if (ai && ai.__apiHit) apiHits++;
        const isError = !ai || (ai.category && ai.category.name === 'Error');
        if (isError) {
            errorCount++;
        }
        const { __apiHit, ...aiClean } = ai || {};
        enrichedItems.push({ ...item, ...aiClean, cleanUrl: cleanUrl(item.url) });

        processedItems++;
        if (progressCallback) {
            progressCallback(processedItems, totalItems, item.title || item.url, apiHits);
        }

        if (errorCount > 3) {
            if (progressCallback) {
                progressCallback(processedItems, totalItems, 'Stopping: too many errors', apiHits);
            }
            throw new Error('Too many AI enrichment errors (>3). Aborting sync.');
        }
    }

    // Separate bookmarks and history
    const enrichedBookmarks = enrichedItems.filter(item => item.type === 'Bookmark');
    const enrichedHistory = enrichedItems.filter(item => item.type === 'History');

    const enrichedDashboardData = {
        bookmarks: enrichedBookmarks,
        history: enrichedHistory,
        lastSync: Date.now()
    };
    await setToStorage({ dashboardData: enrichedDashboardData });

    console.log('enrichDataWithAI: Finished.');
    return enrichedDashboardData;
};

const openDashboard = async () => {
    console.log('Attempting to open dashboard...');
    const dashboardUrl = chrome.runtime.getURL('index.html');
    console.log('Dashboard URL:', dashboardUrl);

    try {
        const tabs = await queryTabs({});
        const existing = tabs.find(t => t.url && t.url.startsWith(dashboardUrl));
        if (existing) {
            console.log('Dashboard tab found, focusing it.');
            await updateTab(existing.id, { active: true });
            return existing.id;
        }
        console.log('No dashboard tab found, creating a new one.');
        const created = await createTab({ url: dashboardUrl, active: true });
        return created.id;
    } catch (e) {
        console.error('Failed to open/focus dashboard', e);
        return null;
    }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request.action);
    if (request.action === 'syncAndOpenDashboard') {
        (async () => {
            await openDashboard();
            // Kick off sync but don't block opening UI
            const syncedData = await syncData();
            // Broadcast update to all extension pages (dashboard listens via runtime.onMessage)
            chrome.runtime.sendMessage({ action: 'updateData', data: syncedData });
        })();
    } else if (request.action === 'enrichWithAI') {
        (async () => {
            try {
                const progressCallback = (processed, total, currentItem, apiHits) => {
                    chrome.runtime.sendMessage({
                        action: 'aiProgress',
                        processed,
                        total,
                        currentItem,
                        apiHits
                    });
                };

                const enrichedData = await enrichDataWithAI(progressCallback);
                chrome.runtime.sendMessage({
                    action: 'aiComplete',
                    data: enrichedData
                });
            } catch (error) {
                chrome.runtime.sendMessage({
                    action: 'aiError',
                    error: error.message
                });
            }
        })();
    }
    return true; // Indicates async response
});

function parseBookmarks(bookmarkNode) {
    let bookmarks = [];
    if (bookmarkNode.url) {
        bookmarks.push({ title: bookmarkNode.title, url: bookmarkNode.url, dateAdded: bookmarkNode.dateAdded });
    }
    if (bookmarkNode.children) {
        bookmarkNode.children.forEach(child => {
            bookmarks = bookmarks.concat(parseBookmarks(child));
        });
    }
    return bookmarks;
}
