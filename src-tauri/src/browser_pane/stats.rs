// Live resource use of the browser panes, for the Browse toolbar's meter and
// the pane guard (src/features/browser/usePaneGuard.js) that puts background
// tabs to sleep.
//
// Every pane is a WKWebView whose page runs in its own WebKit "WebContent"
// process, so its memory never shows up under CoolDesk's own process. WebKit
// exposes that process's pid as `_webProcessIdentifier` (private, but stable
// for years and what Safari's own tooling reads); we look it up per pane and
// sample it with sysinfo. If the selector ever disappears the pane is simply
// reported without numbers.
//
// CPU% needs two samples; the System is kept between calls so each poll is
// measured against the previous one instead of sleeping. All processes are
// refreshed in one pass: on macOS sysinfo measures CPU against a single clock
// that resets on every refresh call, so refreshing pids one by one gave every
// pid after the first a microseconds-long interval (and absurd percentages).
//
// Crashes: when a page's WebContent process dies (jetsam under memory
// pressure, a WebKit crash, browser_pane_kill) the view stays up but blank,
// and `_webProcessIdentifier` drops to 0 until it's reloaded. Tauri doesn't
// surface wry's process-terminated callback, so the poll watches for that
// drop and emits `browser-pane-state` with `crashed: true` once per crash.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, System};
use tauri::{Emitter, Manager};

lazy_static::lazy_static! {
    static ref SYS: Mutex<System> = Mutex::new(System::new());
    /// label -> last pid seen alive; 0 once its process died (until reloaded).
    static ref LAST_PID: Mutex<HashMap<String, u32>> = Mutex::new(HashMap::new());
}

#[derive(Serialize)]
pub struct PaneStat {
    /// Pane id as the frontend knows it (label without the prefix).
    id: String,
    pid: Option<u32>,
    /// Resident memory, bytes.
    memory: Option<u64>,
    /// Percent of one core.
    cpu: Option<f32>,
    /// Playing sound — never put to sleep (music, a call).
    audible: bool,
    /// Using the camera or microphone (a meeting) — never put to sleep.
    capturing: bool,
    camera: bool,
    microphone: bool,
    /// Its WebContent process died and it hasn't been reloaded yet.
    crashed: bool,
}

#[derive(Serialize)]
pub struct BrowserStats {
    panes: Vec<PaneStat>,
    /// CoolDesk itself: the app process plus its own UI's WebContent process.
    app_memory: Option<u64>,
    /// Physical memory, bytes.
    total_memory: u64,
    /// Free + reclaimable memory, bytes (low means the system is under pressure).
    available_memory: u64,
}

#[derive(Default)]
struct Probe {
    pid: Option<u32>,
    audible: bool,
    camera: bool,
    microphone: bool,
}

/// A webview's WebContent pid and media state (macOS), read on the main thread.
#[cfg(target_os = "macos")]
fn probe(wv: &tauri::Webview) -> Probe {
    let (tx, rx) = std::sync::mpsc::channel();
    let sent = wv.with_webview(move |pw| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let view = pw.inner() as *mut AnyObject;
        let responds = |sel| -> bool { msg_send![view, respondsToSelector: sel] };
        let pid: i32 = if responds(objc2::sel!(_webProcessIdentifier)) { msg_send![view, _webProcessIdentifier] } else { 0 };
        let audible: bool = if responds(objc2::sel!(_isPlayingAudio)) { msg_send![view, _isPlayingAudio] } else { false };
        // WKMediaCaptureState (macOS 12+): 0 none, 1 active, 2 muted — a
        // muted call is still a call.
        let camera: isize = if responds(objc2::sel!(cameraCaptureState)) { msg_send![view, cameraCaptureState] } else { 0 };
        let mic: isize = if responds(objc2::sel!(microphoneCaptureState)) { msg_send![view, microphoneCaptureState] } else { 0 };
        let _ = tx.send(Probe { pid: (pid > 0).then_some(pid as u32), audible, camera: camera != 0, microphone: mic != 0 });
    });
    if sent.is_err() {
        return Probe::default();
    }
    rx.recv_timeout(std::time::Duration::from_millis(500)).unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn probe(_wv: &tauri::Webview) -> Probe {
    Probe::default()
}

fn sample(sys: &System, pid: u32) -> Option<(u64, f32)> {
    sys.process(Pid::from_u32(pid)).map(|p| (p.memory(), p.cpu_usage()))
}

/// Whether the pane `label` (now reporting `pid`) has crashed; emits the
/// crash once, when its process first goes missing.
fn track_crash(app: &tauri::AppHandle, label: &str, id: &str, pid: Option<u32>, last: &mut HashMap<String, u32>) -> bool {
    match (pid, last.get(label).copied()) {
        (Some(pid), _) => {
            last.insert(label.to_string(), pid);
            false
        }
        // Had a live process, now none: it died.
        (None, Some(prev)) if prev != 0 => {
            log::warn!("[BrowserPane] {id}: web process {prev} terminated");
            last.insert(label.to_string(), 0);
            let _ = app.emit("browser-pane-state", serde_json::json!({ "id": id, "crashed": true }));
            true
        }
        (None, Some(_)) => true,
        // Never had one yet (still on about:blank, or the selector is missing).
        (None, None) => false,
    }
}

#[tauri::command]
pub async fn browser_pane_stats(app: tauri::AppHandle) -> BrowserStats {
    // Resolve pids first (main-thread hops), then sample under the lock.
    let probes: Vec<(String, String, Probe)> = app
        .webviews()
        .into_iter()
        .filter_map(|(label, wv)| {
            let id = label.strip_prefix(super::LABEL_PREFIX)?.to_string();
            Some((label, id, probe(&wv)))
        })
        .collect();
    let main_pid = app.get_webview("main").and_then(|wv| probe(&wv).pid);

    let mut crashed = Vec::with_capacity(probes.len());
    {
        let mut last = LAST_PID.lock().unwrap();
        // Forget closed panes, so a reused label starts clean.
        last.retain(|label, _| probes.iter().any(|(l, _, _)| l == label));
        for (label, id, p) in &probes {
            crashed.push(track_crash(&app, label, id, p.pid, &mut last));
        }
    }

    let mut sys = SYS.lock().unwrap();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu().with_memory());
    sys.refresh_memory();
    let sys = &*sys;
    let panes = probes
        .into_iter()
        .zip(crashed)
        .map(|((_, id, p), crashed)| {
            let s = p.pid.and_then(|pid| sample(sys, pid));
            PaneStat {
                id,
                pid: p.pid,
                memory: s.map(|s| s.0),
                cpu: s.map(|s| s.1),
                audible: p.audible,
                capturing: p.camera || p.microphone,
                camera: p.camera,
                microphone: p.microphone,
                crashed,
            }
        })
        .collect();
    let own = sample(sys, std::process::id()).map(|s| s.0);
    let ui = main_pid.and_then(|p| sample(sys, p)).map(|s| s.0);
    let app_memory = match (own, ui) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    };
    BrowserStats { panes, app_memory, total_memory: sys.total_memory(), available_memory: sys.available_memory() }
}
