import { faChartLine, faCheckCircle, faEye, faFilter, faLightbulb, faMapPin, faNewspaper, faRotateLeft, faSearch, faThumbtack, faTimesCircle } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'
import './DisplayData.css'

const DISPLAY_SETTINGS_KEY = 'cooldesk_display_settings'

// Define all toggleable components
const UI_COMPONENTS = [
    {
        id: 'pinnedWorkspaces',
        label: 'Pinned Workspaces',
        description: 'Quick access bar for pinned workspace shortcuts',
        icon: faThumbtack,
        category: 'Navigation'
    },
    {
        id: 'workspaceFilters',
        label: 'Workspace Filters',
        description: 'Filter tabs to switch between workspaces (controls grid view below)',
        icon: faFilter,
        category: 'Navigation'
    },
    {
        id: 'currentTabsSection',
        label: 'Current Tabs Section',
        description: 'Shows currently open browser tabs',
        icon: faChartLine,
        category: 'Activity Panel'
    },
    {
        id: 'voiceNavigationSection',
        label: 'Voice Navigation Section',
        description: 'Voice commands for ChatGPT navigation',
        icon: faMapPin,
        category: 'Activity Panel'
    },
    {
        id: 'aiChatsSection',
        label: 'AI Chats Section',
        description: 'Scraped AI chat history from multiple platforms',
        icon: faNewspaper,
        category: 'Activity Panel'
    },
    {
        id: 'notesSection',
        label: 'Notes Section',
        description: 'Quick notes and reminders',
        icon: faMapPin,
        category: 'Activity Panel'
    },
    {
        id: 'dailyNotesSection',
        label: 'Daily Notes Section',
        description: 'Daily journal and notes',
        icon: faNewspaper,
        category: 'Activity Panel'
    },
    {
        id: 'pingsSection',
        label: 'Pins Section',
        description: 'Pinned items and bookmarks',
        icon: faMapPin,
        category: 'Other Panels'
    },
    {
        id: 'feedSection',
        label: 'Feed Section',
        description: 'Activity feed and updates',
        icon: faNewspaper,
        category: 'Other Panels'
    },
]

export default function DisplayData() {
    const [displaySettings, setDisplaySettings] = useState(() => {
        try {
            const saved = localStorage.getItem(DISPLAY_SETTINGS_KEY)
            if (saved) {
                return JSON.parse(saved)
            }
        } catch (err) {
            console.error('[DisplayData] Failed to load settings:', err)
        }
        // Default: all components visible
        return UI_COMPONENTS.reduce((acc, comp) => {
            acc[comp.id] = true
            return acc
        }, {})
    })

    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState('All')

    // Save to localStorage whenever settings change
    useEffect(() => {
        try {
            localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(displaySettings))
            // Dispatch event for App.jsx to listen to
            window.dispatchEvent(new CustomEvent('displaySettingsChanged', { detail: displaySettings }))
        } catch (err) {
            console.error('[DisplayData] Failed to save settings:', err)
        }
    }, [displaySettings])

    const toggleComponent = (componentId) => {
        setDisplaySettings(prev => ({
            ...prev,
            [componentId]: !prev[componentId]
        }))
    }

    const toggleAll = (visible) => {
        const newSettings = {}
        UI_COMPONENTS.forEach(comp => {
            newSettings[comp.id] = visible
        })
        setDisplaySettings(newSettings)
    }

    const resetToDefaults = () => {
        const defaults = UI_COMPONENTS.reduce((acc, comp) => {
            acc[comp.id] = true
            return acc
        }, {})
        setDisplaySettings(defaults)
    }

    // Get unique categories
    const categories = ['All', ...new Set(UI_COMPONENTS.map(c => c.category))]

    // Filter components
    const filteredComponents = UI_COMPONENTS.filter(comp => {
        const matchesSearch = comp.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            comp.description.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesCategory = selectedCategory === 'All' || comp.category === selectedCategory
        return matchesSearch && matchesCategory
    })

    // Group by category
    const groupedComponents = filteredComponents.reduce((acc, comp) => {
        if (!acc[comp.category]) {
            acc[comp.category] = []
        }
        acc[comp.category].push(comp)
        return acc
    }, {})

    const visibleCount = Object.values(displaySettings).filter(Boolean).length
    const totalCount = UI_COMPONENTS.length

    return (
        <div className="display-data-container">
            <div className="display-header">
                <h2>Display Settings</h2>
                <p className="display-subtitle">
                    Show or hide UI components to customize your workspace
                </p>
            </div>

            <div className="display-stats">
                <div className="stat-card">
                    <FontAwesomeIcon icon={faEye} className="stat-icon" />
                    <div className="stat-content">
                        <div className="stat-value">{visibleCount}/{totalCount}</div>
                        <div className="stat-label">Components Visible</div>
                    </div>
                </div>
            </div>

            <div className="display-controls">
                <div className="search-box">
                    <FontAwesomeIcon icon={faSearch} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search components..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input"
                    />
                    {searchQuery && (
                        <button
                            className="clear-search"
                            onClick={() => setSearchQuery('')}
                            title="Clear search"
                        >
                            ✕
                        </button>
                    )}
                </div>

                <div className="category-filters">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(cat)}
                        >
                            {cat}
                        </button>
                    ))}
                </div>

                <div className="bulk-actions">
                    <button className="action-btn" onClick={() => toggleAll(true)}>
                        <FontAwesomeIcon icon={faCheckCircle} /> Show All
                    </button>
                    <button className="action-btn" onClick={() => toggleAll(false)}>
                        <FontAwesomeIcon icon={faTimesCircle} /> Hide All
                    </button>
                    <button className="action-btn secondary" onClick={resetToDefaults}>
                        <FontAwesomeIcon icon={faRotateLeft} /> Reset
                    </button>
                </div>
            </div>

            <div className="components-list">
                {Object.keys(groupedComponents).length === 0 ? (
                    <div className="empty-state">
                        <FontAwesomeIcon icon={faSearch} className="empty-icon" />
                        <div className="empty-text">No components found</div>
                        <div className="empty-hint">Try adjusting your search or filters</div>
                    </div>
                ) : (
                    Object.entries(groupedComponents).map(([category, components]) => (
                        <div key={category} className="component-category">
                            <h3 className="category-title">{category}</h3>
                            <div className="component-items">
                                {components.map(comp => (
                                    <div key={comp.id} className="component-item">
                                        <div className="component-info">
                                            <FontAwesomeIcon icon={comp.icon} className="component-icon" />
                                            <div className="component-details">
                                                <div className="component-label">{comp.label}</div>
                                                <div className="component-description">{comp.description}</div>
                                            </div>
                                        </div>
                                        <label className="toggle-switch">
                                            <input
                                                type="checkbox"
                                                checked={displaySettings[comp.id] !== false}
                                                onChange={() => toggleComponent(comp.id)}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="display-info">
                <FontAwesomeIcon icon={faLightbulb} className="info-icon" />
                <div className="info-content">
                    <strong>Note:</strong> Changes take effect immediately. Hidden components can be re-enabled anytime from this settings page.
                </div>
            </div>
        </div>
    )
}

// Export helper function to get display settings
export function getDisplaySettings() {
    try {
        const saved = localStorage.getItem(DISPLAY_SETTINGS_KEY)
        if (saved) {
            return JSON.parse(saved)
        }
    } catch (err) {
        console.error('[DisplayData] Failed to load settings:', err)
    }
    // Default: all visible
    return UI_COMPONENTS.reduce((acc, comp) => {
        acc[comp.id] = true
        return acc
    }, {})
}
