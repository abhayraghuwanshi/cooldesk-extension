import { faCog, faDatabase, faPalette, faRocket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { DB_CONFIG, getUnifiedDB, listWorkspaces, saveSettings, saveWorkspace } from '../../db';
import { useSync } from '../../hooks/useSync';
import { getSyncStatus } from '../../services/conditionalSync';
import { isElectronApp } from '../../services/environmentDetector';
import { sendMessage, storageGet, storageSet } from '../../services/extensionApi';
import { loadSyncConfig, toggleHostSync } from '../../services/syncConfig';
import { setAndSaveFontFamily, setAndSaveFontSize } from '../../utils/fontUtils';
import AIModelsTab from '../settings/AIModelsTab';
import ExportData from '../settings/ExportData';
import TeamsTab from '../settings/TeamsTab';
import ThemesTab from '../settings/ThemesTab';
import WorkspaceCleanupSettings from '../settings/WorkspaceCleanupSettings';

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
  const { syncStatus: globalSyncStatus, triggerSync, lastSyncTime: globalLastSyncTime } = useSync();

  const [localSettings, setLocalSettings] = useState(settings || {});
  const [activeTabId, setActiveTabId] = useState('general');
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [basicSaved, setBasicSaved] = useState(false);

  const [selectedTheme, setSelectedTheme] = useState('ai-midnight-nebula');
  const [fontFamily, setFontFamily] = useState('system');
  const [syncConfig, setSyncConfig] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [hostSyncEnabled, setHostSyncEnabled] = useState(true);
  const [syncConfigLoading, setSyncConfigLoading] = useState(false);
  const [sessionTrackingEnabled, setSessionTrackingEnabled] = useState(true);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [extensionVersion, setExtensionVersion] = useState('');

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupFrequency, setBackupFrequency] = useState('weekly');
  const [lastBackupTime, setLastBackupTime] = useState(null);
  const [backupInProgress, setBackupInProgress] = useState(false);

  const [spotlightShortcut, setSpotlightShortcut] = useState('Alt+K');
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);

  const [unsplashApiKey, setUnsplashApiKey] = useState('');
  const [autoGroupEnabled, setAutoGroupEnabled] = useState(false);

  const isDesktopApp = isElectronApp();

  const TABS = [
    { id: 'general',    label: 'General',    icon: faCog      },
    { id: 'appearance', label: 'Appearance', icon: faPalette  },
    { id: 'sync-data',  label: 'Sync & Data', icon: faDatabase },
    { id: 'local-ai',   label: 'Local AI',   icon: faRocket   },
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

  useEffect(() => {
    if (show && settings) {
      setLocalSettings(settings);
      setBasicSaved(Boolean((settings?.geminiApiKey || '').trim()));
    }
  }, [show, settings]);

  useEffect(() => {
    if (!show) return;
    try {
      const savedTheme = localStorage.getItem('cooldesk-theme') || 'crimson-fire';
      const savedFontFamily = localStorage.getItem('cooldesk-font-family');
      setSelectedTheme(savedTheme);
      onWallpaperEnabledChange(savedTheme === 'wallpaper-custom');
      if (savedFontFamily) {
        setFontFamily(savedFontFamily);
      } else {
        const selectedThemeData = themes.find(t => t.id === savedTheme);
        setFontFamily(selectedThemeData?.fontFamily || 'system');
      }

      storageGet(['sessionTracking']).then((result) => {
        setSessionTrackingEnabled(result?.sessionTracking?.enabled !== false);
      });

      loadSettingsSync();
      loadLocalWorkspaces();

      try {
        const manifest = chrome.runtime?.getManifest ? chrome.runtime.getManifest() : { version: 'Electron' };
        setExtensionVersion(manifest.version);
      } catch { }

      storageGet(['autoUpdateEnabled']).then((result) => {
        setAutoUpdateEnabled(result?.autoUpdateEnabled !== false);
      });

      storageGet(['autoBackupEnabled', 'backupFrequency', 'lastBackupTime']).then((result) => {
        setAutoBackupEnabled(result?.autoBackupEnabled === true);
        setBackupFrequency(result?.backupFrequency || 'weekly');
        setLastBackupTime(result?.lastBackupTime || null);
      });

      storageGet(['unsplashApiKey']).then((result) => {
        setUnsplashApiKey(result?.unsplashApiKey || '');
      });

      storageGet(['autoGroupEnabled']).then((result) => {
        setAutoGroupEnabled(result?.autoGroupEnabled || false);
      });

      try {
        if (window.electronAPI?.getSettings) {
          window.electronAPI.getSettings().then((hostSettings) => {
            const stored = hostSettings?.spotlightShortcut;
            setSpotlightShortcut((typeof stored === 'string' && stored.trim()) ? stored.trim() : 'Alt+K');
          }).catch(() => setSpotlightShortcut('Alt+K'));
        } else {
          setSpotlightShortcut('Alt+K');
        }
      } catch {
        setSpotlightShortcut('Alt+K');
      }
    } catch (e) {
      console.warn('Error loading settings:', e);
    }
  }, [show]);

  const updateSpotlightShortcut = async (value) => {
    const trimmed = (value || '').trim();
    setSpotlightShortcut(trimmed || 'Alt+K');
    try {
      if (window.electronAPI?.setSettings) {
        const result = await window.electronAPI.setSettings({ spotlightShortcut: trimmed || 'Alt+K' });
        if (result?.ok === false) {
          setError(result.error || 'Failed to update spotlight shortcut');
          if (result?.spotlightShortcut) setSpotlightShortcut(result.spotlightShortcut);
          return;
        }
        if (result?.spotlightShortcut) setSpotlightShortcut(result.spotlightShortcut);
        setError('');
      }
    } catch (err) {
      setError(err?.message || 'Failed to update spotlight shortcut');
    }
  };

  const normalizeShortcutKey = (key) => {
    if (key === ' ' || key === 'Spacebar') return 'Space';
    if (key === 'ArrowUp') return 'Up';
    if (key === 'ArrowDown') return 'Down';
    if (key === 'ArrowLeft') return 'Left';
    if (key === 'ArrowRight') return 'Right';
    if (key === 'Esc') return 'Escape';
    if (key === '+') return 'Plus';
    if (key.length === 1) return key.toUpperCase();
    return key;
  };

  const handleShortcutKeyDown = (e) => {
    if (!isRecordingShortcut) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setIsRecordingShortcut(false); return; }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    const key = normalizeShortcutKey(e.key);
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(key)) parts.push(key);
    void updateSpotlightShortcut(parts.join('+') || 'Alt+K');
    setIsRecordingShortcut(false);
  };

  useEffect(() => {
    if (!show) return;
    const handleUpdateAvailable = (details) => {
      setUpdateAvailable(true);
      storageGet(['autoUpdateEnabled']).then((result) => {
        if (result?.autoUpdateEnabled !== false && chrome.runtime?.reload) chrome.runtime.reload();
      });
    };
    if (chrome.runtime?.onUpdateAvailable) chrome.runtime.onUpdateAvailable.addListener(handleUpdateAvailable);
    return () => {
      if (chrome.runtime?.onUpdateAvailable) chrome.runtime.onUpdateAvailable.removeListener(handleUpdateAvailable);
    };
  }, [show]);

  const loadSettingsSync = async () => {
    try {
      setSyncConfigLoading(true);
      const config = await loadSyncConfig();
      const status = getSyncStatus();
      setSyncConfig(config);
      setSyncStatus(status);
      setHostSyncEnabled(config.enableHostSync !== false);
    } finally {
      setSyncConfigLoading(false);
    }
  };

  const handleToggleHostSync = async (enabled) => {
    try {
      await toggleHostSync(enabled);
      setHostSyncEnabled(enabled);
    } catch {
      setError('Failed to toggle host sync');
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

  const handleApplyTheme = (themeId, fontSizeId, fontFamilyId) => {
    const body = document.body;
    const html = document.documentElement;
    themes.forEach(t => { body.classList.remove(`bg-${t.id}`); html.classList.remove(`bg-${t.id}`); });
    body.classList.add(`bg-${themeId}`);
    html.classList.add(`bg-${themeId}`);
    html.style.display = 'none';
    // eslint-disable-next-line no-unused-expressions
    html.offsetHeight;
    html.style.display = '';
    if (fontSizeId) setAndSaveFontSize(fontSizeId);
    if (fontFamilyId) setAndSaveFontFamily(fontFamilyId);
    try {
      localStorage.setItem('cooldesk-theme', themeId);
      window.dispatchEvent(new CustomEvent('cooldesk-theme-changed', { detail: { themeId } }));
    } catch { }
  };

  const handleThemeChange = (themeId) => { setSelectedTheme(themeId); handleApplyTheme(themeId, fontSize, fontFamily); };
  const handleFontFamilyChange = (familyId) => { setFontFamily(familyId); handleApplyTheme(selectedTheme, fontSize, familyId); };
  const handleFontSizeChange = (sizeId) => { onFontSizeChange(sizeId); handleApplyTheme(selectedTheme, sizeId, fontFamily); };

  const handleToggleSessionTracking = async (enabled) => {
    try {
      await sendMessage({ action: 'toggleSessionTracking', enabled });
      setSessionTrackingEnabled(enabled);
    } catch { setError('Failed to toggle session tracking'); }
  };

  const handleToggleAutoUpdate = async (enabled) => {
    try {
      await storageSet({ autoUpdateEnabled: enabled });
      setAutoUpdateEnabled(enabled);
    } catch { setError('Failed to toggle auto-update'); }
  };

  const handleCheckForUpdates = async () => {
    if (!chrome.runtime?.requestUpdateCheck) { setError('Update check not available in this environment'); return; }
    try {
      const { status, version } = await chrome.runtime.requestUpdateCheck();
      if (status === 'update_available') { setUpdateAvailable(true); setError(`Update available: v${version}`); }
      else if (status === 'no_update') setError('You are running the latest version');
      else if (status === 'throttled') setError('Update check throttled. Try again later.');
    } catch { setError('Update check failed'); }
  };

  const handleInstallUpdate = () => { if (chrome.runtime?.reload) chrome.runtime.reload(); };

  const handleToggleAutoBackup = async (enabled) => {
    try {
      await storageSet({ autoBackupEnabled: enabled });
      setAutoBackupEnabled(enabled);
      if (enabled) scheduleNextBackup();
    } catch { setError('Failed to toggle auto-backup'); }
  };

  const handleBackupFrequencyChange = async (frequency) => {
    try {
      await storageSet({ backupFrequency: frequency });
      setBackupFrequency(frequency);
      if (autoBackupEnabled) scheduleNextBackup();
    } catch { setError('Failed to update backup frequency'); }
  };

  const handleToggleAutoGroup = async (enabled) => {
    try {
      await storageSet({ autoGroupEnabled: enabled });
      setAutoGroupEnabled(enabled);
      sendMessage({ type: 'TOGGLE_AUTO_GROUP', enabled }).catch(() => {});
    } catch { setError('Failed to toggle auto-group'); }
  };

  const handleUnsplashApiKeyChange = async (apiKey) => {
    try {
      await storageSet({ unsplashApiKey: apiKey });
      setUnsplashApiKey(apiKey);
    } catch { setError('Failed to save Unsplash API key'); }
  };

  const calculateNextBackupTime = (frequency) => {
    const day = 24 * 60 * 60 * 1000;
    return Date.now() + ({ daily: day, weekly: 7 * day, monthly: 30 * day }[frequency] ?? 7 * day);
  };

  const scheduleNextBackup = async () => {
    await storageSet({ nextBackupTime: calculateNextBackupTime(backupFrequency) });
  };

  const performManualBackup = async () => {
    setBackupInProgress(true);
    setError('');
    try {
      const db = await getUnifiedDB();
      const data = { meta: { exportedAt: Date.now(), version: db.version }, stores: {}, storageLocal: {} };
      const storeNames = Object.values(DB_CONFIG.STORES);
      for (const storeName of storeNames) {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        data.stores[storeName] = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      }
      try {
        const { pinnedWorkspaces } = await storageGet(['pinnedWorkspaces']);
        data.storageLocal.pinnedWorkspaces = Array.isArray(pinnedWorkspaces) ? pinnedWorkspaces : [];
        const all = await storageGet(null);
        let notesByDate = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith('dailyNotes_') && k !== 'dailyNotesSummary' && k !== 'dailyNotesLastUpdate') notesByDate[k] = v;
        }
        data.storageLocal.dailyNotes = { notesByDate, summary: all.dailyNotesSummary || {}, lastUpdate: all.dailyNotesLastUpdate || 0 };
        if (all.domainSelectors) data.storageLocal.domainSelectors = all.domainSelectors;
        if (all.platformSettings) data.storageLocal.platformSettings = all.platformSettings;
      } catch { }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cooldesk-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const now = Date.now();
      setLastBackupTime(now);
      await storageSet({ lastBackupTime: now });
      setError('Backup completed successfully');
    } catch (err) {
      setError(`Backup failed: ${err.message || err}`);
    } finally {
      setBackupInProgress(false);
    }
  };

  // ── Shared UI helpers ────────────────────────────────────────────────────────

  const Row = ({ children, style }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.04)', transition: 'border-color 0.2s',
      ...style
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'}
    >
      {children}
    </div>
  );

  const SectionHeader = ({ title, description }) => (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px 0', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.5 }}>{title}</h3>
      {description && <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: 0 }}>{description}</p>}
    </div>
  );

  const Toggle = ({ checked, onChange, accentColor = '#3b82f6' }) => (
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor, flexShrink: 0, cursor: 'pointer' }} />
  );

  const Divider = () => <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />;

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!show) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', animation: 'fadeIn 0.2s ease'
      }}
    >
      <div className="modal-content" style={{
        width: '100%', maxWidth: '960px', height: '82vh',
        background: 'rgba(20, 20, 30, 0.92)',
        backdropFilter: 'blur(24px)',
        borderRadius: '20px',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 72px -12px rgba(0,0,0,0.5)',
        display: 'flex', overflow: 'hidden',
        color: '#fff', fontFamily: 'inherit'
      }}>

        {/* Sidebar */}
        <div style={{
          width: '200px', flexShrink: 0,
          background: 'rgba(255,255,255,0.02)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column',
          padding: '20px 12px'
        }}>
          {/* Logo */}
          <div style={{ padding: '0 8px 20px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: 'white', flexShrink: 0
            }}>
              <FontAwesomeIcon icon={faRocket} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>CoolDesk</div>
              <div style={{ fontSize: 10, opacity: 0.4, color: '#fff' }}>Settings</div>
            </div>
          </div>

          {/* Nav */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10, border: 'none',
                  background: activeTabId === tab.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: activeTabId === tab.id ? '#60a5fa' : '#9ca3af',
                  fontSize: 13, fontWeight: activeTabId === tab.id ? 600 : 500,
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  position: 'relative'
                }}
                onMouseEnter={e => { if (activeTabId !== tab.id) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#e5e7eb'; } }}
                onMouseLeave={e => { if (activeTabId !== tab.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; } }}
              >
                <FontAwesomeIcon icon={tab.icon} style={{ width: 14, opacity: 0.8 }} />
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

          {/* Footer */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {onStartOnboarding && (
              <button
                onClick={() => { onStartOnboarding(); onClose(); }}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none',
                  background: 'transparent', color: 'rgba(255,255,255,0.35)',
                  fontSize: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent'; }}
              >
                Getting Started →
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(0,0,0,0.15)', color: '#9ca3af',
                cursor: 'pointer', fontSize: 12, fontWeight: 500, transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.15)'; e.currentTarget.style.color = '#9ca3af'; }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Header */}
          <div style={{
            height: 56, borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px',
            flexShrink: 0
          }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff' }}>
              {TABS.find(t => t.id === activeTabId)?.label}
            </h2>
            {error && (
              <div style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 99, maxWidth: 320,
                background: error.includes('success') || error.includes('latest') ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                color: error.includes('success') || error.includes('latest') ? '#4ade80' : '#f87171',
                border: '1px solid currentColor', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {error}
              </div>
            )}
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px' }}>

            {/* ── GENERAL ─────────────────────────────────────────────────────── */}
            {activeTabId === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

                {isDesktopApp && (
                  <section>
                    <SectionHeader title="Spotlight Shortcut" description="Global hotkey to open the Spotlight launcher." />
                    <div style={{ padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div
                          tabIndex={0}
                          onKeyDown={handleShortcutKeyDown}
                          onClick={(e) => { e.currentTarget.focus(); setIsRecordingShortcut(true); }}
                          style={{
                            padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                            border: isRecordingShortcut ? '1px solid rgba(96,165,250,0.9)' : '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(15,23,42,0.9)', color: '#e5e7eb', fontSize: 13,
                            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32
                          }}
                        >
                          {(spotlightShortcut || 'Alt+K').split('+').map((part) => (
                            <span key={part} style={{
                              padding: '2px 7px', borderRadius: 5,
                              background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(148,163,184,0.6)', fontSize: 12
                            }}>{part}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsRecordingShortcut(prev => !prev)}
                          style={{
                            padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                            border: '1px solid rgba(148,163,184,0.6)',
                            background: isRecordingShortcut ? 'rgba(37,99,235,0.2)' : 'rgba(15,23,42,0.9)',
                            color: '#e5e7eb'
                          }}
                        >
                          {isRecordingShortcut ? 'Stop' : 'Change'}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.8)' }}>
                        {isRecordingShortcut ? 'Press your new shortcut now (Esc to cancel).' : 'Click "Change" then press your preferred key combination.'}
                      </div>
                    </div>
                  </section>
                )}

                <section>
                  <SectionHeader title="Behaviour" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                      <Toggle checked={autoGroupEnabled} onChange={handleToggleAutoGroup} accentColor="#22c55e" />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Auto-Group Tabs by Domain</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Group tabs from the same site together automatically</div>
                      </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                      <Toggle checked={sessionTrackingEnabled} onChange={handleToggleSessionTracking} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Session Tracking</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Track tabs to auto-categorize URLs into workspaces</div>
                      </div>
                    </label>
                  </div>
                </section>

                <section>
                  <SectionHeader title="Updates" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Row>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Current Version</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>v{extensionVersion}</div>
                      </div>
                      {updateAvailable && (
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid currentColor' }}>
                          Update Available
                        </span>
                      )}
                    </Row>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                      <Toggle checked={autoUpdateEnabled} onChange={handleToggleAutoUpdate} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Auto-Update</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Automatically install updates when available</div>
                      </div>
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={handleCheckForUpdates}
                        style={{
                          flex: 1, padding: '10px 16px', borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                          color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      >
                        Check for Updates
                      </button>
                      {updateAvailable && (
                        <button
                          onClick={handleInstallUpdate}
                          style={{
                            flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none',
                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                          }}
                        >
                          Install Update
                        </button>
                      )}
                    </div>
                  </div>
                </section>

              </div>
            )}

            {/* ── APPEARANCE ──────────────────────────────────────────────────── */}
            {activeTabId === 'appearance' && (
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

            {/* ── SYNC & DATA ──────────────────────────────────────────────────── */}
            {activeTabId === 'sync-data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

                <section>
                  <SectionHeader title="Desktop Sync" description="Sync browser data with the CoolDesk desktop app over WebSocket (port 4545)." />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                      <Toggle checked={hostSyncEnabled} onChange={handleToggleHostSync} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Enable Host Sync</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Connect to desktop app</div>
                      </div>
                    </label>

                    <Row style={{ opacity: hostSyncEnabled ? 1 : 0.4 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                          Connection
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                            background: !hostSyncEnabled ? '#64748b' : syncStatus?.hostAvailable ? '#4ade80' : (syncStatus?.hostAvailable === false ? '#ef4444' : '#fbbf24'),
                          }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
                          {!hostSyncEnabled ? 'Disabled'
                            : syncStatus?.hostAvailable ? 'Connected'
                            : syncStatus?.hostAvailable === false ? 'Disconnected — is the app running?'
                            : 'Checking...'}
                        </div>
                      </div>
                      {hostSyncEnabled && !syncStatus?.hostAvailable && (
                        <button onClick={loadSettingsSync} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                          Retry
                        </button>
                      )}
                    </Row>

                    <Row>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Force Sync</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
                          {globalSyncStatus === 'syncing' ? 'Syncing...' : globalLastSyncTime ? `Last synced ${new Date(globalLastSyncTime).toLocaleTimeString()}` : 'Trigger a full sync now'}
                        </div>
                      </div>
                      <button
                        onClick={triggerSync}
                        disabled={globalSyncStatus === 'syncing' || !syncStatus?.hostAvailable}
                        style={{
                          fontSize: 12, padding: '6px 12px', borderRadius: 8,
                          background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                          border: '1px solid rgba(59,130,246,0.3)', cursor: 'pointer',
                          opacity: (globalSyncStatus === 'syncing' || !syncStatus?.hostAvailable) ? 0.4 : 1
                        }}
                      >
                        <FontAwesomeIcon icon={faDatabase} spin={globalSyncStatus === 'syncing'} style={{ marginRight: 6 }} />
                        {globalSyncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
                      </button>
                    </Row>
                  </div>
                </section>

                <Divider />

                <section>
                  <SectionHeader title="Auto-Backup" description="Automatically download a backup file on a schedule." />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {lastBackupTime && (
                      <Row>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>Last Backup</div>
                          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{new Date(lastBackupTime).toLocaleString()}</div>
                        </div>
                      </Row>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                      <Toggle checked={autoBackupEnabled} onChange={handleToggleAutoBackup} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Auto-Backup</div>
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Automatically backup on a schedule</div>
                      </div>
                    </label>
                    {autoBackupEnabled && (
                      <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Frequency</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {['daily', 'weekly', 'monthly'].map(freq => (
                            <button key={freq} onClick={() => handleBackupFrequencyChange(freq)} style={{
                              flex: 1, padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                              border: backupFrequency === freq ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                              background: backupFrequency === freq ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                              color: backupFrequency === freq ? '#60a5fa' : '#fff',
                              cursor: 'pointer', textTransform: 'capitalize'
                            }}>{freq}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={performManualBackup} disabled={backupInProgress}
                      style={{
                        padding: '10px 16px', borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: backupInProgress ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
                        color: backupInProgress ? '#9ca3af' : '#fff',
                        fontSize: 13, fontWeight: 500, cursor: backupInProgress ? 'not-allowed' : 'pointer', transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => { if (!backupInProgress) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                      onMouseLeave={e => { if (!backupInProgress) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    >
                      {backupInProgress ? 'Backing up...' : 'Backup Now'}
                    </button>
                  </div>
                </section>

                <Divider />

                <section>
                  <SectionHeader title="Workspace Cleanup" />
                  <WorkspaceCleanupSettings />
                </section>

                <Divider />

                <section>
                  <SectionHeader title="Export Data" description="Export your notes, history, and settings." />
                  <ExportData />
                </section>

              </div>
            )}

            {/* ── LOCAL AI ────────────────────────────────────────────────────── */}
            {activeTabId === 'local-ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

                <section>
                  <SectionHeader title="AI Models" description="Configure on-device AI for categorization, summarization, and smart features." />
                  <AIModelsTab />
                </section>

                {isDesktopApp && (
                  <>
                    <Divider />
                    <section>
                      <SectionHeader title="Teams (P2P)" description="Peer-to-peer collaboration features." />
                      <TeamsTab />
                    </section>
                  </>
                )}

              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
