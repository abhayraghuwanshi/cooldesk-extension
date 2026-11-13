// Background script handler for URL notes functionality
import { deleteUrlNote, getUrlNotes, saveUrlNote } from '../db/index.js';

// URL notes messages from the content script's in-page note pop-ups
// (interactionContent.js). The old injected notes panels (toggleUrlNotes,
// openFullUrlNotes) and the screenshot / selected-text / count actions were
// never wired to anything and are gone.
export function handleUrlNotesMessages(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') return false;

  switch (message.action) {
    case 'getUrlNotes':
      handleGetUrlNotes(message, sendResponse);
      return true;

    case 'saveUrlNote':
      handleSaveUrlNote(message, sendResponse);
      return true;

    case 'deleteUrlNote':
      handleDeleteUrlNote(message, sendResponse);
      return true;

    case 'scrapedLinks':
      handleScrapedLinks(message, sendResponse);
      return true;

    case 'addUrlToWorkspace':
      handleAddUrlToWorkspace(message, sendResponse);
      return true;

    default:
      return false;
  }
}

// Handle scraped links from context menu
async function handleScrapedLinks(message, sendResponse) {
  try {
    const { pageUrl, pageTitle, links, scrapedAt } = message.data || {};
    console.log('[Background] Scraped links received:', links?.length, 'from', pageUrl);

    // Store scraped links in storage for later use
    const scrapedData = {
      pageUrl,
      pageTitle,
      links: links || [],
      scrapedAt: scrapedAt || Date.now()
    };

    // Get existing scraped data
    const stored = await chrome.storage.local.get('scrapedLinks');
    const allScraped = stored.scrapedLinks || [];

    // Add new scraped data (limit to last 50 pages)
    allScraped.unshift(scrapedData);
    if (allScraped.length > 50) allScraped.pop();

    await chrome.storage.local.set({ scrapedLinks: allScraped });

    sendResponse({ success: true, count: links?.length || 0 });
  } catch (error) {
    console.error('[Background] Failed to handle scraped links:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle add URL to workspace from context menu
async function handleAddUrlToWorkspace(message, sendResponse) {
  try {
    const { url, title, favicon } = message.data || {};
    console.log('[Background] Add to workspace request:', url);

    // Store pending URL for workspace assignment
    await chrome.storage.local.set({
      pendingWorkspaceUrl: {
        url,
        title,
        favicon,
        addedAt: Date.now()
      }
    });

    // For now, just acknowledge - user will assign workspace in CoolDesk UI
    sendResponse({ success: true, message: 'Open CoolDesk to assign workspace' });
  } catch (error) {
    console.error('[Background] Failed to handle add to workspace:', error);
    sendResponse({ success: false, error: error.message });
  }
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
    console.log('[Background Debug] Getting URL notes for:', message.url);
    const result = await getUrlNotes(message.url);
    const notes = result.success ? result.data : [];
    console.log('[Background Debug] Raw notes from DB:', JSON.stringify(notes));
    console.log('[Background Debug] Is array?', Array.isArray(notes));
    console.log('[Background Debug] Found', notes?.length || 0, 'URL notes');
    sendResponse({
      success: true,
      notes: notes || []
    });
  } catch (error) {
    console.error('[Background Debug] Failed to get URL notes:', error);
    sendResponse({
      success: false,
      notes: [],
      error: error.message
    });
  }
}

// Delete URL note
async function handleDeleteUrlNote(message, sendResponse) {
  try {
    console.log('[Background Debug] Deleting URL note:', message.noteId);
    await deleteUrlNote(message.noteId);

    // Notify content script to refresh notes count
    if (message.tabId) {
      try {
        await chrome.tabs.sendMessage(message.tabId, { action: 'refreshNotesCount' });
      } catch (tabError) {
        console.warn('[Background Debug] Failed to notify tab of deletion:', tabError);
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background Debug] Failed to delete URL note:', error);
    sendResponse({ success: false, error: error.message });
  }
}



// Enhanced AI enrichment with URL notes context
export async function enrichWithUrlNotes(url, aiData) {
  try {
    const result = await getUrlNotes(url);
    const urlNotes = result.success ? result.data : [];
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
        `${aiData.description}\n\nUser Notes: ${urlNotes.length} notes including ${notesContext.hasVoiceNotes ? 'voice recordings, ' : ''
          }${notesContext.hasScreenshots ? 'screenshots, ' : ''
          }${notesContext.hasTextNotes ? 'text notes' : ''}`.trim() :
        aiData.description
    };
  } catch (error) {
    console.error('Failed to enrich with URL notes:', error);
    return aiData;
  }
}
