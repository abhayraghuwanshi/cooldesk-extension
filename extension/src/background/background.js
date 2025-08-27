// MV3 background service worker (type: module)
import { cleanupOldTimeSeriesData, getTimeSeriesStorageStats } from '../db.js';
import { storageGetWithTTL } from '../services/extensionApi.js';
import { populateAndStore } from './data.js';
// Modular background pieces - these initialize their own message handlers
import { initializeActivity } from './activity.js';
import { initializeAI } from './ai.js';
import { initializeData } from './data.js';
import { handleUrlNotesMessages } from './urlNotesHandler.js';
import { initializeWorkspaces } from './workspaces.js';

async function main() {
  console.log('[Background] Main function started');

  // Initialize AI module
  initializeAI();

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
      } catch {}
    };

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
          } catch {}
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
