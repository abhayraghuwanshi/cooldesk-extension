/**
 * View Modes Configuration
 * Defines different view modes and their display settings
 */

export const VIEW_MODES = {
  default: {
    id: 'default',
    label: 'All Components',
    description: 'Show all UI components',
    icon: '📋',
    settings: {
      pinnedWorkspaces: true,
      workspaceFilters: true,
      currentTabsSection: true,
      voiceNavigationSection: true,
      aiChatsSection: true,
      aiToolsSection: true,
      notesSection: true,
      dailyNotesSection: true,
      pingsSection: true,
      feedSection: true,
    }
  },

  focus: {
    id: 'focus',
    label: 'Focus Mode',
    description: 'Minimal distractions for focused work',
    icon: '🎯',
    settings: {
      pinnedWorkspaces: false,
      workspaceFilters: true,
      currentTabsSection: false,
      voiceNavigationSection: false,
      aiChatsSection: false,
      aiToolsSection: true,
      notesSection: true,
      dailyNotesSection: true,
      pingsSection: false,
      feedSection: false,
    }
  },

  workspace: {
    id: 'workspace',
    label: 'Workspace Only',
    description: 'Focus on workspace management',
    icon: '💼',
    settings: {
      pinnedWorkspaces: true,
      workspaceFilters: true,
      currentTabsSection: false,
      voiceNavigationSection: false,
      aiChatsSection: false,
      aiToolsSection: true,
      notesSection: false,
      dailyNotesSection: false,
      pingsSection: false,
      feedSection: false,
    }
  },

  activity: {
    id: 'activity',
    label: 'Activity View',
    description: 'Focus on activity panel sections',
    icon: '📊',
    settings: {
      pinnedWorkspaces: false,
      workspaceFilters: false,
      currentTabsSection: true,
      voiceNavigationSection: false,
      aiChatsSection: true,
      aiToolsSection: true,
      notesSection: true,
      dailyNotesSection: true,
      pingsSection: false,
      feedSection: false,
    }
  },

  ai: {
    id: 'ai',
    label: 'AI Tools',
    description: 'Focus on AI chat history and summarizer tools',
    icon: '🤖',
    settings: {
      pinnedWorkspaces: false,
      workspaceFilters: false,
      currentTabsSection: false,
      voiceNavigationSection: false,
      aiChatsSection: true,
      aiToolsSection: true,
      notesSection: false,
      dailyNotesSection: false,
      pingsSection: false,
      feedSection: false,
    }
  },

  notes: {
    id: 'notes',
    label: 'Notes & Writing',
    description: 'Focus on notes and daily journal',
    icon: '📝',
    settings: {
      pinnedWorkspaces: false,
      workspaceFilters: false,
      currentTabsSection: false,
      voiceNavigationSection: false,
      aiChatsSection: false,
      aiToolsSection: false,
      notesSection: true,
      dailyNotesSection: true,
      pingsSection: true,
      feedSection: false,
    }
  },

  minimal: {
    id: 'minimal',
    label: 'Minimal View',
    description: 'Hand free mode',
    icon: '⚡',
    settings: {
      pinnedWorkspaces: false,
      workspaceFilters: false,
      currentTabsSection: false,
      voiceNavigationSection: true,
      aiChatsSection: false,
      aiToolsSection: true,
      notesSection: false,
      dailyNotesSection: false,
      pingsSection: false,
      feedSection: false,
    }
  },
};

// Get array of view modes for dropdown
export const getViewModesList = () => {
  return Object.values(VIEW_MODES);
};

// Get view mode by ID
export const getViewMode = (id) => {
  return VIEW_MODES[id] || VIEW_MODES.default;
};

// Apply view mode settings
export const applyViewMode = (modeId) => {
  const mode = getViewMode(modeId);

  // Save to localStorage
  localStorage.setItem('cooldesk_view_mode', modeId);
  localStorage.setItem('cooldesk_display_settings', JSON.stringify(mode.settings));

  // Dispatch event to update UI
  window.dispatchEvent(new CustomEvent('displaySettingsChanged', { detail: mode.settings }));
  window.dispatchEvent(new CustomEvent('viewModeChanged', { detail: { modeId, mode } }));

  return mode;
};

// Get current view mode
export const getCurrentViewMode = () => {
  try {
    const saved = localStorage.getItem('cooldesk_view_mode');
    return saved || 'default';
  } catch {
    return 'default';
  }
};
