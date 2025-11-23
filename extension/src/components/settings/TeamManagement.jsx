import { useCallback, useEffect, useState } from "react";
import {
    apiCreateTeam,
    apiInviteMember,
    apiLoadMyTeams,
    apiLoadTeamMembers,
    apiRemoveMember,
} from "../../services/sharedWorkspaceService";
import "../../styles/TeamManagement.css";

export default function TeamManagement() {
    const [loadingTeams, setLoadingTeams] = useState(false);
    const [loadingMembers, setLoadingMembers] = useState(false);

    const [teams, setTeams] = useState([]);
    const [teamId, setTeamId] = useState("");

    const [members, setMembers] = useState([]);

    const [teamName, setTeamName] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");

    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    const notify = (msg) => {
        setSuccess(msg);
        setTimeout(() => setSuccess(null), 3000);
    };

    const loadTeams = useCallback(async () => {
        setLoadingTeams(true);
        setError(null);

        try {
            const result = await apiLoadMyTeams();
            setTeams(result || []);

            if (result?.length && !teamId) {
                setTeamId(result[0].id);
            }
        } catch (err) {
            setError("Failed to load teams");
        } finally {
            setLoadingTeams(false);
        }
    }, [teamId]);

    const loadMembers = useCallback(async () => {
        if (!teamId) return;
        setLoadingMembers(true);

        try {
            const data = await apiLoadTeamMembers(teamId);
            setMembers(data.members || []);
        } catch (err) {
            setMembers([]);
        } finally {
            setLoadingMembers(false);
        }
    }, [teamId]);

    useEffect(() => {
        loadTeams();
    }, [loadTeams]);

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    const createTeam = async (e) => {
        e.preventDefault();
        if (!teamName.trim()) return;

        setError(null);
        setLoadingTeams(true);

        try {
            const newTeam = await apiCreateTeam(teamName.trim());
            notify(`Team "${teamName}" created`);
            setTeamName("");
            await loadTeams();
            setTeamId(newTeam.id);
        } catch (err) {
            setError(err.message || "Failed to create team");
        } finally {
            setLoadingTeams(false);
        }
    };

    const inviteMember = async (e) => {
        e.preventDefault();
        if (!inviteEmail.trim() || !teamId) return;

        setLoadingMembers(true);
        setError(null);

        try {
            await apiInviteMember(teamId, inviteEmail.trim());
            notify(`Invite sent to ${inviteEmail}`);
            setInviteEmail("");
            await loadMembers();
        } catch (err) {
            setError("Failed to invite");
        } finally {
            setLoadingMembers(false);
        }
    };

    const removeMember = async (email) => {
        if (!teamId) return;
        if (!window.confirm(`Remove ${email}?`)) return;

        setLoadingMembers(true);

        try {
            await apiRemoveMember(teamId, email);
            setMembers((prev) => prev.filter((m) => m.email !== email));
        } catch (err) {
            setError("Failed to remove member");
        } finally {
            setLoadingMembers(false);
        }
    };

    const currentTeam = teams.find((t) => t.id === teamId);

    return (
        <div className="settings-section">

            <div className="settings-section-header">
                <h2 className="settings-section-title">Team Management</h2>
                <p className="settings-section-subtitle">
                    Create teams, invite collaborators & manage permissions.
                </p>
            </div>

            {error && <div className="settings-error">{error}</div>}
            {success && <div className="settings-success">{success}</div>}

            {/* Create Team */}
            <div className="settings-card settings-card-elevated mb20">
                <form onSubmit={createTeam} className="settings-form-inline">
                    <input
                        type="text"
                        placeholder="Team Name"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        disabled={loadingTeams}
                    />
                    <button disabled={loadingTeams || !teamName.trim()}>
                        {loadingTeams ? "Creating…" : "Create Team"}
                    </button>
                </form>
            </div>

            {/* Manage Members */}
            <div className="settings-card settings-card-elevated">
                <div className="settings-card-header">
                    <h3>Manage Team Members</h3>
                </div>

                <div className="settings-block">
                    <div className="settings-row settings-row-spread">
                        <div className="settings-row-main">
                            <div className="settings-label">Team</div>

                            {loadingTeams && <div className="settings-hint">Loading…</div>}

                            {!loadingTeams && teams.length === 0 && (
                                <div className="settings-hint">No teams yet.</div>
                            )}

                            {teams.length > 0 && (
                                <select
                                    value={teamId}
                                    onChange={(e) => setTeamId(e.target.value)}
                                    className="settings-select"
                                >
                                    {teams.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.team_name || t.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <button onClick={loadTeams} disabled={loadingTeams} className="settings-button-ghost">
                            Refresh
                        </button>
                    </div>
                </div>

                {teamId && (
                    <>
                        <div className="settings-divider" />

                        <div className="settings-block">
                            <h4>Members of {currentTeam?.team_name || currentTeam?.name}</h4>

                            <form onSubmit={inviteMember} className="settings-form-inline settings-form-wide mb15">
                                <input
                                    type="email"
                                    placeholder="colleague@example.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    disabled={loadingMembers}
                                />
                                <button disabled={loadingMembers || !inviteEmail.trim()}>
                                    {loadingMembers ? "Inviting…" : "Invite"}
                                </button>
                            </form>

                            {loadingMembers && <div className="settings-hint">Loading members…</div>}

                            {!loadingMembers && members.length === 0 && (
                                <div className="settings-hint">No members yet.</div>
                            )}

                            {!loadingMembers && members.length > 0 && (
                                <ul className="settings-list settings-list-striped">
                                    {members.map((m) => (
                                        <li key={m.email} className="settings-list-row team-members-row">
                                            <div className="team-members-main">
                                                <div className="team-members-email">{m.email}</div>
                                                <span className="team-members-role-pill">{m.role || "member"}</span>
                                            </div>

                                            <button
                                                className="settings-button-danger settings-button-ghost"
                                                onClick={() => removeMember(m.email)}
                                                disabled={loadingMembers}
                                            >
                                                Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
