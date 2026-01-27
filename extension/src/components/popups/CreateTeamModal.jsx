import { faArrowRight, faCheck, faCopy, faHourglass, faLink, faPlus, faSignInAlt, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { teamManager } from '../../services/p2p/teamManager';

export function CreateTeamModal({ isOpen, onClose, initialTeamName = '', initialMode = 'create' }) {
    const [mode, setMode] = useState(initialMode); // 'create' or 'join'
    const [teamName, setTeamName] = useState(initialTeamName);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [generatedSecret, setGeneratedSecret] = useState('');
    const [shareLink, setShareLink] = useState('');
    const [linkCopied, setLinkCopied] = useState(false);

    // Update state when props change (for deep link handling)
    useEffect(() => {
        if (initialTeamName) {
            setTeamName(initialTeamName);
            setMode('join');
        }
    }, [initialTeamName]);

    if (!isOpen) return null;

    // Generate shareable invite code (simple base64 encoded team name)
    const generateShareLink = (teamNameStr) => {
        const encoded = btoa(teamNameStr.trim());
        return `cooldesk-invite:${encoded}`;
    };

    // Parse invite code if pasted in team name field
    const handleTeamNameChange = (value) => {
        // Check if it's an invite code
        if (value.startsWith('cooldesk-invite:')) {
            try {
                const encoded = value.replace('cooldesk-invite:', '');
                const decoded = atob(encoded);
                setTeamName(decoded);
                // Auto-switch to join mode if pasting an invite
                if (mode === 'create') {
                    setMode('join');
                }
                return;
            } catch (e) {
                // Not a valid invite code, use as-is
            }
        }
        setTeamName(value);
    };

    const copyShareLink = async () => {
        try {
            await navigator.clipboard.writeText(shareLink);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy link:', err);
        }
    };

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

            // Generate share link
            const link = generateShareLink(teamName);
            setShareLink(link);

            setSuccess(`Team "${teamName}" created! Share the invite link with others to let them request to join.`);
            // Don't clear teamName so the share link section can use it
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
            // Use the discovery room ID format that matches requestService.js
            const discoveryRoomId = `discovery_${teamName.trim().toLowerCase().replace(/\s+/g, '_')}`;

            // Import request service
            const { p2pRequestService } = await import('../../services/p2p/requestService');

            // Send join request to the discovery room
            await p2pRequestService.sendJoinRequest(teamName.trim(), discoveryRoomId);

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
                                        <strong>Creating a team:</strong> Just enter a name. You'll get an invite code to share with teammates!
                                    </>
                                ) : (
                                    <>
                                        <strong>Joining a team:</strong> Paste the invite code or enter the team name. The admin will approve your request.
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
                                onChange={e => handleTeamNameChange(e.target.value)}
                                placeholder={mode === 'create' ? 'e.g. Work Squad' : 'Enter team name or paste invite code'}
                                disabled={isLoading || (shareLink && mode === 'create')}
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

                        {/* Share Link Section - Only show after team creation */}
                        {shareLink && mode === 'create' && (
                            <div style={{
                                background: 'rgba(139, 92, 246, 0.1)',
                                border: '1px solid rgba(139, 92, 246, 0.2)',
                                borderRadius: 12, padding: 16
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    marginBottom: 12, color: '#a78bfa', fontSize: 13, fontWeight: 600
                                }}>
                                    <FontAwesomeIcon icon={faLink} />
                                    Invite Link
                                </div>
                                <div style={{
                                    display: 'flex', gap: 8, alignItems: 'center'
                                }}>
                                    <input
                                        type="text"
                                        value={shareLink}
                                        readOnly
                                        style={{
                                            flex: 1, padding: '10px 12px', borderRadius: 8,
                                            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139, 92, 246, 0.3)',
                                            color: '#e9d5ff', fontSize: 12, outline: 'none',
                                            fontFamily: 'monospace'
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={copyShareLink}
                                        style={{
                                            padding: '10px 16px', borderRadius: 8,
                                            background: linkCopied ? '#10b981' : '#8b5cf6',
                                            border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                            transition: 'background 0.2s',
                                            minWidth: 90
                                        }}
                                    >
                                        <FontAwesomeIcon icon={linkCopied ? faCheck : faCopy} />
                                        {linkCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <div style={{
                                    marginTop: 10, fontSize: 11, color: '#94a3b8', lineHeight: 1.4
                                }}>
                                    Share this link with teammates. When they click it, they'll be able to request to join your team.
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                            {shareLink && mode === 'create' ? (
                                /* Show Done button after team is created */
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        setSuccess('');
                                        setShareLink('');
                                        setTeamName('');
                                        setGeneratedSecret('');
                                    }}
                                    style={{
                                        flex: 1, padding: '12px', borderRadius: 10,
                                        background: '#10b981',
                                        border: 'none',
                                        color: '#fff', fontWeight: 600, cursor: 'pointer',
                                        fontSize: 14,
                                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                                    }}
                                >
                                    <FontAwesomeIcon icon={faCheck} />
                                    Done
                                </button>
                            ) : (
                                <>
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
                                </>
                            )}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
