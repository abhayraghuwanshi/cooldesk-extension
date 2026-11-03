import { useCallback, useEffect, useState } from 'react';
import { recordFeature } from '../../services/analytics';

// Password vault (src-tauri/src/vault.rs). Emits `vault-status` when it's
// enabled/created/unlocked/locked (including the idle auto-lock) and
// `vault-changed` after an entry is saved or deleted. Passwords never sit in
// the list — they're fetched one entry at a time with `vault_get`.

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

async function listen(event, fn) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(event, fn);
}

function useTauriEvent(event, fn, active = true) {
  useEffect(() => {
    if (!IS_TAURI || !active) return undefined;
    let off = null;
    let cancelled = false;
    listen(event, fn).then(un => (cancelled ? un() : (off = un)));
    return () => { cancelled = true; off?.(); };
  }, [event, fn, active]);
}

/** { enabled, exists, unlocked } — null until loaded. */
export function useVaultStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (IS_TAURI) invoke('vault_status').then(setStatus).catch(() => { });
  }, []);
  useTauriEvent('vault-status', useCallback(({ payload }) => setStatus(payload), []));

  const setEnabled = useCallback(enabled => invoke('vault_set_enabled', { enabled }).then(setStatus), []);
  const create = useCallback(master => invoke('vault_create', { master }).then(setStatus), []);
  const unlock = useCallback(master => invoke('vault_unlock', { master }).then((s) => { recordFeature('vault_unlock'); setStatus(s); }), []);
  const lock = useCallback(() => invoke('vault_lock').then(setStatus), []);
  const changeMaster = useCallback((current, next) => invoke('vault_change_master', { current, next }), []);
  return { status, setEnabled, create, unlock, lock, changeMaster };
}

export function useVaultEntries({ active = true } = {}) {
  const [items, setItems] = useState([]);
  const refresh = useCallback(() => {
    invoke('vault_list').then(l => setItems(Array.isArray(l) ? l : [])).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    if (active) refresh();
    else setItems([]); // locked: drop everything from memory
  }, [active, refresh]);
  useTauriEvent('vault-changed', refresh, active);

  const get = useCallback(id => invoke('vault_get', { id }), []);
  const save = useCallback(entry => invoke('vault_save', { entry }), []);
  const remove = useCallback(id => invoke('vault_delete', { id }), []);
  const copy = useCallback((id, field) => invoke('vault_copy', { id, field }), []);
  return { items, get, save, remove, copy };
}

export function generatePassword(length = 20, symbols = true) {
  return invoke('vault_generate', { length, symbols });
}
