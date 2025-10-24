import React from 'react';
import { getUIState, saveUIState } from '../../db/unified-api.js';
import { ErrorBoundary } from '../ErrorBoundary';
import { getDisplaySettings } from '../settings/DisplayData';
import VoiceNavigationChatGPT from '../toolbar/VoiceNavigationChatGPT';
import { AIChatsSection } from './AIChats';
import { CurrentTabsSection } from './CurrentTabsSection';
import { SimpleNotes } from './SimpleNotes';
import { DropboxSharedSection } from './DropboxSharedSection';

export function ActivityPanel({ activeSection = 0 }) {
  // State for preview modal
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewData, setPreviewData] = React.useState(null);

  // State for responsive layout
  const [isNarrowScreen, setIsNarrowScreen] = React.useState(false);

  // Display settings state
  const [displaySettings, setDisplaySettings] = React.useState(() => getDisplaySettings());

  // Listen for display settings changes
  React.useEffect(() => {
    const handleDisplaySettingsChange = (event) => {
      setDisplaySettings(event.detail || getDisplaySettings());
    };

    window.addEventListener('displaySettingsChanged', handleDisplaySettingsChange);
    return () => {
      window.removeEventListener('displaySettingsChanged', handleDisplaySettingsChange);
    };
  }, []);

  // Hidden sections persistence (double-click to toggle) using localStorage + unified DB
  const [hiddenSections, setHiddenSections] = React.useState(() => {
    try {
      const saved = localStorage.getItem('activityPanel_hiddenSections');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const uiStateRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ui = await getUIState();
        if (cancelled) return;
        uiStateRef.current = ui || { id: 'default' };
        // Merge with localStorage (localStorage takes precedence for immediate feedback)
        const dbHidden = ui?.hiddenActivitySections || {};
        setHiddenSections(prev => ({ ...dbHidden, ...prev }));
      } catch (e) {
        console.warn('[ActivityPanel] Failed to load UI state for hidden sections', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist to localStorage on change
  React.useEffect(() => {
    try {
      localStorage.setItem('activityPanel_hiddenSections', JSON.stringify(hiddenSections));
    } catch (e) {
      console.warn('[ActivityPanel] Failed to save to localStorage', e);
    }
  }, [hiddenSections]);

  const toggleHidden = React.useCallback(async (name) => {
    setHiddenSections((prev) => {
      const next = { ...prev, [name]: !prev?.[name] };
      // Save to both localStorage (immediate) and unified DB (persistent)
      try {
        localStorage.setItem('activityPanel_hiddenSections', JSON.stringify(next));
      } catch (e) {
        console.warn('[ActivityPanel] Failed to save to localStorage', e);
      }
      // Fire-and-forget save to unified DB
      const base = uiStateRef.current || { id: 'default' };
      uiStateRef.current = { ...base, hiddenActivitySections: next };
      saveUIState(uiStateRef.current).catch((e) => console.warn('[ActivityPanel] saveUIState failed', e));
      return next;
    });
  }, []);

  // Refs for section scrolling
  const sectionRefs = React.useRef([]);
  const containerRef = React.useRef(null);

  // Add ping function
  const addPing = React.useCallback(async (tab) => {
    try {
      if (!tab?.url) return;
      const { upsertPing } = await import('../../db/index.js');
      const { getFaviconUrl } = await import('../../utils');

      const ping = {
        url: tab.url,
        title: tab.title || (() => { try { return new URL(tab.url).hostname; } catch { return tab.url; } })(),
        favicon: (() => {
          const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
          const primary = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 64);
          try {
            const u = new URL(tab.url);
            const originIco = (u.protocol === 'http:' || u.protocol === 'https:') ? `${u.origin}/favicon.ico` : '';
            return primary || originIco || '';
          } catch { return primary || ''; }
        })(),
        createdAt: Date.now(),
      };
      await upsertPing(ping);
    } catch (e) {
      console.warn('Failed to add ping:', e);
    }
  }, []);

  // Request preview function
  const requestPreview = React.useCallback(async (tab) => {
    const url = tab?.url;
    if (!url) return;

    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewData({ title: 'Loading…' });

    try {
      const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
      if (!hasRuntime) {
        setPreviewLoading(false);
        setPreviewError('Preview not available in this environment');
        return;
      }

      const resp = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out')), 8000);
        try {
          chrome.runtime.sendMessage({ action: 'fetchPreview', url }, (res) => {
            clearTimeout(timer);
            const lastErr = chrome.runtime?.lastError;
            if (lastErr) return reject(new Error(lastErr.message || 'Service worker unavailable'));
            resolve(res);
          });
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });

      const data = resp?.ok ? (resp.data || null) : null;
      const err = resp?.ok ? '' : (resp?.error || 'Failed to load preview');

      if (data) {
        setPreviewData(data);
        setPreviewError('');
      } else {
        setPreviewError(err || 'Failed to load preview');
      }
    } catch (e) {
      setPreviewError(String(e?.message || e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Handle responsive layout
  React.useEffect(() => {
    const handleResize = () => {
      setIsNarrowScreen(window.innerWidth < 768);
    };

    // Set initial state
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-scroll to active section when it changes (skip for "All" mode)
  React.useEffect(() => {
    // Don't auto-scroll when in "All" mode (activeSection === 0)
    if (activeSection === 0) return;

    const scrollToSection = () => {
      const element = sectionRefs.current[activeSection - 1]; // Adjust for "All" being index 0
      if (!element) {
        console.log('Element not found for section:', activeSection);
        return;
      }

      console.log('Attempting to scroll to section:', activeSection);

      // Try multiple scroll methods for better compatibility
      try {
        // Method 1: scrollIntoView (most reliable)
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });

        console.log('ScrollIntoView executed for section:', activeSection);
      } catch (e) {
        console.log('ScrollIntoView failed, trying window.scrollTo:', e);

        // Method 2: window.scrollTo as fallback
        try {
          const headerHeight = 100;
          const elementRect = element.getBoundingClientRect();
          const currentScrollY = window.scrollY;
          const targetScrollY = currentScrollY + elementRect.top - headerHeight;

          window.scrollTo({
            top: Math.max(0, targetScrollY),
            behavior: 'smooth'
          });
        } catch (e2) {
          console.log('Window.scrollTo also failed:', e2);
        }
      }
    };

    // Use requestAnimationFrame and a small delay for better timing
    const timer = setTimeout(() => {
      requestAnimationFrame(scrollToSection);
    }, 150);

    return () => clearTimeout(timer);
  }, [activeSection]);

  // Define sections array matching Header navigation with display setting IDs
  const allSections = [
    {
      id: 'currentTabsSection',
      name: 'Current Tabs',
      component: <div data-onboarding="current-tabs-section"><CurrentTabsSection onAddPing={addPing} onRequestPreview={requestPreview} /></div>
    },
    {
      id: 'voiceNavigationSection',
      name: 'Voice Navigation',
      component: <div data-onboarding="voice-navigation-section">
        <h2
          className="coolDesk-section-title"
          style={{ cursor: 'help' }}
        >
          Voice Navigation
        </h2>
        <VoiceNavigationChatGPT />
      </div>
    },
    {
      id: 'aiChatsSection',
      name: 'AI Chats',
      component: <div data-onboarding="ai-chats-section">
        <AIChatsSection />
      </div>
    },
    {
      id: 'notesSection',
      name: 'Notes',
      component: <div data-onboarding="notes-section">
        <SimpleNotes />
      </div>
    },
    {
      id: 'dropboxSharedSection',
      name: 'Shared Workspaces',
      component: <div data-onboarding="dropbox-shared-section">
        <DropboxSharedSection />
      </div>
    }
  ];

  // Filter sections based on display settings
  const sections = allSections.filter(section => displaySettings[section.id] !== false);

  // Removed side-by-side logic - now using unified SimpleNotes component

  return (
    <section
      ref={containerRef}
      style={{
        marginTop: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
      }}
    >
      {/* Show all sections with current one highlighted */}
      {sections.map((section, index) => {
        const isAllMode = activeSection === 0;
        const isCurrentSection = index === (activeSection - 1); // Adjust for "All" being index 0

        // Regular single-section display with hide/show on double-click
        const isHidden = !!hiddenSections[section.name];
        return (
          <ErrorBoundary key={section.name}>
            {isHidden ? (
              <div
                className="activity-section-hidden"
                onDoubleClick={() => toggleHidden(section.name)}
                ref={el => sectionRefs.current[index] = el}
                style={{
                  marginTop: index === 0 ? 16 : 32,
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px dashed var(--border-primary)',
                  color: 'var(--text-secondary)',
                  background: 'var(--glass-bg)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease',
                  fontStyle: 'italic',
                  minWidth: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--interactive-hover)';
                  e.currentTarget.style.borderColor = 'var(--border-accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--glass-bg)';
                  e.currentTarget.style.borderColor = 'var(--border-primary)';
                }}
                title="Double-click to show this section again"
              >
                <span style={{ opacity: 0.8 }}>Hidden: {section.name}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6 }}>(double-click to show)</span>
              </div>
            ) : (
              <div
                onDoubleClick={() => toggleHidden(section.name)}
                ref={el => sectionRefs.current[index] = el}
                style={{
                  marginTop: index === 0 ? 16 : 32,
                  opacity: isAllMode ? 1 : (isCurrentSection ? 1 : 0.3),
                  transform: isAllMode ? 'scale(1)' : (isCurrentSection ? 'scale(1)' : 'scale(0.98)'),
                  transition: 'all 0.3s ease',
                  filter: isAllMode ? 'none' : (isCurrentSection ? 'none' : 'blur(1px)'),
                  pointerEvents: isAllMode ? 'auto' : (isCurrentSection ? 'auto' : 'none')
                }}
                title="Double-click to hide this section"
              >
                {section.component}
              </div>
            )}
          </ErrorBoundary>
        );
      })}
    </section>
  );
}
