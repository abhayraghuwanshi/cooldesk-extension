import { faCheckCircle, faChevronDown, faFolder, faGlobe, faShare, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listWorkspaces } from '../../db/index.js';
import { p2pStorage } from '../../services/p2p/storageService';
import { teamManager } from '../../services/p2p/teamManager';

export function ShareToTeamModal({ isOpen, onClose, contextWorkspace }) {
    const [teams, setTeams] = useState([]);
    const [selectedTeamId, setSelectedTeamId] = useState(null);
    const [windowTabs, setWindowTabs] = useState([]);
    const [selectedTabIds, setSelectedTabIds] = useState(new Set());
    const [workspaces, setWorkspaces] = useState([]);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
    const [mode, setMode] = useState('tabs'); // 'tabs' | 'workspace'
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

            // Load All Window Tabs
            if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.query({ currentWindow: true }).then((tabs) => {
                    setWindowTabs(tabs);

                    // Pre-select active tab
                    const activeTab = tabs.find(t => t.active);
                    if (activeTab) {
                        setSelectedTabIds(new Set([activeTab.id]));
                    }
                });
            }

            // Load All Workspaces from IndexedDB
            listWorkspaces().then((allWorkspaces) => {
                const workspaceArray = Array.isArray(allWorkspaces) ? allWorkspaces : [];
                setWorkspaces(workspaceArray);
                // Pre-select context workspace if available
                if (contextWorkspace) {
                    setSelectedWorkspaceId(contextWorkspace.id);
                } else if (workspaceArray.length > 0) {
                    setSelectedWorkspaceId(workspaceArray[0].id);
                }
            }).catch(err => {
                console.error('[ShareModal] Failed to load workspaces:', err);
                setWorkspaces([]);
            });
        }
    }, [isOpen, contextWorkspace]);

    const handleTabToggle = (tabId) => {
        const newSelection = new Set(selectedTabIds);
        if (newSelection.has(tabId)) {
            newSelection.delete(tabId);
        } else {
            newSelection.add(tabId);
        }
        setSelectedTabIds(newSelection);
    };

    const handleSelectAll = () => {
        setSelectedTabIds(new Set(windowTabs.map(t => t.id)));
    };

    const handleDeselectAll = () => {
        setSelectedTabIds(new Set());
    };

    const handleShare = async () => {
        if (!selectedTeamId) return;
        setLoading(true);

        try {
            if (mode === 'tabs') {
                // Share selected tabs
                const tabsToShare = windowTabs.filter(t => selectedTabIds.has(t.id));
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
            } else if (mode === 'workspace' && selectedWorkspaceId) {
                // Share workspace reference
                const workspace = workspaces.find(w => w.id === selectedWorkspaceId);
                if (workspace) {
                    await p2pStorage.addItemToTeam(selectedTeamId, {
                        id: Date.now().toString(),
                        url: `workspace://${workspace.id}`,
                        title: `Workspace: ${workspace.name}`,
                        addedBy: 'Me',
                        addedAt: Date.now(),
                        type: 'workspace_ref',
                        meta: {
                            workspaceId: workspace.id,
                            workspaceName: workspace.name,
                            icon: workspace.icon || '📁'
                        }
                    });
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

    const selectedCount = selectedTabIds.size;
    const totalTabs = windowTabs.length;

    const modalContent = (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif"
        }} onClick={onClose}>
            <div style={{
                width: 600, maxHeight: '80vh', background: '#0f172a', borderRadius: 24,
                border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex', flexDirection: 'column'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: 'linear-gradient(to right, rgba(255,255,255,0.02), transparent)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
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

                    {/* Team Selector */}
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 700, letterSpacing: '0.05em' }}>
                            DESTINATION TEAM
                        </label>
                        <div style={{ position: 'relative' }}>
                            <select
                                value={selectedTeamId || ''}
                                onChange={e => setSelectedTeamId(e.target.value)}
                                style={{
                                    width: '100%', padding: '12px 16px', borderRadius: 12,
                                    background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 14, fontWeight: 500, outline: 'none',
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

                    {/* Mode Toggle */}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => setMode('tabs')}
                            style={{
                                flex: 1, padding: '10px', borderRadius: 10,
                                background: mode === 'tabs' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                color: mode === 'tabs' ? '#60a5fa' : '#94a3b8',
                                border: mode === 'tabs' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                transition: 'all 0.2s'
                            }}
                        >
                            <FontAwesomeIcon icon={faGlobe} /> Share Tabs
                        </button>
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
                            <FontAwesomeIcon icon={faFolder} /> Share Workspace
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                    {mode === 'tabs' ? (
                        <>
                            {/* Tab Selection Controls */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                                    {selectedCount} of {totalTabs} tabs selected
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={handleSelectAll}
                                        style={{
                                            padding: '6px 12px', borderRadius: 8,
                                            background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)',
                                            color: '#60a5fa', fontSize: 12, fontWeight: 500, cursor: 'pointer'
                                        }}
                                    >
                                        Select All
                                    </button>
                                    <button
                                        onClick={handleDeselectAll}
                                        style={{
                                            padding: '6px 12px', borderRadius: 8,
                                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                            color: '#94a3b8', fontSize: 12, fontWeight: 500, cursor: 'pointer'
                                        }}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>

                            {/* Tab List */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {windowTabs.map(tab => {
                                    const isSelected = selectedTabIds.has(tab.id);
                                    let hostname = 'unknown';
                                    try {
                                        if (tab.url) hostname = new URL(tab.url).hostname;
                                    } catch (e) { }

                                    return (
                                        <div
                                            key={tab.id}
                                            onClick={() => handleTabToggle(tab.id)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                                                background: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.03)',
                                                border: `1px solid ${isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                                                borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={e => {
                                                if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                                            }}
                                            onMouseLeave={e => {
                                                if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                            }}
                                        >
                                            {/* Checkbox */}
                                            <div style={{
                                                width: 18, height: 18, borderRadius: 4,
                                                border: `2px solid ${isSelected ? '#60a5fa' : '#475569'}`,
                                                background: isSelected ? '#60a5fa' : 'transparent',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                transition: 'all 0.2s'
                                            }}>
                                                {isSelected && (
                                                    <FontAwesomeIcon icon={faCheckCircle} style={{ color: '#fff', fontSize: 10 }} />
                                                )}
                                            </div>

                                            {/* Favicon */}
                                            <div style={{
                                                width: 24, height: 24, borderRadius: 6, overflow: 'hidden',
                                                background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}>
                                                <img
                                                    src={tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                                                    alt=""
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            </div>

                                            {/* Tab Info */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {tab.title || 'Untitled'}
                                                </div>
                                                <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {hostname}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        /* Workspace Mode - Show all workspaces */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {workspaces.length === 0 ? (
                                <div style={{
                                    textAlign: 'center', padding: '40px 20px',
                                    color: '#64748b', fontSize: 13
                                }}>
                                    No workspaces found. Create a workspace first.
                                </div>
                            ) : (
                                workspaces.map(workspace => {
                                    const isSelected = selectedWorkspaceId === workspace.id;
                                    const tabCount = workspace.tabs?.length || 0;

                                    return (
                                        <div
                                            key={workspace.id}
                                            onClick={() => setSelectedWorkspaceId(workspace.id)}
                                            style={{
                                                background: isSelected
                                                    ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.08) 100%)'
                                                    : 'rgba(255,255,255,0.03)',
                                                borderRadius: 16, padding: 16,
                                                border: `1px solid ${isSelected ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                                                cursor: 'pointer', transition: 'all 0.2s',
                                                position: 'relative', overflow: 'hidden'
                                            }}
                                            onMouseEnter={e => {
                                                if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                                            }}
                                            onMouseLeave={e => {
                                                if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                            }}
                                        >
                                            {isSelected && (
                                                <div style={{
                                                    position: 'absolute', top: -10, right: -10,
                                                    fontSize: 60, opacity: 0.05, transform: 'rotate(15deg)'
                                                }}>
                                                    {workspace.icon || '📁'}
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                {/* Selection indicator */}
                                                <div style={{
                                                    width: 18, height: 18, borderRadius: 4,
                                                    border: `2px solid ${isSelected ? '#a78bfa' : '#475569'}`,
                                                    background: isSelected ? '#a78bfa' : 'transparent',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    transition: 'all 0.2s'
                                                }}>
                                                    {isSelected && (
                                                        <FontAwesomeIcon icon={faCheckCircle} style={{ color: '#fff', fontSize: 10 }} />
                                                    )}
                                                </div>

                                                {/* Workspace icon */}
                                                <div style={{ fontSize: 24 }}>{workspace.icon || '📁'}</div>

                                                {/* Workspace info */}
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                                                        {workspace.name}
                                                    </div>
                                                    <div style={{ color: '#64748b', fontSize: 12 }}>
                                                        {tabCount} tab{tabCount !== 1 ? 's' : ''} • Workspace Reference
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
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
                        disabled={loading || !selectedTeamId || (mode === 'tabs' && selectedCount === 0) || (mode === 'workspace' && !selectedWorkspaceId)}
                        style={{
                            padding: '12px 24px', borderRadius: 10,
                            background: successMsg ? '#10b981' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            border: 'none',
                            color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                            boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)',
                            opacity: (loading || !selectedTeamId || (mode === 'tabs' && selectedCount === 0) || (mode === 'workspace' && !selectedWorkspaceId)) ? 0.5 : 1,
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
