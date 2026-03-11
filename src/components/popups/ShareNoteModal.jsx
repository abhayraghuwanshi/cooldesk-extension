import { faCheckCircle, faChevronDown, faShare, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';
import { teamManager } from '../../services/p2p/teamManager';

export function ShareNoteModal({ isOpen, onClose, note, activeTeamId }) {
    const [teams, setTeams] = useState([]);
    const [selectedTeamId, setSelectedTeamId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');

    useEffect(() => {
        if (isOpen) {
            teamManager.init().then(() => {
                const allTeams = teamManager.getTeams();
                setTeams(allTeams);

                // Prioritize activeTeamId, else first team
                if (activeTeamId && allTeams.find(t => t.id === activeTeamId)) {
                    setSelectedTeamId(activeTeamId);
                } else if (allTeams.length > 0) {
                    setSelectedTeamId(allTeams[0].id);
                }
            });
        }
    }, [isOpen, activeTeamId]);

    const handleShare = async () => {
        if (!selectedTeamId || !note) return;
        setLoading(true);

        try {
            const team = teams.find(t => t.id === selectedTeamId);
            const teamName = team ? team.name : 'Team';

            // Check if this note has already been shared to this team
            const existingItems = await p2pStorage.getTeamItems(selectedTeamId);
            const alreadyShared = existingItems?.find(item =>
                item.type === 'NOTE_SHARE' &&
                item.payload?.id === note.id
            );

            if (alreadyShared) {
                // Update the existing share instead of creating a duplicate
                await p2pStorage.updateItemInTeam(selectedTeamId, alreadyShared.id, {
                    ...alreadyShared,
                    payload: {
                        ...note,
                        title: note.title || 'Untitled Note'
                    },
                    timestamp: Date.now(),
                    sender: 'Me'
                });
                setSuccessMsg(`Updated in ${teamName}!`);
            } else {
                // Create new share
                await p2pStorage.addItemToTeam(selectedTeamId, {
                    type: 'NOTE_SHARE',
                    payload: {
                        ...note,
                        title: note.title || 'Untitled Note'
                    },
                    timestamp: Date.now(),
                    sender: 'Me'
                });
                setSuccessMsg(`Shared to ${teamName}!`);
            }

            setTimeout(() => {
                setSuccessMsg('');
                onClose();
            }, 1500);
        } catch (err) {
            console.error('Share failed:', err);
            alert('Failed to share note. Please check connection.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif"
        }} onClick={onClose}>
            <div style={{
                width: 400, background: '#0f172a', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex', flexDirection: 'column'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: 'linear-gradient(to right, rgba(255,255,255,0.02), transparent)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 6px -1px rgba(139, 92, 246, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faShare} style={{ color: '#fff', fontSize: 14 }} />
                        </div>
                        <h3 style={{ margin: 0, color: '#fff', fontSize: 16, fontWeight: 600 }}>Share Note</h3>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'transparent', border: 'none',
                        color: '#94a3b8', cursor: 'pointer', padding: 4
                    }}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* Note Preview */}
                    <div style={{
                        padding: 12, borderRadius: 12,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.05)'
                    }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                            Sharing
                        </div>
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                            {note?.title || 'Untitled Note'}
                        </div>
                    </div>

                    {/* Team Selector */}
                    <div>
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
                        {teams.length === 0 && (
                            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>
                                You are not a member of any teams.
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', justifyContent: 'flex-end', gap: 12,
                    background: '#1e293b'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 16px', borderRadius: 10,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#94a3b8', fontSize: 13, fontWeight: 500, cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={loading || !selectedTeamId}
                        style={{
                            padding: '10px 24px', borderRadius: 10,
                            background: successMsg ? '#10b981' : 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                            border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                            opacity: (loading || !selectedTeamId) ? 0.5 : 1
                        }}
                    >
                        {successMsg ? (
                            <>
                                <FontAwesomeIcon icon={faCheckCircle} />
                                <span>Shared!</span>
                            </>
                        ) : (
                            <span>{loading ? 'Sharing...' : 'Share Note'}</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
