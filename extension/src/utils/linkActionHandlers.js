import { deletePing, listPings, upsertPing } from '../db/index.js';
import { enqueueOpenInChrome } from '../services/extensionApi.js';
import { getFaviconUrl } from '../utils.js';

/**
 * Pin/Unpin a URL
 * @param {string} url - The URL to pin/unpin
 * @param {string} title - The title of the page
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export async function handlePinAction(url, title, onSuccess, onError) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    // Check if already pinned
    const existingPings = await listPings();
    const pingsData = existingPings?.data || existingPings || [];
    const existingPin = Array.isArray(pingsData) ? pingsData.find(p => p.url === url) : null;

    if (existingPin) {
      // Unpin
      await deletePing(url);
      onSuccess?.({ action: 'unpinned', url, title });
    } else {
      // Pin
      const ping = {
        id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: title || (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return url;
          }
        })(),
        favicon: getFaviconUrl(url, 64),
        createdAt: Date.now(),
      };
      await upsertPing(ping);
      onSuccess?.({ action: 'pinned', url, title });
    }
  } catch (error) {
    console.error('[LinkActionHandlers] Pin action error:', error);
    onError?.(error);
  }
}

/**
 * Add URL to workspace
 * @param {string} url - The URL to add
 * @param {string} title - The title of the page
 * @param {Function} onOpenModal - Callback to open workspace selection modal
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export async function handleAddToWorkspaceAction(url, title, onOpenModal, onSuccess, onError) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    // Open workspace selection modal
    if (onOpenModal) {
      onOpenModal(url, title);
      onSuccess?.({ action: 'workspace_modal_opened', url, title });
    } else {
      throw new Error('Workspace modal handler not provided');
    }
  } catch (error) {
    console.error('[LinkActionHandlers] Add to workspace error:', error);
    onError?.(error);
  }
}

/**
 * Delete a URL/link
 * @param {string} url - The URL to delete
 * @param {Function} onConfirm - Confirmation callback that returns true/false
 * @param {Function} onDelete - Delete callback function
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export async function handleDeleteAction(url, onConfirm, onDelete, onSuccess, onError) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    // Confirm deletion
    const confirmed = onConfirm ? await onConfirm(url) : true;
    if (!confirmed) {
      return;
    }

    // Perform deletion
    if (onDelete) {
      await onDelete(url);
      onSuccess?.({ action: 'deleted', url });
    } else {
      throw new Error('Delete handler not provided');
    }
  } catch (error) {
    console.error('[LinkActionHandlers] Delete action error:', error);
    onError?.(error);
  }
}

/**
 * Open URL in browser
 * @param {string} url - The URL to open
 * @param {Array} tabs - Current tabs array (for focusing existing tab)
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export async function handleOpenAction(url, tabs = [], onSuccess, onError) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    // Check if tab already exists and focus it
    let match = null;
    try {
      const target = new URL(url).href;
      match = tabs.find(t => {
        try {
          return t.url && new URL(t.url).href === target;
        } catch {
          return false;
        }
      }) || null;
    } catch {
      // URL parsing failed, proceed with opening new tab
    }

    const hasTabsApi = typeof chrome !== 'undefined' && chrome?.tabs?.create;

    if (match && chrome?.tabs?.update) {
      // Focus existing tab
      chrome.tabs.update(match.id, { active: true });
      if (match.windowId != null && chrome?.windows?.update) {
        chrome.windows.update(match.windowId, { focused: true });
      }
      onSuccess?.({ action: 'focused_existing', url, tabId: match.id });
    } else if (hasTabsApi) {
      // Create new tab
      if (chrome?.tabs?.update) {
        chrome.tabs.update({ url });
      } else if (chrome?.tabs?.create) {
        chrome.tabs.create({ url });
      }
      onSuccess?.({ action: 'opened_new', url });
    } else {
      // Electron: use extension bridge
      await enqueueOpenInChrome(url);
      onSuccess?.({ action: 'opened_electron', url });
    }
  } catch (error) {
    console.error('[LinkActionHandlers] Open action error:', error);
    onError?.(error);
  }
}

/**
 * Get or create the "CoolDesk" bookmarks folder
 * @returns {Promise<string>} The folder ID
 */
async function getOrCreateCoolDeskFolder() {
  try {
    // Search for existing "CoolDesk" folder
    const bookmarks = await chrome.bookmarks.getTree();

    const findCoolDeskFolder = (nodes) => {
      for (const node of nodes) {
        // Check if this is the CoolDesk folder
        if (node.title === 'CoolDesk' && !node.url) {
          return node.id;
        }
        // Recursively search children
        if (node.children) {
          const found = findCoolDeskFolder(node.children);
          if (found) return found;
        }
      }
      return null;
    };

    let folderId = findCoolDeskFolder(bookmarks);

    // If folder doesn't exist, create it in the "Other Bookmarks" folder
    if (!folderId) {
      // Find "Other Bookmarks" folder (usually id "2")
      const otherBookmarks = bookmarks[0]?.children?.find(node =>
        node.title === 'Other Bookmarks' || node.id === '2'
      );

      const parentId = otherBookmarks?.id || '1'; // Fallback to bookmarks bar

      const folder = await chrome.bookmarks.create({
        parentId: parentId,
        title: 'CoolDesk'
      });

      folderId = folder.id;
      console.log('[CoolDesk] Created bookmarks folder:', folderId);
    }

    return folderId;
  } catch (error) {
    console.error('[CoolDesk] Error getting/creating folder:', error);
    // Fallback to bookmarks bar if folder creation fails
    return '1';
  }
}

/**
 * Add URL to browser bookmarks in CoolDesk folder
 * @param {string} url - The URL to bookmark
 * @param {string} title - The title of the page
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export async function handleAddToBookmarksAction(url, title, onSuccess, onError) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    const hasBookmarksApi = typeof chrome !== 'undefined' && chrome?.bookmarks?.create;

    if (hasBookmarksApi) {
      // Get or create the CoolDesk folder
      const coolDeskFolderId = await getOrCreateCoolDeskFolder();

      // Create bookmark in the CoolDesk folder
      const bookmark = await chrome.bookmarks.create({
        parentId: coolDeskFolderId,
        title: title || url,
        url: url
      });

      console.log('[CoolDesk] Bookmark created in CoolDesk folder:', bookmark);
      onSuccess?.({ action: 'bookmarked', url, title, bookmarkId: bookmark.id, folderId: coolDeskFolderId });
    } else {
      throw new Error('Bookmarks API not available');
    }
  } catch (error) {
    console.error('[LinkActionHandlers] Add to bookmarks error:', error);
    onError?.(error);
  }
}

/**
 * Check if a URL is pinned
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>} True if pinned, false otherwise
 */
export async function isUrlPinned(url) {
  try {
    if (!url) return false;

    const existingPings = await listPings();
    const pingsData = existingPings?.data || existingPings || [];
    const existingPin = Array.isArray(pingsData) ? pingsData.find(p => p.url === url) : null;

    return Boolean(existingPin);
  } catch (error) {
    console.error('[LinkActionHandlers] Error checking pin status:', error);
    return false;
  }
}

/**
 * Default confirmation dialog for deletions
 * @param {string} url - The URL being deleted
 * @returns {boolean} True if confirmed, false otherwise
 */
export function defaultDeleteConfirmation(url) {
  try {
    const hostname = new URL(url).hostname;
    return confirm(`Are you sure you want to delete this link from ${hostname}?`);
  } catch {
    return confirm('Are you sure you want to delete this link?');
  }
}

/**
 * Create a complete set of link action handlers for a component
 * @param {Object} options - Configuration options
 * @returns {Object} Object containing all action handlers
 */
export function createLinkActionHandlers({
  tabs = [],
  onWorkspaceModalOpen,
  onDeleteConfirm = defaultDeleteConfirmation,
  onDeleteAction,
  onSuccess,
  onError
} = {}) {
  return {
    handlePin: (url, title) => handlePinAction(url, title, onSuccess, onError),
    handleAddToWorkspace: (url, title) => handleAddToWorkspaceAction(url, title, onWorkspaceModalOpen, onSuccess, onError),
    handleDelete: (url) => handleDeleteAction(url, onDeleteConfirm, onDeleteAction, onSuccess, onError),
    handleOpen: (url) => handleOpenAction(url, tabs, onSuccess, onError),
    handleAddToBookmarks: (url, title) => handleAddToBookmarksAction(url, title, onSuccess, onError),
    isUrlPinned
  };
}