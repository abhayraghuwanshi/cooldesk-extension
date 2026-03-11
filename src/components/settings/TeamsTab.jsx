import { faChevronDown, faChevronRight, faCrown, faEye, faKey, faPen, faPlus, faTrash, faUpload, faUserMinus, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';
import { p2pSyncService } from '../../services/p2p/syncService';
import { teamManager } from '../../services/p2p/teamManager';
import { userProfileService } from '../../services/p2p/userProfileService';

export default function TeamsTab() {
    // ... [existing state code] ...
    const [teams, setTeams] = useState([]);
    const [activeTeamId, setActiveTeamId] = useState(null);
    const [peerCounts, setPeerCounts] = useState(new Map());
    const [expandedTeams, setExpandedTeams] = useState(new Set());
    const [isCreating, setIsCreating] = useState(false);

    // Profile state
    const [username, setUsername] = useState('');
    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [usernameError, setUsernameError] = useState('');

    // Form state
    const [teamName, setTeamName] = useState('');
    const [secretPhrase, setSecretPhrase] = useState('');
    const [error, setError] = useState('');

    // ... [existing useEffects] ...
    useEffect(() => {
        // Initial load
        teamManager.init().then(() => {
            setTeams(teamManager.getTeams());
            setActiveTeamId(teamManager.activeTeamId);
        });

        // Load username
        userProfileService.getUsername().then(name => {
            setUsername(name);
        });

        // Subscribe to changes
        const unsubscribeBox = teamManager.subscribe(({ teams: updatedTeams, activeTeamId: updatedActiveId }) => {
            setTeams([...updatedTeams]);
            setActiveTeamId(updatedActiveId);
        });

        // Subscribe to peer counts
        const unsubscribePeers = p2pSyncService.subscribe((counts) => {
            setPeerCounts(new Map(counts)); // clone to trigger re-render
        });

        // Subscribe to username changes
        const unsubscribeProfile = userProfileService.subscribe((newUsername) => {
            setUsername(newUsername);
        });

        return () => {
            unsubscribeBox();
            unsubscribePeers();
            unsubscribeProfile();
        };
    }, []);

<<<<<<< HEAD:src/components/settings/TeamsTab.jsx
    // ... [existing handlers] ...
=======
>>>>>>> master:extension/src/components/settings/TeamsTab.jsx
    const handleCreateJoin = async (e) => {
        e.preventDefault();
        setError('');

        if (!teamName.trim() || !secretPhrase.trim()) {
            setError('Please enter both a team name and the 4-word secret.');
            return;
        }

        const words = secretPhrase.trim().split(/\s+/);
        if (words.length < 4) {
            setError('Secret phrase must actally contain at least 4 words for security.');
            return;
        }

        try {
            await teamManager.addTeam(teamName, secretPhrase);
            setTeamName('');
            setSecretPhrase('');
            setIsCreating(false);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDelete = async (teamId) => {
        const team = teams.find(t => t.id === teamId);
        if (!team) return;

        const isAdmin = team.createdByMe;

        let confirmMessage;
        if (isAdmin) {
            confirmMessage =
                '⚠️ You are the ADMIN of this team.\n\n' +
                'Leaving will:\n' +
                '• Remove this team from your device\n' +
                '• Delete all local team data\n' +
                '• Other members can still access the team if they have the secret\n\n' +
                'Are you sure you want to leave as admin?';
        } else {
            confirmMessage =
                'Leave this team?\n\n' +
                'This will:\n' +
                '• Remove the team from your device\n' +
                '• Delete all local team data\n' +
                '• You can rejoin anytime with the team secret\n\n' +
                'Continue?';
        }

        if (confirm(confirmMessage)) {
            await teamManager.removeTeam(teamId);
        }
    };

    // Helper to generate a random secret
    const generateSecret = () => {
        const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu', 'nebula', 'cosmic', 'orbit', 'solar', 'lunar', 'star', 'comet', 'planet'];
        const selection = [];
        for (let i = 0; i < 4; i++) {
            selection.push(words[Math.floor(Math.random() * words.length)]);
        }
        setSecretPhrase(selection.join(' '));
    };

    const toggleTeamExpansion = (teamId) => {
        const newExpanded = new Set(expandedTeams);
        if (newExpanded.has(teamId)) {
            newExpanded.delete(teamId);
        } else {
            newExpanded.add(teamId);
        }
        setExpandedTeams(newExpanded);
    };

    const handleSaveUsername = async () => {
        setUsernameError('');
        try {
            await userProfileService.setUsername(username);
            setIsEditingUsername(false);
        } catch (err) {
            setUsernameError(err.message);
        }
    };

<<<<<<< HEAD:src/components/settings/TeamsTab.jsx
    const handleRemoveMember = (teamId, memberName) => {
        const team = teams.find(t => t.id === teamId);
        if (!team?.createdByMe) {
            alert('Only team admins can remove members.');
            return;
        }

        if (confirm(`Remove "${memberName}" from the team?\n\nThey can rejoin if they have the team secret.`)) {
            const success = p2pStorage.removeMemberFromTeam(teamId, memberName);
            if (success) {
                // Force re-render by triggering a state update
                setTeams([...teams]);
            }
        }
    };

    const handleToggleWriter = (teamId, memberName) => {
        const team = teams.find(t => t.id === teamId);
        if (!team?.createdByMe) return;

        const success = p2pStorage.toggleMemberWriterStatus(teamId, memberName);
        if (success) {
            setTeams([...teams]); // Trigger re-render
        }
    };

    const handleExportRecoveryKit = (teamId) => {
        const team = teams.find(t => t.id === teamId);
        if (!team || !team.createdByMe) return;

        const confirmMsg =
            '⚠️ SENSITIVE DATA WARNING ⚠️\n\n' +
            'You are about to export the "Admin Recovery Kit" for this team.\n' +
            'This file contains the PRIVATE KEY that controls this team.\n\n' +
            'Anyone with this file can impersonate you and take control of the team.\n\n' +
            'Do you want to proceed and download the file?';

        if (!confirm(confirmMsg)) return;

        const recoveryData = {
            type: 'cooldesk-team-recovery',
            version: 1,
            exportedAt: new Date().toISOString(),
            team: {
                id: team.id,
                name: team.name,
                secretPhrase: team.secretPhrase, // Crucial for re-joining
                adminKeys: {
                    privateKey: team.adminPrivateKey, // Crucial for Admin status
                    publicKey: team.adminPublicKey
                }
            }
        };

        const blob = new Blob([JSON.stringify(recoveryData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cooldesk-recovery-${team.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

=======
>>>>>>> master:extension/src/components/settings/TeamsTab.jsx
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Profile Section */}
            <div style={{
                padding: 16, borderRadius: 12,
                background: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.2)'
            }}>
                <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: '0 0 12px 0', color: '#fff' }}>Your Profile</h3>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 'var(--font-sm)', marginBottom: 4, opacity: 0.7 }}>Display Name</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            onFocus={() => setIsEditingUsername(true)}
                            placeholder="Enter your name"
                            maxLength={30}
                            style={{
                                width: '100%', padding: '8px 12px', borderRadius: 8,
                                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', outline: 'none', fontSize: 'var(--font-base)'
                            }}
                        />
                        {usernameError && <div style={{ color: '#f87171', fontSize: 'var(--font-sm)', marginTop: 4 }}>{usernameError}</div>}
                        <div style={{ fontSize: 'var(--font-xs)', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                            This name will be shown to other team members
                        </div>
                    </div>
                    {isEditingUsername && (
                        <button
                            onClick={handleSaveUsername}
                            style={{
                                marginTop: 20, padding: '8px 16px', borderRadius: 8, border: 'none',
                                background: '#3b82f6', color: '#fff', fontSize: 'var(--font-md)', fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            Save
                        </button>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: '0 0 4px 0', color: '#fff' }}>My Teams</h3>
                    <p style={{ fontSize: 'var(--font-md)', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                        Join or create P2P sync groups. Data is encrypted with your secret.
                    </p>
                </div>
                {!isCreating && (
                    <button
                        onClick={() => setIsCreating(true)}
                        style={{
                            padding: '8px 16px', borderRadius: 8, border: 'none',
                            background: '#3b82f6', color: '#fff', fontSize: 'var(--font-md)', fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
                        }}
                    >
                        <FontAwesomeIcon icon={faPlus} />
                        Join / Create
                    </button>
                )}
            </div>

            {isCreating && (
                <div style={{
                    padding: 16, background: 'rgba(59, 130, 246, 0.1)',
                    borderRadius: 12, border: '1px solid rgba(59, 130, 246, 0.2)'
                }}>
                    <h4 style={{ margin: '0 0 16px 0', fontSize: 'var(--font-base)' }}>Connect to Team</h4>
                    <form onSubmit={handleCreateJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 'var(--font-sm)', marginBottom: 4, opacity: 0.7 }}>Team Name (Local Label)</label>
                            <input
                                type="text"
                                value={teamName}
                                onChange={e => setTeamName(e.target.value)}
                                placeholder="e.g. Work Squad"
                                style={{
                                    width: '100%', padding: '8px 12px', borderRadius: 8,
                                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', outline: 'none'
                                }}
                            />
                        </div>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <label style={{ fontSize: 'var(--font-sm)', opacity: 0.7 }}>Secret Phrase (4+ words)</label>
                                <button type="button" onClick={generateSecret} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: 'var(--font-xs)', cursor: 'pointer' }}>Generate Random</button>
                            </div>
                            <input
                                type="text"
                                value={secretPhrase}
                                onChange={e => setSecretPhrase(e.target.value)}
                                placeholder="alpha bravo charlie delta"
                                style={{
                                    width: '100%', padding: '8px 12px', borderRadius: 8,
                                    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', outline: 'none', fontFamily: 'monospace'
                                }}
                            />
                            <div style={{ fontSize: 'var(--font-xs)', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                                This phrase generates the encryption keys. Share it securely with your team.
                            </div>
                        </div>

                        {error && <div style={{ color: '#f87171', fontSize: 'var(--font-md)' }}>{error}</div>}

                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <button type="submit" style={{
                                flex: 1, padding: '8px', borderRadius: 8, border: 'none',
                                background: '#3b82f6', color: '#fff', fontWeight: 600, cursor: 'pointer'
                            }}>
                                Connect
                            </button>
                            <button type="button" onClick={() => setIsCreating(false)} style={{
                                padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'transparent', color: '#fff', cursor: 'pointer'
                            }}>
                                Cancel
                            </button>
                        </div>

                        <div style={{ position: 'relative', marginTop: 8, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <label style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                width: '100%', padding: '8px', borderRadius: 8,
                                border: '1px dashed rgba(255,255,255,0.2)',
                                background: 'rgba(255,255,255,0.02)', color: '#94a3b8',
                                fontSize: 'var(--font-sm)', cursor: 'pointer', transition: 'all 0.2s'
                            }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.color = '#94a3b8'; }}
                            >
                                <input
                                    type="file"
                                    accept=".json"
                                    style={{ display: 'none' }}
                                    onChange={async (e) => {
                                        const file = e.target.files[0];
                                        if (!file) return;
                                        setError('');
                                        try {
                                            const text = await file.text();
                                            const data = JSON.parse(text);

                                            if (data.type !== 'cooldesk-team-recovery' || !data.team?.adminKeys?.privateKey) {
                                                throw new Error('Invalid Recovery Kit file.');
                                            }

                                            if (confirm(`Restore team "${data.team.name}" with ADMIN Access?`)) {
                                                await teamManager.addTeam(data.team.name, data.team.secretPhrase, {
                                                    importedKeys: data.team.adminKeys
                                                });
                                                setTeamName('');
                                                setSecretPhrase('');
                                                setIsCreating(false);
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            setError('Import Failed: ' + err.message);
                                        } finally {
                                            e.target.value = ''; // Reset
                                        }
                                    }}
                                />
                                <FontAwesomeIcon icon={faUpload} />
                                Restore from Recovery Kit (.json)
                            </label>
                        </div>
                    </form>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teams.length === 0 && !isCreating && (
                    <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                        No teams connected yet.
                    </div>
                )}
                {teams.map(team => {
                    const isExpanded = expandedTeams.has(team.id);
                    const members = p2pSyncService.getAllMembers(team.id);

                    return (
                        <div key={team.id} style={{
                            borderRadius: 12,
                            background: activeTeamId === team.id ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${activeTeamId === team.id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                padding: 16,
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: 8,
                                        background: activeTeamId === team.id ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff'
                                    }}>
                                        <FontAwesomeIcon icon={faUsers} size="sm" />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 'var(--font-base)' }}>
                                            {team.name}
                                            {activeTeamId === team.id && <span style={{ marginLeft: 8, fontSize: 'var(--font-xs)', background: '#3b82f6', padding: '2px 6px', borderRadius: 4 }}>Active</span>}
                                        </div>
                                        <div style={{ fontSize: 'var(--font-xs)', opacity: 0.4, fontFamily: 'monospace' }}>
                                            ID: {team.id.substring(0, 8)}...
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleTeamExpansion(team.id)}
                                        style={{
                                            padding: '4px 8px', borderRadius: 6,
                                            background: 'rgba(255,255,255,0.05)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            color: '#fff', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            fontSize: 'var(--font-xs)'
                                        }}
                                    >
                                        <div style={{
                                            padding: '2px 8px', borderRadius: 12,
                                            background: (peerCounts.get(team.id) || 0) > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)',
                                            color: (peerCounts.get(team.id) || 0) > 0 ? '#34d399' : 'rgba(255,255,255,0.4)',
                                            fontSize: 'var(--font-xs)', fontWeight: 600
                                        }}>
                                            {members.length} {members.length === 1 ? 'Member' : 'Members'}
                                        </div>
                                        <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronRight} size="xs" />
                                    </button>
                                </div>

                                <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
                                    {/* Admin Recovery Kit */}
                                    {team.createdByMe && (
                                        <button
                                            onClick={() => handleExportRecoveryKit(team.id)}
                                            title="Export Recovery Kit (Admin Keys) - KEEP SAFE!"
                                            style={{
                                                width: 32, height: 32, borderRadius: 6, border: 'none',
                                                background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                        >
                                            <FontAwesomeIcon icon={faKey} size="sm" />
                                        </button>
                                    )}

                                    <button
                                        onClick={() => handleDelete(team.id)}
                                        title={team.createdByMe ? "Delete Team" : "Leave Team"}
                                        style={{
                                            width: 32, height: 32, borderRadius: 6, border: 'none',
                                            background: 'rgba(239, 68, 68, 0.1)', color: '#f87171',
                                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}
                                    >
                                        <FontAwesomeIcon icon={faTrash} size="sm" />
                                    </button>
                                </div>
                            </div>

                            {/* Team Members Section */}
                            {isExpanded && (
                                <div style={{
                                    padding: '0 16px 16px 16px',
                                    borderTop: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                    <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, marginTop: 12, marginBottom: 8, opacity: 0.7 }}>
                                        Team Members
                                    </div>
                                    {members.length === 0 ? (
                                        <div style={{
                                            padding: 16,
                                            textAlign: 'center',
                                            color: 'rgba(255,255,255,0.3)',
                                            fontSize: 'var(--font-sm)',
                                            fontStyle: 'italic'
                                        }}>
                                            No members yet
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {members.map((member, index) => (
                                                <div key={member.id || member.name || index} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 10,
                                                    padding: 8,
                                                    borderRadius: 8,
                                                    background: member.isOnline ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.03)',
                                                    border: `1px solid ${member.isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)'}`
                                                }}>
                                                    <div style={{
                                                        width: 24,
                                                        height: 24,
                                                        borderRadius: '50%',
                                                        background: member.color,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: 'var(--font-xs)',
                                                        fontWeight: 600,
                                                        color: '#fff'
                                                    }}>
                                                        {member.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontSize: 'var(--font-md)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            {member.name}
                                                            {member.isAdmin && (
                                                                <span style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 4,
                                                                    padding: '2px 6px',
                                                                    borderRadius: 4,
                                                                    background: 'rgba(251, 191, 36, 0.2)',
                                                                    border: '1px solid rgba(251, 191, 36, 0.3)',
                                                                    fontSize: 'var(--font-xs)',
                                                                    fontWeight: 700,
                                                                    color: '#fbbf24',
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.5px'
                                                                }}>
                                                                    <FontAwesomeIcon icon={faCrown} size="xs" />
                                                                    Admin
                                                                </span>
                                                            )}
                                                            {member.isWriter && !member.isAdmin && (
                                                                <span style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 4,
                                                                    padding: '2px 6px',
                                                                    borderRadius: 4,
                                                                    background: 'rgba(16, 185, 129, 0.2)',
                                                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                                                    fontSize: 'var(--font-xs)',
                                                                    fontWeight: 700,
                                                                    color: '#34d399',
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.5px'
                                                                }}>
                                                                    <FontAwesomeIcon icon={faPen} size="xs" />
                                                                    Writer
                                                                </span>
                                                            )}
                                                            {!member.isAdmin && !member.isWriter && (
                                                                <span style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 4,
                                                                    padding: '2px 6px',
                                                                    borderRadius: 4,
                                                                    background: 'rgba(148, 163, 184, 0.1)',
                                                                    border: '1px solid rgba(148, 163, 184, 0.2)',
                                                                    fontSize: 'var(--font-xs)',
                                                                    fontWeight: 700,
                                                                    color: '#94a3b8',
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.5px'
                                                                }}>
                                                                    <FontAwesomeIcon icon={faEye} size="xs" />
                                                                    Viewer
                                                                </span>
                                                            )}
                                                            {member.isOnline && <span style={{ marginLeft: 6, fontSize: 'var(--font-xs)', color: '#34d399', fontWeight: 600 }}>● Online</span>}
                                                        </div>
                                                        <div style={{ fontSize: 'var(--font-xs)', opacity: 0.4, fontFamily: 'monospace' }}>
                                                            ID: {member.id ? String(member.id).substring(0, 8) : 'N/A'}
                                                        </div>
                                                    </div>
                                                    <div style={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: '50%',
                                                        background: member.isOnline ? '#34d399' : 'rgba(255,255,255,0.2)',
                                                        boxShadow: member.isOnline ? '0 0 8px rgba(52, 211, 153, 0.5)' : 'none'
                                                    }} title={member.isOnline ? 'Online' : 'Offline'} />

                                                    {/* Admin Controls */}
                                                    {team.createdByMe && !member.isAdmin && (
                                                        <div style={{ display: 'flex', gap: 4 }}>
                                                            {/* Toggle Writer */}
                                                            <button
                                                                onClick={() => handleToggleWriter(team.id, member.name)}
                                                                title={member.isWriter ? "Revoke Write Access" : "Grant Write Access"}
                                                                style={{
                                                                    width: 24,
                                                                    height: 24,
                                                                    borderRadius: 4,
                                                                    border: 'none',
                                                                    background: member.isWriter ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.1)',
                                                                    color: member.isWriter ? '#34d399' : '#fff',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                            >
                                                                <FontAwesomeIcon icon={faPen} size="xs" />
                                                            </button>

                                                            {/* Remove Member */}
                                                            <button
                                                                onClick={() => handleRemoveMember(team.id, member.name)}
                                                                title="Remove member"
                                                                style={{
                                                                    width: 24,
                                                                    height: 24,
                                                                    borderRadius: 4,
                                                                    border: 'none',
                                                                    background: 'rgba(239, 68, 68, 0.1)',
                                                                    color: '#f87171',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                                onMouseEnter={e => {
                                                                    e.currentTarget.style.opacity = '1';
                                                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                                                                }}
                                                                onMouseLeave={e => {
                                                                    e.currentTarget.style.opacity = '1';
                                                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                                                                }}
                                                            >
                                                                <FontAwesomeIcon icon={faUserMinus} size="xs" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
