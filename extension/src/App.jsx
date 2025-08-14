import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { getSettings as getSettingsDB, listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace, subscribeWorkspaceChanges } from './db';

// Utility functions
const getDomainFromUrl = (url) => {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
};

const getUrlParts = (url) => {
  try {
    const u = new URL(url)
    const key = `${u.protocol}//${u.hostname}`
    const remainder = `${u.pathname || ''}${u.search || ''}${u.hash || ''}`
    const hasFullPath = (u.pathname && u.pathname !== '/') || !!u.search || !!u.hash
    const pathSegments = (u.pathname || '').split('/').filter(Boolean)
    const queryEntries = []
    if (u.searchParams && [...u.searchParams.keys()].length) {
      u.searchParams.forEach((v, k) => queryEntries.push({ k, v }))
    }
    const hashRaw = (u.hash || '').replace(/^#/, '')
    const hashSegments = hashRaw ? hashRaw.split('/').filter(Boolean) : []
    return { key, remainder, hasFullPath, pathSegments, queryEntries, hashSegments }
  } catch {
    return { key: url, remainder: '', hasFullPath: false, pathSegments: [], queryEntries: [], hashSegments: [] }
  }
}

const getFaviconUrl = (url, size = 32) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=${size}` } catch { return null }
};

const formatTime = (ms) => {
  if (!ms || ms < 60000) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
};

function useDashboardData() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [populating, setPopulating] = useState(false)

  const normalize = (dashboardData) => {
    const bookmarks = (dashboardData?.bookmarks || []).map((b) => ({ ...b, type: 'Bookmark' }))
    const history = (dashboardData?.history || []).map((h) => ({ ...h, type: 'History' }))
    // Prefer history entries over bookmarks so we keep enrichment like workspaceGroup
    const combined = [...history, ...bookmarks]
    const map = new Map()
    combined.forEach((it) => {
      const prev = map.get(it.url)
      if (!prev) {
        // Apply fallback logic even for single items
        let item = { ...it }
        if (!item.workspaceGroup && item.category && typeof item.category === 'object' && item.category.name) {
          item = { ...item, workspaceGroup: item.category.name }
        }
        map.set(it.url, item)
      } else {
        // Merge to preserve enriched fields from either source
        let merged = {
          ...prev,
          ...it,
          // Prefer truthy enriched metadata from either prev or it
          workspaceGroup: it.workspaceGroup || prev.workspaceGroup,
          category: it.category || prev.category,
          secondaryCategories: it.secondaryCategories || prev.secondaryCategories,
          tags: it.tags || prev.tags,
          summary: it.summary || prev.summary,
          // Keep the most recent timing info
          lastVisitTime: Math.max(prev.lastVisitTime || 0, it.lastVisitTime || 0) || (prev.lastVisitTime || it.lastVisitTime),
          dateAdded: Math.max(prev.dateAdded || 0, it.dateAdded || 0) || (prev.dateAdded || it.dateAdded),
          // Max visitCount to keep prominence
          visitCount: Math.max(prev.visitCount || 0, it.visitCount || 0) || (prev.visitCount || it.visitCount),
          // Prefer a meaningful title
          title: (it.title && it.title.trim()) ? it.title : prev.title,
        }
        // Fallback: derive workspaceGroup from category.name if missing
        if (!merged.workspaceGroup && merged.category && typeof merged.category === 'object' && merged.category.name) {
          merged = { ...merged, workspaceGroup: merged.category.name }
        }
        map.set(it.url, merged)
      }
    })
    return Array.from(map.values()).sort((a, b) => (b.lastVisitTime || b.dateAdded || 0) - (a.lastVisitTime || a.dateAdded || 0))
  }

  const load = async () => {
    try {
      const { dashboardData } = await chrome.storage.local.get(['dashboardData'])
      const arr = normalize(dashboardData)
      try {
        const histLen = (dashboardData?.history || []).length
        const bmLen = (dashboardData?.bookmarks || []).length
        const groups = Array.from(new Set(arr.map(it => it.workspaceGroup).filter(Boolean)))
        const sampleAI = arr.find(it => (it.category || it.workspaceGroup || it.summary || it.tags) && typeof it.url === 'string')
        // Key diagnostics to verify data presence from store
        console.debug('[CoolDesk] Store snapshot:', {
          historyCount: histLen,
          bookmarkCount: bmLen,
          mergedCount: arr.length,
          uniqueGroups: groups,
          hasChatGPT: arr.some(it => (it.url || '').includes('chatgpt.com')),
          sampleAI
        })
      } catch {}
      setData(arr)
      // If empty, ask background to populate
      if (!arr.length && !populating) {
        setPopulating(true)
        try {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'populateData' }, () => resolve())
          })
        } finally {
          setPopulating(false)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const listener = (req) => {
      if (req?.action === 'updateData' || req?.action === 'aiComplete') {
        load()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  return { data, loading, populate: () => chrome.runtime.sendMessage({ action: 'populateData' }) }
}

// AI Suggestion Hook
function useAISuggestions() {
  const [aiState, setAiState] = useState({ loading: false, suggestions: [], error: null })

  const getSuggestions = async (urls) => {
    try {
      setAiState({ loading: true, suggestions: [], error: null });
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSuggestionFor', urls: Array.isArray(urls) ? urls : [urls] }, resolve);
      });

      if (!response?.ok) {
        setAiState({ loading: false, suggestions: [], error: response?.error || 'AI error' });
        return;
      }

      // The response from the background script is a string, so we need to parse it.
      let suggestions = [];
      try {
        const parsed = JSON.parse(response.suggestions);
        if (parsed && Array.isArray(parsed.suggestions)) {
          suggestions = parsed.suggestions;
        }
      } catch (e) {
        console.error('Failed to parse AI suggestions:', e);
        setAiState({ loading: false, suggestions: [], error: 'Failed to parse AI response.' });
        return;
      }

      setAiState({
        loading: false,
        suggestions: suggestions,
        error: null,
      });
    } catch (err) {
      setAiState({ loading: false, suggestions: [], error: String(err) })
    }
  }

  return { ...aiState, getSuggestions }
}

// Workspace Filter Component
function WorkspaceFilters({ items, active, onChange }) {
  const workspaces = useMemo(() => {
    const set = new Set()
    items.forEach((i) => {
      // Extract from workspaceGroup or fallback to category.name
      if (i.workspaceGroup) {
        set.add(i.workspaceGroup)
      } else if (i.category && typeof i.category === 'object' && i.category.name) {
        set.add(i.category.name)
      }
    })
    return ['All', ...Array.from(set)]
  }, [items])

  return (
    <div id="workspace-filters" className="ws-filters">
      {workspaces.map((ws) => (
        <button
          key={ws}
          className={`tag-chip ${ws === active ? 'active' : ''}`}
          onClick={() => onChange(ws)}
          type="button"
        >
          {ws}
        </button>
      ))}
    </div>
  )
}

// Stats Card Component
function StatsCard({ item, showCount = false, onAISuggest }) {
  const favicon = getFaviconUrl(item.url)
  const domain = getDomainFromUrl(item.url)

  const handleCardClick = () => {
    window.open(item.url, '_blank')
  }

  const handleGetRelated = (e) => {
    e.stopPropagation()
    onAISuggest(item.url, item.title || domain)
  }

  return (
    <li className="stats-card" onClick={handleCardClick}>
      <div className="row">
        {favicon && <img className="stats-favicon" src={favicon} alt="" />}
        <span className="stats-title">{item.title || 'No Title'}</span>
      </div>
      <div className="row space">
        <span className="muted" title={domain}>
          {domain && domain.length > 16 ? `${domain.slice(0, 16)}…` : domain}
        </span>
      </div>
    </li>
  )
}

// Related Products Section Component
function RelatedProductsSection({ relatedItems, onClear }) {
  if (!relatedItems || relatedItems.length === 0) return null

  return (
    <section className="related-products-section">
      <div className="section-header">
        <h3>Related & Similar Products</h3>
        <button className="clear-btn" onClick={onClear} title="Clear suggestions">
          ✕
        </button>
      </div>
      <div className="related-grid">
        {relatedItems.map((item, idx) => (
          <div key={idx} className="related-item" onClick={() => window.open(item.url, '_blank')}>
            <div className="related-info">
              <div className="related-title">{item.label || item.title || 'Related Item'}</div>
              <div className="related-description">{item.suggestion || item.description}</div>
              <div className="related-domain">{getDomainFromUrl(item.url)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// Stats View Component
function StatsView({ items, search, workspace, onAddRelated }) {
  const searchLower = (search || '').toLowerCase()
  const filtered = items.filter((it) => {
    // Check workspaceGroup or fallback to category.name
    const itemWorkspace = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null)
    const inWs = workspace === 'All' || itemWorkspace === workspace
    const inSearch = !searchLower || (it.title?.toLowerCase().includes(searchLower) || it.url?.toLowerCase().includes(searchLower))
    return inWs && inSearch
  })

  const frequent = useMemo(() => {
    const counts = {}
    filtered.forEach((it) => {
      const k = it.url
      if (!counts[k]) counts[k] = { title: it.title, url: it.url, count: 0 }
      counts[k].count = Math.max(counts[k].count, it.visitCount || 1)
    })
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [filtered])

  const recent = useMemo(() => {
    return filtered
      .filter((it) => it.lastVisitTime || it.dateAdded)
      .slice(0, 8)
  }, [filtered])

  return (
    <div className="stats-container">
      <section>
        <h3>Most Visited</h3>
        <ul className="stats-grid">
          {frequent.map((item) => (
            <StatsCard key={item.url} item={item} showCount={true} onAISuggest={onAddRelated} />
          ))}
        </ul>
      </section>
      <section>
        <h3>Recently Accessed</h3>
        <ul className="stats-grid">
          {recent.map((item) => (
            <StatsCard key={item.url} item={item} showCount={false} onAISuggest={onAddRelated} />
          ))}
        </ul>
      </section>
    </div>
  )
}

// Workspace Item Component
function WorkspaceItem({ base, values, onAddRelated, timeSpentMs }) {
  const [showDetails, setShowDetails] = useState(false);
  const favicon = getFaviconUrl(base);
  const timeString = formatTime(timeSpentMs);

  // Get unique tags from all items in the workspace
  const tags = useMemo(() => {
    const allTags = values.flatMap(item => item.tags || []);
    return [...new Set(allTags)];
  }, [values]);

  const handleItemClick = () => {
    window.open(base, '_blank');
  };

  const toggleDetails = (e) => {
    e.stopPropagation();
    setShowDetails(!showDetails);
  };

  const handleGetRelated = (e) => {
    e.stopPropagation();
    onAddRelated(base, getDomainFromUrl(base));
  };

  return (
    <li className="workspace-item">
      <div className="item-header" onClick={handleItemClick}>
        <div className="item-info">
          {favicon && <img className="favicon" src={favicon} alt="" />}
          <div className="domain-info">

            <span className="url-key" title={base}>{base.length > 40 ? base.slice(0, 37) + '…' : base}</span>
          </div>
        </div>
        <div className="item-actions">
          {timeString && <span className="time-spent-badge">{timeString}</span>}
          {values.length > 0 && (
            <button
              className="details-btn"
              onClick={toggleDetails}
              title={`${showDetails ? 'Hide' : 'Show'} ${values.length} paths`}
            >
              {values.length} paths
            </button>
          )}
        </div>
      </div>

      {/* {tags.length > 0 && (
        <div className="tags-list">
          {tags.map(tag => (
            <span key={tag} className="tag-chip">{tag}</span>
          ))}
        </div>
      )} */}

      {/* History Paths */}
      {showDetails && values.length > 0 && (
        <div className="item-details">
          <div className="details-title">History Paths:</div>
          <div className="paths-list">
            {values.map((item) => {
              const path = getUrlParts(item.url).remainder || '/';
              return (
                <button
                  key={item.url}
                  className="path-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(item.url, '_blank');
                  }}
                  title={item.url}
                >
                  {path}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </li>
  );
}

// Item Grid Component
function SuggestionBlock({ loading, error, suggestions, onClear, onAddRelated }) {
  if (loading) {
    return <div className="loading-spinner"></div>
  }

  if (error) {
    return <div className="error-message">Error: {error}</div>
  }

  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="related-products">
      <div className="related-header">
        <h4>Related Products</h4>
        <button onClick={onClear} className="clear-btn">
          Clear
        </button>
      </div>
      <div className="related-grid">
        {suggestions.map((item, index) => (
          <div key={index} className="related-item" onClick={() => onAddRelated(item)}>
            <div className="related-favicon-container">
              <img src={item.favicon} alt="" className="related-favicon" />
            </div>
            <div className="related-info">
              <div className="related-title-container">
                <span className="related-title">{item.title}</span>
              </div>
              <div className="related-domain">{item.domain}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ItemGrid({ items, onAddRelated }) {
  const [timeSpent, setTimeSpent] = useState({});
  const [selectedGroup, setSelectedGroup] = useState('All');

  useEffect(() => {
    chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (response) => {
      if (response?.ok) {
        setTimeSpent(response.timeSpent || {});
      }
    });
  }, []);
  const groups = useMemo(() => {
    const map = new Map()
    items
      .filter((it) => it.type === 'History' && (it.visitCount || 0) > 1)
      .forEach((it) => {
        const parts = getUrlParts(it.url)
        if (parts.queryEntries.length > 0) return
        const { key, remainder } = parts
        const val = remainder && remainder !== '' ? remainder : '/'
        if (!map.has(key)) map.set(key, new Set())
        map.get(key).add(it)
      })
    return Array.from(map.entries()).map(([key, set]) => ({
      key,
      values: Array.from(set).sort(),
    }))
  }, [items])

  const displayGroups = useMemo(() => {
    if (selectedGroup === 'All') return groups
    return groups.filter(g => g.key === selectedGroup)
  }, [groups, selectedGroup])

  const { loading, suggestions, error, getSuggestions, clearSuggestions } = useAISuggestions()

  const handleGetSuggestions = () => {
    // Use the most frequent domain or a representative URL
    if ((selectedGroup === 'All' ? groups : displayGroups).length > 0) {
      // For simplicity, we'll use the first workspace group's base URL.
      // A more sophisticated approach could find the most common domain.
      const arr = selectedGroup === 'All' ? groups : displayGroups
      getSuggestions(arr[0].key)
    }
  }

  return (
    <div>
      <div className="workspace-chips">
        <button
          key="All"
          className={`tag-chip workspace-chip ${selectedGroup === 'All' ? 'active' : ''}`}
          onClick={() => setSelectedGroup('All')}
          type="button"
        >
          All
          <span className="chip-badge">{groups.reduce((sum, g) => sum + g.values.length, 0)}</span>
        </button>
        {groups.map(({ key, values }) => (
          <button
            key={key}
            className={`tag-chip workspace-chip ${selectedGroup === key ? 'active' : ''}`}
            title={key}
            onClick={() => setSelectedGroup(key)}
            type="button"
          >
            {getDomainFromUrl(key)}
            <span className="chip-badge">{values.length}</span>
          </button>
        ))}
      </div>
      <ul className="workspace-grid fixed-four">
        {displayGroups.map(({ key, values }) => (
          <WorkspaceItem key={key} base={key} values={values} onAddRelated={onAddRelated} timeSpentMs={timeSpent[key]} />
        ))}
      </ul>
      {/* <div className="suggestion-controls">
        <button onClick={handleGetSuggestions} disabled={loading}>
          {loading ? 'Getting Suggestions...' : 'Get Workspace Suggestions'}
        </button>
      </div> */}
      <SuggestionBlock
        loading={loading}
        error={error}
        suggestions={suggestions}
        onClear={clearSuggestions}
        onAddRelated={onAddRelated}
      />
    </div>
  )
}

// Settings Modal Component
function SettingsModal({ show, onClose, settings, onSave }) {
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleSave = () => {
    onSave(localSettings)
  }

  if (!show) return null

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Settings</h3>
        <label>
          <span>Gemini API Key</span>
          <input
            value={localSettings.geminiApiKey}
            onChange={(e) => setLocalSettings({ ...localSettings, geminiApiKey: e.target.value })}
            placeholder="sk-..."
          />
        </label>
        <label>
          <span>API Server URL (optional)</span>
          <input
            value={localSettings.serverUrl}
            onChange={(e) => setLocalSettings({ ...localSettings, serverUrl: e.target.value })}
            placeholder="https://..."
          />
        </label>
        <label>
          <span>Visit Count Threshold</span>
          <input
            type="number"
            min="0"
            value={localSettings.visitCountThreshold}
            onChange={(e) => setLocalSettings({ ...localSettings, visitCountThreshold: e.target.value })}
          />
        </label>
        <label>
          <span>History Fetch Limit</span>
          <input
            type="number"
            min="10"
            value={localSettings.historyMaxResults}
            onChange={(e) => setLocalSettings({ ...localSettings, historyMaxResults: e.target.value })}
          />
        </label>
        <div className="modal-actions">
          <button className="filter-btn" onClick={onClose}>Cancel</button>
          <button className="filter-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

// Create Workspace Modal Component
function CreateWorkspaceModal({ show, onClose, onCreate, currentTab }) {
  const [workspaceName, setWorkspaceName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (show && currentTab) {
      // Auto-suggest workspace name based on current tab
      const domain = getDomainFromUrl(currentTab.url)
      setWorkspaceName(`${domain} workspace`)
      setDescription(`Workspace created from ${currentTab.title}`)
    }
  }, [show, currentTab])

  const handleCreate = async () => {
    if (!workspaceName.trim()) return

    setLoading(true)
    try {
      await onCreate(workspaceName.trim(), description.trim())
      setWorkspaceName('')
      setDescription('')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setWorkspaceName('')
    setDescription('')
    onClose()
  }

  if (!show) return null

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal">
        <h3>Create New Workspace</h3>

        {currentTab && (
          <div className="current-tab-info">
            <div className="tab-preview">
              <img src={getFaviconUrl(currentTab.url)} alt="" className="tab-favicon" />
              <div className="tab-details">
                <div className="tab-title">{currentTab.title}</div>
                <div className="tab-url">{currentTab.url}</div>
              </div>
            </div>
          </div>
        )}

        <label>
          <span>Workspace Name *</span>
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="Enter workspace name..."
            autoFocus
          />
        </label>

        <label>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you working on? (optional)"
            rows="3"
          />
        </label>

        <div className="modal-actions">
          <button className="filter-btn" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="filter-btn primary"
            onClick={handleCreate}
            disabled={!workspaceName.trim() || loading}
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Main App Component
export default function App() {
  const { data, loading, populate } = useDashboardData()
  const [workspace, setWorkspace] = useState('All')
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState({ geminiApiKey: '', serverUrl: '', visitCountThreshold: '', historyMaxResults: '' })
  const [progress, setProgress] = useState({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
  const [relatedProducts, setRelatedProducts] = useState([])
  const [savedWsFilter, setSavedWsFilter] = useState('All')
  const [loadingRelated, setLoadingRelated] = useState(false)
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [currentTab, setCurrentTab] = useState(null)
  const [savedWorkspaces, setSavedWorkspaces] = useState([])

  useEffect(() => {
    // Load settings initially from IndexedDB
    (async () => {
      const s = await getSettingsDB()
      const { geminiApiKey, serverUrl, visitCountThreshold, historyMaxResults } = s || {}
      setSettings({
        geminiApiKey: geminiApiKey || '',
        serverUrl: serverUrl || '',
        visitCountThreshold: Number.isFinite(visitCountThreshold) ? String(visitCountThreshold) : '',
        historyMaxResults: Number.isFinite(historyMaxResults) ? String(historyMaxResults) : ''
      })
    })()

      // Load saved workspaces initially from IndexedDB
      ; (async () => {
        try {
          let workspaces = await listWorkspaces()
          // One-time migration from chrome.storage.local -> IndexedDB
          if (!Array.isArray(workspaces) || workspaces.length === 0) {
            try {
              const legacy = await chrome.storage.local.get(['workspaces'])
              const legacyList = Array.isArray(legacy?.workspaces) ? legacy.workspaces : []
              if (legacyList.length) {
                // Save each to IndexedDB
                for (const w of legacyList) {
                  try { await saveWorkspace(w) } catch { }
                }
                workspaces = await listWorkspaces()
              }
            } catch { }
          }
          setSavedWorkspaces(Array.isArray(workspaces) ? workspaces : [])
        } catch (e) {
          console.error('Failed to load workspaces:', e)
        }
      })()

    const onMsg = (req) => {
      if (req?.action === 'aiProgress') {
        setProgress((p) => ({ ...p, running: true, processed: req.processed || 0, total: req.total || 0, currentItem: req.currentItem || '', apiHits: req.apiHits || 0 }))
      } else if (req?.action === 'aiComplete') {
        setProgress((p) => ({ ...p, running: false }))
      } else if (req?.action === 'aiError') {
        setProgress({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: req.error || 'Unknown error' })
        setTimeout(() => setProgress((p) => ({ ...p, error: '' })), 4000)
      } else if (req?.action === 'updateData') {
        // data reloaded via hook
      }
    }
    chrome.runtime.onMessage.addListener(onMsg)

    // Subscribe to IndexedDB changes via BroadcastChannel
    const unsubscribe = subscribeWorkspaceChanges(async () => {
      try {
        const workspaces = await listWorkspaces()
        setSavedWorkspaces(Array.isArray(workspaces) ? workspaces : [])
      } catch (e) {
        console.error('Failed to refresh workspaces:', e)
      }
    })

    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      unsubscribe && unsubscribe()
    }
  }, [])

  // When opening the Create Workspace modal, fetch current tab for auto-suggest
  useEffect(() => {
    if (showCreateWorkspace) {
      getCurrentTabInfo()
    }
  }, [showCreateWorkspace])

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return data.filter((it) => {
      // Check workspaceGroup or fallback to category.name
      const itemWorkspace = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null)
      const inWs = workspace === 'All' || itemWorkspace === workspace
      const inSearch = !s || it.title?.toLowerCase().includes(s) || it.summary?.toLowerCase().includes(s) || it.url?.toLowerCase().includes(s)
      return inWs && inSearch
    })
  }, [data, workspace, search])

  const saveSettings = async (newSettings) => {
    const payload = {}
    if (newSettings.geminiApiKey?.trim()) payload.geminiApiKey = newSettings.geminiApiKey.trim()
    if (newSettings.serverUrl?.trim()) payload.serverUrl = newSettings.serverUrl.trim().replace(/\/$/, '')
    if (newSettings.visitCountThreshold !== '') payload.visitCountThreshold = Number(newSettings.visitCountThreshold) || 0
    if (newSettings.historyMaxResults !== '') payload.historyMaxResults = Number(newSettings.historyMaxResults) || 1000
    // Save to IndexedDB
    await saveSettingsDB(payload)
    // Mirror to chrome.storage.local for background/service worker compatibility
    try { await chrome.storage.local.set(payload) } catch { }
    setSettings(newSettings)
    setShowSettings(false)
  }

  const startEnrichment = () => {
    // Preflight: ensure we have items to enrich
    ; (async () => {
      const { dashboardData, geminiApiKey } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey'])
      if (!geminiApiKey || !geminiApiKey.trim()) {
        setProgress({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: 'Set your Gemini API key in Settings before syncing.' })
        setTimeout(() => setProgress((p) => ({ ...p, error: '' })), 4000)
        return
      }
      const total = (dashboardData?.history || []).length
      if (!total) {
        setProgress({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: 'No history items to enrich. Click "Refresh Data" or lower the threshold in Settings.' })
        setTimeout(() => setProgress((p) => ({ ...p, error: '' })), 4000)
        return
      }
      // Avoid duplicate triggers
      setProgress((p) => {
        if (p.running) return p
        return { running: true, processed: 0, total, currentItem: 'Starting...', apiHits: 0, error: '' }
      })
      // Fire-and-forget; progress/errors come via runtime messages
      chrome.runtime.sendMessage({ action: 'enrichWithAI' })
    })()
  }

  const openInTab = () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage()
  }

  const handleAddRelated = async (url, title) => {
    try {
      setLoadingRelated(true)
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSuggestionFor', urls: [url] }, resolve)
      })

      if (response?.ok && Array.isArray(response.suggestions)) {
        const newItems = response.suggestions.map(s => ({
          ...s,
          sourceTitle: title,
          sourceUrl: url
        }))
        setRelatedProducts(prev => {
          // Avoid duplicates
          const existing = new Set(prev.map(p => p.url))
          const filtered = newItems.filter(item => !existing.has(item.url))
          return [...prev, ...filtered]
        })
      }
    } catch (err) {
      console.error('Error getting related products:', err)
    } finally {
      setLoadingRelated(false)
    }
  }

  const clearRelatedProducts = () => {
    setRelatedProducts([])
  }

  const filteredSavedWorkspaces = useMemo(() => {
    if (!Array.isArray(savedWorkspaces)) return []
    if (savedWsFilter === 'All') return savedWorkspaces
    return savedWorkspaces.filter(ws => ws.id === savedWsFilter)
  }, [savedWorkspaces, savedWsFilter])

  // Flatten saved workspaces' URLs into items suitable for ItemGrid
  const savedUrlsFlat = useMemo(() => {
    const src = filteredSavedWorkspaces
    const list = []
    src.forEach(ws => {
      (ws.urls || []).forEach(u => {
        if (u?.url) {
          list.push({ type: 'History', url: u.url, visitCount: 2 })
        }
      })
    })
    return list
  }, [filteredSavedWorkspaces])

  const getCurrentTabInfo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      setCurrentTab(tab)
      return tab
    } catch (err) {
      console.error('Error getting current tab:', err)
      return null
    }
  }

  const createWorkspace = async (workspaceName, description) => {
    try {
      const tab = await getCurrentTabInfo()
      if (!tab) return

      const workspace = {
        id: Date.now().toString(),
        name: workspaceName,
        description: description,
        createdAt: Date.now(),
        urls: [{
          url: tab.url,
          title: tab.title,
          addedAt: Date.now(),
          favicon: getFaviconUrl(tab.url)
        }],
        context: {
          domain: getDomainFromUrl(tab.url),
          createdFrom: 'current_tab'
        }
      }

      // Save to IndexedDB
      await saveWorkspace(workspace)

      // Update local state optimistically
      setSavedWorkspaces((prev) => {
        const exists = prev.some(w => w.id === workspace.id)
        return exists ? prev : [...prev, workspace]
      })

      // Close modal and refresh data
      setShowCreateWorkspace(false)
      // populate() reloads history/bookmarks, not needed for saved workspaces
    } catch (err) {
      console.error('Error creating workspace:', err)
    }
  }

  return (
    <div className="popup-wrap">
      <header className="header">
        <div className="logo-placeholder">
          <div className="logo-icon">🚀</div>
          <span className="logo-text">CoolDesk AI</span>
        </div>
        <div className="header-actions">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const q = (search || '').trim();
                if (!q) return;
                try {
                  if (chrome?.search?.query) {
                    chrome.search.query({ text: q, disposition: 'NEW_TAB' });
                  } else if (chrome?.tabs?.create) {
                    chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
                  }
                } catch (err) {
                  console.error('Search failed:', err);
                }
              }
            }}
            placeholder="Search Google..."
            className="search"
          />
          <button className="icon-btn" onClick={() => populate()} title="Refresh Data">
            <i className="fas fa-sync-alt"></i>
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            <i className="fas fa-cog"></i>
          </button>
          <button className="icon-btn" onClick={startEnrichment} disabled={progress.running} title={progress.running ? 'Syncing…' : 'Sync with AI'}>
            <i className={`fas ${progress.running ? 'fa-spinner fa-spin' : 'fa-robot'}`}></i>
          </button>
          <button className="icon-btn" onClick={() => setShowCreateWorkspace(true)} title="Create Workspace">
            <i className="fas fa-plus"></i>
          </button>
          <button className="icon-btn" onClick={openInTab} title="Open in Tab">
            <i className="fas fa-external-link-alt"></i>
          </button>
        </div>
      </header>

      {savedWorkspaces.length > 0 && (
        <section className="saved-workspaces">
          <h3>Saved Workspaces</h3>
          <div className="workspace-chips">
            <button
              key="All"
              className={`tag-chip workspace-chip ${savedWsFilter === 'All' ? 'active' : ''}`}
              onClick={() => setSavedWsFilter('All')}
              type="button"
            >
              All
              <span className="chip-badge">{savedWorkspaces.length}</span>
            </button>
            {savedWorkspaces.map((ws) => (
              <button
                key={ws.id}
                className={`tag-chip workspace-chip ${savedWsFilter === ws.id ? 'active' : ''}`}
                onClick={() => setSavedWsFilter(ws.id)}
                title={ws.name}
                type="button"
              >
                {ws.name}
                <span className="chip-badge">{ws.urls?.length || 0}</span>
              </button>
            ))}
          </div>
          <ItemGrid items={savedUrlsFlat} onAddRelated={handleAddRelated} />
        </section>
      )}

      <WorkspaceFilters items={data} active={workspace} onChange={setWorkspace} />

      {progress.running && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }} />
          <div className="progress-text">{progress.processed}/{progress.total} (API {progress.apiHits}) — {progress.currentItem}</div>
        </div>
      )}

      {progress.error && <div className="error">{progress.error}</div>}

      {loading ? (
        <div className="empty">Loading...</div>
      ) : workspace === 'All' ? (
        <>
          <StatsView items={data} search={search} workspace={workspace} onAddRelated={handleAddRelated} />
          <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
        </>
      ) : (
        <>
          <ItemGrid items={filtered} onAddRelated={handleAddRelated} />
          <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
        </>
      )}

      {loadingRelated && (
        <div className="loading-related">
          <div className="loading-spinner"></div>
          <span>Finding related products...</span>
        </div>
      )}

      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />

      <CreateWorkspaceModal
        show={showCreateWorkspace}
        onClose={() => setShowCreateWorkspace(false)}
        onCreate={createWorkspace}
        currentTab={currentTab}
      />
    </div>
  )
}
