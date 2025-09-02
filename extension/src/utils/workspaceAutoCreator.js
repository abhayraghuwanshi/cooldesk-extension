/**
 * Workspace Auto-Creator
 * Integrates URL pattern detection with database operations
 */

import { 
  createWorkspacesFromUrls, 
  createWorkspaceFromSingleUrl as createWorkspaceFromSingleUrlBase,
  getSuggestedWorkspaceFromCurrentTab 
} from './projectCategories.js';
import { listWorkspaces, saveWorkspace, addUrlToWorkspace } from '../db.js';

/**
 * Auto-create workspaces from browser history/bookmarks
 * @param {Array} browserUrls - Array of URL strings from browser
 * @returns {Promise<Array>} - Array of created workspace objects
 */
export async function autoCreateWorkspacesFromUrls(browserUrls) {
  if (!Array.isArray(browserUrls) || browserUrls.length === 0) {
    return [];
  }

  try {
    const existingWorkspaces = await listWorkspaces();
    const workspacesToCreate = createWorkspacesFromUrls(browserUrls, existingWorkspaces);
    
    console.log(`🔍 Found ${workspacesToCreate.length} workspaces to create from ${browserUrls.length} URLs`);
    if (workspacesToCreate.length > 0) {
      console.log('📋 Workspaces to create:', workspacesToCreate.map(w => `${w.name} (${w.urls?.length || 0} URLs)`));
    }
    
    const createdWorkspaces = [];
    
    for (const workspace of workspacesToCreate) {
      try {
        // Add required fields for database
        const workspaceWithDefaults = {
          id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          ...workspace
        };
        
        await saveWorkspace(workspaceWithDefaults);
        createdWorkspaces.push(workspaceWithDefaults);
        
        // Index all URLs in the workspace to the URL store
        if (Array.isArray(workspace.urls)) {
          for (const urlObj of workspace.urls) {
            try {
              await addUrlToWorkspace(urlObj.url, workspaceWithDefaults.id, {
                title: urlObj.title,
                favicon: urlObj.favicon,
                addedAt: urlObj.addedAt || Date.now()
              });
            } catch (urlError) {
              console.warn(`⚠️ Failed to index URL ${urlObj.url} for workspace ${workspaceWithDefaults.name}:`, urlError);
            }
          }
        }
        
        console.log(`✅ Created workspace: ${workspaceWithDefaults.name} with ${workspace.urls?.length || 0} URLs indexed`);
      } catch (error) {
        console.error(`❌ Failed to create workspace ${workspace.name}:`, error);
      }
    }
    
    return createdWorkspaces;
  } catch (error) {
    console.error('Error in autoCreateWorkspacesFromUrls:', error);
    return [];
  }
}

/**
 * Create workspace from current active tab
 * @param {string} currentTabUrl - Current browser tab URL
 * @returns {Promise<Object|null>} - Created workspace or null
 */
export async function createWorkspaceFromCurrentTab(currentTabUrl) {
  if (!currentTabUrl) return null;

  try {
    const existingWorkspaces = await listWorkspaces();
    const workspaceData = getSuggestedWorkspaceFromCurrentTab(currentTabUrl, existingWorkspaces);
    
    if (!workspaceData) return null;

    const workspaceWithDefaults = {
      id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      ...workspaceData
    };
    
    await saveWorkspace(workspaceWithDefaults);
    
    // Index the URL in the URL store
    if (currentTabUrl) {
      try {
        await addUrlToWorkspace(currentTabUrl, workspaceWithDefaults.id, {
          title: currentTabUrl,
          addedAt: Date.now()
        });
      } catch (urlError) {
        console.warn(`⚠️ Failed to index URL ${currentTabUrl}:`, urlError);
      }
    }
    
    console.log(`✅ Created workspace from current tab: ${workspaceWithDefaults.name}`);
    
    return workspaceWithDefaults;
  } catch (error) {
    console.error('Error creating workspace from current tab:', error);
    return null;
  }
}

/**
 * Scan browser history and create workspaces (for use in background/content scripts)
 * @param {number} daysBack - How many days back to scan history (default: 30)
 * @returns {Promise<Array>} - Array of created workspaces
 */
export async function scanBrowserHistoryAndCreateWorkspaces(daysBack = 30) {
  try {
    const endTime = Date.now();
    const startTime = endTime - (daysBack * 24 * 60 * 60 * 1000);
    
    // Get browser history
    const historyItems = await chrome.history.search({
      text: '',
      startTime: startTime,
      endTime: endTime,
      maxResults: 1000
    });
    
    const urls = historyItems.map(item => item.url).filter(Boolean);
    
    console.log(`🔍 Scanning ${urls.length} URLs from last ${daysBack} days...`);
    
    return await autoCreateWorkspacesFromUrls(urls);
  } catch (error) {
    console.error('Error scanning browser history:', error);
    return [];
  }
}

/**
 * Get workspace suggestions for an array of URLs (without creating them)
 * @param {Array} urls - Array of URLs to analyze
 * @returns {Promise<Array>} - Array of workspace suggestions
 */
export async function getWorkspaceSuggestions(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return [];

  try {
    const existingWorkspaces = await listWorkspaces();
    return createWorkspacesFromUrls(urls, existingWorkspaces);
  } catch (error) {
    console.error('Error getting workspace suggestions:', error);
    return [];
  }
}

/**
 * Create workspace from a single URL (wrapper with database integration)
 * @param {string} url - Single URL to process
 * @param {Array} existingWorkspaces - Array of existing workspaces to check against
 * @returns {Promise<Object|null>} - Created workspace object or null
 */
export async function createWorkspaceFromSingleUrl(url, existingWorkspaces = null) {
  if (!url) return null;

  try {
    const workspaces = existingWorkspaces || await listWorkspaces();
    const workspaceData = createWorkspaceFromSingleUrlBase(url, workspaces);
    
    if (!workspaceData) return null;

    const workspaceWithDefaults = {
      id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      ...workspaceData
    };
    
    await saveWorkspace(workspaceWithDefaults);
    
    // Index the URL in the URL store
    try {
      await addUrlToWorkspace(url, workspaceWithDefaults.id, {
        title: url,
        addedAt: Date.now()
      });
    } catch (urlError) {
      console.warn(`⚠️ Failed to index URL ${url}:`, urlError);
    }
    
    console.log(`✅ Created workspace from single URL: ${workspaceWithDefaults.name}`);
    
    return workspaceWithDefaults;
  } catch (error) {
    console.error('Error creating workspace from single URL:', error);
    return null;
  }
}