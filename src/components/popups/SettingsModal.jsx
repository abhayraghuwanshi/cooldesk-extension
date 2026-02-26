import { faCog, faDatabase, faPalette, faRocket, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { DB_CONFIG, getUnifiedDB, listWorkspaces, saveSettings, saveWorkspace } from '../../db';
import { useSync } from '../../hooks/useSync'; // Added hook
import { getSyncStatus } from '../../services/conditionalSync';
import { isElectronApp } from '../../services/environmentDetector';
import { sendMessage, storageGet, storageSet } from '../../services/extensionApi';
import { loadSyncConfig } from '../../services/syncConfig';
import { setAndSaveFontFamily, setAndSaveFontSize } from '../../utils/fontUtils';
import AIModelsTab from '../settings/AIModelsTab';
import ExportData from '../settings/ExportData';
import TeamsTab from '../settings/TeamsTab';
import ThemesTab from '../settings/ThemesTab';

export function SettingsModal({
  show,
  onClose,
  settings,
  onSave,
  fontSize,
  onFontSizeChange,
  onStartOnboarding,
  wallpaperEnabled,
  wallpaperUrl,
  wallpaperOpacity,
  wallpaperAutoRotate,
  onWallpaperEnabledChange,
  onWallpaperUrlChange,
  onWallpaperOpacityChange,
  onWallpaperAutoRotateChange
}) {
  const { syncStatus: globalSyncStatus, triggerSync, lastSyncTime: globalLastSyncTime } = useSync(); // Use sync hook

  const [localSettings, setLocalSettings] = useState(settings || {});
  const [activeTabId, setActiveTabId] = useState('general'); // general, themes, data, display, about
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [basicSaved, setBasicSaved] = useState(false);

  // Settings State
  const [selectedTheme, setSelectedTheme] = useState('ai-midnight-nebula');
  const [fontFamily, setFontFamily] = useState('system');
  const [syncConfig, setSyncConfig] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncConfigLoading, setSyncConfigLoading] = useState(false);
  const [sessionTrackingEnabled, setSessionTrackingEnabled] = useState(true);

  // Auto-update State
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [extensionVersion, setExtensionVersion] = useState('');

  // Auto-backup State
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupFrequency, setBackupFrequency] = useState('weekly'); // daily, weekly, monthly
  const [lastBackupTime, setLastBackupTime] = useState(null);
  const [backupInProgress, setBackupInProgress] = useState(false);

  // Unsplash API Key State
  const [unsplashApiKey, setUnsplashApiKey] = useState('');

  // Check if running in Tauri/Electron app (for tab visibility)
  const isDesktopApp = isElectronApp();

  // --- Constants & Config ---
  const TABS = [
    { id: 'general', label: 'General', icon: faCog, component: null },
    // Unified AI Models tab - show in desktop app (combines Local + Cloud AI)
    ...(isDesktopApp ? [{ id: 'ai-models', label: 'AI Models', icon: faRocket, component: AIModelsTab }] : []),
    // Teams tab - only show in desktop app
    ...(isDesktopApp ? [{ id: 'teams', label: 'Teams (P2P)', icon: faUsers, component: TeamsTab }] : []),
    { id: 'themes', label: 'Aesthetics', icon: faPalette, component: ThemesTab },
    { id: 'data', label: 'Data & Sync', icon: faDatabase, component: ExportData },
    { id: 'about', label: 'Getting Started', icon: faRocket, component: null }
  ];



  const themes = [
    { id: 'ai-midnight-nebula', fontFamily: 'inter' },
    { id: 'cosmic-aurora', fontFamily: 'poppins' },
    { id: 'sunset-horizon', fontFamily: 'roboto' },
    { id: 'forest-depths', fontFamily: 'system' },
    { id: 'minimal-dark', fontFamily: 'inter' },
    { id: 'ocean-depths', fontFamily: 'poppins' },
    { id: 'cherry-blossom', fontFamily: 'poppins' },
    { id: 'arctic-frost', fontFamily: 'inter' },
    { id: 'volcanic-ember', fontFamily: 'roboto' },
    { id: 'neon-cyberpunk', fontFamily: 'jetbrains' },
    { id: 'white-cred', fontFamily: 'system' },
    { id: 'orange-warm', fontFamily: 'roboto' },
    { id: 'brown-earth', fontFamily: 'system' },
    { id: 'royal-purple', fontFamily: 'poppins' },
    { id: 'golden-honey', fontFamily: 'roboto' },
    { id: 'mint-sage', fontFamily: 'inter' },
    { id: 'crimson-fire', fontFamily: 'roboto' }
  ];

  // --- Effects ---

  useEffect(() => {
    if (show && settings) {
      setLocalSettings(settings); // Deep copy?
      setBasicSaved(Boolean((settings?.geminiApiKey || '').trim()));
    }
  }, [show, settings]);

  // Load preferences
  useEffect(() => {
    if (!show) return;
    try {
      const savedTheme = localStorage.getItem('cooldesk-theme') || 'crimson-fire';
      const savedFontFamily = localStorage.getItem('cooldesk-font-family');

      setSelectedTheme(savedTheme);

      if (savedFontFamily) {
        setFontFamily(savedFontFamily);
      } else {
        const selectedThemeData = themes.find(t => t.id === savedTheme);
        setFontFamily(selectedThemeData?.fontFamily || 'system');
      }

      // Load Session Tracking
      storageGet(['sessionTracking']).then((result) => {
        setSessionTrackingEnabled(result?.sessionTracking?.enabled !== false);
      });

      // Load Sync
      loadSettingsSync();

      // Load Workspaces
      loadLocalWorkspaces();

      // Load Extension Version
      try {
        const manifest = chrome.runtime?.getManifest ? chrome.runtime.getManifest() : { version: 'Electron' };
        setExtensionVersion(manifest.version);
      } catch { }

      // Load Auto-Update Preference
      storageGet(['autoUpdateEnabled']).then((result) => {
        setAutoUpdateEnabled(result?.autoUpdateEnabled !== false);
      });

      // Load Auto-Backup Preferences
      storageGet(['autoBackupEnabled', 'backupFrequency', 'lastBackupTime']).then((result) => {
        setAutoBackupEnabled(result?.autoBackupEnabled === true);
        setBackupFrequency(result?.backupFrequency || 'weekly');
        setLastBackupTime(result?.lastBackupTime || null);
      });

      // Load Unsplash API Key
      storageGet(['unsplashApiKey']).then((result) => {
        setUnsplashApiKey(result?.unsplashApiKey || '');
      });

    } catch (e) {
      console.warn('Error specific settings:', e);
    }
  }, [show]);

  // Listen for extension updates
  useEffect(() => {
    if (!show) return;

    const handleUpdateAvailable = (details) => {
      console.log('Extension update available:', details.version);
      setUpdateAvailable(true);

      // If auto-update is enabled, reload immediately
      storageGet(['autoUpdateEnabled']).then((result) => {
        if (result?.autoUpdateEnabled !== false) {
          console.log('Auto-update enabled, reloading extension...');
          if (chrome.runtime?.reload) chrome.runtime.reload();
        }
      });
    };

    // Add listener
    if (chrome.runtime?.onUpdateAvailable) {
      chrome.runtime.onUpdateAvailable.addListener(handleUpdateAvailable);
    }

    // Cleanup
    return () => {
      if (chrome.runtime?.onUpdateAvailable) {
        chrome.runtime.onUpdateAvailable.removeListener(handleUpdateAvailable);
      }
    };
  }, [show]);

  const loadSettingsSync = async () => {
    try {
      setSyncConfigLoading(true);
      const config = await loadSyncConfig();
      const status = getSyncStatus();
      setSyncConfig(config);
      setSyncStatus(status);
    } finally {
      setSyncConfigLoading(false);
    }
  };

  const loadLocalWorkspaces = async () => {
    try {
      const list = await listWorkspaces();
      const workspaceData = list?.data || list || [];
      setWorkspaces(Array.isArray(workspaceData) ? workspaceData : []);
    } catch (err) {
      console.error('Error loading workspaces', err);
    }
  };

  // --- Handlers ---

  const handleApplyTheme = (themeId, fontSizeId, fontFamilyId) => {
    const body = document.body;
    const html = document.documentElement;

    // Remove old theme classes from both body and html to be safe
    themes.forEach(t => {
      body.classList.remove(`bg-${t.id}`);
      html.classList.remove(`bg-${t.id}`);
    });

    // Add new theme class
    body.classList.add(`bg-${themeId}`);
    html.classList.add(`bg-${themeId}`); // Some styles might rely on root class

    // Force a repaint for any stubborn elements (rare but happens with glassmorphism)
    html.style.display = 'none';
    // eslint-disable-next-line no-unused-expressions
    html.offsetHeight;
    html.style.display = '';

    if (fontSizeId) setAndSaveFontSize(fontSizeId);
    if (fontFamilyId) setAndSaveFontFamily(fontFamilyId);

    try {
      localStorage.setItem('cooldesk-theme', themeId);
      // Dispatch event for components that might need manual update
      window.dispatchEvent(new CustomEvent('cooldesk-theme-changed', { detail: { themeId } }));
    } catch (e) { }
  };

  const handleThemeChange = (themeId) => {
    setSelectedTheme(themeId);
    handleApplyTheme(themeId, fontSize, fontFamily);
  };

  const handleFontFamilyChange = (familyId) => {
    setFontFamily(familyId);
    handleApplyTheme(selectedTheme, fontSize, familyId);
  };

  const handleFontSizeChange = (sizeId) => {
    onFontSizeChange(sizeId);
    handleApplyTheme(selectedTheme, sizeId, fontFamily);
  };

  const handleToggleSessionTracking = async (enabled) => {
    try {
      await sendMessage({ action: 'toggleSessionTracking', enabled });
      setSessionTrackingEnabled(enabled);
    } catch (err) {
      setError('Failed to toggle session tracking');
    }
  };

  const handleToggleAutoUpdate = async (enabled) => {
    try {
      await storageSet({ autoUpdateEnabled: enabled });
      setAutoUpdateEnabled(enabled);
    } catch (err) {
      setError('Failed to toggle auto-update');
    }
  };

  const handleCheckForUpdates = () => {
    if (!chrome.runtime?.requestUpdateCheck) {
      setError('Update check not available in this environment');
      return;
    }
    chrome.runtime.requestUpdateCheck((status, details) => {
      if (status === 'update_available') {
        setUpdateAvailable(true);
        setError(`Update available: v${details.version}`);
      } else if (status === 'no_update') {
        setError('You are running the latest version');
      } else if (status === 'throttled') {
        setError('Update check throttled. Try again later.');
      }
    });
  };

  const handleInstallUpdate = () => {
    if (chrome.runtime?.reload) chrome.runtime.reload();
  };

  const handleToggleAutoBackup = async (enabled) => {
    try {
      await storageSet({ autoBackupEnabled: enabled });
      setAutoBackupEnabled(enabled);

      if (enabled) {
        // Schedule next backup
        scheduleNextBackup();
      }
    } catch (err) {
      setError('Failed to toggle auto-backup');
    }
  };

  const handleBackupFrequencyChange = async (frequency) => {
    try {
      await storageSet({ backupFrequency: frequency });
      setBackupFrequency(frequency);

      if (autoBackupEnabled) {
        scheduleNextBackup();
      }
    } catch (err) {
      setError('Failed to update backup frequency');
    }
  };

  const handleUnsplashApiKeyChange = async (apiKey) => {
    try {
      await storageSet({ unsplashApiKey: apiKey });
      setUnsplashApiKey(apiKey);
    } catch (err) {
      setError('Failed to save Unsplash API key');
    }
  };

  const calculateNextBackupTime = (frequency) => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    switch (frequency) {
      case 'daily':
        return now + day;
      case 'weekly':
        return now + (7 * day);
      case 'monthly':
        return now + (30 * day);
      default:
        return now + (7 * day);
    }
  };

  const scheduleNextBackup = async () => {
    const nextTime = calculateNextBackupTime(backupFrequency);
    await storageSet({ nextBackupTime: nextTime });
  };

  const performManualBackup = async () => {
    setBackupInProgress(true);
    setError('');
    try {
      // Use the same export logic from ExportData
      const db = await getUnifiedDB();
      const data = { meta: { exportedAt: Date.now(), version: db.version }, stores: {}, storageLocal: {} };

      const storeNames = Object.values(DB_CONFIG.STORES);
      for (const storeName of storeNames) {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        const rows = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
        data.stores[storeName] = rows;
      }

      // Include chrome.storage.local data
      try {
        const { pinnedWorkspaces } = await storageGet(['pinnedWorkspaces']);
        data.storageLocal.pinnedWorkspaces = Array.isArray(pinnedWorkspaces) ? pinnedWorkspaces : [];

        const all = await storageGet(null);
        let notesByDate = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith('dailyNotes_') && k !== 'dailyNotesSummary' && k !== 'dailyNotesLastUpdate') {
            notesByDate[k] = v;
          }
        }
        data.storageLocal.dailyNotes = {
          notesByDate,
          summary: all.dailyNotesSummary || {},
          lastUpdate: all.dailyNotesLastUpdate || 0,
        };

        if (all.domainSelectors) data.storageLocal.domainSelectors = all.domainSelectors;
        if (all.platformSettings) data.storageLocal.platformSettings = all.platformSettings;
      } catch { /* ignore */ }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `cooldesk-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const now = Date.now();
      setLastBackupTime(now);
      await storageSet({ lastBackupTime: now });
      setError('Backup completed successfully');
    } catch (err) {
      console.error('[SettingsModal] Backup failed', err);
      setError(`Backup failed: ${err.message || err}`);
    } finally {
      setBackupInProgress(false);
    }
  };

  const markEdited = () => setBasicSaved(false);

  const handleSuggestCategories = async () => {
    // Copied logic from original
    setSuggesting(true);
    setError('');
    try {
      if (!basicSaved) { setError('Please Save & Continue in Basic before using AI Suggest'); return; }

      const { dashboardData } = await storageGet(['dashboardData']);
      const hist = Array.isArray(dashboardData?.history) ? dashboardData.history : [];
      const bms = Array.isArray(dashboardData?.bookmarks) ? dashboardData.bookmarks : [];
      const urls = [...hist, ...bms].map((it) => it?.url).filter(Boolean).slice(0, 150);

      if (!urls.length) { setError('No URLs available. Try Refresh Data first.'); return; }

      const resp = await sendMessage({ action: 'suggestCategories', urls }, { timeoutMs: 20000 });
      if (!resp?.ok) { setError(resp?.error || 'Failed to get suggestions'); return; }

      const cats = Array.isArray(resp.categories) ? resp.categories : [];
      const rows = cats.map(c => {
        if (typeof c === 'string') return { name: c.trim(), description: '' };
        return { name: c?.name?.trim() || '', description: c?.description?.trim() || '' };
      }).filter(r => r.name);

      const existing = Array.isArray(workspaces) ? workspaces : [];
      const norm = s => (s || '').trim().toLowerCase();

      for (const row of rows) {
        const found = existing.find(w => norm(w.name) === norm(row.name));
        const ws = found ? { ...found, description: row.description || found.description } : {
          id: 'ws_' + Date.now() + Math.random().toString(36).slice(2),
          name: row.name,
          description: row.description || '',
          createdAt: Date.now(),
          urls: []
        };
        await saveWorkspace(ws);
      }
      await loadLocalWorkspaces();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSuggesting(false);
    }
  };


  // --- Render Helpers ---

  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', animation: 'fadeIn 0.2s ease'
      }}>

      <div className="modal-content" style={{
        width: '100%', maxWidth: '1100px', height: '85vh',
        background: 'rgba(20, 20, 30, 0.85)',
        backdropFilter: 'blur(24px)',
        borderRadius: '24px',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 72px -12px rgba(0,0,0,0.5)',
        display: 'flex', overflow: 'hidden',
        color: '#fff', fontFamily: 'inherit'
      }}>

        {/* Sidebar */}
        <div style={{
          width: '280px',
          background: 'rgba(255,255,255,0.02)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column',
          padding: '24px 16px'
        }}>
          <div style={{ padding: '0 12px 24px 12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
              color: 'white'
            }}>
              <FontAwesomeIcon icon={faRocket} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>CoolDesk</h3>
              <div style={{ fontSize: 11, opacity: 0.5, color: '#fff' }}>Settings & Prefs</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  border: 'none',
                  background: activeTabId === tab.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: activeTabId === tab.id ? '#60a5fa' : '#9ca3af',
                  fontSize: '14px', fontWeight: activeTabId === tab.id ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
                onMouseEnter={e => {
                  if (activeTabId !== tab.id) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.color = '#e5e7eb';
                  }
                }}
                onMouseLeave={e => {
                  if (activeTabId !== tab.id) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#9ca3af';
                  }
                }}
              >
                <div style={{ width: 20, display: 'flex', justifyContent: 'center' }}>
                  <FontAwesomeIcon icon={tab.icon} />
                </div>
                {tab.label}
                {activeTabId === tab.id && (
                  <div style={{
                    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                    width: 3, height: '60%', background: '#60a5fa', borderRadius: '4px 0 0 4px'
                  }} />
                )}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.2)',
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.2)';
                e.currentTarget.style.color = '#9ca3af';
              }}
            >
              Close Settings
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

          {/* Header Bar */}
          <div style={{
            height: 64, borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px'
          }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>
              {TABS.find(t => t.id === activeTabId)?.label}
            </h2>
            <div style={{ display: 'flex', gap: 12 }}>
              {/* Quick Actions if needed */}
              {activeTabId === 'general' && (
                <div style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 99,
                  background: basicSaved ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                  color: basicSaved ? '#4ade80' : '#facc15', border: '1px solid currentColor'
                }}>
                  {basicSaved ? 'All Saved' : 'Unsaved Changes'}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
            {error && (
              <div style={{
                marginBottom: 24, padding: '12px 16px', borderRadius: 12,
                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171', fontSize: 13
              }}>
                {error}
              </div>
            )}

            {activeTabId === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                <section>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>Extension Updates</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Manage extension updates and version information.</p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Sync Status - NEW */}
                    <div style={{
                      padding: 16,
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                          Host Connection
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: syncStatus?.hostAvailable ? '#4ade80' : (syncStatus?.hostAvailable === false ? '#ef4444' : '#fbbf24'),
                            boxShadow: syncStatus?.hostAvailable ? '0 0 8px rgba(74, 222, 128, 0.5)' : 'none'
                          }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                          {syncStatus?.hostAvailable
                            ? 'Connected to Desktop App'
                            : (syncStatus?.hostAvailable === false ? 'Disconnected (Is the app running?)' : 'Checking connection...')}
                        </div>
                      </div>
                      {syncStatus?.hostAvailable === false && (
                        <button
                          onClick={() => loadSettingsSync()}
                          style={{
                            fontSize: 12, padding: '4px 10px', borderRadius: 6,
                            background: 'rgba(255,255,255,0.1)', color: '#fff',
                            border: 'none', cursor: 'pointer'
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </div>

                    {/* Manual Sync Control */}
                    <div style={{
                      padding: 16,
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 500, color: '#fff' }}>Force Sync</div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                          {globalSyncStatus === 'syncing'
                            ? 'Syncing data...'
                            : (globalLastSyncTime ? `Last synced: ${new Date(globalLastSyncTime).toLocaleTimeString()}` : 'Manually trigger a full sync')}
                        </div>
                      </div>
                      <button
                        onClick={triggerSync}
                        disabled={globalSyncStatus === 'syncing' || !syncStatus?.hostAvailable}
                        style={{
                          fontSize: 12, padding: '6px 12px', borderRadius: 6,
                          background: globalSyncStatus === 'syncing' ? 'rgba(255,255,255,0.05)' : 'rgba(59, 130, 246, 0.2)',
                          color: globalSyncStatus === 'syncing' ? '#9ca3af' : '#60a5fa',
                          border: '1px solid ' + (globalSyncStatus === 'syncing' ? 'transparent' : 'rgba(59, 130, 246, 0.3)'),
                          cursor: (globalSyncStatus === 'syncing' || !syncStatus?.hostAvailable) ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6,
                          transition: 'all 0.2s'
                        }}
                      >
                        <FontAwesomeIcon icon={faDatabase} spin={globalSyncStatus === 'syncing'} />
                        {globalSyncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
                      </button>
                    </div>

                    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

                    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

                    {/* Version Info */}

                    <div style={{
                      padding: 16,
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 500, color: '#fff' }}>Current Version</div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>v{extensionVersion}</div>
                      </div>
                      {updateAvailable && (
                        <div style={{
                          fontSize: 12,
                          padding: '4px 10px',
                          borderRadius: 99,
                          background: 'rgba(34, 197, 94, 0.15)',
                          color: '#4ade80',
                          border: '1px solid currentColor'
                        }}>
                          Update Available
                        </div>
                      )}
                    </div>

                    {/* Auto-Update Toggle */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: 16,
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.04)',
                      transition: 'all 0.2s',
                      color: '#fff'
                    }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'}
                    >
                      <input
                        type="checkbox"
                        checked={autoUpdateEnabled}
                        onChange={(e) => handleToggleAutoUpdate(e.target.checked)}
                        style={{ width: 18, height: 18, accentColor: '#3b82f6' }}
                      />
                      <div>
                        <div style={{ fontWeight: 500 }}>Enable Auto-Update</div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                          Automatically install updates when available (requires extension reload)
                        </div>
                      </div>
                    </label>

                    {/* Update Actions */}
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button
                        onClick={handleCheckForUpdates}
                        style={{
                          flex: 1,
                          padding: '12px 16px',
                          borderRadius: 12,
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: 'rgba(255,255,255,0.05)',
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        }}
                      >
                        Check for Updates
                      </button>

                      {updateAvailable && (
                        <button
                          onClick={handleInstallUpdate}
                          style={{
                            flex: 1,
                            padding: '12px 16px',
                            borderRadius: 12,
                            border: 'none',
                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                            color: '#fff',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.4)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
                          }}
                        >
                          Install Update Now
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

                <section>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>Auto-Backup</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Automatically backup your data on a schedule.</p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Backup Status */}
                    {lastBackupTime && (
                      <div style={{
                        padding: 16,
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.04)'
                      }}>
                        <div style={{ fontWeight: 500, color: '#fff', marginBottom: 4 }}>Last Backup</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>
                          {new Date(lastBackupTime).toLocaleString()}
                        </div>
                      </div>
                    )}

                    {/* Auto-Backup Toggle */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: 16,
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.04)',
                      transition: 'all 0.2s',
                      color: '#fff'
                    }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'}
                    >
                      <input
                        type="checkbox"
                        checked={autoBackupEnabled}
                        onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                        style={{ width: 18, height: 18, accentColor: '#3b82f6' }}
                      />
                      <div>
                        <div style={{ fontWeight: 500 }}>Enable Auto-Backup</div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                          Automatically backup your data based on the selected frequency
                        </div>
                      </div>
                    </label>

                    {/* Backup Frequency */}
                    {autoBackupEnabled && (
                      <div style={{
                        padding: 16,
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.04)'
                      }}>
                        <div style={{ fontWeight: 500, color: '#fff', marginBottom: 12 }}>Backup Frequency</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {['daily', 'weekly', 'monthly'].map(freq => (
                            <button
                              key={freq}
                              onClick={() => handleBackupFrequencyChange(freq)}
                              style={{
                                flex: 1,
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: backupFrequency === freq ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                                background: backupFrequency === freq ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)',
                                color: backupFrequency === freq ? '#60a5fa' : '#fff',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                textTransform: 'capitalize'
                              }}
                            >
                              {freq}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Manual Backup Button */}
                    <button
                      onClick={performManualBackup}
                      disabled={backupInProgress}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: backupInProgress ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                        color: backupInProgress ? '#9ca3af' : '#fff',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: backupInProgress ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => {
                        if (!backupInProgress) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!backupInProgress) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        }
                      }}
                    >
                      {backupInProgress ? 'Backing up...' : 'Backup Now'}
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTabId === 'ai-models' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                <section>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>AI Configuration</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Configure local on-device AI or cloud-based AI services.</p>
                  </div>
                  <AIModelsTab
                    localSettings={localSettings}
                    setLocalSettings={setLocalSettings}
                    markEdited={markEdited}
                    basicSaved={basicSaved}
                    setBasicSaved={setBasicSaved}
                    suggesting={suggesting}
                    error={error}
                    setError={setError}
                    handleSuggestCategories={handleSuggestCategories}
                    saveSettingsDB={saveSettings}
                    storageSet={storageSet}
                  />
                </section>

                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

                <section>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>Smart Detection</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Automatically detect projects from your browser activity.</p>
                  </div>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12,
                    cursor: 'pointer', border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.2s',
                    color: '#fff'
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'}
                  >
                    <input
                      type="checkbox"
                      checked={sessionTrackingEnabled}
                      onChange={(e) => handleToggleSessionTracking(e.target.checked)}
                      style={{ width: 18, height: 18, accentColor: '#3b82f6' }}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>Enable Session Tracking</div>
                      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>Track tabs to auto-categorize URLs into workspaces</div>
                    </div>
                  </label>
                </section>
              </div>
            )}

            {activeTabId === 'teams' && (
              <TeamsTab />
            )}

            {activeTabId === 'themes' && (
              <ThemesTab
                selectedTheme={selectedTheme}
                fontSize={fontSize}
                fontFamily={fontFamily}
                onThemeChange={handleThemeChange}
                onFontSizeChange={handleFontSizeChange}
                onFontFamilyChange={handleFontFamilyChange}
                wallpaperEnabled={wallpaperEnabled}
                wallpaperUrl={wallpaperUrl}
                wallpaperOpacity={wallpaperOpacity}
                wallpaperAutoRotate={wallpaperAutoRotate}
                onWallpaperEnabledChange={onWallpaperEnabledChange}
                onWallpaperUrlChange={onWallpaperUrlChange}
                onWallpaperOpacityChange={onWallpaperOpacityChange}
                onWallpaperAutoRotateChange={onWallpaperAutoRotateChange}
                unsplashApiKey={unsplashApiKey}
                onUnsplashApiKeyChange={handleUnsplashApiKeyChange}
              />
            )}

            {activeTabId === 'data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                <section>
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>Data Export</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Export your notes, history, and settings.</p>
                  </div>
                  <ExportData />
                </section>
              </div>
            )}



            {activeTabId === 'about' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 40, color: '#fff' }}>
                <div style={{
                  width: 80, height: 80, borderRadius: 24,
                  background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 40, marginBottom: 24, boxShadow: '0 10px 30px rgba(59, 130, 246, 0.4)',
                  color: 'white'
                }}>
                  <FontAwesomeIcon icon={faRocket} />
                </div>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>CoolDesk 2.0</h2>
                <p style={{ maxWidth: 400, lineHeight: 1.6, opacity: 0.6, marginBottom: 32 }}>
                  Your intelligent workspace organizer. Use AI to auto-sort your tabs, manage tasks with contextual notes, and boost your productivity.
                </p>
                <button onClick={() => { if (onStartOnboarding) { onStartOnboarding(); onClose(); } }}
                  style={{
                    padding: '12px 32px', borderRadius: 99, border: 'none',
                    background: '#fff', color: '#000', fontWeight: 600, cursor: 'pointer',
                    fontSize: 15, boxShadow: '0 10px 20px rgba(255,255,255,0.1)'
                  }}
                >
                  Start Onboarding Tour
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
