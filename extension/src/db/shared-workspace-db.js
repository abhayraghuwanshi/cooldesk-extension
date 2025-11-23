// Lightweight IndexedDB cache for shared workspaces (folders + items)
// This is separate from the main unified DB to avoid schema changes.

import { ErrorSeverity, ErrorStrategy, handleDatabaseError } from './error-handler.js';

const SHARED_DB_NAME = 'cooldesk-shared-workspace-db';
const SHARED_DB_VERSION = 1;

const STORES = {
    STATE: 'state', // key: teamId, value: { teamId, folders, items, updatedAt }
};

function getIndexedDB() {
    if (typeof indexedDB !== 'undefined') return indexedDB;
    if (typeof self !== 'undefined' && self.indexedDB) return self.indexedDB;
    try {
        if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
    } catch {
        // ignore
    }
    throw new Error('IndexedDB is not available for shared workspace DB');
}

let dbPromise = null;

export function getSharedWorkspaceDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        try {
            const request = getIndexedDB().open(SHARED_DB_NAME, SHARED_DB_VERSION);

            request.onerror = (event) => {
                reject(event.target.error);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(STORES.STATE)) {
                    const store = db.createObjectStore(STORES.STATE, { keyPath: 'teamId' });
                    store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
        } catch (error) {
            reject(error);
        }
    });

    return dbPromise;
}

export async function saveSharedState(teamId, folders, items) {
    if (!teamId) throw new Error('teamId is required for saveSharedState');

    try {
        const db = await getSharedWorkspaceDB();
        const tx = db.transaction(STORES.STATE, 'readwrite');
        const store = tx.objectStore(STORES.STATE);
        const record = {
            teamId,
            folders: Array.isArray(folders) ? folders : [],
            items: Array.isArray(items) ? items : [],
            updatedAt: Date.now(),
        };

        await new Promise((resolve, reject) => {
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });

        return record;
    } catch (error) {
        return handleDatabaseError(error, {
            operation: 'saveSharedState',
            severity: ErrorSeverity.MEDIUM,
            strategy: ErrorStrategy.FALLBACK,
            fallbackFunction: () => null,
        });
    }
}

export async function getSharedState(teamId) {
    if (!teamId) return { teamId: null, folders: [], items: [] };

    try {
        const db = await getSharedWorkspaceDB();
        const tx = db.transaction(STORES.STATE, 'readonly');
        const store = tx.objectStore(STORES.STATE);

        const record = await new Promise((resolve, reject) => {
            const req = store.get(teamId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });

        if (!record) return { teamId, folders: [], items: [] };
        return record;
    } catch (error) {
        await handleDatabaseError(error, {
            operation: 'getSharedState',
            severity: ErrorSeverity.LOW,
            strategy: ErrorStrategy.FALLBACK,
            fallbackFunction: () => null,
        });
        return { teamId, folders: [], items: [] };
    }
}

export async function clearSharedState(teamId) {
    if (!teamId) return false;

    try {
        const db = await getSharedWorkspaceDB();
        const tx = db.transaction(STORES.STATE, 'readwrite');
        const store = tx.objectStore(STORES.STATE);

        await new Promise((resolve, reject) => {
            const req = store.delete(teamId);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });

        return true;
    } catch (error) {
        await handleDatabaseError(error, {
            operation: 'clearSharedState',
            severity: ErrorSeverity.LOW,
            strategy: ErrorStrategy.FALLBACK,
            fallbackFunction: () => false,
        });
        return false;
    }
}
