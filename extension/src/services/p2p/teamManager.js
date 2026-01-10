import { cryptoUtils } from './cryptoUtils';

const TEAMS_STORAGE_KEY = 'cooldesk_teams';
const ACTIVE_TEAM_KEY = 'cooldesk_active_team_id';

class TeamManager {
    constructor() {
        this.teams = [];
        this.activeTeamId = null;
        this.listeners = new Set();
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        try {
            const result = await chrome.storage.local.get([TEAMS_STORAGE_KEY, ACTIVE_TEAM_KEY]);
            this.teams = result[TEAMS_STORAGE_KEY] || [];
            this.activeTeamId = result[ACTIVE_TEAM_KEY] || null;
            this.initialized = true;
            console.log('[Team Manager] Initialized with teams:', this.teams.length);
        } catch (e) {
            console.error('[Team Manager] Failed to initialize:', e);
            // Non-blocking error, allow retries
        }
    }

    /**
     * Add a new team
     * @param {string} name - User friendly name
     * @param {string} secretPhrase - The 4-word secret
     * @returns {Promise<Object>} The created team object
     */
    async addTeam(name, secretPhrase) {
        if (!name || !secretPhrase) {
            throw new Error('Name and secret phrase are required');
        }

        // Derive keys
        const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

        // Check duplicates
        if (this.teams.find(t => t.id === roomId)) {
            throw new Error('Team already exists');
        }

        const newTeam = {
            id: roomId, // The derived Room ID acts as the unique Team ID
            name,
            secretPhrase, // We store this locally for convenience (could be optional for higher security)
            encryptionKey, // Derived and cached
            createdAt: Date.now(),
            lastSync: null
        };

        this.teams.push(newTeam);
        await this._saveTeams();

        // Auto-select if first team
        if (this.teams.length === 1) {
            await this.setActiveTeam(newTeam.id);
        }

        this._notifyListeners();
        return newTeam;
    }

    async removeTeam(teamId) {
        this.teams = this.teams.filter(t => t.id !== teamId);
        await this._saveTeams();

        if (this.activeTeamId === teamId) {
            await this.setActiveTeam(null);
        }

        this._notifyListeners();
    }

    async setActiveTeam(teamId) {
        this.activeTeamId = teamId;
        await chrome.storage.local.set({ [ACTIVE_TEAM_KEY]: teamId });
        this._notifyListeners();
    }

    getActiveTeam() {
        return this.teams.find(t => t.id === this.activeTeamId);
    }

    getTeam(teamId) {
        return this.teams.find(t => t.id === teamId);
    }

    getTeams() {
        return this.teams;
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    async _saveTeams() {
        await chrome.storage.local.set({ [TEAMS_STORAGE_KEY]: this.teams });
    }

    _notifyListeners() {
        this.listeners.forEach(cb => cb({
            teams: this.teams,
            activeTeamId: this.activeTeamId
        }));
    }
}

export const teamManager = new TeamManager();
