// MV3 background service worker (type: module)

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

import { cleanupOldTimeSeriesData, getTimeSeriesStorageStats } from '../db/index.js';
import { DB_CONFIG, getUnifiedDB } from '../db/unified-db.js';
import { storageGetWithTTL } from '../services/extensionApi.js';
import { populateAndStore } from './data.js';
// Modular background pieces - these initialize their own message handlers
// NOTE: realTimeCategorizor is lazy-loaded to avoid window reference errors in service worker
import {
  handleActivityContentScriptMessage,
  handleCleanupTimeSeriesData,
  handleGetActivityData,
  handleGetTimeSeriesStats,
  initializeActivity
} from './activity.js';
import { initializeData } from './data.js';
import { handleUrlNotesMessages } from './urlNotesHandler.js';
import { initializeWorkspaces } from './workspaces.js';



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

  // Real-time categorization DISABLED - using scraping mechanism instead
  // The scraping mechanism is more reliable and doesn't interfere with other features
  console.log('[Background] Real-time categorization disabled (using scraping mechanism)');

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
        const { getUIState, saveUIState } = await import('../db/index.js');
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

        // Auto-cleanup if data is getting large (>50MB or >30 days)
        if (stats.estimatedSizeMB > 50 || stats.spanDays > 30) {
          const deleted = await cleanupOldTimeSeriesData(30); // Keep 30 days
          console.log(`[Background] Auto-cleanup: removed ${deleted} old events`);
        }
      } catch (e) {
        console.warn('[Background] Time series cleanup failed:', e);
      }
    } catch (e) {
      console.error('[Background] Error during onStartup:', e);
    }
  })

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[Background Debug] Received message:', msg);
    console.log('[Background Debug] Message sender:', sender);

    // Temporarily disable keepalive connection mechanism to prevent connection errors
    console.log('[Background Debug] Keepalive connection mechanism disabled to prevent connection errors');

    const cleanup = () => {
      try {
      } catch { }
    };


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
    // Skip activity handling for chat scraping messages
    if (msg.type && sender.tab && msg.type !== 'AUTO_SCRAPED_CHATS') {
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
            // Get notes for specific date
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
              dailyNotes: dailyData,
              date
            };
          } else {
            // Get recent daily notes from last N days
            const recentNotes = [];
            const today = new Date();

            for (let i = 0; i < limit; i++) {
              const checkDate = new Date(today);
              checkDate.setDate(today.getDate() - i);
              const dateStr = checkDate.toISOString().split('T')[0];

              const storageKey = `dailyNotes_${dateStr}`;
              const result = await chrome.storage.local.get([storageKey]);
              const dailyData = result[storageKey];

              if (dailyData && (dailyData.selections?.length > 0 || dailyData.content?.trim())) {
                recentNotes.push(dailyData);
              }
            }

            return {
              ok: true,
              recentNotes,
              count: recentNotes.length
            };
          }
        } catch (error) {
          console.error('[Background] Error in handleGetDailyNotes:', error);
          throw error;
        }
      };

      handleGetDailyNotes()
        .then(response => {
          console.log('[Background] Sending getDailyNotes response:', response);
          sendResponse(response);
        })
        .catch(error => {
          console.error('[Background] Error getting daily notes:', error);
          sendResponse({ ok: false, error: error?.message || 'Failed to get daily notes' });
        });

      return true; // Keep message channel open for async response
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

          const { getUnifiedDB, DB_CONFIG } = await import('../db/unified-db.js');
          const db = await getUnifiedDB();

          const tx = db.transaction([DB_CONFIG.STORES.UI_STATE], 'readonly');
          const store = tx.objectStore(DB_CONFIG.STORES.UI_STATE);
          const stateKey = `lastScrape_${platform}`;

          const state = await new Promise((resolve, reject) => {
            const request = store.get(stateKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });

          const timestamp = state?.timestamp || 0;
          console.log(`[Background] Last scrape time for ${platform}: ${timestamp ? new Date(timestamp).toLocaleString() : 'Never'}`);
          sendResponse({ timestamp });
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

          const { getUnifiedDB, DB_CONFIG } = await import('../db/unified-db.js');
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

            // Create a map of existing chat IDs
            const existingChatIds = new Set(existingChats.map(chat => chat.chatId));

            // Filter out chats that already exist
            const newChats = result.chats.filter(chat => !existingChatIds.has(chat.chatId));

            console.log(`[Background] Step 7: After deduplication: ${newChats.length} new chats (${result.chats.length - newChats.length} duplicates)`);

            if (newChats.length === 0) {
              console.log(`[Background] ℹ️ No new chats to store (all ${result.chats.length} already exist)`);
              return;
            }

            console.log(`[Background] Step 8: Storing ${newChats.length} new chats...`);

            // Store only new chats in IndexedDB
            const writeTx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS, DB_CONFIG.STORES.UI_STATE], 'readwrite');
            const writeStore = writeTx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

            for (const chat of newChats) {
              await new Promise((resolve, reject) => {
                const request = writeStore.put(chat);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
              });
            }

            // Update last scrape time in UI_STATE
            const uiStateStore = writeTx.objectStore(DB_CONFIG.STORES.UI_STATE);
            const stateKey = `lastScrape_${result.platform}`;
            await new Promise((resolve, reject) => {
              const request = uiStateStore.put({
                id: stateKey,
                timestamp: result.scrapedAt,
                platform: result.platform,
                updatedAt: Date.now()
              });
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });

            await new Promise((resolve, reject) => {
              writeTx.oncomplete = () => resolve();
              writeTx.onerror = () => reject(writeTx.error);
            });

            console.log(`[Background] ✅ Auto-stored ${newChats.length} new ${result.platform} chats (${result.chats.length - newChats.length} duplicates skipped)`);
          }
        } catch (error) {
          console.error('[Background] Error handling auto-scraped chats:', error);
        }
      })();
      return false; // No response needed for auto-scrape
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
            const { getUnifiedDB, DB_CONFIG } = await import('../db/unified-db.js');
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
      console.log('[Background] Getting scraped chats:', msg.data);
      (async () => {
        try {
          const { platform, limit, sortBy = 'scrapedAt' } = msg.data || {};

          // Import DB dynamically
          const { getUnifiedDB, DB_CONFIG } = await import('../db/unified-db.js');
          const db = await getUnifiedDB();

          const tx = db.transaction([DB_CONFIG.STORES.SCRAPED_CHATS], 'readonly');
          const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS);

          let chats = [];

          if (platform) {
            // Get chats for specific platform
            const index = store.index('by_platform');
            chats = await new Promise((resolve, reject) => {
              const request = index.getAll(platform);
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });
          } else {
            // Get all chats
            chats = await new Promise((resolve, reject) => {
              const request = store.getAll();
              request.onsuccess = () => resolve(request.result || []);
              request.onerror = () => reject(request.error);
            });
          }

          // Sort chats
          if (sortBy === 'scrapedAt') {
            chats.sort((a, b) => b.scrapedAt - a.scrapedAt); // Newest first
          } else if (sortBy === 'title') {
            chats.sort((a, b) => a.title.localeCompare(b.title));
          }

          // Apply limit if specified
          if (limit && limit > 0) {
            chats = chats.slice(0, limit);
          }

          // Group by platform for stats
          const byPlatform = {};
          chats.forEach(chat => {
            if (!byPlatform[chat.platform]) {
              byPlatform[chat.platform] = 0;
            }
            byPlatform[chat.platform]++;
          });

          console.log(`[Background] Retrieved ${chats.length} scraped chats`);

          sendResponse({
            success: true,
            chats,
            total: chats.length,
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
          const { getUnifiedDB, DB_CONFIG } = await import('../db/unified-db.js');
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
          const { getUnifiedDB, DB_CONFIG } = await import('../db/unified-db.js');
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
      console.log('[Background] Message details:', { fromUserGesture: msg.fromUserGesture, timestamp: msg.timestamp });

      (async () => {
        try {
          const senderTab = sender?.tab;
          let windowId = senderTab?.windowId;

          // First attempt: Try to open side panel directly (same as working sample.js)
          // 🚨 WORKING CODE - DO NOT ADD setOptions() calls here - they break functionality
          if (chrome?.sidePanel?.open && windowId) {
            try {
              console.log('[Background] Attempting to open side panel for window:', windowId);
              console.log('[Background] Side panel path:', chrome.runtime.getURL('index.html'));
              // ✅ This simple direct call works - DO NOT MODIFY
              await chrome.sidePanel.open({ windowId });
              console.log('[Background] Side panel opened successfully!');
              sendResponse({ ok: true, method: 'sidePanel' });
              cleanup();
              return;
            } catch (sidePanelError) {
              console.error('[Background] Side panel open failed:', sidePanelError);
              console.log('[Background] Error details:', {
                message: sidePanelError.message,
                stack: sidePanelError.stack
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
            const { listWorkspaces } = await import('../db/index.js');
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
  })

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

  // Keyboard shortcut command to open side panel and focus search
  try {
    if (chrome?.commands?.onCommand?.addListener) {
      chrome.commands.onCommand.addListener(async (command, tab) => {
        if (command !== 'open_search') return;
        try {
          console.log('[Background] Keyboard command triggered, opening side panel...');
          // Use the windowId from the active tab when available
          const windowId = tab?.windowId;

          if (chrome?.sidePanel?.setOptions) {
            await chrome.sidePanel.setOptions({ path: 'index.html', enabled: true });
          }

          if (chrome?.sidePanel?.open && windowId) {
            console.log('[Background] Opening side panel for window via command:', windowId);
            await chrome.sidePanel.open({ windowId: windowId });
            console.log('[Background] Side panel opened via keyboard shortcut!');
          } else {
            console.log('[Background] No windowId available, trying getCurrent()...');
            const win = await chrome.windows.getCurrent();
            if (win?.id) {
              await chrome.sidePanel.open({ windowId: win.id });
              console.log('[Background] Side panel opened via getCurrent()');
            } else {
              throw new Error('No valid window ID available');
            }
          }
        } catch (e) {
          console.warn('[Background] Failed to open side panel via command:', e);
          // Fallback: reuse existing extension tab if available; else create once
          try {
            const url = chrome.runtime.getURL('index.html');
            // Try to find an existing tab with our UI
            const existing = await chrome.tabs.query({ url });
            if (existing && existing.length > 0) {
              const tab = existing[0];
              try { await chrome.tabs.update(tab.id, { active: true }); } catch { }
              try {
                if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
              } catch { }
            } else {
              if (chrome?.tabs?.create) {
                await chrome.tabs.create({ url });
              }
            }
          } catch (e2) {
            console.warn('[Background] Fallback to tab failed:', e2);
          }
        }
        // Notify any open UI to focus the search input
        try { chrome.runtime.sendMessage({ action: 'focusSearch' }); } catch { }
      });
    }
  } catch (e) {
    console.warn('[Background] Could not register commands listener:', e);
  }

  setInterval(async () => {
    try {
      const stats = await getTimeSeriesStorageStats();
      if (stats.estimatedSizeMB > 25) { // Cleanup if >25MB
        const deleted = await cleanupOldTimeSeriesData(30);
        console.log(`[Background] Daily cleanup: removed ${deleted} old events, size: ${stats.estimatedSizeMB}MB`);
      }
    } catch (e) {
      console.warn('[Background] Daily cleanup failed:', e);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours

  // (Legacy devlink-ai migration code removed after successful migration)

}

main()
  .then(() => {
    console.log('[Background] Main function executed successfully');
    console.log('[Background] Service worker is ready for connections');
  })
  .catch(e => {
    console.error('[Background] Main function failed:', e);
    console.error('[Background] Stack trace:', e.stack);
  });
