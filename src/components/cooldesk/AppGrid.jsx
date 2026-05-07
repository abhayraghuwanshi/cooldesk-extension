/**
 * AppGrid - Unified Local + Web Apps Display
 * Shows all apps grouped by category with WorkspaceCard-style design
 */
/* global chrome */

import {
    faBox,
    faCode,
    faComments,
    faDesktop,
    faFilm,
    faGamepad,
    faGlobe,
    faGraduationCap,
    faHeartPulse,
    faMusic,
    faNewspaper,
    faPaintBrush,
    faPlane,
    faRocket,
    faShoppingBag,
    faTools,
    faWallet
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { categorizeApp, STANDARD_CATEGORIES } from '../../services/appCategorizationService.js';
import { runningAppsService } from '../../services/runningAppsService.js';

// Category to FontAwesome icon mapping
const CATEGORY_FA_ICONS = {
    'Developer Tools': faCode,
    'Browsers': faGlobe,
    'Communication': faComments,
    'Music': faMusic,
    'Video': faFilm,
    'Graphics & Design': faPaintBrush,
    'Games': faGamepad,
    'Productivity': faDesktop,
    'Finance': faWallet,
    'Education': faGraduationCap,
    'News': faNewspaper,
    'Health & Fitness': faHeartPulse,
    'Travel': faPlane,
    'Shopping': faShoppingBag,
    'Utilities': faTools,
    'Other': faBox
};

// Category color classes (matching WorkspaceCard)
const CATEGORY_COLORS = {
    'Developer Tools': 'purple',
    'Browsers': 'blue',
    'Communication': 'green',
    'Music': 'orange',
    'Video': 'orange',
    'Graphics & Design': 'purple',
    'Games': 'green',
    'Productivity': 'blue',
    'Finance': 'green',
    'Education': 'blue',
    'News': 'orange',
    'Health & Fitness': 'green',
    'Travel': 'blue',
    'Shopping': 'orange',
    'Utilities': 'brown',
    'Other': 'brown'
};

function CategorySection({ category, apps, onLaunch }) {
    const icon = CATEGORY_FA_ICONS[category] || faBox;
    const colorClass = CATEGORY_COLORS[category] || 'brown';

    return (
        <div className="cooldesk-workspace-card compact" style={{ position: 'relative' }}>
            <div className="compact-card-inner" style={{ alignItems: 'center' }}>
                {/* Category icon — mirrors WorkspaceCard compact stack */}
                <div className="compact-workspace-stack">
                    <div className={`compact-workspace-icon workspace-icon ${colorClass}`}>
                        <FontAwesomeIcon icon={icon} />
                    </div>
                    <div className="compact-workspace-label">{category}</div>
                </div>

                {/* Scrollable icon row — identical to WorkspaceCard compact icons */}
                <div className="compact-icons-scroll" onClick={(e) => e.stopPropagation()}>
                    <div className="compact-icons-container">
                        {apps.map((app, idx) => (
                            <div
                                key={app.id || idx}
                                className="compact-url-icon compact-app-icon"
                                onClick={(e) => { e.stopPropagation(); onLaunch?.(app); }}
                                title={app.name}
                                style={{
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    background: 'rgba(255,255,255,0.05)',
                                    position: 'relative',
                                }}
                            >
                                {app.isRunning && (
                                    <span style={{
                                        position: 'absolute', bottom: 2, right: 2,
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: '#22c55e',
                                        boxShadow: '0 0 4px rgba(34,197,94,0.7)',
                                        pointerEvents: 'none',
                                    }} />
                                )}
                                {app.icon ? (
                                    <img
                                        src={app.icon}
                                        alt=""
                                        style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 4 }}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'flex';
                                        }}
                                    />
                                ) : null}
                                <div
                                    className="letter-avatar"
                                    style={{
                                        display: app.icon ? 'none' : 'flex',
                                        background: '#8B5CF6',
                                        width: 24, height: 24, borderRadius: 4,
                                        alignItems: 'center', justifyContent: 'center',
                                        fontSize: 12, fontWeight: 600, color: '#fff',
                                    }}
                                >
                                    {app.name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function AppGrid({ onAppLaunch }) {
    const [apps, setApps] = useState([]);
    const [groupedApps, setGroupedApps] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'local' | 'web'

    // Initialize and load apps using runningAppsService (same as GlobalSpotlight)
    useEffect(() => {
        let unsubscribe = null;

        async function loadApps() {
            setLoading(true);
            console.log('[AppGrid] Loading apps via runningAppsService...');

            try {
                // Subscribe to app updates
                unsubscribe = runningAppsService.subscribe(({ installedApps }) => {
                    console.log('[AppGrid] Received apps:', installedApps?.length);

                    if (installedApps && installedApps.length > 0) {
                        // Deduplicate by path (keep first occurrence)
                        const seen = new Set();
                        const uniqueApps = installedApps.filter(app => {
                            const key = app.path || app.name;
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        });

                        // Transform to our format and normalize categories
                        const transformedApps = uniqueApps.map((app, index) => ({
                            id: `local:${index}:${app.path || app.name}`,
                            type: 'local',
                            name: app.name,
                            path: app.path,
                            icon: app.icon || null,
                            category: categorizeApp(app),
                            rawCategory: app.category, // Keep original for debugging
                            isRunning: app.isRunning || false
                        }));

                        setApps(transformedApps);

                        // Group by category
                        const grouped = {};
                        for (const cat of STANDARD_CATEGORIES) {
                            grouped[cat] = [];
                        }
                        for (const app of transformedApps) {
                            const cat = app.category || 'Other';
                            if (!grouped[cat]) grouped[cat] = [];
                            grouped[cat].push(app);
                        }

                        setGroupedApps(grouped);
                        console.log('[AppGrid] Grouped into categories:', Object.keys(grouped).filter(k => grouped[k].length > 0).length);
                    }

                    setLoading(false);
                });

                // Also fetch immediately
                const { installedApps } = await runningAppsService.getApps();
                console.log('[AppGrid] Initial fetch:', installedApps?.length, 'apps');

            } catch (error) {
                console.error('[AppGrid] Failed to load apps:', error);
                setLoading(false);
            }
        }

        loadApps();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    // Filter apps by type
    const filteredGroups = useMemo(() => {
        if (activeFilter === 'all') return groupedApps;

        const filtered = {};
        for (const [category, categoryApps] of Object.entries(groupedApps)) {
            const matching = categoryApps.filter(a => a.type === activeFilter);
            if (matching.length > 0) {
                filtered[category] = matching;
            }
        }
        return filtered;
    }, [groupedApps, activeFilter]);

    // Handle app launch
    const handleLaunch = useCallback(async (app) => {
        console.log('[AppGrid] Launching app:', app.name, app.path);

        // Launch local app via electronAPI (same as GlobalSpotlight)
        if (app.type === 'local' && app.path) {
            if (window.electronAPI?.launchApp) {
                try {
                    await window.electronAPI.launchApp(app.path);
                    console.log('[AppGrid] App launched successfully');
                } catch (e) {
                    console.error('[AppGrid] Failed to launch app:', e);
                }
            } else {
                console.warn('[AppGrid] electronAPI.launchApp not available');
            }
        } else if (app.type === 'web' && app.url) {
            if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.create({ url: app.url });
            } else {
                window.open(app.url, '_blank');
            }
        }

        onAppLaunch?.(app);
    }, [onAppLaunch]);


    if (loading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px',
                color: 'var(--text-secondary, #94a3b8)'
            }}>
                <FontAwesomeIcon icon={faRocket} spin style={{ marginRight: '8px' }} />
                Loading apps...
            </div>
        );
    }

    const totalApps = apps.length;
    const localApps = apps.filter(a => a.type === 'local').length;
    const webApps = apps.filter(a => a.type === 'web').length;

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
        }}>
            {/* Header with filters */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <h3 style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: 'var(--text-primary, #e2e8f0)',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <FontAwesomeIcon icon={faRocket} style={{ color: '#8b5cf6' }} />
                    Apps
                    <span style={{
                        fontSize: '12px',
                        color: 'var(--text-tertiary, #64748b)',
                        fontWeight: 400
                    }}>
                        ({totalApps})
                    </span>
                </h3>

                {/* Type Filter */}
                <div style={{
                    display: 'flex',
                    gap: '4px',
                    background: 'var(--bg-secondary, rgba(30, 41, 59, 0.5))',
                    padding: '3px',
                    borderRadius: '8px'
                }}>
                    {[
                        { key: 'all', label: 'All', count: totalApps },
                        { key: 'local', label: 'Local', icon: faDesktop, count: localApps },
                        { key: 'web', label: 'Web', icon: faGlobe, count: webApps }
                    ].map(({ key, label, icon, count }) => (
                        <button
                            key={key}
                            onClick={() => setActiveFilter(key)}
                            style={{
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 500,
                                color: activeFilter === key ? '#fff' : 'var(--text-secondary, #94a3b8)',
                                background: activeFilter === key ? '#8b5cf6' : 'transparent',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: '10px' }} />}
                            {label}
                            <span style={{ opacity: 0.7 }}>({count})</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Categories */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}>
                {Object.entries(filteredGroups)
                    .filter(([, categoryApps]) => categoryApps.length > 0)
                    .sort((a, b) => b[1].length - a[1].length) // Sort by app count
                    .map(([category, categoryApps]) => (
                        <CategorySection
                            key={category}
                            category={category}
                            apps={categoryApps}
                            onLaunch={handleLaunch}
                        />
                    ))
                }
            </div>

            {/* Empty State */}
            {Object.keys(filteredGroups).length === 0 && (
                <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'var(--text-secondary, #94a3b8)'
                }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}>📦</div>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>No apps found</div>
                    <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>
                        {activeFilter !== 'all'
                            ? `No ${activeFilter} apps available`
                            : 'Apps will appear here once synced from workspaces'}
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '8px', opacity: 0.5 }}>
                        Total in DB: {apps.length} | Check console for [AppDB] logs
                    </div>
                </div>
            )}
        </div>
    );
}

export default AppGrid;
