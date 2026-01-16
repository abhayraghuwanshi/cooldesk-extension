import { faLink, faShare, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';
import { p2pSyncService } from '../../services/p2p/syncService';
import { teamManager } from '../../services/p2p/teamManager';
import { getFaviconUrl } from '../../utils';
import { ShareToTeamModal } from '../popups/ShareToTeamModal';
import NoticeBoard from './NoticeBoard';
import TeamContextPanel from './TeamContextPanel';

export default function TeamView({ team: propTeam }) {
    const [activeTeamId, setActiveTeamId] = useState(propTeam?.id || null);
    const [teams, setTeams] = useState([]);
    const [items, setItems] = useState([]);
    const [peerCounts, setPeerCounts] = useState(new Map());
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const yArrayRef = useRef(null);

    // Initial load of teams & active team
    useEffect(() => {
        const init = async () => {
            await teamManager.init();
            setTeams(teamManager.getTeams());
            if (!propTeam && !activeTeamId && teamManager.activeTeamId) {
                setActiveTeamId(teamManager.activeTeamId);
            }
        };
        init();

        const unsub = teamManager.subscribe(({ teams: updatedTeams, activeTeamId: updatedActiveId }) => {
            setTeams(updatedTeams);
            // Only auto-switch if we don't have a selection or if the selection was removed
            if (!propTeam) {
                setActiveTeamId(prev => {
                    const stillExists = updatedTeams.find(t => t.id === prev);
                    return stillExists ? prev : updatedActiveId;
                });
            }
        });
        return unsub;
    }, [propTeam]);

    // Track peer counts for ALL teams
    useEffect(() => {
        const updateCounts = (counts) => {
            // Update local map of ALL counts
            setPeerCounts(new Map(counts));
        };
        // Initial get
        const initialCounts = new Map();
        teams.forEach(t => initialCounts.set(t.id, p2pSyncService.getPeerCount(t.id)));
        setPeerCounts(initialCounts);

        const unsub = p2pSyncService.subscribe(updateCounts);
        return unsub;
    }, [teams]);

    // Load items for the SELECTED team
    useEffect(() => {
        console.log('[TeamView] Active Team changed:', activeTeamId);
        if (!activeTeamId) {
            setItems([]);
            return;
        }

        let observer = null;
        let pArray = null;

        const load = async () => {
            console.log('[TeamView] Initializing storage for:', activeTeamId);
            // We assume storage is initialized (or we init it now)
            await p2pStorage.initializeTeamStorage(activeTeamId);

            pArray = p2pStorage.getSharedItems(activeTeamId);
            yArrayRef.current = pArray;

            const currentItems = pArray.toArray();
            console.log('[TeamView] Loaded items:', currentItems);
            setItems(currentItems);

            observer = () => {
                const updated = pArray.toArray();
                console.log('[TeamView] Observer fired. New items:', updated);
                setItems(updated);
            };
            pArray.observe(observer);
        };
        load();

        return () => {
            if (pArray && observer) pArray.unobserve(observer);
            yArrayRef.current = null;
        };
    }, [activeTeamId]);

    const handleAddItem = () => {
        if (typeof chrome !== 'undefined' && chrome.tabs && yArrayRef.current) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab) {
                    const newItem = {
                        id: Date.now().toString(),
                        url: tab.url,
                        title: tab.title,
                        addedBy: 'Me',
                        addedAt: Date.now(),
                        type: 'link'
                    };
                    yArrayRef.current.push([newItem]);
                }
            });
        }
    };

    const deleteItem = (index) => {
        if (yArrayRef.current) yArrayRef.current.delete(index, 1);
    };

    const handleTeamClick = (teamId) => {
        setActiveTeamId(teamId);
        // Optionally set as "global" active team via manager?
        // teamManager.setActiveTeam(teamId); 
    };

    const activeTeam = teams.find(t => t.id === activeTeamId);

    return (
        <div style={{
            display: 'flex', height: '100%', color: '#fff',
            borderRadius: 16, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.2)' // consistent background
        }}>
            {/* Sidebar */}
            <div style={{
                width: 200, flexShrink: 0,
                borderRight: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', flexDirection: 'column',
                background: 'rgba(0,0,0,0.2)'
            }}>
                <div style={{ padding: '16px', fontSize: 'var(--font-sm)', fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Your Teams
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {teams.map(team => {
                        const count = peerCounts.get(team.id) || 0;
                        const isActive = team.id === activeTeamId;
                        return (
                            <div
                                key={team.id}
                                onClick={() => handleTeamClick(team.id)}
                                style={{
                                    padding: '10px 16px',
                                    background: isActive ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                    borderLeft: `3px solid ${isActive ? '#60a5fa' : 'transparent'}`,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <div style={{ fontSize: 14, fontWeight: 500, color: isActive ? '#fff' : '#ccc' }}>
                                    {team.name}
                                </div>
                                <div style={{ fontSize: 11, color: isActive ? '#93c5fd' : '#6b7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: count > 0 ? '#4ade80' : '#4b5563',
                                        boxShadow: count > 0 ? '0 0 6px #4ade80' : 'none'
                                    }} />
                                    {count} peer{count !== 1 ? 's' : ''}
                                </div>
                            </div>
                        );
                    })}
                    {teams.length === 0 && (
                        <div style={{ padding: 16, fontSize: 'var(--font-sm)', opacity: 0.5 }}>
                            No teams yet. Create one in Settings.
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="team-view-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {!activeTeam ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, flexDirection: 'column', gap: 16 }}>
                        <FontAwesomeIcon icon={faUsers} size="3x" />
                        <div>Select a team to view shared items</div>
                    </div>
                ) : (
                    <>
                        {/* Team Header */}
                        <div style={{
                            padding: '20px 32px',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div>
                                <h1 style={{ margin: 0, fontSize: 'var(--font-4xl)', fontWeight: 700 }}>{activeTeam.name}</h1>
                                <div style={{ fontSize: 'var(--font-sm)', opacity: 0.5, marginTop: 4 }}>
                                    Shared Workspace • {peerCounts.get(activeTeam.id) || 0} active peers connected
                                </div>
                            </div>
                            <button
                                onClick={() => setIsShareModalOpen(true)}
                                style={{
                                    padding: '8px 16px', borderRadius: 8, border: 'none',
                                    background: '#3b82f6', color: '#fff', fontWeight: 600,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                                }}
                            >
                                <FontAwesomeIcon icon={faShare} />
                                Share
                            </button>
                        </div>

                        {/* Scrollable Content Area */}
                        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 32 }}>

                            {/* Context Panel */}
                            <div style={{ padding: '0 0 24px 0' }}>
                                <TeamContextPanel teamId={activeTeam.id} />
                            </div>

                            {/* Notice Board */}
                            <div style={{ paddingBottom: 0 }}>
                                <NoticeBoard teamId={activeTeam.id} />
                            </div>

                            {/* Items Grid */}
                            <div style={{ padding: '0 32px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                    <FontAwesomeIcon icon={faLink} style={{ color: '#60a5fa', opacity: 0.8 }} />
                                    <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 600, margin: 0, color: '#e5e7eb' }}>
                                        Shared Links
                                    </h2>
                                    <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,0.06)' }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                                    {items.map((item, index) => {
                                        if (!item) return null;

                                        // Handle Workspace Reference
                                        if (item.type === 'workspace_ref') {
                                            return (
                                                <div
                                                    key={item.id || index}
                                                    style={{
                                                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)',
                                                        borderRadius: 16, padding: 16,
                                                        border: '1px solid rgba(139, 92, 246, 0.2)',
                                                        position: 'relative', overflow: 'hidden',
                                                        cursor: 'pointer', transition: 'all 0.2s'
                                                    }}
                                                    onClick={() => {
                                                        console.log('Opening workspace:', item.meta);
                                                        if (typeof chrome !== 'undefined' && chrome.runtime) {
                                                            chrome.runtime.sendMessage({
                                                                action: 'OPEN_WORKSPACE',
                                                                workspaceId: item.meta?.workspaceId
                                                            });
                                                        }
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                                        e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.transform = 'none';
                                                        e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.2)';
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                                        <div style={{
                                                            fontSize: 'var(--font-4xl)', width: 40, height: 40, borderRadius: 10,
                                                            background: 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                        }}>
                                                            {item.meta?.icon || '📁'}
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ color: '#a78bfa', fontSize: 'var(--font-xs)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>
                                                                SHARED WORKSPACE
                                                            </div>
                                                            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, color: '#fff' }}>
                                                                {item.meta?.workspaceName || item.title || 'Untitled'}
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                deleteItem(index);
                                                            }}
                                                            style={{
                                                                width: 24, height: 24, borderRadius: 12, border: 'none',
                                                                background: 'rgba(255,255,255,0.1)', color: '#fff',
                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                opacity: 0.6
                                                            }}
                                                        >
                                                            <span style={{ fontSize: 16, lineHeight: 1 }}>×</span>
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                                                        <div style={{ fontSize: 'var(--font-sm)', color: '#a78bfa', background: 'rgba(139, 92, 246, 0.1)', padding: '4px 8px', borderRadius: 6 }}>
                                                            Click to Open
                                                        </div>
                                                        <div style={{ fontSize: 'var(--font-xs)', opacity: 0.4 }}>
                                                            Shared by {item.addedBy || 'Unknown'} • {item.addedAt ? new Date(item.addedAt).toLocaleDateString() : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // Handle Regular Link
                                        let hostname = 'unknown';
                                        try {
                                            if (item.url) hostname = new URL(item.url).hostname;
                                        } catch (e) { console.warn('Invalid URL:', item.url); }

                                        return (
                                            <a
                                                key={item.id || index}
                                                href={item.url || '#'}
                                                target="_blank"
                                                rel="noreferrer"
                                                style={{
                                                    display: 'block', textDecoration: 'none', color: 'inherit',
                                                    background: 'rgba(255,255,255,0.03)', borderRadius: 16,
                                                    padding: 16, border: '1px solid rgba(255,255,255,0.05)',
                                                    transition: 'all 0.2s', position: 'relative'
                                                }}
                                                onMouseEnter={e => {
                                                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                }}
                                                onMouseLeave={e => {
                                                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                                    e.currentTarget.style.transform = 'none';
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                                    <div style={{
                                                        width: 32, height: 32, borderRadius: 8, overflow: 'hidden',
                                                        background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                    }}>
                                                        <img
                                                            src={getFaviconUrl(item.url)}
                                                            alt=""
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: 12, opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {hostname}
                                                        </div>
                                                        <div style={{ fontSize: 11, opacity: 0.3 }}>
                                                            {item.addedAt ? new Date(item.addedAt).toLocaleDateString() : ''}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            deleteItem(index);
                                                        }}
                                                        style={{
                                                            width: 24, height: 24, borderRadius: 12, border: 'none',
                                                            background: 'rgba(255,255,255,0.1)', color: '#fff',
                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            opacity: 0.6
                                                        }}
                                                    >
                                                        <span style={{ fontSize: 'var(--font-xl)', lineHeight: 1 }}>×</span>
                                                    </button>
                                                </div>
                                                <div style={{ fontSize: 'var(--font-base)', fontWeight: 500, lineHeight: 1.4, height: 40, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                    {item.title || item.url || 'Untitled Link'}
                                                </div>
                                            </a>
                                        );
                                    })}
                                </div>

                                {items.length === 0 && (
                                    <div style={{
                                        textAlign: 'center', padding: '60px 20px',
                                        color: 'rgba(255,255,255,0.3)', border: '2px dashed rgba(255,255,255,0.05)',
                                        borderRadius: 16, background: 'rgba(0,0,0,0.1)'
                                    }}>
                                        <div style={{
                                            width: 64, height: 64, borderRadius: 32, background: 'rgba(255,255,255,0.05)',
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16
                                        }}>
                                            <FontAwesomeIcon icon={faLink} size="lg" style={{ opacity: 0.5 }} />
                                        </div>
                                        <div style={{ fontWeight: 500 }}>No shared items yet</div>
                                        <div style={{ fontSize: 'var(--font-sm)', marginTop: 6, opacity: 0.7 }}>Share a tab to start collaborating with your team.</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
            {/* Share Modal */}
            <ShareToTeamModal
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
                initialTeamId={activeTeamId}
            />
        </div>
    );
}
