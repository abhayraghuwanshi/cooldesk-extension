import React, { useEffect } from 'react';
import './FocusLayout.css';

/**
 * Focus Layout - Minimal distractions, single main content area
 * Automatically adjusts display settings to hide distracting elements
 */
export function FocusLayout({ children }) {
  useEffect(() => {
    // Save current display settings
    const savedSettings = localStorage.getItem('cooldesk_display_settings');
    const currentSettings = savedSettings ? JSON.parse(savedSettings) : {};
    
    // Store original settings to restore later
    sessionStorage.setItem('cooldesk_original_display_settings', savedSettings || '{}');
    
    // Apply focus mode display settings
    const focusSettings = {
      ...currentSettings,
      // Hide distracting elements in focus mode
      pingsSection: false,
      feedSection: false,
      pinnedWorkspaces: false,
      // Keep essential elements visible
      workspaceFilters: true,
      currentTabsSection: false,
      voiceNavigationSection: false,
      aiChatsSection: false,
      notesSection: true,
      dailyNotesSection: true,
    };
    
    // Apply focus settings
    localStorage.setItem('cooldesk_display_settings', JSON.stringify(focusSettings));
    window.dispatchEvent(new CustomEvent('displaySettingsChanged', { detail: focusSettings }));
    
    // Cleanup: restore original settings when leaving focus mode
    return () => {
      const originalSettings = sessionStorage.getItem('cooldesk_original_display_settings');
      if (originalSettings) {
        const settings = JSON.parse(originalSettings);
        localStorage.setItem('cooldesk_display_settings', originalSettings);
        window.dispatchEvent(new CustomEvent('displaySettingsChanged', { detail: settings }));
        sessionStorage.removeItem('cooldesk_original_display_settings');
      }
    };
  }, []);

  return (
    <div className="layout-focus-wrapper">
      {/* Display settings automatically control visibility */}
      {children}
    </div>
  );
}

export default FocusLayout;
