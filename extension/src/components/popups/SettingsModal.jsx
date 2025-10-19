import { faComments, faEnvelope, faEye, faFileExport, faFolder, faGraduationCap, faLightbulb, faMicrophone, faPalette, faRocket, faTableCellsLarge, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import { listWorkspaces, saveWorkspace } from '../../db/index.js';
import { getSyncStatus } from '../../services/conditionalSync';
import { sendMessage, storageGet } from '../../services/extensionApi';
import { loadSyncConfig, saveSyncConfig, toggleHostSync } from '../../services/syncConfig';
import { setAndSaveFontSize } from '../../utils/fontUtils';
import DisplayData from '../settings/DisplayData';
import ExportData from '../settings/ExportData';
import { TabItem, Tabs } from '../settings/TabComponents';
import ThemesTab from '../settings/ThemesTab';


export function SettingsModal({ show, onClose, settings, onSave, fontSize, onFontSizeChange, onStartOnboarding }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [basicSaved, setBasicSaved] = useState(Boolean((settings?.geminiApiKey || '').trim()))
  // Auth is paused in this build; Firebase state removed
  const [selectedTheme, setSelectedTheme] = useState('ai-midnight-nebula')
  const [fontFamily, setFontFamily] = useState('system')
  const [syncConfig, setSyncConfig] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncConfigLoading, setSyncConfigLoading] = useState(false)

  // Font size options
  const fontSizes = [
    { id: 'small', name: 'Small', size: '13px', description: 'Compact text for more content' },
    { id: 'medium', name: 'Medium', size: '14px', description: 'Default comfortable reading' },
    { id: 'large', name: 'Large', size: '16px', description: 'Easier reading, larger text' },
    { id: 'extra-large', name: 'Extra Large', size: '18px', description: 'Maximum readability' }
  ];

  // Font family options
  const fontFamilies = [
    { id: 'system', name: 'System Default', family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif', description: 'Native system fonts' },
    { id: 'inter', name: 'Inter', family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Modern geometric sans-serif' },
    { id: 'roboto', name: 'Roboto', family: 'Roboto, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Google\'s friendly sans-serif' },
    { id: 'poppins', name: 'Poppins', family: 'Poppins, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Rounded geometric typeface' },
    { id: 'jetbrains', name: 'JetBrains Mono', family: 'JetBrains Mono, Consolas, Monaco, monospace', description: 'Developer-focused monospace' }
  ];


  // Theme definitions with font family mappings
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

  const handleThemeChange = (themeId) => {
    setSelectedTheme(themeId);

    // Keep the current font family selection when changing themes
    applyTheme(themeId, fontSize, fontFamily);
  };

  const handleFontSizeChange = (sizeId) => {
    onFontSizeChange(sizeId);
    applyTheme(selectedTheme, sizeId, fontFamily);
  };

  const handleFontFamilyChange = (familyId) => {
    setFontFamily(familyId);

    // Save font family preference to localStorage
    try {
      localStorage.setItem('cooldesk-font-family', familyId);
    } catch (e) {
      console.warn('Failed to save font family preference:', e);
    }

    applyTheme(selectedTheme, fontSize, familyId);
  };

  const applyTheme = (themeId, fontSizeId, fontFamilyId) => {
    // Apply theme to body - remove all existing theme classes first
    const body = document.body;
    const themeClasses = [
      'bg-ai-midnight-nebula',
      'bg-cosmic-aurora',
      'bg-sunset-horizon',
      'bg-forest-depths',
      'bg-minimal-dark',
      'bg-ocean-depths',
      'bg-cherry-blossom',
      'bg-arctic-frost',
      'bg-volcanic-ember',
      'bg-neon-cyberpunk',
      'bg-white-cred',
      'bg-orange-warm',
      'bg-brown-earth',
      'bg-royal-purple',
      'bg-golden-honey',
      'bg-mint-sage',
      'bg-crimson-fire'
    ];

    // Remove all theme classes
    themeClasses.forEach(cls => body.classList.remove(cls));

    // Add the new theme class
    const newThemeClass = `bg-${themeId}`;
    body.classList.add(newThemeClass);

    // Apply typography settings
    const selectedFontFamily = fontFamilies.find(f => f.id === fontFamilyId);

    // Use font utility for font size (handles CSS variables properly)
    if (fontSizeId) {
      setAndSaveFontSize(fontSizeId);
    }

    if (selectedFontFamily) {
      body.style.fontFamily = selectedFontFamily.family;
    }

    // Save preferences (font size handled by font utility)
    try {
      localStorage.setItem('cooldesk-theme', themeId);
      localStorage.setItem('cooldesk-font-family', fontFamilyId);
    } catch (e) {
      console.warn('Failed to save theme preferences:', e);
    }
  };

  // Sync configuration handlers
  const handleSyncConfigChange = async (key, value) => {
    try {
      setSyncConfigLoading(true);
      const updatedConfig = { ...syncConfig, [key]: value };
      await saveSyncConfig(updatedConfig);
      setSyncConfig(updatedConfig);

      // Update sync status
      const status = getSyncStatus();
      setSyncStatus(status);
    } catch (error) {
      console.warn('Failed to save sync config:', error);
      setError('Failed to save sync configuration. Please try again.');
    } finally {
      setSyncConfigLoading(false);
    }
  };

  const handleToggleHostSync = async (enabled) => {
    try {
      setSyncConfigLoading(true);
      await toggleHostSync(enabled);
      const config = await loadSyncConfig();
      const status = getSyncStatus();
      setSyncConfig(config);
      setSyncStatus(status);

      if (enabled) {
        console.log('Host sync enabled. Extension will now sync with localhost:4000');
      } else {
        console.log('Host sync disabled. Extension running in standalone mode');
      }
    } catch (error) {
      console.warn('Failed to toggle host sync:', error);
      setError('Failed to toggle sync configuration. Please try again.');
    } finally {
      setSyncConfigLoading(false);
    }
  };


  useEffect(() => {
    setLocalSettings(settings)
    setBasicSaved(Boolean((settings?.geminiApiKey || '').trim()))
  }, [settings])

  // Load and apply saved theme preferences on component mount
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('cooldesk-theme') || 'crimson-fire';
      const savedFontFamily = localStorage.getItem('cooldesk-font-family');

      setSelectedTheme(savedTheme);

      // Determine which font family to use
      let fontFamilyToUse = 'system';
      if (savedFontFamily) {
        fontFamilyToUse = savedFontFamily;
        setFontFamily(savedFontFamily);
      } else {
        const selectedThemeData = themes.find(t => t.id === savedTheme);
        const themeFontFamily = selectedThemeData?.fontFamily || 'system';
        fontFamilyToUse = themeFontFamily;
        setFontFamily(themeFontFamily);
      }

      // Only apply theme without font size (font size is handled by App.jsx and fontUtils)
      // Just apply theme class and font family
      const body = document.body;
      const themeClasses = [
        'bg-ai-midnight-nebula',
        'bg-cosmic-aurora',
        'bg-sunset-horizon',
        'bg-forest-depths',
        'bg-minimal-dark',
        'bg-ocean-depths',
        'bg-cherry-blossom',
        'bg-arctic-frost',
        'bg-volcanic-ember',
        'bg-neon-cyberpunk',
        'bg-white-cred',
        'bg-orange-warm',
        'bg-brown-earth',
        'bg-royal-purple',
        'bg-golden-honey',
        'bg-mint-sage',
        'bg-crimson-fire'
      ];

      // Remove all theme classes and add the saved one
      themeClasses.forEach(cls => body.classList.remove(cls));
      body.classList.add(`bg-${savedTheme}`);

      // Apply font family only
      const fontFamilies = [
        { id: 'system', family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' },
        { id: 'inter', family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' },
        { id: 'roboto', family: 'Roboto, -apple-system, BlinkMacSystemFont, sans-serif' },
        { id: 'poppins', family: 'Poppins, -apple-system, BlinkMacSystemFont, sans-serif' },
        { id: 'jetbrains', family: 'JetBrains Mono, Consolas, Monaco, monospace' }
      ];

      const selectedFontFamily = fontFamilies.find(f => f.id === fontFamilyToUse);
      if (selectedFontFamily) {
        body.style.fontFamily = selectedFontFamily.family;
      }
    } catch (e) {
      console.warn('Failed to load theme preferences:', e);
    }
  }, []) // Only run once on mount

  // Load sync configuration when modal shows
  useEffect(() => {
    if (!show) return;

    const loadSync = async () => {
      try {
        setSyncConfigLoading(true);
        const config = await loadSyncConfig();
        const status = getSyncStatus();
        setSyncConfig(config);
        setSyncStatus(status);
      } catch (error) {
        console.warn('Failed to load sync config:', error);
      } finally {
        setSyncConfigLoading(false);
      }
    };

    loadSync();
  }, [show]);

  // Auth initialization removed for this build

  // Load workspaces from Firebase and subscribe to changes
  // Load local workspaces when modal opens
  useEffect(() => {
    if (!show) return;
    (async () => {
      try {
        console.log('[SettingsModal] Loading local workspaces...');
        const list = await listWorkspaces();
        console.log('[SettingsModal] Local workspaces result:', list);
        const workspaceData = list?.data || list || [];
        console.log('[SettingsModal] Extracted workspace data:', workspaceData);
        setWorkspaces(Array.isArray(workspaceData) ? workspaceData : []);
      } catch (error) {
        console.error('[SettingsModal] Error loading local workspaces:', error);
        setWorkspaces([]);
      }
    })();
  }, [show]);

  // Firebase workspace subscription removed for this build

  const handleSave = () => {
    // Do not mirror workspaces into settings; workspaces are the source of truth
    const { categories, ...rest } = (localSettings || {});
    // Require Gemini API key
    if (!String(rest.geminiApiKey || '').trim()) {
      setError('Gemini API Key is required');
      return;
    }
    onSave(rest);
  }

  // Derived rows for inline editing of workspaces
  const editableWorkspaces = useMemo(() => {
    console.log('[SettingsModal] Creating editableWorkspaces from:', workspaces);
    const result = (Array.isArray(workspaces) ? workspaces : []).map(w => ({
      id: w.id,
      name: w.name || '',
      description: w.description || '',
    }));
    console.log('[SettingsModal] editableWorkspaces result:', result);
    return result;
  }, [workspaces]);

  if (!show) return null

  const handleTabChange = async (nextIndex) => {
    // Allow free navigation between all tabs for better onboarding
    setActiveTab(nextIndex)
  }

  // Track edits in Basic and mark unsaved
  const markEdited = () => setBasicSaved(false)

  const handleSuggestCategories = async () => {
    setSuggesting(true)
    setError('')
    try {
      // Ensure settings were explicitly saved before AI actions
      if (!basicSaved) {
        setError('Please Save & Continue in Basic before using AI Suggest')
        return
      }
      // Pull URLs from dashboard data (history + bookmarks)
      const { dashboardData } = await storageGet(['dashboardData'])
      const hist = Array.isArray(dashboardData?.history) ? dashboardData.history : []
      const bms = Array.isArray(dashboardData?.bookmarks) ? dashboardData.bookmarks : []
      const urls = [...hist, ...bms].map((it) => it?.url).filter(Boolean).slice(0, 150)
      if (!urls.length) {
        setError('No URLs available. Try Refresh Data first.')
        return
      }
      const resp = await sendMessage({ action: 'suggestCategories', urls }, { timeoutMs: 20000 })
      if (!resp?.ok) {
        setError(resp?.error || 'Failed to get suggestions')
        return
      }
      const cats = Array.isArray(resp.categories) ? resp.categories : []
      const rows = cats
        .map((c) => {
          if (typeof c === 'string') return { name: c.trim(), description: '' }
          const name = typeof c?.name === 'string' ? c.name.trim() : ''
          const description = typeof c?.description === 'string' ? c.description.trim() : ''
          return name ? { name, description } : null
        })
        .filter(Boolean)
      // Instead of storing in settings, create/update workspaces directly
      const existing = Array.isArray(workspaces) ? workspaces : []
      const norm = (s) => (s || '').trim().toLowerCase()
      for (const row of rows) {
        const found = existing.find(w => norm(w.name) === norm(row.name))
        const ws = found ? { ...found, description: row.description || found.description || '' } : {
          id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
          name: row.name,
          description: row.description || '',
          createdAt: Date.now(),
          urls: [],
        }
        try { await saveWorkspace(ws) } catch { }
      }
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setSuggesting(false)
    }
  }

  const handleUpdateWorkspaceField = (id, field, value) => {
    setWorkspaces(ws => ws.map(w => w.id === id ? { ...w, [field]: value } : w))
  }

  const handleSaveWorkspaceRow = async (id) => {
    try {
      const w = workspaces.find(x => x.id === id)
      if (!w) return
      const payload = {
        id: w.id,
        name: (w.name || '').trim() || 'Workspace',
        description: (w.description || '').trim(),
        createdAt: w.createdAt || Date.now(),
        urls: Array.isArray(w.urls) ? w.urls : [],
      }
      console.log('[SettingsModal] Saving workspace row:', payload);
      await saveWorkspace(payload)
      console.log('[SettingsModal] Workspace row saved successfully');
    } catch (e) {
      console.error('[SettingsModal] Error saving workspace row:', e);
    }
  }

  const handleDeleteWorkspace = async (id) => {
    try {
      console.log('[SettingsModal] Deleting workspace:', id);
      await deleteWorkspaceById(id)
      console.log('[SettingsModal] Workspace deleted, refreshing list...');

      // Refresh workspaces list
      try {
        const list = await listWorkspaces();
        console.log('[SettingsModal] Refreshed workspaces after deletion:', list);
        const workspaceData = list?.data || list || [];
        setWorkspaces(Array.isArray(workspaceData) ? workspaceData : []);
      } catch (error) {
        console.error('[SettingsModal] Error refreshing workspaces after deletion:', error);
      }
    } catch (error) {
      console.error('[SettingsModal] Error deleting workspace:', error);
    }
  }

  const handleOpenCreateWorkspace = () => setShowCreateWorkspace(true)
  const handleCloseCreateWorkspace = () => setShowCreateWorkspace(false)
  const handleCreateWorkspace = async (name, description) => {
    const ws = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
      name,
      description,
      createdAt: Date.now(),
      urls: [],
    }
    console.log('[SettingsModal] Creating workspace:', ws);
    await saveWorkspace(ws)
    console.log('[SettingsModal] Workspace saved, refreshing list...');

    // Refresh workspaces list
    try {
      const list = await listWorkspaces();
      console.log('[SettingsModal] Refreshed workspaces after creation:', list);
      const workspaceData = list?.data || list || [];
      setWorkspaces(Array.isArray(workspaceData) ? workspaceData : []);
    } catch (error) {
      console.error('[SettingsModal] Error refreshing workspaces after creation:', error);
    }

    setShowCreateWorkspace(false)
  }

  // Authentication handlers removed for this build


  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      padding: '20px'
    }}>
      <div className="modal" style={{
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        boxShadow: '0 12px 48px rgba(0, 0, 0, 0.4)',
        maxWidth: '1200px',
        width: '95vw',
        maxHeight: '90vh',
        overflow: 'auto',
        margin: '0 auto'
      }}>
        <div
          className="modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 20,
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #34C759, #30D158)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px'
            }}><FontAwesomeIcon icon={faRocket} /></div>
            <div>
              <h3 style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: '700',
                color: '#e5e7eb',
                lineHeight: '1.2'
              }}>Welcome to Cool-Desk</h3>
              <p style={{
                margin: '4px 0 0 0',
                fontSize: '14px',
                color: '#9ca3af',
                fontWeight: '400'
              }}>Let's set up your personalized workspace</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="cancel-btn"
            aria-label="Close"
            title="Close"
            style={{
              padding: '10px',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: '#e5e7eb',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.2)';
              e.target.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.1)';
              e.target.style.transform = 'translateY(0)';
            }}
          >
            ×
          </button>
        </div>
        {error && (
          <div style={{
            marginBottom: 24,
            color: '#ff6b6b',
            fontSize: '14px',
            border: '1px solid rgba(255, 107, 107, 0.2)',
            padding: '16px 20px',
            borderRadius: '12px',
            backdropFilter: 'blur(10px)'
          }}>
            {error}
          </div>
        )}
        <Tabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          disabledTitles={[]} // Remove restrictions for better onboarding flow
        >
          <TabItem title={<><FontAwesomeIcon icon={faPalette} style={{ marginRight: '8px' }} />Themes</>}>
            <ThemesTab
              selectedTheme={selectedTheme}
              fontSize={fontSize}
              fontFamily={fontFamily}
              onThemeChange={handleThemeChange}
              onFontSizeChange={handleFontSizeChange}
              onFontFamilyChange={handleFontFamilyChange}
            />
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faFileExport} style={{ marginRight: '8px' }} />Export Data</>}>
            <ExportData />
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faEye} style={{ marginRight: '8px' }} />Display</>}>
            <DisplayData />
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faGraduationCap} style={{ marginRight: '8px' }} />Help</>}>
            <div style={{ padding: '20px', maxHeight: '600px', overflowY: 'auto' }}>
              {/* Getting Started Section */}
              <div style={{ marginBottom: '32px' }}>
                <h2 style={{ marginTop: 0, marginBottom: '12px', fontSize: '20px', fontWeight: 600 }}>
                  Getting Started
                </h2>
                <p style={{ color: 'var(--text-secondary, #999)', marginBottom: '16px', lineHeight: 1.6 }}>
                  Need help getting started with CoolDesk? Take a quick tour to learn about all the features.
                </p>
                
                <button
                  onClick={() => {
                    if (onStartOnboarding) {
                      onStartOnboarding();
                      onClose();
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 20px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '15px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
                  }}
                >
                  <FontAwesomeIcon icon={faGraduationCap} style={{ fontSize: '18px' }} />
                  Start Onboarding Tour
                </button>
              </div>

              {/* Features Guide */}
              <div style={{ marginBottom: '32px' }}>
                <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '20px', fontWeight: 600 }}>
                  Features Guide
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {[
                    {
                      icon: faThumbtack,
                      title: 'Pins',
                      desc: 'Quick access to your most important links',
                      howTo: 'Right-click any link → Pin. Pinned items appear at the top of your dashboard.',
                    },
                    {
                      icon: faRocket,
                      title: 'Pinned Workspaces',
                      desc: 'Keep important workspaces at the top',
                      howTo: 'Right-click any workspace → Pin to Pinned Workspaces.',
                    },
                    {
                      icon: faFolder,
                      title: 'Workspace List',
                      desc: 'Organize tabs and links by project',
                      howTo: 'Click + button to create workspace. Add current tab or paste URLs.',
                    },
                    {
                      icon: faTableCellsLarge,
                      title: 'Tabs',
                      desc: 'Manage all open browser tabs',
                      howTo: 'View all tabs in one place. Click to switch, close, or organize.',
                    },
                    {
                      icon: faMicrophone,
                      title: 'Voice Navigation',
                      desc: 'Control browser with voice commands',
                      howTo: 'Click microphone icon. Say "show numbers" to see clickable elements.',
                    },
                    {
                      icon: faComments,
                      title: 'AI Chats',
                      desc: 'Auto-save ChatGPT, Claude, Gemini & Grok',
                      howTo: 'Automatically scrapes chats when you visit AI platforms.',
                    },
                    {
                      icon: faLightbulb,
                      title: 'Notes & Daily Journal',
                      desc: 'Daily notes and task management',
                      howTo: 'Click date to add notes. Keep track of your daily thoughts and tasks.',
                    },
                  ].map((feature, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                        border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
                        borderRadius: '8px',
                        padding: '16px',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <FontAwesomeIcon
                          icon={feature.icon}
                          style={{
                            fontSize: '20px',
                            color: '#667eea',
                            marginTop: '2px',
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>
                            {feature.title}
                          </div>
                          <div style={{ fontSize: '14px', color: 'var(--text-secondary, #999)', marginBottom: '8px', lineHeight: 1.5 }}>
                            {feature.desc}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary, #999)', lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 600, color: '#667eea' }}>How to use:</span> {feature.howTo}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Support Section */}
              <div style={{ 
                padding: '20px', 
                background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                borderRadius: '8px',
                border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))'
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 600 }}>
                  Need More Help?
                </h3>
                <p style={{ color: 'var(--text-secondary, #999)', marginBottom: '16px', lineHeight: 1.6, fontSize: '14px' }}>
                  Found a bug or have a feature request? We'd love to hear from you!
                </p>
                <button
                  onClick={() => {
                    const subject = encodeURIComponent('CoolDesk Feedback');
                    const body = encodeURIComponent('Please describe your issue or suggestion:\n\n');
                    window.open(`mailto:support@cooldesk.com?subject=${subject}&body=${body}`, '_blank');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 16px',
                    background: 'transparent',
                    border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.2))',
                    borderRadius: '6px',
                    color: 'var(--text, #e5e7eb)',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = '#667eea';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'var(--border-primary, rgba(255, 255, 255, 0.2))';
                  }}
                >
                  <FontAwesomeIcon icon={faEnvelope} />
                  Report Bug or Request Feature
                </button>
              </div>
            </div>
          </TabItem>
          {/* <TabItem title={<><FontAwesomeIcon icon={faUser} style={{ marginRight: '8px' }} />Account</>}>
            <AccountTab />
          </TabItem> */}
        </Tabs>

        {/* Removed global Save button; use Save & Continue in Basic tab */}

        {showCreateWorkspace && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleCloseCreateWorkspace() }} style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
          }}>
            <div className="modal" style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              boxShadow: '0 12px 48px rgba(0, 0, 0, 0.4)',
              maxWidth: '500px',
              width: '90vw',
              padding: '24px',
              color: '#e5e7eb'
            }}>
              <div
                className="modal-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  paddingBottom: 20,
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  marginBottom: 24,
                }}
              >
                <h3 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: '#e5e7eb'
                }}>Create New Workspace</h3>
                <button
                  onClick={handleCloseCreateWorkspace}
                  className="cancel-btn"
                  aria-label="Close"
                  title="Close"
                  style={{
                    padding: '8px',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    color: '#e5e7eb',
                    cursor: 'pointer',
                    fontSize: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#d1d5db' }}>Workspace Name *</span>
                  <input
                    value={workspaces.find(w => w.id === 'new')?.name || ''}
                    onChange={(e) => {
                      const newWorkspace = { id: 'new', name: e.target.value, description: workspaces.find(w => w.id === 'new')?.description || '' };
                      setWorkspaces(prev => {
                        const filtered = prev.filter(w => w.id !== 'new');
                        return [...filtered, newWorkspace];
                      });
                    }}
                    placeholder="Enter workspace name..."
                    autoFocus
                    style={{
                      padding: '12px 16px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      color: '#e5e7eb',
                      fontSize: '14px',
                      outline: 'none',
                      transition: 'all 0.2s ease'
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#34C759';
                      e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#d1d5db' }}>Description</span>
                  <textarea
                    value={workspaces.find(w => w.id === 'new')?.description || ''}
                    onChange={(e) => {
                      const newWorkspace = { id: 'new', name: workspaces.find(w => w.id === 'new')?.name || '', description: e.target.value };
                      setWorkspaces(prev => {
                        const filtered = prev.filter(w => w.id !== 'new');
                        return [...filtered, newWorkspace];
                      });
                    }}
                    placeholder="What are you working on? (optional)"
                    rows="3"
                    style={{
                      padding: '12px 16px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      color: '#e5e7eb',
                      fontSize: '14px',
                      outline: 'none',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      transition: 'all 0.2s ease'
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#34C759';
                      e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                    }}
                  />
                </label>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '8px' }}>
                  <button
                    onClick={handleCloseCreateWorkspace}
                    style={{
                      padding: '10px 20px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      color: '#e5e7eb',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const newWorkspace = workspaces.find(w => w.id === 'new');
                      if (!newWorkspace?.name?.trim()) return;

                      await handleCreateWorkspace(newWorkspace.name.trim(), newWorkspace.description?.trim() || '');
                      setWorkspaces(prev => prev.filter(w => w.id !== 'new'));
                    }}
                    disabled={!workspaces.find(w => w.id === 'new')?.name?.trim()}
                    style={{
                      padding: '10px 20px',
                      background: workspaces.find(w => w.id === 'new')?.name?.trim() ? '#34C759' : 'rgba(255, 255, 255, 0.05)',
                      border: 'none',
                      borderRadius: '8px',
                      color: workspaces.find(w => w.id === 'new')?.name?.trim() ? 'white' : '#6b7280',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: workspaces.find(w => w.id === 'new')?.name?.trim() ? 'pointer' : 'not-allowed',
                      transition: 'all 0.2s ease',
                      boxShadow: workspaces.find(w => w.id === 'new')?.name?.trim() ? '0 2px 8px rgba(52, 199, 89, 0.3)' : 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (workspaces.find(w => w.id === 'new')?.name?.trim()) {
                        e.target.style.transform = 'translateY(-1px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (workspaces.find(w => w.id === 'new')?.name?.trim()) {
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow = '0 2px 8px rgba(52, 199, 89, 0.3)';
                      }
                    }}
                  >
                    Create Workspace
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

