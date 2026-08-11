use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudConfig {
    pub provider: String, // "openai" | "anthropic"
    pub api_key: String,
    pub model: String,
}

impl Default for CloudConfig {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}

/// Marker prefix for an API key that has been encrypted at rest (Windows DPAPI).
/// A stored value without this prefix is treated as legacy plaintext and migrated
/// to an encrypted form the next time the config is read.
const ENC_PREFIX: &str = "dpapi:v1:";

fn config_path() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("sync-data").join("cloud_config.json")
}

pub fn load_config() -> CloudConfig {
    let path = config_path();
    if !path.exists() {
        return CloudConfig::default();
    }
    let mut config: CloudConfig = match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => return CloudConfig::default(),
    };

    if !config.api_key.is_empty() {
        let was_encrypted = config.api_key.starts_with(ENC_PREFIX);
        // Always hand callers a plaintext key in memory.
        config.api_key = decrypt_secret(&config.api_key);

        // One-time migration: an existing plaintext key on disk gets re-saved in
        // encrypted form so the cleartext no longer lingers in the file. Best effort —
        // a failure here must never break reading the config.
        if !was_encrypted {
            let _ = save_config(&config);
        }
    }

    config
}

pub fn save_config(config: &CloudConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Encrypt the key for storage without mutating the caller's config.
    let mut on_disk = config.clone();
    if !on_disk.api_key.is_empty() && !on_disk.api_key.starts_with(ENC_PREFIX) {
        on_disk.api_key = encrypt_secret(&on_disk.api_key);
    }
    let json = serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Returns the API key — config file takes priority, env var is the fallback.
pub fn get_api_key() -> Option<String> {
    let from_file = load_config().api_key;
    if !from_file.is_empty() {
        return Some(from_file);
    }
    std::env::var("OPENAI_API_KEY").ok().filter(|k| !k.is_empty())
}

/// Mask an API key for safe display: "sk-abc...xyz1"
pub fn mask_key(key: &str) -> String {
    if key.len() <= 8 {
        return "***".to_string();
    }
    let prefix = &key[..6];
    let suffix = &key[key.len() - 4..];
    format!("{}...{}", prefix, suffix)
}

// ── At-rest secret protection ────────────────────────────────────────────────
// On Windows the key is sealed with DPAPI (CryptProtectData), scoped to the
// current user account, so it is no longer readable as plaintext on disk —
// see `config/windows.rs`. Non-Windows platforms keep the previous behaviour
// (no at-rest encryption available without a platform-specific keystore): the
// stored value equals the plaintext, and the ENC_PREFIX is never produced, so
// decrypt is a pass-through.

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows::{decrypt_secret, encrypt_secret};

#[cfg(not(windows))]
fn encrypt_secret(plain: &str) -> String {
    plain.to_string()
}

#[cfg(not(windows))]
fn decrypt_secret(stored: &str) -> String {
    stored.strip_prefix(ENC_PREFIX).map(|s| s.to_string()).unwrap_or_else(|| stored.to_string())
}
