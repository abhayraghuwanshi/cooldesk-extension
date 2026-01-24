import { WebrtcProvider } from 'y-webrtc';
import { p2pStorage } from './storageService';
import { tabCoordinator } from './tabCoordinator';
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
        this.pausedTeams = new Map(); // teamId -> { encryptionKey } for paused teams
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
            // Initialize tab coordination for this team
            await tabCoordinator.initTeam(teamId);
            console.log('[P2P Sync] Tab coordination initialized');

            // Subscribe to leader changes
            tabCoordinator.subscribe(teamId, (event) => {
                if (event.type === 'LEADER_CHANGED') {
                    console.log('[P2P Sync] Leader changed:', event.payload);
                    if (event.payload.isLeader) {
                        // We became leader, create P2P connection
                        this.createP2PConnection(teamId, encryptionKey);
                    } else {
                        // We are now follower, disconnect P2P
                        this.disconnectP2P(teamId);
                    }
                }
            });

            // ensure storage is ready
            const ydoc = await p2pStorage.initializeTeamStorage(teamId);

            // Double-check after async operation
            if (this.providers.has(teamId)) {
                console.log(`[P2P Sync] Team ${teamId} was connected while waiting for storage`);
                return this.providers.get(teamId);
            }

            // Only create P2P connection if we are the leader
            const isLeader = tabCoordinator.isLeader(teamId);
            console.log('[P2P Sync] Leadership check:', {
                isLeader,
                isLeaderTab: tabCoordinator.isLeaderTab,
                leaderId: tabCoordinator.getLeaderId(teamId),
                tabId: tabCoordinator.getTabId()
            });

            if (isLeader) {
                console.log('[P2P Sync] This tab is the leader, creating P2P connection');
                return await this.createP2PConnection(teamId, encryptionKey);
            } else {
                console.log('[P2P Sync] This tab is a follower, waiting for leader');
                // Follower mode - will receive updates via BroadcastChannel
                return null;
            }
        } catch (error) {
            console.error(`[P2P Sync] Error connecting to team ${teamId}:`, error);
            throw error;
        }
    }

    /**
     * Create P2P connection (leader only)
     */
    async createP2PConnection(teamId, encryptionKey) {
        if (this.providers.has(teamId)) {
            console.log(`[P2P Sync] P2P connection already exists for team ${teamId}`);
            return this.providers.get(teamId);
        }

        console.log(`[P2P Sync] Creating P2P connection for team ${teamId}`);

        try {
            const ydoc = p2pStorage.getDoc(teamId);
            if (!ydoc) {
                throw new Error('Team doc not initialized');
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
                // Reduce signaling frequency
                maxConns: 20,
                filterBcConns: true, // Filter broadcast connections to reduce noise
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
            let notifyTimeout = null;

            // Debounced notify to prevent excessive updates
            const debouncedNotify = () => {
                if (notifyTimeout) clearTimeout(notifyTimeout);
                notifyTimeout = setTimeout(() => this.notify(), 500);
            };

            // Fetch team object first
            const team = teamManager.getTeam(teamId);

            // 1. Publish Public Key if we are Admin (One-time)
            if (team?.createdByMe && team?.adminPublicKey) {
                p2pStorage.ensureTeamMetadata(teamId, team.adminPublicKey);
            }

            // 2. Set local user info with Signature if Admin
            const username = await userProfileService.getUsername();
            const browserId = await userProfileService.getBrowserId();
            const localUserColor = `hsl(${Math.random() * 360}, 70%, 60%)`;
            const isAdmin = team?.createdByMe && !!team?.adminPrivateKey;
            let adminSignature = null;

            if (isAdmin) {
                // Sign our username with our private key
                adminSignature = await crypto.subtle.sign(
                    { name: 'ECDSA', hash: 'SHA-256' },
                    team.adminPrivateKey,
                    new TextEncoder().encode(username)
                );
                adminSignature = btoa(String.fromCharCode(...new Uint8Array(adminSignature)));
            }

            // Set awareness state
            awareness.setLocalStateField('user', {
                name: username,
                browserId: browserId,
                color: localUserColor,
                isAdmin: isAdmin,
                adminSignature: adminSignature
            });

            // 3. Observe awareness changes
            awareness.on('change', async ({ added, updated, removed }) => {
                // Only process added peers (not updates - they cause too many events)
                if (added.length === 0 && updated.length === 0 && removed.length === 0) return;

                this.peerDetails.set(teamId, this.getPeers(teamId));

                for (const clientId of [...added, ...updated]) {
                    if (clientId === awareness.clientID) continue; // Skip self

                    const state = awareness.getStates().get(clientId);
                    if (!state?.user) continue;

                    const memberKey = state.user.browserId || state.user.name; // Use browserId if available
                    if (processedMembers.has(memberKey)) continue;

                    // Validate Admin Claim
                    let validatedIsAdmin = false;
                    if (state.user.isAdmin && state.user.adminSignature) {
                        const publicKeyData = p2pStorage.getTeamMetadata(teamId)?.adminPublicKey;
                        if (publicKeyData) {
                            try {
                                const publicKey = await crypto.subtle.importKey(
                                    'jwk',
                                    publicKeyData,
                                    { name: 'ECDSA', namedCurve: 'P-256' },
                                    false,
                                    ['verify']
                                );
                                const signature = Uint8Array.from(atob(state.user.adminSignature), c => c.charCodeAt(0));
                                const isValid = await crypto.subtle.verify(
                                    { name: 'ECDSA', hash: 'SHA-256' },
                                    publicKey,
                                    signature,
                                    new TextEncoder().encode(state.user.name)
                                );
                                validatedIsAdmin = isValid;
                                if (!isValid) {
                                    console.warn(`[P2P Sync] Invalid Admin signature for ${state.user.name}`);
                                }
                            } catch (err) {
                                console.error('[P2P Sync] Error verifying Admin signature:', err);
                            }
                        } else {
                            console.warn(`[P2P Sync] No Public Key found to verify Admin claim for ${state.user.name}`);
                        }
                    }

                    p2pStorage.addMemberToTeam(teamId, {
                        id: clientId.toString(),
                        browserId: state.user.browserId,
                        name: state.user.name,
                        color: state.user.color,
                        isAdmin: validatedIsAdmin
                    });
                    processedMembers.add(memberKey);
                    console.log(`[P2P Sync] Added member ${state.user.name} to team ${teamId}`);
                }

                if (removed.length > 0) {
                    console.log(`[P2P Sync] ${removed.length} peer(s) left team ${teamId}`);
                }

                debouncedNotify();
            });

            // Add self to members list
            p2pStorage.addMemberToTeam(teamId, {
                id: awareness.clientID.toString(), // Ensure ID is always a string
                browserId: browserId,
                name: username,
                color: localUserColor,
                isAdmin: isAdmin
            });

            this.providers.set(teamId, provider);
            // Initialize count
            this.peerCounts.set(teamId, 0);

            // Clean up any duplicate members that may exist
            p2pStorage.cleanupDuplicateMembers(teamId);

            // fixAdminStatus removed: it causes issues by demoting the actual creator if timestamps are misaligned
            // Admin status is now handled authoritatively by addMemberToTeam based on local team.createdByMe
            // p2pStorage.fixAdminStatus(teamId);

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
     * Disconnect P2P connection (when becoming follower)
     */
    disconnectP2P(teamId) {
        const provider = this.providers.get(teamId);
        if (provider) {
            console.log(`[P2P Sync] Disconnecting P2P for team ${teamId} (becoming follower)`);
            provider.destroy();
            this.providers.delete(teamId);
            this.peerCounts.set(teamId, 0);
            this.notify();
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
            this.pausedTeams.delete(teamId);
            this.notify();
            console.log(`[P2P Sync] Disconnected team ${teamId}`);
        }
    }

    /**
     * Pause sync for a team (stops WebSocket but keeps data)
     * @param {string} teamId
     */
    pauseSync(teamId) {
        const provider = this.providers.get(teamId);
        if (provider) {
            // Store encryption key for reconnection
            const team = teamManager.getTeam(teamId);
            this.pausedTeams.set(teamId, { encryptionKey: team?.encryptionKey });

            // Disconnect the WebRTC provider
            provider.disconnect();
            console.log(`[P2P Sync] Paused sync for team ${teamId}`);
            this.notify();
        }
    }

    /**
     * Resume sync for a paused team
     * @param {string} teamId
     */
    resumeSync(teamId) {
        const provider = this.providers.get(teamId);
        if (provider && this.pausedTeams.has(teamId)) {
            provider.connect();
            this.pausedTeams.delete(teamId);
            console.log(`[P2P Sync] Resumed sync for team ${teamId}`);
            this.notify();
        }
    }

    /**
     * Check if sync is paused for a team
     * @param {string} teamId
     * @returns {boolean}
     */
    isSyncPaused(teamId) {
        return this.pausedTeams.has(teamId);
    }

    /**
     * Check if team is connected (has active provider)
     * @param {string} teamId
     * @returns {boolean}
     */
    isConnected(teamId) {
        return this.providers.has(teamId) && !this.pausedTeams.has(teamId);
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
