import { faPlus, faTrash, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { p2pSyncService } from '../../services/p2p/syncService';
import { teamManager } from '../../services/p2p/teamManager';

export default function TeamsTab() {
    const [teams, setTeams] = useState([]);
    const [activeTeamId, setActiveTeamId] = useState(null);
    const [peerCounts, setPeerCounts] = useState(new Map());
    const [isCreating, setIsCreating] = useState(false);

    // Form state
    const [teamName, setTeamName] = useState('');
    const [secretPhrase, setSecretPhrase] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        // Initial load
        teamManager.init().then(() => {
            setTeams(teamManager.getTeams());
            setActiveTeamId(teamManager.activeTeamId);
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

        return () => {
            unsubscribeBox();
            unsubscribePeers();
        };
    }, []);

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
        if (confirm('Are you sure you want to leave this team? Local data will be lost.')) {
            await teamManager.removeTeam(teamId);
        }
    };

    const handleActivate = async (teamId) => {
        await teamManager.setActiveTeam(teamId);
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px 0', color: '#fff' }}>My Teams</h3>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                        Join or create P2P sync groups. Data is encrypted with your secret.
                    </p>
                </div>
                {!isCreating && (
                    <button
                        onClick={() => setIsCreating(true)}
                        style={{
                            padding: '8px 16px', borderRadius: 8, border: 'none',
                            background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 600,
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
                    <h4 style={{ margin: '0 0 16px 0', fontSize: 14 }}>Connect to Team</h4>
                    <form onSubmit={handleCreateJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, opacity: 0.7 }}>Team Name (Local Label)</label>
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
                                <label style={{ fontSize: 12, opacity: 0.7 }}>Secret Phrase (4+ words)</label>
                                <button type="button" onClick={generateSecret} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: 11, cursor: 'pointer' }}>Generate Random</button>
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
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                                This phrase generates the encryption keys. Share it securely with your team.
                            </div>
                        </div>

                        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}

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
                    </form>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {teams.length === 0 && !isCreating && (
                    <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                        No teams connected yet.
                    </div>
                )}
                {teams.map(team => (
                    <div key={team.id} style={{
                        padding: 16, borderRadius: 12,
                        background: activeTeamId === team.id ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${activeTeamId === team.id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 8,
                                background: activeTeamId === team.id ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff'
                            }}>
                                <FontAwesomeIcon icon={faUsers} size="sm" />
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>
                                    {team.name}
                                    {activeTeamId === team.id && <span style={{ marginLeft: 8, fontSize: 10, background: '#3b82f6', padding: '2px 6px', borderRadius: 4 }}>Active</span>}
                                </div>
                                <div style={{ fontSize: 11, opacity: 0.4, fontFamily: 'monospace' }}>
                                    ID: {team.id.substring(0, 8)}...
                                </div>
                            </div>
                            <div style={{
                                padding: '2px 8px', borderRadius: 12,
                                background: (peerCounts.get(team.id) || 0) > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)',
                                color: (peerCounts.get(team.id) || 0) > 0 ? '#34d399' : 'rgba(255,255,255,0.4)',
                                fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.05)'
                            }}>
                                {(peerCounts.get(team.id) || 0)} Peers
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                            {activeTeamId !== team.id && (
                                <button
                                    onClick={() => handleActivate(team.id)}
                                    title="Switch to this team"
                                    style={{
                                        padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                                        background: 'transparent', color: '#fff', fontSize: 12, cursor: 'pointer'
                                    }}
                                >
                                    Activate
                                </button>
                            )}
                            <button
                                onClick={() => handleDelete(team.id)}
                                title="Leave Team"
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
                ))}
            </div>
        </div>
    );
}
