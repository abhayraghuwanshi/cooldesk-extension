/**
 * ExtensionApp.jsx - Lightweight App for Chrome Extension
 * Only includes Overview page - excludes heavy app dependencies like TipTap, YJS, etc.
 */
import React, { Suspense, useEffect, useState } from 'react';

import './App.css';
import '../features/onboarding/OnboardingTour.css';
import '../shared/styles/bento-layout.css';
import '../shared/styles/components.css';
import '../styles/cooldesk.css';
import '../shared/styles/theme.css';
import '../shared/styles/themes/components-vars.css';
import '../shared/styles/wallpaper-enhancements.css';

// FontAwesome: import CSS statically so it's in the bundle, not injected by JS at runtime
import '@fortawesome/fontawesome-svg-core/styles.css';
import { config, library } from '@fortawesome/fontawesome-svg-core';
config.autoAddCss = false;
import { faGear, faGlobe, faPlus } from '@fortawesome/free-solid-svg-icons';

// Core services (lightweight)
import { getSettings as getSettingsDB, saveSettings as saveSettingsDB } from '../db/index.js';
import { sendMessage } from '../services/extensionApi';
import { initializeFontSize, setAndSaveFontSize } from '../utils/fontUtils';
import { useOnboarding } from '../shared/hooks/useOnboarding';

// Extension-only components
import { OverviewDashboard } from '../faces/overview/OverviewDashboard';
import { CURATED_WALLPAPER_URLS } from '../shared/data/wallpapers';

// Lazy load heavy components
const SettingsModal = React.lazy(() => import('../features/settings/SettingsModal').then(module => ({ default: module.SettingsModal })));
const OnboardingTour = React.lazy(() => import('../features/onboarding/OnboardingTour').then(module => ({ default: module.OnboardingTour })));

library.add(faPlus, faGear, faGlobe);

// Simple error boundary
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error" style={{ marginTop: 8 }}>
          <div>Something went wrong.</div>
          <button
            className="add-link-btn"
            style={{ padding: '4px 8px', marginTop: 8 }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ExtensionApp() {
  const { shouldShowOnboarding, isManualStart, completeOnboarding, skipOnboarding, startOnboarding } = useOnboarding();
  const [settings, setSettings] = useState({ geminiApiKey: '', modelName: '', visitCountThreshold: '', historyDays: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [themeClass, setThemeClass] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('cooldesk-theme');
      const body = document.body;
      const themeClasses = [
        'bg-ai-midnight-nebula', 'bg-cosmic-aurora', 'bg-sunset-horizon', 'bg-forest-depths',
        'bg-minimal-dark', 'bg-ocean-depths', 'bg-cherry-blossom', 'bg-arctic-frost',
        'bg-volcanic-ember', 'bg-neon-cyberpunk', 'bg-white-cred', 'bg-orange-warm',
        'bg-brown-earth', 'bg-royal-purple', 'bg-golden-honey', 'bg-mint-sage', 'bg-crimson-fire'
      ];
      themeClasses.forEach(cls => body.classList.remove(cls));
      const newThemeClass = `bg-${savedTheme || 'crimson-fire'}`;
      body.classList.add(newThemeClass);
      return newThemeClass;
    } catch {
      return 'bg-crimson-fire';
    }
  });
  const [fontSize, setFontSize] = useState(() => {
    try {
      return initializeFontSize();
    } catch {
      return 'medium';
    }
  });
  // Wallpaper settings
  const [wallpaperEnabled, setWallpaperEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('wallpaperEnabled');
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [wallpaperUrl, setWallpaperUrl] = useState(() => {
    try {
      return localStorage.getItem('wallpaperUrl') || 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=80';
    } catch {
      return 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=80';
    }
  });
  const [wallpaperOpacity, setWallpaperOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('wallpaperOpacity');
      return saved ? parseFloat(saved) : 0.3;
    } catch {
      return 0.3;
    }
  });
  const [wallpaperAutoRotate, setWallpaperAutoRotate] = useState(() => {
    try {
      return localStorage.getItem('wallpaperAutoRotate') === 'true';
    } catch {
      return false;
    }
  });

  // Apply wallpaper CSS
  useEffect(() => {
    const body = document.body;
    if (wallpaperEnabled && wallpaperUrl) {
      body.classList.add('wallpaper-enabled');
      body.style.setProperty('--wallpaper-url', `url("${wallpaperUrl}")`);
      body.style.setProperty('--wallpaper-opacity', String(wallpaperOpacity));
    } else {
      body.classList.remove('wallpaper-enabled');
    }
  }, [wallpaperEnabled, wallpaperUrl, wallpaperOpacity]);

  // Auto-rotate wallpaper on new tab
  useEffect(() => {
    if (!wallpaperEnabled || !wallpaperAutoRotate) return;
    if (sessionStorage.getItem('wallpaperSessionActive')) return;
    sessionStorage.setItem('wallpaperSessionActive', 'true');

    const curatedWallpapers = CURATED_WALLPAPER_URLS;

    // Always use the curated list — these URLs get browser-cached after first load,
    // so only the first time each image is seen costs bandwidth.
    const choices = curatedWallpapers.filter(url => url !== wallpaperUrl);
    const pool = choices.length > 0 ? choices : curatedWallpapers;
    const nextWallpaper = pool[Math.floor(Math.random() * pool.length)];
    setWallpaperUrl(nextWallpaper);
    try { localStorage.setItem('wallpaperUrl', nextWallpaper); } catch { }
  }, []);

  // Load settings
  useEffect(() => {
    (async () => {
      const s = await getSettingsDB();
      const { geminiApiKey, modelName, visitCountThreshold, historyDays } = s || {};
      setSettings({
        geminiApiKey: geminiApiKey || '',
        modelName: modelName || '',
        visitCountThreshold: Number.isFinite(visitCountThreshold) ? String(visitCountThreshold) : '',
        historyDays: Number.isFinite(historyDays) ? String(historyDays) : ''
      });
    })();
  }, []);

  const handleFontSizeChange = (size) => {
    setAndSaveFontSize(size);
    setFontSize(size);
  };

  return (
    <ErrorBoundary>
      <div className={`popup-wrap ${themeClass} ${wallpaperEnabled ? 'wallpaper-enabled' : ''}`} style={{
        '--section-spacing': '24px',
        '--card-spacing': '16px',
        position: 'relative',
        minHeight: '100vh'
      }}>
        <div className="cooldesk-container">
          {/* Main Content - Overview Only */}
          <OverviewDashboard />
        </div>

        {/* Global Add Button */}
        {/* <GlobalAddButton
          workspaces={savedWorkspaces}
          onCreateWorkspace={handleCreateWorkspace}
          onAddUrlToWorkspace={handleAddUrlToWorkspace}
        /> */}

        {/* Floating Settings Button */}
        <button
          className="cooldesk-settings-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
          style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>

        {/* Settings Modal */}
        {showSettings && (
          <Suspense fallback={null}>
            <SettingsModal
              show={showSettings}
              onClose={() => setShowSettings(false)}
              settings={settings}
              onSave={(newSettings) => {
                setSettings(newSettings);
                saveSettingsDB(newSettings);
                try { sendMessage({ action: 'settingsUpdated', settings: newSettings }); } catch { }
              }}
              fontSize={fontSize}
              onFontSizeChange={handleFontSizeChange}
              onStartOnboarding={startOnboarding}
              wallpaperEnabled={wallpaperEnabled}
              wallpaperUrl={wallpaperUrl}
              wallpaperOpacity={wallpaperOpacity}
              wallpaperAutoRotate={wallpaperAutoRotate}
              onWallpaperEnabledChange={(v) => {
                setWallpaperEnabled(v);
                localStorage.setItem('wallpaperEnabled', String(v));
              }}
              onWallpaperUrlChange={(v) => {
                setWallpaperUrl(v);
                localStorage.setItem('wallpaperUrl', v);
              }}
              onWallpaperOpacityChange={(v) => {
                setWallpaperOpacity(v);
                localStorage.setItem('wallpaperOpacity', String(v));
              }}
              onWallpaperAutoRotateChange={(v) => {
                setWallpaperAutoRotate(v);
                localStorage.setItem('wallpaperAutoRotate', String(v));
              }}
            />
          </Suspense>
        )}

        {/* Onboarding Tour */}
        {shouldShowOnboarding && (
          <Suspense fallback={null}>
            <OnboardingTour
              onComplete={completeOnboarding}
              onSkip={skipOnboarding}
              autoPlay={!isManualStart}
            />
          </Suspense>
        )}
      </div>
    </ErrorBoundary>
  );
}
