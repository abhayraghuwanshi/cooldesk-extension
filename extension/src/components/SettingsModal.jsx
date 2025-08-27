import { faFloppyDisk, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import { deleteWorkspaceById, listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace, subscribeWorkspaceChanges, initializeFirebase, signInWithGoogle, signOutUser, getCurrentUser, onAuthStateChange } from '../services/firebase';
import { sendMessage, storageGet, storageSet } from '../services/extensionApi';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';
import { personas, validatePersona, getPersonaUrlCount } from '../data/personas';

export function SettingsModal({ show, onClose, settings, onSave }) {
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
    // Guard: require an explicit Save & Continue before accessing Workspaces
    if (nextIndex !== 0 && !basicSaved) {
      setError('Please press "Save & Continue" in Basic to proceed to Workspaces')
      return
    }
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
      const result = await signInWithGoogle();

      if (!result.success) {
        setError(result.error);
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
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div
          className="modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingBottom: 8,
            borderBottom: '1px solid #273043',
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0 }}>Settings</h3>
          <button
            onClick={onClose}
            className="cancel-btn"
            aria-label="Close"
            title="Close"
            style={{ padding: '4px 8px' }}
          >
            ×
          </button>
        </div>
        {error && (
          <div style={{
            marginBottom: 10,
            color: '#ff6b6b',
            fontSize: 12,
            background: '#241b1b',
            border: '1px solid #3a2222',
            padding: '6px 8px',
            borderRadius: 6,
          }}>
            {error}
          </div>
        )}
        <Tabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          disabledTitles={basicSaved ? [] : ['Workspaces', 'Interest']}
        >
          <TabItem title="Basic">
            <label>
              <span>Gemini API Key</span>
              <input
                value={localSettings.geminiApiKey}
                onChange={(e) => { setLocalSettings({ ...localSettings, geminiApiKey: e.target.value }); markEdited(); }}
                placeholder="sk-..."
                required
              />
            </label>
            <label>
              <span>Model Name</span>
              <input
                value={localSettings.modelName || ''}
                onChange={(e) => { setLocalSettings({ ...localSettings, modelName: e.target.value }); markEdited(); }}
                placeholder="e.g., gemini-1.5-pro"
              />
            </label>
            <label>
              <span>Visit Count Threshold</span>
              <input
                type="number"
                min="0"
                value={localSettings.visitCountThreshold}
                onChange={(e) => { setLocalSettings({ ...localSettings, visitCountThreshold: e.target.value }); markEdited(); }}
              />
            </label>
            <label>
              <span>History Lookback</span>
              <select
                value={typeof localSettings.historyDays === 'number' && localSettings.historyDays > 0 ? localSettings.historyDays : (localSettings.historyDays || 30)}
                onChange={(e) => { setLocalSettings({ ...localSettings, historyDays: Number(e.target.value) }); markEdited(); }}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: '#0f1522',
                  border: '1px solid #273043',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  outline: 'none',
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
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
                    setActiveTab(1) // jump to Workspaces
                  } catch (e) {
                    setError(String(e?.message || e) || 'Failed to save settings')
                  }
                }}
                title="Save Basic settings and continue to Workspaces"
              >
                Save & Continue
              </button>
              {!basicSaved && (
                <div style={{ fontSize: 12, color: '#ffd500' }}>Not saved yet</div>
              )}
              {basicSaved && (
                <div style={{ fontSize: 12, color: '#7bd88f' }}>Saved</div>
              )}
            </div>
          </TabItem>
          <TabItem title="Workspaces">
            <label>
              <span>Workspaces</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editableWorkspaces.map((row) => (
                  <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      style={{ flex: 1 }}
                      placeholder="Workspace name"
                      value={row.name}
                      onChange={(e) => handleUpdateWorkspaceField(row.id, 'name', e.target.value)}
                    />
                    <input
                      style={{ flex: 2 }}
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => handleUpdateWorkspaceField(row.id, 'description', e.target.value)}
                    />
                    <button
                      className="filter-btn"
                      onClick={() => handleSaveWorkspaceRow(row.id)}
                      title="Save"
                      aria-label="Save workspace"
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} />
                    </button>
                    <button
                      className="filter-btn"
                      onClick={() => handleDeleteWorkspace(row.id)}
                      title="Delete"
                      aria-label="Delete workspace"
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="add-link-btn" onClick={handleOpenCreateWorkspace} title="Create workspace">Add</button>
                  <button className="add-link-btn" onClick={handleSuggestCategories} disabled={suggesting || !(String(localSettings?.geminiApiKey || '').trim())} title="AI-suggest workspaces from your URLs">
                    {suggesting ? 'Suggesting…' : 'AI Suggest'}
                  </button>
                </div>
              </div>
            </label>
          </TabItem>
          <TabItem title="Interest">
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
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    {personas.map(persona => (
                      <div key={persona.title} style={{
                        background: '#1a1f2e',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        padding: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.target.closest('div').style.borderColor = '#4a90e2';
                        e.target.closest('div').style.background = '#1e2432';
                      }}
                      onMouseLeave={(e) => {
                        e.target.closest('div').style.borderColor = '#374151';
                        e.target.closest('div').style.background = '#1a1f2e';
                      }}
                      onClick={() => handlePersonaSelect(persona)}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px', 
                          marginBottom: '8px' 
                        }}>
                          <span style={{ fontSize: '20px' }}>{persona.emoji}</span>
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
                        padding: '4px 8px',
                        background: 'transparent',
                        border: '1px solid #374151',
                        color: '#9ca3af',
                        borderRadius: '4px',
                        cursor: 'pointer'
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
                        background: '#1a1f2e',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        padding: '16px',
                        marginBottom: '12px'
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
                                padding: '8px 12px',
                                background: '#0f1522',
                                border: '1px solid #273043',
                                borderRadius: '6px',
                                color: '#e5e7eb',
                                fontSize: '15px',
                                fontWeight: '500',
                                marginBottom: '10px',
                                outline: 'none'
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
                        opacity: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 0.6 : 1,
                        cursor: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {creatingWorkspaces ? 'Creating...' : 'Create Workspaces'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ 
                padding: '12px', 
                background: '#0b101a', 
                border: '1px solid #1f2937',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#6b7280',
                marginTop: '16px'
              }}>
                💡 <strong>Tip:</strong> Each workspace will be created with curated URLs relevant to your selected persona. You can customize workspace names before creating them.
              </div>
            </div>
          </TabItem>
          <TabItem title="Auth">
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
                    background: '#0b2818',
                    border: '1px solid #22543d',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '16px'
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
                      borderColor: '#dc2626',
                      opacity: authLoading ? 0.6 : 1
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
                        padding: '12px 24px',
                        background: '#4285f4',
                        borderColor: '#4285f4',
                        fontSize: '14px',
                        fontWeight: '500',
                        opacity: authLoading ? 0.6 : 1,
                        cursor: authLoading ? 'not-allowed' : 'pointer'
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
                    padding: '12px', 
                    background: '#0b101a', 
                    border: '1px solid #1f2937',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#6b7280',
                    textAlign: 'center'
                  }}>
                    💡 <strong>Note:</strong> Google sign-in allows you to sync workspaces across devices. Anonymous mode keeps data local to this browser.
                  </div>
                </div>
              )}
            </div>
          </TabItem>
        </Tabs>

        {/* Removed global Save button; use Save & Continue in Basic tab */}

        <CreateWorkspaceModal
          show={showCreateWorkspace}
          onClose={handleCloseCreateWorkspace}
          onCreate={handleCreateWorkspace}
          currentTab={null}
        />
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
      <div className="tab-list" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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
              padding: '6px 10px',
              background: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? '#0b101a' : (activeTab === index ? '#1b2331' : '#0f1522'),
              border: '1px solid #273043',
              borderBottomColor: activeTab === index ? '#4a90e2' : '#273043',
              opacity: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? 0.6 : 1,
              cursor: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? 'not-allowed' : 'pointer',
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
