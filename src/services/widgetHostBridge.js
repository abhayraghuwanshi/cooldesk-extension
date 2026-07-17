/**
 * Host side of the CoolDesk widget bridge (cooldesk.js v2 protocol).
 *
 * Widgets keep localStorage as their synchronous working copy; this bridge
 * gives them a durable home: a dedicated IndexedDB in the extension origin
 * ('cooldesk-widget-data'). Deliberately raw IndexedDB, separate from the
 * validated app DB in src/db — widget payloads are free-form JSON.
 *
 * Protocol (over a MessagePort delivered with {type:'cooldesk:init'}):
 *   widget → host  {id, method, args}
 *   host → widget  {id, result} | {id, error}
 * id 0 is the widget's 'ready' notification and gets no reply.
 */

const DB_NAME = 'cooldesk-widget-data';
const STORE = 'kv';

let dbPromise = null;

function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

function reqAsPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbSet(key, value) {
    const db = await openDB();
    await reqAsPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, String(key)));
    return true;
}

async function idbGet(key) {
    const db = await openDB();
    return reqAsPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(String(key)));
}

async function idbSnapshot() {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const [keys, values] = await Promise.all([
        reqAsPromise(store.getAllKeys()),
        reqAsPromise(store.getAll()),
    ]);
    const out = {};
    keys.forEach((k, i) => { out[k] = values[i]; });
    return out;
}

// Official widgets store keys raw; custom widgets get a per-widget prefix
// ("c:<id>:") so pasted code can never read or clobber another widget's data.
function makeMethods(prefix) {
    return {
        'store.set': ({ key, value }) => idbSet(prefix + key, value),
        'store.get': ({ key }) => idbGet(prefix + key),
        'store.snapshot': async () => {
            const all = await idbSnapshot();
            const out = {};
            for (const [k, v] of Object.entries(all)) {
                if (prefix) {
                    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
                } else if (!k.startsWith('c:')) {
                    out[k] = v;
                }
            }
            return out;
        },
        'store.backup': async ({ data }) => {
            if (data && typeof data === 'object') {
                for (const [key, value] of Object.entries(data)) await idbSet(prefix + key, value);
            }
            return true;
        },
    };
}

/**
 * Hand a widget iframe its host port. Call from the iframe's load event —
 * each load gets a fresh MessageChannel; stale ports are simply GC'd.
 */
export function attachWidgetHostBridge(iframe, targetOrigin, keyPrefix = '') {
    if (!iframe || !iframe.contentWindow) return;
    const methods = makeMethods(keyPrefix);
    const channel = new MessageChannel();
    channel.port1.onmessage = async (ev) => {
        const m = ev.data || {};
        if (!m.method || m.id === 0) return; // id 0 = 'ready' notification
        const handler = methods[m.method];
        if (!handler) {
            channel.port1.postMessage({ id: m.id, error: `unknown-method: ${m.method}` });
            return;
        }
        try {
            channel.port1.postMessage({ id: m.id, result: await handler(m.args || {}) });
        } catch (e) {
            channel.port1.postMessage({ id: m.id, error: String((e && e.message) || e) });
        }
    };
    try {
        iframe.contentWindow.postMessage({ type: 'cooldesk:init' }, targetOrigin, [channel.port2]);
    } catch { /* iframe navigated away */ }
}
