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
#[tauri::command]
pub async fn preview_text_file(path: String) -> Result<TextPreview, String> {
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

    // Binary detection: a NUL byte in the sampled region is not valid in any
    // text encoding this preview supports, and appears constantly in real
    // binaries — cheap, reliable "don't try to render this as code" signal.
    if slice.contains(&0u8) {
        return Err("Binary file".to_string());
    }

    let content = String::from_utf8_lossy(slice).into_owned();
    let lines = content.lines().count();

    Ok(TextPreview { content, truncated, lines, size })
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
#[tauri::command]
pub async fn preview_image_file(path: String) -> Result<ImagePreview, String> {
    let p = Path::new(&path);
    let metadata = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Not a file".to_string());
    }
    let size = metadata.len();
    if size > MAX_IMAGE_BYTES {
        return Err(format!("Image too large to preview ({} MB)", size / (1024 * 1024)));
    }

    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime = mime_for_ext(ext);

    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", mime, encoded);

    Ok(ImagePreview { data_url, size })
}
