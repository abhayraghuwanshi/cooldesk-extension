import { faArrowRight, faCheck, faHourglass, faPlus, faSignInAlt, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { teamManager } from '../../services/p2p/teamManager';

export function CreateTeamModal({ isOpen, onClose }) {
    const [mode, setMode] = useState('create'); // 'create' or 'join'
    const [teamName, setTeamName] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [generatedSecret, setGeneratedSecret] = useState('');

    if (!isOpen) return null;

    const generateSecret = () => {
        // Generate a CD-key style secret: XXXX-XXXX-XXXX-XXXX
        // Using alphanumeric characters (excluding ambiguous ones like 0, O, I, l)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed 0, O, I, 1 for clarity
        const segments = 4;
        const segmentLength = 4;

        const parts = [];
        for (let i = 0; i < segments; i++) {
            let segment = '';
            for (let j = 0; j < segmentLength; j++) {
                segment += chars[Math.floor(Math.random() * chars.length)];
            }
            parts.push(segment);
        }

        return parts.join('-');
    };

    const handleCreateTeam = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!teamName.trim()) {
            setError('Please enter a team name.');
            return;
        }

        setIsLoading(true);
        try {
            // Auto-generate secret
            const secret = generateSecret();
            setGeneratedSecret(secret);

            // Create team
            await teamManager.addTeam(teamName.trim(), secret);

            setSuccess(`Team "${teamName}" created! Share the team name with others to let them request to join.`);
            setTeamName('');

            // Close after 2 seconds
            setTimeout(() => {
                onClose();
                setSuccess('');
                setGeneratedSecret('');
            }, 2000);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleJoinRequest = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!teamName.trim()) {
            setError('Please enter the team name.');
            return;
        }

        setIsLoading(true);
        try {
            // Generate team ID from name (same way as when creating)
            // Note: We don't have the secret, so we use a discovery mechanism
            // For now, we'll use a hash of just the team name for discovery
            const teamId = `team_${teamName.trim().toLowerCase().replace(/\s+/g, '_')}`;

            // Import request service
            const { p2pRequestService } = await import('../../services/p2p/requestService');

            // Send join request
            await p2pRequestService.sendJoinRequest(teamName.trim(), teamId);

            setSuccess(`Join request sent to "${teamName}"! Waiting for admin approval...`);

            // Listen for approval
            const unsubscribe = p2pRequestService.listenForApproval(async (response) => {
                if (response.type === 'approved' && response.data.teamName === teamName.trim()) {
                    const approval = response.data;

                    // Auto-join the team with the provided secret
                    const { teamManager } = await import('../../services/p2p/teamManager');
                    await teamManager.addTeam(approval.teamName, approval.teamSecret);

                    setSuccess(`✓ Approved as ${approval.role === 'writer' ? 'Writer' : 'Viewer'}! Joining team...`);

                    // Close modal after success
                    setTimeout(() => {
                        unsubscribe();
                        onClose();
                    }, 1500);
                } else if (response.type === 'denied' && response.data.teamName === teamName.trim()) {
                    setError('Your join request was denied by the admin.');
                    unsubscribe();
                }
            });

        } catch (err) {
            setError(err.message || 'Failed to send join request');
        } finally {
            setIsLoading(false);
        }
    };

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
                color: '#fff'
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
                            background: mode === 'create' ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: mode === 'create' ? '0 4px 6px -1px rgba(59, 130, 246, 0.3)' : '0 4px 6px -1px rgba(16, 185, 129, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={mode === 'create' ? faPlus : faSignInAlt} style={{ color: '#fff', fontSize: 16 }} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                                {mode === 'create' ? 'Create Team' : 'Join Team'}
                            </h3>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                {mode === 'create' ? 'Start your own team' : 'Request to join a team'}
                            </div>
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

                {/* Mode Toggle */}
                <div style={{ padding: '16px 24px 0 24px' }}>
                    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 12 }}>
                        <button
                            onClick={() => { setMode('create'); setError(''); setSuccess(''); }}
                            style={{
                                flex: 1, padding: '10px', borderRadius: 8,
                                background: mode === 'create' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                color: mode === 'create' ? '#60a5fa' : '#94a3b8',
                                border: '1px solid',
                                borderColor: mode === 'create' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                            }}
                        >
                            <FontAwesomeIcon icon={faPlus} />
                            Create
                        </button>
                        <button
                            onClick={() => { setMode('join'); setError(''); setSuccess(''); }}
                            style={{
                                flex: 1, padding: '10px', borderRadius: 8,
                                background: mode === 'join' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                                color: mode === 'join' ? '#34d399' : '#94a3b8',
                                border: '1px solid',
                                borderColor: mode === 'join' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                            }}
                        >
                            <FontAwesomeIcon icon={faSignInAlt} />
                            Join
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: 24 }}>
                    <form onSubmit={mode === 'create' ? handleCreateTeam : handleJoinRequest} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                        {/* Info Box */}
                        <div style={{
                            background: mode === 'create' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                            border: `1px solid ${mode === 'create' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
                            borderRadius: 12, padding: 12
                        }}>
                            <div style={{ fontSize: 13, color: mode === 'create' ? '#bfdbfe' : '#a7f3d0', lineHeight: 1.5 }}>
                                {mode === 'create' ? (
                                    <>
                                        <strong>Creating a team:</strong> Just enter a name. The secret is auto-generated. Share the team name with others so they can request to join!
                                    </>
                                ) : (
                                    <>
                                        <strong>Joining a team:</strong> Enter the team name and send a join request. The admin will approve and assign your role.
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Team Name Input */}
                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 8 }}>
                                TEAM NAME
                            </label>
                            <input
                                type="text"
                                value={teamName}
                                onChange={e => setTeamName(e.target.value)}
                                placeholder={mode === 'create' ? 'e.g. Work Squad' : 'Enter team name'}
                                disabled={isLoading}
                                style={{
                                    width: '100%', padding: '12px 16px', borderRadius: 10,
                                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 14, outline: 'none',
                                    transition: 'border-color 0.2s'
                                }}
                                onFocus={e => e.target.style.borderColor = mode === 'create' ? '#3b82f6' : '#10b981'}
                                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                            />
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div style={{
                                padding: '10px 14px', borderRadius: 8,
                                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                                color: '#f87171', fontSize: 13
                            }}>
                                {error}
                            </div>
                        )}

                        {/* Success Message */}
                        {success && (
                            <div style={{
                                padding: '10px 14px', borderRadius: 8,
                                background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                                color: '#34d399', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8
                            }}>
                                <FontAwesomeIcon icon={faCheck} />
                                {success}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isLoading}
                                style={{
                                    flex: 1, padding: '12px', borderRadius: 10,
                                    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer',
                                    fontSize: 14, opacity: isLoading ? 0.5 : 1
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isLoading}
                                style={{
                                    flex: 2, padding: '12px', borderRadius: 10,
                                    background: mode === 'create' ? '#3b82f6' : '#10b981',
                                    border: 'none',
                                    color: '#fff', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer',
                                    fontSize: 14,
                                    boxShadow: mode === 'create' ? '0 4px 12px rgba(59, 130, 246, 0.3)' : '0 4px 12px rgba(16, 185, 129, 0.3)',
                                    opacity: isLoading ? 0.7 : 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                                }}
                            >
                                {isLoading ? (
                                    <>
                                        <FontAwesomeIcon icon={faHourglass} spin />
                                        {mode === 'create' ? 'Creating...' : 'Sending...'}
                                    </>
                                ) : (
                                    <>
                                        {mode === 'create' ? 'Create Team' : 'Send Request'}
                                        <FontAwesomeIcon icon={faArrowRight} />
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
