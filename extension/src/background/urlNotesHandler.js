// Background script handler for URL notes functionality
import { getUrlNotes, saveUrlNote, deleteUrlNote, getAllUrlNotes } from '../db.js';

// Handle URL notes related messages
export function handleUrlNotesMessages(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') return false;

  // Handle footer bar URL notes toggle
  if (message.action === 'toggleUrlNotes') {
    (async () => {
      try {
        // Inject URL notes functionality into the current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              // Create URL notes panel if it doesn't exist
              if (!document.getElementById('cooldesk-url-notes-panel')) {
                const panel = document.createElement('div');
                panel.id = 'cooldesk-url-notes-panel';
                panel.style.cssText = `
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  width: 90vw;
                  max-width: 600px;
                  height: 70vh;
                  background: rgba(10, 14, 22, 0.98);
                  border: 1px solid #273043;
                  border-radius: 12px;
                  box-shadow: 0 20px 40px rgba(0,0,0,0.5);
                  z-index: 2147483646;
                  padding: 20px;
                  color: #e5e7eb;
                  font-family: system-ui, -apple-system, sans-serif;
                `;
                
                panel.innerHTML = `
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0; color: #10b981;">📝 URL Notes</h3>
                    <button id="close-url-notes" style="background: #374151; border: 1px solid #4b5563; color: #e5e7eb; padding: 8px 12px; border-radius: 6px; cursor: pointer;">Close</button>
                  </div>
                  <div style="background: #1f2937; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="font-size: 14px; color: #9ca3af; margin-bottom: 5px;">Current URL:</div>
                    <div style="font-size: 12px; color: #d1d5db; word-break: break-all;">${window.location.href}</div>
                  </div>
                  <div style="text-align: center; color: #9ca3af; margin-top: 40px;">
                    URL Notes functionality is loading...<br>
                    <small>This feature integrates with your Cool-Desk extension</small>
                  </div>
                `;
                
                document.body.appendChild(panel);
                
                // Close button functionality
                document.getElementById('close-url-notes').addEventListener('click', () => {
                  panel.remove();
                });
                
                // Close on escape key
                const escapeHandler = (e) => {
                  if (e.key === 'Escape') {
                    panel.remove();
                    document.removeEventListener('keydown', escapeHandler);
                  }
                };
                document.addEventListener('keydown', escapeHandler);
              } else {
                // Toggle existing panel
                const panel = document.getElementById('cooldesk-url-notes-panel');
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
              }
            }
          });
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('Failed to toggle URL notes:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle screenshot capture
  if (message.action === 'captureScreenshot') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }

        const screenshot = await chrome.tabs.captureVisibleTab(tabs[0].windowId, {
          format: 'png',
          quality: 90
        });

        sendResponse({ 
          success: true, 
          screenshot: screenshot,
          url: message.url,
          title: message.title
        });
      } catch (error) {
        console.error('Screenshot capture failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle get URL notes (full notes data)
  if (message.action === 'getUrlNotes') {
    (async () => {
      try {
        const urlNotes = await getUrlNotes(message.url);
        sendResponse({ 
          success: true, 
          notes: urlNotes || []
        });
      } catch (error) {
        console.error('Failed to get URL notes:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle open full URL notes panel
  if (message.action === 'openFullUrlNotes') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (url, title) => {
              // Remove existing full panel if any
              const existingPanel = document.getElementById('cooldesk-full-url-notes-panel');
              if (existingPanel) {
                existingPanel.remove();
                return;
              }

              // Create full URL notes panel (similar to UrlNotesSection component)
              const panel = document.createElement('div');
              panel.id = 'cooldesk-full-url-notes-panel';
              panel.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(26, 26, 26, 0.98); z-index: 2147483647;
                display: flex; flex-direction: column;
                font-family: system-ui, -apple-system, sans-serif;
              `;
              
              panel.innerHTML = `
                <div style="padding: 20px; border-bottom: 1px solid #333; background: #2a2a2a; display: flex; justify-content: space-between; align-items: center;">
                  <h2 style="margin: 0; color: #10b981; font-size: 18px;">📝 URL Notes - ${new URL(url).hostname}</h2>
                  <button id="close-full-notes" style="background: #dc2626; border: none; color: white; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    Close
                  </button>
                </div>
                <div style="flex: 1; padding: 20px; overflow-y: auto; color: #e5e7eb;">
                  <div style="text-align: center; color: #9ca3af; margin-top: 50px;">
                    Loading full URL notes interface...<br>
                    <small>This will show the complete UrlNotesSection component</small>
                  </div>
                </div>
              `;
              
              document.body.appendChild(panel);
              
              // Close functionality
              panel.querySelector('#close-full-notes').addEventListener('click', () => {
                panel.remove();
              });
              
              // Close on escape
              const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                  panel.remove();
                  document.removeEventListener('keydown', escapeHandler);
                }
              };
              document.addEventListener('keydown', escapeHandler);
            },
            args: [message.url, message.title]
          });
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('Failed to open full URL notes:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  switch (message.action) {
    case 'getUrlNotesCount':
      handleGetUrlNotesCount(message, sendResponse);
      return true; // Keep message channel open for async response

    case 'openUrlNotes':
      handleOpenUrlNotes(message, sender);
      break;

    case 'closeUrlNotes':
      handleCloseUrlNotes(message, sender);
      break;

    case 'saveUrlNote':
      handleSaveUrlNote(message, sendResponse);
      return true;

    case 'getUrlNotes':
      handleGetUrlNotes(message, sendResponse);
      return true;

    case 'deleteUrlNote':
      handleDeleteUrlNote(message, sendResponse);
      return true;

    case 'captureScreenshot':
      handleCaptureScreenshot(message, sendResponse);
      return true;

    case 'getSelectedText':
      handleGetSelectedText(message, sender, sendResponse);
      return true;
  }
}

// Get notes count for a URL
async function handleGetUrlNotesCount(message, sendResponse) {
  try {
    console.log('[Background Debug] Getting notes count for URL:', message.url);
    const notes = await getUrlNotes(message.url);
    console.log('[Background Debug] Notes retrieved:', notes.length, 'notes');
    if (notes.length > 0) {
      console.log('[Background Debug] Sample note IDs:', notes.slice(0, 3).map(n => n.id));
    }
    sendResponse({ count: notes.length });
  } catch (error) {
    console.error('[Background Debug] Failed to get URL notes count:', error);
    sendResponse({ count: 0 });
  }
}

// Open URL notes panel (could trigger popup or side panel)
function handleOpenUrlNotes(message, sender) {
  // Store current context for the notes panel
  chrome.storage.local.set({
    urlNotesContext: {
      url: message.url,
      title: message.title,
      selectedText: message.selectedText,
      tabId: sender.tab?.id
    }
  });

  // Could open a popup or side panel here
  // For now, we'll just store the context
}

// Close URL notes panel
function handleCloseUrlNotes(message, sender) {
  chrome.storage.local.remove('urlNotesContext');
}

// Save a URL note
async function handleSaveUrlNote(message, sendResponse) {
  try {
    console.log('[Background Debug] Saving URL note:', message.note);
    const result = await saveUrlNote(message.note);
    console.log('[Background Debug] Save result:', result);
    
    // Notify content script to refresh notes count
    if (message.tabId) {
      chrome.tabs.sendMessage(message.tabId, { action: 'refreshNotesCount' });
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background Debug] Failed to save URL note:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get URL notes
async function handleGetUrlNotes(message, sendResponse) {
  try {
    const notes = await getUrlNotes(message.url);
    sendResponse({ notes });
  } catch (error) {
    console.error('Failed to get URL notes:', error);
    sendResponse({ notes: [] });
  }
}

// Delete URL note
async function handleDeleteUrlNote(message, sendResponse) {
  try {
    await deleteUrlNote(message.noteId);
    
    // Notify content script to refresh notes count
    if (message.tabId) {
      chrome.tabs.sendMessage(message.tabId, { action: 'refreshNotesCount' });
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Failed to delete URL note:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Capture screenshot of current tab
async function handleCaptureScreenshot(message, sendResponse) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { 
      format: 'png', 
      quality: 90 
    });
    
    const base64Data = dataUrl.split(',')[1];
    sendResponse({ success: true, imageData: base64Data });
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get selected text from active tab
async function handleGetSelectedText(message, sender, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      sendResponse({ selectedText: null });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (!selectedText) return null;

        // Get context around selection
        let context = '';
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          const parentElement = container.nodeType === Node.TEXT_NODE ? 
            container.parentElement : container;
          context = parentElement ? parentElement.textContent.trim() : '';
        }

        return {
          text: selectedText,
          context: context.substring(0, 300),
          url: window.location.href,
          title: document.title
        };
      }
    });

    const selectedText = results?.[0]?.result;
    sendResponse({ selectedText });
  } catch (error) {
    console.error('Failed to get selected text:', error);
    sendResponse({ selectedText: null });
  }
}

// Enhanced AI enrichment with URL notes context
export async function enrichWithUrlNotes(url, aiData) {
  try {
    const urlNotes = await getUrlNotes(url);
    if (!urlNotes || urlNotes.length === 0) return aiData;

    // Add URL notes context to AI enrichment
    const notesContext = {
      count: urlNotes.length,
      hasVoiceNotes: urlNotes.some(n => n.type === 'voice'),
      hasScreenshots: urlNotes.some(n => n.type === 'screenshot'),
      hasTextNotes: urlNotes.some(n => n.type === 'text'),
      recentNotes: urlNotes.slice(0, 3).map(n => ({
        type: n.type,
        text: n.text || n.description,
        selectedText: n.selectedText,
        createdAt: n.createdAt
      }))
    };

    return {
      ...aiData,
      urlNotesContext: notesContext,
      // Add notes summary to AI description if available
      notesEnhancedDescription: aiData.description ? 
        `${aiData.description}\n\nUser Notes: ${urlNotes.length} notes including ${
          notesContext.hasVoiceNotes ? 'voice recordings, ' : ''
        }${notesContext.hasScreenshots ? 'screenshots, ' : ''
        }${notesContext.hasTextNotes ? 'text notes' : ''}`.trim() : 
        aiData.description
    };
  } catch (error) {
    console.error('Failed to enrich with URL notes:', error);
    return aiData;
  }
}
