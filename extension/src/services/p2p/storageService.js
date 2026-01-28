import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

class P2PStorageService {
    constructor() {
        this.docs = new Map(); // teamId -> Y.Doc
        this.providers = new Map(); // teamId -> IndexeddbPersistence
        this.initPromises = new Map(); // teamId -> Promise (to prevent concurrent initialization)
    }

    /**
     * Initialize storage for a specific team
     * @param {string} teamId - The unique ID of the team
     * @returns {Promise<Y.Doc>} - The initialized Yjs document
     */
    async initializeTeamStorage(teamId) {
        // Return existing doc if already initialized
        if (this.docs.has(teamId)) {
            return this.docs.get(teamId);
        }

        // If initialization is already in progress, wait for it
        if (this.initPromises.has(teamId)) {
            return this.initPromises.get(teamId);
        }

        // Create and store the initialization promise to prevent concurrent inits
        const initPromise = this._doInitialize(teamId);
        this.initPromises.set(teamId, initPromise);

        try {
            const ydoc = await initPromise;
            return ydoc;
        } finally {
            // Clean up the promise after initialization completes (success or failure)
            this.initPromises.delete(teamId);
        }
    }

    /**
     * Internal method to actually initialize storage
     * @private
     */
    async _doInitialize(teamId) {
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
     * Get the shared array of saved data for a team
     * @param {string} teamId
     * @returns {Y.Array}
     */
    getSharedSavedData(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) {
            throw new Error(`Storage not initialized for team ${teamId}`);
        }
        const savedData = doc.getArray('saved-data');
        console.log(`[P2P Storage] Accessed saved-data for team ${teamId}, current length:`, savedData.length);
        return savedData;
    }

    /**
     * Get the shared array of server data for a team
     * @param {string} teamId
     * @returns {Y.Array}
     */
    getSharedServerData(teamId) {
        const doc = this.getDoc(teamId);
        if (!doc) {
            throw new Error(`Storage not initialized for team ${teamId}`);
        }
        const serverData = doc.getArray('server-data');
        console.log(`[P2P Storage] Accessed server-data for team ${teamId}, current length:`, serverData.length);
        return serverData;
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
     * Uses browserId as the primary key to prevent duplicates even if username changes
     * @param {string} teamId 
     * @param {object} member - {id (clientID), browserId, name (username), color, joinedAt, lastSeen, isAdmin}
     */
    addMemberToTeam(teamId, member) {
        const membersMap = this.getSharedMembers(teamId);

        // Use browserId as the key if available, fallback to username for backwards compatibility
        const memberKey = member.browserId || member.name;
        const existingMember = membersMap.get(memberKey);

        if (existingMember) {
            // Update existing member with new data
            membersMap.set(memberKey, {
                ...existingMember,
                id: member.id || existingMember.id, // Update to latest clientID if provided
                browserId: member.browserId || existingMember.browserId,
                name: member.name, // Always update username in case it changed
                color: member.color || existingMember.color,
                lastSeen: Date.now(),
                isAdmin: member.isAdmin !== undefined ? member.isAdmin : existingMember.isAdmin,
                isWriter: member.isWriter !== undefined ? member.isWriter : existingMember.isWriter,
                writerSignature: member.writerSignature !== undefined ? member.writerSignature : existingMember.writerSignature
            });
        } else {
            // Add new member
            membersMap.set(memberKey, {
                id: member.id,
                browserId: member.browserId,
                name: member.name,
                color: member.color,
                joinedAt: Date.now(),
                lastSeen: Date.now(),
                isAdmin: member.isAdmin || false,
                isWriter: member.isWriter || false,
                writerSignature: member.writerSignature || null
            });
            console.log(`[P2P Storage] Added new member to team ${teamId}:`, member.name, member.isAdmin ? '(Admin)' : member.isWriter ? '(Writer)' : '(Viewer)');
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
                if (!member || !member.id) {
                    console.warn(`[P2P Storage] Found invalid member in team ${teamId}:`, member);
                    return;
                }
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
     * Get all items from the shared list as a plain array
     * @param {string} teamId
     * @returns {Promise<Array>} Array of items
     */
    async getTeamItems(teamId) {
        if (!this.docs.has(teamId)) {
            await this.initializeTeamStorage(teamId);
        }
        const yArray = this.getSharedItems(teamId);
        return yArray.toArray();
    }

    /**
     * Update an existing item in the shared list
     * @param {string} teamId
     * @param {string} itemId - The ID of the item to update
     * @param {object} updatedItem - The updated item data
     */
    async updateItemInTeam(teamId, itemId, updatedItem) {
        if (!this.docs.has(teamId)) {
            await this.initializeTeamStorage(teamId);
        }
        const yArray = this.getSharedItems(teamId);
        const items = yArray.toArray();
        const index = items.findIndex(item => item.id === itemId);

        if (index !== -1) {
            yArray.delete(index, 1);
            yArray.insert(index, [{ ...updatedItem, id: itemId }]);
            console.log(`[P2P Storage] Updated item in team ${teamId}:`, updatedItem);
            return true;
        }
        console.warn(`[P2P Storage] Item ${itemId} not found in team ${teamId}`);
        return false;
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
        // Ensure item has an ID for tracking/deduplication
        const itemWithId = {
            ...item,
            id: item.id || `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        yArray.push([itemWithId]);
        console.log(`[P2P Storage] Added item to team ${teamId}:`, itemWithId);
        return itemWithId;
    }

    /**
     * Subscribe to shared items updates
     * @param {string} teamId
     * @param {function} callback - Called with Array of new items
     * @returns {function} Unsubscribe function
     */
    subscribeToSharedItems(teamId, callback) {
        try {
            const yArray = this.getSharedItems(teamId);

            const observer = (event) => {
                // Extract added items from the transaction
                const addedItems = [];

                // Iterate through delta to find inserts
                // Note: simple handling, for robust apps might need more complex delta parsing
                // But since we just append, checking the latest items or relying on transaction might be enough.
                // Actually, let's just pass the event target's new content that was added.
                // Y.Array event provides deltas. 

                // Let's iterate the changes to find added contents
                event.changes.delta.forEach(item => {
                    if (item.insert) {
                        if (Array.isArray(item.insert)) {
                            addedItems.push(...item.insert);
                        } else {
                            addedItems.push(item.insert);
                        }
                    }
                });

                if (addedItems.length > 0) {
                    callback(addedItems);
                }
            };

            yArray.observe(observer);
            return () => yArray.unobserve(observer);
        } catch (error) {
            console.error(`[P2P Storage] Error subscribing to shared items for team ${teamId}:`, error);
            return () => { };
        }
    }

    /**
     * Add saved data to the team
     * @param {string} teamId
     * @param {object} data - { id, type, title, content, url, tags, createdBy, metadata }
     */
    async addSavedData(teamId, data) {
        if (!this.docs.has(teamId)) {
            await this.initializeTeamStorage(teamId);
        }

        const yArray = this.getSharedSavedData(teamId);
        const savedItem = {
            id: data.id || `saved_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: data.type || 'bookmark',
            title: data.title || '',
            content: data.content || '',
            url: data.url || '',
            tags: data.tags || [],
            createdBy: data.createdBy || 'unknown',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: data.metadata || {}
        };
        yArray.push([savedItem]);
        console.log(`[P2P Storage] Added saved data to team ${teamId}:`, savedItem);
        return savedItem;
    }

    /**
     * Update saved data in the team
     * @param {string} teamId
     * @param {string} id - ID of the item to update
     * @param {object} updates - Fields to update
     */
    updateSavedData(teamId, id, updates) {
        const yArray = this.getSharedSavedData(teamId);
        const items = yArray.toArray();
        const index = items.findIndex(item => item.id === id);

        if (index !== -1) {
            const updatedItem = {
                ...items[index],
                ...updates,
                updatedAt: Date.now()
            };
            yArray.delete(index, 1);
            yArray.insert(index, [updatedItem]);
            console.log(`[P2P Storage] Updated saved data in team ${teamId}:`, updatedItem);
            return updatedItem;
        }
        console.warn(`[P2P Storage] Saved data item ${id} not found in team ${teamId}`);
        return null;
    }

    /**
     * Delete saved data from the team
     * @param {string} teamId
     * @param {string} id - ID of the item to delete
     */
    deleteSavedData(teamId, id) {
        const yArray = this.getSharedSavedData(teamId);
        const items = yArray.toArray();
        const index = items.findIndex(item => item.id === id);

        if (index !== -1) {
            yArray.delete(index, 1);
            console.log(`[P2P Storage] Deleted saved data from team ${teamId}:`, id);
            return true;
        }
        console.warn(`[P2P Storage] Saved data item ${id} not found in team ${teamId}`);
        return false;
    }

    /**
     * Subscribe to saved data updates
     * @param {string} teamId
     * @param {function} callback - Called with Array of changes
     * @returns {function} Unsubscribe function
     */
    subscribeToSavedData(teamId, callback) {
        try {
            const yArray = this.getSharedSavedData(teamId);

            const observer = (event) => {
                const addedItems = [];
                const deletedItems = [];
                const updatedItems = [];

                event.changes.delta.forEach(item => {
                    if (item.insert) {
                        if (Array.isArray(item.insert)) {
                            addedItems.push(...item.insert);
                        } else {
                            addedItems.push(item.insert);
                        }
                    }
                    if (item.delete) {
                        deletedItems.push({ count: item.delete });
                    }
                });

                if (addedItems.length > 0 || deletedItems.length > 0) {
                    callback({ added: addedItems, deleted: deletedItems, updated: updatedItems });
                }
            };

            yArray.observe(observer);
            return () => yArray.unobserve(observer);
        } catch (error) {
            console.error(`[P2P Storage] Error subscribing to saved data for team ${teamId}:`, error);
            return () => { };
        }
    }

    /**
     * Add server data to the team
     * @param {string} teamId
     * @param {object} data - { source, type, payload, metadata }
     */
    async addServerData(teamId, data) {
        if (!this.docs.has(teamId)) {
            await this.initializeTeamStorage(teamId);
        }

        const yArray = this.getSharedServerData(teamId);
        const serverItem = {
            id: data.id || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            source: data.source || 'unknown',
            type: data.type || 'generic',
            payload: data.payload || {},
            processedAt: Date.now(),
            syncedAt: Date.now(),
            status: data.status || 'pending',
            metadata: data.metadata || {}
        };
        yArray.push([serverItem]);
        console.log(`[P2P Storage] Added server data to team ${teamId}:`, serverItem);
        return serverItem;
    }

    /**
     * Update server data in the team
     * @param {string} teamId
     * @param {string} id - ID of the item to update
     * @param {object} updates - Fields to update
     */
    updateServerData(teamId, id, updates) {
        const yArray = this.getSharedServerData(teamId);
        const items = yArray.toArray();
        const index = items.findIndex(item => item.id === id);

        if (index !== -1) {
            const updatedItem = {
                ...items[index],
                ...updates,
                syncedAt: Date.now()
            };
            yArray.delete(index, 1);
            yArray.insert(index, [updatedItem]);
            console.log(`[P2P Storage] Updated server data in team ${teamId}:`, updatedItem);
            return updatedItem;
        }
        console.warn(`[P2P Storage] Server data item ${id} not found in team ${teamId}`);
        return null;
    }

    /**
     * Delete server data from the team
     * @param {string} teamId
     * @param {string} id - ID of the item to delete
     */
    deleteServerData(teamId, id) {
        const yArray = this.getSharedServerData(teamId);
        const items = yArray.toArray();
        const index = items.findIndex(item => item.id === id);

        if (index !== -1) {
            yArray.delete(index, 1);
            console.log(`[P2P Storage] Deleted server data from team ${teamId}:`, id);
            return true;
        }
        console.warn(`[P2P Storage] Server data item ${id} not found in team ${teamId}`);
        return false;
    }

    /**
     * Subscribe to server data updates
     * @param {string} teamId
     * @param {function} callback - Called with Array of changes
     * @returns {function} Unsubscribe function
     */
    subscribeToServerData(teamId, callback) {
        try {
            const yArray = this.getSharedServerData(teamId);

            const observer = (event) => {
                const addedItems = [];
                const deletedItems = [];

                event.changes.delta.forEach(item => {
                    if (item.insert) {
                        if (Array.isArray(item.insert)) {
                            addedItems.push(...item.insert);
                        } else {
                            addedItems.push(item.insert);
                        }
                    }
                    if (item.delete) {
                        deletedItems.push({ count: item.delete });
                    }
                });

                if (addedItems.length > 0 || deletedItems.length > 0) {
                    callback({ added: addedItems, deleted: deletedItems });
                }
            };

            yArray.observe(observer);
            return () => yArray.unobserve(observer);
        } catch (error) {
            console.error(`[P2P Storage] Error subscribing to shared items for team ${teamId}:`, error);
            return () => { };
        }
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
