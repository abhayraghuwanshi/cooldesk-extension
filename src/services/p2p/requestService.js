/**
 * P2P Request Service
 * Handles join requests and approvals for teams
 */

import { userProfileService } from './userProfileService';

class P2PRequestService {
    constructor() {
        this.pendingRequests = new Map(); // teamId -> Array of requests
        this.listeners = new Map(); // teamId -> Array of callbacks
        this.approvalListeners = []; // Callbacks for when user gets approved
    }

    /**
     * Send a join request to a team
     * @param {string} teamName - Name of the team to join
     * @param {string} teamId - ID of the team (hash of name + secret)
     * @returns {Promise<void>}
     */
    async sendJoinRequest(teamName, teamId) {
        const username = await userProfileService.getUsername();

        // Use a discovery room based on team name (not secret)
        // This allows requesters to connect without knowing the secret
        // IMPORTANT: Use normalized team name for both roomId and encryption key
        const normalizedTeamName = teamName.toLowerCase().replace(/\s+/g, '_');
        const discoveryRoomId = `discovery_${normalizedTeamName}`;

        const request = {
            id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            teamName,
            teamId: discoveryRoomId, // Use discovery room for now
            username,
            timestamp: Date.now(),
            type: 'JOIN_REQUEST'
        };

        console.log('[P2P Request] Sending join request to discovery room:', discoveryRoomId);

        // Create a temporary P2P connection to the discovery room
        const { p2pStorage } = await import('./storageService');
        const { p2pSyncService } = await import('./syncService');

        // Initialize storage for discovery room
        await p2pStorage.initializeTeamStorage(discoveryRoomId);

        // Connect to discovery room with normalized name as encryption key (must match admin's key)
        await p2pSyncService.connectTeam(discoveryRoomId, normalizedTeamName);

        // Wait a bit for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Broadcast request via awareness
        const provider = p2pSyncService.providers.get(discoveryRoomId);

        if (provider && provider.awareness) {
            // Use awareness to broadcast the request
            provider.awareness.setLocalStateField('joinRequest', request);

            console.log('[P2P Request] Request broadcasted to discovery room');

            // Keep the request active for 10 seconds
            setTimeout(() => {
                provider.awareness.setLocalStateField('joinRequest', null);
            }, 10000);
        } else {
            console.warn('[P2P Request] No provider available for discovery room');
        }

        return request;
    }

    /**
     * Listen for join requests on a team (admin only)
     * @param {string} teamId - Team ID to listen on
     * @param {function} callback - Called when request received
     * @returns {function} Unsubscribe function
     */
    listenForJoinRequests(teamId, callback) {
        console.log('[P2P Request] Listening for join requests on team:', teamId);

        // Store callback
        if (!this.listeners.has(teamId)) {
            this.listeners.set(teamId, []);
        }
        this.listeners.get(teamId).push(callback);

        // Set up awareness listener
        const setupListener = async () => {
            const { p2pSyncService } = await import('./syncService');
            const provider = p2pSyncService.providers.get(teamId);

            if (provider && provider.awareness) {
                const awarenessHandler = ({ added, updated, removed }) => {
                    const states = provider.awareness.getStates();

                    // Check all peer states for join requests
                    states.forEach((state, clientId) => {
                        if (state.joinRequest && state.joinRequest.teamId === teamId) {
                            const request = state.joinRequest;

                            // Check if we've already seen this request
                            const existing = this.pendingRequests.get(teamId) || [];
                            const isDuplicate = existing.some(r => r.id === request.id);

                            if (!isDuplicate) {
                                console.log('[P2P Request] Received join request:', request);

                                // Add to pending
                                this.pendingRequests.set(teamId, [...existing, request]);

                                // Notify all listeners
                                const listeners = this.listeners.get(teamId) || [];
                                listeners.forEach(cb => cb(request));
                            }
                        }
                    });
                };

                provider.awareness.on('change', awarenessHandler);

                // Return cleanup function
                return () => {
                    provider.awareness.off('change', awarenessHandler);
                };
            }
        };

        setupListener();

        // Return unsubscribe function
        return () => {
            const listeners = this.listeners.get(teamId) || [];
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        };
    }

    /**
     * Approve a join request
     * @param {string} teamId - Team ID
     * @param {object} request - The request object
     * @param {string} role - 'writer' or 'viewer'
     * @param {object} teamData - { secretPhrase, adminPrivateKey, adminPublicKey }
     * @returns {Promise<void>}
     */
    async approveJoinRequest(teamId, request, role, teamData) {
        console.log('[P2P Request] Approving request:', request.id, 'as', role);

        const approval = {
            type: 'JOIN_APPROVED',
            requestId: request.id,
            teamId,
            teamName: request.teamName,
            teamSecret: teamData.secretPhrase,
            role,
            approvedBy: await userProfileService.getUsername(),
            timestamp: Date.now()
        };

        // If writer role, generate signature
        if (role === 'writer' && teamData.adminPrivateKey) {
            const { cryptoUtils } = await import('./cryptoUtils');
            const signature = cryptoUtils.sign(
                `WRITER:${request.username}`,
                teamData.adminPrivateKey
            );
            approval.writerSignature = signature;
        }

        // Broadcast approval via awareness on the DISCOVERY ROOM
        // The requester is connected to the discovery room, not the actual team yet
        const discoveryRoomId = request.teamId; // This is already the discovery room ID from the request

        const { p2pSyncService } = await import('./syncService');
        const { p2pStorage } = await import('./storageService');

        // Ensure we're connected to the discovery room
        const normalizedTeamName = request.teamName.toLowerCase().replace(/\s+/g, '_');
        await p2pStorage.initializeTeamStorage(discoveryRoomId);
        await p2pSyncService.connectTeam(discoveryRoomId, normalizedTeamName);

        // Wait a bit for connection
        await new Promise(resolve => setTimeout(resolve, 500));

        const provider = p2pSyncService.providers.get(discoveryRoomId);

        if (provider && provider.awareness) {
            console.log('[P2P Request] Broadcasting approval to discovery room:', discoveryRoomId);
            // Set approval in awareness (will be picked up by requester)
            provider.awareness.setLocalStateField('joinApproval', approval);

            // Clear after 10 seconds (increased to give requester more time)
            setTimeout(() => {
                provider.awareness.setLocalStateField('joinApproval', null);
            }, 10000);
        } else {
            console.warn('[P2P Request] No provider available for discovery room:', discoveryRoomId);
        }

        // Add member to team (p2pStorage already imported above)
        p2pStorage.addMemberToTeam(teamId, {
            name: request.username,
            isAdmin: false,
            isWriter: role === 'writer',
            writerSignature: approval.writerSignature || null
        });

        // Remove from pending
        const pending = this.pendingRequests.get(teamId) || [];
        this.pendingRequests.set(
            teamId,
            pending.filter(r => r.id !== request.id)
        );

        console.log('[P2P Request] Approval sent:', approval);
    }

    /**
     * Deny a join request
     * @param {string} teamId - Team ID
     * @param {object} request - The request object
     * @returns {Promise<void>}
     */
    async denyJoinRequest(teamId, request) {
        console.log('[P2P Request] Denying request:', request.id);

        const denial = {
            type: 'JOIN_DENIED',
            requestId: request.id,
            teamId,
            teamName: request.teamName,
            deniedBy: await userProfileService.getUsername(),
            timestamp: Date.now()
        };

        // Broadcast denial on the DISCOVERY ROOM where requester is connected
        const discoveryRoomId = request.teamId;

        const { p2pSyncService } = await import('./syncService');
        const { p2pStorage } = await import('./storageService');

        // Ensure we're connected to the discovery room
        const normalizedTeamName = request.teamName.toLowerCase().replace(/\s+/g, '_');
        await p2pStorage.initializeTeamStorage(discoveryRoomId);
        await p2pSyncService.connectTeam(discoveryRoomId, normalizedTeamName);

        await new Promise(resolve => setTimeout(resolve, 500));

        const provider = p2pSyncService.providers.get(discoveryRoomId);

        if (provider && provider.awareness) {
            console.log('[P2P Request] Broadcasting denial to discovery room:', discoveryRoomId);
            provider.awareness.setLocalStateField('joinDenial', denial);

            setTimeout(() => {
                provider.awareness.setLocalStateField('joinDenial', null);
            }, 10000);
        }

        // Remove from pending
        const pending = this.pendingRequests.get(teamId) || [];
        this.pendingRequests.set(
            teamId,
            pending.filter(r => r.id !== request.id)
        );
    }

    /**
     * Listen for approval/denial (requester side)
     * @param {function} callback - Called with approval or denial
     * @returns {function} Unsubscribe function
     */
    listenForApproval(callback) {
        this.approvalListeners.push(callback);

        // Track seen responses to avoid duplicate callbacks
        const seenResponses = new Set();
        let intervalId = null;

        // Set up global awareness listener for all teams
        const setupListener = async () => {
            const { p2pSyncService } = await import('./syncService');

            // Listen on all active providers
            const checkApprovals = () => {
                p2pSyncService.providers.forEach((provider, roomId) => {
                    if (provider.awareness) {
                        const states = provider.awareness.getStates();

                        states.forEach((state) => {
                            // Check for approval
                            if (state.joinApproval && !seenResponses.has(state.joinApproval.requestId)) {
                                console.log('[P2P Request] Received approval:', state.joinApproval);
                                seenResponses.add(state.joinApproval.requestId);
                                callback({ type: 'approved', data: state.joinApproval });
                            }

                            // Check for denial
                            if (state.joinDenial && !seenResponses.has(state.joinDenial.requestId)) {
                                console.log('[P2P Request] Received denial:', state.joinDenial);
                                seenResponses.add(state.joinDenial.requestId);
                                callback({ type: 'denied', data: state.joinDenial });
                            }
                        });
                    }
                });
            };

            // Check periodically
            intervalId = setInterval(checkApprovals, 500);
        };

        setupListener();

        // Return unsubscribe
        return () => {
            const index = this.approvalListeners.indexOf(callback);
            if (index > -1) {
                this.approvalListeners.splice(index, 1);
            }
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }

    /**
     * Get pending requests for a team
     * @param {string} teamId
     * @returns {Array}
     */
    getPendingRequests(teamId) {
        return this.pendingRequests.get(teamId) || [];
    }

    /**
     * Clear pending requests for a team
     * @param {string} teamId
     */
    clearPendingRequests(teamId) {
        this.pendingRequests.delete(teamId);
    }
}

export const p2pRequestService = new P2PRequestService();
