/**
 * Backup inspection and restore.
 *
 * A backup file can come from any past version of the app, so restore is not a
 * straight `put` of every row. This module answers three questions before
 * writing anything: what version wrote this file, which of its stores still
 * exist, and which rows can actually be keyed into those stores.
 *
 * ── On schema versions ──────────────────────────────────────────────────────
 * Every DB migration from v1..v15 (see MIGRATIONS in db/unified-db.js) is
 * *structural* — it creates object stores and indexes. Exactly one changes the
 * shape of existing rows: v9 adds `status` to workspace_urls and backfills it
 * to 'active'. That is why ROW_MIGRATIONS below has a single entry rather than
 * one per version; the rest need no row rewriting.
 *
 * Consequences that fall out of that:
 *   • Older backup → its stores are a subset of today's. Missing stores just
 *     stay empty; rows only need forward ROW_MIGRATIONS applied.
 *   • Newer backup → it may carry stores this build has never heard of. Those
 *     are skipped and reported rather than treated as an error, so a user who
 *     rolls back a version can still recover the data this build understands.
 *
 * Rows are NOT run through db/validation.js. That validator is deliberately
 * strict (unknown fields throw), which is right for live writes but wrong here:
 * a backup is already-accepted data, and rejecting a row because a since-removed
 * field is present would silently drop history. Restore instead checks the one
 * thing IndexedDB actually requires — that the row carries its store's keyPath.
 */

import { DB_CONFIG, getUnifiedDB } from '../db/index.js';
import { storageGet, storageRemove, storageSet } from './extensionApi';

const KNOWN_STORES = Object.values(DB_CONFIG.STORES);

/**
 * Row-shape migrations, keyed by the DB version that introduced the change.
 * Applied in ascending order for every version greater than the backup's.
 *
 * Signature: (storeName, row) => row | null   (null drops the row)
 */
const ROW_MIGRATIONS = {
  9: (storeName, row) => {
    // v9 added the draft/active tier to workspace_urls. Rows written before it
    // were manually curated, so they are grandfathered in as 'active' — the
    // same backfill the live migration performs.
    if (storeName !== DB_CONFIG.STORES.WORKSPACE_URLS) return row;
    if (row.status) return row;
    return { ...row, status: 'active' };
  },
};

const MIGRATION_VERSIONS = Object.keys(ROW_MIGRATIONS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * Parse and structurally check a backup file.
 * Throws on anything that isn't recognisably a CoolDesk backup.
 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file is empty or not an object');
  }
  if (!parsed.stores || typeof parsed.stores !== 'object') {
    throw new Error('Invalid backup format: missing "stores"');
  }
  return parsed;
}

/**
 * Describe a parsed backup against the current schema, without writing.
 * Use this to show the user what will happen before they commit.
 */
export function inspectBackup(parsed) {
  // Backups written before this change only carry `meta.version` (the IndexedDB
  // version at export time); newer ones carry an explicit `dbVersion`.
  const dbVersion = Number(parsed.meta?.dbVersion ?? parsed.meta?.version) || null;
  const current = DB_CONFIG.VERSION;

  const backupStores = Object.keys(parsed.stores).filter((s) => Array.isArray(parsed.stores[s]));
  const unknownStores = backupStores.filter((s) => !KNOWN_STORES.includes(s));
  const missingStores = KNOWN_STORES.filter((s) => !backupStores.includes(s));

  let rowCount = 0;
  for (const s of backupStores) rowCount += parsed.stores[s].length;

  let compatibility = 'ok';
  if (!dbVersion) compatibility = 'unknown';
  else if (dbVersion < current) compatibility = 'upgrade';
  else if (dbVersion > current) compatibility = 'newer';

  return {
    dbVersion,
    currentVersion: current,
    appVersion: parsed.meta?.appVersion || null,
    createdAt: parsed.meta?.exportedAt || null,
    compatibility,
    rowCount,
    storeCount: backupStores.length,
    unknownStores,
    missingStores,
    // Which row migrations will run.
    pendingMigrations: dbVersion
      ? MIGRATION_VERSIONS.filter((v) => v > dbVersion && v <= current)
      : [],
  };
}

/**
 * Apply forward row migrations for a single row.
 * `fromVersion` null (unknown origin) means apply everything — safest, since
 * each migration is written to no-op when the change is already present.
 */
function migrateRow(storeName, row, fromVersion) {
  let out = row;
  for (const v of MIGRATION_VERSIONS) {
    if (fromVersion !== null && v <= fromVersion) continue;
    if (out === null) break;
    out = ROW_MIGRATIONS[v](storeName, out);
  }
  return out;
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * True when `row` carries the key the store needs. A row missing its keyPath
 * makes `put` throw, which is the single most common cause of a "successful"
 * import that wrote nothing.
 */
function hasKey(row, keyPath) {
  if (!keyPath) return true; // out-of-line keys — nothing to check
  const paths = Array.isArray(keyPath) ? keyPath : [keyPath];
  return paths.every((p) => {
    const value = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row);
    return value !== undefined && value !== null && value !== '';
  });
}

/**
 * Restore a parsed backup into the live database.
 *
 * Returns a per-store report of what was written vs skipped, and why. Unlike a
 * blanket try/catch this distinguishes "wrote 0 rows because the store is gone"
 * from "wrote 0 rows because every row failed" — the caller can surface it.
 */
export async function restoreBackup(parsed, { replace = false } = {}) {
  const info = inspectBackup(parsed);
  const db = await getUnifiedDB();
  const liveStores = Array.from(db.objectStoreNames);

  const report = {
    ...info,
    stores: {},
    written: 0,
    skipped: 0,
    errors: [],
  };

  if (replace) {
    for (const storeName of KNOWN_STORES) {
      if (!liveStores.includes(storeName)) continue;
      try {
        const tx = db.transaction(storeName, 'readwrite');
        await idbRequest(tx.objectStore(storeName).clear());
      } catch (e) {
        report.errors.push(`Could not clear ${storeName}: ${e.message || e}`);
      }
    }
    try {
      const all = await storageGet(null);
      const stale = Object.keys(all).filter((k) => k.startsWith('dailyNotes_'));
      if (stale.length) await storageRemove(stale);
    } catch (e) {
      report.errors.push(`Could not clear daily notes: ${e.message || e}`);
    }
  }

  for (const [storeName, rows] of Object.entries(parsed.stores)) {
    if (!Array.isArray(rows)) continue;

    if (!liveStores.includes(storeName)) {
      report.stores[storeName] = {
        written: 0,
        skipped: rows.length,
        reason: KNOWN_STORES.includes(storeName)
          ? 'store missing from this database'
          : 'store not present in this app version',
      };
      report.skipped += rows.length;
      continue;
    }

    let written = 0;
    let skipped = 0;
    let firstError = null;

    // One transaction per store. Reissuing puts synchronously inside each
    // awaited request keeps it alive; a fresh transaction per store keeps one
    // bad store from aborting the whole restore.
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const keyPath = store.keyPath;

    for (const raw of rows) {
      const row = migrateRow(storeName, raw, info.dbVersion);
      if (row === null || typeof row !== 'object') {
        skipped += 1;
        continue;
      }
      if (!hasKey(row, keyPath)) {
        skipped += 1;
        if (!firstError) firstError = `rows missing key "${keyPath}"`;
        continue;
      }
      try {
        await idbRequest(store.put(row));
        written += 1;
      } catch (e) {
        skipped += 1;
        if (!firstError) firstError = e.message || String(e);
      }
    }

    report.stores[storeName] = { written, skipped, reason: firstError || null };
    report.written += written;
    report.skipped += skipped;
  }

  await restoreLocalStorage(parsed, report);
  return report;
}

/**
 * Restore the non-IndexedDB half of a backup: extension storage keys, plus the
 * couple of localStorage-backed view settings.
 */
async function restoreLocalStorage(parsed, report) {
  const local = parsed.storageLocal;
  if (!local || typeof local !== 'object') return;

  try {
    const updates = {};
    if (Array.isArray(local.pinnedWorkspaces)) updates.pinnedWorkspaces = local.pinnedWorkspaces;
    if (local.domainSelectors) updates.domainSelectors = local.domainSelectors;
    if (local.platformSettings) updates.platformSettings = local.platformSettings;
    if (local.genericScraperAllowlist) updates.genericScraperAllowlist = local.genericScraperAllowlist;

    if (local.dailyNotes && typeof local.dailyNotes === 'object') {
      const dn = local.dailyNotes;
      if (dn.notesByDate && typeof dn.notesByDate === 'object') {
        for (const [k, v] of Object.entries(dn.notesByDate)) {
          if (k.startsWith('dailyNotes_')) updates[k] = v;
        }
      }
      if (dn.summary && typeof dn.summary === 'object') updates.dailyNotesSummary = dn.summary;
      if (Number.isFinite(Number(dn.lastUpdate))) updates.dailyNotesLastUpdate = Number(dn.lastUpdate);
    }

    if (Object.keys(updates).length) await storageSet(updates);
  } catch (e) {
    report.errors.push(`Could not restore local storage: ${e.message || e}`);
  }

  try {
    if (local.viewMode) localStorage.setItem('cooldesk_view_mode', local.viewMode);
    if (local.displaySettings) {
      localStorage.setItem('cooldesk_display_settings', JSON.stringify(local.displaySettings));
      window.dispatchEvent(new CustomEvent('displaySettingsChanged', { detail: local.displaySettings }));
      window.dispatchEvent(new CustomEvent('viewModeChanged', {
        detail: { modeId: local.viewMode || 'default' },
      }));
    }
  } catch (e) {
    report.errors.push(`Could not restore view settings: ${e.message || e}`);
  }
}
