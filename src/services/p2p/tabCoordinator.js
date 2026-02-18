/**
 * Tab Coordinator Service
 * Manages leader election and coordination between multiple tabs
 * to share a single P2P connection per browser
 */

class TabCoordinator {
    constructor() {
        this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        this.isLeaderTab = false;
        this.leaderId = null;
        this.lastLeaderHeartbeat = 0;
        this.channels = new Map(); // teamId -> BroadcastChannel
        this.listeners = new Map(); // teamId -> Set of listeners
        this.heartbeatInterval = null;
        this.checkInterval = null;

        console.log('[TabCoordinator] Initialized with tabId:', this.tabId);
    }

    /**
     * Initialize coordination for a team
     */
    async initTeam(teamId) {
        if (this.channels.has(teamId)) {
            console.log('[TabCoordinator] Team already initialized:', teamId);
            return;
        }

        console.log('[TabCoordinator] Initializing team:', teamId);

        // Create BroadcastChannel for this team
        const channel = new BroadcastChannel(`team_${teamId}_coordination`);
        this.channels.set(teamId, channel);
        this.listeners.set(teamId, new Set());

        // Handle incoming messages
        channel.onmessage = (event) => {
            this.handleMessage(teamId, event.data);
        };

        // Start election process
        await this.startElection(teamId);

        // Start heartbeat checker
        if (!this.checkInterval) {
            this.checkInterval = setInterval(() => {
                this.checkLeaderHealth();
            }, 1000);
        }
    }

    /**
     * Start leader election for a team
     */
    async startElection(teamId) {
        console.log('[TabCoordinator] Starting election for team:', teamId);

        // Broadcast election message
        this.broadcast(teamId, {
            type: 'ELECTION',
            tabId: this.tabId,
            timestamp: Date.now()
        });

        // Wait for responses (100ms)
        await new Promise(resolve => setTimeout(resolve, 100));

        // If no leader announced, become leader
        if (!this.leaderId) {
            this.becomeLeader(teamId);
        }
    }

    /**
     * Become the leader for a team
     */
    becomeLeader(teamId) {
        console.log('[TabCoordinator] Becoming leader for team:', teamId);
        this.isLeaderTab = true;
        this.leaderId = this.tabId;
        this.lastLeaderHeartbeat = Date.now();

        // Announce leadership
        this.broadcast(teamId, {
            type: 'LEADER_ANNOUNCE',
            tabId: this.tabId,
            timestamp: Date.now()
        });

        // Start heartbeat
        if (!this.heartbeatInterval) {
            this.heartbeatInterval = setInterval(() => {
                this.sendHeartbeat();
            }, 2000);
        }

        // Notify listeners
        this.notifyListeners(teamId, 'LEADER_CHANGED', { isLeader: true, leaderId: this.tabId });
    }

    /**
     * Step down as leader
     */
    stepDown(teamId) {
        console.log('[TabCoordinator] Stepping down as leader for team:', teamId);

        this.broadcast(teamId, {
            type: 'LEADER_STEPPING_DOWN',
            tabId: this.tabId,
            timestamp: Date.now()
        });

        this.isLeaderTab = false;
        this.leaderId = null;

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Notify listeners
        this.notifyListeners(teamId, 'LEADER_CHANGED', { isLeader: false, leaderId: null });
    }

    /**
     * Send heartbeat as leader
     */
    sendHeartbeat() {
        if (!this.isLeaderTab) return;

        this.channels.forEach((channel, teamId) => {
            this.broadcast(teamId, {
                type: 'HEARTBEAT',
                tabId: this.tabId,
                timestamp: Date.now()
            });
        });
    }

    /**
     * Check leader health (follower tabs)
     */
    checkLeaderHealth() {
        if (this.isLeaderTab) return;

        const now = Date.now();
        const timeSinceLastHeartbeat = now - this.lastLeaderHeartbeat;

        // If no heartbeat for 5 seconds, trigger election
        if (this.leaderId && timeSinceLastHeartbeat > 5000) {
            console.warn('[TabCoordinator] Leader timeout detected, triggering election');
            this.leaderId = null;
            this.channels.forEach((_, teamId) => {
                this.startElection(teamId);
            });
        }
    }

    /**
     * Handle incoming messages
     */
    handleMessage(teamId, message) {
        const { type, tabId, timestamp, payload } = message;

        switch (type) {
            case 'ELECTION':
                // Compare tab IDs, lower ID wins
                if (tabId < this.tabId && (!this.leaderId || tabId < this.leaderId)) {
                    this.leaderId = tabId;
                    this.isLeaderTab = false;
                    this.lastLeaderHeartbeat = timestamp;
                } else if (tabId > this.tabId && this.isLeaderTab) {
                    // We have priority, announce leadership
                    this.broadcast(teamId, {
                        type: 'LEADER_ANNOUNCE',
                        tabId: this.tabId,
                        timestamp: Date.now()
                    });
                }
                break;

            case 'LEADER_ANNOUNCE':
                if (tabId !== this.tabId) {
                    console.log('[TabCoordinator] Leader announced:', tabId);
                    this.leaderId = tabId;
                    this.isLeaderTab = false;
                    this.lastLeaderHeartbeat = timestamp;

                    if (this.heartbeatInterval) {
                        clearInterval(this.heartbeatInterval);
                        this.heartbeatInterval = null;
                    }

                    this.notifyListeners(teamId, 'LEADER_CHANGED', { isLeader: false, leaderId: tabId });
                }
                break;

            case 'HEARTBEAT':
                if (tabId === this.leaderId) {
                    this.lastLeaderHeartbeat = timestamp;
                }
                break;

            case 'LEADER_STEPPING_DOWN':
                if (tabId === this.leaderId) {
                    console.log('[TabCoordinator] Leader stepping down, starting election');
                    this.leaderId = null;
                    this.startElection(teamId);
                }
                break;

            case 'DATA_SYNC':
            case 'AWARENESS_UPDATE':
            case 'REQUEST_STATE':
            case 'STATE_SNAPSHOT':
                // Forward to listeners
                this.notifyListeners(teamId, type, payload);
                break;

            default:
                console.warn('[TabCoordinator] Unknown message type:', type);
        }
    }

    /**
     * Broadcast message to all tabs
     */
    broadcast(teamId, message) {
        const channel = this.channels.get(teamId);
        if (channel) {
            channel.postMessage(message);
        }
    }

    /**
     * Subscribe to coordination events
     */
    subscribe(teamId, listener) {
        if (!this.listeners.has(teamId)) {
            this.listeners.set(teamId, new Set());
        }
        this.listeners.get(teamId).add(listener);

        return () => {
            this.listeners.get(teamId)?.delete(listener);
        };
    }

    /**
     * Notify listeners
     */
    notifyListeners(teamId, type, payload) {
        const listeners = this.listeners.get(teamId);
        if (listeners) {
            listeners.forEach(listener => {
                try {
                    listener({ type, payload, teamId });
                } catch (error) {
                    console.error('[TabCoordinator] Listener error:', error);
                }
            });
        }
    }

    /**
     * Check if this tab is the leader for a team
     */
    isLeader(teamId) {
        return this.isLeaderTab && this.channels.has(teamId);
    }

    /**
     * Get leader ID for a team
     */
    getLeaderId(teamId) {
        return this.leaderId;
    }

    /**
     * Get tab ID
     */
    getTabId() {
        return this.tabId;
    }

    /**
     * Cleanup for a team
     */
    cleanup(teamId) {
        console.log('[TabCoordinator] Cleaning up team:', teamId);

        if (this.isLeaderTab) {
            this.stepDown(teamId);
        }

        const channel = this.channels.get(teamId);
        if (channel) {
            channel.close();
            this.channels.delete(teamId);
        }

        this.listeners.delete(teamId);

        // If no more teams, stop intervals
        if (this.channels.size === 0) {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
            if (this.checkInterval) {
                clearInterval(this.checkInterval);
                this.checkInterval = null;
            }
        }
    }

    /**
     * Cleanup all teams
     */
    cleanupAll() {
        const teamIds = Array.from(this.channels.keys());
        teamIds.forEach(teamId => this.cleanup(teamId));
    }
}

export const tabCoordinator = new TabCoordinator();

// Cleanup on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        tabCoordinator.cleanupAll();
    });
}
