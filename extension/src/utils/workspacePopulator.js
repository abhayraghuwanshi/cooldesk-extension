/**
 * Workspace Populator - Adds missing URLs to existing workspaces
 */

import { listWorkspaces, saveWorkspace, addUrlToWorkspace } from '../db.js';
import { detectProject } from './projectCategories.js';

/**
 * Populate existing platform workspaces with all matching URLs from browser data
 * @param {Array} browserData - Array of browser history/bookmark items
 * @returns {Promise<Object>} - Report of what was added
 */
export async function populateWorkspacesWithUrls(browserData) {
  if (!Array.isArray(browserData) || browserData.length === 0) {
    return { error: 'No browser data provided' };
  }

  try {
    const workspaces = await listWorkspaces();
    const platformWorkspaces = workspaces.filter(ws => 
      ['GitHub', 'Figma', 'Jira', 'Notion', 'Trello', 'Slack', 'Discord'].includes(ws.name)
    );

    console.log(`🔍 Found ${platformWorkspaces.length} platform workspaces to populate`);
    
    const report = {
      processedUrls: 0,
      addedUrls: 0,
      workspacesUpdated: {},
      errors: []
    };

    // Group URLs by platform
    const urlsByPlatform = new Map();

    for (const item of browserData) {
      if (!item.url) continue;
      
      report.processedUrls++;
      
      try {
        const detection = detectProject(item.url);
        if (!detection) continue;

        const platformName = detection.workspace.name; // e.g., "GitHub", "Figma"
        
        if (!urlsByPlatform.has(platformName)) {
          urlsByPlatform.set(platformName, []);
        }
        
        urlsByPlatform.get(platformName).push({
          url: item.url,
          title: item.title || item.url,
          favicon: item.favIconUrl || item.favicon,
          addedAt: Date.now(),
          source: 'browser_data'
        });
        
      } catch (error) {
        report.errors.push(`Error processing ${item.url}: ${error.message}`);
      }
    }

    console.log(`📊 URLs by platform:`, 
      Array.from(urlsByPlatform.entries()).map(([platform, urls]) => `${platform}: ${urls.length}`)
    );

    // Add URLs to existing workspaces
    for (const workspace of platformWorkspaces) {
      const platformUrls = urlsByPlatform.get(workspace.name) || [];
      if (platformUrls.length === 0) continue;

      console.log(`📝 Adding ${platformUrls.length} URLs to ${workspace.name} workspace`);

      // Get existing URLs to avoid duplicates
      const existingUrls = new Set((workspace.urls || []).map(u => u.url || u));
      const newUrls = platformUrls.filter(urlObj => !existingUrls.has(urlObj.url));

      if (newUrls.length === 0) {
        console.log(`   ℹ️ No new URLs for ${workspace.name} (all already exist)`);
        continue;
      }

      // Update workspace with new URLs
      const updatedWorkspace = {
        ...workspace,
        urls: [
          ...(workspace.urls || []),
          ...newUrls
        ]
      };

      try {
        await saveWorkspace(updatedWorkspace);
        
        // Also index URLs in the URL store
        for (const urlObj of newUrls) {
          try {
            await addUrlToWorkspace(urlObj.url, workspace.id, {
              title: urlObj.title,
              favicon: urlObj.favicon,
              addedAt: urlObj.addedAt
            });
          } catch (indexError) {
            report.errors.push(`Failed to index ${urlObj.url}: ${indexError.message}`);
          }
        }

        report.addedUrls += newUrls.length;
        report.workspacesUpdated[workspace.name] = {
          previousCount: existingUrls.size,
          newCount: newUrls.length,
          totalCount: updatedWorkspace.urls.length
        };

        console.log(`   ✅ Added ${newUrls.length} new URLs to ${workspace.name} (total: ${updatedWorkspace.urls.length})`);

      } catch (error) {
        report.errors.push(`Failed to update ${workspace.name}: ${error.message}`);
      }
    }

    return report;

  } catch (error) {
    return { 
      error: error.message,
      processedUrls: 0,
      addedUrls: 0,
      workspacesUpdated: {},
      errors: [error.message]
    };
  }
}

/**
 * Get current browser data and populate workspaces
 * @returns {Promise<Object>} - Population report
 */
export async function populateWorkspacesFromBrowserData() {
  try {
    // Get current dashboard data
    const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
    
    if (!dashboardData) {
      return { error: 'No dashboard data found in storage' };
    }

    const allItems = [
      ...(dashboardData.history || []),
      ...(dashboardData.bookmarks || [])
    ];

    console.log(`🚀 Populating workspaces from ${allItems.length} browser items...`);
    
    return await populateWorkspacesWithUrls(allItems);

  } catch (error) {
    return { 
      error: `Failed to get browser data: ${error.message}`,
      processedUrls: 0,
      addedUrls: 0,
      workspacesUpdated: {},
      errors: [error.message]
    };
  }
}

/**
 * Show detailed workspace contents for debugging
 */
export async function showWorkspaceContents() {
  try {
    const workspaces = await listWorkspaces();
    const platformWorkspaces = workspaces.filter(ws => 
      ['GitHub', 'Figma', 'Jira', 'Notion', 'Trello', 'Slack', 'Discord'].includes(ws.name)
    );

    console.log(`📋 Platform Workspace Contents:`);
    
    for (const workspace of platformWorkspaces) {
      console.log(`\n🏢 ${workspace.name}:`);
      console.log(`   📊 Total URLs: ${(workspace.urls || []).length}`);
      
      if (workspace.projects && workspace.projects.length > 0) {
        console.log(`   📁 Projects: ${workspace.projects.join(', ')}`);
      }
      
      if (workspace.urls && workspace.urls.length > 0) {
        console.log(`   🔗 URLs:`);
        workspace.urls.forEach((urlObj, index) => {
          const url = urlObj.url || urlObj;
          console.log(`      ${index + 1}. ${url}`);
        });
      }
    }

    return platformWorkspaces.map(ws => ({
      name: ws.name,
      urlCount: (ws.urls || []).length,
      projects: ws.projects || [],
      urls: (ws.urls || []).map(u => u.url || u)
    }));

  } catch (error) {
    console.error('❌ Error showing workspace contents:', error);
    return null;
  }
}

// Export for console usage
if (typeof window !== 'undefined') {
  window.workspacePopulator = {
    populate: populateWorkspacesFromBrowserData,
    show: showWorkspaceContents,
    populateFromData: populateWorkspacesWithUrls
  };
}