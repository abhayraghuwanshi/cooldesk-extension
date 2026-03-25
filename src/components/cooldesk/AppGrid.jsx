/**
 * AppGrid - Unified Local + Web Apps Display
 * Shows all apps grouped by category with usage tracking
 */
/* global chrome */

import { faDesktop, faGlobe, faRocket, faClock, faFire } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { runningAppsService } from '../../services/runningAppsService.js';
import { categorizeApp, STANDARD_CATEGORIES } from '../../services/appCategorizationService.js';
import { defaultFontFamily } from '../../utils/fontUtils';

// Category icons mapping
const CATEGORY_ICONS = {
    'Developer Tools': '💻',
    'Browsers': '🌐',
    'Communication': '💬',
    'Music': '🎵',
    'Video': '🎬',
    'Graphics & Design': '🎨',
    'Games': '🎮',
    'Productivity': '📊',
    'Finance': '💰',
    'Education': '📚',
    'News': '📰',
    'Health & Fitness': '💪',
    'Travel': '✈️',
    'Shopping': '🛒',
    'Utilities': '🔧',
    'Other': '📦'
};

function AppIcon({ app, size = 32 }) {
    const [imgError, setImgError] = useState(false);

    if (app.icon && !imgError) {
        return (
            <img
                src={app.icon}
                alt={app.name}
                style={{
                    width: size,
                    height: size,
                    borderRadius: 6,
                    objectFit: 'cover'
                }}
                onError={() => setImgError(true)}
            />
        );
    }

    // Fallback icon
    return (
        <div style={{
            width: size,
            height: size,
            borderRadius: 6,
            background: app.type === 'local'
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : 'linear-gradient(135deg, #3b82f6, #0ea5e9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: size * 0.45
        }}>
            <FontAwesomeIcon icon={app.type === 'local' ? faDesktop : faGlobe} />
        </div>
    );
}

function AppCard({ app, onLaunch, compact = false }) {
    const handleClick = useCallback(() => {
        onLaunch?.(app);
    }, [app, onLaunch]);

    if (compact) {
        return (
            <button
                onClick={handleClick}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    background: 'var(--bg-secondary, rgba(30, 41, 59, 0.5))',
                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.1))',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover, rgba(51, 65, 85, 0.5))';
                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-secondary, rgba(30, 41, 59, 0.5))';
                    e.currentTarget.style.borderColor = 'var(--border-color, rgba(148, 163, 184, 0.1))';
                }}
            >
                <AppIcon app={app} size={24} />
                <span style={{
                    flex: 1,
                    fontSize: '12px',
                    color: 'var(--text-primary, #e2e8f0)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {app.name}
                </span>
                <FontAwesomeIcon
                    icon={app.type === 'local' ? faDesktop : faGlobe}
                    style={{
                        fontSize: '10px',
                        color: 'var(--text-tertiary, #64748b)',
                        opacity: 0.6
                    }}
                />
            </button>
        );
    }

    return (
        <button
            onClick={handleClick}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                padding: '12px',
                background: 'var(--bg-secondary, rgba(30, 41, 59, 0.5))',
                border: '1px solid var(--border-color, rgba(148, 163, 184, 0.1))',
                borderRadius: '12px',
                cursor: 'pointer',
                minWidth: '80px',
                transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover, rgba(51, 65, 85, 0.5))';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary, rgba(30, 41, 59, 0.5))';
                e.currentTarget.style.borderColor = 'var(--border-color, rgba(148, 163, 184, 0.1))';
                e.currentTarget.style.transform = 'translateY(0)';
            }}
        >
            <AppIcon app={app} size={40} />
            <span style={{
                fontSize: '11px',
                color: 'var(--text-primary, #e2e8f0)',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%',
                maxWidth: '70px'
            }}>
                {app.name}
            </span>
            {app.usageCount > 0 && (
                <span style={{
                    fontSize: '9px',
                    color: 'var(--text-tertiary, #64748b)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px'
                }}>
                    <FontAwesomeIcon icon={faFire} style={{ fontSize: '8px' }} />
                    {app.usageCount}
                </span>
            )}
        </button>
    );
}

function CategorySection({ category, apps, onLaunch, expanded, onToggle, compact }) {
    const icon = CATEGORY_ICONS[category] || '📦';
    const localCount = apps.filter(a => a.type === 'local').length;
    const webCount = apps.filter(a => a.type === 'web').length;

    return (
        <div style={{
            background: 'var(--bg-card, rgba(15, 23, 42, 0.6))',
            border: '1px solid var(--border-color, rgba(148, 163, 184, 0.1))',
            borderRadius: '12px',
            overflow: 'hidden'
        }}>
            {/* Category Header */}
            <button
                onClick={onToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '12px 14px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderBottom: expanded ? '1px solid var(--border-color, rgba(148, 163, 184, 0.1))' : 'none'
                }}
            >
                <span style={{ fontSize: '18px' }}>{icon}</span>
                <span style={{
                    flex: 1,
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-primary, #e2e8f0)'
                }}>
                    {category}
                </span>
                <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11px',
                    color: 'var(--text-tertiary, #64748b)'
                }}>
                    {localCount > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <FontAwesomeIcon icon={faDesktop} style={{ fontSize: '10px' }} />
                            {localCount}
                        </span>
                    )}
                    {webCount > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '10px' }} />
                            {webCount}
                        </span>
                    )}
                </span>
                <span style={{
                    fontSize: '12px',
                    color: 'var(--text-tertiary, #64748b)',
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 0.2s ease'
                }}>
                    ▼
                </span>
            </button>

            {/* Apps Grid */}
            {expanded && (
                <div style={{
                    padding: '12px',
                    display: compact ? 'flex' : 'grid',
                    flexDirection: compact ? 'column' : undefined,
                    gridTemplateColumns: compact ? undefined : 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: compact ? '6px' : '10px'
                }}>
                    {apps.map(app => (
                        <AppCard
                            key={app.id}
                            app={app}
                            onLaunch={onLaunch}
                            compact={compact}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function AppGrid({
    viewMode = 'grid', // 'grid' | 'list'
    showRecent = true,
    onAppLaunch,
    maxRecentApps = 8
}) {
    const [apps, setApps] = useState([]);
    const [groupedApps, setGroupedApps] = useState({});
    const [loading, setLoading] = useState(true);
    const [expandedCategories, setExpandedCategories] = useState(new Set(['Developer Tools', 'Browsers', 'Productivity']));
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

    // Recent apps (sorted by lastUsed)
    const recentApps = useMemo(() => {
        return [...apps]
            .filter(a => a.lastUsed)
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, maxRecentApps);
    }, [apps, maxRecentApps]);

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

    const toggleCategory = useCallback((category) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    }, []);

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

    const compact = viewMode === 'list';
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
                    fontFamily: defaultFontFamily,
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

            {/* Recent Apps */}
            {showRecent && recentApps.length > 0 && (
                <div style={{
                    background: 'var(--bg-card, rgba(15, 23, 42, 0.6))',
                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.1))',
                    borderRadius: '12px',
                    padding: '12px'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: '10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--text-secondary, #94a3b8)'
                    }}>
                        <FontAwesomeIcon icon={faClock} style={{ fontSize: '11px' }} />
                        Recent
                    </div>
                    <div style={{
                        display: 'flex',
                        gap: '8px',
                        overflowX: 'auto',
                        paddingBottom: '4px'
                    }}>
                        {recentApps.map(app => (
                            <AppCard
                                key={app.id}
                                app={app}
                                onLaunch={handleLaunch}
                                compact={false}
                            />
                        ))}
                    </div>
                </div>
            )}

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
                            expanded={expandedCategories.has(category)}
                            onToggle={() => toggleCategory(category)}
                            compact={compact}
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
