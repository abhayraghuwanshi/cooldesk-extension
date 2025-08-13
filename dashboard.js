// PSL library is loaded from CDN in the HTML
const psl = window.psl || {
    parse: (hostname) => {
        // Fallback implementation if CDN fails
        const parts = hostname.split('.');
        if (parts.length >= 2) {
            return { domain: parts.slice(-2).join('.') };
        }
        return { domain: hostname };
    }
};

// Test PSL functionality
console.log('PSL Library Status:', {
    fromCDN: !!window.psl,
    fallback: !window.psl,
    test: psl.parse('console.cloud.google.com')
});
let userId = null;
let fullData = [];
let activeFilters = { search: '', category: 'All', workspace: 'All' };
let currentView = 'stats'; // 'stats' or 'category'
let dataFilters = null; // { historyStart, visitCountThreshold }

function passesHistoryFilters(item) {
    // Only enforce in category view: show recent and frequent History items
    if (!dataFilters) return true;
    if (item.type !== 'History') return false; // exclude bookmarks in category mode per requirement
    const start = typeof dataFilters.historyStart === 'number' ? dataFilters.historyStart : (Date.now() - 30 * 24 * 60 * 60 * 1000);
    const threshold = typeof dataFilters.visitCountThreshold === 'number' ? dataFilters.visitCountThreshold : 0;
    const lv = item.lastVisitTime || 0;
    const vc = item.visitCount || 0;
    return lv >= start && vc > threshold;
}

const settingsBtn = document.getElementById('settings-btn');
const modalOverlay = document.getElementById('modal-overlay');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalSaveBtn = document.getElementById('modal-save-btn');
const apiKeyInputModal = document.getElementById('api-key-input-modal');
const apiStatus = document.getElementById('api-status');
const apiServerInputModal = document.getElementById('api-server-input-modal');
const visitThresholdInput = document.getElementById('visit-threshold-input');
const historyLimitInput = document.getElementById('history-limit-input');
const searchInput = document.getElementById('search-input');
const syncBtn = document.getElementById('sync-btn');

// --- Inline search suggestions (history matches) ---
const searchSuggestions = document.createElement('ul');
searchSuggestions.id = 'search-suggestions';
searchSuggestions.style.cssText = `
  position: absolute;
  z-index: 1000;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  margin-top: 4px;
  width: 100%;
  max-height: 260px;
  overflow-y: auto;
  display: none;
  list-style: none;
  padding: 6px 0;
`;

function attachSuggestions() {
    if (!searchInput) return;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    // Wrap the input to anchor the absolute dropdown
    searchInput.parentNode.insertBefore(wrapper, searchInput);
    wrapper.appendChild(searchInput);
    wrapper.appendChild(searchSuggestions);
}

function getHistorySuggestions(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    const matches = [];
    for (const item of fullData) {
        if (item.type !== 'History') continue;
        const title = (item.title || '').toLowerCase();
        const url = (item.url || '').toLowerCase();
        if ((title.includes(q) || url.includes(q)) && !seen.has(item.url)) {
            seen.add(item.url);
            matches.push(item);
            if (matches.length >= limit) break;
        }
    }
    return matches;
}

function hideSuggestions() {
    searchSuggestions.style.display = 'none';
    searchSuggestions.innerHTML = '';
}

function renderSuggestions(query) {
    const items = getHistorySuggestions(query);
    if (items.length === 0) {
        hideSuggestions();
        return;
    }
    searchSuggestions.innerHTML = items.map(i => `
        <li class="suggestion-item" style="padding:8px 12px; cursor:pointer; display:flex; gap:8px; align-items:center;">
            ${createFaviconElement(i.url, 'small')}
            <div style="display:flex; flex-direction:column;">
                <span style="font-size:13px; color:#eaeaea;">${i.title ? i.title.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'No Title'}</span>
                <span style="font-size:12px; color:#9aa0a6;">${i.url}</span>
            </div>
        </li>
    `).join('');
    // Bind clicks
    Array.from(searchSuggestions.querySelectorAll('.suggestion-item')).forEach((el, idx) => {
        const target = items[idx];
        el.addEventListener('click', () => {
            window.open(target.url, '_blank');
            hideSuggestions();
        });
    });
    searchSuggestions.style.display = 'block';
}

// Modal functionality
settingsBtn.addEventListener('click', () => {
    openModal();
});

modalCloseBtn.addEventListener('click', () => {
    closeModal();
});

modalCancelBtn.addEventListener('click', () => {
    closeModal();
});

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        closeModal();
    }
});

modalSaveBtn.addEventListener('click', async () => {
    const key = apiKeyInputModal.value.trim();
    const serverUrl = (apiServerInputModal?.value || '').trim();
    const visitThresholdRaw = (visitThresholdInput?.value || '').trim();
    const historyLimitRaw = (historyLimitInput?.value || '').trim();
    if (!key) {
        updateApiStatus('invalid');
        showToast('Please enter a valid API key.');
        return;
    }

    // Basic URL validation (optional)
    if (serverUrl && !/^https?:\/\/[^\s]+$/i.test(serverUrl)) {
        showToast('Please enter a valid API Server URL (http/https).');
        return;
    }

    // Validate numeric inputs if provided
    const toSave = { geminiApiKey: key };
    if (serverUrl) toSave.serverUrl = serverUrl.replace(/\/$/, '');
    if (visitThresholdRaw !== '') {
        const vt = Number(visitThresholdRaw);
        if (!Number.isFinite(vt) || vt < 0) {
            showToast('Visit Count Threshold must be a non-negative number.');
            return;
        }
        toSave.visitCountThreshold = vt;
    }
    if (historyLimitRaw !== '') {
        const hl = Number(historyLimitRaw);
        if (!Number.isFinite(hl) || hl < 10) {
            showToast('History Fetch Limit must be a number ≥ 10.');
            return;
        }
        toSave.historyMaxResults = hl;
    }
    await chrome.storage.local.set(toSave);
    updateApiStatus('valid');
    showToast('Settings saved successfully!');
    closeModal();
});

function openModal() {
    modalOverlay.classList.add('active');
    loadApiKeyToModal();
    updateApiStatus();
    apiKeyInputModal.focus();
}

function closeModal() {
    modalOverlay.classList.remove('active');
    apiKeyInputModal.value = '';
}

async function loadApiKeyToModal() {
    const { geminiApiKey, serverUrl, visitCountThreshold, historyMaxResults } = await chrome.storage.local.get(['geminiApiKey', 'serverUrl', 'visitCountThreshold', 'historyMaxResults']);
    if (geminiApiKey) {
        apiKeyInputModal.value = geminiApiKey;
    }
    if (apiServerInputModal && serverUrl) {
        apiServerInputModal.value = serverUrl;
    }
    if (visitThresholdInput && Number.isFinite(visitCountThreshold)) {
        visitThresholdInput.value = String(visitCountThreshold);
    }
    if (historyLimitInput && Number.isFinite(historyMaxResults)) {
        historyLimitInput.value = String(historyMaxResults);
    }
}

async function updateApiStatus(status = null) {
    if (!status) {
        const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
        status = geminiApiKey ? 'valid' : 'missing';
    }

    apiStatus.className = `api-status ${status}`;

    switch (status) {
        case 'valid':
            apiStatus.innerHTML = '<span>✅ API Key Status: Valid</span>';
            break;
        case 'invalid':
            apiStatus.innerHTML = '<span>❌ API Key Status: Invalid</span>';
            break;
        case 'missing':
            apiStatus.innerHTML = '<span>⚠️ API Key Status: Missing</span>';
            break;
    }
}

// Sync button functionality
syncBtn.addEventListener('click', async () => {
    const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
    if (!geminiApiKey) {
        showToast('Please configure your Gemini API key in settings first.');
        openModal();
        return;
    }

    syncBtn.classList.add('loading');
    syncBtn.textContent = 'Syncing...';
    syncBtn.disabled = true;

    // Show progress container
    showProgressContainer();

    try {
        // Trigger AI enrichment
        chrome.runtime.sendMessage({ action: 'enrichWithAI' });

        // Show a toast notification
        showToast('AI sync started! This may take a few minutes...');
    } catch (error) {
        console.error('Sync failed:', error);
        showToast('Sync failed. Please try again.');
        hideProgressContainer();
    } finally {
        // Reset button after a delay
        setTimeout(() => {
            syncBtn.classList.remove('loading');
            syncBtn.textContent = 'Sync';
            syncBtn.disabled = false;
        }, 3000);
    }
});

function showProgressContainer() {
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'block';
        updateProgress(0, 0, 'Starting AI enrichment...');
    }
}

function hideProgressContainer() {
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
}

function updateProgress(processed, total, currentItem, apiHits = 0) {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressStatus = document.getElementById('progress-status');

    if (progressBar && progressText && progressStatus) {
        const percentage = total > 0 ? (processed / total) * 100 : 0;
        progressBar.style.width = `${percentage}%`;
        const apiInfo = total > 0 ? ` (API ${apiHits}/${total})` : '';
        progressText.textContent = `${processed}/${total}${apiInfo}`;
        progressStatus.textContent = currentItem || 'Processing...';
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        color: #121212;
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: bold;
        z-index: 1000;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}

// Add CSS animations for toast
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);


// Styles for active category filter button and hover effects
const filterStyle = document.createElement('style');
filterStyle.textContent = `
    #category-filters .filter-btn {
        transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.1s ease;
    }
    #category-filters .filter-btn:hover {
        transform: translateY(-1px);
        border-color: #3b82f6;
    }
    #category-filters .filter-btn.active {
        background: linear-gradient(135deg, #2a2a2a, #333);
        border-color: #4b5563;
        color: #e5e7eb;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    }
`;
document.head.appendChild(filterStyle);


async function loadData() {
    const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
    dataFilters = dashboardData?.filters || null;
    // Update header filter info (since date and visit threshold)
    try {
        const filterInfoEl = document.getElementById('filter-info');
        if (filterInfoEl) {
            const historyStart = dashboardData?.filters?.historyStart;
            const visitThreshold = dashboardData?.filters?.visitCountThreshold;
            const sinceDate = historyStart ? new Date(historyStart) : new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
            const sinceStr = sinceDate.toLocaleDateString();
            const thresholdStr = typeof visitThreshold === 'number' ? visitThreshold : '—';
            filterInfoEl.innerHTML = `
                <span class="filter-pill">Since ${sinceStr}</span>
                <span class="filter-pill">Visits > ${thresholdStr}</span>
            `;
        }
    } catch (e) { console.warn('Failed to render filter info', e); }
    const bookmarks = (dashboardData?.bookmarks || []).map(b => ({ ...b, type: 'Bookmark' }));
    const history = (dashboardData?.history || []).map(h => ({ ...h, type: 'History' }));
    const combined = [...bookmarks, ...history];
    // Hydrate categories/summaries/tags from IndexedDB cache first
    fullData = await hydrateFromIndexedDb(combined);

    console.log('Hydrated data loaded:', fullData.length, 'items');
    console.log('Sample item:', fullData[0]);

    // Check if we have any enriched data (categories)
    const hasEnrichedData = fullData.some(item => item.category && typeof item.category === 'object');
    console.log('Has enriched data:', hasEnrichedData);

    // Remove duplicates based on cleaned URL
    const uniqueMap = new Map();
    fullData.forEach(item => {
        const cleaned = cleanUrl(item.url);
        if (cleaned && !uniqueMap.has(cleaned)) {
            uniqueMap.set(cleaned, item);
        } else if (!cleaned && !uniqueMap.has(item.url)) {
            uniqueMap.set(item.url, item);
        }
    });
    fullData = Array.from(uniqueMap.values());

    fullData.sort((a, b) =>
        (b.lastVisitTime || b.dateAdded || 0) - (a.lastVisitTime || a.dateAdded || 0)
    );

    // Update stats sections
    updateFrequentList();
    updateRecentList();

    renderPage();

    // Show status message and auto-trigger enrichment if needed
    if (fullData.length > 0) {
        const hasAI = fullData.some(item => item.summary && item.summary !== 'No summary available.');
        const hasCategories = fullData.some(item => item.category && typeof item.category === 'object');

        if (!hasAI || !hasCategories) {
            showToast('Data loaded! Starting automatic enrichment to add categories...');
            // Auto-trigger enrichment for better user experience
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'enrichWithAI' });
            }, 1000);
        }
    }
}

function updateFrequentList() {
    // Apply workspace and search filters before computing frequent list
    const searchLower = (activeFilters.search || '').toLowerCase();
    const workspace = activeFilters.workspace;
    const filtered = fullData.filter(item => {
        const inWorkspace = workspace === 'All' || (item.workspaceGroup && item.workspaceGroup === workspace);
        const inSearch = !searchLower ||
            (item.title && item.title.toLowerCase().includes(searchLower)) ||
            (item.url && item.url.toLowerCase().includes(searchLower));
        return inWorkspace && inSearch;
    });

    // Group by URL and count visits
    const urlCounts = {};
    filtered.forEach(item => {
        const url = item.url;
        if (!urlCounts[url]) {
            urlCounts[url] = {
                title: item.title,
                url: url,
                count: 0,
                type: item.type
            };
        }
        // Since we've already deduplicated, just add the visit count
        urlCounts[url].count = Math.max(urlCounts[url].count, item.visitCount || 1);
    });

    // Sort by visit count and take top 10
    const frequentItems = Object.values(urlCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    const frequentList = document.getElementById('frequent-list');
    // Make the stats list a responsive grid of cards
    if (frequentList) {
        frequentList.style.display = 'grid';
        frequentList.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        frequentList.style.gap = '12px';
    }
    if (frequentItems.length === 0) {
        frequentList.innerHTML = '<li class="empty">No data available</li>';
        return;
    }

    frequentList.innerHTML = frequentItems.map(item => `
        <li class="stats-card" onclick="window.open('${item.url}', '_blank')" style="
            list-style: none;
            background: linear-gradient(135deg, #1b1b1b, #202020);
            border: 1px solid #2b2b2b;
            border-radius: 12px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            cursor: pointer;
            transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.35)'; this.style.borderColor='#3a3a3a';"
           onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'; this.style.borderColor='#2b2b2b';">
            <div style="display:flex; align-items:center; gap:10px;">
                ${createFaviconElement(item.url, 'small')}
                <span style="font-weight:600; color:#e5e5e5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title || 'No Title'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; color:#9aa0a6; font-size:0.9em;">
                <span>${getDomainFromUrl(item.url)}</span>
                <span style="background:#263238; color:#80cbc4; padding:2px 8px; border-radius:999px; font-weight:700;">${item.count}</span>
            </div>
        </li>
    `).join('');
}

function updateRecentList() {
    // Apply workspace and search filters, then take most recent
    const searchLower = (activeFilters.search || '').toLowerCase();
    const workspace = activeFilters.workspace;
    const recentItems = fullData
        .filter(item => item.lastVisitTime || item.dateAdded)
        .filter(item => (workspace === 'All' || (item.workspaceGroup && item.workspaceGroup === workspace)))
        .filter(item => !searchLower ||
            (item.title && item.title.toLowerCase().includes(searchLower)) ||
            (item.url && item.url.toLowerCase().includes(searchLower)))
        .slice(0, 10);

    const recentList = document.getElementById('recent-list');
    // Make the stats list a responsive grid of cards
    if (recentList) {
        recentList.style.display = 'grid';
        recentList.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        recentList.style.gap = '12px';
    }
    if (recentItems.length === 0) {
        recentList.innerHTML = '<li class="empty">No data available</li>';
        return;
    }

    recentList.innerHTML = recentItems.map(item => {
        const date = item.lastVisitTime ? new Date(item.lastVisitTime) : new Date(item.dateAdded);
        const dateString = date.toLocaleDateString();
        return `
            <li class="stats-card" onclick="window.open('${item.url}', '_blank')" style="
                list-style: none;
                background: linear-gradient(135deg, #1b1b1b, #202020);
                border: 1px solid #2b2b2b;
                border-radius: 12px;
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                cursor: pointer;
                transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.35)'; this.style.borderColor='#3a3a3a';"
               onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'; this.style.borderColor='#2b2b2b';">
                <div style="display:flex; align-items:center; gap:10px;">
                    ${createFaviconElement(item.url, 'small')}
                    <span style="font-weight:600; color:#e5e5e5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title || 'No Title'}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; color:#9aa0a6; font-size:0.9em;">
                    <span>${getDomainFromUrl(item.url)}</span>
                    <span style="background:#2f2f2f; color:#e0e0e0; padding:2px 8px; border-radius:999px; font-weight:600;">${dateString}</span>
                </div>
            </li>
        `;
    }).join('');
}

function renderPage() {
    const categoryBase = currentView === 'category' ? fullData.filter(passesHistoryFilters) : fullData;

    // Hide category filters and do not render category chips
    const filtersContainer = document.getElementById('category-filters');
    if (filtersContainer) {
        filtersContainer.innerHTML = '';
        filtersContainer.style.display = 'none';
    }

    // Workspace tabs (show only these)
    const workspaces = ['All', ...new Set(categoryBase.map(item => item.workspaceGroup).filter(Boolean))];
    const wsContainer = document.getElementById('workspace-filters');
    if (wsContainer) {
        wsContainer.innerHTML = workspaces.map(ws =>
            `<button class="filter-btn ${ws === activeFilters.workspace ? 'active' : ''}" data-ws="${ws}">${ws}</button>`
        ).join('');
        wsContainer.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => setWorkspaceFilter(btn.dataset.ws));
        });
    }

    // Show stats view by default
    showStatsView();
}

function filterAndRender() {
    const { search, category, workspace } = activeFilters;
    const searchLower = search.toLowerCase();
    const base = currentView === 'category' ? fullData.filter(passesHistoryFilters) : fullData;
    const filteredData = base.filter(item => {
        const inCategory = category === 'All' || (item.category && item.category.name === category);
        const inWorkspace = workspace === 'All' || (item.workspaceGroup && item.workspaceGroup === workspace);
        const inSearch = !searchLower ||
            (item.title && item.title.toLowerCase().includes(searchLower)) ||
            (item.summary && item.summary.toLowerCase().includes(searchLower)) ||
            (item.url && item.url.toLowerCase().includes(searchLower));
        return inCategory && inWorkspace && inSearch;
    });

    // Deduplicate by exact URL when viewing a specific workspace
    let toRender = filteredData;
    if (workspace && workspace !== 'All') {
        const seen = new Set();
        toRender = filteredData.filter(it => {
            const raw = (it && typeof it.url === 'string') ? it.url.trim() : '';
            if (!raw) return false;
            const key = raw.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    if (currentView === 'category' && category !== 'All') {
        displayCategoryItems(toRender, category);
    } else {
        displayItems(toRender);
    }
}

async function displayItems(items) {
    const container = document.getElementById('item-list');
    // Guard: only render entries that look like real items with valid URLs
    const safeItems = items.filter(i => i && typeof i === 'object' && typeof i.url === 'string' && /^https?:\/\//i.test(i.url));

    if (safeItems.length === 0) {
        container.innerHTML = '<li class="empty">No items match your filters.</li>';
        return;
    }
    const itemsHTML = await Promise.all(safeItems.map(createItemHTML));
    container.innerHTML = itemsHTML.join('');
}

async function createItemHTML(item) {
    const date = item.lastVisitTime ? new Date(item.lastVisitTime) : (item.dateAdded ? new Date(item.dateAdded) : null);
    const dateString = date ? date.toLocaleDateString() : 'No date';
    const tags = Array.isArray(item.tags) && item.tags.length > 0 ? `
        <div class="item-tags">
            ${item.tags.map(t => `<span class="tag">${t}</span>`).join('')}
        </div>` : '';
    const favicon = createFaviconElement(item.url, 'normal');
    const urlKey = cleanUrl(item.url) || getDomainFromUrl(item.url);
    const categoryName = item.category ? item.category.name : 'Uncategorized';
    // Determine if the URL has a specific path/query/hash beyond the base key
    let hasFullPath = false;
    try {
        const u = new URL(item.url);
        hasFullPath = (u.pathname && u.pathname !== '/') || !!u.search || !!u.hash;
    } catch {}
    const fullUrlLink = hasFullPath ? `
        <a href="${item.url}"
           class="full-url-link"
           style="margin-left:8px; font-size:12px; color:#60a5fa; text-decoration:none;"
           title="${item.url}"
           target="_blank" rel="noopener noreferrer"
           onclick="event.stopPropagation();">Open full URL ↗</a>` : '';

    // Minimal card for category view: only icon, URL/domain, and tags
    if (currentView === 'category') {
        return `
            <li class="item" style="border-color: ${getCategoryColor(categoryName)};" onclick="window.open('${item.url}', '_blank')">
                <div class="item-url">${favicon}${urlKey}${fullUrlLink}</div>
                ${tags}
            </li>`;
    }

    // Full card for non-category views
    const categoryIcon = item.category ? item.category.icon : '📁';
    const toolName = item.toolName ? `<h4 class="item-title">${item.toolName}</h4>` : '';
    const workspaceGroup = item.workspaceGroup ? `<span class="item-workspace">${item.workspaceGroup}</span>` : '';
    const suggestion = item.suggestion ? `<p class="item-suggestion">💡 ${item.suggestion}</p>` : '';
    const workspaceBadge = item.workspaceGroup ? `
        <div class="workspace-badge" style="
            display:inline-block;
            margin: 6px 0 2px 0;
            padding: 4px 8px;
            border: 1px solid #4b5563;
            border-radius: 999px;
            font-size: 12px;
            color: #e5e7eb;
            background: #111827;
        ">🏷️ ${item.workspaceGroup}</div>
    ` : '';
    const bigButton = `
        <button class="item-big-btn" onclick="event.stopPropagation(); window.open('${item.url}', '_blank');" 
            style="
                margin: 8px 0 10px 0;
                width: 100%;
                padding: 12px 16px;
                background: #3b82f6;
                color: #fff;
                font-weight: 600;
                border: none;
                border-radius: 10px;
                cursor: pointer;
            ">
            Open
        </button>`;

    return `
        <li class="item" style="border-color: ${getCategoryColor(categoryName)};" onclick="window.open('${item.url}', '_blank')">
            <div class="item-url">${favicon}${urlKey}${fullUrlLink}</div>
            ${toolName}
            ${workspaceBadge}
            ${bigButton}
            <p class="item-summary">${item.summary || 'No summary available.'}</p>
            ${suggestion}
            <div class="item-footer">
                <span class="item-category">${categoryIcon} ${categoryName} ${workspaceGroup}</span>
                <div class="item-meta">
                    <span class="item-type">${item.type}</span>
                    <span>${dateString}</span>
                </div>
            </div>
            ${tags}
        </li>`;
}

function getCategoryColor(category) {
    const colors = {
        'API & Docs': '#3498db', 'Libraries & Frameworks': '#2ecc71',
        'Tutorials & Guides': '#f1c40f', 'Version Control': '#e74c3c',
        'DevTools': '#9b59b6', 'Community & Blogs': '#1abc9c',
        'Cloud & DevOps': '#e67e22', 'Project Management': '#34495e',
        'General Tech': '#7f8c8d', 'Other': '#bdc3c7'
    };
    return colors[category] || '#7f8c8d';
}

function setCategoryFilter(category) {
    activeFilters.category = category;
    document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`#category-filters .filter-btn[data-cat="${category}"]`)?.classList.add('active');

    if (category === 'All') {
        // Show stats view
        currentView = 'stats';
        showStatsView();
    } else {
        // Show category view
        currentView = 'category';
        showCategoryView(category);
    }
}

function setWorkspaceFilter(workspace) {
    activeFilters.workspace = workspace;
    document.querySelectorAll('#workspace-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`#workspace-filters .filter-btn[data-ws="${workspace}"]`)?.classList.add('active');
    // If a specific workspace is selected, show items as cards; otherwise show stats
    if (workspace && workspace !== 'All') {
        currentView = 'workspace';
        showWorkspaceItems();
    } else {
        currentView = 'stats';
        showStatsView();
        updateFrequentList();
        updateRecentList();
    }
}

function showStatsView() {
    // Show stats sections
    const statsContainer = document.querySelector('.stats-container');
    const itemList = document.getElementById('item-list');

    if (statsContainer) statsContainer.style.display = 'grid';
    if (itemList) {
        itemList.innerHTML = '<li class="loading">Loading stats...</li>';
        updateFrequentList();
        updateRecentList();
    }
}

// Show the main list as cards filtered by the selected workspace and search
function showWorkspaceItems() {
    // Hide stats sections
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) statsContainer.style.display = 'none';

    // Render items with current filters (workspace + search + category 'All')
    filterAndRender();
}

function showCategoryView(category) {
    // Hide stats sections
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) statsContainer.style.display = 'none';

    // Show category items in main list
    const filteredData = fullData
        .filter(passesHistoryFilters)
        .filter(item => item.category && item.category.name === category)
        .filter(item => activeFilters.workspace === 'All' || (item.workspaceGroup && item.workspaceGroup === activeFilters.workspace));
    displayCategoryItems(filteredData, category);
}

async function displayCategoryItems(items, category) {
    const container = document.getElementById('item-list');

    // Guard: only render entries that look like real items with valid URLs
    const safeItems = items.filter(i => i && typeof i === 'object' && typeof i.url === 'string' && /^https?:\/\//i.test(i.url));

    if (safeItems.length === 0) {
        container.innerHTML = `
            <li class="empty">
                <h3>No items in "${category}"</h3>
                <p>Try selecting a different category or sync with AI to get more data.</p>
            </li>`;
        return;
    }

    const categoryHeader = `
        <li class="category-header">
            <p>${safeItems.length} item${safeItems.length !== 1 ? 's' : ''} found</p>
        </li>`;

    const itemsHTML = await Promise.all(safeItems.map(createItemHTML));
    container.innerHTML = categoryHeader + itemsHTML.join('');
}

searchInput.addEventListener('input', (e) => {
    activeFilters.search = e.target.value;
    // Render inline suggestions from history
    renderSuggestions(e.target.value);

    if (currentView === 'stats') {
        // In stats view, just filter the stats sections
        updateFrequentList();
        updateRecentList();
    } else {
        // In category view, filter the category items
        filterAndRender();
    }
});

// Show suggestions on focus
searchInput.addEventListener('focus', () => {
    renderSuggestions(searchInput.value);
});

// Hide suggestions when clicking elsewhere
document.addEventListener('click', (e) => {
    if (e.target !== searchInput && !searchSuggestions.contains(e.target)) {
        hideSuggestions();
    }
});

// Hide suggestions with Escape
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSuggestions();
});

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize inline search suggestions now that DOM is ready
    attachSuggestions();
    const stored = await chrome.storage.local.get(['userId']);
    userId = stored.userId || `user_${Math.random().toString(36).substr(2, 9)}`;
    if (!stored.userId) await chrome.storage.local.set({ userId });


    await loadData();

    chrome.runtime.onMessage.addListener((request) => {
        console.log('Received message:', request);
        if (request.action === 'updateData') {
            console.log('Reloading data after AI enrichment...');
            loadData();
            showToast('AI sync completed! Data updated with summaries and categories.');
        } else if (request.action === 'aiProgress') {
            console.log(`AI Progress: ${request.processed}/${request.total} (API ${request.apiHits || 0}) - ${request.currentItem}`);
            updateProgress(request.processed, request.total, request.currentItem, request.apiHits || 0);
        } else if (request.action === 'aiComplete') {
            console.log('AI enrichment completed:', request.data);
            loadData();
            hideProgressContainer();
            showToast('AI enrichment completed successfully!');
        } else if (request.action === 'aiError') {
            console.log('AI enrichment error:', request.error);
            hideProgressContainer();
            showToast(`AI enrichment failed: ${request.error}`);
        }
    });
});

// IndexedDB read helpers to reuse AI enrichment without re-fetching
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

function cleanUrl(url) {
    try {
        const u = new URL(url);
        const parsed = psl.parse(u.hostname);
        return `${u.protocol}//${parsed.domain}`;
    } catch { return null; }
}

// Fallback cleaner to match background.js storage key (last two hostname labels)
function naiveCleanUrl(url) {
    try {
        const u = new URL(url);
        const parts = u.hostname.split('.');
        const domain = parts.length >= 2 ? parts.slice(-2).join('.') : u.hostname;
        return `${u.protocol}//${domain}`;
    } catch { return null; }
}

function getFaviconUrl(url, size = 64) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
    } catch {
        return null;
    }
}

function getDomainInitial(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.charAt(0).toUpperCase();
    } catch {
        return '?';
    }
}

function createFaviconElement(url, size = 'normal') {
    const faviconSize = size === 'small' ? 32 : 64;
    const faviconUrl = getFaviconUrl(url, faviconSize);
    const domainInitial = getDomainInitial(url);
    const className = size === 'small' ? 'stats-favicon' : 'favicon';

    if (faviconUrl) {
        return `<div class="${className}">
            <img src="${faviconUrl}" alt="" onerror="this.parentElement.classList.add('fallback'); this.parentElement.textContent='${domainInitial}'; this.remove();">
        </div>`;
    } else {
        return `<div class="${className} fallback">${domainInitial}</div>`;
    }
}

async function hydrateFromIndexedDb(items) {
    const results = [];
    for (const item of items) {
        const cleaned = cleanUrl(item.url);
        const fallbackKey = naiveCleanUrl(item.url);
        if (!cleaned && !fallbackKey) { results.push(item); continue; }
        try {
            let cached = cleaned ? await getEnrichmentFromDb(cleaned) : null;
            if (!cached && fallbackKey && fallbackKey !== cleaned) {
                cached = await getEnrichmentFromDb(fallbackKey);
            }
            if (cached) {
                results.push({
                    ...item,
                    summary: cached.summary,
                    category: cached.category,
                    tags: cached.tags,
                    toolName: cached.toolName,
                    workspaceGroup: cached.workspaceGroup,
                    secondaryCategories: cached.secondaryCategories,
                    suggestion: cached.suggestion
                });
            } else {
                results.push(item);
            }
        } catch { results.push(item); }
    }
    return results;
}

function getDomainFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const parsed = psl.parse(urlObj.hostname);
        return parsed.domain;
    } catch {
        return 'Unknown';
    }
}


