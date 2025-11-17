
import { useEffect, useState } from 'react';
import '../../styles/TeamManagement.css';


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
            const teamsArray = Array.isArray(data) ? data : [];
            setMyTeams(teamsArray);
            // if no team selected yet for links, pick first
            if (!selectedTeamId && teamsArray && teamsArray.length > 0) {
                setSelectedTeamId(teamsArray[0].id);
            }
            // if no team selected in owner console yet, also pick first
            if (!selectedOwnerTeamId && teamsArray && teamsArray.length > 0) {
                setSelectedOwnerTeamId(teamsArray[0].id);
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
            <div className="settings-section-header">
                <div>
                    <h2 className="settings-section-title">Team Management</h2>
                    <p className="settings-section-subtitle">
                        Create teams, invite collaborators, and browse shared links across your workspaces.
                    </p>
                </div>
            </div>

            {error && (
                <div className="settings-error">
                    {error}
                </div>
            )}

            <div className="settings-card settings-card-elevated team-owner-main">
                <div className="settings-card-header">
                    <div>
                        <h3>Team members</h3>
                        <p className="settings-description">
                            Manage people in your team and their access level.
                        </p>
                    </div>
                </div>

                <div className="settings-block">
                    <div className="settings-row settings-row-spread">
                        <div className="settings-row-main">
                            <div className="settings-label">Shared team</div>
                            {myTeamsLoading && <div className="settings-hint">Loading teams…</div>}
                            {!myTeamsLoading && myTeams.length === 0 && (
                                <div className="settings-hint">You are not part of any team yet.</div>
                            )}
                            {!myTeamsLoading && myTeams.length > 0 && (
                                <select
                                    value={selectedTeamId}
                                    onChange={(e) => {
                                        setSelectedTeamId(e.target.value);
                                        loadMembers(e.target.value);
                                    }}
                                >
                                    {myTeams.map((team) => (
                                        <option key={team.id} value={team.id}>
                                            {team.team_name || team.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <button onClick={loadMyTeams} disabled={myTeamsLoading} className="settings-button-ghost">
                            {myTeamsLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                    </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-block">
                    <div className="settings-block-header">
                        <div>
                            <h4>Members</h4>
                            <p className="settings-block-subtitle">
                                All users in this team and their current role.
                            </p>
                        </div>
                    </div>

                    {selectedTeam && createdTeam && createdTeam.id === selectedTeam.id && (
                        <form onSubmit={inviteMember} className="settings-form-inline settings-form-wide" style={{ marginBottom: 12 }}>
                            <input
                                type="email"
                                placeholder="Invite by email"
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
                    )}

                    {membersLoading && (
                        <div className="settings-hint">Loading members…</div>
                    )}
                    {!membersLoading && members.length === 0 && (
                        <div className="settings-hint">No members yet.</div>
                    )}
                    {!membersLoading && members.length > 0 && (
                        <ul className="settings-list settings-list-striped">
                            {members.map((member) => (
                                <li key={member.email} className="settings-list-row team-members-row">
                                    <div className="team-members-main">
                                        <div className="team-members-email">{member.email}</div>
                                        <div className="team-members-meta">
                                            <span className="team-members-role-pill">{member.role || 'member'}</span>
                                        </div>
                                    </div>
                                    {createdTeam && selectedTeam && createdTeam.id === selectedTeam.id && createdTeam.owner_email && member.email !== createdTeam.owner_email && (
                                        <button
                                            className="settings-button-danger settings-button-ghost"
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
            </div>
        </div>
    );
}

export default TeamManagement;

