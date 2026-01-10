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
}

export const p2pStorage = new P2PStorageService();
