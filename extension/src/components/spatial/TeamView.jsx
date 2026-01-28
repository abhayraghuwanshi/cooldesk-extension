import { faCheck, faLink, faPencilAlt, faPlus, faShare, faStickyNote, faTimes, faUserPlus, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';
import { p2pSyncService } from '../../services/p2p/syncService';
import { teamManager } from '../../services/p2p/teamManager';
import { getFaviconUrl } from '../../utils/helpers';
import { CreateTeamModal } from '../popups/CreateTeamModal';
import { InviteUserModal } from '../popups/InviteUserModal';
import { ManageMembersModal } from '../popups/ManageMembersModal';
import { PendingRequestsModal } from '../popups/PendingRequestsModal';
import { ReadNoteModal } from '../popups/ReadNoteModal';
import { ShareToTeamModal } from '../popups/ShareToTeamModal';
import NoticeBoard from './NoticeBoard';
import TeamContextPanel from './TeamContextPanel';

import { userProfileService } from '../../services/p2p/userProfileService';

export default function TeamView({ team: propTeam }) {
    const [activeTeamId, setActiveTeamId] = useState(propTeam?.id || null);
    const [teams, setTeams] = useState([]);
    const [items, setItems] = useState([]);
    const [peerCounts, setPeerCounts] = useState(new Map());
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [isReadModalOpen, setIsReadModalOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState(null);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
    const [isPendingRequestsModalOpen, setIsPendingRequestsModalOpen] = useState(false);
    const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [pendingRequests, setPendingRequests] = useState([]);
    const [canWrite, setCanWrite] = useState(false); // State for non-admin writers
    const yArrayRef = useRef(null);
    const renameInputRef = useRef(null);
    const memberObserverRef = useRef(null);

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

    // Listen for join requests (admin only)
    useEffect(() => {
        if (!activeTeamId) return;

        const activeTeam = teams.find(t => t.id === activeTeamId);
        if (!activeTeam || !activeTeam.createdByMe) return; // Only admins listen

        const setupRequestListener = async () => {
            const { p2pStorage } = await import('../../services/p2p/storageService');
            const { p2pSyncService } = await import('../../services/p2p/syncService');
            const { p2pRequestService } = await import('../../services/p2p/requestService');

            // Connect to discovery room - use normalized team name for both roomId and encryption key
            const normalizedTeamName = activeTeam.name.toLowerCase().replace(/\s+/g, '_');
            const discoveryRoomId = `discovery_${normalizedTeamName}`;
            await p2pStorage.initializeTeamStorage(discoveryRoomId);
            // Use normalized name as encryption key to match requesters
            await p2pSyncService.connectTeam(discoveryRoomId, normalizedTeamName);

            console.log('[TeamView] Admin connected to discovery room:', discoveryRoomId);

            // Listen for new requests on discovery room
            const unsubscribe = p2pRequestService.listenForJoinRequests(discoveryRoomId, (request) => {
                console.log('[TeamView] Received join request:', request);
                setPendingRequests(prev => {
                    // Avoid duplicates
                    if (prev.some(r => r.id === request.id)) return prev;
                    return [...prev, request];
                });
            });

            return unsubscribe;
        };

        let cleanup;
        setupRequestListener().then(unsub => { cleanup = unsub; });

        return () => {
            if (cleanup) cleanup();
        };
    }, [activeTeamId, teams]);

    const seedingRef = useRef(new Set()); // Track seeded teams in this session

    // Load items and permissions for the SELECTED team
    useEffect(() => {
        console.log('[TeamView] Active Team changed:', activeTeamId);
        // Reset state
        if (!activeTeamId) {
            setItems([]);
            setCanWrite(false);
            return;
        }

        let observer = null;
        let pArray = null;

        const load = async () => {
            console.log('[TeamView] Initializing storage for:', activeTeamId);
            // We assume storage is initialized (or we init it now)
            await p2pStorage.initializeTeamStorage(activeTeamId);

            // Connect to P2P sync network for this team
            const activeTeam = teams.find(t => t.id === activeTeamId);
            if (activeTeam) {
                await p2pSyncService.connectTeam(activeTeamId, activeTeam.encryptionKey);
                console.log('[TeamView] Connected to P2P sync for team:', activeTeam.name);
            }

            // 1. Data Loading
            pArray = p2pStorage.getSharedItems(activeTeamId);
            yArrayRef.current = pArray;

            const currentItems = pArray.toArray();
            console.log('[TeamView] Loaded items:', currentItems);

            // Cleanup: Remove duplicate NOTE_SHARE items (keep only the most recent)
            const noteShareItems = currentItems.filter(item => item.type === 'NOTE_SHARE');
            const seenNoteIds = new Map(); // noteId -> {index, timestamp}
            const indicesToRemove = [];

            noteShareItems.forEach((item, idx) => {
                const noteId = item.payload?.id;
                if (!noteId) return;

                const actualIndex = currentItems.indexOf(item);
                const existing = seenNoteIds.get(noteId);

                if (existing) {
                    // We've seen this note before - keep the newer one
                    const itemTimestamp = item.timestamp || 0;
                    const existingTimestamp = existing.timestamp || 0;

                    if (itemTimestamp > existingTimestamp) {
                        // Current item is newer, remove the old one
                        indicesToRemove.push(existing.index);
                        seenNoteIds.set(noteId, { index: actualIndex, timestamp: itemTimestamp });
                    } else {
                        // Existing item is newer, remove current one
                        indicesToRemove.push(actualIndex);
                    }
                } else {
                    seenNoteIds.set(noteId, { index: actualIndex, timestamp: item.timestamp || 0 });
                }
            });

            // Remove duplicates in reverse order to maintain indices
            if (indicesToRemove.length > 0) {
                console.log(`[TeamView] Removing ${indicesToRemove.length} duplicate shared notes`);
                indicesToRemove.sort((a, b) => b - a).forEach(index => {
                    pArray.delete(index, 1);
                });
            }

            setItems(pArray.toArray());

            // 2. Permission Loading
            const username = await userProfileService.getUsername();
            try {
                const members = p2pStorage.getSharedMembers(activeTeamId);
                const checkPrivileges = async () => {
                    // 1. If I am Admin (locally validated), I can write
                    const currentTeam = teams.find(t => t.id === activeTeamId);
                    if (currentTeam?.createdByMe) {
                        console.log('[TeamView] User is Admin - granting write access');
                        setCanWrite(true);
                        // Self-healing: Ensure shared state matches
                        const me = members?.get(username);
                        if (me && !me.isAdmin) {
                            console.log('[TeamView] Self-repairing Admin status');
                            p2pStorage.addMemberToTeam(activeTeamId, { name: username, isAdmin: true });
                        }
                        return;
                    }

                    // Non-admin users: check member record
                    const me = members?.get(username);
                    if (!me) {
                        console.log('[TeamView] User not found in members list - no write access');
                        setCanWrite(false);
                        return;
                    }

                    // 2. If I have Writer Status, VERIFY SIGNATURE
                    if (me.isWriter && me.writerSignature) {
                        const publicKey = p2pStorage.getTeamPublicKey(activeTeamId);
                        if (publicKey) {
                            const { cryptoUtils } = await import('../../services/p2p/cryptoUtils');
                            const isValid = cryptoUtils.verify(`WRITER:${username}`, me.writerSignature, publicKey);
                            if (isValid) {
                                console.log('[TeamView] User has valid writer signature - granting write access');
                                setCanWrite(true);
                                return;
                            } else {
                                console.warn('[TeamView] Writer signature invalid! Revoking write access.');
                            }
                        }
                    }

                    // Default to false for viewers/readers
                    console.log('[TeamView] User is viewer/reader - no write access');
                    setCanWrite(false);
                };
                checkPrivileges();

                // Observe member changes (for role updates)
                // We use a simplified observer since we just want to know if *our* role changed
                // (Optimally this should be scoped, but observing the map is fine for now)
                members.observe(() => checkPrivileges());
            } catch (e) {
                console.warn('Failed to load permissions:', e);
            }


            // Observer for Data Changes & Deduping
            observer = () => {
                const updated = pArray.toArray();
                console.log('[TeamView] Observer fired. New items:', updated.length);

                // DATA CONSISTENCY CHECK (Deduping)
                // Identify duplicates by URL
                const uniqueMap = new Map();
                const toDelete = [];

                for (let i = 0; i < updated.length; i++) {
                    const item = updated[i];
                    if (item.type !== 'link' || !item.url) continue;

                    const normalized = item.url.endsWith('/') ? item.url.slice(0, -1) : item.url;

                    if (uniqueMap.has(normalized)) {
                        toDelete.push(i); // Mark this index for deletion
                    } else {
                        uniqueMap.set(normalized, i);
                    }
                }

                if (toDelete.length > 0) {
                    console.log('[TeamView] Auto-cleaning duplicates:', toDelete.length);
                    // Sort descending to remove effectively
                    toDelete.sort((a, b) => b - a);

                    // We must transact to avoid infinite loops, though observer might fire again
                    pArray.doc.transact(() => {
                        toDelete.forEach(idx => pArray.delete(idx, 1));
                    });
                    // Logic ends here; observer will fire again with clean list
                    return;
                }

                setItems(updated);
            };

            pArray.observe(observer);

            // Initial load manual trigger
            observer();
        };
        load();

        return () => {
            if (pArray && observer) pArray.unobserve(observer);
            yArrayRef.current = null;
        };
    }, [activeTeamId, teams]);


    const handleAddItem = () => {
        if (!hasWriteAccess) {
            console.warn('Access denied: You need write permissions to add items.');
            return;
        }
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

    // Helper: Check if I am admin of current team
    const isOwner = teams.find(t => t.id === activeTeamId)?.createdByMe || false;
    // Helper: Check if I have write access (Admin OR Writer)
    const hasWriteAccess = isOwner || canWrite;

    const deleteItem = (index) => {
        if (!hasWriteAccess) {
            console.warn('Access denied: You need write permissions to delete items.');
            return;
        }
        if (yArrayRef.current) yArrayRef.current.delete(index, 1);
    };

    const handleTeamClick = (teamId) => {
        setActiveTeamId(teamId);
        // Optionally set as "global" active team via manager?
        // teamManager.setActiveTeam(teamId); 
    };

    const activeTeam = teams.find(t => t.id === activeTeamId);

    // Start renaming
    const handleStartRename = () => {
        if (activeTeam?.createdByMe) {
            setRenameValue(activeTeam.name);
            setIsRenaming(true);
            setTimeout(() => renameInputRef.current?.focus(), 50);
        }
    };

    // Save renamed team
    const handleSaveRename = async () => {
        if (!renameValue.trim() || !activeTeam) return;
        try {
            await teamManager.renameTeam(activeTeam.id, renameValue.trim());
            setIsRenaming(false);
        } catch (e) {
            console.error('Failed to rename team:', e);
        }
    };

    // Cancel renaming
    const handleCancelRename = () => {
        setIsRenaming(false);
        setRenameValue('');
    };

    // Helper to get member count text (assuming teamManager has this info)
    const getMemberCountText = (teamId) => {
        const team = teamManager.getTeams().find(t => t.id === teamId);
        if (!team || !team.members) return '0 members';
        const count = team.members.length;
        return `${count} member${count !== 1 ? 's' : ''}`;
    };

    return (
        <div style={{
            display: 'flex', height: '100%', color: '#fff',
            borderRadius: 16, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)'
        }}>
            {/* Sidebar */}
            <div className="team-view-sidebar" style={{
                flexShrink: 0,
                borderRight: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', flexDirection: 'column',
                background: 'rgba(0,0,0,0.3)',
                paddingLeft: '4px',
                transition: 'width 0.3s ease'
            }}>
                <div className="sidebar-header" style={{ padding: '16px', fontSize: 'var(--font-2xl)', fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <span className="sidebar-text">Your Spaces</span>
                    <span className="sidebar-icon-only">
                        <FontAwesomeIcon icon={faUsers} />
                    </span>
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
                                    transition: 'all 0.2s',
                                    display: 'flex', flexDirection: 'column', gap: 2,
                                    overflow: 'hidden'
                                }}
                                title={team.name}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 24, height: 24, borderRadius: 6,
                                        background: isActive ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 'var(--font-xs)', fontWeight: 700, flexShrink: 0,
                                        color: isActive ? '#fff' : '#e2e8f0'
                                    }}>
                                        {team.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="sidebar-text" style={{
                                        fontSize: 'var(--font-sm)', fontWeight: 600,
                                        color: isActive ? '#fff' : '#e2e8f0',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        {team.name}
                                    </div>
                                </div>
                                <div className="sidebar-text" style={{ fontSize: 'var(--font-xs)', color: isActive ? '#bfdbfe' : '#cbd5e1', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: count > 0 ? '#4ade80' : '#94a3b8',
                                        boxShadow: count > 0 ? '0 0 6px #4ade80' : 'none'
                                    }} />
                                    {count} peer{count !== 1 ? 's' : ''}
                                </div>
                            </div>
                        );
                    })}
                    {teams.length === 0 && (
                        <div style={{ padding: 16, fontSize: 'var(--font-sm)', opacity: 0.5 }}>
                            <span className="sidebar-text">No teams yet. Create one in Settings.</span>
                        </div>
                    )}
                </div>
                {/* Create Team Button */}
                <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button
                        onClick={() => setIsCreateTeamModalOpen(true)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: 8,
                            background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)',
                            color: '#60a5fa', fontSize: 'var(--font-sm)', fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            transition: 'all 0.2s',
                            whiteSpace: 'nowrap', overflow: 'hidden'
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                            e.currentTarget.style.transform = 'none';
                        }}
                        title="Create Team"
                    >
                        <FontAwesomeIcon icon={faPlus} />
                        <span className="sidebar-text">Create/Join</span>
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="team-view-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {!activeTeam ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, flexDirection: 'column', gap: 16 }}>
                        <FontAwesomeIcon icon={faUsers} size="3x" />
                        <div>Select a space or join a space</div>
                    </div>
                ) : (
                    <>
                        {/* Team Header */}
                        <div style={{
                            padding: '16px 20px',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            flexWrap: 'wrap', gap: '12px'
                        }}>
                            <div>
                                {isRenaming ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input
                                            ref={renameInputRef}
                                            type="text"
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveRename();
                                                if (e.key === 'Escape') handleCancelRename();
                                            }}
                                            style={{
                                                fontSize: 'var(--font-2xl)', fontWeight: 700,
                                                background: 'rgba(255,255,255,0.1)',
                                                border: '1px solid rgba(59, 130, 246, 0.5)',
                                                borderRadius: 8, padding: '4px 12px',
                                                color: '#fff', outline: 'none',
                                                minWidth: 150, width: '100%'
                                            }}
                                        />
                                        <button
                                            onClick={handleSaveRename}
                                            style={{
                                                width: 32, height: 32, borderRadius: 8, border: 'none',
                                                background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Save"
                                        >
                                            <FontAwesomeIcon icon={faCheck} />
                                        </button>
                                        <button
                                            onClick={handleCancelRename}
                                            style={{
                                                width: 32, height: 32, borderRadius: 8, border: 'none',
                                                background: 'rgba(239, 68, 68, 0.2)', color: '#f87171',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Cancel"
                                        >
                                            <FontAwesomeIcon icon={faTimes} />
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <h1 style={{ margin: 0, fontSize: 'var(--font-3xl)', fontWeight: 700 }}>{activeTeam.name}</h1>
                                        {activeTeam.createdByMe && (
                                            <>
                                                <div style={{
                                                    fontSize: 'var(--font-xs)', fontWeight: 800,
                                                    background: '#ef4444', color: '#fff',
                                                    padding: '4px 8px', borderRadius: 4,
                                                    letterSpacing: '0.05em', textTransform: 'uppercase'
                                                }}>
                                                    ADMIN
                                                </div>
                                                <button
                                                    onClick={handleStartRename}
                                                    style={{
                                                        width: 28, height: 28, borderRadius: 6, border: 'none',
                                                        background: 'rgba(255,255,255,0.1)', color: '#9ca3af',
                                                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        transition: 'all 0.2s'
                                                    }}
                                                    title="Rename team"
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                                                        e.currentTarget.style.color = '#60a5fa';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                                                        e.currentTarget.style.color = '#9ca3af';
                                                    }}
                                                >
                                                    <FontAwesomeIcon icon={faPencilAlt} size="sm" />
                                                </button>
                                            </>
                                        )}
                                        {((!activeTeam.createdByMe && canWrite) || (!activeTeam.createdByMe && !canWrite)) && (
                                            <div style={{
                                                fontSize: 'var(--font-xs)', fontWeight: 800,
                                                background: canWrite ? '#10b981' : 'rgba(148, 163, 184, 0.2)',
                                                color: canWrite ? '#fff' : '#94a3b8',
                                                border: canWrite ? 'none' : '1px solid rgba(148, 163, 184, 0.2)',
                                                padding: '4px 8px', borderRadius: 4,
                                                letterSpacing: '0.05em', textTransform: 'uppercase'
                                            }}>
                                                {canWrite ? 'WRITER' : 'VIEWER'}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div style={{ fontSize: 'var(--font-sm)', opacity: 0.5, marginTop: 4 }}>
                                    {getMemberCountText(activeTeam.id)} • {peerCounts.get(activeTeam.id) || 0} active peers connected
                                </div>
                            </div>
                            <div className="team-header-actions">
                                {isOwner && (
                                    <>
                                        <button
                                            onClick={() => setIsPendingRequestsModalOpen(true)}
                                            className="header-button"
                                            style={{ position: 'relative' }}
                                            title="Join Requests"
                                        >
                                            <FontAwesomeIcon icon={faUserPlus} />
                                            Requests
                                            {pendingRequests.length > 0 && (
                                                <span style={{
                                                    position: 'absolute', top: -4, right: -4,
                                                    background: '#ef4444', color: '#fff',
                                                    fontSize: 'var(--font-xs)', fontWeight: 700,
                                                    padding: '2px 6px', borderRadius: 10,
                                                    minWidth: 18, textAlign: 'center'
                                                }}>
                                                    {pendingRequests.length}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setIsMembersModalOpen(true)}
                                            className="header-button icon-only"
                                            title="Manage Members"
                                        >
                                            <FontAwesomeIcon icon={faUsers} />
                                        </button>
                                    </>
                                )}
                                {hasWriteAccess && (
                                    <button
                                        onClick={() => setIsShareModalOpen(true)}
                                        className="header-button primary"
                                    >
                                        <FontAwesomeIcon icon={faShare} />
                                        Share
                                    </button>
                                )}
                                {isOwner && items.length > 0 && (
                                    <button
                                        onClick={() => {
                                            if (confirm('Are you sure you want to clear ALL shared links/workspaces from this team? This cannot be undone.')) {
                                                const doc = p2pStorage.getDoc(activeTeamId);
                                                if (doc) {
                                                    const array = doc.getArray('shared-items');
                                                    doc.transact(() => {
                                                        array.delete(0, array.length);
                                                    });
                                                }
                                            }
                                        }}
                                        className="header-button danger"
                                        title="Clear All Items"
                                    >
                                        <FontAwesomeIcon icon={faTimes} />
                                        Clear Space
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Scrollable Content Area */}
                        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 32 }}>

                            {/* Context Panel */}
                            <div style={{ padding: '0 0 24px 0' }}>
                                <TeamContextPanel teamId={activeTeam.id} canWrite={hasWriteAccess} />
                            </div>

                            {/* Notice Board */}
                            <div style={{ paddingBottom: 0 }}>
                                <NoticeBoard teamId={activeTeam.id} canWrite={hasWriteAccess} />
                            </div>

                            {/* Items Grid */}
                            <div style={{ padding: '0 20px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                    <FontAwesomeIcon icon={faLink} style={{ color: '#60a5fa', opacity: 0.8 }} />
                                    <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 600, margin: 0, color: '#e5e7eb' }}>
                                        Shared Links
                                    </h2>
                                    <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,0.06)' }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                    {(() => {
                                        // RENDER-TIME DEDUPLICATION
                                        const seenUrls = new Set();

                                        return items.map((item, index) => {
                                            if (!item) return null;

                                            // Skip Notes (handled in separate grid)
                                            if (item.type === 'NOTE_SHARE') return null;

                                            // Dedup Logic
                                            if (item.type === 'link' && item.url) {
                                                const normalized = item.url.endsWith('/') ? item.url.slice(0, -1) : item.url;
                                                if (seenUrls.has(normalized)) return null;
                                                seenUrls.add(normalized);
                                            }

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
                                                            {hasWriteAccess && (
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
                                                                    <span style={{ fontSize: 'var(--font-xl)', lineHeight: 1 }}>×</span>
                                                                </button>
                                                            )}
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
                                                            <div style={{ fontSize: 'var(--font-sm)', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {hostname}
                                                            </div>
                                                            <div style={{ fontSize: 'var(--font-xs)', opacity: 0.3 }}>
                                                                {item.addedAt ? new Date(item.addedAt).toLocaleDateString() : ''}
                                                            </div>
                                                        </div>
                                                        {hasWriteAccess && (
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
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 'var(--font-base)', fontWeight: 500, lineHeight: 1.4, height: 40, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                        {item.title || item.url || 'Untitled Link'}
                                                    </div>
                                                </a>
                                            );
                                        });
                                    })()}
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

                            {/* Shared Notes Grid */}
                            <div style={{ padding: '0 20px', marginTop: 32 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                    <FontAwesomeIcon icon={faStickyNote} style={{ color: '#f472b6', opacity: 0.8 }} />
                                    <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 600, margin: 0, color: '#e5e7eb' }}>
                                        Shared Notes
                                    </h2>
                                    <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,0.06)' }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                    {(() => {
                                        const seenNotes = new Set();
                                        const notes = items.filter(i => i.type === 'NOTE_SHARE');

                                        if (notes.length === 0) return (
                                            <div style={{
                                                gridColumn: '1 / -1',
                                                textAlign: 'center', padding: '40px 20px',
                                                color: 'rgba(255,255,255,0.3)', border: '2px dashed rgba(255,255,255,0.05)',
                                                borderRadius: 16, background: 'rgba(0,0,0,0.1)'
                                            }}>
                                                <div style={{ fontSize: 'var(--font-sm)', opacity: 0.7 }}>No notes shared yet.</div>
                                            </div>
                                        );

                                        return notes.map((item, index) => {
                                            // Deduplication Logic
                                            const noteId = item.payload?.id;
                                            if (noteId) {
                                                if (seenNotes.has(noteId)) return null;
                                                seenNotes.add(noteId);
                                            } else {
                                                // Fallback for older/malformed notes: prevent exact duplicate objects
                                                const uniqueKey = item.id;
                                                if (seenNotes.has(uniqueKey)) return null;
                                                seenNotes.add(uniqueKey);
                                            }

                                            return (
                                                <div
                                                    key={item.id || index}
                                                    onClick={() => {
                                                        setSelectedNote(item);
                                                        setIsReadModalOpen(true);
                                                    }}
                                                    style={{
                                                        background: 'linear-gradient(135deg, rgba(244, 114, 182, 0.1) 0%, rgba(244, 114, 182, 0.05) 100%)',
                                                        borderRadius: 16, padding: 16,
                                                        border: '1px solid rgba(244, 114, 182, 0.2)',
                                                        position: 'relative', overflow: 'hidden',
                                                        transition: 'all 0.2s',
                                                        display: 'flex', flexDirection: 'column', gap: 12
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8 }}>
                                                        <div style={{
                                                            fontSize: 'var(--font-lg)', fontWeight: 600, color: '#fff',
                                                            lineHeight: 1.4,
                                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                                        }}>
                                                            {item.payload?.title || 'Untitled Note'}
                                                        </div>
                                                        {hasWriteAccess && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const realIndex = items.findIndex(i => i === item);
                                                                    if (realIndex !== -1) deleteItem(realIndex);
                                                                }}
                                                                style={{
                                                                    width: 24, height: 24, borderRadius: 12, border: 'none',
                                                                    background: 'rgba(255,255,255,0.1)', color: '#fff',
                                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    opacity: 0.6, flexShrink: 0
                                                                }}
                                                            >
                                                                <span style={{ fontSize: 'var(--font-xl)', lineHeight: 1 }}>×</span>
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div style={{
                                                        fontSize: 'var(--font-sm)', color: 'rgba(255,255,255,0.6)',
                                                        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                        fontStyle: 'italic'
                                                    }}>
                                                        {item.payload?.text?.replace(/<[^>]*>/g, '').substring(0, 100) || 'No preview available'}
                                                    </div>

                                                    <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-xs)', opacity: 0.5 }}>
                                                        <span>{item.addedBy || 'Unknown'}</span>
                                                        <span>{item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'Just now'}</span>
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>
                        </div>
                    </>
                )}
                {/* Share Modal */}
                <ShareToTeamModal
                    isOpen={isShareModalOpen}
                    onClose={() => setIsShareModalOpen(false)}
                    initialTeamId={activeTeamId}
                />
                {/* Read Note Modal */}
                <ReadNoteModal
                    isOpen={isReadModalOpen}
                    onClose={() => setIsReadModalOpen(false)}
                    note={selectedNote}
                />
                {/* Invite Modal */}
                <InviteUserModal
                    isOpen={isInviteModalOpen}
                    onClose={() => setIsInviteModalOpen(false)}
                    team={activeTeam ? { name: activeTeam.name, secretPhrase: activeTeam.secretPhrase } : null}
                />
                {/* Create Team Modal */}
                <CreateTeamModal
                    isOpen={isCreateTeamModalOpen}
                    onClose={() => setIsCreateTeamModalOpen(false)}
                />
                {/* Manage Members Modal */}
                <ManageMembersModal
                    isOpen={isMembersModalOpen}
                    onClose={() => setIsMembersModalOpen(false)}
                    teamId={activeTeamId}
                />
                {/* Pending Requests Modal */}
                <PendingRequestsModal
                    isOpen={isPendingRequestsModalOpen}
                    onClose={() => setIsPendingRequestsModalOpen(false)}
                    teamId={activeTeamId}
                    requests={pendingRequests}
                    onRequestProcessed={(requestId) => {
                        setPendingRequests(prev => prev.filter(r => r.id !== requestId));
                    }}
                />
            </div>
        </div>
    );
}

const style = document.createElement('style');
style.textContent = `
            .team-view-sidebar {
                width: 200px;
    }
            .sidebar-icon-only {
                display: none;
    }
            .sidebar-text {
                display: inline;
                font-size: var(--font-2xl);
    }

            @media (max-width: 800px) {
        .team - view - sidebar {
                width: 72px;
        }
            .sidebar-text {
                display: none !important;
        }
            .sidebar-icon-only {
                display: block;
            text-align: center;
        }
            /* Center icons when collapsed */
            .team-view-sidebar .sidebar-header {
                text - align: center;
            padding: 16px 0 !important;
        }
    }
            `;
document.head.appendChild(style);
