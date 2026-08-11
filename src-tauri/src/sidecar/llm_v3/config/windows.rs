// Windows at-rest secret protection for the stored API key, via DPAPI
// (`CryptProtectData`/`CryptUnprotectData`), scoped to the current user
// account. See `config.rs` for the module-level overview and public API.

use super::ENC_PREFIX;

/// Encrypt/decrypt are intentionally infallible from the caller's point of
/// view: any failure falls back to returning the input unchanged so the cloud
/// AI feature can never be locked out by a crypto error.
pub fn encrypt_secret(plain: &str) -> String {
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

pub fn decrypt_secret(stored: &str) -> String {
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

#[cfg(test)]
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
