const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 3000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase payload limit
app.use(express.static('.'));

// --- IN-MEMORY STORAGE ---
let dataStore = {}; // { userId: { bookmarks: [], history: [], lastSync: date } }
let aiCache = {}; // { cleanUrl: { summary, category, timestamp } }

// --- HELPER FUNCTIONS ---
const cleanUrl = (url) => {
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '');
    } catch (error) {
        return null; // Invalid URL
    }
};

const getAiEnrichment = async (url, apiKey) => {
    const cleanedUrl = cleanUrl(url);
    if (!cleanedUrl) return { summary: 'Invalid URL', category: 'Error' };

    // Return from cache if available and not too old (e.g., 30 days)
    if (aiCache[cleanedUrl] && (Date.now() - aiCache[cleanedUrl].timestamp < 30 * 24 * 60 * 60 * 1000)) {
        return aiCache[cleanedUrl];
    }

    if (!apiKey) {
        return { summary: 'API key is missing.', category: 'Error' };
    }

    try {
        const prompt = `### INSTRUCTIONS ###\n\n**Persona:**\nYou are an expert AI assistant specializing in software development tools and developer productivity workflows.\n\n**Core Task:**\nYour task is to analyze a given URL and classify it according to a predefined schema. You must determine its primary function, any secondary functions, and the high-level workspace it belongs to.\n\n**Rules:**\n1.  Analyze the provided URL to identify the tool, platform, or service it represents.\n2.  Assign **exactly one** \`primary_category\` from the **Category List**. This should be the tool's main purpose.\n3.  Assign **one or more** \`secondary_categories\` if the tool has other significant functions. If none apply, use an empty array \`[]\`.\n4.  Assign **exactly one** \`workspace_group\` from the **Workspace List**. This should be the broad bucket where a developer would group this tool.\n5.  Provide a concise \`justification\` explaining your categorization choices, referencing the tool's main features.\n6.  Suggest 3-5 relevant \`suggested_tags\` in lowercase for filtering and search.\n7.  Return the output as a single, well-formed JSON object.\n\n**Output Schema (JSON):**\n{\n  "tool_name": "The common name of the tool or platform.",\n  "primary_category": "The single most fitting category from the list.",\n  "secondary_categories": ["An array of other relevant categories from the list."],\n  "workspace_group": "The single high-level bucket from the workspace list.",\n  "justification": "A brief, one-sentence explanation for your categorization choices.",\n  "suggested_tags": ["An array of 3-5 relevant lowercase keywords."]\n}\n\n**Category List:**\n*   Source Control & Versioning\n*   Cloud & Infrastructure\n*   Code Assistance & AI Coding\n*   Documentation & Knowledge Search\n*   Testing & QA Automation\n*   Project Management & Collaboration\n*   Data Analysis & Visualization\n*   DevOps & CI/CD\n*   UI/UX & Design\n*   APIs & Integrations\n*   Learning & Upskilling\n*   AI & Machine Learning\n*   Security & Compliance\n*   Monitoring & Observability\n*   Local Development & Environments\n*   Package Management\n*   Database Management\n*   Communication\n\n**Workspace List:**\n*   Code & Versioning\n*   Cloud & Infrastructure\n*   AI & ML\n*   DevOps & Automation\n*   Testing & Quality\n*   Data & Analytics\n*   Design & UX\n*   Project & Team\n\n### URL TO CLASSIFY ###\n\n${cleanedUrl}`;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const response = await axios.post(apiUrl, {
            contents: [{ parts: [{ text: prompt }] }]
        });

        let aiData = null;
        try {
            const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const rawJson = text.replace(/```json|```/g, '').trim();
            aiData = JSON.parse(rawJson);
        } catch (_) {
            // keep fallback
        }

        // Build the rich object expected by the client (background.js adapts these fields)
        const enrichment = {
            tool_name: aiData?.tool_name || null,
            primary_category: aiData?.primary_category || 'Uncategorized',
            secondary_categories: Array.isArray(aiData?.secondary_categories) ? aiData.secondary_categories : [],
            workspace_group: aiData?.workspace_group || null,
            justification: aiData?.justification || 'No justification provided.',
            suggested_tags: Array.isArray(aiData?.suggested_tags) ? aiData.suggested_tags : [],
            timestamp: Date.now()
        };
        aiCache[cleanedUrl] = enrichment; // Update cache
        return enrichment;

    } catch (error) {
        console.error(`AI enrichment failed for ${cleanedUrl}:`, error.message);
        return { summary: 'Could not summarize this page.', category: 'Uncategorized' };
    }
};

const enrichData = async (items, apiKey) => {
    const enrichedItems = await Promise.all(items.map(async (item) => {
        const aiData = await getAiEnrichment(item.url, apiKey);
        return { ...item, ...aiData, cleanUrl: cleanUrl(item.url) };
    }));
    return enrichedItems;
};

// --- API ENDPOINTS ---
app.post('/api/sync/:userId', async (req, res) => {
    const { userId } = req.params;
    const { bookmarks, history, lastSync, apiKey } = req.body;

    try {
        console.log(`Syncing data for user ${userId}...`);
        const enrichedBookmarks = await enrichData(bookmarks.flatMap(b => b.children ? flattenBookmarks(b.children) : (b.url ? [b] : [])), apiKey);
        const enrichedHistory = await enrichData(history, apiKey);

        dataStore[userId] = {
            bookmarks: enrichedBookmarks,
            history: enrichedHistory,
            lastSync
        };
        console.log(`Sync complete for user ${userId}.`);
        res.json({ success: true, message: 'Data synced and enriched successfully' });
    } catch (error) {
        console.error('Sync failed:', error);
        res.status(500).json({ success: false, message: 'Failed to sync data.' });
    }
});

app.get('/api/data/:userId', (req, res) => {
    const { userId } = req.params;
    const data = dataStore[userId] || { bookmarks: [], history: [] };
    res.json(data);
});

// --- UTILITY & SERVER START ---
const flattenBookmarks = (bookmarks) => {
    return bookmarks.reduce((acc, bookmark) => {
        if (bookmark.url) acc.push(bookmark);
        if (bookmark.children) acc.push(...flattenBookmarks(bookmark.children));
        return acc;
    }, []);
};

app.get('/landing/:userId', (req, res) => {
    res.sendFile(path.join(__dirname, 'web-landing.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
