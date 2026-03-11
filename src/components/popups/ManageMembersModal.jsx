
import { faCrown, faPen, faTimes, faUser, faUserCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { p2pStorage } from '../../services/p2p/storageService';
import { userProfileService } from '../../services/p2p/userProfileService';

export function ManageMembersModal({ isOpen, onClose, teamId }) {
    const [members, setMembers] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        if (!isOpen || !teamId) return;

        const loadMembers = async () => {
            try {
                const username = await userProfileService.getUsername();
                setCurrentUser(username);

                const membersMap = p2pStorage.getSharedMembers(teamId);

                // Check if I am admin
                const myMember = membersMap.get(username);
                setIsAdmin(!!myMember?.isAdmin);
                const updateList = () => {
                    const list = [];
                    membersMap.forEach((val, key) => {
                        list.push({ ...val, key });
                    });
                    // Sort: Admin first, then Writers, then Viewers, then alphabetical
                    list.sort((a, b) => {
                        if (a.isAdmin !== b.isAdmin) return b.isAdmin ? 1 : -1;
                        if (a.isWriter !== b.isWriter) return b.isWriter ? 1 : -1;
                        return a.name.localeCompare(b.name);
                    });
                    setMembers(list);
                };

                updateList();
                membersMap.observe(() => updateList());

            } catch (e) {
                console.error('Failed to load members:', e);
            }
        };

        loadMembers();

    }, [isOpen, teamId]);

    const handleToggleWriter = async (member) => {
        if (member.isAdmin) return; // Admins are always writers

        // Get our local keys to sign the permission
        const { teamManager } = await import('../../services/p2p/teamManager');
        const team = teamManager.getTeam(teamId);

        await p2pStorage.toggleMemberWriterStatus(teamId, member.key, {
            privateKey: team?.adminPrivateKey,
            publicKey: team?.adminPublicKey
        });
    };

    if (!isOpen || !teamId) return null;

    const modalContent = (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif"
        }} onClick={onClose}>
            <div style={{
                width: 500, maxWidth: '90vw', background: '#1e293b', borderRadius: 24,
                border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                color: '#fff', display: 'flex', flexDirection: 'column', maxHeight: '80vh'
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
                            <FontAwesomeIcon icon={faUserCheck} style={{ color: '#fff', fontSize: 16 }} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Manage Members</h3>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>{members.length} members</div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.05)', border: 'none',
                        width: 32, height: 32, borderRadius: 16,
                        color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '0 24px', overflowY: 'auto', flex: 1 }}>
                    <div style={{ padding: '24px 0' }}>
                        {members.map(member => (
                            <div key={member.key} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px', marginBottom: 8, borderRadius: 12,
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: 16,
                                        background: member.color || `hsl(${Math.abs(member.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 70%, 50%)`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 14, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                    }}>
                                        {member.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {member.name}
                                            {member.name === currentUser && <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>YOU</span>}
                                        </div>
                                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                            Full Access Member
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {member.isAdmin ? (
                                        <div style={{
                                            padding: '4px 10px', borderRadius: 6, background: 'rgba(239, 68, 68, 0.1)',
                                            color: '#ef4444', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                                            display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(239, 68, 68, 0.2)'
                                        }}>
                                            <FontAwesomeIcon icon={faCrown} size="xs" />
                                            Admin
                                        </div>
                                    ) : (
                                        isAdmin && ( // Only show toggle if WE are the admin
                                            <button
                                                onClick={() => handleToggleWriter(member)}
                                                style={{
                                                    padding: '6px 12px', borderRadius: 8, border: 'none',
                                                    background: member.isWriter ? 'rgba(16, 185, 129, 0.1)' : 'rgba(148, 163, 184, 0.1)',
                                                    color: member.isWriter ? '#34d399' : '#94a3b8',
                                                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                    transition: 'all 0.2s'
                                                }}
                                                title="Toggle Writer Access"
                                            >
                                                {member.isWriter ? (
                                                    <>
                                                        <FontAwesomeIcon icon={faPen} />
                                                        Writer
                                                    </>
                                                ) : (
                                                    <>
                                                        <FontAwesomeIcon icon={faUser} />
                                                        Viewer
                                                    </>
                                                )}
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
