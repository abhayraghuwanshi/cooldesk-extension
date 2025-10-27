/**
 * View Modes Configuration
 * Defines different view modes and their display settings
 */

const BASE_SETTINGS = {
  pinnedWorkspaces: false,
  workspaceFilters: false,
  currentTabsSection: false,
  voiceNavigationSection: false,
  aiChatsSection: false,
  notesSection: false,
  dailyNotesSection: false,
  pingsSection: false,
  feedSection: false,
};

const ALL_ON_SETTINGS = Object.fromEntries(
  Object.keys(BASE_SETTINGS).map((key) => [key, true]),
);

const createMode = ({ id, label, description, icon, overrides }) => ({
  id,
  label,
  description,
  icon,
  settings: { ...BASE_SETTINGS, ...overrides },
});

export const VIEW_MODES = {
  default: createMode({
    id: 'default',
    label: 'All Components',
    description: 'Show all UI components',
    icon: '📋',
    overrides: ALL_ON_SETTINGS,
  }),

  focus: createMode({
    id: 'focus',
    label: 'Focus Mode',
    description: 'Minimal distractions for focused work',
    icon: '🎯',
    overrides: {
      workspaceFilters: true,
      notesSection: true,
      dailyNotesSection: true,
    },
  }),

  simple: createMode({
    id: 'simple',
    label: 'Simple View',
    description: 'Keep only the essentials visible',
    icon: '✨',
    overrides: {
      pinnedWorkspaces: true,
      workspaceFilters: true,
      currentTabsSection: true,
      notesSection: true,
    },
  }),
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
