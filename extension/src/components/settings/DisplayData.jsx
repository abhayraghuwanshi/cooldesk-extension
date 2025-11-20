import { faChartLine, faCheckCircle, faFilter, faMapPin, faNewspaper, faThumbtack } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'
import { applyViewMode, getCurrentViewMode, getViewModesList } from '../../config/viewModes'
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

    // View mode state
    const [currentViewMode, setCurrentViewMode] = useState(() => getCurrentViewMode())
    const viewModes = getViewModesList()

    // Listen for view mode changes from other sources
    useEffect(() => {
        const handleViewModeChange = (event) => {
            setCurrentViewMode(event.detail.modeId)
            // Update display settings when view mode changes
            if (event.detail.mode?.settings) {
                setDisplaySettings(event.detail.mode.settings)
            }
        }

        window.addEventListener('viewModeChanged', handleViewModeChange)
        return () => window.removeEventListener('viewModeChanged', handleViewModeChange)
    }, [])


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

    const handleViewModeChange = (modeId) => {
        applyViewMode(modeId)
        setCurrentViewMode(modeId)
    }

    return (
        <div className="display-data-container">
            <div className="display-header">
                <h2>Display Settings</h2>
                <p className="display-subtitle">
                    Show or hide UI components to customize your workspace
                </p>
            </div>

            {/* View Mode Quick Select */}
            <div className="view-mode-section">
                <h3 className="section-title">View Modes</h3>
                <p className="section-subtitle">Quick presets for different workflows</p>

                <div className="view-mode-grid">
                    {viewModes.map(mode => (
                        <button
                            key={mode.id}
                            className={`view-mode-card ${currentViewMode === mode.id ? 'active' : ''}`}
                            onClick={() => handleViewModeChange(mode.id)}
                        >
                            <span className="mode-icon-large">{mode.icon}</span>
                            <div className="mode-info">
                                <div className="mode-name">{mode.label}</div>
                                <div className="mode-desc">{mode.description}</div>
                            </div>
                            {currentViewMode === mode.id && (
                                <div className="mode-active-badge">
                                    <FontAwesomeIcon icon={faCheckCircle} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Divider */}
            <div className="settings-divider"></div>

            {/* Component Toggles Header */}
            <div className="components-header">
                <h3 className="section-title">Individual Components</h3>
                <p className="section-subtitle">Fine-tune component visibility</p>
            </div>

            {/* Simple component list */}
            <div className="components-list">
                {UI_COMPONENTS.map(comp => (
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
