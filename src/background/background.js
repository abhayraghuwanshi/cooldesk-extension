console.log('[Background] ====== SERVICE WORKER STARTING ======');

// Initialize context menus on install
chrome.runtime.onInstalled.addListener(() => {
  // Remove existing menus first to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Highlight selection (only when text is selected)
    chrome.contextMenus.create({
      id: 'cooldesk-highlight',
      title: '🖍️ Highlight Selection',
      contexts: ['selection']
    });

    // Scrape links from page
    chrome.contextMenus.create({
      id: 'cooldesk-scrape-links',
      title: '🔗 Scrape Links from Page',
      contexts: ['page', 'link']
    });

    // Create sticky note (available everywhere)
    chrome.contextMenus.create({
      id: 'cooldesk-sticky-note',
      title: '📝 Create Sticky Note',
      contexts: ['page', 'selection']
    });

    // Add to workspace
    chrome.contextMenus.create({
      id: 'cooldesk-add-to-workspace',
      title: '📂 Add Page to Workspace',
      contexts: ['page']
    });

    console.log('[Background] Context menus created');
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('[Background] Context menu clicked:', info.menuItemId);

  if (!tab?.id) {
    console.warn('[Background] No tab available for context menu action');
    return;
  }

  try {
    switch (info.menuItemId) {
      case 'cooldesk-highlight':
        // Send message to content script to highlight selected text
        await chrome.tabs.sendMessage(tab.id, {
          type: 'COOLDESK_HIGHLIGHT',
          selectionText: info.selectionText
        });
        break;

      case 'cooldesk-scrape-links':
        // Send message to content script to scrape links
        await chrome.tabs.sendMessage(tab.id, {
          type: 'COOLDESK_SCRAPE_LINKS',
          pageUrl: info.pageUrl,
          linkUrl: info.linkUrl
        });
        break;

      case 'cooldesk-sticky-note':
        // Send message to content script to create sticky note
        await chrome.tabs.sendMessage(tab.id, {
          type: 'COOLDESK_STICKY_NOTE',
          selectionText: info.selectionText || '',
          pageUrl: info.pageUrl
        });
        break;

      case 'cooldesk-add-to-workspace':
        // Send message to content script to show workspace picker
        await chrome.tabs.sendMessage(tab.id, {
          type: 'COOLDESK_ADD_TO_WORKSPACE',
          pageUrl: info.pageUrl,
          pageTitle: tab.title
        });
        break;
    }
  } catch (err) {
    console.warn('[Background] Context menu action failed:', err);
    // Try to inject content script and retry
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content-scripts/interactionContent.js']
      });
      // Retry after injection
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: info.menuItemId === 'cooldesk-highlight' ? 'COOLDESK_HIGHLIGHT' :
              info.menuItemId === 'cooldesk-scrape-links' ? 'COOLDESK_SCRAPE_LINKS' :
                info.menuItemId === 'cooldesk-sticky-note' ? 'COOLDESK_STICKY_NOTE' :
                  'COOLDESK_ADD_TO_WORKSPACE',
            selectionText: info.selectionText,
            pageUrl: info.pageUrl,
            linkUrl: info.linkUrl,
            pageTitle: tab.title
          });
        } catch (e) {
          console.error('[Background] Context menu retry failed:', e);
        }
      }, 200);
    } catch (injectErr) {
      console.error('[Background] Failed to inject content script:', injectErr);
    }
  }
});

// Global Command Handlers (Keyboard Shortcuts)
if (chrome?.commands?.onCommand) {
chrome.commands.onCommand.addListener(async (command) => {
  console.log('[Background] Command received:', command);

  if (command === 'open_spotlight') {
    // Send message to active tab to trigger Spotlight UI
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        console.log('[Background] Toggling Spotlight on tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SPOTLIGHT' }).catch(async (err) => {
          console.warn('[Background] Message failed (likely content script not loaded), attempting to re-inject:', err);
          try {
            // Attempt to inject the content script manually if it's not present
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['src/content-scripts/interactionContent.js']
            });
            // Try sending the message again after a short delay
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SPOTLIGHT' }).catch(e => {
                console.error('[Background] Failed to toggle spotlight even after injection:', e);
              });
            }, 200);
          } catch (injectErr) {
            console.error('[Background] Failed to re-inject content script:', injectErr);
          }
        });
      }
    } catch (e) {
      console.warn('[Background] Failed to send Spotlight message:', e);
    }
  }

});
} // End of chrome.commands check

// MV3 background service worker (type: module)

// Polyfill for libraries that check for document (but don't actually use it)
// This prevents "document is not defined" errors in service worker context
if (typeof document === 'undefined') {
  // Create a mock DOM element with common methods
  const createMockElement = () => ({
    appendChild: () => { },
    removeChild: () => { },
    insertBefore: () => { },
    replaceChild: () => { },
    cloneNode: () => createMockElement(),
    getAttribute: () => null,
    setAttribute: () => { },
    removeAttribute: () => { },
    hasAttribute: () => false,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => { },
    removeEventListener: () => { },
    dispatchEvent: () => true,
    innerHTML: '',
    textContent: '',
    style: {},
    classList: {
      add: () => { },
      remove: () => { },
      contains: () => false,
      toggle: () => { }
    },
    dataset: {},
    children: [],
    childNodes: [],
    parentNode: null,
    firstChild: null,
    lastChild: null,
    nextSibling: null,
    previousSibling: null
  });

  globalThis.document = {
    createElement: () => createMockElement(),
    createElementNS: () => createMockElement(),
    createTextNode: () => createMockElement(),
    createDocumentFragment: () => createMockElement(),
    getElementById: () => null,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    getElementsByName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => { },
    removeEventListener: () => { },
    dispatchEvent: () => true,
    body: createMockElement(),
    head: createMockElement(),
    documentElement: createMockElement(),
    readyState: 'complete',
    location: {
      href: '',
      protocol: 'chrome-extension:',
      host: '',
      hostname: '',
      port: '',
      pathname: '',
      search: '',
      hash: ''
    }
  };
}

// Also polyfill window if needed
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// Global error handlers to prevent connection errors from showing in extension UI
self.addEventListener('unhandledrejection', (event) => {
  const error = event.reason?.message || event.reason || '';
  if (error.includes?.('Could not establish connection') ||
    error.includes?.('Receiving end does not exist') ||
    error.includes?.('message port closed')) {
    console.debug('[Background] Suppressed connection error:', error);
    event.preventDefault(); // Prevent the error from appearing in the console
  }
});

self.addEventListener('error', (event) => {
  const error = event.message || event.error?.message || '';
  if (error.includes?.('Could not establish connection') ||
    error.includes?.('Receiving end does not exist') ||
    error.includes?.('message port closed')) {
    console.debug('[Background] Suppressed connection error:', error);
    event.preventDefault();
  }
});

// Offscreen auth has been deprecated in favor of chrome.identity-based login.

// Database imports (static imports required for service worker compatibility)
import { cleanupOldTimeSeriesData, getTimeSeriesStorageStats, getUIState, listWorkspaces, saveUIState } from '../db/index.js';
import { DB_CONFIG, getUnifiedDB } from '../db/unified-db.js';
import { storageGetWithTTL } from '../services/extensionApi.js';
import { populateAndStore } from './data.js';

// Modular background pieces - these initialize their own message handlers
// NOTE: realTimeCategorizor is lazy-loaded to avoid window reference errors in service worker
import {
  handleActivityContentScriptMessage,
  handleActivityMessage,
  handleCleanupTimeSeriesData,
  handleGetActivityData,
  handleGetTimeSeriesStats,
  initializeActivity
} from './activity.js';
import { initializeData } from './data.js';
// import { initializeProjectContext } from './projectContext.js'; // DISABLED - depends on ML modules
import { runWorkspaceCleanup } from '../utils/urlQualification.js';
import { CommandParser } from '../services/commandParser.js';
// import '../utils/realTimeCategorizor.js'; // REMOVED
import { scheduleDailySummary } from '../services/memory/dailySummaryGenerator.js';
import { NanoAIService } from '../services/nanoAIService.js';
import { syncOrchestrator } from '../services/syncOrchestrator.js';
import { forceIndexRebuild, initializeSearchIndexer } from './searchIndexer.js';
import { handleGetTabActivity } from './tabCleanup.js';
import { handleUrlNotesMessages } from './urlNotesHandler.js';
import { initializeWorkspaces } from './workspaces.js';

// Task Manager for Task-First Tab Modeling
import {
  initialize as initializeTaskManager,
  handleTabCreated as taskHandleTabCreated,
  handleTabActivated as taskHandleTabActivated,
  handleTabRemoved as taskHandleTabRemoved,
  handleTabUpdated as taskHandleTabUpdated,
  getAllTasks,
  getTaskById,
  getTaskForTab,
  renameTask,
  setTaskAiNamed,
  moveTabToTask,
  mergeTasksInto,
  getActiveTaskId
} from './taskManager.js';

// Initialize Search Indexer (Background Service)
initializeSearchIndexer(); // Re-enabled for spotlight search

// Initialize CommandExecutor for shared use
// MOVED TO main() function to avoid top-level execution errors
// const commandExecutor = new CommandExecutor((feedback) => {
//   console.log('[Background:Command] Feedback:', feedback);
//   chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
//     if (tab) chrome.tabs.sendMessage(tab.id, { type: 'SHOW_NOTIFICATION', message: feedback.message, color: feedback.type === 'success' ? '#10b981' : '#3B82F6' });
//   });
// });




// Auto-save selected text to daily notes
async function saveToDailyNotes(selectionData) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const storageKey = `dailyNotes_${today}`;

    // Get existing daily notes for today
    const result = await chrome.storage.local.get([storageKey]);
    const dailyData = result[storageKey] || {
      date: today,
      content: '',
      selections: [],
      metadata: {
        created: Date.now(),
        lastUpdated: Date.now(),
        selectionCount: 0
      }
    };

    // Skip if text is too short (less than 15 chars) or too long (more than 5000 chars)
    if (!selectionData.text || selectionData.text.length < 15 || selectionData.text.length > 5000) {
      return;
    }

    // Skip duplicates (check last 5 entries)
    const recentSelections = dailyData.selections.slice(-5);
    const isDuplicate = recentSelections.some(selection =>
      selection.text === selectionData.text ||
      Math.abs(selection.timestamp - selectionData.timestamp) < 2000 // Within 2 seconds
    );

    if (isDuplicate) {
      console.log('[Background] Skipping duplicate selection');
      return;
    }

    // Create selection entry
    const selectionEntry = {
      id: `sel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: selectionData.text,
      source: {
        url: selectionData.url,
        title: await getPageTitle(selectionData.url),
        domain: new URL(selectionData.url).hostname
      },
      context: {
        beforeText: selectionData.beforeText || '',
        afterText: selectionData.afterText || ''
      },
      metadata: {
        length: selectionData.length,
        wordCount: selectionData.wordCount,
        position: selectionData.position
      },
      timestamp: selectionData.timestamp,
      time: new Date(selectionData.timestamp).toLocaleTimeString()
    };

    // Add selection to daily data
    dailyData.selections.push(selectionEntry);

    // Keep only last 50 selections per day to avoid storage bloat
    if (dailyData.selections.length > 50) {
      dailyData.selections = dailyData.selections.slice(-50);
    }

    // Auto-append to daily notes content with timestamp and source (with clickable link)
    const timeStr = new Date(selectionData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sourceStr = new URL(selectionData.url).hostname;
    const noteEntry = `\n[${timeStr}] From [${sourceStr}](${selectionData.url}):\n"${selectionData.text}"\n`;

    dailyData.content += noteEntry;
    dailyData.metadata.lastUpdated = Date.now();
    dailyData.metadata.selectionCount = dailyData.selections.length;

    // Save to storage
    await chrome.storage.local.set({
      [storageKey]: dailyData,
      dailyNotesLastUpdate: Date.now()
    });

    console.log(`[Background] Added to daily notes: ${selectionData.text.substring(0, 30)}...`);

    // Notify listeners about daily notes update
    try {
      const bc = new BroadcastChannel('ws_db_changes');
      bc.postMessage({ type: 'dailyNotesChanged', date: today });
      bc.close();
    } catch (e) {
      // Ignore errors - just logging
      console.debug('[Background] BroadcastChannel not available for daily notes sync');
    }

    // Update daily summary
    await updateDailyNotesSummary(today, dailyData.metadata.selectionCount);

  } catch (e) {
    console.error('[Background] Error saving to daily notes:', e);
  }
}

// Get page title from URL (with fallback)
async function getPageTitle(url) {
  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      return tabs[0].title || new URL(url).hostname;
    }
    return new URL(url).hostname;
  } catch (e) {
    return 'Unknown Page';
  }
}

// Update daily notes summary
async function updateDailyNotesSummary(date, selectionCount) {
  try {
    const summaryKey = 'dailyNotesSummary';
    const result = await chrome.storage.local.get([summaryKey]);
    const summary = result[summaryKey] || {};

    summary[date] = {
      date,
      selectionCount,
      lastUpdated: Date.now()
    };

    await chrome.storage.local.set({ [summaryKey]: summary });
  } catch (e) {
    console.warn('[Background] Failed to update daily notes summary:', e);
  }
}



async function main() {
  console.log('[Background] Main function started');

  // Initialize AI module
  // initializeAI();

  // Temporarily bypass database initialization to avoid 'document is not defined' error
  console.log('[Background] ⚠️ Database initialization temporarily bypassed to avoid DOM error');
  console.log('[Background] Using simplified storage for now');

  // Initialize Data module
  initializeData();

  // Initialize Activity module with safety check
  try {
    initializeActivity();
  } catch (e) {
    console.error('[Background] Error initializing Activity module:', e);
  }

  // Initialize Workspaces module with safety check
  try {
    initializeWorkspaces();
  } catch (e) {
    console.error('[Background] Error initializing Workspaces module:', e);
  }

  // Initialize Sync Orchestrator
  try {
    console.log('[Background] Attempting to initialize Sync Orchestrator...');
    syncOrchestrator.init();
  } catch (e) {
    console.error('[Background] Error initializing Sync Orchestrator:', e);
  }

  // Real-time categorization DISABLED - using scraping mechanism instead
  // The scraping mechanism is more reliable and doesn't interfere with other features
  console.log('[Background] Real-time categorization disabled (using scraping mechanism)');

  // Initialize Nano AI Service (lazy - just checks availability)
  try {
    NanoAIService.init().then(status => {
      console.log('[Background] Nano AI status:', status);
    });
  } catch (e) {
    console.warn('[Background] Nano AI init skipped:', e.message);
  }

  // Initialize Daily Summary Scheduler
  try {
    scheduleDailySummary();
    console.log('[Background] Daily summary scheduler initialized');
  } catch (e) {
    console.warn('[Background] Daily summary scheduler init failed:', e.message);
  }

  // Initialize Task Manager for Task-First Tab Modeling
  try {
    await initializeTaskManager();
    console.log('[Background] Task Manager initialized');

    // Set up task manager tab event listeners
    chrome.tabs.onCreated.addListener(async (tab) => {
      try {
        await taskHandleTabCreated(tab);
      } catch (e) {
        console.error('[Background] Task tab created error:', e);
      }
    });

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        await taskHandleTabActivated(activeInfo.tabId);
      } catch (e) {
        console.error('[Background] Task tab activated error:', e);
      }
    });

    chrome.tabs.onRemoved.addListener(async (tabId) => {
      try {
        await taskHandleTabRemoved(tabId);
      } catch (e) {
        console.error('[Background] Task tab removed error:', e);
      }
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      try {
        await taskHandleTabUpdated(tabId, changeInfo, tab);
      } catch (e) {
        console.error('[Background] Task tab updated error:', e);
      }
    });
  } catch (e) {
    console.error('[Background] Task Manager init failed:', e.message);
  }

  // Bridge DB change broadcasts to UI: when RTC updates workspaces, refresh dashboard
  try {
    const bc = new BroadcastChannel('ws_db_changes');
    bc.onmessage = (ev) => {
      try {
        if (ev?.data?.type === 'workspacesChanged') {
          chrome?.runtime?.sendMessage?.({ action: 'updateData', realTime: true });
        }
      } catch (e) {
        console.debug('[Background] Failed to forward updateData message:', e);
      }
    };
    console.log('[Background] Broadcast bridge for ws_db_changes is active');
  } catch (e) {
    console.debug('[Background] BroadcastChannel not available for workspace change bridge');
  }

  // Also refresh UI on chat tab updates to catch URL appends (when RTC may not broadcast)
  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete' || !tab?.url) return;
      try {
        const u = new URL(tab.url);
        const host = u.hostname.replace('www.', '');
        const isChatHost = ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'].includes(host);
        const isConversationPath = u.pathname.includes('/c/') || u.pathname.includes('/chat/') || host === 'perplexity.ai';
        if (isChatHost && isConversationPath) {
          chrome?.runtime?.sendMessage?.({ action: 'updateData', realTime: true });
        }
      } catch { }
    });
  } catch { }

  chrome.runtime.onInstalled.addListener(async () => {
    // Log pinning events to debut auto-pinning issue
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.pinned === true) {
        console.log('[TabDebug] 📌 Tab PINNED externally/automatically:', {
          tabId,
          url: tab.url,
          title: tab.title,
          timestamp: new Date().toISOString(),
          changeInfo
        });
      } else if (changeInfo.pinned === false) {
        console.log('[TabDebug] 📍 Tab UNPINNED:', { tabId, url: tab.url });
      }
    });

    console.log('[Background] Extension installed - populating data')
    try {
      await populateAndStore()

      // Initialize side panel settings on install (same as working sample.js)
      if (chrome?.sidePanel?.setOptions) {
        try {
          await chrome.sidePanel.setOptions({
            path: 'index.html',
            enabled: true
          });
          console.log('[Background] Side panel enabled globally on install');
        } catch (e) {
          console.warn('[Background] Failed to enable side panel on install:', e);
        }
      }

      if (chrome?.sidePanel?.setPanelBehavior) {
        try {
          await chrome.sidePanel.setPanelBehavior({
            openPanelOnActionClick: true
          });
          console.log('[Background] Panel behavior set to open on action click');
        } catch (e) {
          console.warn('[Background] Failed to set panel behavior:', e);
        }
      }
    } catch (e) {
      console.error('[Background] Error during onInstalled populate:', e)
    }
  })

  chrome.runtime.onStartup?.addListener(async () => {
    console.log('[Background] Startup - ensuring data present')
    try {
      // Clean up corrupted UI state (flatten nested data structures)
      try {
        // Use statically imported functions (imported at top of file)
        const uiState = await getUIState();
        // getUIState now automatically flattens, so just save it back to persist the fix
        if (uiState) {
          await saveUIState(uiState);
          console.log('[Background] UI state cleaned up on startup');
        }
      } catch (e) {
        console.warn('[Background] Failed to cleanup UI state:', e);
      }

      // Check cache with TTL (30 minutes)
      const { data: dashboardData, expired } = await storageGetWithTTL('dashboardData', 30 * 60 * 1000);
      if (expired || !dashboardData || (!dashboardData.bookmarks?.length && !dashboardData.history?.length)) {
        console.log('[Background] Dashboard cache expired or empty, repopulating...');
        await populateAndStore();
      }

      // Periodic cleanup of old time series data (run on startup)
      try {
        const stats = await getTimeSeriesStorageStats();
        console.log('[Background] Time series storage:', stats);

        // Auto-cleanup: aggregate data older than 2 days into DAILY_ANALYTICS
        // This keeps ACTIVITY_SERIES lean (for ResumeWork widget) while preserving history
        if (stats.estimatedSizeMB > 10 || stats.spanDays > 2) {
          const deleted = await cleanupOldTimeSeriesData(2); // Aggregate & keep only 2 days raw
          console.log(`[Background] Startup cleanup: aggregated & removed ${deleted} old events`);
        }
      } catch (e) {
        console.warn('[Background] Time series cleanup failed:', e);
      }

      // One-time cleanup of existing workspaces to remove unqualified URLs
      // (e.g., one-time Google Maps visits that shouldn't be in Utilities)
      try {
        const cleanupResult = await runWorkspaceCleanup();
        if (!cleanupResult.skipped) {
          console.log(`[Background] Workspace cleanup: removed ${cleanupResult.totalRemoved} URLs from ${cleanupResult.workspacesModified} workspaces`);
        }
      } catch (e) {
        console.warn('[Background] Workspace cleanup failed:', e);
      }

    } catch (e) {
      console.error('[Background] Error during onStartup:', e);
    }
  })

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[Background Debug] ON_MESSAGE_START:', msg?.type);
    console.log('[Background Debug] Received message:', {
      type: msg?.type,
      action: msg?.action,
      query: msg?.query,
      sender: sender?.tab?.id
    });

    // Temporarily disable keepalive connection mechanism to prevent connection errors
    // console.log('[Background Debug] Keepalive connection mechanism disabled to prevent connection errors');

    const cleanup = () => {
      try {
      } catch { }
    };


    // Handle auto-group tabs command
    if (msg?.type === 'AUTO_GROUP_TABS') {
      console.log('[Background] Auto-group tabs command received');

      (async () => {
        try {
          const result = await autoGroupTabsByDomain();
          sendResponse(result);
        } catch (error) {
          console.error('[Background] Auto-group error:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();

      return true; // Keep channel open for async response
    }

    // Handle toggle auto-group
    if (msg?.type === 'TOGGLE_AUTO_GROUP') {
      console.log('[Background] Toggle auto-group command received:', msg.enabled);

      (async () => {
        try {
          autoGroupEnabled = msg.enabled;
          await chrome.storage.local.set({ autoGroupEnabled: msg.enabled });

          if (msg.enabled) {
            // Group all existing tabs
            const result = await autoGroupTabsByDomain();
            sendResponse({ success: true, enabled: true, ...result });
          } else {
            // Ungroup all tabs
            const result = await ungroupAllTabs();
            sendResponse({ success: true, enabled: false, ...result });
          }
        } catch (error) {
          console.error('[Background] Toggle auto-group error:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();

      return true; // Keep channel open for async response
    }

    // Handle get tab activity command
    if (msg?.type === 'GET_TAB_ACTIVITY') {
      try {
        handleGetTabActivity?.(msg, sender, sendResponse);
      } catch (e) {
        console.error('[Background] Failed to handle GET_TAB_ACTIVITY:', e);
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    // Handle activity heartbeat from modern ActivityTracker
    if (msg?.type === 'ACTIVITY_HEARTBEAT') {
      console.log('[Background] Received ACTIVITY_HEARTBEAT:', {
        url: msg.url,
        timeSpent: msg.metrics?.timeSpent,
        visibleTime: msg.metrics?.visibleTime,
        scrollDepth: msg.metrics?.scrollDepth,
        engagementScore: msg.metrics?.engagementScore
      });

      (async () => {
        try {
          await handleActivityMessage?.(msg, sender);
          sendResponse({ success: true });
        } catch (e) {
          console.error('[Background] Failed to handle ACTIVITY_HEARTBEAT:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();

      return true;
    }

    // Handle Nano AI requests
    if (msg?.type === 'NANO_AI_STATUS') {
      (async () => {
        try {
          const status = NanoAIService.getStatus();
          sendResponse({ success: true, ...status });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'NANO_AI_SUMMARIZE') {
      (async () => {
        try {
          if (!NanoAIService.isAvailable()) {
            sendResponse({ success: false, error: 'Nano AI not available' });
            return;
          }
          const summary = await NanoAIService.summarize(msg.text, msg.maxLength || 100);
          sendResponse({ success: true, summary });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'NANO_AI_CLASSIFY') {
      (async () => {
        try {
          if (!NanoAIService.isAvailable()) {
            sendResponse({ success: false, error: 'Nano AI not available' });
            return;
          }
          const result = await NanoAIService.classifyUrl(msg.url, msg.context || {});
          sendResponse({ success: true, ...result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'NANO_AI_SEARCH') {
      (async () => {
        try {
          if (!NanoAIService.isAvailable()) {
            sendResponse({ success: false, error: 'Nano AI not available' });
            return;
          }
          const results = await NanoAIService.naturalLanguageSearch(
            msg.query,
            msg.items,
            msg.limit || 10
          );
          sendResponse({ success: true, results });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    // Handle AI session summary request (for ResumeWorkWidget)
    if (msg?.type === 'AI_SUMMARIZE_SESSION') {
      (async () => {
        try {
          if (!NanoAIService.isAvailable()) {
            sendResponse({ success: false, error: 'Nano AI not available' });
            return;
          }

          const { urls = [], categories = [], urlCount = 0 } = msg.data || {};

          // Build context for overall summary
          const categoryText = categories.length > 0 ? categories.join(', ') : 'various';
          const domains = urls.map(u => u.domain).filter(Boolean);
          const domainList = domains.slice(0, 5).join(', ');
          const moreText = domains.length > 5 ? ` and ${domains.length - 5} more` : '';

          // Generate overall summary
          const summaryPrompt = `In 10 words or less, describe what this person was doing: Browsing ${categoryText} sites: ${domainList}${moreText}. Be specific.`;
          const summary = await NanoAIService.prompt(summaryPrompt, 15000);

          // Generate per-URL descriptions (what were they working on)
          const descriptions = [];
          for (const urlInfo of urls.slice(0, 5)) { // Limit to first 5 for performance
            try {
              const descPrompt = `In 5 words or less, what task/topic for: "${urlInfo.title}" on ${urlInfo.domain}? Just the task, no fluff.`;
              const desc = await NanoAIService.prompt(descPrompt, 10000);
              descriptions.push(desc?.trim()?.replace(/^["']|["']$/g, '') || null);
            } catch {
              descriptions.push(null);
            }
          }

          sendResponse({
            success: true,
            summary: summary?.trim() || null,
            descriptions
          });
        } catch (e) {
          console.debug('[Background] AI session summary failed:', e.message);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    // Handle media control commands
    if (msg?.type === 'MEDIA_COMMAND') {
      console.log('[Background] Full message received:', JSON.stringify(msg));
      console.log('[Background] Media command received:', msg.action, 'targetTabId:', msg.targetTabId);

      (async () => {
        try {
          let targetTabs = [];

          // If targetTabId is specified, use only that tab
          if (msg.targetTabId) {
            try {
              const specificTab = await chrome.tabs.get(msg.targetTabId);
              if (specificTab) {
                targetTabs = [specificTab];
                console.log('[Background] Using specific target tab:', specificTab.url);
              }
            } catch (e) {
              console.log('[Background] Target tab not found:', msg.targetTabId);
            }
          }

          // If no specific tab or specific tab not found, fall back to all music tabs
          if (targetTabs.length === 0) {
            const musicDomains = [
              'spotify.com',
              'music.youtube.com',
              'youtube.com',
              'soundcloud.com',
              'music.apple.com',
              'pandora.com',
              'deezer.com',
              'tidal.com',
              'netflix.com'
            ];

            const tabs = await chrome.tabs.query({});
            targetTabs = tabs.filter(tab =>
              musicDomains.some(domain => tab.url?.includes(domain))
            );
            console.log('[Background] Using all music tabs:', targetTabs.length);
          }

          if (targetTabs.length === 0) {
            console.log('[Background] No target tabs found');
            sendResponse({ ok: false, error: 'No target tabs found' });
            cleanup();
            return;
          }

          // Send command to target tabs
          let commandSent = false;
          for (const tab of targetTabs) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (action) => {
                  // Use native media session API first
                  if ('mediaSession' in navigator && navigator.mediaSession.setActionHandler) {
                    try {
                      if (action === 'play') {
                        navigator.mediaSession.playbackState = 'playing';
                      } else if (action === 'pause') {
                        navigator.mediaSession.playbackState = 'paused';
                      }
                    } catch (e) {
                      console.log('Media session API failed:', e);
                    }
                  }

                  // Fallback to DOM manipulation for specific services
                  try {
                    if (action === 'play' || action === 'pause') {
                      // YouTube (regular) selectors
                      let playBtn = document.querySelector('.ytp-play-button');

                      // Netflix selectors
                      if (!playBtn) playBtn = document.querySelector('[data-uia="control-play-pause-toggle"], .PlayerControlsNeo__button--play-pause, button[aria-label*="Play"], button[aria-label*="Pause"]');

                      // Spotify selectors
                      if (!playBtn) playBtn = document.querySelector('[data-testid="control-button-playpause"]');

                      // YouTube Music selectors
                      if (!playBtn) playBtn = document.querySelector('#play-pause-button, .play-pause-button');

                      // Generic selectors
                      if (!playBtn) playBtn = document.querySelector('[aria-label*="Play"], [aria-label*="Pause"], .playButton, .pauseButton');

                      if (playBtn) {
                        playBtn.click();
                        return { success: true, service: 'DOM' };
                      }
                    } else if (action === 'nexttrack') {
                      // YouTube (regular) next video
                      let nextBtn = document.querySelector('.ytp-next-button');

                      // Spotify next track
                      if (!nextBtn) nextBtn = document.querySelector('[data-testid="control-button-skip-forward"]');

                      // Generic selectors
                      if (!nextBtn) nextBtn = document.querySelector('.next-button, [aria-label*="Next"]');

                      if (nextBtn) {
                        nextBtn.click();
                        return { success: true, service: 'DOM' };
                      }
                    } else if (action === 'previoustrack') {
                      // YouTube (regular) previous video
                      let prevBtn = document.querySelector('.ytp-prev-button');

                      // Spotify previous track
                      if (!prevBtn) prevBtn = document.querySelector('[data-testid="control-button-skip-back"]');

                      // Generic selectors
                      if (!prevBtn) prevBtn = document.querySelector('.previous-button, [aria-label*="Previous"]');

                      if (prevBtn) {
                        prevBtn.click();
                        return { success: true, service: 'DOM' };
                      }
                    }
                  } catch (e) {
                    console.log('DOM control failed:', e);
                  }

                  return { success: false };
                },
                args: [msg.action]
              });
              commandSent = true;
              console.log(`[Background] Media command sent to ${tab.url}`);
            } catch (e) {
              console.log(`[Background] Failed to send command to ${tab.url}:`, e);
            }
          }

          if (commandSent) {
            sendResponse({ ok: true, action: msg.action, tabsFound: targetTabs.length, targetTabId: msg.targetTabId });
          } else {
            sendResponse({ ok: false, error: 'Failed to execute command on any target tab' });
          }
        } catch (e) {
          console.error('[Background] Media command error:', e);
          sendResponse({ ok: false, error: e.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Handle URL notes messages first
    const urlNotesHandled = handleUrlNotesMessages(msg, sender, sendResponse);
    if (urlNotesHandled) {
      console.log('[Background Debug] Message handled by URL notes handler');
      cleanup();
      return true;
    }

    // Handle activity-related messages
    if (msg?.action === 'getActivityData') {
      console.log('[Background Debug] Handling getActivityData');
      (async () => {
        try {
          await handleGetActivityData(msg, sender, sendResponse);
        } catch (e) {
          console.error('[Background] Error in getActivityData:', e);
          sendResponse({ ok: false, error: String(e) });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    if (msg?.action === 'getTimeSeriesStats') {
      console.log('[Background Debug] Handling getTimeSeriesStats');
      (async () => {
        try {
          await handleGetTimeSeriesStats(msg, sender, sendResponse);
        } catch (e) {
          console.error('[Background] Error in getTimeSeriesStats:', e);
          sendResponse({ ok: false, error: String(e) });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    if (msg?.action === 'cleanupTimeSeriesData') {
      console.log('[Background Debug] Handling cleanupTimeSeriesData');
      (async () => {
        try {
          await handleCleanupTimeSeriesData(msg, sender, sendResponse);
        } catch (e) {
          console.error('[Background] Error in cleanupTimeSeriesData:', e);
          sendResponse({ ok: false, error: String(e) });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Handle activity tracking messages from content scripts
    // Skip activity handling for chat scraping messages, calendar triggers, tab navigation, and task management
    const skipActivityTypes = [
      'AUTO_SCRAPED_CHATS', 'SCRAPED_LINKS', 'TRIGGER_CALENDAR_SCRAPE', 'CALENDAR_EVENTS_SCRAPED',
      'TRIGGER_MANUAL_CHATS_SCRAPE', 'TRIGGER_ALL_CHATS_SCRAPE', 'JUMP_TO_TAB',
      // Task Manager messages
      'GET_ALL_TASKS', 'GET_TASK_FOR_TAB', 'GET_TASK_BY_ID', 'RENAME_TASK',
      'MOVE_TAB_TO_TASK', 'MERGE_TASKS', 'AI_NAME_TASK'
    ];
    if (msg.type && sender.tab && !skipActivityTypes.includes(msg.type)) {
      console.log('[Background Debug] Potential activity message:', { type: msg.type, url: sender.tab?.url });

      const activityHandled = handleActivityContentScriptMessage(msg, sender);
      if (activityHandled) {
        console.log('[Background Debug] Message handled by activity content script handler');
        cleanup();
        return false; // Don't send response for content script activity messages
      }
    }

    if (msg?.ping === 'bg') {
      sendResponse({ pong: true, time: Date.now() });
      cleanup();
      return true;
    }

    // Handle text selection events (like Sider AI)
    if (msg?.type === 'textSelected') {
      console.log('[Background] Text selected:', {
        text: msg.text?.substring(0, 50) + (msg.text?.length > 50 ? '...' : ''),
        length: msg.length,
        wordCount: msg.wordCount,
        url: msg.url
      });

      // Auto-save to daily notes (fire and forget - don't wait for response)
      (async () => {
        try {
          await saveToDailyNotes({
            text: msg.text,
            beforeText: msg.beforeText,
            afterText: msg.afterText,
            position: msg.position,
            url: msg.url,
            timestamp: Date.now(),
            length: msg.length,
            wordCount: msg.wordCount
          });
        } catch (e) {
          console.warn('[Background] Failed to save to daily notes:', e);
        }
      })();

      // Store selection data for potential AI processing (synchronous)
      try {
        chrome.storage.local.set({
          lastSelection: {
            text: msg.text,
            beforeText: msg.beforeText,
            afterText: msg.afterText,
            position: msg.position,
            url: msg.url,
            timestamp: Date.now(),
            length: msg.length,
            wordCount: msg.wordCount
          }
        });
      } catch (e) {
        console.warn('[Background] Failed to store selection:', e);
      }

      cleanup();
      // Don't return true since we're not sending a response
      return false;
    }

    if (msg?.type === 'textDeselected') {
      console.log('[Background] Text selection cleared');
      cleanup();
      // Don't return true since we're not sending a response
      return false;
    }

    // Get daily notes for a specific date or recent dates
    if (msg?.type === 'getDailyNotes') {
      console.log('[Background] Getting daily notes:', msg);

      const handleGetDailyNotes = async () => {
        try {
          const { date, limit = 7 } = msg;

          if (date) {
            const storageKey = `dailyNotes_${date}`;
            const result = await chrome.storage.local.get([storageKey]);
            const dailyData = result[storageKey] || {
              date,
              content: '',
              selections: [],
              metadata: { created: 0, lastUpdated: 0, selectionCount: 0 }
            };
            return {
              ok: true,
              data: dailyData
            };
          } else {
            // Get recent days
            const keys = [];
            const today = new Date();
            for (let i = 0; i < limit; i++) {
              const d = new Date(today);
              d.setDate(d.getDate() - i);
              keys.push(`dailyNotes_${d.toISOString().split('T')[0]}`);
            }

            const result = await chrome.storage.local.get(keys);
            const notes = Object.values(result).sort((a, b) =>
              new Date(b.date).getTime() - new Date(a.date).getTime()
            );

            return {
              ok: true,
              data: notes
            };
          }
        } catch (e) {
          console.error('[Background] Error getting daily notes:', e);
          return { ok: false, error: e.message };
        }
      };

      handleGetDailyNotes().then(response => {
        sendResponse(response);
      });

      return true;
    }



    // Trigger manual scrape (for testing or user request)
    if (msg?.type === 'TRIGGER_CALENDAR_SCRAPE') {
      console.log('[Background] Manual trigger for calendar scrape: Disabled');
      sendResponse({ started: false, error: 'Feature disabled' });
      return false;
    }


    // Get last scrape time from UI_STATE store
    if (msg?.type === 'GET_LAST_SCRAPE_TIME') {
      console.log('[Background] Getting last scrape time for:', msg.data?.platform);
      (async () => {
        try {
          const { platform } = msg.data || {};
          if (!platform) {
            sendResponse({ timestamp: 0 });
            cleanup();
            return;
          }

          // Use statically imported functions (imported at top of file)
          const db = await getUnifiedDB();

          const tx = db.transaction([DB_CONFIG.STORES.UI_STATE], 'readonly');
          const store = tx.objectStore(DB_CONFIG.STORES.UI_STATE);
          const stateKey = `lastScrape_${platform}`;

          const data = await new Promise((resolve, reject) => {
            const request = store.get(stateKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });

          sendResponse({ timestamp: data ? data.timestamp : 0 });
        } catch (error) {
          console.error('[Background] Error getting last scrape time:', error);
          sendResponse({ timestamp: 0 });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Update last scrape time in UI_STATE store
    if (msg?.type === 'UPDATE_LAST_SCRAPE_TIME') {
      console.log('[Background] Updating last scrape time');
      (async () => {
        try {
          const { platform, timestamp } = msg.data || {};
          if (!platform || !timestamp) {
            sendResponse({ success: false, error: 'Missing platform or timestamp' });
            cleanup();
            return;
          }

          // Use statically imported functions (imported at top of file)
          const db = await getUnifiedDB();

          const tx = db.transaction([DB_CONFIG.STORES.UI_STATE], 'readwrite');
          const store = tx.objectStore(DB_CONFIG.STORES.UI_STATE);
          const stateKey = `lastScrape_${platform}`;

          await new Promise((resolve, reject) => {
            const request = store.put({
              id: stateKey,
              timestamp,
              platform,
              updatedAt: Date.now()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });

          await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });

          console.log(`[Background] ✅ Updated last scrape time for ${platform}: ${new Date(timestamp).toLocaleString()}`);
          sendResponse({ success: true });
        } catch (error) {
          console.error('[Background] Error updating last scrape time:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Handle auto-scraped chats from content script
    if (msg?.type === 'AUTO_SCRAPED_CHATS') {
      console.log('[Background] 🔔 AUTO_SCRAPED_CHATS message received!');
      console.log('[Background] Handling auto-scraped chats');
      (async () => {
        try {
          const result = msg.data;
          console.log('[Background] Received data:', {
            success: result.success,
            platform: result.platform,
            chatsCount: result.chats?.length,
            newChatsCount: result.newChatsCount
          });

          if (result.success && result.chats && result.chats.length > 0) {
            console.log('[Background] Processing chats...');

            // Use top-level imports (same pattern as activity.js)
            console.log('[Background] Step 1: Opening database...');
            const db = await getUnifiedDB();
            console.log('[Background] Step 2: Database opened successfully');

            // Get existing chats to deduplicate
            console.log('[Background] Step 4: Creating read transaction...');
            const readTx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readonly');
            const readStore = readTx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);
            const index = readStore.index('by_platform');

            console.log('[Background] Step 5: Querying existing chats...');
            const existingChats = await new Promise((resolve, reject) => {
              const request = index.getAll(result.platform);
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });

            console.log(`[Background] Step 6: Found ${existingChats.length} existing chats for ${result.platform}`);

            // Store ALL chats to update timestamps and ensure order matches current view
            console.log(`[Background] Step 7: Storing/Updating ${result.chats.length} chats...`);

            // Store in IndexedDB
            const writeTx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS, DB_CONFIG.STORES.UI_STATE], 'readwrite');
            const writeStore = writeTx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

            for (const chat of result.chats) {
              writeStore.put(chat);
            }

            // Update last scrape time in UI_STATE
            const uiStateStore = writeTx.objectStore(DB_CONFIG.STORES.UI_STATE);
            const stateKey = `lastScrape_${result.platform}`;
            uiStateStore.put({
              id: stateKey,
              timestamp: result.scrapedAt,
              platform: result.platform,
              updatedAt: Date.now()
            });

            await new Promise((resolve, reject) => {
              writeTx.oncomplete = () => resolve();
              writeTx.onerror = () => reject(writeTx.error);
            });



            console.log(`[Background] ✅ Auto-stored/updated ${result.chats.length} ${result.platform} chats`);

            // CHECK IF WE SHOULD CLOSE THE TAB (Calendar-style auto-scrape)
            if (sender.tab && sender.tab.url.includes('scraping=true')) {
              console.log('[Background] Closing chat scraping tab:', sender.tab.id);
              // Small delay to ensure DB write is fully done/synced?
              setTimeout(() => {
                chrome.tabs.remove(sender.tab.id).catch(e => console.warn('Failed to close tab:', e));
              }, 1000);
            }

            sendResponse({ success: true, count: result.chats.length });
          } else {
            // Even if no new chats, if it was a scraping tab, close it
            if (sender.tab && sender.tab.url.includes('scraping=true')) {
              console.log('[Background] No new chats, closing scraping tab:', sender.tab.id);
              chrome.tabs.remove(sender.tab.id).catch(e => console.warn('Failed to close tab:', e));
            }
            sendResponse({ success: true, count: 0 }); // Respond even if no chats to avoid port error
          }
        } catch (error) {
          console.error('[Background] Error handling auto-scraped chats:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true; // Keep channel open
    }

    // Handle scraped links from click-to-scrape (footerBar.js)
    if (msg?.type === 'SCRAPED_LINKS') {
      console.log('[Background] 🔗 SCRAPED_LINKS message received!');
      (async () => {
        try {
          const result = msg.data;
          console.log('[Background] Received scraped links:', {
            success: result.success,
            platform: result.platform,
            hostname: result.hostname,
            linksCount: result.links?.length
          });

          if (result.success && result.links && result.links.length > 0) {
            const db = await getUnifiedDB();

            // Get existing links for this platform to deduplicate
            const readTx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readonly');
            const readStore = readTx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);
            const index = readStore.index('by_platform');

            const existingLinks = await new Promise((resolve, reject) => {
              const request = index.getAll(result.platform);
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });

            const existingMap = new Map(existingLinks.map(l => [l.chatId || l.linkId, l]));

            // Filter to new or updated links (title change)
            const linksToSave = result.links.filter(link => {
              const id = link.linkId || link.chatId;
              if (!id) return false;

              // If new, save it
              if (!existingMap.has(id)) return true;

              // If title changed, save it
              const existing = existingMap.get(id);
              if (existing.title !== link.title) return true;

              return false;
            });

            console.log(`[Background] Found ${existingLinks.length} existing, ${linksToSave.length} to save (new/updated)`);

            if (linksToSave.length > 0) {
              // Store new/updated links in IndexedDB
              const writeTx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS, DB_CONFIG.STORES.UI_STATE, DB_CONFIG.STORES.SCRAPED_CONFIGS], 'readwrite');
              const writeStore = writeTx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

              for (const link of linksToSave) {
                const id = link.linkId || link.chatId;
                const existing = existingMap.get(id);

                // Preserve original scrapedAt if updating, unless it's a very old entry? 
                // Actually, if we update title, we probably want to update timestamp to bring it to top?
                // Let's stick to updating timestamp so it feels "fresh".

                const entry = {
                  chatId: id,
                  url: link.url,
                  title: link.title,
                  platform: result.platform,
                  hostname: result.hostname,
                  scrapedAt: Date.now(), // Always bump timestamp on update so it floats to top
                  source: 'click-to-scrape'
                };
                writeStore.put(entry);
              }

              // Update last scrape time
              const uiStateStore = writeTx.objectStore(DB_CONFIG.STORES.UI_STATE);
              uiStateStore.put({
                id: `lastScrape_${result.platform}`,
                timestamp: result.scrapedAt || Date.now(),
                platform: result.platform,
                hostname: result.hostname,
                updatedAt: Date.now()
              });

              // Save the selector for this domain to SCRAPED_CONFIGS
              if (result.selector) {
                // Also write to SCRAPED_CONFIGS
                const configStore = writeTx.objectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS);

                // Handle selector being either a string or an object
                const selectorData = typeof result.selector === 'object' ? result.selector : { selector: result.selector };

                const configEntry = {
                  ...selectorData, // Spread all fields (excludedPatterns, scrapeLimit, etc.)
                  domain: result.hostname,
                  selector: selectorData.selector, // Ensure selector field is set
                  container: selectorData.container,
                  links: selectorData.links,
                  sample: selectorData.sample,
                  source: 'auto', // It came from click-to-scrape
                  enabled: true,
                  updatedAt: Date.now()
                };
                configStore.put(configEntry);

                // Sync to chrome.storage.local for immediate availability
                try {
                  chrome.storage.local.get('domainSelectors').then(data => {
                    const selectors = data.domainSelectors || {};
                    selectors[result.hostname] = {
                      ...configEntry,
                      savedAt: Date.now()
                    };
                    chrome.storage.local.set({ domainSelectors: selectors });
                  });
                } catch (e) { console.warn('Failed to sync selector to local storage', e); }
              }

              await new Promise((resolve, reject) => {
                writeTx.oncomplete = () => resolve();
                writeTx.onerror = () => reject(writeTx.error);
              });

              console.log(`[Background] ✅ Stored ${linksToSave.length} new links from ${result.platform}`);
            }

            sendResponse({ success: true, newCount: linksToSave.length, totalCount: result.links.length });
          } else {
            sendResponse({ success: true, newCount: 0, totalCount: 0 });
          }
        } catch (error) {
          console.error('[Background] Error handling scraped links:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }

    // Handle chat scraping requests
    if (msg?.type === 'SCRAPE_CHATS_REQUEST') {
      console.log('[Background] Handling chat scrape request');
      (async () => {
        try {
          const { tabId, platform } = msg.data || {};

          if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            cleanup();
            return;
          }

          // Send message to content script to scrape
          const result = await chrome.tabs.sendMessage(tabId, {
            type: 'SCRAPE_CHATS'
          });

          if (result.success && result.chats) {
            // Import DB dynamically
            // Use statically imported functions (imported at top of file)
            const db = await getUnifiedDB();

            // Store scraped chats in IndexedDB
            const tx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readwrite');
            const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);
            const index = store.index('by_platform');

            // Get existing chats for this platform
            const existingChats = await new Promise((resolve, reject) => {
              const request = index.getAll(result.platform);
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });

            // Deduplicate by chatId
            const chatMap = new Map();
            existingChats.forEach(chat => chatMap.set(chat.chatId, chat));

            // Add new scraped chats
            let newCount = 0;
            for (const chat of result.chats) {
              if (!chatMap.has(chat.chatId)) {
                newCount++;
              }
              chatMap.set(chat.chatId, chat);

              // Store in IndexedDB
              await new Promise((resolve, reject) => {
                const request = store.put(chat);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
              });
            }

            await new Promise((resolve, reject) => {
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });

            console.log(`[Background] Stored ${newCount} new chats (${chatMap.size} total for ${result.platform})`);

            sendResponse({
              success: true,
              count: newCount,
              total: chatMap.size,
              platform: result.platform,
            });
          } else {
            sendResponse(result);
          }
        } catch (error) {
          console.error('[Background] Error handling scrape request:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Handle get scraped chats requests
    if (msg?.type === 'GET_SCRAPED_CHATS') {
      console.log('[Background] Getting scraped chats (optimized):', msg.data);
      (async () => {
        try {
          const { platform, limit = 50, sortBy = 'scrapedAt' } = msg.data || {};

          // Import DB dynamically
          const db = await getUnifiedDB();
          const tx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readonly');
          const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

          const chats = [];

          // 1. Fetch Chats (Cursor Optimization)
          await new Promise((resolve, reject) => {
            let request;
            let count = 0;

            if (platform) {
              const index = store.index('by_platform_scrapedAt');
              // Range for specific platform, from -Inifinity to Infinity time
              // We use cursors, so 'prev' gives us newest first
              const range = IDBKeyRange.bound([platform, 0], [platform, Infinity]);
              request = index.openCursor(range, 'prev');
            } else {
              // Global list, sorted by scrapedAt
              if (sortBy === 'scrapedAt') {
                const index = store.index('by_scrapedAt');
                request = index.openCursor(null, 'prev'); // Newest first
              } else {
                // Default fallback (title sort not optimized with cursors yet, use simple limit?)
                // If sorting by title, we can't easily limit without fetching all first 
                // unless we have an index on title. We do have 'by_title'.
                // But usually users want 'scrapedAt'. 
                // For now, if sortBy is not scrapedAt, we might fall back to older method or just use scrapedAt index if title is rare
                const index = store.index('by_scrapedAt'); // Fallback to time sort for performance
                request = index.openCursor(null, 'prev');
              }
            }

            request.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && count < limit) {
                chats.push(cursor.value);
                count++;
                cursor.continue();
              } else {
                resolve();
              }
            };
            request.onerror = () => reject(request.error);
          });

          // 2. Fetch Stats (Efficient Counting)
          const byPlatform = {};

          await new Promise((resolve, reject) => {
            const platformIndex = store.index('by_platform');
            const keyRequest = platformIndex.openKeyCursor(null, 'nextunique');

            // Collect all unique platforms first
            const platforms = [];
            keyRequest.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor) {
                platforms.push(cursor.key);
                cursor.continue();
              } else {
                // Now count each
                Promise.all(platforms.map(p =>
                  new Promise((res) => {
                    const countReq = platformIndex.count(p);
                    countReq.onsuccess = () => res({ platform: p, count: countReq.result });
                    countReq.onerror = () => res({ platform: p, count: 0 });
                  })
                )).then(counts => {
                  counts.forEach(c => byPlatform[c.platform] = c.count);
                  resolve();
                }).catch(reject);
              }
            };
            keyRequest.onerror = () => reject(keyRequest.error);
          });

          // Get total count
          const total = Object.values(byPlatform).reduce((a, b) => a + b, 0);

          console.log(`[Background] Retrieved ${chats.length} chats (limit: ${limit})`);

          sendResponse({
            success: true,
            chats,
            total,
            byPlatform,
          });
        } catch (error) {
          console.error('[Background] Error getting scraped chats:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Handle delete scraped chat request
    if (msg?.type === 'DELETE_SCRAPED_CHAT') {
      console.log('[Background] Deleting scraped chat:', msg.data);
      (async () => {
        try {
          const { chatId } = msg.data || {};

          if (!chatId) {
            sendResponse({ success: false, error: 'Chat ID is required' });
            cleanup();
            return;
          }

          // Import DB dynamically
          // Use statically imported functions (imported at top of file)
          const db = await getUnifiedDB();

          const tx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readwrite');
          const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

          await new Promise((resolve, reject) => {
            const request = store.delete(chatId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });

          await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });

          console.log(`[Background] Deleted scraped chat: ${chatId}`);

          sendResponse({
            success: true,
            deleted: chatId,
          });
        } catch (error) {
          console.error('[Background] Error deleting scraped chat:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }





    // Handle clear scraped chats for platform
    if (msg?.type === 'CLEAR_SCRAPED_CHATS') {
      console.log('[Background] Clearing scraped chats:', msg.data);
      (async () => {
        try {
          const { platform } = msg.data || {};

          // Import DB dynamically
          // Use statically imported functions (imported at top of file)
          const db = await getUnifiedDB();

          const tx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readwrite');
          const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

          if (platform) {
            // Clear chats for specific platform
            const index = store.index('by_platform');
            const chats = await new Promise((resolve, reject) => {
              const request = index.getAll(platform);
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });

            for (const chat of chats) {
              await new Promise((resolve, reject) => {
                const request = store.delete(chat.chatId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
              });
            }

            console.log(`[Background] Cleared ${chats.length} chats for ${platform}`);

            sendResponse({
              success: true,
              cleared: chats.length,
              platform,
            });
          } else {
            // Clear all scraped chats
            await new Promise((resolve, reject) => {
              const request = store.clear();
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });

            console.log('[Background] Cleared all scraped chats');

            sendResponse({
              success: true,
              cleared: 'all',
            });
          }

          await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } catch (error) {
          console.error('[Background] Error clearing scraped chats:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Get daily notes summary
    if (msg?.type === 'getDailyNotesSummary') {
      (async () => {
        try {
          const result = await chrome.storage.local.get(['dailyNotesSummary']);
          const summary = result.dailyNotesSummary || {};
          sendResponse({ ok: true, summary });
        } catch (e) {
          console.error('[Background] Error getting daily notes summary:', e);
          sendResponse({ ok: false, error: e?.message || 'Failed to get daily notes summary' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Update daily notes content (manual editing)
    if (msg?.type === 'updateDailyNotes') {
      console.log('[Background] Updating daily notes content:', msg);

      // Use .then() pattern instead of async/await to avoid message port issues
      const handleUpdate = async () => {
        try {
          const { date, content } = msg;
          if (!date) {
            console.error('[Background] updateDailyNotes: Date is required');
            return { ok: false, error: 'Date is required' };
          }

          console.log('[Background] Processing daily notes update for date:', date);
          const storageKey = `dailyNotes_${date}`;
          const result = await chrome.storage.local.get([storageKey]);
          const dailyData = result[storageKey] || {
            date,
            content: '',
            selections: [],
            metadata: { created: Date.now(), lastUpdated: Date.now(), selectionCount: 0 }
          };

          // Update content and metadata
          dailyData.content = content || '';
          dailyData.metadata.lastUpdated = Date.now();

          await chrome.storage.local.set({ [storageKey]: dailyData });
          console.log('[Background] Daily notes saved successfully');

          // Notify listeners about daily notes update
          try {
            const bc = new BroadcastChannel('ws_db_changes');
            bc.postMessage({ type: 'dailyNotesChanged', date });
            bc.close();
          } catch (e) {
            console.debug('[Background] BroadcastChannel not available for manual daily notes sync');
          }

          return { ok: true, updated: true };
        } catch (error) {
          console.error('[Background] Error in handleUpdate for daily notes:', error);
          throw error;
        }
      };

      // Handle async operation with proper error handling
      handleUpdate()
        .then(response => {
          console.log('[Background] Sending response:', response);
          sendResponse(response);
        })
        .catch(error => {
          console.error('[Background] Error updating daily notes:', error);
          sendResponse({ ok: false, error: error?.message || 'Failed to update daily notes' });
        });

      return true; // Keep message channel open for async response
    }

    // Trigger scrape for ALL open chat tabs (for onboarding)
    if (msg?.type === 'TRIGGER_ALL_CHATS_SCRAPE') {
      console.log('[Background] Triggering scrape for all chat tabs...');
      (async () => {
        try {
          const chatDomains = [
            'chat.openai.com', 'chatgpt.com',
            'claude.ai',
            'gemini.google.com',
            'grok.com',
            'perplexity.ai',
            'aistudio.google.com',
            'lovable.dev'
          ];

          // Find all tabs matching these domains
          const tabs = await chrome.tabs.query({});
          const targetTabs = tabs.filter(tab =>
            tab.url && chatDomains.some(domain => tab.url.includes(domain))
          );

          console.log(`[Background] Found ${targetTabs.length} chat tabs to scrape`);
          let triggeredCount = 0;

          // Send scrape command to each tab sequentially with delay to avoid CPU spike
          for (const tab of targetTabs) {
            try {
              // Check if we can inject/message this tab
              await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_NEW_CHATS' });
              triggeredCount++;
              console.log(`[Background] Triggered scrape on tab ${tab.id} (${tab.url})`);
            } catch (e) {
              console.log(`[Background] Failed to trigger scrape on tab ${tab.id} (may need reload):`, e);
            }
            // Add small delay between triggers
            await new Promise(r => setTimeout(r, 1500));
          }

          sendResponse({
            success: true,
            triggeredCount,
            totalFound: targetTabs.length
          });

        } catch (error) {
          console.error('[Background] Error triggering all chats scrape:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Trigger MANUAL scrape by opening tabs (Calendar-style)
    if (msg?.type === 'TRIGGER_MANUAL_CHATS_SCRAPE') {
      console.log('[Background] Triggering MANUAL scrape (opening tabs)...');
      (async () => {
        try {
          const platforms = [
            { url: 'https://chatgpt.com/?scraping=true', domain: 'chatgpt.com' },
            { url: 'https://claude.ai/chats?scraping=true', domain: 'claude.ai' },
            { url: 'https://gemini.google.com/app?scraping=true', domain: 'gemini.google.com' },
            { url: 'https://www.perplexity.ai/?scraping=true', domain: 'perplexity.ai' }
          ];

          // Check for existing open tabs to avoid duplicates
          const tabs = await chrome.tabs.query({});
          let openedCount = 0;

          for (const platform of platforms) {
            // Check if we already have a tab for this domain (scraping or not)
            const existingTab = tabs.find(t => t.url && t.url.includes(platform.domain));

            if (existingTab) {
              console.log(`[Background] Tab already open for ${platform.domain}, triggering scrape on it...`);
              // Just trigger scrape on existing tab
              chrome.tabs.sendMessage(existingTab.id, { type: 'SCRAPE_NEW_CHATS' }).catch(() => { });
            } else {
              // Open new invisible tab
              console.log(`[Background] Opening hidden tab for ${platform.domain}...`);
              await chrome.tabs.create({
                url: platform.url,
                active: false,
                pinned: true
              });
              openedCount++;
            }
            // Add significant delay between opening heavy AI apps
            await new Promise(r => setTimeout(r, 2000));
          }

          sendResponse({ success: true, openedCount });
        } catch (error) {
          console.error('[Background] Error triggering manual chats scrape:', error);
          sendResponse({ success: false, error: error.message });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Delete a specific selection from daily notes
    if (msg?.type === 'deleteSelection') {
      console.log('[Background] Deleting selection:', msg.selectionId, 'from', msg.date);
      (async () => {
        try {
          const { date, selectionId } = msg;
          if (!date || !selectionId) throw new Error('Date and selectionId are required');

          const storageKey = `dailyNotes_${date}`;
          const result = await chrome.storage.local.get([storageKey]);
          const dailyData = result[storageKey];

          if (!dailyData || !dailyData.selections) {
            sendResponse({ ok: false, error: 'Daily notes not found' });
            return;
          }

          // Remove the selection with matching ID
          const originalLength = dailyData.selections.length;
          dailyData.selections = dailyData.selections.filter(selection => selection.id !== selectionId);

          if (dailyData.selections.length === originalLength) {
            sendResponse({ ok: false, error: 'Selection not found' });
            return;
          }

          // Update metadata
          dailyData.metadata.lastUpdated = Date.now();
          dailyData.metadata.selectionCount = dailyData.selections.length;

          // Save updated data
          await chrome.storage.local.set({ [storageKey]: dailyData });

          // Notify listeners about daily notes update
          try {
            const bc = new BroadcastChannel('ws_db_changes');
            bc.postMessage({ type: 'dailyNotesChanged', date });
            bc.close();
          } catch (e) {
            console.debug('[Background] BroadcastChannel not available for delete selection sync');
          }

          sendResponse({ ok: true, deleted: true });
        } catch (e) {
          console.error('[Background] Error deleting selection:', e);
          sendResponse({ ok: false, error: e?.message || 'Failed to delete selection' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    if (msg?.type === 'openSidePanel') {
      console.log('[Background] Received openSidePanel request from tab:', sender?.tab?.id);
      console.log('[Background] Message details:', {
        fromUserGesture: msg.fromUserGesture,
        timestamp: msg.timestamp,
        startVoice: msg.startVoice
      });

      (async () => {
        try {
          console.log('[Background] === START openSidePanel handler ===');
          console.log('[Background] Initial sender:', {
            hasTab: !!sender?.tab,
            tabId: sender?.tab?.id,
            windowId: sender?.tab?.windowId,
            startVoice: msg.startVoice
          });

          const senderTab = sender?.tab;
          let windowId = senderTab?.windowId;

          console.log('[Background] Extracted windowId:', windowId);

          // First attempt: Try to open side panel directly (same as working sample.js)
          // 🚨 WORKING CODE - DO NOT ADD setOptions() calls here - they break functionality
          if (chrome?.sidePanel?.open && windowId) {
            try {
              console.log('[Background] Attempting to open side panel for window:', windowId);
              console.log('[Background] Side panel path:', chrome.runtime.getURL('sidebar.html'));
              // ✅ This simple direct call works - DO NOT MODIFY
              await chrome.sidePanel.open({ windowId });
              console.log('[Background] ✅ Side panel opened successfully!');

              // Set voice flag AFTER successful open (non-blocking)
              if (msg.startVoice) {
                console.log('[Background] Setting pendingVoiceStart flag after successful open...');
                chrome.storage.local.set({ pendingVoiceStart: true }).catch(err =>
                  console.warn('[Background] Failed to set voice flag:', err)
                );
              }

              sendResponse({ ok: true, method: 'sidePanel' });
              cleanup();
              return;
            } catch (sidePanelError) {
              console.error('[Background] ❌ Side panel open failed:', sidePanelError);
              console.log('[Background] Error details:', {
                message: sidePanelError.message,
                stack: sidePanelError.stack,
                name: sidePanelError.name
              });
              // Continue to fallback methods below
            }
          } else {
            console.log('[Background] Side panel API not available or no windowId:', {
              hasSidePanel: !!chrome?.sidePanel?.open,
              windowId,
              sender: sender?.tab
            });
          }

          // Fallback attempt: if no windowId (e.g., invoked from extension page/popup) or first attempt failed,
          // try to recover a valid windowId using the current window.
          if (chrome?.sidePanel?.open && !windowId) {
            try {
              console.log('[Background] Attempting to get current windowId as fallback...');
              const currentWin = await chrome.windows.getCurrent();
              if (currentWin?.id) {
                windowId = currentWin.id;
                console.log('[Background] Fallback windowId acquired:', windowId);
                await chrome.sidePanel.open({ windowId });
                console.log('[Background] Side panel opened successfully via fallback windowId!');
                sendResponse({ ok: true, method: 'sidePanel', via: 'getCurrent' });
                cleanup();
                return;
              }
            } catch (fallbackErr) {
              console.warn('[Background] Fallback open via getCurrent() failed:', fallbackErr);
            }
          }

          // Fallback: Open in tab
          console.log('[Background] Falling back to tab...');
          const url = chrome.runtime.getURL('index.html');
          const existing = await chrome.tabs.query({ url });
          if (existing && existing.length > 0) {
            const existingTab = existing[0];
            console.log('[Background] Activating existing tab:', existingTab.id);
            await chrome.tabs.update(existingTab.id, { active: true });
            if (existingTab.windowId) {
              await chrome.windows.update(existingTab.windowId, { focused: true });
            }
          } else {
            console.log('[Background] Creating new tab');
            await chrome.tabs.create({ url });
          }
          sendResponse({
            ok: true,
            fallback: 'tab',
            message: 'Side panel could not be opened. Opened in tab instead. Use extension icon or Ctrl+Shift+K for side panel.'
          });
        } catch (e) {
          console.error('[Background] Error in openSidePanel:', e);
          sendResponse({ ok: false, error: e?.message || 'Failed to open side panel' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }


    if (msg?.action === 'fetchPreview' && msg?.url) {
      (async () => {
        try {
          const url = String(msg.url);
          const res = await fetch(url, { method: 'GET' });
          const html = await res.text();
          const find = (prop) => {
            const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"]+)['"]`, 'i');
            const m = html.match(re);
            if (m && m[1]) return m[1];
            const re2 = new RegExp(`<meta[^>]+name=["']${prop}["'][^>]*content=["']([^"]+)['"]`, 'i');
            const m2 = html.match(re2);
            return (m2 && m2[1]) || '';
          };
          const titleTag = (() => {
            const m = html.match(/<title>([^<]+)<\/title>/i);
            return (m && m[1]) || '';
          })();
          const data = {
            source: (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
            title: find('og:title') || find('twitter:title') || titleTag,
            description: find('og:description') || find('description') || find('twitter:description') || '',
            image: find('og:image') || find('twitter:image') || '',
            url
          };
          sendResponse({ ok: true, data });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || 'Preview fetch failed' });
        } finally {
          cleanup();
        }
      })();
      return true; // keep the message channel open for async response
    }

    // List tabs for current window
    if (msg?.type === 'getTabs') {
      (async () => {
        try {
          const win = await chrome.windows.getCurrent();
          const tabs = await chrome.tabs.query({ windowId: win.id });
          const mapped = tabs.map(t => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active, index: t.index }));
          sendResponse({ ok: true, tabs: mapped });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || 'Failed to get tabs' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Activate a specific tab by id
    if (msg?.type === 'activateTab' && msg?.id != null) {
      (async () => {
        try {
          const id = Number(msg.id);
          await chrome.tabs.update(id, { active: true });
          try {
            const t = await chrome.tabs.get(id);
            if (t?.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
          } catch { }
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || 'Failed to activate tab' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Close a specific tab by id
    if (msg?.type === 'closeTab' && msg?.id != null) {
      (async () => {
        try {
          const id = Number(msg.id);
          await chrome.tabs.remove(id);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || 'Failed to close tab' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Switch relative tab: delta -1 for prev, +1 for next
    if (msg?.type === 'switchTabRel' && typeof msg.delta === 'number') {
      (async () => {
        try {
          const win = await chrome.windows.getCurrent();
          const tabs = await chrome.tabs.query({ windowId: win.id });
          if (!tabs || tabs.length === 0) { sendResponse({ ok: false, error: 'No tabs' }); return; }
          const activeIdx = tabs.findIndex(t => t.active);
          const currentIndex = activeIdx >= 0 ? activeIdx : 0;
          let nextIndex = (currentIndex + (msg.delta > 0 ? 1 : -1)) % tabs.length;
          if (nextIndex < 0) nextIndex = tabs.length - 1;
          const target = tabs[nextIndex];
          await chrome.tabs.update(target.id, { active: true });
          try { if (target.windowId != null) await chrome.windows.update(target.windowId, { focused: true }); } catch { }
          sendResponse({ ok: true, activated: target.id });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || 'Failed to switch tab' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // Get workspace data for voice commands
    if (msg?.action === 'getWorkspaceData') {
      (async () => {
        try {
          // Get dashboard data from storage
          const { dashboardData } = await chrome.storage.local.get(['dashboardData']);

          let allItems = [];
          let savedItems = [];

          if (dashboardData) {
            // Combine history and bookmarks
            allItems = [
              ...(dashboardData.history || []),
              ...(dashboardData.bookmarks || [])
            ];
          }

          // Get saved workspaces
          try {
            // Use statically imported listWorkspaces (imported at top of file)
            const workspacesResult = await listWorkspaces();
            const workspaces = workspacesResult?.success ? workspacesResult.data : [];

            // Flatten all workspace URLs
            savedItems = workspaces.flatMap(ws =>
              (ws.urls || []).map(u => ({
                ...u,
                workspaceGroup: ws.name,
                id: `${ws.id}-${u.url}`
              }))
            );
          } catch (e) {
            console.warn('[Background] Failed to get workspace data:', e);
          }

          sendResponse({
            success: true,
            data: { allItems, savedItems }
          });
        } catch (e) {
          console.error('[Background] Error getting workspace data:', e);
          sendResponse({ success: false, error: e?.message || 'Failed to get workspace data' });
        } finally {
          cleanup();
        }
      })();
      return true;
    }

    // --- Specific Search Handlers for footerBar.js ---
    if (msg?.type === 'SEARCH_TABS') {
      (async () => {
        try {
          console.log('[Background] SEARCH_TABS received:', msg.query);
          const query = (msg.query || '').toLowerCase();
          const tabs = await chrome.tabs.query({});
          let results = [];

          if (query) {
            // Simple robust filter to avoid library dependencies in Service Worker
            results = tabs.filter(t =>
              (t.title && t.title.toLowerCase().includes(query)) ||
              (t.url && t.url.toLowerCase().includes(query))
            );
          } else {
            results = tabs;
          }

          console.log(`[Background] Found ${results.length} tabs for query "${query}"`);

          // Format as expected by searchService.js
          const mapped = results.slice(0, 20).map(t => ({
            id: t.id,
            title: t.title,
            url: t.url,
            description: t.url,
            favIconUrl: t.favIconUrl,
            type: 'tab',
            tabId: t.id,
            icon: t.favIconUrl || '🔵',
            category: 'Open Tab'
          }));

          sendResponse({ results: mapped });
        } catch (e) {
          console.error('[Background] SEARCH_TABS failed:', e);
          sendResponse({ results: [] });
        }
      })();
      return true;
    }

    if (msg?.type === 'SEARCH_HISTORY') {
      (async () => {
        try {
          const query = msg.query || '';
          const maxResults = msg.maxResults || 20;
          const historyItems = await chrome.history.search({ text: query, maxResults });

          const results = historyItems.map(h => ({
            id: `history_${h.id}`,
            title: h.title || h.url,
            url: h.url,
            description: h.url,
            type: 'history',
            icon: '📜',
            category: 'History',
            visitCount: h.visitCount,
            lastVisitTime: h.lastVisitTime
          }));

          sendResponse({ results });
        } catch (e) {
          console.error('[Background] SEARCH_HISTORY failed:', e);
          sendResponse({ results: [] });
        }
      })();
      return true;
    }

    if (msg?.type === 'SEARCH_BOOKMARKS') {
      (async () => {
        try {
          const query = msg.query || '';
          const maxResults = msg.maxResults || 20;
          const bookmarks = await chrome.bookmarks.search(query);

          const results = bookmarks.filter(b => b.url).slice(0, maxResults).map(b => ({
            id: b.id,
            title: b.title || b.url,
            url: b.url,
            description: b.url,
            type: 'bookmark',
            icon: '⭐',
            category: 'Bookmark'
          }));

          sendResponse({ results });
        } catch (e) {
          console.error('[Background] SEARCH_BOOKMARKS failed:', e);
          sendResponse({ results: [] });
        }
      })();
      return true;
    }

    if (msg?.type === 'GET_SPOTLIGHT_SUGGESTIONS') {
      console.log('[Background] GET_SPOTLIGHT_SUGGESTIONS received:', msg.query);

      // TEMP: Send dummy response for testing
      sendResponse({
        results: [
          { title: 'Test Result 1', description: 'Dummy result for: ' + msg.query, icon: '🔍', category: 'Test' },
          { title: 'Test Result 2', description: 'Another test item', icon: '⭐', category: 'Test' },
        ]
      });
      return true;
    }


    if (msg?.type === 'EXECUTE_COMMAND') {
      (async () => {
        try {
          const parsed = CommandParser.parse(msg.commandValue);
          if (parsed) {
            const result = await commandExecutor.execute(parsed);
            sendResponse({ success: true, result });
          } else {
            sendResponse({ success: false, error: 'Invalid command' });
          }
        } catch (e) {
          console.error('[Background] Command execution failed:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'JUMP_TO_TAB') {
      (async () => {
        try {
          console.log('[Background] JUMP_TO_TAB:', msg.tabId);
          // First activate the tab
          await chrome.tabs.update(msg.tabId, { active: true });
          // Then focus the window
          const tab = await chrome.tabs.get(msg.tabId);
          if (tab?.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
          console.log('[Background] JUMP_TO_TAB success');
          sendResponse({ success: true });
        } catch (e) {
          console.error('[Background] JUMP_TO_TAB failed:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'REBUILD_INDEX') {
      console.log('[Background] REBUILD_INDEX requested');
      forceIndexRebuild().then(() => {
        console.log('[Background] Index rebuild complete');
        sendResponse({ success: true });
      }).catch(e => {
        console.error('[Background] Index rebuild failed:', e);
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    // ============================================================================
    // TASK MANAGER MESSAGE HANDLERS - Task-First Tab Modeling
    // ============================================================================

    if (msg?.type === 'GET_ALL_TASKS') {
      (async () => {
        try {
          // Ensure task manager is initialized
          await initializeTaskManager();
          const tasks = getAllTasks();
          const activeTaskId = getActiveTaskId();
          console.log('[Background] GET_ALL_TASKS returning', tasks.length, 'tasks');
          sendResponse({ success: true, tasks, activeTaskId });
        } catch (e) {
          console.error('[Background] GET_ALL_TASKS error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'GET_TASK_FOR_TAB') {
      try {
        const task = getTaskForTab(msg.tabId);
        sendResponse({ success: true, task });
      } catch (e) {
        console.error('[Background] GET_TASK_FOR_TAB error:', e);
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (msg?.type === 'GET_TASK_BY_ID') {
      try {
        const task = getTaskById(msg.taskId);
        sendResponse({ success: true, task });
      } catch (e) {
        console.error('[Background] GET_TASK_BY_ID error:', e);
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (msg?.type === 'RENAME_TASK') {
      (async () => {
        try {
          const result = await renameTask(msg.taskId, msg.name);
          sendResponse({ success: result });
        } catch (e) {
          console.error('[Background] RENAME_TASK error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'MOVE_TAB_TO_TASK') {
      (async () => {
        try {
          const result = await moveTabToTask(msg.tabId, msg.taskId);
          sendResponse({ success: result });
        } catch (e) {
          console.error('[Background] MOVE_TAB_TO_TASK error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'MERGE_TASKS') {
      (async () => {
        try {
          const result = await mergeTasksInto(msg.sourceTaskId, msg.targetTaskId);
          sendResponse({ success: result });
        } catch (e) {
          console.error('[Background] MERGE_TASKS error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg?.type === 'AI_NAME_TASK') {
      (async () => {
        try {
          const task = getTaskById(msg.taskId);
          if (!task) {
            sendResponse({ success: false, error: 'Task not found' });
            return;
          }

          // Dynamically import localAIService to avoid circular dependencies
          const { nameTask } = await import('../services/localAIService.js');
          const name = await nameTask(task);

          if (name) {
            await renameTask(msg.taskId, name);
            await setTaskAiNamed(msg.taskId, true);
            sendResponse({ success: true, name });
          } else {
            sendResponse({ success: false, error: 'AI naming failed' });
          }
        } catch (e) {
          console.error('[Background] AI_NAME_TASK error:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }
  });

  // Handle connections from content scripts to keep service worker alive
  chrome.runtime.onConnect.addListener((port) => {
    console.log('[Background] Connection established:', port.name);

    if (port.name === 'keepalive') {
      // Keep a reference to the port to prevent service worker from sleeping
      let keepAliveTimer;

      const resetTimer = () => {
        if (keepAliveTimer) clearTimeout(keepAliveTimer);
        keepAliveTimer = setTimeout(() => {
          try {
            port.postMessage({ ping: true });
            console.log('[Background Debug] Sent keepalive ping');
          } catch (e) {
            console.warn('[Background Debug] Keepalive ping failed:', e);
          }
        }, 25000); // Disconnect after 25 seconds of inactivity
      };

      port.onMessage.addListener((msg) => {
        console.log('[Background Debug] Keepalive message:', msg);
        resetTimer();
      });

      port.onDisconnect.addListener(() => {
        console.log('[Background Debug] Keepalive disconnected');
        if (keepAliveTimer) clearTimeout(keepAliveTimer);
      });

      resetTimer();
    }
  });

  // Log storage readiness once
  chrome.storage.local.get(null).then(() => {
    console.log('[Background] Storage ready')
  })

  // Handle extension action clicks (toolbar icon) - this preserves user gesture
  if (chrome?.action?.onClicked) {
    chrome.action.onClicked.addListener(async (tab) => {
      console.log('[Background] Extension action clicked, opening side panel...');
      try {
        // Use the windowId from the active tab, not getCurrent() (same as working sample.js)
        const windowId = tab?.windowId;
        if (chrome?.sidePanel?.open && windowId) {
          console.log('[Background] Opening side panel for window:', windowId);
          await chrome.sidePanel.open({ windowId: windowId });
          console.log('[Background] Side panel opened from action click!');
        } else {
          console.log('[Background] Side panel API not available or no windowId, using tab fallback');
          const url = chrome.runtime.getURL('index.html');
          await chrome.tabs.create({ url });
        }
      } catch (e) {
        console.error('[Background] Failed to open side panel from action:', e);
        console.log('[Background] Error details:', e.message);
        // Fallback to tab
        try {
          const url = chrome.runtime.getURL('index.html');
          await chrome.tabs.create({ url });
          console.log('[Background] Opened in new tab as fallback');
        } catch (fallbackError) {
          console.error('[Background] Fallback to tab also failed:', fallbackError);
        }
      }
    });
  }

  // Consolidated keyboard shortcut handler is at the top of the file.


  // Use chrome.alarms for periodic tasks instead of setInterval
  // Daily cleanup alarm
  chrome.alarms.create('dailyCleanup', { periodInMinutes: 1440 }); // 24 hours

  // Listen for alarm events
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'dailyCleanup') {
      try {
        const stats = await getTimeSeriesStorageStats();
        // Always aggregate data older than 2 days into DAILY_ANALYTICS
        // This keeps ACTIVITY_SERIES lean while preserving historical data
        const deleted = await cleanupOldTimeSeriesData(2); // Aggregate & cleanup after 2 days
        console.log(`[Background] Daily cleanup: aggregated & removed ${deleted} old events, size: ${stats.estimatedSizeMB}MB`);
      } catch (e) {
        console.warn('[Background] Daily cleanup failed:', e);
      }
    }
  });



}

// ============================================================================
// CHROME TAB GROUPS - Auto-group tabs by domain
// ============================================================================

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];

// Extract domain from URL
function getDomainFromUrl(url) {
  try {
    if (!url) return null;

    // Skip system URLs
    if (url.startsWith('chrome://') || url.startsWith('about:') ||
      url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
      return null;
    }

    const urlObj = new URL(url);
    let domain = urlObj.hostname.replace('www.', '');

    // For localhost, include port
    if (domain === 'localhost' || domain === '127.0.0.1') {
      domain = `${domain}${urlObj.port ? ':' + urlObj.port : ''}`;
      return domain;
    }

    // Remove common TLDs for cleaner display
    domain = domain
      .replace(/\.com$/, '')
      .replace(/\.org$/, '')
      .replace(/\.net$/, '')
      .replace(/\.io$/, '')
      .replace(/\.dev$/, '')
      .replace(/\.ai$/, '')
      .replace(/\.co$/, '');

    return domain;
  } catch {
    return null;
  }
}

// Get color for domain based on hash
function getGroupColorForDomain(domain) {
  const hash = domain.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

// Auto-group all tabs by domain
async function autoGroupTabsByDomain() {
  try {
    const allTabs = await chrome.tabs.query({});
    const domainGroups = {};

    // Group tabs by domain
    for (const tab of allTabs) {
      const domain = getDomainFromUrl(tab.url);
      if (!domain) continue; // Skip system URLs

      const key = `${tab.windowId}_${domain}`;
      if (!domainGroups[key]) {
        domainGroups[key] = {
          domain,
          windowId: tab.windowId,
          tabIds: []
        };
      }
      domainGroups[key].tabIds.push(tab.id);
    }

    // Create groups for each domain
    for (const group of Object.values(domainGroups)) {
      if (group.tabIds.length < 2) continue; // Only group if 2+ tabs

      try {
        // Check if a group already exists for this domain
        const existingGroups = await chrome.tabGroups.query({
          windowId: group.windowId
        });

        let targetGroupId = null;
        for (const existingGroup of existingGroups) {
          if (existingGroup.title === group.domain) {
            targetGroupId = existingGroup.id;
            break;
          }
        }

        if (targetGroupId) {
          // Add tabs to existing group
          await chrome.tabs.group({
            tabIds: group.tabIds,
            groupId: targetGroupId
          });
        } else {
          // Create new group
          const groupId = await chrome.tabs.group({
            tabIds: group.tabIds
          });

          // Update group properties
          await chrome.tabGroups.update(groupId, {
            title: group.domain,
            color: getGroupColorForDomain(group.domain),
            collapsed: false
          });
        }

        console.log(`[TabGroups] Grouped ${group.tabIds.length} tabs for ${group.domain}`);
      } catch (error) {
        console.error(`[TabGroups] Failed to group ${group.domain}:`, error);
      }
    }

    return { success: true, grouped: Object.keys(domainGroups).length };
  } catch (error) {
    console.error('[TabGroups] Auto-group failed:', error);
    return { success: false, error: error.message };
  }
}

// Ungroup all tabs
async function ungroupAllTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const groupedTabs = allTabs.filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

    if (groupedTabs.length > 0) {
      const tabIds = groupedTabs.map(tab => tab.id);
      await chrome.tabs.ungroup(tabIds);
      console.log(`[TabGroups] Ungrouped ${tabIds.length} tabs`);
    }

    return { success: true, ungrouped: groupedTabs.length };
  } catch (error) {
    console.error('[TabGroups] Ungroup failed:', error);
    return { success: false, error: error.message };
  }
}

// Auto-group state
let autoGroupEnabled = false;

// Load auto-group state from storage
chrome.storage.local.get(['autoGroupEnabled'], (result) => {
  autoGroupEnabled = result.autoGroupEnabled || false;
  console.log('[TabGroups] Auto-group enabled:', autoGroupEnabled);

  // If enabled on startup, group existing tabs
  if (autoGroupEnabled) {
    autoGroupTabsByDomain();
  }
});

// Listen for tab creation and updates to auto-group
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!autoGroupEnabled) return;

  // Wait a bit for the URL to be set
  setTimeout(async () => {
    try {
      const updatedTab = await chrome.tabs.get(tab.id);
      const domain = getDomainFromUrl(updatedTab.url);
      if (!domain) return;

      // Find existing group for this domain
      const existingGroups = await chrome.tabGroups.query({
        windowId: updatedTab.windowId
      });

      let targetGroupId = null;
      for (const group of existingGroups) {
        if (group.title === domain) {
          targetGroupId = group.id;
          break;
        }
      }

      if (targetGroupId) {
        // Add to existing group
        await chrome.tabs.group({
          tabIds: [updatedTab.id],
          groupId: targetGroupId
        });
      } else {
        // Check if there are other tabs with same domain
        const allTabs = await chrome.tabs.query({ windowId: updatedTab.windowId });
        const sameDomainTabs = allTabs.filter(t => {
          const tDomain = getDomainFromUrl(t.url);
          return tDomain === domain && t.id !== updatedTab.id;
        });

        if (sameDomainTabs.length > 0) {
          // Create new group with this tab and others
          const tabIds = [updatedTab.id, ...sameDomainTabs.map(t => t.id)];
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, {
            title: domain,
            color: getGroupColorForDomain(domain),
            collapsed: false
          });
        }
      }
    } catch (error) {
      console.error('[TabGroups] Auto-group on create failed:', error);
    }
  }, 500);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!autoGroupEnabled) return;
  if (!changeInfo.url) return; // Only react to URL changes

  try {
    const domain = getDomainFromUrl(tab.url);
    if (!domain) return;

    // Find existing group for this domain
    const existingGroups = await chrome.tabGroups.query({
      windowId: tab.windowId
    });

    let targetGroupId = null;
    for (const group of existingGroups) {
      if (group.title === domain) {
        targetGroupId = group.id;
        break;
      }
    }

    if (targetGroupId && tab.groupId !== targetGroupId) {
      // Move to correct group
      await chrome.tabs.group({
        tabIds: [tabId],
        groupId: targetGroupId
      });
    } else if (!targetGroupId && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // Check if there are other tabs with same domain
      const allTabs = await chrome.tabs.query({ windowId: tab.windowId });
      const sameDomainTabs = allTabs.filter(t => {
        const tDomain = getDomainFromUrl(t.url);
        return tDomain === domain && t.id !== tabId;
      });

      if (sameDomainTabs.length > 0) {
        // Create new group
        const tabIds = [tabId, ...sameDomainTabs.map(t => t.id)];
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: domain,
          color: getGroupColorForDomain(domain),
          collapsed: false
        });
      }
    }
  } catch (error) {
    console.error('[TabGroups] Auto-group on update failed:', error);
  }
});

main()
  .then(() => {
    console.log('[Background] Main function executed successfully');
    console.log('[Background] Service worker is ready for connections');
  })
  .catch(e => {
    console.error('[Background] Main function failed:', e);
    console.error('[Background] Stack trace:', e.stack);
  });

// Calendar scraping logic removed as requested
