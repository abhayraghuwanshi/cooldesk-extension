import { faChartPie, faComments, faCompass, faPlus, faStickyNote, faTh } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * MobileHome - "App Drawer" View
 */
import { useEffect, useState } from 'react';
import { listWorkspaces } from '../../db/index.js';

/**
 * MobileHome - "App Drawer" View
 */
export function MobileHome({ onOpenApp, onSearch }) {
    const [recentWorkspaces, setRecentWorkspaces] = useState([]);
    const [recentTabs, setRecentTabs] = useState([]);
    const [recentLinks, setRecentLinks] = useState([]);

    useEffect(() => {
        // Fetch Workspaces & Extract Links
        listWorkspaces().then(res => {
            const data = Array.isArray(res) ? res : (res?.data || []);
            setRecentWorkspaces(data.slice(0, 3));

            // Extract all URLs from workspaces, flatten, and take top 3 active ones (or just added recently)
            // Since we don't have global 'recent links' outside workspaces easily, we'll pick from workspaces.
            const allUrls = data.flatMap(ws => (ws.urls || []).map(u => ({
                ...u,
                workspaceName: ws.name,
                workspaceId: ws.id
            })));
            // Sort by addedAt desc if available
            allUrls.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
            setRecentLinks(allUrls.slice(0, 3));
        });

        // Fetch Recent Tabs (Active in Chrome)
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                // Sort by active status or index? Assuming "recent" means currently open ones.
                // We'll just take the first 2 that are NOT the current extension tab (if possible to detect)
                // or just take the first 2.
                // Better: query({ active: false }) to avoid showing the extension itself if it's active?
                // Actually, just show top 2 tabs.
                setRecentTabs(tabs.slice(0, 2));
            });
        }
    }, []);

    const APPS = [
        { id: 'chat', label: 'AI Chat', icon: faComments, color: '#3b82f6', gradient: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)' },
        { id: 'notes', label: 'Notes', icon: faStickyNote, color: '#eab308', gradient: 'linear-gradient(135deg, #facc15 0%, #eab308 100%)' },
        { id: 'dashboard', label: 'Overview', icon: faChartPie, color: '#a855f7', gradient: 'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)' },
        { id: 'tabs', label: 'Tabs', icon: faTh, color: '#10b981', gradient: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)' },
        { id: 'create', label: 'New space', icon: faPlus, color: '#ef4444', gradient: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)' },
    ];

    return (
        <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Search Bar - "Spotlight" style */}
            <div style={{
                background: 'var(--glass-bg)',
                backdropFilter: 'var(--glass-backdrop)',
                borderRadius: '20px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                border: '1px solid var(--border-primary)',
                boxShadow: 'var(--shadow-sm)'
            }}>
                <FontAwesomeIcon icon={faCompass} style={{ color: 'var(--text-secondary)' }} />
                <input
                    type="text"
                    placeholder="Search apps and content..."
                    style={{
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--text)',
                        fontSize: 'var(--font-base)',
                        width: '100%',
                        fontFamily: 'inherit'
                    }}
                    onChange={(e) => onSearch && onSearch(e.target.value)}
                />
            </div>

            {/* Recent Tabs (Jump Back In) */}
            {recentTabs.length > 0 && (
                <div style={{
                    background: 'var(--glass-bg)',
                    borderRadius: '24px',
                    padding: '16px',
                    border: '1px solid var(--border-primary)',
                    backdropFilter: 'var(--glass-backdrop)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <span style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: 'var(--text)' }}>Jump Back In</span>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>Tabs</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {recentTabs.map(tab => (
                            <div
                                key={tab.id}
                                onClick={() => {
                                    if (typeof chrome !== 'undefined' && chrome.tabs) {
                                        chrome.tabs.update(tab.id, { active: true });
                                    }
                                }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    padding: '10px', borderRadius: '12px',
                                    background: 'rgba(255,255,255,0.05)',
                                    cursor: 'pointer',
                                    border: '1px solid transparent'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                            >
                                {tab.favIconUrl ? (
                                    <img src={tab.favIconUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '6px' }} />
                                ) : (
                                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'var(--surface-3)' }} />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 500, truncate: true, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {tab.title}
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {tab.url}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* App Grid */}
            <div>
                <h3 style={{
                    fontSize: 'var(--font-xs)',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.05em',
                    marginBottom: '16px',
                    marginLeft: '4px'
                }}>Applications</h3>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '20px 12px',
                }}>
                    {APPS.map(app => (
                        <button
                            key={app.id}
                            onClick={() => onOpenApp(app.id)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            {/* App Icon Squircle */}
                            <div style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '18px',
                                background: app.gradient,
                                boxShadow: `0 8px 20px -6px ${app.color}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '24px',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.2)'
                            }}>
                                <FontAwesomeIcon icon={app.icon} />
                            </div>

                            {/* App Label */}
                            <span style={{
                                fontSize: '11px',
                                color: 'var(--text)',
                                fontWeight: 500,
                                textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                            }}>
                                {app.label}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Quick Links Widget */}
            <div style={{
                background: 'var(--glass-bg)',
                borderRadius: '24px',
                padding: '16px',
                border: '1px solid var(--border-primary)',
                backdropFilter: 'var(--glass-backdrop)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: 'var(--text)' }}>Quick Links</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {recentLinks.length > 0 ? recentLinks.map((link, idx) => (
                        <div
                            key={idx}
                            onClick={() => window.open(link.url, '_blank')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '10px', borderRadius: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                cursor: 'pointer',
                                border: '1px solid transparent'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                        >
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '8px',
                                background: 'var(--surface-3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <img
                                    src={link.favicon || `https://www.google.com/s2/favicons?sz=64&domain=${link.url}`}
                                    alt=""
                                    style={{ width: '18px', height: '18px' }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 500, truncate: true, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {link.title || link.url}
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                                    {link.workspaceName}
                                </div>
                            </div>
                        </div>
                    )) : (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textAlign: 'center', padding: '10px 0' }}>
                            Save links to spaces to see them here
                        </div>
                    )}
                </div>
            </div>

            {/* Recent Activity Widget */}
            <div style={{
                marginTop: '12px',
                background: 'var(--glass-bg)',
                borderRadius: '24px',
                padding: '16px',
                border: '1px solid var(--border-primary)',
                backdropFilter: 'var(--glass-backdrop)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: 'var(--text)' }}>Recent Spaces</span>
                    <button
                        onClick={() => onOpenApp('dashboard')}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: 'var(--font-xs)', cursor: 'pointer' }}
                    >
                        See All
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {recentWorkspaces.length > 0 ? recentWorkspaces.map(ws => (
                        <div
                            key={ws.id}
                            onClick={() => onOpenApp('dashboard')} // Opens dashboard (which lists them). Ideally would open detail view directly but Dashboard is the view.
                            style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '10px', borderRadius: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                cursor: 'pointer',
                                border: '1px solid transparent'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                        >
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '8px',
                                background: ws.color || 'var(--surface-3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '16px'
                            }}>
                                {ws.icon || '📁'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 500, truncate: true }}>{ws.name}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{ws.urls?.length || 0} items</div>
                            </div>
                        </div>
                    )) : (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>
                            No recent activity
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}
