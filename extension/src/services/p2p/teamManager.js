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

            // Check if default Cooldesk team exists, if not create it
            const defaultTeamName = 'Cooldesk Community';
            const defaultTeamSecret = 'cooldesk-community-default-secret';

            // Lazy load cryptoUtils
            const { cryptoUtils } = await import('./cryptoUtils');
            const { roomId: defaultTeamId } = cryptoUtils.deriveKeys(defaultTeamSecret);

            const hasDefaultTeam = this.teams.some(t => t.id === defaultTeamId);

            if (!hasDefaultTeam) {
                console.log('[Team Manager] Creating default Cooldesk team');
                // Create as Read-Only for normal users (createdByMe: false)
                // If you are the admin, you should manually update this value in storage or use a dev flag
                await this.addTeam(defaultTeamName, defaultTeamSecret, { createdByMe: false });

                // Add default resources to the new team (This requires p2pStorage which is imported in TeamView, 
                // so we might need a better way to seed data, but for now just creating the team is the first step.
                // The actual resource seeding might need to happen where p2pStorage is available or by extending this manager)
            }

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
    async addTeam(name, secretPhrase, options = {}) {
        if (!name || !secretPhrase) {
            throw new Error('Name and secret phrase are required');
        }

        // Lazy load cryptoUtils
        const { cryptoUtils } = await import('./cryptoUtils');

        // Derive keys
        const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

        // Check duplicates
        const existingTeam = this.teams.find(t => t.id === roomId);
        if (existingTeam) {
            // If team exists but wasn't created by this user, just return it
            return existingTeam;
        }

        const newTeam = {
            id: roomId, // The derived Room ID acts as the unique Team ID
            name,
            secretPhrase, // We store this locally for convenience
            encryptionKey, // Derived and cached
            createdAt: Date.now(),
            createdByMe: options.createdByMe !== undefined ? options.createdByMe : true, // Default to true unless specified
            lastSync: null,
            adminPrivateKey: null,
            adminPublicKey: null
        };

        // SECURITY: Admin Keys
        // If we created this team OR are importing a recovery kit, we set the keys.
        if (options.importedKeys) {
            // Restore from Recovery Kit
            newTeam.adminPrivateKey = options.importedKeys.privateKey;
            newTeam.adminPublicKey = options.importedKeys.publicKey;
            newTeam.createdByMe = true; // Implicitly true if we have keys
            console.log('[TeamManager] Restored Admin Keys from import');
        } else if (newTeam.createdByMe) {
            // New Team Creation
            const keys = cryptoUtils.generateAdminKeys();
            newTeam.adminPrivateKey = keys.privateKey;
            newTeam.adminPublicKey = keys.publicKey;
            console.log('[TeamManager] Generated Admin Keys for new team');
        }

        this.teams.push(newTeam);
        await this._saveTeams();

        // Auto-select if first team
        if (this.teams.length === 1) {
            await this.setActiveTeam(newTeam.id);
        }

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

    /**
     * Rename a team (admin only)
     * @param {string} teamId - The team ID to rename
     * @param {string} newName - The new name for the team
     * @returns {Promise<Object>} The updated team object
     */
    async renameTeam(teamId, newName) {
        if (!newName || !newName.trim()) {
            throw new Error('Team name is required');
        }

        const team = this.teams.find(t => t.id === teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        if (!team.createdByMe) {
            throw new Error('Only team admins can rename the team');
        }

        team.name = newName.trim();
        await this._saveTeams();
        this._notifyListeners();
        return team;
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
