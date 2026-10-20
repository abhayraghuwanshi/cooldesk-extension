// Live resource use of the browser panes, for the Browse toolbar's meter.
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

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, System};
use tauri::Manager;

lazy_static::lazy_static! {
    static ref SYS: Mutex<System> = Mutex::new(System::new());
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
}

#[derive(Serialize)]
pub struct BrowserStats {
    panes: Vec<PaneStat>,
    /// CoolDesk itself: the app process plus its own UI's WebContent process.
    app_memory: Option<u64>,
}

/// pid of a webview's WebContent process (macOS), read on the main thread.
#[cfg(target_os = "macos")]
fn web_process_pid(wv: &tauri::Webview) -> Option<u32> {
    let (tx, rx) = std::sync::mpsc::channel();
    wv.with_webview(move |pw| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let view = pw.inner() as *mut AnyObject;
        let has: bool = msg_send![view, respondsToSelector: objc2::sel!(_webProcessIdentifier)];
        let pid: i32 = if has { msg_send![view, _webProcessIdentifier] } else { 0 };
        let _ = tx.send(pid);
    })
    .ok()?;
    let pid = rx.recv_timeout(std::time::Duration::from_millis(500)).ok()?;
    (pid > 0).then_some(pid as u32)
}

#[cfg(not(target_os = "macos"))]
fn web_process_pid(_wv: &tauri::Webview) -> Option<u32> {
    None
}

fn sample(sys: &System, pid: u32) -> Option<(u64, f32)> {
    sys.process(Pid::from_u32(pid)).map(|p| (p.memory(), p.cpu_usage()))
}

#[tauri::command]
pub async fn browser_pane_stats(app: tauri::AppHandle) -> BrowserStats {
    // Resolve pids first (main-thread hops), then sample under the lock.
    let panes: Vec<(String, Option<u32>)> = app
        .webviews()
        .into_iter()
        .filter_map(|(label, wv)| {
            let id = label.strip_prefix(super::LABEL_PREFIX)?.to_string();
            Some((id, web_process_pid(&wv)))
        })
        .collect();
    let main_pid = app.get_webview("main").and_then(|wv| web_process_pid(&wv));

    let mut sys = SYS.lock().unwrap();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu().with_memory());
    let sys = &*sys;
    let panes = panes
        .into_iter()
        .map(|(id, pid)| {
            let s = pid.and_then(|p| sample(sys, p));
            PaneStat { id, pid, memory: s.map(|s| s.0), cpu: s.map(|s| s.1) }
        })
        .collect();
    let own = sample(sys, std::process::id()).map(|s| s.0);
    let ui = main_pid.and_then(|p| sample(sys, p)).map(|s| s.0);
    let app_memory = match (own, ui) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    };
    BrowserStats { panes, app_memory }
}
