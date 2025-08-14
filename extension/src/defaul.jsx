import { useEffect, useMemo, useState } from 'react';
import './App.css';

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

function useDashboardData() {
    const [data, setData] = useState([])
    const [loading, setLoading] = useState(true)
    const [populating, setPopulating] = useState(false)

    const normalize = (dashboardData) => {
        const bookmarks = (dashboardData?.bookmarks || []).map((b) => ({ ...b, type: 'Bookmark' }))
        const history = (dashboardData?.history || []).map((h) => ({ ...h, type: 'History' }))
        const combined = [...bookmarks, ...history]
        const map = new Map()
        combined.forEach((it) => {
            if (!map.has(it.url)) map.set(it.url, it)
        })
        return Array.from(map.values()).sort((a, b) => (b.lastVisitTime || b.dateAdded || 0) - (a.lastVisitTime || a.dateAdded || 0))
    }

    const load = async () => {
        try {
            const { dashboardData } = await chrome.storage.local.get(['dashboardData'])
            const arr = normalize(dashboardData)
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

    const getSuggestions = async (url) => {
        try {
            setAiState({ loading: true, suggestions: [], error: null })
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getSuggestionFor', url }, resolve)
            })

            if (!response?.ok) {
                setAiState({ loading: false, suggestions: [], error: response?.error || 'AI error' })
                return
            }

            setAiState({
                loading: false,
                suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
                error: null
            })
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
            const ws = i.workspaceGroup || (i.category && typeof i.category === 'object' ? i.category.name : null);
            if (ws) set.add(ws);
        });
        console.log('Detected workspaces:', Array.from(set));
        return ['All', ...Array.from(set)];
    }, [items])

    return (
        <div id="workspace-filters" className="ws-filters">
            {workspaces.map((ws) => (
                <button
                    key={ws}
                    className={`filter-btn ${ws === active ? 'active' : ''}`}
                    onClick={() => onChange(ws)}
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
                <span className="muted">{domain}</span>
                {showCount && <span className="badge teal">{item.count}</span>}
                {!showCount && (
                    <span className="badge">
                        {new Date(item.lastVisitTime || item.dateAdded).toLocaleDateString()}
                    </span>
                )}
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
        const itemWorkspace = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null);
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
        return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10)
    }, [filtered])

    const recent = useMemo(() => {
        return filtered
            .filter((it) => it.lastVisitTime || it.dateAdded)
            .slice(0, 10)
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
function WorkspaceItem({ base, values, onAddRelated }) {
    const [showDetails, setShowDetails] = useState(false)
    const favicon = getFaviconUrl(base)

    const handleItemClick = () => {
        window.open(base, '_blank')
    }

    const toggleDetails = (e) => {
        e.stopPropagation()
        setShowDetails(!showDetails)
    }

    const handleGetRelated = (e) => {
        e.stopPropagation()
        onAddRelated(base, getDomainFromUrl(base))
    }

    return (
        <li className="workspace-item">
            <div className="item-header" onClick={handleItemClick}>
                <div className="item-info">
                    {favicon && <img className="favicon" src={favicon} alt="" />}
                    <div className="domain-info">
                        <span className="domain-name">{getDomainFromUrl(base)}</span>
                        <span className="url-key">{base}</span>
                    </div>
                </div>
                <div className="item-actions">
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

            {/* History Paths */}
            {showDetails && values.length > 0 && (
                <div className="item-details">
                    <div className="details-title">History Paths:</div>
                    <div className="paths-list">
                        {values.map((path) => (
                            <button
                                key={path}
                                className="path-chip"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    window.open(`${base}${path === '/' ? '' : path}`, '_blank')
                                }}
                                title={`${base}${path === '/' ? '' : path}`}
                            >
                                {path}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </li>
    )
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
    const groups = useMemo(() => {
        const map = new Map()
        items
            .filter((it) => it.type === 'History' && (it.visitCount || 0) > 4)
            .forEach((it) => {
                const parts = getUrlParts(it.url)
                if (parts.queryEntries.length > 0) return
                const { key, remainder } = parts
                const val = remainder && remainder !== '' ? remainder : '/'
                if (!map.has(key)) map.set(key, new Set())
                map.get(key).add(val)
            })
        return Array.from(map.entries()).map(([key, set]) => ({
            key,
            values: Array.from(set).sort(),
        }))
    }, [items])

    const { loading, suggestions, error, getSuggestions, clearSuggestions } = useAISuggestions()

    const handleGetSuggestions = () => {
        // Use the most frequent domain or a representative URL
        if (groups.length > 0) {
            // For simplicity, we'll use the first workspace group's base URL.
            // A more sophisticated approach could find the most common domain.
            getSuggestions(groups[0].key)
        }
    }

    return (
        <div>
            <ul className="workspace-grid">
                {groups.map(({ key, values }) => (
                    <WorkspaceItem key={key} base={key} values={values} onAddRelated={onAddRelated} />
                ))}
            </ul>
            <div className="suggestion-controls">
                <button onClick={handleGetSuggestions} disabled={loading}>
                    {loading ? 'Getting Suggestions...' : 'Get Workspace Suggestions'}
                </button>
            </div>
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

// Main App Component
export default function App() {
    const { data, loading, populate } = useDashboardData()
    const [workspace, setWorkspace] = useState('All')
    const [search, setSearch] = useState('')
    const [showSettings, setShowSettings] = useState(false)
    const [settings, setSettings] = useState({ geminiApiKey: '', serverUrl: '', visitCountThreshold: '', historyMaxResults: '' })
    const [progress, setProgress] = useState({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
    const [relatedProducts, setRelatedProducts] = useState([])
    const [loadingRelated, setLoadingRelated] = useState(false)

    useEffect(() => {
        // Load settings initially
        (async () => {
            const { geminiApiKey, serverUrl, visitCountThreshold, historyMaxResults } = await chrome.storage.local.get([
                'geminiApiKey', 'serverUrl', 'visitCountThreshold', 'historyMaxResults'
            ])
            setSettings({
                geminiApiKey: geminiApiKey || '',
                serverUrl: serverUrl || '',
                visitCountThreshold: Number.isFinite(visitCountThreshold) ? String(visitCountThreshold) : '',
                historyMaxResults: Number.isFinite(historyMaxResults) ? String(historyMaxResults) : ''
            })
        })()

        // Add logging to check workspaceGroup in data
        if (data.length > 0) {
            console.log('Data items:', data.slice(0, 5).map(item => ({ url: item.url, workspaceGroup: item.workspaceGroup })));
        }

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
        return () => chrome.runtime.onMessage.removeListener(onMsg)
    }, [])

    const filtered = data.filter((it) => {
        const itemWorkspace = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null);
        const inWs = workspace === 'All' || itemWorkspace === workspace;
        const inSearch = !search || it.title?.toLowerCase().includes(search) || it.summary?.toLowerCase().includes(search) || it.url?.toLowerCase().includes(search);
        return inWs && inSearch;
    });

    const saveSettings = async (newSettings) => {
        const payload = {}
        if (newSettings.geminiApiKey?.trim()) payload.geminiApiKey = newSettings.geminiApiKey.trim()
        if (newSettings.serverUrl?.trim()) payload.serverUrl = newSettings.serverUrl.trim().replace(/\/$/, '')
        if (newSettings.visitCountThreshold !== '') payload.visitCountThreshold = Number(newSettings.visitCountThreshold) || 0
        if (newSettings.historyMaxResults !== '') payload.historyMaxResults = Number(newSettings.historyMaxResults) || 1000
        await chrome.storage.local.set(payload)
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
                chrome.runtime.sendMessage({ action: 'getSuggestionFor', url }, resolve)
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

    return (
        <div className="popup-wrap">
            <header className="header">
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="search"
                />
                <button className="filter-btn" onClick={() => populate()}>Refresh Data</button>
                <button className="filter-btn" onClick={() => setShowSettings(true)}>Settings</button>
                <button className="filter-btn" onClick={startEnrichment} disabled={progress.running}>
                    {progress.running ? 'Syncing…' : 'Sync with AI'}
                </button>
                <button className="filter-btn" onClick={openInTab}>Open in Tab</button>
            </header>

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
        </div>
    )
}
