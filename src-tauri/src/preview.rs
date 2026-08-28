//! File preview for the spotlight's Quick-Look-style pane: read a text/code
//! file's content (capped, for syntax highlighting on the JS side) or an
//! image's bytes (as a data: URI, so the webview never needs filesystem
//! access of its own — no asset-protocol scope to configure for arbitrary
//! user paths).

use serde::Serialize;
use std::path::Path;

/// Cap on how much of a text file gets read. Large enough for any real
/// source file, small enough that a stray 500MB log doesn't stall the UI or
/// bloat the highlighted DOM.
const MAX_TEXT_BYTES: u64 = 512 * 1024;

/// Cap on image size. Spotlight is a quick-glance preview, not a viewer for
/// full-resolution originals — and a giant PNG base64-inflates to ~1.37x its
/// byte size before it even reaches the webview.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
pub struct TextPreview {
    content: String,
    truncated: bool,
    lines: usize,
    size: u64,
}

/// Read a file as UTF-8 text for the code/text preview pane.
///
/// Runs on a blocking-pool thread rather than directly in this async fn —
/// `std::fs::read` on a large file would otherwise stall whatever tokio
/// worker thread picked up this command, delaying every other Tauri IPC call
/// scheduled on it.
#[tauri::command]
pub async fn preview_text_file(path: String) -> Result<TextPreview, String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        let metadata = std::fs::metadata(p).map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("Not a file".to_string());
        }
        let size = metadata.len();

        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        let truncated = bytes.len() as u64 > MAX_TEXT_BYTES;
        let slice = if truncated {
            &bytes[..MAX_TEXT_BYTES as usize]
        } else {
            &bytes[..]
        };

        // Binary detection: a NUL byte in the sampled region is not valid in
        // any text encoding this preview supports, and appears constantly in
        // real binaries — cheap, reliable "don't try to render this as code"
        // signal.
        if slice.contains(&0u8) {
            return Err("Binary file".to_string());
        }

        let content = String::from_utf8_lossy(slice).into_owned();
        let lines = content.lines().count();

        Ok(TextPreview { content, truncated, lines, size })
    })
    .await
    .map_err(|e| format!("preview_text_file panicked: {e}"))?
}

/// Read a file's bytes, rejecting non-files and anything over `max_bytes`.
/// Shared by every preview command that hands the whole file to the webview
/// (as opposed to `preview_text_file`, which truncates instead of erroring).
fn read_capped(p: &Path, max_bytes: u64, label: &str) -> Result<(Vec<u8>, u64), String> {
    let metadata = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Not a file".to_string());
    }
    let size = metadata.len();
    if size > max_bytes {
        return Err(format!("{label} too large to preview ({} MB)", size / (1024 * 1024)));
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    Ok((bytes, size))
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

#[derive(Serialize)]
pub struct ImagePreview {
    /// data: URI — ready to drop straight into an <img src>.
    data_url: String,
    size: u64,
}

/// Read an image file and return it as a data: URI.
///
/// See `preview_text_file`'s doc comment for why this runs via
/// `spawn_blocking` — same reasoning, and images can be up to `MAX_IMAGE_BYTES`.
#[tauri::command]
pub async fn preview_image_file(path: String) -> Result<ImagePreview, String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        let (bytes, size) = read_capped(p, MAX_IMAGE_BYTES, "Image")?;

        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let mime = mime_for_ext(ext);

        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let data_url = format!("data:{};base64,{}", mime, encoded);

        Ok(ImagePreview { data_url, size })
    })
    .await
    .map_err(|e| format!("preview_image_file panicked: {e}"))?
}

/// Cap on PDF size — same reasoning as `MAX_IMAGE_BYTES`, just a bit more
/// generous since PDFs commonly run larger than a typical preview-worthy image.
const MAX_PDF_BYTES: u64 = 40 * 1024 * 1024;

#[derive(Serialize)]
pub struct PdfPreview {
    /// Base64 of the raw PDF bytes — decoded back to a Uint8Array on the JS
    /// side and handed to pdf.js as `{ data }`, not a URL. pdf.js's default
    /// loader does HTTP range-request probing against whatever URL it's
    /// given, and Tauri's `asset://` custom-protocol handler doesn't behave
    /// like a real range-capable HTTP server for that — it was failing
    /// silently (empty catch block, now logged) before this existed. Same
    /// fix `preview_image_file` already applies for images, for the same
    /// reason (see the module doc comment).
    data_b64: String,
    size: u64,
}

/// Read a PDF file and return its raw bytes (base64) for pdf.js to parse
/// in-memory, bypassing the asset protocol entirely.
///
/// See `preview_text_file`'s doc comment for why this runs via
/// `spawn_blocking` — same reasoning, and PDFs can be up to `MAX_PDF_BYTES`
/// (larger than the image cap), making the stall worse if left inline.
#[tauri::command]
pub async fn preview_pdf_file(path: String) -> Result<PdfPreview, String> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        let (bytes, size) = read_capped(p, MAX_PDF_BYTES, "PDF")?;

        use base64::Engine;
        let data_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(PdfPreview { data_b64, size })
    })
    .await
    .map_err(|e| format!("preview_pdf_file panicked: {e}"))?
}
