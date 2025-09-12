// MV3 background service worker (type: module)
import { cleanupOldTimeSeriesData, getTimeSeriesStorageStats, setupDatabase } from '../db/index.js';
import { storageGetWithTTL } from '../services/extensionApi.js';
import { populateAndStore } from './data.js';
// Modular background pieces - these initialize their own message handlers
import { initializeActivity } from './activity.js';
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

  // Initialize unified database system first
  console.log('[Background] Initializing database system...');
  try {
    const dbResult = await setupDatabase();
    if (dbResult.success) {
      console.log('[Background] ✅ Database system ready');
      if (dbResult.migrated) {
        console.log('[Background] ✅ Legacy data migrated successfully');
      }
    } else {
      console.error('[Background] ❌ Database initialization failed:', dbResult.error);
    }
  } catch (error) {
    console.error('[Background] ❌ Database setup error:', error);
  }

  // Initialize Data module
  initializeData();

  // Initialize Activity module
  initializeActivity();

  // Initialize Workspaces module
  initializeWorkspaces();

  chrome.runtime.onInstalled.addListener(async () => {
    console.log('[Background] Extension installed - populating data')
    try {
      await populateAndStore()

      // Initialize side panel settings on install
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

    // Keep service worker alive during message processing
    const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });
    const cleanup = () => {
      try {
        keepAlivePort.disconnect();
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

      (async () => {
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
            sendResponse({
              ok: true,
              dailyNotes: dailyData,
              date
            });
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

              if (dailyData && dailyData.selections.length > 0) {
                recentNotes.push(dailyData);
              }
            }

            sendResponse({
              ok: true,
              recentNotes,
              count: recentNotes.length
            });
          }
        } catch (e) {
          console.error('[Background] Error getting daily notes:', e);
          sendResponse({ ok: false, error: e?.message || 'Failed to get daily notes' });
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
      console.log('[Background] Updating daily notes content:', msg.date);

      (async () => {
        try {
          const { date, content } = msg;
          if (!date) throw new Error('Date is required');

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
          
          // Notify listeners about daily notes update
          try {
            const bc = new BroadcastChannel('ws_db_changes');
            bc.postMessage({ type: 'dailyNotesChanged', date });
            bc.close();
          } catch (e) {
            console.debug('[Background] BroadcastChannel not available for manual daily notes sync');
          }
          
          sendResponse({ ok: true, updated: true });
        } catch (e) {
          console.error('[Background] Error updating daily notes:', e);
          sendResponse({ ok: false, error: e?.message || 'Failed to update daily notes' });
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
      console.log('[Background] Message details:', { fromUserGesture: msg.fromUserGesture, timestamp: msg.timestamp });

      (async () => {
        try {
          const senderTab = sender?.tab;
          const windowId = senderTab?.windowId;

          // First attempt: Try to open side panel directly
          if (chrome?.sidePanel?.open && windowId) {
            try {
              console.log('[Background] Attempting to open side panel for window:', windowId);
              await chrome.sidePanel.open({ windowId });
              console.log('[Background] Side panel opened successfully!');
              sendResponse({ ok: true, method: 'sidePanel' });
              cleanup();
              return;
            } catch (sidePanelError) {
              console.log('[Background] Side panel open failed:', sidePanelError.message);
              // Continue to fallback methods below
            }
          } else {
            console.log('[Background] Side panel API not available or no windowId:', {
              hasSidePanel: !!chrome?.sidePanel?.open,
              windowId
            });
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
            port.disconnect();
          } catch { }
        }, 25000); // Disconnect after 25 seconds of inactivity
      };

      port.onMessage.addListener((msg) => {
        console.log('[Background] Keepalive message:', msg);
        resetTimer();
      });

      port.onDisconnect.addListener(() => {
        console.log('[Background] Keepalive disconnected');
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
        // Use the windowId from the active tab, not getCurrent()
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
