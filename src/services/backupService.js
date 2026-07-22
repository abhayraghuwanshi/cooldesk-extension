/**
 * Backup snapshots.
 *
 * The snapshot is assembled here because the data lives in IndexedDB and
 * extension storage, neither of which the Rust side can read. Writing it goes
 * through the `save_backup` Tauri command so a scheduled backup doesn't depend
 * on a browser download — no Settings modal open, no Downloads folder, and old
 * files get pruned.
 *
 * Backup is a desktop-app feature: the extension's service worker can't hold a
 * reliable schedule, so `startBackupScheduler` is a no-op outside the app. The
 * extension keeps ExportData for manual exports.
 */

import { DB_CONFIG, getUnifiedDB } from '../db';
import { storageGet, storageSet } from './extensionApi';

const isTauri = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

// How often the scheduler wakes to check whether a backup is due. The check is
// cheap (one storage read) and the interval only bounds how late a backup can
// fire, so a coarse tick is fine.
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const FREQUENCY_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function calculateNextBackupTime(frequency, from = Date.now()) {
  return from + (FREQUENCY_MS[frequency] ?? FREQUENCY_MS.weekly);
}

// Must go through the API package, not `window.__TAURI__` — that global only
// exists when `withGlobalTauri` is enabled in tauri.conf.json, and it isn't.
// `__TAURI_INTERNALS__` is always present, which is why isTauri above is true
// even though the global helper object is not.
async function tauriInvoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

/**
 * Collect everything worth backing up into a single serializable object.
 */
export async function createBackupSnapshot() {
  const db = await getUnifiedDB();

  // `version` is kept for backups read by older builds, which look for exactly
  // that key. `dbVersion`/`appVersion` are what restore prefers — see
  // inspectBackup in backupRestore.js.
  let appVersion = null;
  if (isTauri) {
    try { appVersion = await tauriInvoke('get_app_version'); } catch { /* not fatal */ }
  }

  const data = {
    meta: {
      exportedAt: Date.now(),
      version: db.version,
      dbVersion: db.version,
      appVersion,
      platform: isTauri ? 'app' : 'extension',
    },
    stores: {},
    storageLocal: {},
  };

  for (const storeName of Object.values(DB_CONFIG.STORES)) {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    data.stores[storeName] = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // Best-effort: a missing storage key shouldn't lose the IndexedDB snapshot.
  try {
    const { pinnedWorkspaces } = await storageGet(['pinnedWorkspaces']);
    data.storageLocal.pinnedWorkspaces = Array.isArray(pinnedWorkspaces) ? pinnedWorkspaces : [];

    const all = await storageGet(null);
    const notesByDate = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('dailyNotes_') && k !== 'dailyNotesSummary' && k !== 'dailyNotesLastUpdate') {
        notesByDate[k] = v;
      }
    }
    data.storageLocal.dailyNotes = {
      notesByDate,
      summary: all.dailyNotesSummary || {},
      lastUpdate: all.dailyNotesLastUpdate || 0,
    };
    if (all.domainSelectors) data.storageLocal.domainSelectors = all.domainSelectors;
    if (all.platformSettings) data.storageLocal.platformSettings = all.platformSettings;
  } catch (e) {
    console.warn('[Backup] Could not read local storage into snapshot:', e);
  }

  return data;
}

/**
 * Write a snapshot to disk. In the app this goes to the managed backups folder;
 * in the extension it falls back to a browser download (manual use only).
 *
 * Returns the path written, or null for the download fallback.
 */
export async function writeBackup(snapshot) {
  const json = JSON.stringify(snapshot, null, 2);

  if (isTauri) {
    return await tauriInvoke('save_backup', { contents: json });
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cooldesk-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Take a backup and record when it happened. Also rolls the next scheduled time
 * forward, so a manual backup resets the clock rather than leaving one due.
 */
export async function runBackup() {
  const snapshot = await createBackupSnapshot();
  const path = await writeBackup(snapshot);

  const now = Date.now();
  const { backupFrequency } = await storageGet(['backupFrequency']);
  await storageSet({
    lastBackupTime: now,
    nextBackupTime: calculateNextBackupTime(backupFrequency || 'weekly', now),
  });

  return { path, at: now };
}

export async function getBackupsDir() {
  if (!isTauri) return null;
  return await tauriInvoke('get_backups_dir');
}

/**
 * Saved backups, newest first. Empty outside the desktop app — the extension
 * has no managed folder, only ad-hoc downloads.
 */
export async function listBackups() {
  if (!isTauri) return [];
  try {
    return await tauriInvoke('list_backups');
  } catch (e) {
    console.warn('[Backup] Could not list backups:', e);
    return [];
  }
}

/** Read a saved backup's contents. Path must come from listBackups(). */
export async function readBackup(path) {
  if (!isTauri) throw new Error('Saved backups are only available in the app');
  return await tauriInvoke('read_backup', { path });
}

export async function deleteBackup(path) {
  if (!isTauri) throw new Error('Saved backups are only available in the app');
  return await tauriInvoke('delete_backup', { path });
}

async function checkDue() {
  try {
    const { autoBackupEnabled, nextBackupTime, backupFrequency } = await storageGet([
      'autoBackupEnabled',
      'nextBackupTime',
      'backupFrequency',
    ]);
    if (autoBackupEnabled !== true) return;

    // No schedule yet (toggle predates the scheduler, or storage was cleared) —
    // set one rather than backing up immediately on first launch.
    if (!nextBackupTime) {
      await storageSet({ nextBackupTime: calculateNextBackupTime(backupFrequency || 'weekly') });
      return;
    }

    if (Date.now() < nextBackupTime) return;

    const { path } = await runBackup();
    console.log('[Backup] Scheduled backup written:', path);
    window.dispatchEvent(new CustomEvent('cooldesk:backup-complete'));
  } catch (e) {
    console.warn('[Backup] Scheduled backup failed:', e);
  }
}

let timer = null;
let initialCheck = null;

/**
 * Start the auto-backup scheduler. Desktop app only, idempotent.
 *
 * The returned stop function only tears down the timers if *this* call started
 * them. Under StrictMode the effect is invoked twice: the second call is a
 * no-op, and without this guard the first mount's cleanup would clear the
 * running timer and leave the scheduler permanently stopped.
 */
export function startBackupScheduler() {
  if (!isTauri || timer) return () => {};

  // Check shortly after startup too — the app may have been closed through a
  // scheduled time, and we don't want to wait a full interval to catch up.
  initialCheck = setTimeout(checkDue, 30 * 1000);
  timer = setInterval(checkDue, CHECK_INTERVAL_MS);
  const owned = timer;

  return () => {
    if (timer !== owned) return;
    clearTimeout(initialCheck);
    clearInterval(timer);
    timer = null;
    initialCheck = null;
  };
}
