import { faCheckCircle, faCopy, faExclamationTriangle, faLink, faLock, faShieldAlt, faTimes, faUserPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { createPortal } from 'react-dom';

export function InviteUserModal({ isOpen, onClose, team }) {
    const [mode, setMode] = useState('protected'); // 'safe' | 'protected'
    const [pin, setPin] = useState('');
    const [generatedLink, setGeneratedLink] = useState('');
    const [copySuccess, setCopySuccess] = useState('');

    if (!isOpen || !team) return null;

    const handleGenerateProtected = async () => {
        if (!pin || pin.length < 4) {
            alert('Please enter a PIN with at least 4 characters.');
            return;
        }

        try {
            // Dynamically import cryptoUtils to avoid bundling it with the main chunk
            const { cryptoUtils } = await import('../../services/p2p/cryptoUtils');

            const payload = {
                name: team.name,
                secret: team.secretPhrase
            };
            const encrypted = cryptoUtils.encryptWithPin(payload, pin);

            // Construct URL: index.html?invite=[encrypted]
            const baseUrl = chrome.runtime.getURL('index.html');
            const url = `${baseUrl}?invite=${encodeURIComponent(encrypted)}`;

            setGeneratedLink(url);
            copyToClipboard(url);
        } catch (e) {
            console.error('Encryption failed:', e);
            alert('Failed to generate link.');
        }
    };

    const handleGenerateSafe = () => {
        // Construct URL: index.html?join_team=[name]
        // No secret included
        const baseUrl = chrome.runtime.getURL('index.html');
        const url = `${baseUrl}?join_team=${encodeURIComponent(team.name)}`;

        setGeneratedLink(url);
        copyToClipboard(url);
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopySuccess('Copied to clipboard!');
            setTimeout(() => setCopySuccess(''), 2000);
        });
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
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faUserPlus} style={{ color: '#fff', fontSize: 16 }} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Invite to Team</h3>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>{team.name}</div>
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
                    {/* Method Toggle */}
                    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 12, marginBottom: 24 }}>
                        <button
                            onClick={() => { setMode('protected'); setGeneratedLink(''); }}
                            style={{
                                flex: 1, padding: '10px', borderRadius: 8,
                                background: mode === 'protected' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                color: mode === 'protected' ? '#60a5fa' : '#94a3b8',
                                border: '1px solid',
                                borderColor: mode === 'protected' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                        >
                            <FontAwesomeIcon icon={faShieldAlt} style={{ marginRight: 8 }} />
                            Secure PIN Invite
                        </button>
                        <button
                            onClick={() => { setMode('safe'); setGeneratedLink(''); }}
                            style={{
                                flex: 1, padding: '10px', borderRadius: 8,
                                background: mode === 'safe' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                color: mode === 'safe' ? '#fff' : '#94a3b8',
                                border: '1px solid',
                                borderColor: mode === 'safe' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                        >
                            <FontAwesomeIcon icon={faLink} style={{ marginRight: 8 }} />
                            Copy Link Only
                        </button>
                    </div>

                    {mode === 'protected' ? (
                        <div style={{ animation: 'fadeIn 0.3s ease' }}>
                            <div style={{
                                background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)',
                                borderRadius: 12, padding: 16, marginBottom: 20
                            }}>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FontAwesomeIcon icon={faLock} />
                                    Encrypted Invitation (Recommended)
                                </h4>
                                <p style={{ margin: 0, fontSize: 13, color: '#bfdbfe', lineHeight: 1.5 }}>
                                    This creates a secure link that contains your team credentials, encrypted with a short PIN.
                                    <br />
                                    <strong>The recipient only needs the Link + PIN to join.</strong>
                                </p>
                            </div>

                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Create a Temporary PIN
                                </label>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <input
                                        type="text"
                                        value={pin}
                                        onChange={e => setPin(e.target.value)}
                                        placeholder="e.g. 1234"
                                        maxLength={6}
                                        style={{
                                            width: 120, padding: '12px 16px', borderRadius: 10,
                                            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                            color: '#fff', fontSize: 18, outline: 'none', letterSpacing: '4px', textAlign: 'center',
                                            fontWeight: 700
                                        }}
                                    />
                                    <button
                                        onClick={handleGenerateProtected}
                                        disabled={!pin || pin.length < 4}
                                        style={{
                                            flex: 1,
                                            padding: '0 24px', borderRadius: 10,
                                            background: (!pin || pin.length < 4) ? 'rgba(255,255,255,0.1)' : '#3b82f6',
                                            border: 'none',
                                            color: (!pin || pin.length < 4) ? 'rgba(255,255,255,0.3)' : '#fff',
                                            fontWeight: 600, cursor: (!pin || pin.length < 4) ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                                        }}
                                    >
                                        <FontAwesomeIcon icon={faLink} />
                                        Generate Invite Link
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ animation: 'fadeIn 0.3s ease' }}>
                            <div style={{
                                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 12, padding: 16, marginBottom: 20
                            }}>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FontAwesomeIcon icon={faExclamationTriangle} style={{ color: '#fbbf24' }} />
                                    Manual Entry Required
                                </h4>
                                <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
                                    This simply links to your team login page.
                                    <br />
                                    <strong>You must separately share the exact "Secret Phrase" with your team member.</strong>
                                </p>
                            </div>

                            <button
                                onClick={handleGenerateSafe}
                                style={{
                                    width: '100%', padding: '14px', borderRadius: 10,
                                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff',
                                    fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            >
                                <FontAwesomeIcon icon={faCopy} />
                                Copy Team URL
                            </button>
                        </div>
                    )}

                    {/* Result Area */}
                    {generatedLink && copySuccess && (
                        <div style={{
                            marginTop: 20, padding: 12, borderRadius: 10,
                            background: 'rgba(16, 185, 129, 0.2)', color: '#34d399',
                            textAlign: 'center', fontSize: 13, fontWeight: 500,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            animation: 'slideUp 0.2s ease'
                        }}>
                            <FontAwesomeIcon icon={faCheckCircle} />
                            {copySuccess}
                        </div>
                    )}
                </div>
            </div>
            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );

    return createPortal(modalContent, document.body);
}
