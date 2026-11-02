// Password vault: a small, local, encrypted store of logins, shown as a
// "Passwords" card in the side dock. Opt-in (Settings > Behaviour).
//
// Storage is one file, app-data `vault/vault.json`:
//   { version, salt, m_cost, t_cost, p_cost, nonce, data }
// `data` is the JSON list of entries sealed with XChaCha20-Poly1305 under a
// key derived from the master password with Argon2id. The master password
// itself is never stored; a wrong one simply fails to decrypt. A fresh nonce
// is used for every save.
//
// While unlocked, the key and decrypted entries live only in memory. The
// vault locks itself after `IDLE_LOCK` without use, and passwords copied
// from it are marked concealed (skipped by clipboard managers, including
// this app's history) and wiped from the clipboard after `CLIPBOARD_CLEAR`
// if they're still there.
//
// There is no recovery: forget the master password and the vault is gone.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use zeroize::{Zeroize, Zeroizing};

const FILE: &str = "vault.json";
const SETTINGS: &str = "settings.json";
const IDLE_LOCK: Duration = Duration::from_secs(5 * 60);
const CLIPBOARD_CLEAR: Duration = Duration::from_secs(30);
const MIN_MASTER_LEN: usize = 8;
// Argon2id: 64 MiB, 3 passes — a few hundred ms on a laptop.
const M_COST: u32 = 64 * 1024;
const T_COST: u32 = 3;
const P_COST: u32 = 1;

#[derive(Clone, Serialize, Deserialize, Zeroize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,
    pub updated: i64,
}

/// What the list shows — everything but the password and notes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub id: String,
    pub title: String,
    pub username: String,
    pub url: String,
    pub has_notes: bool,
    pub updated: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Serialize, Deserialize)]
struct Sealed {
    version: u32,
    salt: String,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
    nonce: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub enabled: bool,
    /// A vault file exists (a master password has been set).
    pub exists: bool,
    pub unlocked: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    enabled: bool,
}

struct Unlocked {
    key: Zeroizing<[u8; 32]>,
    salt: Vec<u8>,
    entries: Vec<Entry>,
    last_used: Instant,
}

impl Drop for Unlocked {
    fn drop(&mut self) {
        self.entries.zeroize();
    }
}

lazy_static::lazy_static! {
    static ref STATE: Mutex<Option<Unlocked>> = Mutex::new(None);
}

static ENABLED: AtomicBool = AtomicBool::new(false);

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn vault_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("vault");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Write via a temp file + rename so a crash mid-write can't corrupt the vault.
fn write_atomic(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn derive_key(master: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(m, t, p, Some(32)).map_err(|e| e.to_string())?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(master.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;
    Ok(key)
}

fn seal(app: &tauri::AppHandle, s: &Unlocked) -> Result<(), String> {
    let plain = Zeroizing::new(serde_json::to_vec(&s.entries).map_err(|e| e.to_string())?);
    let mut nonce = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = XChaCha20Poly1305::new(s.key.as_ref().into());
    let data = cipher
        .encrypt(XNonce::from_slice(&nonce), plain.as_slice())
        .map_err(|_| "Encryption failed".to_string())?;
    let sealed = Sealed {
        version: 1,
        salt: B64.encode(&s.salt),
        m_cost: M_COST,
        t_cost: T_COST,
        p_cost: P_COST,
        nonce: B64.encode(nonce),
        data: B64.encode(data),
    };
    let json = serde_json::to_vec_pretty(&sealed).map_err(|e| e.to_string())?;
    write_atomic(&vault_dir(app)?.join(FILE), &json)
}

fn open_sealed(master: &str, sealed: &Sealed) -> Result<Unlocked, String> {
    let salt = B64.decode(&sealed.salt).map_err(|_| "Vault file is damaged")?;
    let nonce = B64.decode(&sealed.nonce).map_err(|_| "Vault file is damaged")?;
    let data = B64.decode(&sealed.data).map_err(|_| "Vault file is damaged")?;
    if nonce.len() != 24 {
        return Err("Vault file is damaged".into());
    }
    let key = derive_key(master, &salt, sealed.m_cost, sealed.t_cost, sealed.p_cost)?;
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let plain = Zeroizing::new(
        cipher
            .decrypt(XNonce::from_slice(&nonce), data.as_slice())
            .map_err(|_| "Wrong master password".to_string())?,
    );
    let entries: Vec<Entry> = serde_json::from_slice(&plain).map_err(|_| "Vault file is damaged")?;
    Ok(Unlocked { key, salt, entries, last_used: Instant::now() })
}

fn read_sealed(app: &tauri::AppHandle) -> Result<Sealed, String> {
    let bytes = std::fs::read(vault_dir(app)?.join(FILE)).map_err(|_| "No vault yet")?;
    serde_json::from_slice(&bytes).map_err(|_| "Vault file is damaged".into())
}

fn exists(app: &tauri::AppHandle) -> bool {
    vault_dir(app).map(|d| d.join(FILE).exists()).unwrap_or(false)
}

fn status(app: &tauri::AppHandle) -> VaultStatus {
    VaultStatus {
        enabled: ENABLED.load(Ordering::SeqCst),
        exists: exists(app),
        unlocked: STATE.lock().unwrap().is_some(),
    }
}

fn emit_status(app: &tauri::AppHandle) -> VaultStatus {
    let s = status(app);
    let _ = app.emit("vault-status", s.clone());
    s
}

/// Run `f` against the unlocked vault, counting it as use (resets the idle timer).
fn with_unlocked<T>(f: impl FnOnce(&mut Unlocked) -> Result<T, String>) -> Result<T, String> {
    let mut guard = STATE.lock().unwrap();
    let s = guard.as_mut().ok_or("Vault is locked")?;
    s.last_used = Instant::now();
    f(s)
}

fn summary(e: &Entry) -> EntrySummary {
    EntrySummary {
        id: e.id.clone(),
        title: e.title.clone(),
        username: e.username.clone(),
        url: e.url.clone(),
        has_notes: !e.notes.is_empty(),
        updated: e.updated,
    }
}

/// Load settings and start the idle auto-lock thread.
pub fn start(app: tauri::AppHandle) {
    if let Ok(dir) = vault_dir(&app) {
        if let Some(s) = std::fs::read_to_string(dir.join(SETTINGS))
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        {
            ENABLED.store(s.enabled, Ordering::SeqCst);
        }
    }
    std::thread::Builder::new()
        .name("vault-autolock".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(10));
            let expired = {
                let mut guard = STATE.lock().unwrap();
                let expired = guard.as_ref().is_some_and(|s| s.last_used.elapsed() >= IDLE_LOCK);
                if expired {
                    *guard = None;
                }
                expired
            };
            if expired {
                emit_status(&app);
            }
        })
        .expect("spawn vault auto-lock");
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn vault_status(app: tauri::AppHandle) -> VaultStatus {
    status(&app)
}

#[tauri::command]
pub fn vault_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<VaultStatus, String> {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        *STATE.lock().unwrap() = None;
    }
    let json = serde_json::to_string(&Settings { enabled }).map_err(|e| e.to_string())?;
    std::fs::write(vault_dir(&app)?.join(SETTINGS), json).map_err(|e| e.to_string())?;
    Ok(emit_status(&app))
}

/// Create a new, empty vault (refuses if one exists).
#[tauri::command]
pub async fn vault_create(app: tauri::AppHandle, master: String) -> Result<VaultStatus, String> {
    let master = Zeroizing::new(master);
    if master.chars().count() < MIN_MASTER_LEN {
        return Err(format!("Use at least {MIN_MASTER_LEN} characters"));
    }
    if exists(&app) {
        return Err("A vault already exists".into());
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut salt = vec![0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let key = derive_key(&master, &salt, M_COST, T_COST, P_COST)?;
        let unlocked = Unlocked { key, salt, entries: Vec::new(), last_used: Instant::now() };
        seal(&app2, &unlocked)?;
        *STATE.lock().unwrap() = Some(unlocked);
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(emit_status(&app))
}

#[tauri::command]
pub async fn vault_unlock(app: tauri::AppHandle, master: String) -> Result<VaultStatus, String> {
    let master = Zeroizing::new(master);
    let sealed = read_sealed(&app)?;
    let unlocked = tauri::async_runtime::spawn_blocking(move || open_sealed(&master, &sealed))
        .await
        .map_err(|e| e.to_string())??;
    *STATE.lock().unwrap() = Some(unlocked);
    Ok(emit_status(&app))
}

#[tauri::command]
pub fn vault_lock(app: tauri::AppHandle) -> VaultStatus {
    *STATE.lock().unwrap() = None;
    emit_status(&app)
}

/// Re-encrypt under a new master password (needs the current one).
#[tauri::command]
pub async fn vault_change_master(app: tauri::AppHandle, current: String, next: String) -> Result<(), String> {
    let current = Zeroizing::new(current);
    let next = Zeroizing::new(next);
    if next.chars().count() < MIN_MASTER_LEN {
        return Err(format!("Use at least {MIN_MASTER_LEN} characters"));
    }
    let sealed = read_sealed(&app)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut unlocked = open_sealed(&current, &sealed)?;
        let mut salt = vec![0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        unlocked.key = derive_key(&next, &salt, M_COST, T_COST, P_COST)?;
        unlocked.salt = salt;
        seal(&app2, &unlocked)?;
        *STATE.lock().unwrap() = Some(unlocked);
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    emit_status(&app);
    Ok(())
}

#[tauri::command]
pub fn vault_list() -> Result<Vec<EntrySummary>, String> {
    with_unlocked(|s| {
        let mut list: Vec<EntrySummary> = s.entries.iter().map(summary).collect();
        list.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(list)
    })
}

/// The full entry, password included — for revealing or editing.
#[tauri::command]
pub fn vault_get(id: String) -> Result<Entry, String> {
    with_unlocked(|s| s.entries.iter().find(|e| e.id == id).cloned().ok_or_else(|| "Entry not found".into()))
}

#[tauri::command]
pub fn vault_save(app: tauri::AppHandle, entry: EntryInput) -> Result<String, String> {
    let title = entry.title.trim().to_string();
    if title.is_empty() {
        return Err("Give it a name".into());
    }
    let id = with_unlocked(|s| {
        let id = match entry.id.as_deref().filter(|id| !id.is_empty()) {
            Some(id) => {
                let e = s.entries.iter_mut().find(|e| e.id == id).ok_or("Entry not found")?;
                e.title = title;
                e.username = entry.username;
                e.password.zeroize();
                e.password = entry.password;
                e.url = entry.url.trim().to_string();
                e.notes = entry.notes;
                e.updated = now_ms();
                id.to_string()
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                s.entries.push(Entry {
                    id: id.clone(),
                    title,
                    username: entry.username,
                    password: entry.password,
                    url: entry.url.trim().to_string(),
                    notes: entry.notes,
                    updated: now_ms(),
                });
                id
            }
        };
        seal(&app, s)?;
        Ok(id)
    })?;
    let _ = app.emit("vault-changed", ());
    Ok(id)
}

#[tauri::command]
pub fn vault_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    with_unlocked(|s| {
        let before = s.entries.len();
        s.entries.retain(|e| e.id != id);
        if s.entries.len() == before {
            return Err("Entry not found".into());
        }
        seal(&app, s)
    })?;
    let _ = app.emit("vault-changed", ());
    Ok(())
}

/// Copy an entry's "password" or "username". Passwords are marked concealed
/// and cleared from the clipboard after `CLIPBOARD_CLEAR`.
#[tauri::command]
pub fn vault_copy(id: String, field: String) -> Result<(), String> {
    let (text, secret) = with_unlocked(|s| {
        let e = s.entries.iter().find(|e| e.id == id).ok_or("Entry not found")?;
        match field.as_str() {
            "password" => Ok((Zeroizing::new(e.password.clone()), true)),
            "username" => Ok((Zeroizing::new(e.username.clone()), false)),
            _ => Err("Unknown field".to_string()),
        }
    })?;
    if text.is_empty() {
        return Err("Nothing to copy".into());
    }
    crate::clipboard::set_secret_text(&text)?;
    if secret {
        std::thread::spawn(move || {
            std::thread::sleep(CLIPBOARD_CLEAR);
            crate::clipboard::clear_if_text(&text);
        });
    }
    Ok(())
}

/// A random password. Works while locked — it touches no vault data.
#[tauri::command]
pub fn vault_generate(length: Option<usize>, symbols: Option<bool>) -> String {
    const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    const DIGITS: &[u8] = b"23456789";
    const SYMBOLS: &[u8] = b"!@#$%^&*-_=+?";
    let len = length.unwrap_or(20).clamp(8, 128);
    let mut sets: Vec<&[u8]> = vec![LOWER, UPPER, DIGITS];
    if symbols.unwrap_or(true) {
        sets.push(SYMBOLS);
    }
    let all: Vec<u8> = sets.concat();
    let mut rng = rand::rngs::OsRng;
    // One from each set, the rest from all of them, then shuffle.
    let mut out: Vec<u8> = sets.iter().map(|s| s[rng.gen_range(0..s.len())]).collect();
    while out.len() < len {
        out.push(all[rng.gen_range(0..all.len())]);
    }
    for i in (1..out.len()).rev() {
        out.swap(i, rng.gen_range(0..=i));
    }
    String::from_utf8(out).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sealed_with(master: &str, entries: &[Entry]) -> Sealed {
        let salt = [7u8; 16];
        // Small params so the test is quick.
        let key = derive_key(master, &salt, 8, 1, 1).unwrap();
        let nonce = [3u8; 24];
        let data = XChaCha20Poly1305::new(key.as_ref().into())
            .encrypt(XNonce::from_slice(&nonce), serde_json::to_vec(entries).unwrap().as_slice())
            .unwrap();
        Sealed {
            version: 1,
            salt: B64.encode(salt),
            m_cost: 8,
            t_cost: 1,
            p_cost: 1,
            nonce: B64.encode(nonce),
            data: B64.encode(data),
        }
    }

    #[test]
    fn round_trip_and_wrong_password() {
        let entry = Entry {
            id: "1".into(),
            title: "Mail".into(),
            username: "me".into(),
            password: "hunter2".into(),
            url: String::new(),
            notes: String::new(),
            updated: 0,
        };
        let sealed = sealed_with("correct horse", &[entry]);
        let opened = open_sealed("correct horse", &sealed).unwrap();
        assert_eq!(opened.entries[0].password, "hunter2");
        assert_eq!(open_sealed("wrong", &sealed).err().unwrap(), "Wrong master password");
    }

    #[test]
    fn generated_passwords() {
        for _ in 0..50 {
            let p = vault_generate(Some(16), Some(true));
            assert_eq!(p.len(), 16);
            assert!(p.bytes().any(|b| b.is_ascii_digit()));
            assert!(p.bytes().any(|b| b.is_ascii_uppercase()));
            assert!(p.bytes().any(|b| b.is_ascii_lowercase()));
        }
        assert!(vault_generate(Some(12), Some(false)).bytes().all(|b| b.is_ascii_alphanumeric()));
    }
}
