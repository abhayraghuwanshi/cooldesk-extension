//! Archives in the file tab and file manager: list what's inside, open one
//! file from it, extract it, compress a selection to .zip — what Finder's
//! Archive Utility does.
//!
//! The work goes through the system `tar` (libarchive's bsdtar: /usr/bin/tar
//! on macOS, System32\tar.exe on Windows 10+), which reads zip, tar(.gz/.xz/
//! .bz2), 7z and rar, and refuses entries that would land outside the target
//! folder (absolute paths, `..`). Zip listings come from the `zip` crate so
//! they carry sizes; other formats list names only.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const MAX_ENTRIES: usize = 5000;
/// Finder's clutter, never worth extracting or packing.
const JUNK: [&str; 2] = ["__MACOSX", ".DS_Store"];

#[derive(Serialize)]
pub struct ArchiveEntry {
    name: String,
    size: Option<u64>,
    is_dir: bool,
}

#[derive(Serialize)]
pub struct ArchiveListing {
    entries: Vec<ArchiveEntry>,
    truncated: bool,
}

fn tar() -> Command {
    #[allow(unused_mut)] // only Windows adds flags
    let mut c = Command::new("tar");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

fn run(mut cmd: Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| format!("Couldn't run tar: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.lines().last().unwrap_or("tar failed").trim().to_string())
    }
}

fn is_junk(name: &str) -> bool {
    name.split('/').any(|part| JUNK.contains(&part))
}

/// `name`, then `name 2`, `name 3`… (before the extension), as Finder does.
fn unique(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let make = |n: u32| {
        let base = if n == 1 { stem.to_string() } else { format!("{stem} {n}") };
        dir.join(match ext {
            Some(e) => format!("{base}.{e}"),
            None => base,
        })
    };
    (1..).map(make).find(|p| !p.exists()).unwrap()
}

/// "dist.tar.gz" → "dist".
fn archive_stem(path: &Path) -> String {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("Archive");
    let lower = name.to_lowercase();
    for ext in [".tar.gz", ".tar.xz", ".tar.bz2", ".tgz", ".tbz2", ".txz", ".zip", ".tar", ".7z", ".rar", ".gz", ".xz", ".bz2"] {
        if lower.ends_with(ext) && name.len() > ext.len() {
            return name[..name.len() - ext.len()].to_string();
        }
    }
    name.to_string()
}

fn is_zip(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false)
}

#[tauri::command]
pub async fn archive_list(path: String) -> Result<ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        let mut entries = Vec::new();
        if is_zip(&path) {
            let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Not a readable zip: {e}"))?;
            for i in 0..zip.len() {
                let Ok(f) = zip.by_index_raw(i) else { continue };
                let name = f.name().to_string();
                if is_junk(&name) {
                    continue;
                }
                entries.push(ArchiveEntry { size: (!f.is_dir()).then(|| f.size()), is_dir: f.is_dir(), name });
                if entries.len() > MAX_ENTRIES {
                    break;
                }
            }
        } else {
            let mut cmd = tar();
            cmd.arg("-tf").arg(&path);
            for line in run(cmd)?.lines() {
                if line.is_empty() || is_junk(line) {
                    continue;
                }
                entries.push(ArchiveEntry { name: line.to_string(), size: None, is_dir: line.ends_with('/') });
                if entries.len() > MAX_ENTRIES {
                    break;
                }
            }
        }
        let truncated = entries.len() > MAX_ENTRIES;
        entries.truncate(MAX_ENTRIES);
        Ok(ArchiveListing { entries, truncated })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Extract next to the archive. Like Finder: an archive holding one top
/// folder becomes that folder; anything else goes in a folder named after
/// the archive. Never overwrites — names get " 2", " 3"… Returns the result.
#[tauri::command]
pub async fn archive_extract(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let archive = PathBuf::from(&path);
        let parent = archive.parent().ok_or("No parent folder")?.to_path_buf();
        // Unpack into a hidden scratch folder first, then name the result —
        // so the scratch folder never takes the name the result should get.
        let scratch = parent.join(format!(".cooldesk-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;

        let mut cmd = tar();
        cmd.arg("-xf").arg(&archive).arg("-C").arg(&scratch);
        for j in JUNK {
            cmd.arg("--exclude").arg(j);
        }
        if let Err(e) = run(cmd) {
            let _ = std::fs::remove_dir_all(&scratch);
            return Err(e);
        }

        // One folder inside → that folder; anything else → a folder named
        // after the archive.
        let children: Vec<_> = std::fs::read_dir(&scratch).map_err(|e| e.to_string())?.flatten().collect();
        let (from, name) = match children.as_slice() {
            [only] if only.path().is_dir() => (only.path(), only.file_name().to_string_lossy().into_owned()),
            _ => (scratch.clone(), archive_stem(&archive)),
        };
        let target = unique(&parent, &name, None);
        let moved = std::fs::rename(&from, &target);
        let _ = std::fs::remove_dir_all(&scratch);
        moved.map_err(|e| e.to_string())?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One file out of an archive into a scratch folder, so the file tab can
/// preview it without extracting everything. Returns the extracted path.
#[tauri::command]
pub async fn archive_extract_entry(app: tauri::AppHandle, path: String, entry: String) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    use tauri::Manager;
    let rel = PathBuf::from(&entry);
    if entry.is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Bad entry name".into());
    }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = PathBuf::from(&path);
        let mtime = std::fs::metadata(&archive).and_then(|m| m.modified()).ok();
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (&path, mtime).hash(&mut h);
        let dir = cache.join("archive-preview").join(format!("{:016x}", h.finish()));
        let out = dir.join(&rel);
        if !out.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let mut cmd = tar();
            cmd.arg("-xf").arg(&archive).arg("-C").arg(&dir).arg(&entry);
            run(cmd)?;
        }
        if out.exists() {
            Ok(out.to_string_lossy().into_owned())
        } else {
            Err("That file isn't in the archive".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compress files / folders (all in one folder) to a .zip beside them:
/// "name.zip" for one item, "Archive.zip" for several. Returns the zip.
#[tauri::command]
pub async fn archive_compress(paths: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let items: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let first = items.first().ok_or("Nothing to compress")?;
        let parent = first.parent().ok_or("No parent folder")?.to_path_buf();
        if items.iter().any(|p| p.parent() != Some(parent.as_path())) {
            return Err("Pick items from one folder".into());
        }
        let stem = if items.len() == 1 {
            first.file_stem().and_then(|s| s.to_str()).unwrap_or("Archive").to_string()
        } else {
            "Archive".to_string()
        };
        let dest = unique(&parent, &stem, Some("zip"));

        // -a: format from the .zip suffix; bsdtar's zip writer stores
        // uncompressed unless told otherwise.
        let mut cmd = tar();
        cmd.arg("-a").arg("-cf").arg(&dest).arg("--options").arg("zip:compression=deflate");
        for j in JUNK {
            cmd.arg("--exclude").arg(j);
        }
        cmd.arg("-C").arg(&parent);
        for p in &items {
            cmd.arg(p.file_name().ok_or("Bad file name")?);
        }
        if let Err(e) = run(cmd) {
            let _ = std::fs::remove_file(&dest);
            return Err(e);
        }
        Ok(dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems() {
        assert_eq!(archive_stem(Path::new("/a/dist.tar.gz")), "dist");
        assert_eq!(archive_stem(Path::new("/a/site.zip")), "site");
        assert_eq!(archive_stem(Path::new("/a/v1.2.tgz")), "v1.2");
        assert_eq!(archive_stem(Path::new("/a/.zip")), ".zip");
    }

    #[test]
    fn unique_names_finder_style() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unique(dir.path(), "dist", None), dir.path().join("dist"));
        std::fs::create_dir(dir.path().join("dist")).unwrap();
        assert_eq!(unique(dir.path(), "dist", None), dir.path().join("dist 2"));
        std::fs::write(dir.path().join("a.zip"), b"").unwrap();
        assert_eq!(unique(dir.path(), "a", Some("zip")), dir.path().join("a 2.zip"));
    }

    #[test]
    fn junk_filtered() {
        assert!(is_junk("__MACOSX/dist/._a.js"));
        assert!(is_junk("dist/.DS_Store"));
        assert!(!is_junk("dist/app.js"));
    }

    #[test]
    fn compress_then_list_and_extract() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("proj");
        std::fs::create_dir_all(proj.join("sub")).unwrap();
        std::fs::write(proj.join("a.txt"), "hello ".repeat(2000)).unwrap();
        std::fs::write(proj.join("sub/b.json"), "{}").unwrap();
        std::fs::write(proj.join(".DS_Store"), "x").unwrap();
        let rt = tauri::async_runtime::block_on(archive_compress(vec![proj.to_string_lossy().into_owned()]));
        let zip = PathBuf::from(rt.unwrap());
        assert_eq!(zip, dir.path().join("proj.zip"));
        assert!(std::fs::metadata(&zip).unwrap().len() < 2000, "zip should be compressed");

        let listing = tauri::async_runtime::block_on(archive_list(zip.to_string_lossy().into_owned())).unwrap();
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"proj/a.txt") && names.contains(&"proj/sub/b.json"));
        assert!(!names.iter().any(|n| n.contains(".DS_Store")));

        // proj/ still exists → the single top folder lifts out as "proj 2".
        let out = tauri::async_runtime::block_on(archive_extract(zip.to_string_lossy().into_owned())).unwrap();
        assert_eq!(PathBuf::from(&out), dir.path().join("proj 2"));
        assert!(dir.path().join("proj 2/sub/b.json").exists());
        assert!(!dir.path().join("proj 3").exists());
    }

    #[test]
    fn several_items_extract_into_archive_named_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("x.txt"), "x").unwrap();
        std::fs::write(dir.path().join("y.txt"), "y").unwrap();
        let paths = ["x.txt", "y.txt"].map(|n| dir.path().join(n).to_string_lossy().into_owned()).to_vec();
        let zip = tauri::async_runtime::block_on(archive_compress(paths)).unwrap();
        assert!(zip.ends_with("Archive.zip"));
        let out = tauri::async_runtime::block_on(archive_extract(zip)).unwrap();
        assert_eq!(PathBuf::from(&out), dir.path().join("Archive"));
        assert!(dir.path().join("Archive/x.txt").exists() && dir.path().join("Archive/y.txt").exists());
        // No scratch folder left behind.
        assert!(!std::fs::read_dir(dir.path()).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".cooldesk-extract")));
    }
}
