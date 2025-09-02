/**
 * Real-time URL categorization on tab changes
 */

import { createWorkspaceFromSingleUrl } from './workspaceAutoCreator.js';
import { listWorkspaces, addUrlToWorkspace } from '../db.js';
import { detectProject } from './projectCategories.js';

/**
 * Set up real-time URL categorization
 * Listens to tab updates and categorizes URLs instantly
 */
export function setupRealTimeCategorizor() {
  // Only works in extension context
  if (typeof chrome === 'undefined' || !chrome?.tabs) {
    console.log('⚠️ Real-time categorization requires extension context');
    return null;
  }

  let isSetup = false;

  const categorizeUrl = async (url, title = '') => {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      return;
    }

    try {
      // First check if this URL matches any platform patterns
      const detection = detectProject(url);
      if (!detection) {
        console.log(`ℹ️ No platform detected for: ${url}`);
        return;
      }

      console.log(`🎯 Detected ${detection.categoryName} URL: ${url}`, detection);

      // Try to create/update workspace for this URL
      const existingWorkspaces = await listWorkspaces();
      const workspace = await createWorkspaceFromSingleUrl(url, existingWorkspaces);

      if (workspace) {
        console.log(`✅ Created workspace: ${workspace.name}`);
        
        // Notify other parts of the app about the new workspace
        try {
          const bc = new BroadcastChannel('ws_db_changes');
          bc.postMessage({ type: 'workspacesChanged', realTime: true });
          bc.close();
        } catch (e) {
          console.warn('Failed to broadcast workspace change:', e);
        }
      } else {
        // Workspace already exists, but still index this URL to it
        const platformWorkspace = existingWorkspaces.find(ws => ws.name === detection.categoryName);
        if (platformWorkspace) {
          try {
            await addUrlToWorkspace(url, platformWorkspace.id, {
              title: title || url,
              addedAt: Date.now()
            });
            console.log(`📝 Indexed URL to existing ${detection.categoryName} workspace`);
          } catch (indexError) {
            console.warn(`⚠️ Failed to index URL to existing workspace:`, indexError);
          }
        } else {
          console.log(`📝 Added to existing ${detection.categoryName} workspace`);
        }
      }

    } catch (error) {
      console.error('Error in real-time categorization:', error);
    }
  };

  const setupListeners = () => {
    if (isSetup) return;
    isSetup = true;

    // Listen to tab updates (when URL changes)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        categorizeUrl(tab.url, tab.title);
      }
    });

    // Listen to tab activation (when switching tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url) {
          categorizeUrl(tab.url, tab.title);
        }
      } catch (e) {
        // Tab might be closed already
      }
    });

    // Listen to new tabs
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.url && !tab.url.startsWith('chrome://')) {
        categorizeUrl(tab.url, tab.title);
      }
    });

    console.log('🚀 Real-time URL categorization enabled');
  };

  return {
    enable: setupListeners,
    categorizeNow: categorizeUrl,
    isSetup: () => isSetup
  };
}

/**
 * Categorize current active tab immediately
 */
export async function categorizeCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const categorizer = setupRealTimeCategorizor();
      await categorizer.categorizeNow(tab.url, tab.title);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to categorize current tab:', error);
    return false;
  }
}

// Auto-setup when module loads in extension context
if (typeof chrome !== 'undefined' && chrome?.tabs) {
  const categorizer = setupRealTimeCategorizor();
  // Auto-enable after short delay to avoid setup conflicts
  setTimeout(() => {
    try {
      categorizer?.enable();
    } catch (e) {
      console.warn('Failed to auto-enable real-time categorization:', e);
    }
  }, 1000);
}

// Export for console usage
if (typeof window !== 'undefined') {
  window.realTimeCategorizor = {
    setup: setupRealTimeCategorizor,
    categorizeNow: categorizeCurrentTab
  };
}