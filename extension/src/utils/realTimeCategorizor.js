/**
 * Real-time URL categorization on tab changes
 */

import GenericUrlParser from './GenericUrlParser.js';
import { addUrlToWorkspace, listWorkspaces, saveWorkspace } from '../db';

/**
 * Set up real-time URL categorization
 * Listens to tab updates and categorizes URLs instantly
 */
// Cross-browser API detection
function getBrowserAPI() {
  // Chrome/Chromium
  if (typeof chrome !== 'undefined' && chrome?.tabs) {
    return chrome;
  }
  
  // Firefox/Mozilla
  if (typeof browser !== 'undefined' && browser?.tabs) {
    return browser;
  }
  
  // Edge Legacy
  if (typeof msBrowser !== 'undefined' && msBrowser?.tabs) {
    return msBrowser;
  }
  
  return null;
}

export function setupRealTimeCategorizor() {
  const browserAPI = getBrowserAPI();
  
  if (!browserAPI) {
    console.log('Real-time categorization requires WebExtension context (Chrome/Firefox/Edge)');
    return null;
  }
  
  console.log(`🌐 Using ${browserAPI === chrome ? 'Chrome' : browserAPI === browser ? 'Firefox' : 'Edge'} WebExtensions API`);

  let isSetup = false;

  const categorizeUrl = async (url, title = '') => {
    if (!url || GenericUrlParser.shouldExclude(url)) {
      return;
    }

    try {
      // Parse URL using new generic parser
      const parsed = GenericUrlParser.parse(url);
      if (!parsed) {
        console.log(`No platform detected for: ${url}`);
        return;
      }

      console.log(`🎯 Detected ${parsed.platform.name} URL: ${url}`, parsed);

      // Check if workspace already exists
      const existingWorkspaces = await listWorkspaces();
      const existingWorkspace = existingWorkspaces.find(ws => 
        ws.name?.toLowerCase() === parsed.workspace.toLowerCase()
      );

      if (!existingWorkspace) {
        // Create new workspace
        const workspace = {
          id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: parsed.workspace,
          description: `${parsed.platform.name} workspace`,
          createdAt: Date.now(),
          urls: [{
            url: parsed.url,
            title: parsed.title || title || url,
            addedAt: Date.now(),
            favicon: parsed.favicon
          }],
          context: {
            platform: parsed.platform,
            details: parsed.details,
            createdFrom: 'real_time',
            autoCreated: true
          }
        };

        await saveWorkspace(workspace);
        console.log(`✅ Created workspace: ${workspace.name}`);

        // Index URL
        await addUrlToWorkspace(url, workspace.id, {
          title: parsed.title || title || url,
          favicon: parsed.favicon,
          addedAt: Date.now()
        });

        // Broadcast change
        try {
          const bc = new BroadcastChannel('ws_db_changes');
          bc.postMessage({ type: 'workspacesChanged', realTime: true });
          bc.close();
        } catch (e) {
          console.warn('Failed to broadcast workspace change:', e);
        }
      } else {
        // Add URL to existing workspace
        try {
          await addUrlToWorkspace(url, existingWorkspace.id, {
            title: parsed.title || title || url,
            favicon: parsed.favicon,
            addedAt: Date.now()
          });
          console.log(`📎 Added URL to existing ${parsed.workspace} workspace`);
        } catch (indexError) {
          console.warn(`Failed to index URL to existing workspace:`, indexError);
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
    browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        categorizeUrl(tab.url, tab.title);
      }
    });

    // Listen to tab activation (when switching tabs)
    browserAPI.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await browserAPI.tabs.get(activeInfo.tabId);
        if (tab.url) {
          categorizeUrl(tab.url, tab.title);
        }
      } catch (e) {
        // Tab might be closed already
      }
    });

    // Listen to new tabs
    browserAPI.tabs.onCreated.addListener((tab) => {
      if (tab.url && !isInternalUrl(tab.url)) {
        categorizeUrl(tab.url, tab.title);
      }
    });

    console.log('🚀 Real-time URL categorization enabled');
  };

  // Helper function to detect internal/system URLs across browsers
  function isInternalUrl(url) {
    if (!url) return true;
    
    const internalPatterns = [
      /^chrome:\/\//,      // Chrome internal pages
      /^chrome-extension:\/\//, // Chrome extensions  
      /^moz-extension:\/\//, // Firefox extensions
      /^about:/,           // Firefox about pages
      /^edge:\/\//,        // Edge internal pages
      /^extension:\/\//,   // Generic extension protocol
      /^resource:\/\//,    // Firefox resource protocol
      /^data:/,            // Data URLs
      /^javascript:/       // JavaScript URLs
    ];
    
    return internalPatterns.some(pattern => pattern.test(url));
  }

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
  const browserAPI = getBrowserAPI();
  
  if (!browserAPI) {
    console.warn('Browser tabs API not available');
    return false;
  }

  try {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !GenericUrlParser.shouldExclude(tab.url)) {
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

// Auto-setup when module loads in any WebExtension context
const browserAPI = getBrowserAPI();
if (browserAPI) {
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