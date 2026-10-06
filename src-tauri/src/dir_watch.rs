//! Live updates for the file manager: watch the folder being viewed and tell
//! the UI when its contents change, so a finished download (or anything else
//! written there) shows up without a manual refresh.
//!
//! One non-recursive watch per folder, ref-counted: the file manager can be
//! open in more than one place, and each `watch_dir` is paired with an
//! `unwatch_dir` when it navigates away or closes. Changes are debounced —
//! a browser download is a temp file created, grown, then renamed, and the
//! UI only needs to re-list once it settles.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Quiet period before telling the UI. Long enough to swallow a download's
/// create/write/rename burst, short enough to feel immediate.
const SETTLE: Duration = Duration::from_millis(300);

struct Watch {
    _watcher: RecommendedWatcher,
    refs: usize,
}

lazy_static::lazy_static! {
    static ref WATCHES: Mutex<HashMap<String, Watch>> = Mutex::new(HashMap::new());
}

#[derive(Clone, serde::Serialize)]
struct DirChanged {
    path: String,
}

/// Start (or share) a watch on `path`. Emits `dir-changed` with `{ path }`
/// — the same string passed in, so the UI can compare it to what it shows.
#[tauri::command]
pub fn watch_dir(app: AppHandle, path: String) -> Result<(), String> {
    let mut watches = WATCHES.lock().map_err(|e| e.to_string())?;
    if let Some(w) = watches.get_mut(&path) {
        w.refs += 1;
        return Ok(());
    }

    let emit_path = path.clone();
    let watcher = watch_settled(&PathBuf::from(&path), move || {
        let _ = app.emit("dir-changed", DirChanged { path: emit_path.clone() });
    })?;
    watches.insert(path, Watch { _watcher: watcher, refs: 1 });
    Ok(())
}

/// Watch `dir` (not recursively) and call `on_settled` once per burst of
/// changes, after SETTLE passes with no more. The returned watcher is the
/// lifetime: dropping it stops the watch and ends the debounce thread.
fn watch_settled(dir: &std::path::Path, on_settled: impl Fn() + Send + 'static) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // Access events (reads, opens) don't change a listing.
        if matches!(res, Ok(ref e) if !e.kind.is_access()) {
            let _ = tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(SETTLE) {
                    Ok(()) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            on_settled();
        }
    });
    Ok(watcher)
}

/// Release one `watch_dir` on `path`; the OS watch stops with the last one.
#[tauri::command]
pub fn unwatch_dir(path: String) -> Result<(), String> {
    let mut watches = WATCHES.lock().map_err(|e| e.to_string())?;
    if let Some(w) = watches.get_mut(&path) {
        w.refs = w.refs.saturating_sub(1);
        if w.refs == 0 {
            watches.remove(&path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn a_download_burst_is_one_update() {
        let dir = std::env::temp_dir().join(format!("cd-watch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        let watcher = watch_settled(&dir, move || { h.fetch_add(1, Ordering::SeqCst); }).unwrap();
        std::thread::sleep(Duration::from_millis(200)); // let the OS watch arm

        // Like a browser download: temp file, written in chunks, then renamed.
        let tmp = dir.join("report.pdf.crdownload");
        for _ in 0..5 {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&tmp).unwrap();
            f.write_all(&[0u8; 4096]).unwrap();
            std::thread::sleep(Duration::from_millis(40));
        }
        std::fs::rename(&tmp, dir.join("report.pdf")).unwrap();

        std::thread::sleep(SETTLE * 4);
        let n = hits.load(Ordering::SeqCst);
        drop(watcher);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(n, 1, "expected one settled update, got {n}");
    }
}
