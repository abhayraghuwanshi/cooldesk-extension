import { faCheck, faTimes, faUserCheck, faUserPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { createPortal } from 'react-dom';

export function PendingRequestsModal({ isOpen, onClose, teamId, requests = [], onRequestProcessed }) {
    const [processingRequest, setProcessingRequest] = useState(null);
    const [selectedRoles, setSelectedRoles] = useState({});

    if (!isOpen || !teamId) return null;

    const handleApprove = async (request) => {
        setProcessingRequest(request.id);
        try {
            const role = selectedRoles[request.id] || 'viewer';

            // Get team data
            const { teamManager } = await import('../../services/p2p/teamManager');
            const team = teamManager.getTeam(teamId);

            if (!team) {
                throw new Error('Team not found');
            }

            // Import request service
            const { p2pRequestService } = await import('../../services/p2p/requestService');

            // Approve the request
            await p2pRequestService.approveJoinRequest(teamId, request, role, {
                secretPhrase: team.secretPhrase,
                adminPrivateKey: team.adminPrivateKey,
                adminPublicKey: team.adminPublicKey
            });

            console.log(`Approved ${request.username} as ${role}`);

            // Remove from local pending list
            if (onRequestProcessed) {
                onRequestProcessed(request.id);
            }
        } catch (error) {
            console.error('Failed to approve request:', error);
            alert(`Failed to approve: ${error.message}`);
        } finally {
            setProcessingRequest(null);
        }
    };

    const handleDeny = async (request) => {
        setProcessingRequest(request.id);
        try {
            // Import request service
            const { p2pRequestService } = await import('../../services/p2p/requestService');

            // Deny the request
            await p2pRequestService.denyJoinRequest(teamId, request);

            console.log(`Denied ${request.username}`);

            // Remove from local pending list
            if (onRequestProcessed) {
                onRequestProcessed(request.id);
            }
        } catch (error) {
            console.error('Failed to deny request:', error);
            alert(`Failed to deny: ${error.message}`);
        } finally {
            setProcessingRequest(null);
        }
    };

    const handleRoleChange = (requestId, role) => {
        setSelectedRoles(prev => ({
            ...prev,
            [requestId]: role
        }));
    };

    const getTimeAgo = (timestamp) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const modalContent = (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif"
        }} onClick={onClose}>
            <div style={{
                width: 550, maxWidth: '90vw', background: '#1e293b', borderRadius: 24,
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
                            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faUserPlus} style={{ color: '#fff', fontSize: 16 }} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Join Requests</h3>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                {requests.length} pending {requests.length === 1 ? 'request' : 'requests'}
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

                {/* Content */}
                <div style={{ padding: '0 24px', overflowY: 'auto', flex: 1 }}>
                    <div style={{ padding: '24px 0' }}>
                        {requests.length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '40px 20px',
                                color: 'rgba(255,255,255,0.3)'
                            }}>
                                <div style={{
                                    width: 64, height: 64, borderRadius: 32, background: 'rgba(255,255,255,0.05)',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16
                                }}>
                                    <FontAwesomeIcon icon={faUserCheck} size="lg" style={{ opacity: 0.5 }} />
                                </div>
                                <div style={{ fontWeight: 500 }}>No pending requests</div>
                                <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
                                    Join requests will appear here
                                </div>
                            </div>
                        ) : (
                            requests.map(request => {
                                const selectedRole = selectedRoles[request.id] || 'viewer';
                                const isProcessing = processingRequest === request.id;

                                return (
                                    <div key={request.id} style={{
                                        marginBottom: 12, padding: 16, borderRadius: 12,
                                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                                        opacity: isProcessing ? 0.6 : 1,
                                        transition: 'all 0.2s'
                                    }}>
                                        {/* User Info */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                            <div style={{
                                                width: 40, height: 40, borderRadius: 20,
                                                background: `hsl(${Math.abs(request.username.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 70%, 50%)`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 16, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                            }}>
                                                {request.username.substring(0, 2).toUpperCase()}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600, fontSize: 15 }}>{request.username}</div>
                                                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                                    Requested {getTimeAgo(request.timestamp)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Role Selection & Actions */}
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            {/* Role Dropdown */}
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
                                                    ROLE
                                                </label>
                                                <select
                                                    value={selectedRole}
                                                    onChange={(e) => handleRoleChange(request.id, e.target.value)}
                                                    disabled={isProcessing}
                                                    style={{
                                                        width: '100%', padding: '8px 12px', borderRadius: 8,
                                                        background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                                        color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer'
                                                    }}
                                                >
                                                    <option value="viewer">👁️ Viewer (Read-only)</option>
                                                    <option value="writer">✏️ Writer (Can edit)</option>
                                                </select>
                                            </div>

                                            {/* Approve Button */}
                                            <button
                                                onClick={() => handleApprove(request)}
                                                disabled={isProcessing}
                                                style={{
                                                    padding: '8px 16px', borderRadius: 8, border: 'none',
                                                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                    color: '#fff', fontSize: 13, fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                                                    transition: 'all 0.2s', marginTop: 18
                                                }}
                                                onMouseEnter={e => !isProcessing && (e.currentTarget.style.transform = 'translateY(-1px)')}
                                                onMouseLeave={e => e.currentTarget.style.transform = 'none'}
                                            >
                                                <FontAwesomeIcon icon={faCheck} />
                                                Approve
                                            </button>

                                            {/* Deny Button */}
                                            <button
                                                onClick={() => handleDeny(request)}
                                                disabled={isProcessing}
                                                style={{
                                                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.3)',
                                                    background: 'rgba(239, 68, 68, 0.1)',
                                                    color: '#f87171', fontSize: 13, fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                    transition: 'all 0.2s', marginTop: 18
                                                }}
                                                onMouseEnter={e => !isProcessing && (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)')}
                                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                                            >
                                                <FontAwesomeIcon icon={faTimes} />
                                                Deny
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
