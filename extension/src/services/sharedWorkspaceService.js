import { useEffect, useRef, useState } from 'react';

// --- CONFIGURATION ---
// TODO: Replace with your actual Cloudflare Worker URL
const WS_BASE_URL = "wss://cooldesk-team-sync.raghuwanshi-abhay405.workers.dev";

// --- HELPER: User ID ---
const getUserId = () => {
    return localStorage.getItem("cooldesk_user_id") || "user_" + Math.floor(Math.random() * 1000);
};

// ========================================================
// PART 1: THE SHARED WORKSPACE CLIENT (For Live Sync)
// ========================================================

export function createSharedWorkspaceClient({ teamId, userId, wsUrl }) {
    if (!teamId || !userId || !wsUrl) {
        throw new Error('teamId, userId and wsUrl are required');
    }

    let ws = null;
    let listeners = new Set();
    let shouldReconnect = true;

    const notify = (payload) => {
        listeners.forEach((fn) => {
            try { fn(payload); } catch (e) { console.error('[SharedWS] listener error', e); }
        });
    };

    const connect = () => {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

        const url = `${wsUrl}?teamId=${encodeURIComponent(teamId)}&userId=${encodeURIComponent(userId)}`;
        ws = new WebSocket(url);

        ws.onopen = () => console.log('[SharedWS] Connected');

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                notify(msg);
            } catch (e) {
                console.warn('[SharedWS] Parse error', e);
            }
        };

        ws.onclose = () => {
            console.log('[SharedWS] Disconnected');
            ws = null;
            if (shouldReconnect) setTimeout(connect, 3000);
        };
    };

    const send = (payload) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(payload));
    };

    return {
        connect,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        // Standard Actions
        addUrl(url, title, folderId = null) { send({ type: 'ADD_URL', url, title, folderId }); },
        createFolder(name, parentId = null) { send({ type: 'CREATE_FOLDER', name, parentId }); },
        deleteFolder(folderId) { send({ type: 'DELETE_FOLDER', folderId }); },
        moveItem(itemId, targetFolderId = null) { send({ type: 'MOVE_ITEM', itemId, targetFolderId }); },
        deleteItem(itemId) { send({ type: 'DELETE_ITEM', itemId }); },
        createInvite() { send({ type: 'CREATE_INVITE' }); },
        joinTeam(code) { send({ type: 'JOIN_TEAM', code }); },

        // Helper for raw sending (used by API calls below if needed)
        sendRaw: send,

        close() {
            shouldReconnect = false;
            if (ws) ws.close();
        },
    };
}

// ========================================================
// PART 2: THE REACT HOOK (For Components)
// ========================================================

export function createUseSharedWorkspaceHook() {
    return function useSharedWorkspace({ teamId, userId, wsUrl, onError }) {
        const [folders, setFolders] = useState([]);
        const [items, setItems] = useState([]);
        const clientRef = useRef(null);

        useEffect(() => {
            if (!teamId || !userId || !wsUrl) return;

            // Initialize Client
            const client = createSharedWorkspaceClient({ teamId, userId, wsUrl });
            clientRef.current = client;
            client.connect();

            // Subscribe to updates
            const unsubscribe = client.subscribe((msg) => {
                if (msg.type === 'SYNC_STATE') {
                    setFolders(msg.folders || []);
                    setItems(msg.items || []);
                } else if (msg.type === 'ERROR') {
                    if (onError) onError(msg.message);
                }
            });

            return () => {
                unsubscribe();
                client.close();
            };
        }, [teamId, userId, wsUrl]);

        return {
            folders,
            items,
            addUrl: (u, t, f) => clientRef.current?.addUrl(u, t, f),
            createFolder: (n, p) => clientRef.current?.createFolder(n, p),
            deleteFolder: (id) => clientRef.current?.deleteFolder(id),
            moveItem: (i, t) => clientRef.current?.moveItem(i, t),
            deleteItem: (i) => clientRef.current?.deleteItem(i),
            createInvite: () => clientRef.current?.createInvite(),
            joinTeam: (c) => clientRef.current?.joinTeam(c),
        };
    };
}

// ========================================================
// PART 3: API MANAGEMENT FUNCTIONS (WebSocket-based)
// ========================================================

// We use a separate, single connection for "Management" tasks (Create Team, etc)
let mgmtSocket = null;
let mgmtPromise = null;
const pendingRequests = new Map();

function getMgmtSocket() {
    if (mgmtSocket && mgmtSocket.readyState === WebSocket.OPEN) return Promise.resolve(mgmtSocket);
    if (mgmtPromise) return mgmtPromise;

    mgmtPromise = new Promise((resolve, reject) => {
        const userId = getUserId();
        // Connect to global management scope
        const url = `${WS_BASE_URL}?teamId=management-global&userId=${userId}`;
        const ws = new WebSocket(url);

        ws.onopen = () => {
            mgmtSocket = ws;
            resolve(ws);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.requestId && pendingRequests.has(msg.requestId)) {
                    const { resolve: ok, reject: fail } = pendingRequests.get(msg.requestId);
                    msg.error ? fail(new Error(msg.error)) : ok(msg.data);
                    pendingRequests.delete(msg.requestId);
                }
            } catch (e) { console.error(e); }
        };

        ws.onerror = (err) => reject(err);
        ws.onclose = () => { mgmtSocket = null; mgmtPromise = null; };
    });
    return mgmtPromise;
}

async function sendApiRequest(type, payload = {}) {
    const socket = await getMgmtSocket();
    return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(7);

        // 5s Timeout
        const timer = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error("Request timed out"));
            }
        }, 5000);

        pendingRequests.set(requestId, {
            resolve: (d) => { clearTimeout(timer); resolve(d); },
            reject: (e) => { clearTimeout(timer); reject(e); }
        });

        socket.send(JSON.stringify({ type, requestId, ...payload }));
    });
}

// --- EXPORTS FOR TeamManagement.jsx ---

export async function apiLoadMyTeams() { return sendApiRequest('GET_MY_TEAMS'); }
export async function apiCreateTeam(name) { return sendApiRequest('CREATE_TEAM', { name }); }
export async function apiLoadTeamMembers(teamId) { return sendApiRequest('GET_MEMBERS', { teamId }); }
export async function apiInviteMember(teamId, email) { return sendApiRequest('INVITE_MEMBER', { teamId, email }); }
export async function apiRemoveMember(teamId, email) { return sendApiRequest('REMOVE_MEMBER', { teamId, email }); }