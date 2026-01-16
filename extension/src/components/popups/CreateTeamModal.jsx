import { faPlus, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { teamManager } from '../../services/p2p/teamManager';

export function CreateTeamModal({ isOpen, onClose }) {
    const [teamName, setTeamName] = useState('');
    const [secretPhrase, setSecretPhrase] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleCreateJoin = async (e) => {
        e.preventDefault();
        setError('');

        if (!teamName.trim() || !secretPhrase.trim()) {
            setError('Please enter both a team name and the 4-word secret.');
            return;
        }

        const words = secretPhrase.trim().split(/\s+/);
        if (words.length < 4) {
            setError('Secret phrase must actually contain at least 4 words for security.');
            return;
        }

        try {
            await teamManager.addTeam(teamName, secretPhrase);
            setTeamName('');
            setSecretPhrase('');
            onClose();
        } catch (err) {
            setError(err.message);
        }
    };

    const generateSecret = () => {
        const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu', 'nebula', 'cosmic', 'orbit', 'solar', 'lunar', 'star', 'comet', 'planet'];
        const selection = [];
        for (let i = 0; i < 4; i++) {
            selection.push(words[Math.floor(Math.random() * words.length)]);
        }
        setSecretPhrase(selection.join(' '));
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
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faPlus} style={{ color: '#fff', fontSize: 16 }} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Join / Create Team</h3>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>Connect with your team</div>
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
                <div style={{ padding: 24 }}>
                    <form onSubmit={handleCreateJoin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 8 }}>
                                TEAM NAME
                            </label>
                            <input
                                type="text"
                                value={teamName}
                                onChange={e => setTeamName(e.target.value)}
                                placeholder="e.g. Work Squad"
                                style={{
                                    width: '100%', padding: '12px 16px', borderRadius: 10,
                                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 14, outline: 'none',
                                    transition: 'border-color 0.2s'
                                }}
                                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                            />
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <label style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>
                                    SECRET PHRASE
                                </label>
                                <button
                                    type="button"
                                    onClick={generateSecret}
                                    style={{
                                        background: 'none', border: 'none', color: '#60a5fa',
                                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                        padding: 0
                                    }}
                                >
                                    Generate Random
                                </button>
                            </div>
                            <input
                                type="text"
                                value={secretPhrase}
                                onChange={e => setSecretPhrase(e.target.value)}
                                placeholder="alpha bravo charlie delta"
                                style={{
                                    width: '100%', padding: '12px 16px', borderRadius: 10,
                                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'monospace',
                                    transition: 'border-color 0.2s'
                                }}
                                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                            />
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, lineHeight: 1.4 }}>
                                This phrase generates the encryption keys. Share it securely with your team to let them join.
                            </div>
                        </div>

                        {error && (
                            <div style={{
                                padding: '10px 14px', borderRadius: 8,
                                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                                color: '#f87171', fontSize: 13
                            }}>
                                {error}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    flex: 1, padding: '12px', borderRadius: 10,
                                    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    fontSize: 14
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                style={{
                                    flex: 2, padding: '12px', borderRadius: 10,
                                    background: '#3b82f6', border: 'none',
                                    color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    fontSize: 14,
                                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                                }}
                            >
                                Connect
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
