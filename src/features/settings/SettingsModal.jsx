import { faCog, faDatabase, faFolderOpen, faPalette, faRocket, faUsers, faWindowRestore } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import logo from '../../../logo-2.png';
import { useClipboardStatus } from '../clipboard/useClipboardHistory';
import { useVaultStatus } from '../vault/useVault';
import { useDockState } from '../dock/useDockState';
import { disableSurface, enableSurface, setSurfaceSize } from '../dock/surfaceControls';

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
import ExportData from '../../shared/components/ExportData';
import FolderIndexTab from './parts/FolderIndexTab';
import TeamsTab from './parts/TeamsTab';
import ThemesTab from './parts/ThemesTab';
import WorkspaceCleanupSettings from './parts/WorkspaceCleanupSettings';
import { getLocale, useT } from '../../shared/i18n';
import { LanguageSelect } from '../../shared/i18n/LanguageSelect';
import { availableEngines, getEngineKey, getWebSuggestEnabled, setEngineKey, setWebSuggestEnabled } from '../../shared/searchEngines';

export function SettingsModal({
  show,
  onClose,
  // Desktop app: rendered as a Browse tab (SpecialTab) instead of a modal —
  // no overlay, fills the tab; Close closes the tab.
  embedded = false,
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
  const t = useT();
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
  const [searchEngine, setSearchEngine] = useState(getEngineKey);
  const [webSuggest, setWebSuggest] = useState(getWebSuggestEnabled);
  const handleWebSuggestToggle = (on) => { setWebSuggest(on); setWebSuggestEnabled(on); };

  const isDesktopApp = isElectronApp();

  const TABS = [
    { id: 'general',    label: t('st.tab.general'),    icon: faCog     },
    ...(isTauri ? [{ id: 'windows', label: t('st.windows'), icon: faWindowRestore }] : []),
    { id: 'appearance', label: t('st.tab.appearance'), icon: faPalette },
    // Local AI configures the desktop app's sidecar (models, cloud keys); in
    // the browser extension there's nothing behind it, so desktop only.
    ...(isDesktopApp ? [{ id: 'local-ai', label: t('st.tab.localAi'), icon: faRocket }] : []),
    ...(isTauri ? [{ id: 'folders', label: t('st.tab.folders'), icon: faFolderOpen }] : []),
    ...(isDesktopApp && TEAM_FEATURE_ENABLED ? [{ id: 'team', label: t('st.tab.team'), icon: faUsers }] : []),
    // Sync, backups and updates — split out of General to keep it short.
    { id: 'data', label: t('st.data'), icon: faDatabase },
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

  // event.code names (KeyA, Digit1, ArrowUp, …) → the token names the Rust-side
  // shortcut parser (global-hotkey) accepts. Physical-key based, not
  // event.key — see handleShortcutKeyDown for why that distinction matters.
  const codeToShortcutKey = (code) => {
    if (code.startsWith('Key')) return code.slice(3); // KeyK -> K
    if (code.startsWith('Digit')) return code.slice(5); // Digit1 -> 1
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24
    const named = {
      Space: 'Space',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Escape: 'Escape',
      Minus: '-', Equal: '=',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
      Backquote: '`',
      Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    };
    if (named[code]) return named[code];
    // Last resort: strip a common prefix rather than hand the parser
    // whatever raw event.code string macOS produced.
    return code.replace(/^(Numpad|Intl)/, '') || code;
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
    // 'Meta' (the DOM/KeyboardEvent name for Cmd) isn't a token the Rust-side
    // shortcut parser (global-hotkey, backing tauri-plugin-global-shortcut)
    // recognizes — only "Cmd"/"Command"/"Super" are. A saved 'Meta+…' string
    // isn't just silently ignored: on startup it fails shortcut registration
    // and previously crashed the whole app (see set_spotlight_shortcut /
    // the startup registration in lib.rs).
    if (e.metaKey) parts.push('Cmd');
    // event.code, not event.key: on macOS, Option (Alt) remaps what a key
    // actually types — Option+K can produce "˚", not "k" — and event.key
    // reflects that remapped character while event.code is the physical key,
    // unaffected by any modifier. Recording via event.key meant any
    // Option-combo (and Cmd+Option combos in particular) saved a shortcut
    // string like "Alt+Cmd+˚" that the parser couldn't recognize as a key at
    // all — "not working" with no clear reason why.
    const key = codeToShortcutKey(e.code);
    parts.push(key);
    void updateSpotlightShortcut(parts.join('+') || 'Alt+K');
    setIsRecordingShortcut(false);
  };

  // Capture keystrokes globally while recording — no div focus needed
  useEffect(() => {
    if (!isRecordingShortcut) return;
    window.addEventListener('keydown', handleShortcutKeyDown, true);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown, true);
  }, [isRecordingShortcut]);

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

  const { status: clipboardStatus, setEnabled: setClipboardEnabled, setFilters: setClipboardFilters } = useClipboardStatus();
  const handleClipboardToggle = (enabled) => {
    setClipboardEnabled(enabled).catch(err => console.warn('[Settings] clipboard toggle failed:', err));
  };
  const clipboardSkipKinds = clipboardStatus?.skipKinds || [];
  const clipboardSkipSecrets = clipboardStatus?.skipSecrets !== false;
  const updateClipboardFilters = (patch) => {
    setClipboardFilters({ skipSecrets: clipboardSkipSecrets, skipKinds: clipboardSkipKinds, ...patch })
      .catch(err => console.warn('[Settings] clipboard filters failed:', err));
  };
  // "Record X" toggles: checked = recorded = not in skipKinds.
  const toggleClipboardKind = (kind, record) => {
    const rest = clipboardSkipKinds.filter(k => k !== kind);
    updateClipboardFilters({ skipKinds: record ? rest : [...rest, kind] });
  };

  const { status: vaultStatus, setEnabled: setVaultEnabled } = useVaultStatus();
  const handleVaultToggle = (enabled) => {
    setVaultEnabled(enabled).catch(err => console.warn('[Settings] vault toggle failed:', err));
  };

  // Sidebar / dock windows (src-tauri/src/surfaces.rs). Each is its own
  // window, turned on and placed independently of the other.
  const dockState = useDockState();
  const isWindowsOS = typeof navigator !== 'undefined' && /Win/.test(navigator.platform);
  const surfaceAction = (p) => p.catch(e => setError(String(e?.message || e)));
  const handleSurfaceToggle = (surface, on) =>
    surfaceAction(on ? enableSurface(surface) : disableSurface(surface));
  const handleSurfaceSide = (surface, side) => surfaceAction(enableSurface(surface, { side }));
  const handleSurfaceSize = (surface, size) => surfaceAction(setSurfaceSize(surface, size));
  // Sidebar widths offered (CSS px); the stored one is kept in the list even
  // if it isn't one of these (an older default, a hand-edited file).
  const SIDEBAR_WIDTHS = [280, 320, 360, 420];
  const handleSurfaceReserve = (surface, on) =>
    surfaceAction(enableSurface(surface, { mode: on ? 'reserve' : 'drawer' }));

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
      {title && <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px 0', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.5 }}>{title}</h3>}
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

  // In a tab the overlay is dropped and the panel fills the tab's sheet.
  const Overlay = embedded ? EmbeddedFrame : ModalOverlay;
  return (
    <Overlay onClose={onClose}>
      <div className="modal-content" style={embedded ? {
        width: '100%', height: '100%',
        display: 'flex', overflow: 'hidden',
        color: '#fff', fontFamily: 'inherit'
      } : {
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
          {/* Logo — not in a tab, whose own title already says Settings */}
          {!embedded && (
          <div style={{ padding: '0 8px 20px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src={logo}
              alt=""
              style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'contain', flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>CoolDesk</div>
              <div style={{ fontSize: 10, opacity: 0.4, color: '#fff' }}>{t('st.title')}</div>
            </div>
          </div>
          )}

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
                {t('st.gettingStarted')}
              </button>
            )}
            {/* A tab closes like any tab — no Close button there. */}
            {!embedded && (
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
              {t('st.close')}
            </button>
            )}
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
              {TABS.find(tab => tab.id === activeTabId)?.label}
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

                {/* Language — same preference as the new tab's Customize panel */}
                <section>
                  <SectionHeader title={t('st.language')} />
                  <Card>
                    <SettingRow
                      label={t('st.language')}
                      hint={t('st.languageHint')}
                      right={
                        <LanguageSelect className="mac-select" />
                      }
                      last
                    />
                  </Card>
                </section>

                {/* Web search — the engine Spotlight searches with and suggests
                    from (shared/searchEngines.js), and an off switch for the
                    suggestions, which send what you type to that engine. */}
                <section>
                  <SectionHeader title={t('st.webSearch')} />
                  <Card>
                    <SettingRow
                      label={t('st.searchEngine')}
                      hint={t('st.searchEngineHint')}
                      right={
                        <select
                          value={searchEngine}
                          aria-label={t('st.searchEngine')}
                          onChange={e => { setSearchEngine(e.target.value); setEngineKey(e.target.value); }}
                          className="mac-select"
                        >
                          {availableEngines().map(e => (
                            <option key={e.key} value={e.key}>{e.key === 'default' ? t('st.searchEngineDefault') : e.label}</option>
                          ))}
                        </select>
                      }
                    />
                    <SettingRow
                      label={t('st.webSuggest')}
                      hint={t('st.webSuggestHint')}
                      right={<Toggle checked={webSuggest} onChange={handleWebSuggestToggle} accentColor="#22c55e" />}
                      onClick={() => handleWebSuggestToggle(!webSuggest)}
                      last
                    />
                  </Card>
                </section>

                {/* Spotlight — desktop only */}
                {isDesktopApp && (
                  <section>
                    <SectionHeader title={t('st.spotlightShortcut')} />
                    <Card>
                      <SettingRow
                        label={t('st.hotkey')}
                        hint={isRecordingShortcut ? t('st.hotkeyRecording') : t('st.hotkeyHint')}
                        right={
                          isRecordingShortcut ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                padding: '4px 12px', borderRadius: 6, fontSize: 11,
                                border: '1px solid rgba(96,165,250,0.6)',
                                background: 'rgba(59,130,246,0.1)', color: '#93c5fd',
                                animation: 'pulse 1.2s ease-in-out infinite'
                              }}>
                                {t('st.waitingKeys')}
                              </div>
                              <SmallBtn onClick={() => setIsRecordingShortcut(false)}>{t('st.cancel')}</SmallBtn>
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
                              <SmallBtn onClick={() => setIsRecordingShortcut(true)}>{t('st.change')}</SmallBtn>
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
                  <SectionHeader title={t('st.behaviour')} />
                  <Card>
                    <SettingRow
                      label={t('st.autoGroup')}
                      hint={t('st.autoGroupHint')}
                      right={<Toggle checked={autoGroupEnabled} onChange={handleToggleAutoGroup} accentColor="#22c55e" />}
                      onClick={() => handleToggleAutoGroup(!autoGroupEnabled)}
                    />
                    <SettingRow
                      label={t('st.sessionTracking')}
                      hint={t('st.sessionTrackingHint')}
                      right={<Toggle checked={sessionTrackingEnabled} onChange={handleToggleSessionTracking} />}
                      onClick={() => handleToggleSessionTracking(!sessionTrackingEnabled)}
                      last={!isTauri}
                    />
                    {isTauri && (
                      <SettingRow
                        label={t('st.launchAtLogin')}
                        hint={t('st.launchAtLoginHint')}
                        right={<Toggle checked={autostartEnabled} onChange={handleAutostartToggle} accentColor="#22c55e" />}
                        onClick={() => handleAutostartToggle(!autostartEnabled)}
                      />
                    )}
                    {isTauri && (
                      <SettingRow
                        label={t('st.passwords')}
                        hint={t('st.passwordsHint')}
                        right={<Toggle checked={!!vaultStatus?.enabled} onChange={handleVaultToggle} accentColor="#22c55e" />}
                        onClick={() => handleVaultToggle(!vaultStatus?.enabled)}
                      />
                    )}
                    {isTauri && (
                      <SettingRow
                        label={t('st.clipboard')}
                        hint={t('st.clipboardHint')}
                        right={<Toggle checked={!!clipboardStatus?.enabled} onChange={handleClipboardToggle} accentColor="#22c55e" />}
                        onClick={() => handleClipboardToggle(!clipboardStatus?.enabled)}
                        last={!clipboardStatus?.enabled}
                      />
                    )}
                    {isTauri && clipboardStatus?.enabled && (
                      <>
                        <SettingRow
                          label={t('st.skipSecrets')}
                          hint={t('st.skipSecretsHint')}
                          right={<Toggle checked={clipboardSkipSecrets} onChange={v => updateClipboardFilters({ skipSecrets: v })} accentColor="#22c55e" />}
                          onClick={() => updateClipboardFilters({ skipSecrets: !clipboardSkipSecrets })}
                          style={{ paddingLeft: 28 }}
                        />
                        {[
                          ['image', t('st.recordImages'), t('st.recordImagesHint')],
                          ['code', t('st.recordCode'), t('st.recordCodeHint')],
                          ['files', t('st.recordFiles'), t('st.recordFilesHint')],
                        ].map(([kind, label, hint], i, arr) => (
                          <SettingRow
                            key={kind}
                            label={label}
                            hint={hint}
                            right={<Toggle checked={!clipboardSkipKinds.includes(kind)} onChange={v => toggleClipboardKind(kind, v)} accentColor="#22c55e" />}
                            onClick={() => toggleClipboardKind(kind, clipboardSkipKinds.includes(kind))}
                            style={{ paddingLeft: 28 }}
                            last={i === arr.length - 1}
                          />
                        ))}
                      </>
                    )}
                  </Card>
                </section>

              </div>
            )}

            {/* ── DATA — sync, backups, updates ───────────────────────────────── */}
            {activeTabId === 'data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Sync */}
                <section>
                  <SectionHeader title={t('st.sync')} />
                  <Card>
                    <SettingRow
                      label={t('st.desktopSync')}
                      hint={t('st.desktopSyncHint')}
                      right={<Toggle checked={hostSyncEnabled} onChange={handleToggleHostSync} />}
                      onClick={() => handleToggleHostSync(!hostSyncEnabled)}
                    />
                    <SettingRow
                      label={
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t('st.status')}
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                            background: !hostSyncEnabled ? '#475569' : syncStatus?.hostAvailable ? '#4ade80' : syncStatus?.hostAvailable === false ? '#ef4444' : '#fbbf24'
                          }} />
                        </span>
                      }
                      hint={!hostSyncEnabled ? t('st.syncDisabled') : syncStatus?.hostAvailable ? t('st.appConnected') : syncStatus?.hostAvailable === false ? t('st.appNotFound') : t('st.checking')}
                      right={
                        <div style={{ display: 'flex', gap: 6 }}>
                          {hostSyncEnabled && !syncStatus?.hostAvailable && (
                            <SmallBtn onClick={() => loadSettingsSync(true)} disabled={syncConfigLoading}>
                              {syncConfigLoading ? t('st.checking') : t('st.retry')}
                            </SmallBtn>
                          )}
                          <SmallBtn
                            onClick={triggerSync}
                            disabled={globalSyncStatus === 'syncing' || !syncStatus?.hostAvailable}
                            accent
                          >
                            <FontAwesomeIcon icon={faDatabase} spin={globalSyncStatus === 'syncing'} style={{ marginRight: 4 }} />
                            {globalSyncStatus === 'syncing' ? t('st.syncing') : globalLastSyncTime ? t('st.syncedAt', { time: new Date(globalLastSyncTime).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) }) : t('st.syncNow')}
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
                  <SectionHeader title={t('st.data')} />
                  {isTauri && (
                  <Card>
                    <SettingRow
                      label={t('st.backup')}
                      hint={lastBackupTime
                        ? t('st.lastBackup', { date: new Date(lastBackupTime).toLocaleDateString(getLocale()) })
                        : t('st.backupHint')}
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
                                  cursor: 'pointer'
                                }}>{t(`st.freq.${f}`)}</button>
                              ))}
                            </div>
                          )}
                          <SmallBtn onClick={toggleBackupList}>
                            {showBackupList ? t('st.hide') : t('st.restoreMenu')}
                          </SmallBtn>
                          <SmallBtn onClick={openBackupsFolder}>{t('st.folder')}</SmallBtn>
                          <SmallBtn onClick={performManualBackup} disabled={backupInProgress}>
                            {backupInProgress ? '…' : t('st.backupNow')}
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
                          {t('st.noBackups')}
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
                                    {new Date(b.modified).toLocaleString(getLocale(), {
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
                                      {t('st.replacesData')}
                                    </span>
                                    <SmallBtn onClick={() => handleRestore(b.path)} disabled={restoreBusy} accent>
                                      {restoreBusy ? '…' : t('st.confirm')}
                                    </SmallBtn>
                                    <SmallBtn onClick={() => setConfirmRestorePath(null)} disabled={restoreBusy}>
                                      {t('st.cancel')}
                                    </SmallBtn>
                                  </>
                                ) : (
                                  <>
                                    <SmallBtn onClick={() => setConfirmRestorePath(b.path)} disabled={restoreBusy}>
                                      {t('st.restore')}
                                    </SmallBtn>
                                    <SmallBtn onClick={() => handleDeleteBackup(b.path)} disabled={restoreBusy}>
                                      {t('st.delete')}
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
                          <div>{t('st.rowsRestored', { n: restoreResult.written })}{restoreResult.skipped ? t('st.rowsSkipped', { n: restoreResult.skipped }) : ''}</div>
                          {restoreResult.compatibility === 'upgrade' && (
                            <div>{t('st.migrated', { from: restoreResult.dbVersion, to: restoreResult.currentVersion })}</div>
                          )}
                          {restoreResult.compatibility === 'newer' && (
                            <div style={{ color: '#fbbf24' }}>
                              {t('st.backupNewer', { from: restoreResult.dbVersion, to: restoreResult.currentVersion })}
                            </div>
                          )}
                          {restoreResult.unknownStores?.length > 0 && (
                            <div style={{ color: '#fbbf24' }}>{t('st.skippedStores', { list: restoreResult.unknownStores.join(', ') })}</div>
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
                  <SectionHeader title={t('st.updates')} />
                  <Card>
                    <SettingRow
                      label={<span>{t('st.version')} <span style={{ opacity: 0.45, fontWeight: 400 }}>v{extensionVersion}</span></span>}
                      hint={updateAvailable ? (latestVersion ? t('st.updateAvailable', { v: latestVersion }) : t('st.newVersionReady')) : t('st.upToDate')}
                      right={
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {updateAvailable && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid currentColor' }}>{t('st.new')}</span>}
                          <SmallBtn onClick={handleCheckForUpdates} disabled={checkingUpdate}>{checkingUpdate ? t('st.checking') : t('st.check')}</SmallBtn>
                          {updateAvailable && <SmallBtn accent onClick={handleInstallUpdate}>{isTauri ? t('st.update') : t('st.install')}</SmallBtn>}
                        </div>
                      }
                    />
                    <SettingRow
                      label={t('st.autoUpdate')}
                      hint={isTauri ? t('st.autoUpdateHintApp') : t('st.autoUpdateHintExt')}
                      right={<Toggle checked={autoUpdateEnabled} onChange={handleToggleAutoUpdate} />}
                      onClick={() => handleToggleAutoUpdate(!autoUpdateEnabled)}
                      last={!isTauri}
                    />
                    {/* Analytics ping is a desktop-app feature — hide in the extension */}
                    {isTauri && (
                      <SettingRow
                        label={t('st.analytics')}
                        hint={
                          <span>
                            {t('st.analyticsHint')}{' '}
                            <a
                              href="https://cool-desk.com/privacy-details"
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ color: '#60a5fa', textDecoration: 'none' }}
                            >
                              {t('st.learnMore')}
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

            {/* ── WINDOWS ─────────────────────────────────────────────────────── */}
            {activeTabId === 'windows' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* Windows — the sidebar and the dock are separate windows,
                    each switched on here (or from the tray) on its own. */}
                {isTauri && (
                  <section>
                    <SectionHeader title={null} description={t('st.windowsHint')} />
                    <Card>
                      {[
                        ['sidebar', t('st.sidebarWindow'), t('st.sidebarWindowHint'), [['left', t('st.sideLeft')], ['right', t('st.sideRight')]]],
                        ['bar', t('st.dockWindow'), t('st.dockWindowHint'), [['bottom', t('st.sideBottom')], ['top', t('st.sideTop')]]],
                      ].map(([surface, label, hint, sides], i, arr) => {
                        const st = dockState?.[surface];
                        const on = !!st?.enabled;
                        const isLast = i === arr.length - 1;
                        return (
                          <div key={surface}>
                            <SettingRow
                              label={label}
                              hint={hint}
                              right={<Toggle checked={on} onChange={v => handleSurfaceToggle(surface, v)} accentColor="#22c55e" />}
                              onClick={() => handleSurfaceToggle(surface, !on)}
                              last={isLast && !on}
                            />
                            {on && (
                              <SettingRow
                                label={t('st.position')}
                                style={{ paddingLeft: 28 }}
                                last={isLast && !isWindowsOS}
                                right={
                                  <select
                                    value={st.side}
                                    aria-label={`${label} — ${t('st.position')}`}
                                    onChange={e => handleSurfaceSide(surface, e.target.value)}
                                    className="mac-select"
                                  >
                                    {sides.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                                  </select>
                                }
                              />
                            )}
                            {on && surface === 'sidebar' && (
                              <SettingRow
                                label={t('st.width')}
                                style={{ paddingLeft: 28 }}
                                last={isLast && !isWindowsOS}
                                right={
                                  <select
                                    value={st.size}
                                    aria-label={`${label} — ${t('st.width')}`}
                                    onChange={e => handleSurfaceSize(surface, Number(e.target.value))}
                                    className="mac-select"
                                  >
                                    {[...new Set([...SIDEBAR_WIDTHS, st.size])].sort((a, b) => a - b).map(w => (
                                      <option key={w} value={w}>{w} px</option>
                                    ))}
                                  </select>
                                }
                              />
                            )}
                            {on && isWindowsOS && (
                              <SettingRow
                                label={t('st.reserveSpace')}
                                hint={t('st.reserveSpaceHint')}
                                style={{ paddingLeft: 28 }}
                                last={isLast}
                                right={<Toggle checked={st.mode === 'reserve'} onChange={v => handleSurfaceReserve(surface, v)} accentColor="#22c55e" />}
                                onClick={() => handleSurfaceReserve(surface, st.mode !== 'reserve')}
                              />
                            )}
                          </div>
                        );
                      })}
                    </Card>
                  </section>
                )}

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
                  <SectionHeader title={t('st.aiModels')} description={t('st.aiModelsDesc')} />
                  <AIModelsTab />
                </section>
              </div>
            )}

            {/* ── FOLDERS & INDEX ─────────────────────────────────────────────── */}
            {activeTabId === 'folders' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <section>
                  <SectionHeader title={t('st.tab.folders')} description={t('st.foldersDesc')} />
                  <FolderIndexTab />
                </section>
              </div>
            )}

            {/* ── TEAM ─────────────────────────────────────────────────────────── */}
            {activeTabId === 'team' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <section>
                  <SectionHeader title={t('st.teamTitle')} description={t('st.teamDesc')} />
                  <TeamsTab />
                </section>
              </div>
            )}

          </div>
        </div>
      </div>
    </Overlay>
  );
}

// The modal's backdrop: click outside the panel to close.
function ModalOverlay({ onClose, children }) {
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
      {children}
    </div>
  );
}

// In a Browse tab: just fill it.
function EmbeddedFrame({ children }) {
  return <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{children}</div>;
}

