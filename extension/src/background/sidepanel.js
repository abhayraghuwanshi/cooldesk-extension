// Side Panel and UI entry management for the extension
// This module registers listeners to open the side panel or fallback to a tab.

// Open popup UI as a full tab by default when clicking the icon
const APP_URL = chrome.runtime.getURL('index.html');

async function openOrFocusApp() {
    try {
        // Prefer opening the Side Panel (tray) on the current active tab
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab && chrome?.sidePanel?.open) {
                await chrome.sidePanel.setOptions({ tabId: activeTab.id, path: 'index.html', enabled: true });
                await chrome.sidePanel.open({ tabId: activeTab.id });
                return;
            }
        } catch { /* fall through to tab/window fallback */ }

        const tabs = await chrome.tabs.query({ url: APP_URL });
        if (tabs && tabs.length > 0) {
            const t = tabs[0];
            await chrome.tabs.update(t.id, { active: true });
            await chrome.windows.update(t.windowId, { focused: true });
        } else {
            await chrome.tabs.create({ url: APP_URL });
        }
    } catch (e) {
        console.warn('[Background] Failed to open/focus app tab, falling back to options page', e);
        try { chrome.runtime.openOptionsPage(); } catch { }
    }
}

chrome.action.onClicked.addListener(async (tab) => {
    // Open sidebar instead of popup/tab
    try {
        await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
        console.log('Sidebar not supported, falling back to tab:', error);
        openOrFocusApp();
    }
});

// Enable sidebar for all tabs
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (!tab.url) return;
    try {
        await chrome.sidePanel.setOptions({
            tabId,
            path: 'index.html',
            enabled: true,
        });
    } catch (error) {
        // Sidebar not supported in this context
    }
});
