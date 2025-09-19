// Tab cleanup functionality for Chrome extension
// Automatically closes inactive tabs and manages tab limits

let isCleanupEnabled = false;
let tabActivityTracker = new Map(); // tabId -> lastActiveTimestamp
let cleanupAlarmName = 'tabCleanupAlarm';

// Configuration - can be made configurable later
const CONFIG = {
  MAX_TABS: 20,
  INACTIVE_TIMEOUT_MINUTES: 60,
  CHECK_INTERVAL_MINUTES: 1,
  EXCLUDED_DOMAINS: [
    'gmail.com',
    'github.com',
    'localhost',
    'claude.ai',
    'chat.openai.com'
  ],
  EXCLUDED_PROTOCOLS: [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'moz-extension://'
  ]
};

// Initialize tab cleanup module
export function initializeTabCleanup() {
  console.log('[TabCleanup] Initializing tab cleanup module');

  // Load settings from storage
  loadSettings();

  // Set up event listeners
  setupEventListeners();

  // Set up periodic cleanup alarm
  setupCleanupAlarm();
}

// Load settings from chrome.storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['autoCleanupEnabled']);
    isCleanupEnabled = result.autoCleanupEnabled || false;
    console.log('[TabCleanup] Loaded settings:', { isCleanupEnabled });
  } catch (e) {
    console.warn('[TabCleanup] Failed to load settings:', e);
  }
}

// Set up event listeners for tab activity tracking
function setupEventListeners() {
  // Track when user switches to a tab
  chrome.tabs.onActivated.addListener((activeInfo) => {
    trackTabActivity(activeInfo.tabId);
  });

  // Track when tab is updated (navigation, reload, etc.)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      trackTabActivity(tabId);
    }
  });

  // Clean up tracking when tabs are closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabActivityTracker.delete(tabId);
  });

  // Track initial tabs on startup
  chrome.tabs.query({}, (tabs) => {
    const now = Date.now();
    tabs.forEach(tab => {
      if (tab.active) {
        trackTabActivity(tab.id);
      } else {
        // Set a default timestamp for existing tabs
        tabActivityTracker.set(tab.id, now - (5 * 60 * 1000)); // 5 minutes ago
      }
    });
  });
}

// Track activity for a specific tab
function trackTabActivity(tabId) {
  if (!tabId) return;

  const timestamp = Date.now();
  tabActivityTracker.set(tabId, timestamp);
  console.log('[TabCleanup] Tracked activity for tab:', tabId);
}

// Set up periodic cleanup alarm
function setupCleanupAlarm() {
  // Clear existing alarm with safety check
  if (chrome && chrome.alarms && typeof chrome.alarms.clear === 'function') {
    chrome.alarms.clear(cleanupAlarmName);
  } else {
    console.warn('[TabCleanup] chrome.alarms.clear is not available');
  }

  // Create new alarm that triggers every minute
  if (chrome && chrome.alarms && typeof chrome.alarms.create === 'function') {
    chrome.alarms.create(cleanupAlarmName, {
      delayInMinutes: CONFIG.CHECK_INTERVAL_MINUTES,
      periodInMinutes: CONFIG.CHECK_INTERVAL_MINUTES
    });
  } else {
    console.warn('[TabCleanup] chrome.alarms.create is not available');
  }

  // Listen for alarm events
  if (chrome && chrome.alarms && typeof chrome.alarms.onAlarm === 'object') {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === cleanupAlarmName && isCleanupEnabled) {
        performCleanup();
      }
    });
  } else {
    console.warn('[TabCleanup] chrome.alarms.onAlarm is not available');
  }
}

// Main cleanup function
async function performCleanup() {
  if (!isCleanupEnabled) return;

  try {
    console.log('[TabCleanup] Starting cleanup check...');

    // Get all tabs
    const tabs = await chrome.tabs.query({});
    if (!tabs || tabs.length === 0) return;

    // Filter tabs that should never be closed
    const protectedTabs = tabs.filter(tab => isTabProtected(tab));
    const cleanableTabs = tabs.filter(tab => !isTabProtected(tab));

    console.log('[TabCleanup] Total tabs:', tabs.length, 'Protected:', protectedTabs.length, 'Cleanable:', cleanableTabs.length);

    // Step 1: Close inactive tabs
    await closeInactiveTabs(cleanableTabs);

    // Step 2: If still over limit, close oldest tabs
    const remainingTabs = await chrome.tabs.query({});
    if (remainingTabs.length > CONFIG.MAX_TABS) {
      await closeOldestTabs(remainingTabs);
    }

    console.log('[TabCleanup] Cleanup complete');
  } catch (e) {
    console.error('[TabCleanup] Error during cleanup:', e);
  }
}

// Check if a tab should be protected from auto-closure
function isTabProtected(tab) {
  if (!tab || !tab.url) return true;

  // Protect pinned tabs
  if (tab.pinned) return true;

  // Protect active tabs
  if (tab.active) return true;

  // Protect tabs with audio/video
  if (tab.audible) return true;

  // Protect system/extension pages
  const url = tab.url.toLowerCase();
  if (CONFIG.EXCLUDED_PROTOCOLS.some(protocol => url.startsWith(protocol))) {
    return true;
  }

  // Protect excluded domains
  try {
    const hostname = new URL(tab.url).hostname.toLowerCase();
    if (CONFIG.EXCLUDED_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    )) {
      return true;
    }
  } catch (e) {
    // If URL parsing fails, protect the tab
    return true;
  }

  return false;
}

// Close tabs that have been inactive for too long
async function closeInactiveTabs(tabs) {
  const now = Date.now();
  const inactiveThreshold = CONFIG.INACTIVE_TIMEOUT_MINUTES * 60 * 1000;

  const tabsToClose = [];

  for (const tab of tabs) {
    const lastActive = tabActivityTracker.get(tab.id);

    if (!lastActive) {
      // If we don't have activity data, assume it's been inactive for a while
      const timeSinceCreated = now - (tab.id * 1000); // Rough estimate
      if (timeSinceCreated > inactiveThreshold) {
        tabsToClose.push(tab);
      }
    } else {
      const inactiveTime = now - lastActive;
      if (inactiveTime > inactiveThreshold) {
        tabsToClose.push(tab);
      }
    }
  }

  if (tabsToClose.length > 0) {
    console.log('[TabCleanup] Closing', tabsToClose.length, 'inactive tabs');

    for (const tab of tabsToClose) {
      try {
        await chrome.tabs.remove(tab.id);
        tabActivityTracker.delete(tab.id);
        console.log('[TabCleanup] Closed inactive tab:', tab.url);
      } catch (e) {
        console.warn('[TabCleanup] Failed to close tab:', tab.id, e);
      }
    }
  }
}

// Close oldest tabs when over the limit
async function closeOldestTabs(tabs) {
  const cleanableTabs = tabs.filter(tab => !isTabProtected(tab));
  const excessCount = tabs.length - CONFIG.MAX_TABS;

  if (excessCount <= 0 || cleanableTabs.length === 0) return;

  // Sort by last activity (oldest first)
  const sortedTabs = cleanableTabs.sort((a, b) => {
    const aActivity = tabActivityTracker.get(a.id) || 0;
    const bActivity = tabActivityTracker.get(b.id) || 0;
    return aActivity - bActivity;
  });

  const tabsToClose = sortedTabs.slice(0, Math.min(excessCount, sortedTabs.length));

  if (tabsToClose.length > 0) {
    console.log('[TabCleanup] Closing', tabsToClose.length, 'oldest tabs (over limit)');

    for (const tab of tabsToClose) {
      try {
        await chrome.tabs.remove(tab.id);
        tabActivityTracker.delete(tab.id);
        console.log('[TabCleanup] Closed oldest tab:', tab.url);
      } catch (e) {
        console.warn('[TabCleanup] Failed to close tab:', tab.id, e);
      }
    }
  }
}

// Handle setAutoCleanup message from UI
export async function handleSetAutoCleanup(msg, sender, sendResponse) {
  try {
    const { enabled } = msg;

    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid enabled value');
    }

    // Update state
    isCleanupEnabled = enabled;

    // Save to storage
    await chrome.storage.local.set({ autoCleanupEnabled: enabled });

    // Update alarm
    if (enabled) {
      setupCleanupAlarm();
    } else {
      if (chrome && chrome.alarms && typeof chrome.alarms.clear === 'function') {
        chrome.alarms.clear(cleanupAlarmName);
      } else {
        console.warn('[TabCleanup] chrome.alarms.clear is not available');
      }
    }

    console.log('[TabCleanup] Auto-cleanup', enabled ? 'enabled' : 'disabled');
    sendResponse({ ok: true, enabled });
  } catch (e) {
    console.error('[TabCleanup] Error setting auto-cleanup:', e);
    sendResponse({ ok: false, error: e.message });
  }
}

// Export for testing/debugging
export function getCleanupStats() {
  return {
    enabled: isCleanupEnabled,
    trackedTabs: tabActivityTracker.size,
    config: CONFIG
  };
}