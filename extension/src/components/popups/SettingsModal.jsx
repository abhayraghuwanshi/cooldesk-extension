import { faDatabase, faPalette, faRocket, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace } from '../../db';
import { getSyncStatus } from '../../services/conditionalSync';
import { sendMessage, storageGet, storageSet } from '../../services/extensionApi';
import { loadSyncConfig } from '../../services/syncConfig';
import { setAndSaveFontFamily, setAndSaveFontSize } from '../../utils/fontUtils';
import ExportData from '../settings/ExportData';
import SetupTab from '../settings/SetupTab';
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
  onWallpaperEnabledChange,
  onWallpaperUrlChange,
  onWallpaperOpacityChange
}) {
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

  // --- Constants & Config ---
  const TABS = [
    // { id: 'general', label: 'AI & Setup', icon: faCog, component: SetupTab },
    { id: 'teams', label: 'Teams (P2P)', icon: faUsers, component: TeamsTab },
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
      chrome.storage.local.get(['sessionTracking'], (result) => {
        setSessionTrackingEnabled(result?.sessionTracking?.enabled !== false);
      });

      // Load Sync
      loadSettingsSync();

      // Load Workspaces
      loadLocalWorkspaces();

    } catch (e) {
      console.warn('Error specific settings:', e);
    }
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
    // Remove old classes
    themes.forEach(t => body.classList.remove(`bg-${t.id}`));
    body.classList.add(`bg-${themeId}`);

    if (fontSizeId) setAndSaveFontSize(fontSizeId);
    if (fontFamilyId) setAndSaveFontFamily(fontFamilyId);

    try {
      localStorage.setItem('cooldesk-theme', themeId);
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
      await chrome.runtime.sendMessage({ action: 'toggleSessionTracking', enabled });
      setSessionTrackingEnabled(enabled);
    } catch (err) {
      setError('Failed to toggle session tracking');
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
        position: 'fixed', inset: 0, zIndex: 9999,
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
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#fff' }}>Core Configuration</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Configure AI models and core behavior.</p>
                  </div>
                  <SetupTab
                    localSettings={localSettings}
                    setLocalSettings={setLocalSettings}
                    markEdited={markEdited}
                    basicSaved={basicSaved}
                    setBasicSaved={setBasicSaved}
                    suggesting={suggesting}
                    error={error}
                    setError={setError}
                    handleSuggestCategories={handleSuggestCategories}
                    saveSettingsDB={saveSettingsDB}
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
                onWallpaperEnabledChange={onWallpaperEnabledChange}
                onWallpaperUrlChange={onWallpaperUrlChange}
                onWallpaperOpacityChange={onWallpaperOpacityChange}
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
