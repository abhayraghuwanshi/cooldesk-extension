import { WebrtcProvider } from 'y-webrtc';
import { p2pStorage } from './storageService';
import { teamManager } from './teamManager';

// Public signaling servers for P2P discovery
// These are just for "handshaking" (SDP exchange), actual data goes P2P or via TURN if behind NAT
const SIGNALING_SERVERS = [
    'wss://signaling-server.raghuwanshi-abhay405.workers.dev'
];

class P2PSyncService {
    constructor() {
        this.providers = new Map(); // teamId -> WebrtcProvider
        this.peerCounts = new Map(); // teamId -> number
        this.listeners = new Set();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach(l => l(this.peerCounts));
    }

    getPeerCount(teamId) {
        return this.peerCounts.get(teamId) || 0;
    }

    /**
     * Start syncing for a specific team
     * @param {string} teamId 
     * @param {string} encryptionKey 
     */
    async connectTeam(teamId, encryptionKey) {
        if (this.providers.has(teamId)) {
            console.log(`[P2P Sync] Already connected to team ${teamId}`);
            return;
        }

        console.log(`[P2P Sync] Connecting to team ${teamId}...`);

        // ensure storage is ready
        const ydoc = await p2pStorage.initializeTeamStorage(teamId);

        // Initialize WebRTC Provider
        // Room Name = Team ID (Discovery Key)
        // Note: Using room-specific path as per user's server requirement
        const signalingUrl = `${SIGNALING_SERVERS[0]}/${teamId}`;
        const provider = new WebrtcProvider(teamId, ydoc, {
            signaling: [signalingUrl],
            password: encryptionKey, // Enforces E2EE
            awareness: new (await import('y-protocols/awareness')).Awareness(ydoc)
        });

        // Monitor connection status
        provider.on('status', (event) => {
            console.log(`[P2P Sync] Team ${teamId} status:`, event.status);
        });

        provider.on('peers', (event) => {
            const count = event.webrtcPeers ? event.webrtcPeers.length : 0;
            console.log(`[P2P Sync] Team ${teamId} peers:`, count);
            this.peerCounts.set(teamId, count);
            this.notify();
        });

        this.providers.set(teamId, provider);
        // Initialize count
        this.peerCounts.set(teamId, 0);
        this.notify();
    }

    /**
     * Stop syncing a team
     * @param {string} teamId 
     */
    disconnectTeam(teamId) {
        const provider = this.providers.get(teamId);
        if (provider) {
            provider.destroy();
            this.providers.delete(teamId);
            this.peerCounts.delete(teamId);
            this.notify();
            console.log(`[P2P Sync] Disconnected team ${teamId}`);
        }
    }

    /**
     * Get awareness instance for presence (avatars)
     * @param {string} teamId 
     */
    getAwareness(teamId) {
        return this.providers.get(teamId)?.awareness;
    }

    /**
     * Initialize all active teams on startup
     */
    async init() {
        await teamManager.init();
        const teams = teamManager.getTeams();

        // Connect to all saved teams to receive updates
        // Or we might want to only connect to the "Active" one to save bandwidth
        // "new-feature.md" says: "When the extension starts, it 'joins' the rooms for all active teams."

        for (const team of teams) {
            await this.connectTeam(team.id, team.encryptionKey);
        }

        // Listen for team changes (added/removed)
        teamManager.subscribe(async ({ teams }) => {
            const currentIds = new Set(this.providers.keys());
            const newIds = new Set(teams.map(t => t.id));

            // Connect new
            for (const team of teams) {
                if (!currentIds.has(team.id)) {
                    await this.connectTeam(team.id, team.encryptionKey);
                }
            }

            // Disconnect removed
            for (const id of currentIds) {
                if (!newIds.has(id)) {
                    this.disconnectTeam(id);
                    await p2pStorage.closeTeamStorage(id);
                }
            }
        });
    }
}

export const p2pSyncService = new P2PSyncService();
