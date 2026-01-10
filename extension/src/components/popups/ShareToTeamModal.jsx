import { faCheckCircle, faChevronDown, faFolder, faGlobe, faShare, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { p2pStorage } from '../../services/p2p/storageService';
import { teamManager } from '../../services/p2p/teamManager';

export function ShareToTeamModal({ isOpen, onClose, contextWorkspace }) {
    const [teams, setTeams] = useState([]);
    const [selectedTeamId, setSelectedTeamId] = useState(null);
    const [activeTab, setActiveTab] = useState(null);
    const [mode, setMode] = useState('tab'); // 'tab' | 'workspace'
    const [workspaceShareType, setWorkspaceShareType] = useState('link'); // 'link' | 'copy'
    const [windowTabs, setWindowTabs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');

    useEffect(() => {
        if (isOpen) {
            // Load Teams
            teamManager.init().then(() => {
                const allTeams = teamManager.getTeams();
                setTeams(allTeams);
                if (allTeams.length > 0) {
                    const activeId = teamManager.activeTeamId;
                    if (activeId && allTeams.find(t => t.id === activeId)) {
                        setSelectedTeamId(activeId);
                    } else {
                        setSelectedTeamId(allTeams[0].id);
                    }
                }
            });

            // Load Active Tab & All Window Tabs
            if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.query({ currentWindow: true }).then((tabs) => {
                    setWindowTabs(tabs);

                    const active = tabs.find(t => t.active);
                    if (active) {
                        try {
                            const url = new URL(active.url);
                            setActiveTab({
                                ...active,
                                domain: url.hostname,
                                favicon: active.favIconUrl || `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`
                            });
                        } catch (e) {
                            setActiveTab({ ...active, domain: 'local', favicon: '' });
                        }
                    }
                });
            }
        }
    }, [isOpen]);

    const handleShare = async () => {
        if (!selectedTeamId) return;
        setLoading(true);

        try {
            if (mode === 'tab' && activeTab) {
                await p2pStorage.addItemToTeam(selectedTeamId, {
                    id: Date.now().toString(),
                    url: activeTab.url,
                    title: activeTab.title,
                    addedBy: 'Me',
                    addedAt: Date.now(),
                    type: 'link'
                });
            } else if (mode === 'workspace' && contextWorkspace) {
                if (workspaceShareType === 'link') {
                    await p2pStorage.addItemToTeam(selectedTeamId, {
                        id: Date.now().toString(),
                        url: `workspace://${contextWorkspace.id}`,
                        title: `Workspace: ${contextWorkspace.name}`,
                        addedBy: 'Me',
                        addedAt: Date.now(),
                        type: 'workspace_ref',
                        meta: {
                            workspaceId: contextWorkspace.id,
                            workspaceName: contextWorkspace.name,
                            icon: contextWorkspace.icon || '📁'
                        }
                    });
                } else {
                    // Share contents - Use live window tabs if available, fallback to stored tabs
                    const tabsToShare = windowTabs.length > 0 ? windowTabs : (contextWorkspace.tabs || []);

                    const promises = tabsToShare.map((tab, idx) =>
                        p2pStorage.addItemToTeam(selectedTeamId, {
                            id: Date.now().toString() + idx,
                            url: tab.url,
                            title: tab.title,
                            addedBy: 'Me',
                            addedAt: Date.now(),
                            type: 'link'
                        })
                    );
                    await Promise.all(promises);
                }
            }

            setSuccessMsg('Shared successfully!');
            setTimeout(() => {
                setSuccessMsg('');
                onClose();
            }, 1000);
        } catch (err) {
            console.error('Share failed:', err);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const modalContent = (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif"
        }} onClick={onClose}>
            <div style={{
                width: 500, background: '#0f172a', borderRadius: 24,
                border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex', flexDirection: 'column'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(to right, rgba(255,255,255,0.02), transparent)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faShare} style={{ color: '#fff', fontSize: 16 }} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: 16, fontWeight: 600 }}>Share to Team</h3>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>Share content with your peers</div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.05)', border: 'none',
                        width: 32, height: 32, borderRadius: 16,
                        color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s'
                    }}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                {/* Team Selector - Prominent */}
                <div style={{ padding: '24px 24px 0' }}>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 700, letterSpacing: '0.05em' }}>
                        DESTINATION TEAM
                    </label>
                    <div style={{ position: 'relative' }}>
                        <select
                            value={selectedTeamId || ''}
                            onChange={e => setSelectedTeamId(e.target.value)}
                            style={{
                                width: '100%', padding: '14px 16px', borderRadius: 12,
                                background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', fontSize: 15, fontWeight: 500, outline: 'none',
                                appearance: 'none', cursor: 'pointer'
                            }}
                        >
                            {teams.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                        <FontAwesomeIcon icon={faChevronDown} style={{
                            position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                            color: '#94a3b8', pointerEvents: 'none'
                        }} />
                    </div>
                </div>

                {/* Tabbed Navigation */}
                <div style={{ padding: '24px 24px 0', display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => setMode('tab')}
                        style={{
                            flex: 1, padding: '10px', borderRadius: 10,
                            background: mode === 'tab' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                            color: mode === 'tab' ? '#60a5fa' : '#94a3b8',
                            border: mode === 'tab' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            transition: 'all 0.2s'
                        }}
                    >
                        <FontAwesomeIcon icon={faGlobe} /> Current Page
                    </button>
                    {contextWorkspace && (
                        <button
                            onClick={() => setMode('workspace')}
                            style={{
                                flex: 1, padding: '10px', borderRadius: 10,
                                background: mode === 'workspace' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                                color: mode === 'workspace' ? '#a78bfa' : '#94a3b8',
                                border: mode === 'workspace' ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid transparent',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                transition: 'all 0.2s'
                            }}
                        >
                            <FontAwesomeIcon icon={faFolder} /> Workspace
                        </button>
                    )}
                </div>

                {/* Content Preview Area */}
                <div style={{ padding: 24, minHeight: 160 }}>
                    {mode === 'tab' && activeTab && (
                        <div style={{
                            background: '#1e293b', borderRadius: 16, padding: 16,
                            border: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex', gap: 16, alignItems: 'flex-start'
                        }}>
                            {activeTab.favicon ? (
                                <img src={activeTab.favicon} alt="" style={{ width: 48, height: 48, borderRadius: 8 }} />
                            ) : (
                                <div style={{ width: 48, height: 48, borderRadius: 8, background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <FontAwesomeIcon icon={faGlobe} style={{ color: '#94a3b8', fontSize: 20 }} />
                                </div>
                            )}
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <div style={{ fontSize: 13, color: '#60a5fa', marginBottom: 4, fontWeight: 500 }}>SHARING PAGE</div>
                                <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {activeTab.title}
                                </div>
                                <div style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {activeTab.url}
                                </div>
                            </div>
                        </div>
                    )}

                    {mode === 'workspace' && contextWorkspace && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Workspace Preview Card with LIVE data */}
                            <div style={{
                                background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                                borderRadius: 16, padding: 20,
                                border: '1px solid rgba(255,255,255,0.1)',
                                position: 'relative', overflow: 'hidden'
                            }}>
                                <div style={{
                                    position: 'absolute', top: -10, right: -10,
                                    fontSize: 80, opacity: 0.05, transform: 'rotate(15deg)'
                                }}>
                                    {contextWorkspace.icon || '📁'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                    <div style={{ fontSize: 24 }}>{contextWorkspace.icon || '📁'}</div>
                                    <div>
                                        <div style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>{contextWorkspace.name}</div>
                                        <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                            {windowTabs.length > 0 ? windowTabs.length : (contextWorkspace.tabs?.length || 0)} tabs • Last active today
                                        </div>
                                    </div>
                                </div>

                                {/* Tabs Preview List (Mini) */}
                                <div style={{
                                    display: 'flex', gap: 6, flexWrap: 'wrap',
                                    marginTop: 12, opacity: 0.8
                                }}>
                                    {(windowTabs.length > 0 ? windowTabs : (contextWorkspace.tabs || [])).slice(0, 5).map((t, i) => (
                                        <div key={i} style={{
                                            background: 'rgba(255,255,255,0.1)',
                                            width: 24, height: 24, borderRadius: 6,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }} title={t.title}>
                                            <img src={t.favIconUrl || `https://www.google.com/s2/favicons?domain=${new URL(t.url).hostname}&sz=16`}
                                                alt="" style={{ width: 14, height: 14, borderRadius: 2 }} onError={(e) => e.target.style.display = 'none'} />
                                        </div>
                                    ))}
                                    {(windowTabs.length > 0 ? windowTabs.length : (contextWorkspace.tabs?.length || 0)) > 5 && (
                                        <div style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center', marginLeft: 4 }}>
                                            +{(windowTabs.length > 0 ? windowTabs.length : contextWorkspace.tabs?.length) - 5} more
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Options */}
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div
                                    onClick={() => setWorkspaceShareType('link')}
                                    style={{
                                        flex: 1, padding: 12, borderRadius: 12,
                                        border: workspaceShareType === 'link' ? '1px solid #a78bfa' : '1px solid rgba(255,255,255,0.1)',
                                        background: workspaceShareType === 'link' ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                                        cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {workspaceShareType === 'link' && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa' }} />}
                                        </div>
                                        Share Checkpoint
                                    </div>
                                    <div style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 24 }}>
                                        Share a live link to this workspace
                                    </div>
                                </div>

                                <div
                                    onClick={() => setWorkspaceShareType('copy')}
                                    style={{
                                        flex: 1, padding: 12, borderRadius: 12,
                                        border: workspaceShareType === 'copy' ? '1px solid #a78bfa' : '1px solid rgba(255,255,255,0.1)',
                                        background: workspaceShareType === 'copy' ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                                        cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {workspaceShareType === 'copy' && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa' }} />}
                                        </div>
                                        Share Contents
                                    </div>
                                    <div style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 24 }}>
                                        Send all {windowTabs.length > 0 ? windowTabs.length : (contextWorkspace.tabs?.length || 0)} tabs as items
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: 24, borderTop: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex', justifyContent: 'flex-end', gap: 12,
                    background: '#1e293b'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '12px 20px', borderRadius: 10,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#94a3b8', fontSize: 14, fontWeight: 500, cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={loading || !selectedTeamId || (mode === 'tab' && !activeTab)}
                        style={{
                            padding: '12px 24px', borderRadius: 10,
                            background: successMsg ? '#10b981' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            border: 'none',
                            color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                            boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)',
                            opacity: (loading || !selectedTeamId) ? 0.7 : 1,
                            minWidth: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                        }}
                    >
                        {successMsg ? (
                            <><FontAwesomeIcon icon={faCheckCircle} /> Sent!</>
                        ) : (
                            <>{loading ? 'Sending...' : 'Share Now'}</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
