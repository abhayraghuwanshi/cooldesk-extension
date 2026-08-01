import { faCog, faDatabase, faPalette, faRocket, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import logo from '../../../logo-2.png';

const isTauri = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
async function tauriInvoke(cmd, args) {
  if (!isTauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}
import { listWorkspaces } from '../../db';
import { useSync } from '../../shared/hooks/useSync';
import { getSyncStatus } from '../../services/conditionalSync';
import { isElectronApp } from '../../services/environmentDetector';
import { sendMessage, storageGet, storageSet } from '../../services/extensionApi';
import { calculateNextBackupTime, deleteBackup, getBackupsDir, listBackups, readBackup, runBackup } from '../../services/backupService';
import { parseBackup, restoreBackup } from '../../services/backupRestore';
import { checkHostAvailable, loadSyncConfig, toggleHostSync } from '../../services/syncConfig';
import { setAndSaveFontFamily, setAndSaveFontSize } from '../../utils/fontUtils';
import { isAnalyticsEnabled, setAnalyticsEnabled } from '../../services/analytics';
import { checkForUpdate, getUpdateState, installUpdate } from '../../services/updateService';
import { TEAM_FEATURE_ENABLED } from '../../config/features';
import AIModelsTab from './parts/AIModelsTab';
import ExportData from './parts/ExportData';
import TeamsTab from './parts/TeamsTab';
import ThemesTab from './parts/ThemesTab';
import WorkspaceCleanupSettings from './parts/WorkspaceCleanupSettings';

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

  // Seeded from the shared service so Settings agrees with the header pill
  // without re-checking (Chrome throttles requestUpdateCheck hard).
  const [updateAvailable, setUpdateAvailable] = useState(() => !!getUpdateState().info);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [extensionVersion, setExtensionVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState(() => getUpdateState().info?.latest || '');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupFrequency, setBackupFrequency] = useState('weekly');
  const [lastBackupTime, setLastBackupTime] = useState(null);
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [savedBackups, setSavedBackups] = useState([]);
  const [showBackupList, setShowBackupList] = useState(false);
  // Path of the backup awaiting confirmation — restore overwrites live data, so
  // it's a deliberate two-step rather than a single click.
  const [confirmRestorePath, setConfirmRestorePath] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);

  const [spotlightShortcut, setSpotlightShortcut] = useState('Alt+K');
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);

  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(true);

  const [unsplashApiKey, setUnsplashApiKey] = useState('');
  const [autoGroupEnabled, setAutoGroupEnabled] = useState(false);

  const isDesktopApp = isElectronApp();

  const TABS = [
    { id: 'general',    label: 'General',    icon: faCog     },
    { id: 'appearance', label: 'Appearance', icon: faPalette },
    { id: 'local-ai',   label: 'Local AI',   icon: faRocket  },
    ...(isDesktopApp && TEAM_FEATURE_ENABLED ? [{ id: 'team', label: 'Team', icon: faUsers }] : []),
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

      (async () => {
        try {
          if (isTauri) {
            const v = await tauriInvoke('get_app_version');
            if (v) setExtensionVersion(v);
          } else if (window.electronAPI?.getVersion) {
            const v = await window.electronAPI.getVersion();
            if (v) setExtensionVersion(v);
          } else if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
            setExtensionVersion(chrome.runtime.getManifest().version);
          }
        } catch { }
      })();

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

      setAnalyticsEnabledState(isAnalyticsEnabled());

      if (isTauri) {
        tauriInvoke('get_launch_at_login').then((enabled) => {
          setAutostartEnabled(!!enabled);
        }).catch(() => {});
      }

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

  // Capture keystrokes globally while recording — no div focus needed
  useEffect(() => {
    if (!isRecordingShortcut) return;
    window.addEventListener('keydown', handleShortcutKeyDown, true);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown, true);
  }, [isRecordingShortcut]);

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

  const loadSettingsSync = async (forceProbe = false) => {
    try {
      setSyncConfigLoading(true);
      const config = await loadSyncConfig();
      const status = getSyncStatus();
      setSyncConfig(config);
      setHostSyncEnabled(config.enableHostSync !== false);
      // getSyncStatus() only reports which features are switched on — it has no
      // hostAvailable field. The row reads that field, so without this probe it
      // stays undefined and the status is stuck on "Checking…" forever.
      const available = config.enableHostSync === false ? false : await checkHostAvailable(forceProbe);
      setSyncStatus({ ...status, hostAvailable: available });
    } finally {
      setSyncConfigLoading(false);
    }
  };

  const handleToggleHostSync = async (enabled) => {
    try {
      await toggleHostSync(enabled);
      setHostSyncEnabled(enabled);
      // The status row is driven by hostAvailable, so flipping the toggle has
      // to re-probe or the dot keeps showing the pre-toggle answer.
      loadSettingsSync(true);
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

  const handleToggleAnalytics = (enabled) => {
    setAnalyticsEnabled(enabled);
    setAnalyticsEnabledState(enabled);
  };

  // Both handlers go through the shared update service so the header's update
  // pill reflects whatever we find here (and vice versa).
  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await checkForUpdate({ force: true });
      if (info) {
        setUpdateAvailable(true);
        setLatestVersion(info.latest);
        setError(`Update available: v${info.latest}`);
      } else {
        setUpdateAvailable(false);
        setError('You are running the latest version');
      }
    } catch { setError('Update check failed'); }
    finally { setCheckingUpdate(false); }
  };

  const handleInstallUpdate = async () => {
    // Desktop hands off to winget (which replaces the app and relaunches it);
    // the extension reloads itself. Either way this page goes away.
    const ok = await installUpdate();
    if (!ok) setError('Could not start the update — opening the release page instead');
  };

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
      // Pass it explicitly — `backupFrequency` state hasn't updated yet here, so
      // the old value would be used to compute the next run.
      if (autoBackupEnabled) scheduleNextBackup(frequency);
    } catch { setError('Failed to update backup frequency'); }
  };

  const handleToggleAutoGroup = async (enabled) => {
    try {
      await storageSet({ autoGroupEnabled: enabled });
      setAutoGroupEnabled(enabled);
      sendMessage({ type: 'TOGGLE_AUTO_GROUP', enabled }).catch(() => {});
    } catch { setError('Failed to toggle auto-group'); }
  };

  const handleAutostartToggle = async (enabled) => {
    try {
      await tauriInvoke('set_launch_at_login', { enabled });
      setAutostartEnabled(enabled);
    } catch (e) {
      setError('Failed to update launch at login setting');
    }
  };

  const handleUnsplashApiKeyChange = async (apiKey) => {
    try {
      await storageSet({ unsplashApiKey: apiKey });
      setUnsplashApiKey(apiKey);
    } catch { setError('Failed to save Unsplash API key'); }
  };

  const scheduleNextBackup = async (frequency = backupFrequency) => {
    await storageSet({ nextBackupTime: calculateNextBackupTime(frequency) });
  };

  const performManualBackup = async () => {
    setBackupInProgress(true);
    setError('');
    try {
      const { at } = await runBackup();
      setLastBackupTime(at);
      setError('Backup completed successfully');
      if (showBackupList) await refreshBackupList();
    } catch (err) {
      setError(`Backup failed: ${err.message || err}`);
    } finally {
      setBackupInProgress(false);
    }
  };

  const refreshBackupList = async () => {
    setSavedBackups(await listBackups());
  };

  const toggleBackupList = async () => {
    const next = !showBackupList;
    setShowBackupList(next);
    setConfirmRestorePath(null);
    setRestoreResult(null);
    if (next) await refreshBackupList();
  };

  const handleRestore = async (path) => {
    setRestoreBusy(true);
    setError('');
    setRestoreResult(null);
    try {
      // Parse before touching anything — a corrupt file should fail here, not
      // after the live stores have been cleared.
      const parsed = parseBackup(await readBackup(path));

      // Snapshot the current state first. Restore clears the stores, so without
      // this an interrupted restore is unrecoverable data loss.
      try {
        await runBackup();
      } catch (e) {
        throw new Error(`Could not take a safety backup first, aborting: ${e.message || e}`);
      }

      // Replace rather than merge: restoring a snapshot should land you on that
      // snapshot, not on it union'd with whatever is there now.
      const report = await restoreBackup(parsed, { replace: true });
      setRestoreResult(report);
      setConfirmRestorePath(null);
      await refreshBackupList(); // the safety backup is now in the list
      setError(report.written
        ? `Restored ${report.written} rows — reload to see the changes`
        : 'Restore finished, but nothing was written');
    } catch (e) {
      setError(`Restore failed: ${e.message || e}`);
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleDeleteBackup = async (path) => {
    try {
      await deleteBackup(path);
      await refreshBackupList();
    } catch (e) { setError(`Could not delete backup: ${e.message || e}`); }
  };

  const openBackupsFolder = async () => {
    try {
      const dir = await getBackupsDir();
      if (!dir) {
        setError('Backups folder is only available in the desktop app');
        return;
      }
      await tauriInvoke('open_folder', { path: dir });
    } catch (e) {
      console.error('[Settings] Open backups folder failed:', e);
      setError(`Could not open the backups folder: ${e.message || e}`);
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

  const Card = ({ children }) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      {children}
    </div>
  );

  const SettingRow = ({ label, hint, right, onClick, last, style }) => (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
        borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
        ...style
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e5e7eb' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{hint}</div>}
      </div>
      {right && <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>{right}</div>}
    </div>
  );

  const SmallBtn = ({ children, onClick, disabled, accent }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
        border: accent ? 'none' : '1px solid rgba(255,255,255,0.12)',
        background: accent ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.06)',
        color: accent ? '#60a5fa' : '#cbd5e1',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap',
        transition: 'background 0.15s'
      }}
    >
      {children}
    </button>
  );

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
            <img
              src={logo}
              alt=""
              style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'contain', flexShrink: 0 }}
            />
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Spotlight — desktop only */}
                {isDesktopApp && (
                  <section>
                    <SectionHeader title="Spotlight Shortcut" />
                    <Card>
                      <SettingRow
                        label="Hotkey"
                        hint={isRecordingShortcut ? 'Press your new key combination now…' : 'Global shortcut to open Spotlight'}
                        right={
                          isRecordingShortcut ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                padding: '4px 12px', borderRadius: 6, fontSize: 11,
                                border: '1px solid rgba(96,165,250,0.6)',
                                background: 'rgba(59,130,246,0.1)', color: '#93c5fd',
                                animation: 'pulse 1.2s ease-in-out infinite'
                              }}>
                                Waiting for keys…
                              </div>
                              <SmallBtn onClick={() => setIsRecordingShortcut(false)}>Cancel</SmallBtn>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {(spotlightShortcut || 'Alt+K').split('+').map(part => (
                                  <span key={part} style={{
                                    padding: '2px 6px', borderRadius: 4, fontSize: 11,
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.14)',
                                    color: '#e5e7eb'
                                  }}>{part}</span>
                                ))}
                              </div>
                              <SmallBtn onClick={() => setIsRecordingShortcut(true)}>Change</SmallBtn>
                            </div>
                          )
                        }
                        last
                      />
                    </Card>
                  </section>
                )}

                {/* Behaviour */}
                <section>
                  <SectionHeader title="Behaviour" />
                  <Card>
                    <SettingRow
                      label="Auto-Group Tabs"
                      hint="Group tabs from the same domain together"
                      right={<Toggle checked={autoGroupEnabled} onChange={handleToggleAutoGroup} accentColor="#22c55e" />}
                      onClick={() => handleToggleAutoGroup(!autoGroupEnabled)}
                    />
                    <SettingRow
                      label="Session Tracking"
                      hint="Auto-categorize visited URLs into workspaces"
                      right={<Toggle checked={sessionTrackingEnabled} onChange={handleToggleSessionTracking} />}
                      onClick={() => handleToggleSessionTracking(!sessionTrackingEnabled)}
                      last={!isTauri}
                    />
                    {isTauri && (
                      <SettingRow
                        label="Launch at Login"
                        hint="Start CoolDesk automatically on login"
                        right={<Toggle checked={autostartEnabled} onChange={handleAutostartToggle} accentColor="#22c55e" />}
                        onClick={() => handleAutostartToggle(!autostartEnabled)}
                        last
                      />
                    )}
                  </Card>
                </section>

                {/* Sync */}
                <section>
                  <SectionHeader title="Sync" />
                  <Card>
                    <SettingRow
                      label="Desktop Sync"
                      hint="Connect to the CoolDesk desktop app on port 4545"
                      right={<Toggle checked={hostSyncEnabled} onChange={handleToggleHostSync} />}
                      onClick={() => handleToggleHostSync(!hostSyncEnabled)}
                    />
                    <SettingRow
                      label={
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          Status
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                            background: !hostSyncEnabled ? '#475569' : syncStatus?.hostAvailable ? '#4ade80' : syncStatus?.hostAvailable === false ? '#ef4444' : '#fbbf24'
                          }} />
                        </span>
                      }
                      hint={!hostSyncEnabled ? 'Sync disabled' : syncStatus?.hostAvailable ? 'App connected' : syncStatus?.hostAvailable === false ? 'App not found — is it running?' : 'Checking…'}
                      right={
                        <div style={{ display: 'flex', gap: 6 }}>
                          {hostSyncEnabled && !syncStatus?.hostAvailable && (
                            <SmallBtn onClick={() => loadSettingsSync(true)} disabled={syncConfigLoading}>
                              {syncConfigLoading ? 'Checking…' : 'Retry'}
                            </SmallBtn>
                          )}
                          <SmallBtn
                            onClick={triggerSync}
                            disabled={globalSyncStatus === 'syncing' || !syncStatus?.hostAvailable}
                            accent
                          >
                            <FontAwesomeIcon icon={faDatabase} spin={globalSyncStatus === 'syncing'} style={{ marginRight: 4 }} />
                            {globalSyncStatus === 'syncing' ? 'Syncing…' : globalLastSyncTime ? `Synced ${new Date(globalLastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Sync Now'}
                          </SmallBtn>
                        </div>
                      }
                      last
                    />
                  </Card>
                </section>

                {/* Data — Backup is a desktop-app feature. The extension's service
                    worker can't hold a reliable schedule, so auto-backup only
                    runs in the app; ExportData stays available in both. */}
                <section>
                  <SectionHeader title="Data" />
                  {isTauri && (
                  <Card>
                    <SettingRow
                      label="Backup"
                      hint={lastBackupTime
                        ? `Last backup ${new Date(lastBackupTime).toLocaleDateString()} · keeps the 10 most recent`
                        : 'Saves a snapshot of all your data to this device'}
                      last
                      right={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Toggle checked={autoBackupEnabled} onChange={handleToggleAutoBackup} />
                          {autoBackupEnabled && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {['daily', 'weekly', 'monthly'].map(f => (
                                <button key={f} onClick={() => handleBackupFrequencyChange(f)} style={{
                                  padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                                  border: backupFrequency === f ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                                  background: backupFrequency === f ? 'rgba(59,130,246,0.2)' : 'transparent',
                                  color: backupFrequency === f ? '#60a5fa' : 'rgba(255,255,255,0.4)',
                                  cursor: 'pointer', textTransform: 'capitalize'
                                }}>{f}</button>
                              ))}
                            </div>
                          )}
                          <SmallBtn onClick={toggleBackupList}>
                            {showBackupList ? 'Hide' : 'Restore…'}
                          </SmallBtn>
                          <SmallBtn onClick={openBackupsFolder}>Folder</SmallBtn>
                          <SmallBtn onClick={performManualBackup} disabled={backupInProgress}>
                            {backupInProgress ? '…' : 'Backup Now'}
                          </SmallBtn>
                        </div>
                      }
                    />
                  </Card>
                  )}

                  {isTauri && showBackupList && (
                    <div style={{
                      marginTop: 8, padding: '10px 12px', borderRadius: 12,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      {savedBackups.length === 0 ? (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                          No saved backups yet — use Backup Now to create one.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {savedBackups.map(b => {
                            const confirming = confirmRestorePath === b.path;
                            return (
                              <div key={b.path} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 4px', fontSize: 11,
                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ color: '#cbd5e1' }}>
                                    {new Date(b.modified).toLocaleString([], {
                                      year: 'numeric', month: 'short', day: 'numeric',
                                      hour: '2-digit', minute: '2-digit',
                                    })}
                                  </div>
                                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                                    {(b.size / 1024).toFixed(0)} KB
                                  </div>
                                </div>

                                {confirming ? (
                                  <>
                                    <span style={{ color: '#fbbf24', fontSize: 10 }}>
                                      Replaces current data (saved first)
                                    </span>
                                    <SmallBtn onClick={() => handleRestore(b.path)} disabled={restoreBusy} accent>
                                      {restoreBusy ? '…' : 'Confirm'}
                                    </SmallBtn>
                                    <SmallBtn onClick={() => setConfirmRestorePath(null)} disabled={restoreBusy}>
                                      Cancel
                                    </SmallBtn>
                                  </>
                                ) : (
                                  <>
                                    <SmallBtn onClick={() => setConfirmRestorePath(b.path)} disabled={restoreBusy}>
                                      Restore
                                    </SmallBtn>
                                    <SmallBtn onClick={() => handleDeleteBackup(b.path)} disabled={restoreBusy}>
                                      Delete
                                    </SmallBtn>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {restoreResult && (
                        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,0.5)' }}>
                          <div>{restoreResult.written} rows restored{restoreResult.skipped ? `, ${restoreResult.skipped} skipped` : ''}</div>
                          {restoreResult.compatibility === 'upgrade' && (
                            <div>Migrated from schema v{restoreResult.dbVersion} to v{restoreResult.currentVersion}</div>
                          )}
                          {restoreResult.compatibility === 'newer' && (
                            <div style={{ color: '#fbbf24' }}>
                              Backup is newer (v{restoreResult.dbVersion}) than this build (v{restoreResult.currentVersion}) — unsupported data skipped
                            </div>
                          )}
                          {restoreResult.unknownStores?.length > 0 && (
                            <div style={{ color: '#fbbf24' }}>Skipped: {restoreResult.unknownStores.join(', ')}</div>
                          )}
                          {restoreResult.errors?.map((e, i) => (
                            <div key={i} style={{ color: '#f87171' }}>{e}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop: isTauri ? 8 : 0 }}>
                    <ExportData />
                  </div>
                </section>

                {/* Updates */}
                <section>
                  <SectionHeader title="Updates" />
                  <Card>
                    <SettingRow
                      label={<span>Version <span style={{ opacity: 0.45, fontWeight: 400 }}>v{extensionVersion}</span></span>}
                      hint={updateAvailable ? (latestVersion ? `v${latestVersion} is available` : 'A new version is ready') : 'You are up to date'}
                      right={
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {updateAvailable && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid currentColor' }}>New</span>}
                          <SmallBtn onClick={handleCheckForUpdates} disabled={checkingUpdate}>{checkingUpdate ? 'Checking…' : 'Check'}</SmallBtn>
                          {updateAvailable && <SmallBtn accent onClick={handleInstallUpdate}>{isTauri ? 'Update' : 'Install'}</SmallBtn>}
                        </div>
                      }
                    />
                    <SettingRow
                      label="Auto-Update"
                      hint="Install updates automatically in the background"
                      right={<Toggle checked={autoUpdateEnabled} onChange={handleToggleAutoUpdate} />}
                      onClick={() => handleToggleAutoUpdate(!autoUpdateEnabled)}
                      last={!isTauri}
                    />
                    {/* Analytics ping is a desktop-app feature — hide in the extension */}
                    {isTauri && (
                      <SettingRow
                        label="Anonymous Usage Stats"
                        hint={
                          <span>
                            Share anonymous launch counts to help improve CoolDesk. No search queries, URLs, or personal data.{' '}
                            <a
                              href="https://cool-desk.com/privacy-details"
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ color: '#60a5fa', textDecoration: 'none' }}
                            >
                              Learn more
                            </a>
                          </span>
                        }
                        right={<Toggle checked={analyticsEnabled} onChange={handleToggleAnalytics} accentColor="#22c55e" />}
                        onClick={() => handleToggleAnalytics(!analyticsEnabled)}
                        last
                      />
                    )}
                  </Card>
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


            {/* ── LOCAL AI ────────────────────────────────────────────────────── */}
            {activeTabId === 'local-ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <section>
                  <SectionHeader title="AI Models" description="On-device AI for categorization, summarization, and smart features." />
                  <AIModelsTab />
                </section>
              </div>
            )}

            {/* ── TEAM ─────────────────────────────────────────────────────────── */}
            {activeTabId === 'team' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <section>
                  <SectionHeader title="Team (P2P)" description="Share workspaces and resources directly with teammates over encrypted peer-to-peer." />
                  <TeamsTab />
                </section>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
