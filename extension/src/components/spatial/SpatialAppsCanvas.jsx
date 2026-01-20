import {
    faCalculator,
    faCode,
    faCog,
    faComment,
    faDesktop,
    faFilm,
    faFolder,
    faGamepad,
    faGlobe,
    faMemory,
    faMicrochip,
    faMusic,
    faPen,
    faRocket,
    faSync,
    faTerminal,
    faThumbtack
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import nativeBridge from '../../services/nativeBridge';
import { getFaviconUrl } from '../../utils';

export function SpatialAppsCanvas() {
    const [pinnedApps, setPinnedApps] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('pinned_apps') || '[]');
        } catch {
            return [];
        }
    });

    useEffect(() => {
        localStorage.setItem('pinned_apps', JSON.stringify(pinnedApps));
    }, [pinnedApps]);

    const togglePin = (proc) => {
        console.log('Toggling pin for:', proc.name);
        setPinnedApps(prev => {
            const exists = prev.find(p => p.name === proc.name);
            if (exists) {
                console.log('Unpinning');
                return prev.filter(p => p.name !== proc.name);
            }
            console.log('Pinning');
            return [...prev, { name: proc.name, exe: proc.exe || proc.name }];
        });
    };

    const isPinned = (procName) => {
        return pinnedApps.some(p => p.name === procName);
    };

    const handlePinnedClick = (app) => {
        // Check if running
        const running = processes.find(p => p.name === app.name);
        if (running) {
            handleAppClick(running);
        } else {
            // Launch
            console.log('Launching pinned app:', app.name);
            nativeBridge.postMessage({ command: 'launch_app', app: app.exe || app.name });
        }
    };

    const [isConnected, setIsConnected] = useState(false);
    const [processes, setProcesses] = useState([]);
    const [systemStats, setSystemStats] = useState(null);
    const [activeCategory, setActiveCategory] = useState('Running Apps');
    const [launchPath, setLaunchPath] = useState('');

    // Connection Check
    const fetchData = () => {
        nativeBridge.postMessage({ command: 'get_system_stats' });
        nativeBridge.postMessage({ command: 'get_processes' });
    };

    const checkConnection = () => {
        const connected = nativeBridge.connect();
        setIsConnected(connected);
        if (connected) {
            fetchData();
        }
    };

    useEffect(() => {
        checkConnection();
        const unsubscribe = nativeBridge.onMessage((msg) => {
            if (msg.command === 'process_list') {
                setProcesses(msg.data);
            } else if (msg.command === 'system_stats') {
                setSystemStats(msg.data);
            }
        });

        const interval = setInterval(() => {
            if (nativeBridge.isConnected) {
                nativeBridge.postMessage({ command: 'get_system_stats' });
                if (Date.now() % 5000 < 1000) {
                    nativeBridge.postMessage({ command: 'get_processes' });
                }
            } else {
                setIsConnected(false);
            }
        }, 2000);

        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, []);

    const handleLaunch = (e) => {
        e.preventDefault();
        if (launchPath.trim()) {
            nativeBridge.postMessage({ command: 'launch_app', app: launchPath });
            setLaunchPath('');
        }
    };

    const categories = ['Running Apps', 'System Health'];

    const handleAppClick = (proc) => {
        console.log('Focusing PID:', proc.pid);
        nativeBridge.postMessage({ command: 'focus_window', pid: proc.pid });
    };

    // Helper to get icon and color for process
    const getProcessMetadata = (name) => {
        const n = name.toLowerCase();

        // 1. Browsers
        if (n.includes('chrome')) return { icon: faGlobe, color: '#3B82F6', type: 'Browser', domain: 'google.com' };
        if (n.includes('edge')) return { icon: faGlobe, color: '#0078D7', type: 'Browser', domain: 'microsoft.com' };
        if (n.includes('firefox')) return { icon: faGlobe, color: '#FF7139', type: 'Browser', domain: 'mozilla.org' };
        if (n.includes('opera')) return { icon: faGlobe, color: '#FF1B2D', type: 'Browser', domain: 'opera.com' };
        if (n.includes('brave')) return { icon: faGlobe, color: '#FF2000', type: 'Browser', domain: 'brave.com' };
        if (n.includes('safari')) return { icon: faGlobe, color: '#00A0F5', type: 'Browser', domain: 'apple.com' };
        if (n.includes('arc')) return { icon: faGlobe, color: '#FC6470', type: 'Browser', domain: 'arc.net' };

        // 2. Developer Tools
        if (n.includes('code') || n.includes('vscode')) return { icon: faCode, color: '#0EA5E9', type: 'Developer', domain: 'code.visualstudio.com' };
        if (n.includes('studio')) return { icon: faCode, color: '#5C2D91', type: 'Developer', domain: 'visualstudio.microsoft.com' };
        if (n.includes('intelligent') || n.includes('idea')) return { icon: faCode, color: '#000000', type: 'Developer', domain: 'jetbrains.com' };
        if (n.includes('pycharm')) return { icon: faCode, color: '#21D789', type: 'Developer', domain: 'jetbrains.com' };
        if (n.includes('webstorm')) return { icon: faCode, color: '#00CDD7', type: 'Developer', domain: 'jetbrains.com' };
        if (n.includes('cursor')) return { icon: faCode, color: '#000000', type: 'Developer', domain: 'cursor.sh' };
        if (n.includes('sublime')) return { icon: faCode, color: '#FF9800', type: 'Developer', domain: 'sublimetext.com' };
        if (n.includes('github')) return { icon: faCode, color: '#181717', type: 'Developer', domain: 'github.com' };
        if (n.includes('docker')) return { icon: faCode, color: '#2496ED', type: 'Developer', domain: 'docker.com' };

        // 3. Media & Entertainment
        if (n.includes('spotify')) return { icon: faMusic, color: '#1DB954', type: 'Media', domain: 'spotify.com' };
        if (n.includes('vlc')) return { icon: faFilm, color: '#FF8800', type: 'Media', domain: 'videolan.org' };
        if (n.includes('netflix')) return { icon: faFilm, color: '#E50914', type: 'Media', domain: 'netflix.com' };
        if (n.includes('steam')) return { icon: faGamepad, color: '#171A21', type: 'Game', domain: 'store.steampowered.com' };
        if (n.includes('epic')) return { icon: faGamepad, color: '#313131', type: 'Game', domain: 'store.epicgames.com' };
        if (n.includes('xbox')) return { icon: faGamepad, color: '#107C10', type: 'Game', domain: 'xbox.com' };

        // 4. Communication
        if (n.includes('discord')) return { icon: faComment, color: '#5865F2', type: 'Communication', domain: 'discord.com' };
        if (n.includes('slack')) return { icon: faComment, color: '#4A154B', type: 'Communication', domain: 'slack.com' };
        if (n.includes('teams')) return { icon: faComment, color: '#6264A7', type: 'Communication', domain: 'teams.microsoft.com' };
        if (n.includes('whatsapp')) return { icon: faComment, color: '#25D366', type: 'Communication', domain: 'whatsapp.com' };
        if (n.includes('telegram')) return { icon: faComment, color: '#26A5E4', type: 'Communication', domain: 'telegram.org' };
        if (n.includes('skype')) return { icon: faComment, color: '#00AFF0', type: 'Communication', domain: 'skype.com' };
        if (n.includes('zoom')) return { icon: faComment, color: '#2D8CFF', type: 'Communication', domain: 'zoom.us' };
        if (n.includes('messenger')) return { icon: faComment, color: '#00B2FF', type: 'Communication', domain: 'messenger.com' };

        // 5. Productivity / Creative
        if (n.includes('notion')) return { icon: faPen, color: '#000000', type: 'Productivity', domain: 'notion.so' };
        if (n.includes('figma')) return { icon: faPen, color: '#F24E1E', type: 'Creative', domain: 'figma.com' };
        if (n.includes('photoshop')) return { icon: faPen, color: '#31A8FF', type: 'Creative', domain: 'adobe.com' };
        if (n.includes('illustrator')) return { icon: faPen, color: '#FF9A00', type: 'Creative', domain: 'adobe.com' };
        if (n.includes('word')) return { icon: faPen, color: '#2B579A', type: 'Office', domain: 'office.com' };
        if (n.includes('excel')) return { icon: faPen, color: '#217346', type: 'Office', domain: 'office.com' };
        if (n.includes('powerpoint')) return { icon: faPen, color: '#D24726', type: 'Office', domain: 'office.com' };
        if (n.includes('obsidian')) return { icon: faPen, color: '#7A3EE8', type: 'Productivity', domain: 'obsidian.md' };


        // 6. System & Utilities (No domain, use generic icons)
        if (n.includes('terminal') || n.includes('powershell') || n.includes('cmd') || n.includes('bash') || n.includes('putty')) {
            return { icon: faTerminal, color: '#64748B', type: 'Terminal' };
        }
        if (n.includes('explorer') || n.includes('finder')) {
            return { icon: faFolder, color: '#F59E0B', type: 'System' };
        }
        if (n.includes('calc')) {
            return { icon: faCalculator, color: '#F59E0B', type: 'Utility' };
        }
        if (n.includes('obs') || n.includes('stream')) {
            return { icon: faFilm, color: '#10B981', type: 'Streaming', domain: 'obsproject.com' };
        }
        if (n.includes('settings') || n.includes('control')) {
            return { icon: faCog, color: '#94A3B8', type: 'System' };
        }

        // Default
        return { icon: faDesktop, color: '#94A3B8', type: 'App' };
    };

    if (!isConnected) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: '24px',
                color: 'var(--text)',
                textAlign: 'center',
                padding: '40px'
            }}>
                <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '20px',
                    background: 'var(--surface-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px',
                    color: 'var(--text-secondary)'
                }}>
                    <FontAwesomeIcon icon={faDesktop} />
                </div>
                <div>
                    <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Sync with Computer</h2>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', lineHeight: '1.5' }}>
                        To view and control apps on your computer, you need to install the Cooldesk Native Bridge.
                    </p>
                </div>

                <div style={{
                    background: 'var(--surface-2)',
                    padding: '20px',
                    borderRadius: '12px',
                    textAlign: 'left',
                    maxWidth: '500px',
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: '12px'
                }}>
                    <p style={{ marginBottom: '10px', fontWeight: 600 }}>Installation Steps:</p>
                    <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li>Download the helper script.</li>
                        <li>Run <code>python install.py</code> in the terminal.</li>
                        <li>Enter your Extension ID when prompted.</li>
                        <li>Reload this page.</li>
                    </ol>
                </div>

                <button
                    onClick={checkConnection}
                    style={{
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <FontAwesomeIcon icon={faSync} />
                    Check Connection
                </button>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex',
            height: '100%',
            background: 'var(--background-primary)',
            overflow: 'hidden'
        }}>
            {/* Sidebar ... */}
            <div style={{
                width: '260px',
                padding: '24px',
                borderRight: '1px solid var(--border-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: 'rgba(0, 0, 0, 0.2)'
            }}>
                {/* ... Sidebar Content ... */}
                <h2 className="section-header" style={{ marginBottom: '24px', borderBottom: 'none' }}>
                    <div className="section-indicator" />
                    <span className="section-title" style={{ fontSize: 'var(--font-xl)' }}>My Computer</span>
                </h2>

                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`nav-item ${activeCategory === cat ? 'active' : ''}`}
                        style={{ width: '100%', border: 'none', background: activeCategory === cat ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2), rgba(96, 165, 250, 0.05))' : 'transparent' }}
                    >
                        <FontAwesomeIcon icon={
                            cat === 'Running Apps' ? faRocket :
                                cat === 'System Health' ? faMicrochip :
                                    faTerminal
                        } style={{ width: '20px', opacity: activeCategory === cat ? 1 : 0.7 }} />
                        <span style={{ fontWeight: 500 }}>{cat}</span>
                    </button>
                ))}

                <div style={{ marginTop: 'auto' }}>
                    {systemStats && (
                        <div className="glass-card" style={{ padding: '16px' }}>
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: 'var(--font-sm)' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>CPU</span>
                                    <span style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{systemStats.cpu.toFixed(1)}%</span>
                                </div>
                                <div style={{ height: '4px', background: 'var(--surface-3)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${systemStats.cpu}%`, background: 'var(--accent-blue)', height: '100%', borderRadius: '2px' }} />
                                </div>
                            </div>

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: 'var(--font-sm)' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Memory</span>
                                    <span style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>{systemStats.memory ? systemStats.memory.percent.toFixed(1) : 0}%</span>
                                </div>
                                <div style={{ height: '4px', background: 'var(--surface-3)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${systemStats.memory ? systemStats.memory.percent : 0}%`, background: 'var(--accent-purple)', height: '100%', borderRadius: '2px' }} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
                <div className="fade-in">
                    <h1 style={{ fontSize: 'var(--font-3xl)', fontWeight: 700, marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {activeCategory}
                        {activeCategory === 'Running Apps' && (
                            <span className="status-active" style={{ fontSize: 'var(--font-sm)', background: 'var(--surface-2)', padding: '4px 12px', borderRadius: '20px' }}>
                                {processes.length} Active
                            </span>
                        )}
                    </h1>

                    {activeCategory === 'Running Apps' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                            {/* Integrated Launcher */}
                            <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <FontAwesomeIcon icon={faTerminal} style={{ color: 'var(--text-secondary)', fontSize: '18px' }} />
                                <form onSubmit={handleLaunch} style={{ flex: 1, display: 'flex', gap: '12px' }}>
                                    <input
                                        type="text"
                                        value={launchPath}
                                        onChange={(e) => setLaunchPath(e.target.value)}
                                        placeholder="Run command or launch app (e.g. 'calc', 'notepad')"
                                        style={{
                                            flex: 1,
                                            background: 'transparent',
                                            border: 'none',
                                            color: 'var(--text)',
                                            fontSize: '16px',
                                            outline: 'none'
                                        }}
                                    />
                                    {launchPath && (
                                        <button
                                            type="submit"
                                            className="btn-primary"
                                            style={{ padding: '8px 16px', fontSize: '14px', borderRadius: '8px' }}
                                        >
                                            Launch
                                        </button>
                                    )}
                                </form>
                            </div>

                            {/* Pinned Apps Section */}
                            {pinnedApps.length > 0 && (
                                <div>
                                    <h3 className="section-header" style={{ fontSize: 'var(--font-lg)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                        <FontAwesomeIcon icon={faThumbtack} style={{ marginRight: '8px' }} />
                                        Pinned Shortcuts
                                    </h3>
                                    <div className="grid-4" style={{ gap: '20px' }}>
                                        {pinnedApps.map(app => {
                                            const meta = getProcessMetadata(app.name);
                                            const faviconUrl = meta.domain ? getFaviconUrl(`https://${meta.domain}`, 64) : null;
                                            const isRunning = processes.some(p => p.name === app.name);

                                            return (
                                                <div
                                                    key={app.name}
                                                    onClick={() => handlePinnedClick(app)}
                                                    className="glass-card"
                                                    style={{
                                                        padding: '24px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        gap: '16px',
                                                        cursor: 'pointer',
                                                        textAlign: 'center',
                                                        position: 'relative',
                                                        border: isRunning ? '1px solid var(--accent-primary)' : undefined
                                                    }}
                                                >
                                                    <div
                                                        onClick={(e) => { e.stopPropagation(); togglePin(app); }}
                                                        style={{
                                                            position: 'absolute',
                                                            top: '12px',
                                                            right: '12px',
                                                            color: 'var(--accent-primary)',
                                                            opacity: 1,
                                                            cursor: 'pointer',
                                                            padding: '4px',
                                                            zIndex: 10
                                                        }}
                                                        title="Unpin app"
                                                    >
                                                        <FontAwesomeIcon icon={faThumbtack} />
                                                    </div>

                                                    <div style={{
                                                        width: '64px',
                                                        height: '64px',
                                                        background: faviconUrl ? 'transparent' : `linear-gradient(135deg, ${meta.color}20, ${meta.color}05)`,
                                                        borderRadius: '20px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '28px',
                                                        color: meta.color,
                                                        boxShadow: faviconUrl ? 'none' : `0 8px 16px -4px ${meta.color}20`,
                                                        padding: '8px',
                                                        filter: isRunning ? 'none' : 'grayscale(0.5) opacity(0.7)'
                                                    }}>
                                                        {faviconUrl ? (
                                                            <img
                                                                src={faviconUrl}
                                                                alt={app.name}
                                                                style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}
                                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                            />
                                                        ) : (
                                                            <FontAwesomeIcon icon={meta.icon} />
                                                        )}
                                                    </div>

                                                    <div style={{ width: '100%' }}>
                                                        <div style={{
                                                            fontWeight: 600,
                                                            fontSize: 'var(--font-lg)',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            marginBottom: '6px',
                                                            color: 'var(--text)'
                                                        }} title={app.name}>
                                                            {app.name.replace('.exe', '')}
                                                        </div>
                                                        <div style={{
                                                            fontSize: 'var(--font-xs)',
                                                            color: isRunning ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                                            background: isRunning ? 'rgba(52, 199, 89, 0.1)' : 'var(--surface-3)',
                                                            padding: '4px 10px',
                                                            borderRadius: '12px',
                                                            display: 'inline-block',
                                                            fontWeight: 500
                                                        }}>
                                                            {isRunning ? 'Running' : 'Click to Launch'}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Connected Apps Section */}
                            <div>
                                {pinnedApps.length > 0 && (
                                    <h3 className="section-header" style={{ fontSize: 'var(--font-lg)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                        <FontAwesomeIcon icon={faRocket} style={{ marginRight: '8px' }} />
                                        Running Processes
                                    </h3>
                                )}
                                <div className="grid-4" style={{ gap: '20px' }}>
                                    {processes.map(proc => {
                                        const meta = getProcessMetadata(proc.name);
                                        const faviconUrl = meta.domain ? getFaviconUrl(`https://${meta.domain}`, 64) : null;
                                        const pinned = isPinned(proc.name);

                                        return (
                                            <div
                                                key={proc.pid}
                                                onClick={() => handleAppClick(proc)}
                                                className="glass-card"
                                                style={{
                                                    padding: '24px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    gap: '16px',
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
                                                    position: 'relative'
                                                }}
                                            >
                                                <div
                                                    onClick={(e) => { e.stopPropagation(); togglePin(proc); }}
                                                    className="pin-button"
                                                    style={{
                                                        position: 'absolute',
                                                        top: '12px',
                                                        right: '12px',
                                                        color: pinned ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                                        opacity: pinned ? 1 : 0.3,
                                                        transition: 'all 0.2s',
                                                        cursor: 'pointer',
                                                        padding: '4px',
                                                        zIndex: 10
                                                    }}
                                                    title={pinned ? "Unpin app" : "Pin app for quick launch"}
                                                >
                                                    <FontAwesomeIcon icon={faThumbtack} style={{ transform: pinned ? 'rotate(-45deg)' : 'none' }} />
                                                </div>
                                                <style>{`
                                                    .glass-card:hover .pin-button {
                                                        opacity: 1 !important;
                                                    }
                                                `}</style>

                                                <div style={{
                                                    width: '64px',
                                                    height: '64px',
                                                    background: faviconUrl ? 'transparent' : `linear-gradient(135deg, ${meta.color}20, ${meta.color}05)`,
                                                    borderRadius: '20px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '28px',
                                                    color: meta.color,
                                                    boxShadow: faviconUrl ? 'none' : `0 8px 16px -4px ${meta.color}20`,
                                                    padding: '8px'
                                                }}>
                                                    {faviconUrl ? (
                                                        <img
                                                            src={faviconUrl}
                                                            alt={proc.name}
                                                            style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}
                                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <FontAwesomeIcon icon={meta.icon} />
                                                    )}
                                                </div>

                                                <div style={{ width: '100%' }}>
                                                    <div style={{
                                                        fontWeight: 600,
                                                        fontSize: 'var(--font-lg)',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        marginBottom: '6px',
                                                        color: 'var(--text)'
                                                    }} title={proc.name}>
                                                        {proc.name.replace('.exe', '')}
                                                    </div>
                                                    <div style={{
                                                        fontSize: 'var(--font-xs)',
                                                        color: 'var(--text-secondary)',
                                                        background: 'var(--surface-3)',
                                                        padding: '4px 10px',
                                                        borderRadius: '12px',
                                                        display: 'inline-block',
                                                        fontWeight: 500
                                                    }}>
                                                        {(proc.memory / 1024 / 1024).toFixed(0)} MB
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {processes.length === 0 && (
                                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                                            <div className="loading-spinner" style={{ width: '32px', height: '32px' }} />
                                            <span>Scanning for running applications...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeCategory === 'System Health' && systemStats && (
                        <div className="grid-2">
                            <div className="glass-card" style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(96, 165, 250, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)', fontSize: '24px' }}>
                                        <FontAwesomeIcon icon={faMicrochip} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', fontWeight: 500 }}>Processor</div>
                                        <div style={{ fontSize: 'var(--font-2xl)', fontWeight: 700 }}>CPU Usage</div>
                                    </div>
                                </div>

                                <div style={{ fontSize: '64px', fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                                    {systemStats.cpu}%
                                </div>

                                <div style={{ height: '8px', background: 'var(--surface-3)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ width: `${systemStats.cpu}%`, background: 'var(--accent-blue)', height: '100%', borderRadius: '4px', transition: 'width 0.5s ease-out' }} />
                                </div>
                            </div>

                            <div className="glass-card" style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-purple)', fontSize: '24px' }}>
                                        <FontAwesomeIcon icon={faMemory} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', fontWeight: 500 }}>RAM</div>
                                        <div style={{ fontSize: 'var(--font-2xl)', fontWeight: 700 }}>Memory Usage</div>
                                    </div>
                                </div>

                                <div style={{ fontSize: '64px', fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                                    {systemStats.memory.percent}%
                                </div>

                                <div>
                                    <div style={{ height: '8px', background: 'var(--surface-3)', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                                        <div style={{ width: `${systemStats.memory ? systemStats.memory.percent : 0}%`, background: 'var(--accent-purple)', height: '100%', borderRadius: '4px', transition: 'width 0.5s ease-out' }} />
                                    </div>
                                    <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', textAlign: 'right' }}>
                                        <span style={{ color: 'var(--text)' }}>{(systemStats.memory.used / 1024 / 1024 / 1024).toFixed(1)} GB</span> used of {(systemStats.memory.total / 1024 / 1024 / 1024).toFixed(1)} GB
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}


                </div>
            </div>
        </div>
    );
}
