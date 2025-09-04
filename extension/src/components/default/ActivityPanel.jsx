import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { CoolFeedSection } from './CoolFeedSection';
import { CurrentTabsSection } from './CurrentTabsSection';
import { NotesSection } from './NotesSection';
import { PingsSection } from './PingsSection';

export function ActivityPanel({ activeSection = 0 }) {
  // State for preview modal
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [previewData, setPreviewData] = React.useState(null);

  // Refs for section scrolling
  const sectionRefs = React.useRef([]);
  const containerRef = React.useRef(null);

  // Add ping function
  const addPing = React.useCallback(async (tab) => {
    try {
      if (!tab?.url) return;
      const { upsertPing } = await import('../../db');
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

  // Define sections array matching Header navigation
  const sections = [
    { name: 'Current Tabs', component: <CurrentTabsSection onAddPing={addPing} onRequestPreview={requestPreview} /> },
    { name: 'Pins', component: <PingsSection /> },
    { name: 'Notes', component: <NotesSection /> },
    { name: 'Cool Feed', component: <CoolFeedSection /> }
  ];

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
        const isVisible = isAllMode || isCurrentSection;

        return (
          <ErrorBoundary key={section.name}>
            <div
              ref={el => sectionRefs.current[index] = el}
              style={{
                marginTop: index === 0 ? 16 : 32,
                opacity: isAllMode ? 1 : (isCurrentSection ? 1 : 0.3),
                transform: isAllMode ? 'scale(1)' : (isCurrentSection ? 'scale(1)' : 'scale(0.98)'),
                transition: 'all 0.3s ease',
                filter: isAllMode ? 'none' : (isCurrentSection ? 'none' : 'blur(1px)'),
                pointerEvents: isAllMode ? 'auto' : (isCurrentSection ? 'auto' : 'none')
              }}
            >
              {/* Section indicator */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '12px',
                gap: '8px'
              }}>
                <div style={{
                  width: '4px',
                  height: '20px',
                  background: isAllMode
                    ? 'linear-gradient(135deg, #34C759 0%, #30D158 100%)'
                    : (isCurrentSection
                      ? 'linear-gradient(135deg, #34C759 0%, #30D158 100%)'
                      : 'rgba(255, 255, 255, 0.2)'),
                  borderRadius: '2px',
                  transition: 'all 0.3s ease'
                }} />
                <h3 style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: '600',
                  color: isAllMode
                    ? '#ffffff'
                    : (isCurrentSection ? '#ffffff' : 'rgba(255, 255, 255, 0.5)'),
                  transition: 'all 0.3s ease'
                }}>
                  {section.name}
                </h3>
                {(isAllMode || isCurrentSection) && (
                  <div style={{
                    fontSize: '12px',
                    color: 'rgba(52, 199, 89, 0.8)',
                    fontWeight: '500'
                  }}>
                    {isAllMode ? '• Visible' : '• Active'}
                  </div>
                )}
              </div>
              {section.component}
            </div>
          </ErrorBoundary>
        );
      })}
    </section>
  );
}
