import { WebrtcProvider } from 'y-webrtc';
import { p2pStorage } from './storageService';
import { teamManager } from './teamManager';
import { userProfileService } from './userProfileService';

// Public signaling servers for P2P discovery
// These are just for "handshaking" (SDP exchange), actual data goes P2P or via TURN if behind NAT
const SIGNALING_SERVERS = [
    'wss://signaling-server.raghuwanshi-abhay405.workers.dev'
];

class P2PSyncService {
    constructor() {
        this.providers = new Map(); // teamId -> WebrtcProvider
        this.peerCounts = new Map(); // teamId -> number
        this.peerDetails = new Map(); // teamId -> Array of peer objects
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
     * Get detailed peer information for a team
     * @param {string} teamId 
     * @returns {Array} Array of peer objects with {id, name, color, lastSeen}
     */
    getPeers(teamId) {
        const awareness = this.getAwareness(teamId);
        if (!awareness) return [];

        const peers = [];
        const states = awareness.getStates();

        states.forEach((state, clientId) => {
            // Skip local client
            if (clientId === awareness.clientID) return;

            peers.push({
                id: clientId,
                name: state.user?.name || `User ${clientId.toString().substring(0, 6)}`,
                color: state.user?.color || '#3b82f6',
                lastSeen: state.lastSeen || Date.now()
            });
        });

        return peers;
    }

    /**
     * Get all team members (both online and offline)
     * @param {string} teamId 
     * @returns {Array} Array of all members with online status
     */
    getAllMembers(teamId) {
        try {
            const membersMap = p2pStorage.getSharedMembers(teamId);
            const awareness = this.getAwareness(teamId);
            const onlinePeerIds = new Set();

            // Get currently online peer IDs
            if (awareness) {
                const states = awareness.getStates();
                states.forEach((state, clientId) => {
                    if (clientId !== awareness.clientID) {
                        onlinePeerIds.add(clientId.toString());
                    }
                });
            }

            // Convert members map to array with online status
            const members = [];
            membersMap.forEach((member, memberId) => {
                members.push({
                    ...member,
                    isOnline: onlinePeerIds.has(memberId)
                });
            });

            // Sort: online first, then by join date
            members.sort((a, b) => {
                if (a.isOnline !== b.isOnline) {
                    return b.isOnline ? 1 : -1;
                }
                return a.joinedAt - b.joinedAt;
            });

            return members;
        } catch (error) {
            console.error(`[P2P Sync] Error getting members for team ${teamId}:`, error);
            return [];
        }
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

        // Listen to awareness changes for peer details
        const awareness = provider.awareness;
        awareness.on('change', () => {
            this.peerDetails.set(teamId, this.getPeers(teamId));

            // Persist members to shared storage
            const states = awareness.getStates();
            states.forEach((state, clientId) => {
                if (clientId !== awareness.clientID && state.user) {
                    p2pStorage.addMemberToTeam(teamId, {
                        id: clientId,
                        name: state.user.name,
                        color: state.user.color,
                        isAdmin: state.user.isAdmin || false
                    });
                }
            });

            this.notify();
        });

        // Set local user info
        const username = await userProfileService.getUsername();
        const localUserColor = `hsl(${Math.random() * 360}, 70%, 60%)`;
        const team = teamManager.getTeam(teamId);
        const isAdmin = team?.createdByMe || false;

        awareness.setLocalStateField('user', {
            name: username,
            color: localUserColor,
            isAdmin: isAdmin,
            lastSeen: Date.now()
        });

        // Add self to members list
        p2pStorage.addMemberToTeam(teamId, {
            id: awareness.clientID,
            name: username,
            color: localUserColor,
            isAdmin: isAdmin
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
