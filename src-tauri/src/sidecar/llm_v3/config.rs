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
// current user account, so it is no longer readable as plaintext on disk. The
// encrypt/decrypt helpers are intentionally infallible from the caller's point
// of view: any failure falls back to returning the input unchanged so the cloud
// AI feature can never be locked out by a crypto error.

#[cfg(windows)]
fn encrypt_secret(plain: &str) -> String {
    match dpapi::protect(plain.as_bytes()) {
        Ok(blob) => {
            use base64::Engine;
            format!("{}{}", ENC_PREFIX, base64::engine::general_purpose::STANDARD.encode(blob))
        }
        Err(e) => {
            log::warn!("[CloudConfig] DPAPI encrypt failed, storing key unprotected: {}", e);
            plain.to_string()
        }
    }
}

#[cfg(windows)]
fn decrypt_secret(stored: &str) -> String {
    let Some(b64) = stored.strip_prefix(ENC_PREFIX) else {
        // Not encrypted (legacy plaintext) — return as-is.
        return stored.to_string();
    };
    use base64::Engine;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(b64) {
        Ok(b) => b,
        Err(_) => return String::new(),
    };
    match dpapi::unprotect(&bytes) {
        Ok(plain) => String::from_utf8_lossy(&plain).into_owned(),
        Err(e) => {
            log::warn!("[CloudConfig] DPAPI decrypt failed: {}", e);
            String::new()
        }
    }
}

// Non-Windows platforms keep the previous behaviour (no at-rest encryption
// available without a platform-specific keystore). The stored value equals the
// plaintext, and the ENC_PREFIX is never produced, so decrypt is a pass-through.
#[cfg(not(windows))]
fn encrypt_secret(plain: &str) -> String {
    plain.to_string()
}

#[cfg(not(windows))]
fn decrypt_secret(stored: &str) -> String {
    stored.strip_prefix(ENC_PREFIX).map(|s| s.to_string()).unwrap_or_else(|| stored.to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip_recovers_plaintext() {
        let secret = "sk-test-1234567890abcdef";
        let stored = encrypt_secret(secret);
        assert!(stored.starts_with(ENC_PREFIX), "stored value should be marked encrypted");
        assert!(!stored.contains(secret), "ciphertext must not contain the plaintext key");
        assert_eq!(decrypt_secret(&stored), secret, "decrypt must recover the original key");
    }

    #[test]
    fn decrypt_passes_through_legacy_plaintext() {
        // A value without the marker is treated as legacy plaintext.
        assert_eq!(decrypt_secret("sk-legacy-plain"), "sk-legacy-plain");
    }
}

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows::core::PCWSTR;

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    /// Copy the output blob into an owned Vec, then free the OS-allocated buffer.
    unsafe fn take_output(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let owned = slice.to_vec();
        let _ = LocalFree(HLOCAL(out.pbData as *mut core::ffi::c_void));
        owned
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = blob(plain);
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|e| e.to_string())?;
            Ok(take_output(output))
        }
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = blob(cipher);
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|e| e.to_string())?;
            Ok(take_output(output))
        }
    }
}
