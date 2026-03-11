import React, { useEffect, useState } from 'react';
import { MobileHome } from './components/sidebar/MobileHome';
import { SidebarShell } from './components/sidebar/SidebarShell';

// Import Dedicated Sidebar Views
import { SettingsModal } from './components/popups/SettingsModal';
import { SidebarChat } from './components/sidebar/views/SidebarChat';
import { SidebarDashboard } from './components/sidebar/views/SidebarDashboard';
import { SidebarNotes } from './components/sidebar/views/SidebarNotes';
import { SidebarTabs } from './components/sidebar/views/SidebarTabs';

import { listWorkspaces, saveWorkspace } from './db/index.js';
import './styles/components.css';
import './styles/cooldesk.css';
import './styles/spatial.css';
import './styles/theme.css';
import './styles/wallpaper-enhancements.css';

// Simple error boundary to prevent crash
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, info) {
        console.error('Sidebar ErrorBoundary caught error:', error, info);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, color: '#ff6b6b' }}>
                    <h3>Something went wrong.</h3>
                    <pre style={{ fontSize: 'var(--font-xs)', overflow: 'auto' }}>
                        {this.state.error && this.state.error.toString()}
                    </pre>
                    <button onClick={() => window.location.reload()} style={{ marginTop: 10 }}>
                        Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function SidebarApp() {
    const [activeView, setActiveView] = useState('home');
    const [savedWorkspaces, setSavedWorkspaces] = useState([]);
    const [currentWorkspace, setCurrentWorkspace] = useState(null);
    const [showSettings, setShowSettings] = useState(false);

    // Theme & Wallpaper State
    const [themeClass, setThemeClass] = useState('bg-ai-midnight-nebula');
    const [wallpaperEnabled, setWallpaperEnabled] = useState(false);
    const [wallpaperUrl, setWallpaperUrl] = useState('');

    const refreshWorkspaces = async () => {
        const res = await listWorkspaces();
        if (res?.success && Array.isArray(res.data)) {
            setSavedWorkspaces(res.data);
            if (res.data.length > 0 && !currentWorkspace) {
                setCurrentWorkspace(res.data[0]);
            }
        }
    };

    // Load Settings & Workspaces
    useEffect(() => {
        refreshWorkspaces();

        // Load Theme & Wallpaper from localStorage directly (fastest) and DB (async)
        // ... (Theme loading remains same)
        const loadSettings = async () => {
            try {
                // Wallpaper (localStorage)
                const wpEnabled = localStorage.getItem('wallpaperEnabled') !== 'false'; // Default true
                const wpUrl = localStorage.getItem('wallpaperUrl') || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&q=80';
                setWallpaperEnabled(wpEnabled);
                setWallpaperUrl(wpUrl);
            } catch (e) {
                console.error('Error loading settings:', e);
            }
        };
        loadSettings();
    }, []);

    const handleCreateWorkspace = async () => {
        const name = prompt('Enter a name for the new space:');
        if (name && name.trim()) {
            try {
                await saveWorkspace({
                    name: name.trim(),
                    icon: 'folder', // Default icon
                    urls: []
                });
                // Refresh list
                await refreshWorkspaces();
            } catch (error) {
                console.error('Failed to create workspace:', error);
                alert('Failed to create workspace');
            }
        }
    };

    // Handle App Launch from Home
    const handleOpenApp = (appId) => {
        if (appId === 'settings') {
            setShowSettings(true);
        } else if (appId === 'create') {
            handleCreateWorkspace();
        } else {
            setActiveView(appId);
        }
    };

    // Render the Active Full-Screen View
    const renderView = () => {
        switch (activeView) {
            case 'home':
                return <MobileHome onOpenApp={handleOpenApp} />;

            case 'chat':
                return <SidebarChat />;

            case 'notes':
                return <SidebarNotes />;

            case 'tabs':
                return <SidebarTabs />;

            case 'dashboard':
                return <SidebarDashboard onWorkspaceClick={setCurrentWorkspace} />;

            default:
                return <MobileHome onOpenApp={handleOpenApp} />;
        }
    };

    return (
        <div
            className={`${themeClass} ${wallpaperEnabled ? 'wallpaper-enabled' : ''}`}
            style={{
                overflow: 'hidden', height: '100vh', width: '100vw',
                backgroundImage: wallpaperEnabled ? `url(${wallpaperUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat'
            }}
        >
            <ErrorBoundary>
                <SidebarShell activeView={activeView} onViewChange={setActiveView}>
                    <div className="sidebar-view-content" style={{ height: '100%' }}>
                        {renderView()}
                    </div>
                </SidebarShell>

                {showSettings && (
                    <SettingsModal
                        show={showSettings}
                        onClose={() => setShowSettings(false)}
                        settings={{}}
                        onSave={() => { }}
                        fontSize="medium"
                        onFontSizeChange={() => { }}
                    />
                )}
            </ErrorBoundary>
        </div>
    );
}
