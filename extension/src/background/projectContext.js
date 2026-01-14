/**
 * Project Context Manager - Background service for session tracking and project detection
 * Monitors browser tabs and automatically detects project contexts
 */

import { sessionTracker } from '../ml/sessionTracker.js';
import { projectDetector } from '../ml/projectDetector.js';
import { categorizer } from '../ml/categorizer.js';

class ProjectContextManager {
  constructor() {
    this.initialized = false;
    this.checkInterval = null;
    this.CHECK_INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes
  }

  /**
   * Initialize the project context manager
   */
  async initialize() {
    if (this.initialized) return;

    console.log('[ProjectContext] Initializing...');

    // Check if session tracking is enabled
    const { sessionTracking } = await chrome.storage.local.get(['sessionTracking']);
    const enabled = sessionTracking?.enabled !== false; // Default to enabled

    if (!enabled) {
      console.log('[ProjectContext] Session tracking disabled');
      return;
    }

    // Set up tab listeners
    this._setupTabListeners();

    // Start periodic project detection
    this._startProjectDetection();

    // Get current tabs and update session
    await this._syncCurrentTabs();

    this.initialized = true;
    console.log('[ProjectContext] Initialized successfully');
  }

  /**
   * Set up Chrome tab listeners
   */
  _setupTabListeners() {
    // Tab activated
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url) {
          await sessionTracker.updateTab(tab.id, tab.url, tab.title);
          await this._checkProjectSwitch(tab.url);
        }
      } catch (error) {
        // Tab might be closed
      }
    });

    // Tab updated (URL or title changed)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.title) {
        await sessionTracker.updateTab(tabId, tab.url, tab.title);
        if (changeInfo.url) {
          await this._checkProjectSwitch(tab.url);
        }
      }
    });

    // Tab removed
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      await sessionTracker.removeTab(tabId);
    });

    // Window focus changed
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, windowId });
          if (activeTab?.url) {
            await sessionTracker.updateTab(activeTab.id, activeTab.url, activeTab.title);
          }
        } catch (error) {
          // Ignore errors
        }
      }
    });

    console.log('[ProjectContext] Tab listeners set up');
  }

  /**
   * Sync current open tabs into session tracker
   */
  async _syncCurrentTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          await sessionTracker.updateTab(tab.id, tab.url, tab.title);
        }
      }
      console.log('[ProjectContext] Synced', tabs.length, 'tabs');
    } catch (error) {
      console.error('[ProjectContext] Failed to sync tabs:', error);
    }
  }

  /**
   * Check if URL switch should trigger project change
   * @param {string} url
   */
  async _checkProjectSwitch(url) {
    try {
      const matchedProject = projectDetector.findProjectByUrl(url);
      const activeProject = projectDetector.getActiveProject();

      // Auto-switch if different project detected
      if (matchedProject && matchedProject.id !== activeProject?.id) {
        await projectDetector.setActiveProject(matchedProject.id);
        console.log('[ProjectContext] Auto-switched to project:', matchedProject.name);

        // Notify UI
        chrome.runtime.sendMessage({
          action: 'projectAutoSwitched',
          project: matchedProject
        }).catch(() => {});
      }
    } catch (error) {
      console.error('[ProjectContext] Error checking project switch:', error);
    }
  }

  /**
   * Start periodic project detection
   */
  _startProjectDetection() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      await this._detectAndSuggestProject();
    }, this.CHECK_INTERVAL_MS);

    // Also check immediately
    this._detectAndSuggestProject();
  }

  /**
   * Detect and suggest new projects from current session
   */
  async _detectAndSuggestProject() {
    try {
      const suggestion = await projectDetector.analyzeSessionForProject();

      if (!suggestion) {
        return;
      }

      if (suggestion.type === 'new') {
        // New project detected - notify UI
        console.log('[ProjectContext] New project detected:', suggestion.suggestion);

        chrome.runtime.sendMessage({
          action: 'newProjectDetected',
          suggestion: suggestion.suggestion
        }).catch(() => {});
      } else if (suggestion.type === 'existing') {
        // Existing project matched - already switched by analyzeSessionForProject
        console.log('[ProjectContext] Matched existing project:', suggestion.project.name);
      }
    } catch (error) {
      console.error('[ProjectContext] Error detecting project:', error);
    }
  }

  /**
   * Stop project detection
   */
  stopProjectDetection() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Handle message from extension UI or content scripts
   * @param {Object} message
   * @param {Object} sender
   * @param {Function} sendResponse
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'getProjectContext':
          {
            const session = sessionTracker.getCurrentSession();
            const activeProject = projectDetector.getActiveProject();
            sendResponse({
              ok: true,
              session,
              activeProject,
              allProjects: projectDetector.getAllProjects()
            });
          }
          break;

        case 'setActiveProject':
          await projectDetector.setActiveProject(message.projectId);
          sendResponse({ ok: true });
          break;

        case 'createProject':
          {
            const project = await projectDetector.createProject(
              message.name,
              message.urlPatterns || [],
              message.options || {}
            );
            await projectDetector.setActiveProject(project.id);
            sendResponse({ ok: true, project });
          }
          break;

        case 'confirmPendingProject':
          {
            const project = await projectDetector.confirmPendingProject(message.name);
            sendResponse({ ok: true, project });
          }
          break;

        case 'rejectPendingProject':
          projectDetector.rejectPendingProject();
          sendResponse({ ok: true });
          break;

        case 'categorizeUrl':
          {
            const result = await categorizer.categorize(
              message.url,
              message.title,
              message.apiKey
            );
            sendResponse({ ok: true, result });
          }
          break;

        case 'quickCategorize':
          {
            const category = categorizer.quickCategorize(message.url);
            sendResponse({ ok: true, category });
          }
          break;

        case 'toggleSessionTracking':
          {
            await sessionTracker.setEnabled(message.enabled);
            if (message.enabled) {
              await this.initialize();
            } else {
              this.stopProjectDetection();
            }
            sendResponse({ ok: true });
          }
          break;

        case 'clearSession':
          await sessionTracker.clearSession();
          sendResponse({ ok: true });
          break;

        case 'getAllProjects':
          sendResponse({
            ok: true,
            projects: projectDetector.getAllProjects()
          });
          break;

        case 'deleteProject':
          await projectDetector.deleteProject(message.projectId);
          sendResponse({ ok: true });
          break;

        case 'updateProject':
          await projectDetector.updateProject(message.projectId, message.updates);
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ ok: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[ProjectContext] Message handler error:', error);
      sendResponse({ ok: false, error: error.message });
    }
  }
}

// Export singleton instance
export const projectContextManager = new ProjectContextManager();

/**
 * Initialize project context manager
 */
export function initializeProjectContext() {
  projectContextManager.initialize();

  // Register message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check if message is for project context
    const projectActions = [
      'getProjectContext',
      'setActiveProject',
      'createProject',
      'confirmPendingProject',
      'rejectPendingProject',
      'categorizeUrl',
      'quickCategorize',
      'toggleSessionTracking',
      'clearSession',
      'getAllProjects',
      'deleteProject',
      'updateProject'
    ];

    if (projectActions.includes(message.action)) {
      projectContextManager.handleMessage(message, sender, sendResponse);
      return true; // Keep channel open for async response
    }
  });

  console.log('[ProjectContext] Message handlers registered');
}
