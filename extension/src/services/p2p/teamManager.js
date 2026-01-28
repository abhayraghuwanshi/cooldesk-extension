import { p2pStorage } from './storageService';

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
            }

            // Always run cleanup and ensure seed data exists for the default team
            // This handles: 1) First time setup, 2) Cleanup of old duplicates, 3) Migration from old ID formats
            try {
                await p2pStorage.initializeTeamStorage(defaultTeamId);

                // Clean up duplicate notices first (runs every init to fix existing duplicates)
                const notices = p2pStorage.getSharedNotices(defaultTeamId);
                const existingNotices = notices.toArray();

                const indicesToDelete = [];
                const seenIds = new Set();
                existingNotices.forEach((note, index) => {
                    // Remove old dynamic IDs (sticky_1_xxx, sticky_2_xxx format)
                    if (note.id && (note.id.startsWith('sticky_1_') || note.id.startsWith('sticky_2_'))) {
                        indicesToDelete.push(index);
                    } else if (note.id) {
                        // Remove duplicates of stable IDs
                        if (seenIds.has(note.id)) {
                            indicesToDelete.push(index);
                        } else {
                            seenIds.add(note.id);
                        }
                    }
                });

                if (indicesToDelete.length > 0) {
                    console.log(`[Team Manager] Cleaning up ${indicesToDelete.length} old/duplicate notices`);
                    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
                        notices.delete(indicesToDelete[i], 1);
                    }
                }

                // Seed default resources if missing
                if (!hasDefaultTeam) {
                    console.log('[Team Manager] Seeding default resources...');

                    // 1. Seed Default Notes (Guides)
                    const existingItems = await p2pStorage.getTeamItems(defaultTeamId);

                    const DEFAULT_NOTES = [
                        {
                            id: 'guide_welcome',
                            title: 'Welcome to CoolDesk',
                            folder: 'Getting Started',
                            type: 'richtext',
                            text: `<p>CoolDesk is your personal productivity companion that helps you organize your browsing, take notes, and stay focused.</p>
<h2>Quick Tips</h2>
<ul>
<li><strong>Create Notes</strong> - Click the + button to create new notes</li>
<li><strong>Organize with Folders</strong> - Use folders to categorize your notes</li>
<li><strong>Rich Text Editing</strong> - Format your notes with bold, italic, headings, and lists</li>
<li><strong>Voice Input</strong> - Use the microphone button to dictate notes</li>
<li><strong>Auto-Save</strong> - Your notes are automatically saved as you type</li>
</ul>
<p>Check out the other notes in the <strong>Getting Started</strong> folder for more tips!</p>`
                        },
                        {
                            id: 'guide_workspaces',
                            title: 'Workspaces & Tab Management',
                            folder: 'Getting Started',
                            type: 'richtext',
                            text: `<p>CoolDesk helps you organize your browser tabs into workspaces for better productivity.</p>
<h2>Workspace Features</h2>
<ul>
<li><strong>Create Workspaces</strong> - Group related tabs together (Work, Research, Personal)</li>
<li><strong>Auto Tab Cleanup</strong> - Automatically close inactive tabs to reduce clutter</li>
<li><strong>Recently Closed</strong> - Easily restore tabs you accidentally closed</li>
<li><strong>Tab Limits</strong> - Set limits to prevent tab overload</li>
</ul>
<h2>Protected Tabs</h2>
<p>The following tabs are never auto-closed:</p>
<ul>
<li>Pinned tabs</li>
<li>Active/current tab</li>
<li>Tabs playing audio/video</li>
<li>Important domains (Gmail, GitHub, etc.)</li>
</ul>`
                        },
                        {
                            id: 'guide_highlights',
                            title: 'Highlights & URL Notes',
                            folder: 'Getting Started',
                            type: 'richtext',
                            text: `<p>Capture information from any webpage directly into CoolDesk!</p>
<h2>Text Highlights</h2>
<ul>
<li><strong>Select any text</strong> on a webpage</li>
<li><strong>Click the CoolDesk button</strong> that appears</li>
<li>Your highlight is saved with the source URL</li>
<li>Find all highlights in the <strong>Highlights</strong> folder</li>
</ul>
<h2>URL Notes</h2>
<ul>
<li><strong>Add notes</strong> specific to any webpage</li>
<li>Notes are linked to the URL for easy reference</li>
<li>Find all URL notes in the <strong>URL Notes</strong> folder</li>
</ul>
<p><em>Tip: Highlights and URL notes automatically include the source webpage link!</em></p>`
                        },
                        {
                            id: 'guide_keyboard',
                            title: 'Keyboard Shortcuts & Tips',
                            type: 'richtext',
                            folder: 'Getting Started',
                            text: `<p>Speed up your workflow with these shortcuts:</p>
<h2>Note Editor</h2>
<ul>
<li><strong>Ctrl+B</strong> - Bold text</li>
<li><strong>Ctrl+I</strong> - Italic text</li>
<li><strong>Tab</strong> - Insert indent</li>
</ul>
<h2>Pro Tips</h2>
<ul>
<li>Use checkboxes for task lists</li>
<li>Pin important notes to keep them at the top</li>
<li>Use search to quickly find notes</li>
</ul>
<h2>Themes</h2>
<p>Customize CoolDesk with different themes! Go to settings to switch between light, dark, and accent color themes.</p>`
                        }
                    ];

                    for (const note of DEFAULT_NOTES) {
                        const noteExists = existingItems.some(item =>
                            item.type === 'NOTE_SHARE' && item.payload?.id === note.id
                        );
                        if (!noteExists) {
                            await p2pStorage.addItemToTeam(defaultTeamId, {
                                type: 'NOTE_SHARE',
                                payload: {
                                    ...note,
                                    createdAt: Date.now(),
                                    updatedAt: Date.now()
                                },
                                timestamp: Date.now()
                            });
                        }
                    }

                    // 2. Seed Shared Context
                    const contextMap = p2pStorage.getSharedContext(defaultTeamId);
                    if (contextMap) {
                        contextMap.set('communityGoal', 'Build a supportive productivity community!');
                        contextMap.set('importantNotice', '🎉 Welcome to the new Cooldesk Community Space!');
                        contextMap.set('todaysFocus', 'Explore the new features and share your feedback.');
                        contextMap.set('communityAlert', false);
                    }

                    // 3. Seed URLs
                    const seedUrls = [
                        {
                            id: 'url_reddit',
                            title: 'Join the Reddit Community',
                            url: 'https://www.reddit.com/r/cooldesk/',
                            addedBy: 'Cooldesk Team',
                            addedAt: Date.now(),
                            type: 'link'
                        },
                        {
                            id: 'url_website',
                            title: 'Official Website',
                            url: 'https://cool-desk.com/',
                            addedBy: 'Cooldesk Team',
                            addedAt: Date.now(),
                            type: 'link'
                        },
                        {
                            id: 'url_search',
                            title: 'Search CoolDesk',
                            url: 'https://cool-desk.com/search',
                            addedBy: 'Cooldesk Team',
                            addedAt: Date.now(),
                            type: 'link'
                        }
                    ];

                    for (const urlItem of seedUrls) {
                        const exists = existingItems.some(item =>
                            item.id === urlItem.id || item.url === urlItem.url
                        );
                        if (!exists) {
                            await p2pStorage.addItemToTeam(defaultTeamId, urlItem);
                        }
                    }

                    console.log('[Team Manager] Default resources seeded successfully');
                }

                // 4. Ensure default sticky notes exist (after cleanup)
                const cleanedNotices = notices.toArray();
                const stickyNotes = [
                    {
                        id: 'sticky_welcome',
                        text: 'Welcome to the Cooldesk Community Space! 🚀\n\nThis is a shared space for all CoolDesk users.',
                        styleIndex: 0,
                        pinIndex: 0,
                        rotation: -1.5,
                        createdAt: Date.now()
                    },
                    {
                        id: 'sticky_explore',
                        text: 'Feel free to explore shared resources and connect with others.',
                        styleIndex: 2,
                        pinIndex: 1,
                        rotation: 1.2,
                        createdAt: Date.now()
                    }
                ];

                for (const stickyNote of stickyNotes) {
                    const exists = cleanedNotices.some(n => n.id === stickyNote.id);
                    if (!exists) {
                        notices.push([stickyNote]);
                    }
                }
            } catch (seedError) {
                console.error('[Team Manager] Failed to initialize default team storage:', seedError);
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
