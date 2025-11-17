
import { useEffect, useState } from 'react';

function TeamManagement() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const [teamName, setTeamName] = useState('');
    const [createdTeam, setCreatedTeam] = useState(null); // team created/owned by current user

    const [inviteEmail, setInviteEmail] = useState('');
    const [members, setMembers] = useState([]);
    const [membersLoading, setMembersLoading] = useState(false);

    const [myTeams, setMyTeams] = useState([]);
    const [myTeamsLoading, setMyTeamsLoading] = useState(false);
    const [selectedTeamId, setSelectedTeamId] = useState('');

    const [teamLinks, setTeamLinks] = useState([]);
    const [linksLoading, setLinksLoading] = useState(false);

    const [activeTab, setActiveTab] = useState('owner'); // 'owner' | 'my-teams'

    const handleApiError = async (res) => {
        let message = `Request failed with status ${res.status}`;
        try {
            const data = await res.json();
            if (data && data.error) {
                message = data.error;
            }
        } catch (e) {
            // ignore JSON parse errors
        }
        throw new Error(message);
    };

    const createTeam = async (e) => {
        e.preventDefault();
        if (!teamName.trim()) return;

        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/teams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ team_name: teamName.trim() }),
            });

            if (!res.ok) {
                await handleApiError(res);
            }

            const data = await res.json();
            setCreatedTeam(data);
            setTeamName('');
            // Refresh My Teams list in case backend immediately adds owner to their own team
            loadMyTeams();
            // Also refresh members for this team if the API returns them
            if (data && data.id) {
                loadMembers(data.id);
            }
        } catch (err) {
            setError(err.message || 'Failed to create team');
        } finally {
            setLoading(false);
        }
    };

    const loadMembers = async (teamId) => {
        if (!teamId) return;
        setMembersLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}`);
            if (!res.ok) {
                await handleApiError(res);
            }
            const data = await res.json();
            if (data && data.members) {
                setMembers(data.members);
                // keep createdTeam in sync if this is the owned team
                if (createdTeam && createdTeam.id === teamId) {
                    setCreatedTeam({ ...createdTeam, ...data });
                }
            } else {
                setMembers([]);
            }
        } catch (err) {
            setError(err.message || 'Failed to load members');
            setMembers([]);
        } finally {
            setMembersLoading(false);
        }
    };

    const inviteMember = async (e) => {
        e.preventDefault();
        if (!createdTeam || !createdTeam.id || !inviteEmail.trim()) return;

        setMembersLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/teams/${encodeURIComponent(createdTeam.id)}/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: inviteEmail.trim() }),
            });

            if (!res.ok) {
                await handleApiError(res);
            }

            setInviteEmail('');
            // re-load members after successful invite
            loadMembers(createdTeam.id);
        } catch (err) {
            setError(err.message || 'Failed to invite member');
        } finally {
            setMembersLoading(false);
        }
    };

    const removeMember = async (memberEmail) => {
        if (!createdTeam || !createdTeam.id || !memberEmail) return;

        setMembersLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/teams/${encodeURIComponent(createdTeam.id)}/members`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: memberEmail }),
            });

            if (!res.ok) {
                await handleApiError(res);
            }

            setMembers((prev) => prev.filter((m) => m.email !== memberEmail));
        } catch (err) {
            setError(err.message || 'Failed to remove member');
        } finally {
            setMembersLoading(false);
        }
    };

    const loadMyTeams = async () => {
        setMyTeamsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/my-teams');
            if (!res.ok) {
                await handleApiError(res);
            }
            const data = await res.json();
            setMyTeams(Array.isArray(data) ? data : []);
            // if no team selected yet, pick first
            if (!selectedTeamId && data && data.length > 0) {
                setSelectedTeamId(data[0].id);
            }
        } catch (err) {
            setError(err.message || 'Failed to load teams');
            setMyTeams([]);
        } finally {
            setMyTeamsLoading(false);
        }
    };

    const loadTeamLinks = async (teamId) => {
        if (!teamId) return;
        setLinksLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ team_id: teamId });
            const res = await fetch(`/api/links?${params.toString()}`);
            if (!res.ok) {
                await handleApiError(res);
            }
            const data = await res.json();
            setTeamLinks(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message || 'Failed to load team links');
            setTeamLinks([]);
        } finally {
            setLinksLoading(false);
        }
    };

    useEffect(() => {
        // Initial load of My Teams list
        loadMyTeams();
    }, []);

    useEffect(() => {
        if (selectedTeamId) {
            loadTeamLinks(selectedTeamId);
        }
    }, [selectedTeamId]);

    const selectedTeam = myTeams.find((t) => t.id === selectedTeamId) || null;

    return (
        <div className="settings-section">
            <h2 className="settings-section-title">Team Management</h2>

            {error && (
                <div className="settings-error">
                    {error}
                </div>
            )}

            <div className="settings-tabs">
                <button
                    className={activeTab === 'owner' ? 'settings-tab active' : 'settings-tab'}
                    onClick={() => setActiveTab('owner')}
                >
                    Team Owner
                </button>
                <button
                    className={activeTab === 'my-teams' ? 'settings-tab active' : 'settings-tab'}
                    onClick={() => setActiveTab('my-teams')}
                >
                    My Teams & Links
                </button>
            </div>

            {activeTab === 'owner' && (
                <div className="settings-card">
                    <h3>Create a Team</h3>
                    <p className="settings-description">
                        Create a new team. You will be set as the owner.
                    </p>
                    <form onSubmit={createTeam} className="settings-form-inline">
                        <input
                            type="text"
                            placeholder="Team name"
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                            disabled={loading}
                        />
                        <button type="submit" disabled={loading || !teamName.trim()}>
                            {loading ? 'Creating…' : 'Create Team'}
                        </button>
                    </form>

                    {createdTeam && (
                        <div className="settings-subcard">
                            <h4>Current Team</h4>
                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Name</div>
                                    <div>{createdTeam.team_name || createdTeam.name}</div>
                                </div>
                                <div>
                                    <div className="settings-label">Team ID</div>
                                    <div className="settings-monospace">{createdTeam.id}</div>
                                </div>
                                {createdTeam.owner_email && (
                                    <div>
                                        <div className="settings-label">Owner</div>
                                        <div>{createdTeam.owner_email}</div>
                                    </div>
                                )}
                            </div>

                            <div className="settings-divider" />

                            <h4>Invite Members</h4>
                            <form onSubmit={inviteMember} className="settings-form-inline">
                                <input
                                    type="email"
                                    placeholder="Member email"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    disabled={membersLoading}
                                />
                                <button
                                    type="submit"
                                    disabled={membersLoading || !inviteEmail.trim()}
                                >
                                    {membersLoading ? 'Sending…' : 'Invite'}
                                </button>
                            </form>

                            <div className="settings-divider" />

                            <h4>Team Members</h4>
                            {membersLoading && <div className="settings-hint">Loading members…</div>}
                            {!membersLoading && members.length === 0 && (
                                <div className="settings-hint">No members yet.</div>
                            )}
                            {!membersLoading && members.length > 0 && (
                                <ul className="settings-list">
                                    {members.map((member) => (
                                        <li key={member.email} className="settings-list-row">
                                            <div className="settings-list-main">
                                                <div className="settings-list-title">{member.email}</div>
                                                {member.role && (
                                                    <div className="settings-list-sub">{member.role}</div>
                                                )}
                                            </div>
                                            {createdTeam.owner_email && member.email !== createdTeam.owner_email && (
                                                <button
                                                    className="settings-button-danger"
                                                    onClick={() => removeMember(member.email)}
                                                    disabled={membersLoading}
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'my-teams' && (
                <div className="settings-card">
                    <h3>My Teams</h3>
                    <p className="settings-description">
                        These are the teams you belong to. When saving links, your popup will use this list to let you choose a team.
                    </p>
                    <div className="settings-row">
                        <div className="settings-row-main">
                            {myTeamsLoading && <div className="settings-hint">Loading teams…</div>}
                            {!myTeamsLoading && myTeams.length === 0 && (
                                <div className="settings-hint">You are not part of any team yet.</div>
                            )}
                            {!myTeamsLoading && myTeams.length > 0 && (
                                <select
                                    value={selectedTeamId}
                                    onChange={(e) => setSelectedTeamId(e.target.value)}
                                >
                                    <option value="">Select a team…</option>
                                    {myTeams.map((team) => (
                                        <option key={team.id} value={team.id}>
                                            {team.team_name || team.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <button onClick={loadMyTeams} disabled={myTeamsLoading}>
                            {myTeamsLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                    </div>

                    <div className="settings-divider" />

                    <h4>Team Links</h4>
                    {!selectedTeam && (
                        <div className="settings-hint">
                            Select a team above to view shared links.
                        </div>
                    )}
                    {selectedTeam && (
                        <>
                            <div className="settings-hint">
                                Viewing links for <strong>{selectedTeam.team_name || selectedTeam.name}</strong>
                            </div>
                            {linksLoading && (
                                <div className="settings-hint">Loading links…</div>
                            )}
                            {!linksLoading && teamLinks.length === 0 && (
                                <div className="settings-hint">No links saved for this team yet.</div>
                            )}
                            {!linksLoading && teamLinks.length > 0 && (
                                <ul className="settings-list">
                                    {teamLinks.map((link) => (
                                        <li key={link.id} className="settings-list-row">
                                            <div className="settings-list-main">
                                                <a
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="settings-list-title"
                                                >
                                                    {link.title || link.url}
                                                </a>
                                                <div className="settings-list-sub">
                                                    Saved by {link.saved_by || 'unknown'}
                                                    {link.created_at && (
                                                        <>
                                                            {' '}
                                                            ·{' '}
                                                            {new Date(link.created_at).toLocaleString()}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default TeamManagement;

