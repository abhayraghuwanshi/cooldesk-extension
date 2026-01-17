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
            // Use a Map to deduplicate by name (keep most recent)
            const uniqueMembers = new Map();

            membersMap.forEach((member, memberKey) => {
                const memberName = member.name;
                const existingMember = uniqueMembers.get(memberName);

                // If we already have this member name, keep the one with the latest lastSeen
                if (!existingMember || member.lastSeen > existingMember.lastSeen) {
                    uniqueMembers.set(memberName, {
                        ...member,
                        isOnline: onlinePeerIds.has(member.id) // Use member.id, not memberKey
                    });
                }
            });

            // Convert to array
            const members = Array.from(uniqueMembers.values());

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
        // Check if already connected or connecting
        if (this.providers.has(teamId)) {
            console.log(`[P2P Sync] Already connected to team ${teamId}`);
            return this.providers.get(teamId);
        }

        console.log(`[P2P Sync] Connecting to team ${teamId}...`);

        try {
            // ensure storage is ready
            const ydoc = await p2pStorage.initializeTeamStorage(teamId);

            // Double-check after async operation
            if (this.providers.has(teamId)) {
                console.log(`[P2P Sync] Team ${teamId} was connected while waiting for storage`);
                return this.providers.get(teamId);
            }


            // Initialize WebRTC Provider
            // Room Name = Team ID (Discovery Key)
            // Note: Using room-specific path as per user's server requirement
            const signalingUrl = `${SIGNALING_SERVERS[0]}/${teamId}`;
            console.log(`[P2P Sync] Creating WebRTC provider for team ${teamId} with signaling:`, signalingUrl);
            console.log(`[P2P Sync] Using encryption key:`, encryptionKey ? '***' + encryptionKey.slice(-4) : 'NONE');

            // Create awareness before provider to avoid timing issues
            const { Awareness } = await import('y-protocols/awareness');
            const awareness = new Awareness(ydoc);
            console.log(`[P2P Sync] Awareness created for team ${teamId}, clientID:`, awareness.clientID);

            const provider = new WebrtcProvider(teamId, ydoc, {
                signaling: [signalingUrl],
                password: encryptionKey, // Enforces E2EE
                awareness: awareness,
                // Add TURN servers for NAT traversal
                peerOpts: {
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' },
                            {
                                urls: 'turn:openrelay.metered.ca:80',
                                username: 'openrelayproject',
                                credential: 'openrelayproject'
                            },
                            {
                                urls: 'turn:openrelay.metered.ca:443',
                                username: 'openrelayproject',
                                credential: 'openrelayproject'
                            }
                        ]
                    }
                }
            });
            console.log(`[P2P Sync] WebRTC provider created for team ${teamId}`);

            // Monitor connection status
            provider.on('status', (event) => {
                console.log(`[P2P Sync] Team ${teamId} status:`, event.status);
                if (event.status === 'disconnected') {
                    console.error(`[P2P Sync] ❌ Team ${teamId} DISCONNECTED!`);
                }
            });

            provider.on('synced', (event) => {
                console.log(`[P2P Sync] Team ${teamId} SYNCED:`, event.synced);
                if (!event.synced) {
                    console.warn(`[P2P Sync] ⚠️ Team ${teamId} is NOT synced!`);
                } else {
                    console.log(`[P2P Sync] ✅ Team ${teamId} successfully synced!`);
                }
            });

            provider.on('peers', (event) => {
                const count = event.webrtcPeers ? event.webrtcPeers.length : 0;
                console.log(`[P2P Sync] Team ${teamId} peers:`, count, 'WebRTC peers:', event.webrtcPeers);

                // Enhanced peer connection debugging
                if (event.webrtcPeers && event.webrtcPeers.length > 0) {
                    console.log(`[P2P Sync] ✅ Connected to ${count} peer(s)`);

                    // Log WebRTC connection states if available
                    if (provider.room && provider.room.webrtcConns) {
                        provider.room.webrtcConns.forEach((conn, peerId) => {
                            console.log(`[P2P Sync] Peer ${peerId} connection state:`, {
                                connected: conn.connected,
                                connectionState: conn.peer?.connectionState,
                                iceConnectionState: conn.peer?.iceConnectionState,
                                iceGatheringState: conn.peer?.iceGatheringState
                            });
                        });
                    }
                } else {
                    console.warn(`[P2P Sync] ⚠️ No peers connected for team ${teamId}`);
                }

                this.peerCounts.set(teamId, count);
                this.notify();
            });

            // Listen to awareness changes for peer details
            const processedMembers = new Set(); // Track members we've already added

            awareness.on('change', ({ added, updated, removed }) => {
                console.log(`[P2P Sync] Awareness change for team ${teamId}:`, {
                    added: added.length,
                    updated: updated.length,
                    removed: removed.length
                });

                this.peerDetails.set(teamId, this.getPeers(teamId));

                // Only process added or updated peers
                const peersToProcess = [...added, ...updated];

                if (peersToProcess.length > 0) {
                    console.log(`[P2P Sync] Processing ${peersToProcess.length} peer(s) for team ${teamId}`);
                }

                peersToProcess.forEach(clientId => {
                    if (clientId === awareness.clientID) return; // Skip self

                    const state = awareness.getStates().get(clientId);
                    if (!state || !state.user) {
                        console.warn(`[P2P Sync] Peer ${clientId} has no user state`);
                        return;
                    }

                    console.log(`[P2P Sync] Processing peer ${clientId}:`, state.user);

                    const memberKey = `${teamId}-${clientId.toString()}`;

                    // Only add if we haven't processed this member yet
                    if (!processedMembers.has(memberKey)) {
                        // Check if an admin already exists
                        const existingAdmin = p2pStorage.getTeamAdmin(teamId);

                        // Only allow admin status if:
                        // 1. They claim to be admin AND
                        // 2. No admin exists yet
                        const shouldBeAdmin = state.user.isAdmin && !existingAdmin;

                        p2pStorage.addMemberToTeam(teamId, {
                            id: clientId.toString(),
                            name: state.user.name,
                            color: state.user.color,
                            isAdmin: shouldBeAdmin
                        });
                        processedMembers.add(memberKey);
                        console.log(`[P2P Sync] Added member ${state.user.name} to team ${teamId}`);
                    }
                });

                if (removed.length > 0) {
                    console.log(`[P2P Sync] ${removed.length} peer(s) left team ${teamId}`);
                }

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
                id: awareness.clientID.toString(), // Ensure ID is always a string
                name: username,
                color: localUserColor,
                isAdmin: isAdmin
            });

            this.providers.set(teamId, provider);
            // Initialize count
            this.peerCounts.set(teamId, 0);

            // Clean up any duplicate members that may exist
            p2pStorage.cleanupDuplicateMembers(teamId);

            // Fix admin status to ensure only one admin exists
            p2pStorage.fixAdminStatus(teamId);

            this.notify();

            return provider;
        } catch (error) {
            console.error(`[P2P Sync] Error connecting to team ${teamId}:`, error);
            // Clean up on error
            this.providers.delete(teamId);
            this.peerCounts.delete(teamId);
            throw error;
        }
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
                    await p2pStorage.deleteTeamDatabase(id); // Delete the database completely
                }
            }
        });
    }
}

export const p2pSyncService = new P2PSyncService();
