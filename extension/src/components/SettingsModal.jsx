import { faFloppyDisk, faTrash, faCog, faFolder, faBullseye, faUser, faRocket, faExclamationTriangle, faCheckCircle, faLightbulb, faPalette, faSync, faColumns } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import { deleteWorkspaceById, listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace, subscribeWorkspaceChanges, initializeFirebase, signInWithGoogle, signOutUser, getCurrentUser, onAuthStateChange } from '../services/firebase';
import { sendMessage, storageGet, storageSet } from '../services/extensionApi';
import { loadSyncConfig, saveSyncConfig, getSyncConfig, toggleHostSync } from '../services/syncConfig';
import { getSyncStatus } from '../services/conditionalSync';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';
import { personas, validatePersona, getPersonaUrlCount } from '../data/personas';

export function SettingsModal({ show, onClose, settings, onSave, useVerticalLayout, onLayoutToggle }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [basicSaved, setBasicSaved] = useState(Boolean((settings?.geminiApiKey || '').trim()))
  const [selectedPersona, setSelectedPersona] = useState(null)
  const [selectedCategories, setSelectedCategories] = useState([])
  const [creatingWorkspaces, setCreatingWorkspaces] = useState(false)
  const [firebaseInitialized, setFirebaseInitialized] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [selectedTheme, setSelectedTheme] = useState('ai-midnight-nebula')
  const [fontSize, setFontSize] = useState('medium')
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

  // Theme options
  const themes = [
    {
      id: 'ai-midnight-nebula',
      name: 'AI Midnight Nebula',
      description: 'Deep space theme with blue and purple nebula effects',
      preview: 'radial-gradient(60% 80% at 10% 10%, #60a5fa1f, #0000 60%), radial-gradient(50% 60% at 90% 20%, #8b5cf61f, #0000 60%), linear-gradient(180deg, #0a0a0f 0%, #121218 100%)'
    },
    {
      id: 'cosmic-aurora',
      name: 'Cosmic Aurora',
      description: 'Northern lights inspired with green and teal gradients',
      preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #06b6d420, #0000 60%), linear-gradient(180deg, #0f172a 0%, #1e293b 100%)'
    },
    {
      id: 'sunset-horizon',
      name: 'Sunset Horizon',
      description: 'Warm sunset colors with orange and pink tones',
      preview: 'radial-gradient(60% 80% at 10% 70%, #f9731620, #0000 60%), radial-gradient(50% 60% at 90% 30%, #ec489920, #0000 60%), linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)'
    },
    {
      id: 'forest-depths',
      name: 'Forest Depths',
      description: 'Deep forest theme with emerald and jade accents',
      preview: 'radial-gradient(60% 80% at 30% 20%, #059f4620, #0000 60%), radial-gradient(50% 60% at 70% 80%, #047c3a20, #0000 60%), linear-gradient(180deg, #0f1419 0%, #1a2332 100%)'
    },
    {
      id: 'minimal-dark',
      name: 'Minimal Dark',
      description: 'Clean minimal dark theme with subtle gradients',
      preview: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)'
    },
    {
      id: 'ocean-depths',
      name: 'Ocean Depths',
      description: 'Deep ocean theme with blue and cyan waves',
      preview: 'radial-gradient(50% 60% at 20% 30%, #0ea5e920, #0000 70%), radial-gradient(40% 50% at 80% 20%, #06b6d420, #0000 60%), linear-gradient(140deg, #0c1426 0%, #1e293b 100%)'
    },
    {
      id: 'cherry-blossom',
      name: 'Cherry Blossom',
      description: 'Soft pink and purple spring theme',
      preview: 'radial-gradient(60% 70% at 25% 25%, #ec489920, #0000 65%), radial-gradient(50% 60% at 75% 15%, #a855f720, #0000 70%), linear-gradient(130deg, #1f1729 0%, #2d1b3d 100%)'
    },
    {
      id: 'arctic-frost',
      name: 'Arctic Frost',
      description: 'Cool arctic theme with ice blue and white accents',
      preview: 'radial-gradient(40% 50% at 30% 20%, #0ea5e915, #0000 70%), radial-gradient(60% 40% at 70% 80%, #60a5fa15, #0000 60%), linear-gradient(155deg, #0f1419 0%, #1e2832 100%)'
    },
    {
      id: 'volcanic-ember',
      name: 'Volcanic Ember',
      description: 'Fiery theme with red and orange volcanic colors',
      preview: 'radial-gradient(50% 60% at 20% 30%, #dc262620, #0000 70%), radial-gradient(40% 50% at 80% 20%, #f9731620, #0000 60%), linear-gradient(145deg, #1f1917 0%, #2d1b1b 100%)'
    },
    {
      id: 'neon-cyberpunk',
      name: 'Neon Cyberpunk',
      description: 'Futuristic cyberpunk with neon pink and cyan',
      preview: 'radial-gradient(60% 50% at 30% 20%, #ec489925, #0000 65%), radial-gradient(40% 60% at 70% 80%, #06b6d425, #0000 70%), linear-gradient(135deg, #0a0a0f 0%, #1a0a1a 100%)'
    },
    {
      id: 'white-cred',
      name: 'White CRED',
      description: 'Clean minimalist white theme inspired by CRED',
      preview: 'radial-gradient(60% 70% at 25% 25%, #0f172a08, #0000 65%), radial-gradient(50% 60% at 75% 15%, #64748b08, #0000 70%), linear-gradient(130deg, #ffffff 0%, #f1f5f9 100%)'
    },
    {
      id: 'orange-warm',
      name: 'Orange Warm',
      description: 'Vibrant orange and amber theme with warm tones',
      preview: 'radial-gradient(60% 70% at 25% 25%, #f9731620, #0000 65%), radial-gradient(50% 60% at 75% 15%, #fb923c20, #0000 70%), linear-gradient(130deg, #1c1917 0%, #44403c 100%)'
    },
    {
      id: 'brown-earth',
      name: 'Brown Earth',
      description: 'Earthy brown and coffee theme with natural tones',
      preview: 'radial-gradient(60% 70% at 25% 25%, #a1620720, #0000 65%), radial-gradient(50% 60% at 75% 15%, #ca8a0420, #0000 70%), linear-gradient(130deg, #1c1614 0%, #3c322a 100%)'
    }
  ];

  const handleThemeChange = (themeId) => {
    setSelectedTheme(themeId);
    applyTheme(themeId, fontSize, fontFamily);
  };

  const handleFontSizeChange = (sizeId) => {
    setFontSize(sizeId);
    applyTheme(selectedTheme, sizeId, fontFamily);
  };

  const handleFontFamilyChange = (familyId) => {
    setFontFamily(familyId);
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
      'bg-brown-earth'
    ];
    
    // Remove all theme classes
    themeClasses.forEach(cls => body.classList.remove(cls));
    
    // Add the new theme class
    const newThemeClass = `bg-${themeId}`;
    body.classList.add(newThemeClass);
    
    // Apply typography settings
    const selectedFontSize = fontSizes.find(f => f.id === fontSizeId);
    const selectedFontFamily = fontFamilies.find(f => f.id === fontFamilyId);
    
    if (selectedFontSize) {
      body.style.fontSize = selectedFontSize.size;
    }
    
    if (selectedFontFamily) {
      body.style.fontFamily = selectedFontFamily.family;
    }
    
    // Save preferences
    try {
      localStorage.setItem('cooldesk-theme', themeId);
      localStorage.setItem('cooldesk-font-size', fontSizeId);
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

  const handlePersonaSelect = (persona) => {
    // Validate persona structure
    if (!validatePersona(persona)) {
      setError('Invalid persona data. Please try again.');
      return;
    }
    
    setSelectedPersona(persona);
    setSelectedCategories(persona.workspaces.map((ws, idx) => ({
      ...ws,
      id: `${persona.title}-${idx}`,
      selected: true,
      originalName: ws.name,
      editedName: ws.name
    })));
    setError(''); // Clear any existing errors
  };

  const handleCategoryToggle = (categoryId) => {
    setSelectedCategories(cats => 
      cats.map(cat => 
        cat.id === categoryId 
          ? { ...cat, selected: !cat.selected }
          : cat
      )
    );
  };

  const handleCategoryRename = (categoryId, newName) => {
    setSelectedCategories(cats => 
      cats.map(cat => 
        cat.id === categoryId 
          ? { ...cat, editedName: newName.trim() || cat.originalName }
          : cat
      )
    );
  };

  const createPersonaWorkspaces = async () => {
    if (!selectedPersona || !selectedCategories.length) return;
    
    setCreatingWorkspaces(true);
    setError('');
    
    try {
      const selectedCats = selectedCategories.filter(cat => cat.selected);
      
      for (const category of selectedCats) {
        const workspace = {
          id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
          name: category.editedName,
          description: category.description,
          createdAt: Date.now(),
          urls: category.urls.map(url => ({
            url,
            title: url,
            addedAt: Date.now(),
            favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`
          })),
          context: {
            persona: selectedPersona.title,
            originalCategory: category.originalName
          },
        };
        
        try {
          await saveWorkspace(workspace);
        } catch (e) {
          console.error(`Failed to create workspace ${category.editedName}:`, e);
        }
      }
      
      // Reset selection
      setSelectedPersona(null);
      setSelectedCategories([]);
      
      // Show success message
      alert(`Successfully created ${selectedCats.length} workspaces!`);
      
    } catch (e) {
      setError(`Failed to create workspaces: ${e.message}`);
    } finally {
      setCreatingWorkspaces(false);
    }
  };

  useEffect(() => {
    setLocalSettings(settings)
    setBasicSaved(Boolean((settings?.geminiApiKey || '').trim()))
  }, [settings])

  // Load and apply saved theme preferences on component mount
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('cooldesk-theme') || 'ai-midnight-nebula';
      const savedFontSize = localStorage.getItem('cooldesk-font-size') || 'medium';
      const savedFontFamily = localStorage.getItem('cooldesk-font-family') || 'system';
      
      setSelectedTheme(savedTheme);
      setFontSize(savedFontSize);
      setFontFamily(savedFontFamily);
      
      // Apply theme immediately for new users
      applyTheme(savedTheme, savedFontSize, savedFontFamily);
    } catch (e) {
      console.warn('Failed to load theme preferences:', e);
      // Apply default theme if loading fails
      applyTheme('ai-midnight-nebula', 'medium', 'system');
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

  // Initialize Firebase and auth state listener when modal shows
  useEffect(() => {
    if (!show) return;
    
    let unsubscribeAuth = null;
    
    (async () => {
      try {
        if (!firebaseInitialized) {
          const success = await initializeFirebase();
          setFirebaseInitialized(success);
          if (!success) {
            setError('Failed to initialize Firebase. Using local storage.');
            return;
          }
        }
        
        // Set up auth state listener
        unsubscribeAuth = onAuthStateChange((user) => {
          setCurrentUser(user);
        });
        
        // Set initial user
        setCurrentUser(getCurrentUser());
        
      } catch (err) {
        console.error('Firebase initialization error:', err);
        setError(`Firebase Error: ${err.message || 'Failed to initialize Firebase. Using local storage.'}`);
      }
    })();
    
    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, [show, firebaseInitialized]);

  // Load workspaces from Firebase and subscribe to changes
  useEffect(() => {
    if (!show || !firebaseInitialized) return;
    let unsub = null;
    (async () => {
      try {
        const list = await listWorkspaces();
        setWorkspaces(Array.isArray(list) ? list : []);
      } catch { setWorkspaces([]); }
    })();
    unsub = subscribeWorkspaceChanges(async () => {
      try {
        const list = await listWorkspaces();
        setWorkspaces(Array.isArray(list) ? list : []);
      } catch { }
    });
    return () => { try { unsub && unsub(); } catch { } };
  }, [show, firebaseInitialized]);

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
    return (Array.isArray(workspaces) ? workspaces : []).map(w => ({
      id: w.id,
      name: w.name || '',
      description: w.description || '',
    }));
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
          context: {},
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
        context: typeof w.context === 'object' && w.context ? w.context : {},
      }
      await saveWorkspace(payload)
    } catch (e) { /* ignore */ }
  }

  const handleDeleteWorkspace = async (id) => {
    try {
      await deleteWorkspaceById(id)
    } catch { }
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
      context: {},
    }
    await saveWorkspace(ws)
    setShowCreateWorkspace(false)
  }

  // Authentication handlers
  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setError('');

    try {
      // Use the existing Firebase signInWithGoogle function but in a new tab
      const result = await signInWithGoogle();

      if (!result.success) {
        setError(result.error);
      } else {
        // Success - close modal
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      const result = await signOutUser();
      if (!result.success) {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message || 'Sign out failed');
    } finally {
      setAuthLoading(false);
    }
  };


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
            background: 'rgba(255, 107, 107, 0.1)',
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
          <TabItem title={<><FontAwesomeIcon icon={faFolder} style={{ marginRight: '8px' }} />Workspaces</>}>
            <label>
              <span>Workspaces</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editableWorkspaces.map((row) => (
                  <div key={row.id} style={{ 
                    display: 'flex', 
                    gap: 12, 
                    alignItems: 'center',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    padding: '12px 16px'
                  }}>
                    <input
                      style={{ 
                        flex: 1,
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        color: '#e5e7eb',
                        fontSize: '14px',
                        outline: 'none'
                      }}
                      placeholder="Workspace name"
                      value={row.name}
                      onChange={(e) => handleUpdateWorkspaceField(row.id, 'name', e.target.value)}
                    />
                    <input
                      style={{ 
                        flex: 2,
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        color: '#e5e7eb',
                        fontSize: '14px',
                        outline: 'none'
                      }}
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => handleUpdateWorkspaceField(row.id, 'description', e.target.value)}
                    />
                    <button
                      className="filter-btn"
                      onClick={() => handleSaveWorkspaceRow(row.id)}
                      title="Save"
                      aria-label="Save workspace"
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: '#34C759',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.transform = 'translateY(-1px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow = 'none';
                      }}
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} />
                    </button>
                    <button
                      className="filter-btn"
                      onClick={() => handleDeleteWorkspace(row.id)}
                      title="Delete"
                      aria-label="Delete workspace"
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'rgba(255, 59, 48, 0.8)',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.transform = 'translateY(-1px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(255, 59, 48, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow = 'none';
                      }}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 12 }}>
                  <button 
                    className="add-link-btn" 
                    onClick={handleOpenCreateWorkspace} 
                    title="Create workspace"
                    style={{
                      background: '#34C759',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '10px 16px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 8px rgba(52, 199, 89, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'translateY(-1px)';
                      e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'translateY(0)';
                      e.target.style.boxShadow = '0 2px 8px rgba(52, 199, 89, 0.3)';
                    }}
                  >
                    + Add Workspace
                  </button>
                </div>
              </div>
            </label>
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faPalette} style={{ marginRight: '8px' }} />Themes</>}>
            <div style={{ padding: '16px 0' }}>
              <h4 style={{ 
                margin: '0 0 16px 0', 
                color: '#e5e7eb', 
                fontSize: '18px',
                fontWeight: '600' 
              }}>
                Choose Your Theme
              </h4>
              <p style={{ 
                margin: '0 0 24px 0', 
                color: '#9ca3af', 
                fontSize: '14px', 
                lineHeight: '1.5' 
              }}>
                Select a theme that matches your style. Changes apply instantly.
              </p>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
                gap: '16px' 
              }}>
                {themes.map((theme) => (
                  <div
                    key={theme.id}
                    onClick={() => handleThemeChange(theme.id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: selectedTheme === theme.id 
                        ? '2px solid #34C759' 
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '16px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      backdropFilter: 'blur(10px)',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedTheme !== theme.id) {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedTheme !== theme.id) {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }
                    }}
                  >
                    {/* Theme Preview */}
                    <div style={{
                      width: '100%',
                      height: '80px',
                      background: theme.preview,
                      borderRadius: '12px',
                      marginBottom: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      {selectedTheme === theme.id && (
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '24px',
                          height: '24px',
                          background: '#34C759',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '12px',
                          fontWeight: '600'
                        }}>
                          ✓
                        </div>
                      )}
                    </div>

                    {/* Theme Info */}
                    <div>
                      <h5 style={{
                        margin: '0 0 4px 0',
                        color: '#e5e7eb',
                        fontSize: '16px',
                        fontWeight: '600'
                      }}>
                        {theme.name}
                      </h5>
                      <p style={{
                        margin: '0',
                        color: '#9ca3af',
                        fontSize: '13px',
                        lineHeight: '1.4'
                      }}>
                        {theme.description}
                      </p>
                    </div>

                    {selectedTheme === theme.id && (
                      <div style={{
                        position: 'absolute',
                        top: '0',
                        left: '0',
                        right: '0',
                        bottom: '0',
                        background: 'rgba(52, 199, 89, 0.1)',
                        borderRadius: '14px',
                        pointerEvents: 'none'
                      }} />
                    )}
                  </div>
                ))}
              </div>

              {/* Typography Controls */}
              <div style={{ marginTop: '32px' }}>
                <h5 style={{
                  margin: '0 0 16px 0',
                  color: '#e5e7eb',
                  fontSize: '16px',
                  fontWeight: '600'
                }}>
                  Typography Settings
                </h5>

                {/* Font Size */}
                <div style={{ marginBottom: '24px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: '#9ca3af',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}>
                    Font Size
                  </label>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                    gap: '8px'
                  }}>
                    {fontSizes.map((size) => (
                      <button
                        key={size.id}
                        onClick={() => handleFontSizeChange(size.id)}
                        style={{
                          background: fontSize === size.id 
                            ? 'rgba(52, 199, 89, 0.2)' 
                            : 'rgba(255, 255, 255, 0.05)',
                          border: fontSize === size.id 
                            ? '1px solid #34C759' 
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          color: fontSize === size.id ? '#34C759' : '#e5e7eb',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          fontSize: '13px',
                          fontWeight: '500'
                        }}
                        onMouseEnter={(e) => {
                          if (fontSize !== size.id) {
                            e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (fontSize !== size.id) {
                            e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                          }
                        }}
                      >
                        {size.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Family */}
                <div style={{ marginBottom: '24px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: '#9ca3af',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}>
                    Font Family
                  </label>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '8px'
                  }}>
                    {fontFamilies.map((font) => (
                      <button
                        key={font.id}
                        onClick={() => handleFontFamilyChange(font.id)}
                        style={{
                          background: fontFamily === font.id 
                            ? 'rgba(52, 199, 89, 0.2)' 
                            : 'rgba(255, 255, 255, 0.05)',
                          border: fontFamily === font.id 
                            ? '1px solid #34C759' 
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          color: fontFamily === font.id ? '#34C759' : '#e5e7eb',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          fontSize: '13px',
                          fontWeight: '500',
                          fontFamily: font.family
                        }}
                        onMouseEnter={(e) => {
                          if (fontFamily !== font.id) {
                            e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (fontFamily !== font.id) {
                            e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                          }
                        }}
                      >
                        {font.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ 
                marginTop: '24px',
                padding: '16px', 
                background: 'rgba(52, 199, 89, 0.1)', 
                border: '1px solid rgba(52, 199, 89, 0.2)',
                borderRadius: '12px',
                fontSize: '13px',
                color: '#9ca3af',
                textAlign: 'center',
                backdropFilter: 'blur(10px)'
              }}>
                🎨 <strong style={{ color: '#34C759' }}>Pro Tip:</strong> Your theme and typography preferences are automatically saved and will persist across browser sessions.
              </div>
            </div>
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faCog} style={{ marginRight: '8px' }} />Setup</>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Gemini API Key</span>
                <input
                  value={localSettings.geminiApiKey}
                  onChange={(e) => { setLocalSettings({ ...localSettings, geminiApiKey: e.target.value }); markEdited(); }}
                  placeholder="Enter your Gemini API key..."
                  required
                  style={{
                    padding: '16px 20px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    color: '#e5e7eb',
                    fontSize: '16px',
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
                <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Model Name</span>
                <input
                  value={localSettings.modelName || ''}
                  onChange={(e) => { setLocalSettings({ ...localSettings, modelName: e.target.value }); markEdited(); }}
                  placeholder="e.g., gemini-1.5-pro"
                  style={{
                    padding: '16px 20px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    color: '#e5e7eb',
                    fontSize: '16px',
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
                <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Visit Count Threshold</span>
                <input
                  type="number"
                  min="0"
                  value={localSettings.visitCountThreshold}
                  onChange={(e) => { setLocalSettings({ ...localSettings, visitCountThreshold: e.target.value }); markEdited(); }}
                  style={{
                    padding: '16px 20px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '12px',
                    color: '#e5e7eb',
                    fontSize: '16px',
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
                <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>History Lookback</span>
                <select
                  value={typeof localSettings.historyDays === 'number' && localSettings.historyDays > 0 ? localSettings.historyDays : (localSettings.historyDays || 30)}
                  onChange={(e) => { setLocalSettings({ ...localSettings, historyDays: Number(e.target.value) }); markEdited(); }}
                  style={{
                    padding: '16px 20px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#e5e7eb',
                    borderRadius: '12px',
                    fontSize: '16px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 32, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="add-link-btn"
                onClick={async () => {
                  setError('')
                  const key = String(localSettings?.geminiApiKey || '').trim()
                  if (!key) {
                    setError('Gemini API Key is required')
                    return
                  }
                  const payload = {
                    geminiApiKey: key,
                    modelName: String(localSettings?.modelName || '').trim(),
                    visitCountThreshold: (localSettings?.visitCountThreshold === '' || localSettings?.visitCountThreshold == null)
                      ? 0
                      : Number(localSettings.visitCountThreshold) || 0,
                    historyDays: (localSettings?.historyDays === '' || localSettings?.historyDays == null)
                      ? 30
                      : Number(localSettings.historyDays) || 30,
                  }
                  try {
                    await Promise.all([
                      saveSettingsDB(payload),
                      storageSet(payload),
                    ])
                    setBasicSaved(true)
                  } catch (e) {
                    setError(String(e?.message || e) || 'Failed to save settings')
                  }
                }}
                title="Save AI settings"
                style={{
                  background: '#34C759',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '16px 32px',
                  color: 'white',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 16px rgba(52, 199, 89, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 2px 8px rgba(52, 199, 89, 0.3)';
                }}
              >
                Save Settings
              </button>
              <button 
                className="add-link-btn" 
                onClick={handleSuggestCategories} 
                disabled={suggesting || !(String(localSettings?.geminiApiKey || '').trim())} 
                title="AI-suggest workspaces from your URLs"
                style={{
                  background: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? 'rgba(255, 255, 255, 0.05)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '16px 32px',
                  color: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? '#9ca3af' : 'white',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? 0.6 : 1,
                  boxShadow: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? 'none' : '0 4px 16px rgba(102, 126, 234, 0.3)'
                }}
                onMouseEnter={(e) => {
                  if (!suggesting && String(localSettings?.geminiApiKey || '').trim()) {
                    e.target.style.transform = 'translateY(-1px)';
                    e.target.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!suggesting && String(localSettings?.geminiApiKey || '').trim()) {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 4px 16px rgba(102, 126, 234, 0.3)';
                  }
                }}
              >
                {suggesting ? '✨ Generating...' : '✨ AI Suggest Workspaces'}
              </button>
              {!basicSaved && (
                <div style={{ fontSize: '14px', color: '#ffd500', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FontAwesomeIcon icon={faExclamationTriangle} />Not saved yet
                </div>
              )}
              {basicSaved && (
                <div style={{ fontSize: '14px', color: '#34C759', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FontAwesomeIcon icon={faCheckCircle} />Saved
                </div>
              )}
            </div>
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faColumns} style={{ marginRight: '8px' }} />Layout</>}>
            <div style={{ padding: '16px 0' }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                fontSize: '16px', 
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Interface Layout
              </h4>
              <p style={{ 
                margin: '0 0 20px 0', 
                fontSize: '14px', 
                color: 'var(--text-secondary)',
                lineHeight: '1.5'
              }}>
                Choose between horizontal header or vertical sidebar layout for the navigation interface.
              </p>

              <div style={{ display: 'grid', gap: '16px' }}>
                {/* Horizontal Layout Option */}
                <div
                  onClick={() => {
                    if (onLayoutToggle) {
                      onLayoutToggle(false);
                      // Also save to localStorage as backup
                      try {
                        localStorage.setItem('cooldesk-vertical-layout', 'false');
                      } catch (e) {
                        console.warn('Failed to save layout preference to localStorage:', e);
                      }
                    }
                  }}
                  style={{
                    padding: '16px',
                    background: !useVerticalLayout 
                      ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
                      : 'var(--bg-secondary)',
                    border: !useVerticalLayout 
                      ? '2px solid rgba(96, 165, 250, 0.6)' 
                      : '1px solid var(--border-primary)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: '2px solid',
                      borderColor: !useVerticalLayout ? '#60a5fa' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {!useVerticalLayout && (
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: '#60a5fa'
                        }} />
                      )}
                    </div>
                    <div>
                      <div style={{ 
                        fontWeight: '600', 
                        color: 'var(--text-primary)',
                        fontSize: '14px'
                      }}>
                        Horizontal Header
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--text-secondary)',
                        marginTop: '2px'
                      }}>
                        Traditional header across the top
                      </div>
                    </div>
                  </div>
                  
                  {/* Layout Preview */}
                  <div style={{
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px',
                    padding: '8px',
                    background: 'var(--bg-tertiary)',
                    fontSize: '10px',
                    color: 'var(--text-secondary)'
                  }}>
                    <div style={{
                      height: '12px',
                      background: 'var(--border-primary)',
                      borderRadius: '2px',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: '4px'
                    }}>
                      Header
                    </div>
                    <div style={{ height: '24px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                      Content Area
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    ✓ More vertical space for content<br/>
                    ✓ Familiar traditional layout<br/>
                    ✓ Better for wide content
                  </div>
                </div>

                {/* Vertical Layout Option */}
                <div
                  onClick={() => {
                    if (onLayoutToggle) {
                      onLayoutToggle(true);
                      // Also save to localStorage as backup
                      try {
                        localStorage.setItem('cooldesk-vertical-layout', 'true');
                      } catch (e) {
                        console.warn('Failed to save layout preference to localStorage:', e);
                      }
                    }
                  }}
                  style={{
                    padding: '16px',
                    background: useVerticalLayout 
                      ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
                      : 'var(--bg-secondary)',
                    border: useVerticalLayout 
                      ? '2px solid rgba(96, 165, 250, 0.6)' 
                      : '1px solid var(--border-primary)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: '2px solid',
                      borderColor: useVerticalLayout ? '#60a5fa' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {useVerticalLayout && (
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: '#60a5fa'
                        }} />
                      )}
                    </div>
                    <div>
                      <div style={{ 
                        fontWeight: '600', 
                        color: 'var(--text-primary)',
                        fontSize: '14px'
                      }}>
                        Vertical Sidebar
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--text-secondary)',
                        marginTop: '2px'
                      }}>
                        Modern sidebar on the right
                      </div>
                    </div>
                  </div>

                  {/* Layout Preview */}
                  <div style={{
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px',
                    padding: '8px',
                    background: 'var(--bg-tertiary)',
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    gap: '4px'
                  }}>
                    <div style={{
                      flex: 1,
                      height: '36px',
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: '4px'
                    }}>
                      Content Area
                    </div>
                    <div style={{
                      width: '20px',
                      background: 'var(--border-primary)',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      writingMode: 'vertical-rl',
                      fontSize: '8px'
                    }}>
                      Sidebar
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    ✓ More horizontal reading space<br/>
                    ✓ Modern app-style interface<br/>
                    ✓ Collapsible to icon-only mode
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: '20px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-primary)'
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  color: 'var(--text-secondary)',
                  lineHeight: '1.5'
                }}>
                  <strong style={{ color: 'var(--text-primary)' }}>💡 Tip:</strong> You can switch between layouts anytime. 
                  The vertical sidebar is great for content-heavy workflows, while the horizontal header maximizes vertical space.
                </div>
              </div>
            </div>
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faSync} style={{ marginRight: '8px' }} />Sync</>}>
            <div style={{ padding: '16px 0' }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                fontSize: '16px', 
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Host Application Sync
              </h4>
              <p style={{ 
                margin: '0 0 20px 0', 
                fontSize: '14px', 
                color: 'var(--text-secondary)',
                lineHeight: '1.5'
              }}>
                Configure synchronization with the desktop host application running on localhost:4000. 
                When enabled, your workspaces, tabs, and activity will sync with the desktop app.
              </p>

              {syncConfigLoading && (
                <div style={{ 
                  padding: '12px', 
                  background: 'var(--bg-secondary)', 
                  borderRadius: '8px', 
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
                  <span style={{ color: 'var(--text-secondary)' }}>Loading sync configuration...</span>
                </div>
              )}

              {syncConfig && (
                <>
                  {/* Master Enable/Disable Switch */}
                  <div style={{ 
                    padding: '16px', 
                    background: 'var(--bg-secondary)', 
                    borderRadius: '8px', 
                    marginBottom: '16px',
                    border: syncConfig.enableHostSync ? '1px solid #34C759' : '1px solid var(--border-primary)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Enable Host Sync</span>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={syncConfig.enableHostSync}
                          onChange={(e) => handleToggleHostSync(e.target.checked)}
                          disabled={syncConfigLoading}
                          style={{ marginRight: '8px' }}
                        />
                        <span style={{ color: syncConfig.enableHostSync ? '#34C759' : 'var(--text-secondary)' }}>
                          {syncConfig.enableHostSync ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {syncConfig.enableHostSync 
                        ? 'Extension will sync data with desktop host application' 
                        : 'Extension running in standalone mode'
                      }
                    </div>
                  </div>

                  {/* Connection Status */}
                  {syncStatus && (
                    <div style={{ 
                      padding: '12px', 
                      background: 'var(--bg-tertiary)', 
                      borderRadius: '6px', 
                      marginBottom: '16px' 
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <FontAwesomeIcon 
                          icon={syncStatus.hostSyncEnabled ? faCheckCircle : faExclamationTriangle} 
                          style={{ color: syncStatus.hostSyncEnabled ? '#34C759' : '#FF9500' }} 
                        />
                        <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                          Connection Status: {syncStatus.hostSyncEnabled ? 'Ready' : 'Disabled'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Host URL: {syncStatus.hostUrl} | WebSocket: {syncStatus.websocketUrl}
                      </div>
                    </div>
                  )}

                  {/* Individual Sync Features */}
                  {syncConfig.enableHostSync && (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      <h5 style={{ 
                        margin: '0 0 8px 0', 
                        fontSize: '14px', 
                        fontWeight: '600',
                        color: 'var(--text-primary)'
                      }}>
                        Sync Features
                      </h5>

                      {[
                        { key: 'syncWorkspaces', label: 'Workspaces', description: 'Sync workspace data and URLs' },
                        { key: 'syncTabs', label: 'Tabs', description: 'Share current browser tabs with host' },
                        { key: 'syncActivity', label: 'Activity', description: 'Track browsing activity and time spent' },
                        { key: 'syncSettings', label: 'Settings', description: 'Synchronize extension settings' },
                        { key: 'syncDashboard', label: 'Dashboard', description: 'Sync dashboard data and bookmarks' },
                        { key: 'enableRedirects', label: 'URL Redirects', description: 'Allow host to redirect URLs' },
                        { key: 'enableHostActions', label: 'Host Actions', description: 'Allow host to open URLs and control browser' }
                      ].map(feature => (
                        <div key={feature.key} style={{ 
                          padding: '12px', 
                          background: 'var(--bg-tertiary)', 
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}>
                          <div>
                            <div style={{ fontWeight: '500', color: 'var(--text-primary)', marginBottom: '2px' }}>
                              {feature.label}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                              {feature.description}
                            </div>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={syncConfig[feature.key]}
                              onChange={(e) => handleSyncConfigChange(feature.key, e.target.checked)}
                              disabled={syncConfigLoading}
                              style={{ marginRight: '8px' }}
                            />
                            <span style={{ 
                              color: syncConfig[feature.key] ? '#34C759' : 'var(--text-secondary)',
                              fontSize: '12px'
                            }}>
                              {syncConfig[feature.key] ? 'On' : 'Off'}
                            </span>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Host URL Configuration */}
                  <div style={{ marginTop: '20px' }}>
                    <h5 style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '14px', 
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      Host Configuration
                    </h5>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                          HTTP URL
                        </label>
                        <input
                          type="text"
                          value={syncConfig.hostUrl}
                          onChange={(e) => handleSyncConfigChange('hostUrl', e.target.value)}
                          disabled={syncConfigLoading}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-primary)',
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-primary)',
                            fontSize: '13px'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                          WebSocket URL
                        </label>
                        <input
                          type="text"
                          value={syncConfig.websocketUrl}
                          onChange={(e) => handleSyncConfigChange('websocketUrl', e.target.value)}
                          disabled={syncConfigLoading}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-primary)',
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-primary)',
                            fontSize: '13px'
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faBullseye} style={{ marginRight: '8px' }} />Personas</>}>
            <div style={{ padding: '16px 0' }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                color: '#e5e7eb', 
                fontSize: '16px',
                fontWeight: '500' 
              }}>
                Create Workspaces from Persona
              </h4>

              {!selectedPersona ? (
                // Persona Selection View
                <div>
                  <p style={{ 
                    margin: '0 0 16px 0', 
                    color: '#9ca3af', 
                    fontSize: '14px', 
                    lineHeight: '1.5' 
                  }}>
                    Choose a persona to automatically create workspaces with relevant URLs and tools.
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                    {personas.map(persona => (
                      <div key={persona.title} style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        padding: '16px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        backdropFilter: 'blur(10px)'
                      }}
                      onMouseEnter={(e) => {
                        e.target.closest('div').style.borderColor = '#34C759';
                        e.target.closest('div').style.background = 'rgba(255, 255, 255, 0.08)';
                        e.target.closest('div').style.transform = 'translateY(-2px)';
                        e.target.closest('div').style.boxShadow = '0 8px 24px rgba(52, 199, 89, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.closest('div').style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.target.closest('div').style.background = 'rgba(255, 255, 255, 0.05)';
                        e.target.closest('div').style.transform = 'translateY(0)';
                        e.target.closest('div').style.boxShadow = 'none';
                      }}
                      onClick={() => handlePersonaSelect(persona)}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px', 
                          marginBottom: '8px' 
                        }}>
                          <FontAwesomeIcon icon={persona.icon} style={{ fontSize: '20px', color: '#34C759' }} />
                          <strong style={{ color: '#e5e7eb', fontSize: '14px' }}>{persona.title}</strong>
                        </div>
                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                          <div style={{ marginBottom: '8px', fontSize: '11px', color: '#6b7280' }}>
                            {persona.description}
                          </div>
                          {persona.workspaces.map((workspace, idx) => (
                            <div key={idx} style={{ marginBottom: '4px' }}>
                              <strong style={{ color: '#d1d5db' }}>{workspace.name}</strong> - {workspace.urls.length} URLs
                            </div>
                          ))}
                          <div style={{ marginTop: '8px', fontSize: '11px', color: '#4a90e2', fontWeight: '500' }}>
                            Total: {getPersonaUrlCount(persona)} URLs across {persona.workspaces.length} workspaces
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // Category Selection and Customization View
                <div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    marginBottom: '16px' 
                  }}>
                    <span style={{ fontSize: '20px' }}>{selectedPersona.emoji}</span>
                    <h5 style={{ margin: 0, color: '#e5e7eb' }}>{selectedPersona.title} Workspaces</h5>
                    <button
                      onClick={() => {
                        setSelectedPersona(null);
                        setSelectedCategories([]);
                      }}
                      style={{
                        marginLeft: 'auto',
                        padding: '8px 12px',
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#e5e7eb',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '500',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                        e.target.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                        e.target.style.transform = 'translateY(0)';
                      }}
                    >
                      ← Back
                    </button>
                  </div>

                  <p style={{ 
                    margin: '0 0 16px 0', 
                    color: '#9ca3af', 
                    fontSize: '14px' 
                  }}>
                    Select and customize the workspaces you want to create:
                  </p>

                  <div style={{ marginBottom: '20px' }}>
                    {selectedCategories.map(category => (
                      <div key={category.id} style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '16px',
                        backdropFilter: 'blur(10px)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            minWidth: '20px',
                            paddingTop: '2px'
                          }}>
                            <input
                              type="checkbox"
                              checked={category.selected}
                              onChange={() => handleCategoryToggle(category.id)}
                              style={{ 
                                width: '18px',
                                height: '18px',
                                accentColor: '#4a90e2',
                                cursor: 'pointer'
                              }}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <input
                              type="text"
                              value={category.editedName}
                              onChange={(e) => handleCategoryRename(category.id, e.target.value)}
                              style={{
                                width: '100%',
                                padding: '12px 16px',
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                color: '#e5e7eb',
                                fontSize: '16px',
                                fontWeight: '600',
                                marginBottom: '12px',
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
                            <div style={{ 
                              fontSize: '13px', 
                              color: '#9ca3af', 
                              marginBottom: '10px',
                              lineHeight: '1.4'
                            }}>
                              {category.description}
                            </div>
                            <div style={{ 
                              fontSize: '12px', 
                              color: '#6b7280',
                              lineHeight: '1.3'
                            }}>
                              <strong style={{ color: '#9ca3af' }}>{category.urls.length} URLs:</strong> {category.urls.slice(0, 3).map(url => {
                                try { return new URL(url).hostname; } catch { return url; }
                              }).join(', ')}
                              {category.urls.length > 3 && ` + ${category.urls.length - 3} more`}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ 
                    display: 'flex', 
                    gap: '8px', 
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {selectedCategories.filter(c => c.selected).length} of {selectedCategories.length} workspaces selected
                    </div>
                    <button
                      className="add-link-btn"
                      onClick={createPersonaWorkspaces}
                      disabled={creatingWorkspaces || !selectedCategories.some(c => c.selected)}
                      style={{ 
                        background: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'rgba(255, 255, 255, 0.05)' : '#34C759',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '12px 20px',
                        color: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? '#9ca3af' : 'white',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s ease',
                        opacity: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 0.6 : 1
                      }}
                      onMouseEnter={(e) => {
                        if (!creatingWorkspaces && selectedCategories.some(c => c.selected)) {
                          e.target.style.transform = 'translateY(-1px)';
                          e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!creatingWorkspaces && selectedCategories.some(c => c.selected)) {
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = 'none';
                        }
                      }}
                    >
                      {creatingWorkspaces ? 'Creating...' : 'Create Workspaces'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ 
                padding: '16px', 
                background: 'rgba(52, 199, 89, 0.1)', 
                border: '1px solid rgba(52, 199, 89, 0.2)',
                borderRadius: '12px',
                fontSize: '13px',
                color: '#9ca3af',
                marginTop: '20px',
                backdropFilter: 'blur(10px)'
              }}>
                <FontAwesomeIcon icon={faLightbulb} style={{ color: '#34C759', marginRight: '8px' }} /> <strong style={{ color: '#34C759' }}>Tip:</strong> Each workspace will be created with curated URLs relevant to your selected persona. You can customize workspace names before creating them.
              </div>
            </div>
          </TabItem>
          <TabItem title={<><FontAwesomeIcon icon={faUser} style={{ marginRight: '8px' }} />Account</>}>
            <div style={{ padding: '16px 0' }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                color: '#e5e7eb', 
                fontSize: '16px',
                fontWeight: '500' 
              }}>
                User Authentication
              </h4>

              {currentUser ? (
                // Signed in view
                <div>
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '20px',
                    backdropFilter: 'blur(10px)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{
                        width: '8px',
                        height: '8px',
                        background: '#10b981',
                        borderRadius: '50%'
                      }}></div>
                      <strong style={{ color: '#10b981', fontSize: '14px' }}>Signed In</strong>
                    </div>
                    <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
                      <strong>Email:</strong> {currentUser.email || 'Anonymous User'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
                      <strong>User ID:</strong> {currentUser.uid?.substring(0, 8)}...
                    </div>
                    <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                      <strong>Type:</strong> {currentUser.isAnonymous ? 'Anonymous' : 'Email/Password'}
                    </div>
                  </div>

                  <button
                    className="add-link-btn"
                    onClick={handleSignOut}
                    disabled={authLoading}
                    style={{
                      background: '#dc2626',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px 20px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: authLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                      opacity: authLoading ? 0.6 : 1,
                      boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)'
                    }}
                    onMouseEnter={(e) => {
                      if (!authLoading) {
                        e.target.style.transform = 'translateY(-1px)';
                        e.target.style.boxShadow = '0 4px 12px rgba(220, 38, 38, 0.4)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!authLoading) {
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow = '0 2px 8px rgba(220, 38, 38, 0.3)';
                      }
                    }}
                  >
                    {authLoading ? 'Signing Out...' : 'Sign Out'}
                  </button>
                </div>
              ) : (
                // Google Sign-In view
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <p style={{ 
                      margin: '0 0 24px 0', 
                      color: '#9ca3af', 
                      fontSize: '14px', 
                      lineHeight: '1.5' 
                    }}>
                      Sign in with your Google account to sync workspaces across all your devices.
                    </p>

                    <button
                      className="add-link-btn"
                      onClick={handleGoogleSignIn}
                      disabled={authLoading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        margin: '0 auto',
                        padding: '14px 28px',
                        background: '#4285f4',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: '600',
                        color: 'white',
                        opacity: authLoading ? 0.6 : 1,
                        cursor: authLoading ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 8px rgba(66, 133, 244, 0.3)'
                      }}
                      onMouseEnter={(e) => {
                        if (!authLoading) {
                          e.target.style.transform = 'translateY(-1px)';
                          e.target.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.4)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!authLoading) {
                          e.target.style.transform = 'translateY(0)';
                          e.target.style.boxShadow = '0 2px 8px rgba(66, 133, 244, 0.3)';
                        }
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="white"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="white"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="white"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="white"/>
                      </svg>
                      {authLoading ? 'Signing In...' : 'Sign in with Google'}
                    </button>
                  </div>

                  <div style={{ 
                    padding: '16px', 
                    background: 'rgba(66, 133, 244, 0.1)', 
                    border: '1px solid rgba(66, 133, 244, 0.2)',
                    borderRadius: '12px',
                    fontSize: '13px',
                    color: '#9ca3af',
                    textAlign: 'center',
                    backdropFilter: 'blur(10px)'
                  }}>
                    💡 <strong style={{ color: '#4285f4' }}>Note:</strong> Google sign-in allows you to sync workspaces across devices. Anonymous mode keeps data local to this browser.
                  </div>
                </div>
              )}
            </div>
          </TabItem>
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

// Simple Tabs components local to this file
function Tabs({ children, activeTab: controlledActiveTab, onTabChange, disabledTitles = [] }) {
  const [internalTab, setInternalTab] = useState(0);
  const activeTab = (typeof controlledActiveTab === 'number') ? controlledActiveTab : internalTab;
  const setActiveTab = (typeof onTabChange === 'function') ? onTabChange : setInternalTab;
  return (
    <div>
      <div className="tab-list" role="tablist" style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        {React.Children.map(children, (child, index) => (
          <button
            key={index}
            role="tab"
            aria-selected={activeTab === index}
            onClick={() => {
              const title = child.props.title
              const isDisabled = Array.isArray(disabledTitles) && disabledTitles.includes(title)
              if (isDisabled) return
              setActiveTab(index)
            }}
            disabled={Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)}
            className="filter-btn"
            style={{
              padding: '16px 24px',
              background: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) 
                ? 'rgba(255, 255, 255, 0.03)' 
                : (activeTab === index ? '#34C759' : 'rgba(255, 255, 255, 0.1)'),
              border: activeTab === index ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '16px',
              color: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) 
                ? '#6b7280' 
                : (activeTab === index ? 'white' : '#e5e7eb'),
              fontSize: '16px',
              fontWeight: activeTab === index ? '600' : '500',
              opacity: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? 0.5 : 1,
              cursor: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: activeTab === index ? '0 4px 16px rgba(52, 199, 89, 0.3)' : 'none',
              minWidth: '140px'
            }}
            onMouseEnter={(e) => {
              const title = child.props.title;
              const isDisabled = Array.isArray(disabledTitles) && disabledTitles.includes(title);
              if (!isDisabled && activeTab !== index) {
                e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                e.target.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              const title = child.props.title;
              const isDisabled = Array.isArray(disabledTitles) && disabledTitles.includes(title);
              if (!isDisabled && activeTab !== index) {
                e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                e.target.style.transform = 'translateY(0)';
              }
            }}
          >
            {child.props.title}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {React.Children.map(children, (child, index) => (
          <div key={index} role="tabpanel" hidden={activeTab !== index}>
            {child.props.children}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabItem({ title, children }) {
  return <>{children}</>;
}
