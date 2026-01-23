import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

class P2PStorageService {
    constructor() {
        this.docs = new Map(); // teamId -> Y.Doc
        this.providers = new Map(); // teamId -> IndexeddbPersistence
    }

    /**
     * Initialize storage for a specific team
     * @param {string} teamId - The unique ID of the team
     * @returns {Promise<Y.Doc>} - The initialized Yjs document
     */
    async initializeTeamStorage(teamId) {
        if (this.docs.has(teamId)) {
            return this.docs.get(teamId);
        }

        console.log(`[P2P Storage] Initializing storage for team: ${teamId}`);

        // Create a Yjs document
        const ydoc = new Y.Doc();

        // Connect to IndexedDB
        // This ensures data is saved locally and loads immediately on restart
        const provider = new IndexeddbPersistence(`team-db-${teamId}`, ydoc);

        this.docs.set(teamId, ydoc);
        this.providers.set(teamId, provider);

        // Wait for data to be loaded from IndexedDB
        await provider.whenSynced;
        console.log(`[P2P Storage] Team ${teamId} synced with local storage`);

        return ydoc;
    }

    /**
     * Get the Y.Doc for a team
     * @param {string} teamId 
     * @returns {Y.Doc|undefined}
     */
    getDoc(teamId) {
        return this.docs.get(teamId);
    }

    /**
     * Get the shared array of items for a team
     * @param {string} teamId 
     * @returns {Y.Array}
     */
    getSharedItems(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) {
            throw new Error(`Storage not initialized for team ${teamId}`);
        }
        return doc.getArray('shared-items');
    }

    /**
     * Get the shared array of notices for a team
     * @param {string} teamId
     * @returns {Y.Array}
     */
    getSharedNotices(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) {
            throw new Error(`Storage not initialized for team ${teamId}`);
        }
        const notices = doc.getArray('shared-notices');
        console.log(`[P2P Storage] Accessed shared-notices for team ${teamId}, current length:`, notices.length);
        return notices;
    }

    /**
     * Get the shared context map for a team (goals, status, etc.)
     * @param {string} teamId
     * @returns {Y.Map}
     */
    getSharedContext(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) {
            throw new Error(`Storage not initialized for team ${teamId}`);
        }
        const context = doc.getMap('team-context');
        console.log(`[P2P Storage] Accessed team-context for team ${teamId}, keys:`, Array.from(context.keys()));
        return context;
    }

    /**
     * Get the shared map of team members
     * @param {string} teamId 
     * @returns {Y.Map}
     */
    getSharedMembers(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) {
            throw new Error(`Storage not initialized for team ${teamId}`);
        }
        return doc.getMap('team-members');
    }

    /**
     * Add or update a member in the team
     * Uses username as the primary key to prevent duplicates on reconnection
     * @param {string} teamId 
     * @param {object} member - {id (clientID), name (username), color, joinedAt, lastSeen, isAdmin}
     */
    addMemberToTeam(teamId, member) {
        const membersMap = this.getSharedMembers(teamId);
        const memberKey = member.name; // Use username as the key, not clientID
        const existingMember = membersMap.get(memberKey);

        if (existingMember) {
            // Update existing member with new clientID and last seen time
            membersMap.set(memberKey, {
                ...existingMember,
                id: member.id || existingMember.id, // Update to latest clientID if provided
                color: member.color || existingMember.color,
                lastSeen: Date.now(),
                isAdmin: member.isAdmin !== undefined ? member.isAdmin : existingMember.isAdmin
            });
        } else {
            // Add new member
            membersMap.set(memberKey, {
                id: member.id,
                name: member.name,
                color: member.color,
                joinedAt: Date.now(),
                lastSeen: Date.now(),
                isAdmin: member.isAdmin || false
            });
            console.log(`[P2P Storage] Added new member to team ${teamId}:`, member.name, member.isAdmin ? '(Admin)' : '');
        }
    }

    /**
     * Get the admin of a team
     * @param {string} teamId
     * @returns {object|null} Admin member object or null
     */
    getTeamAdmin(teamId) {
        const membersMap = this.getSharedMembers(teamId);
        let admin = null;

        membersMap.forEach((member) => {
            if (member.isAdmin) {
                admin = member;
            }
        });

        return admin;
    }

    /**
     * Remove a member from the team (admin only)
     * @param {string} teamId
     * @param {string} memberName - The username/key of the member to remove
     * @returns {boolean} True if member was removed
     */
    removeMemberFromTeam(teamId, memberName) {
        try {
            const membersMap = this.getSharedMembers(teamId);
            const member = membersMap.get(memberName);

            if (!member) {
                console.warn(`[P2P Storage] Member ${memberName} not found in team ${teamId}`);
                return false;
            }

            // Don't allow removing the admin
            if (member.isAdmin) {
                console.warn(`[P2P Storage] Cannot remove admin ${memberName} from team ${teamId}`);
                return false;
            }

            membersMap.delete(memberName);
            console.log(`[P2P Storage] Removed member ${memberName} from team ${teamId}`);
            return true;
        } catch (error) {
            console.error(`[P2P Storage] Error removing member from team ${teamId}:`, error);
            return false;
        }
    }

    /**
     * Toggle writer status for a member (admin only)
     * @param {string} teamId
     * @param {string} memberName
     */
    /**
     * Toggle writer status for a member (admin only)
     * @param {string} teamId
     * @param {string} memberName
     * @param {object} adminKeys - { privateKey, publicKey } optional, required for signing
     */
    async toggleMemberWriterStatus(teamId, memberName, adminKeys) {
        try {
            const membersMap = this.getSharedMembers(teamId);
            const member = membersMap.get(memberName);

            if (member && !member.isAdmin) {
                const newStatus = !member.isWriter;
                let signature = null;

                // If granting writer status, sign it
                if (newStatus && adminKeys?.privateKey) {
                    const { cryptoUtils } = await import('./cryptoUtils');
                    // Sign the statement: "memberName is allowed to write"
                    signature = cryptoUtils.sign(`WRITER:${memberName}`, adminKeys.privateKey);
                }

                membersMap.set(memberName, {
                    ...member,
                    isWriter: newStatus,
                    writerSignature: signature
                });
                console.log(`[P2P Storage] Toggled writer status to ${newStatus} for ${memberName}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[P2P Storage] Error toggling writer status:`, error);
            return false;
        }
    }


    /**
     * Close storage connections (e.g. on team switch or logout)
     * @param {string} teamId 
     */
    async closeTeamStorage(teamId) {
        const provider = this.providers.get(teamId);
        if (provider) {
            await provider.destroy();
            this.providers.delete(teamId);
        }
        this.docs.get(teamId)?.destroy();
        this.docs.delete(teamId);
        console.log(`[P2P Storage] Closed storage for team: ${teamId}`);
    }

    /**
     * Delete the IndexedDB database for a team
     * This permanently removes all local data for the team
     * @param {string} teamId 
     */
    async deleteTeamDatabase(teamId) {
        try {
            // Close connections first
            await this.closeTeamStorage(teamId);

            // Delete the IndexedDB database
            const dbName = `team-db-${teamId}`;
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(dbName);
                request.onsuccess = () => {
                    console.log(`[P2P Storage] Deleted database: ${dbName}`);
                    resolve();
                };
                request.onerror = () => {
                    console.error(`[P2P Storage] Error deleting database: ${dbName}`, request.error);
                    reject(request.error);
                };
                request.onblocked = () => {
                    console.warn(`[P2P Storage] Database deletion blocked: ${dbName}`);
                    // Still resolve - the database will be deleted when unblocked
                    resolve();
                };
            });
        } catch (error) {
            console.error(`[P2P Storage] Failed to delete database for team ${teamId}:`, error);
            // Don't throw - we want team removal to succeed even if DB deletion fails
        }
    }

    /**
     * Clear all local data for a team (Danger Zone)
     * @param {string} teamId 
     */
    async clearTeamData(teamId) {
        const provider = this.providers.get(teamId);
        if (provider) {
            await provider.clearData();
        }
    }

    /**
     * Clean up duplicate members in a team
     * This removes duplicate entries keeping only the most recent one for each unique ID
     * @param {string} teamId 
     */
    cleanupDuplicateMembers(teamId) {
        try {
            const membersMap = this.getSharedMembers(teamId);
            const uniqueMembers = new Map();
            const keysToDelete = [];

            // Collect all members and identify duplicates
            membersMap.forEach((member, key) => {
                const memberId = member.id.toString();

                if (uniqueMembers.has(memberId)) {
                    // Found a duplicate - mark the old key for deletion
                    const existing = uniqueMembers.get(memberId);
                    if (member.lastSeen > existing.lastSeen) {
                        // This one is newer, delete the old one
                        keysToDelete.push(existing.key);
                        uniqueMembers.set(memberId, { ...member, key });
                    } else {
                        // Keep the existing one, delete this one
                        keysToDelete.push(key);
                    }
                } else {
                    uniqueMembers.set(memberId, { ...member, key });
                }
            });

            // Delete duplicate entries
            keysToDelete.forEach(key => {
                membersMap.delete(key);
            });

            console.log(`[P2P Storage] Cleaned up ${keysToDelete.length} duplicate members from team ${teamId}`);
            return keysToDelete.length;
        } catch (error) {
            console.error(`[P2P Storage] Error cleaning up duplicates for team ${teamId}:`, error);
            return 0;
        }
    }

    /**
     * Fix admin status to ensure only one admin exists
     * The admin should be the member with the earliest joinedAt timestamp
     * @param {string} teamId 
     */
    fixAdminStatus(teamId) {
        try {
            const membersMap = this.getSharedMembers(teamId);
            let earliestMember = null;
            let earliestJoinTime = Infinity;

            // Find the member with the earliest join time
            membersMap.forEach((member, key) => {
                if (member.joinedAt < earliestJoinTime) {
                    earliestJoinTime = member.joinedAt;
                    earliestMember = { ...member, key };
                }
            });

            // Update all members: only the earliest one should be admin
            let fixedCount = 0;
            membersMap.forEach((member, key) => {
                const shouldBeAdmin = (key === earliestMember?.key);
                if (member.isAdmin !== shouldBeAdmin) {
                    membersMap.set(key, {
                        ...member,
                        isAdmin: shouldBeAdmin
                    });
                    fixedCount++;
                }
            });

            console.log(`[P2P Storage] Fixed admin status for ${fixedCount} members in team ${teamId}`);
            return fixedCount;
        } catch (error) {
            console.error(`[P2P Storage] Error fixing admin status for team ${teamId}:`, error);
            return 0;
        }
    }

    /**
     * Add an item to the shared list
     * @param {string} teamId 
     * @param {object} item 
     */
    async addItemToTeam(teamId, item) {
        // Ensure storage is initialized
        if (!this.docs.has(teamId)) {
            await this.initializeTeamStorage(teamId);
        }

        const yArray = this.getSharedItems(teamId);
        yArray.push([item]);
        console.log(`[P2P Storage] Added item to team ${teamId}:`, item);
    }

    /**
     * Write the Admin Public Key to shared metadata (One-time setup for Admins)
     * @param {string} teamId 
     * @param {string} publicKey 
     */
    ensureTeamMetadata(teamId, publicKey) {
        if (!publicKey) return;
        const doc = this.getDoc(teamId);
        if (!doc) return;

        const metadata = doc.getMap('team-metadata');
        if (!metadata.get('adminPublicKey')) {
            console.log(`[P2P Storage] Publishing Admin Public Key for team ${teamId}`);
            metadata.set('adminPublicKey', publicKey);
        }
    }

    /**
     * Get the shared Admin Public Key
     * @param {string} teamId 
     * @returns {string|null}
     */
    getTeamPublicKey(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) return null;
        const metadata = doc.getMap('team-metadata');
        return metadata.get('adminPublicKey');
    }
}

export const p2pStorage = new P2PStorageService();
