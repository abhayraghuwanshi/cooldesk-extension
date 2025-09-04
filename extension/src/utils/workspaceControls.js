/**
 * Manual controls for workspace creation
 */

import { autoCreateWorkspacesFromUrls, scanBrowserHistoryAndCreateWorkspaces } from './workspaceAutoCreator.js';
import { getUIState, saveUIState, listWorkspaces } from '../db';

/**
 * Enable/disable auto workspace creation
 * @param {boolean} enabled - Whether to enable auto-creation
 */
export async function setAutoCreateWorkspaces(enabled) {
  try {
    const ui = await getUIState();
    await saveUIState({ ...ui, autoCreateWorkspaces: enabled });
    console.log(`🔧 Auto-workspace creation ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  } catch (error) {
    console.error('Failed to update auto-creation setting:', error);
    return false;
  }
}

/**
 * Check if auto workspace creation is enabled
 * @returns {Promise<boolean>}
 */
export async function isAutoCreateEnabled() {
  try {
    const ui = await getUIState();
    return ui?.autoCreateWorkspaces !== false; // default true
  } catch (error) {
    console.error('Failed to check auto-creation setting:', error);
    return true; // default to enabled
  }
}

/**
 * Manually trigger workspace creation from current browser data
 * @param {Array} data - Dashboard data array
 * @returns {Promise<Array>} - Created workspaces
 */
export async function manualCreateWorkspaces(data) {
  if (!Array.isArray(data)) {
    console.warn('No data provided for workspace creation');
    return [];
  }

  const urls = data.map(item => item.url).filter(Boolean);
  console.log(`🎯 Manually creating workspaces from ${urls.length} URLs...`);
  
  const createdWorkspaces = await autoCreateWorkspacesFromUrls(urls);
  
  if (createdWorkspaces.length > 0) {
    console.log(`✅ Manually created ${createdWorkspaces.length} workspaces:`, 
      createdWorkspaces.map(w => w.name));
  } else {
    console.log('ℹ️ No new workspaces created (may already exist)');
  }
  
  return createdWorkspaces;
}

/**
 * Reset auto-creation hash to force re-processing
 */
export async function resetAutoCreateHash() {
  try {
    const ui = await getUIState();
    await saveUIState({ ...ui, lastAutoCreateHash: null });
    console.log('🔄 Reset auto-creation hash - will re-process data on next load');
    return true;
  } catch (error) {
    console.error('Failed to reset auto-creation hash:', error);
    return false;
  }
}

/**
 * Get current workspace creation settings
 */
export async function getWorkspaceSettings() {
  try {
    const ui = await getUIState();
    const workspaces = await listWorkspaces();
    
    return {
      autoCreateEnabled: ui?.autoCreateWorkspaces !== false,
      lastProcessedHash: ui?.lastAutoCreateHash,
      existingWorkspaces: workspaces?.length || 0,
      platformWorkspaces: workspaces?.filter(w => 
        ['GitHub', 'Figma', 'Jira', 'Notion', 'Trello', 'Slack', 'Discord'].includes(w.name)
      )?.length || 0
    };
  } catch (error) {
    console.error('Failed to get workspace settings:', error);
    return {
      autoCreateEnabled: true,
      lastProcessedHash: null,
      existingWorkspaces: 0,
      platformWorkspaces: 0
    };
  }
}

// Export for console usage
if (typeof window !== 'undefined') {
  window.workspaceControls = {
    enable: () => setAutoCreateWorkspaces(true),
    disable: () => setAutoCreateWorkspaces(false),
    isEnabled: isAutoCreateEnabled,
    createNow: manualCreateWorkspaces,
    reset: resetAutoCreateHash,
    settings: getWorkspaceSettings,
    scanHistory: (days = 30) => scanBrowserHistoryAndCreateWorkspaces(days)
  };
}