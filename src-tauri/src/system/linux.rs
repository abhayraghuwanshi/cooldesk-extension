// Linux running/focused-app lookups via X11/EWMH (`crate::linux_ewmh`). See
// `system.rs` for the module-level overview and public API, and
// `linux_ewmh.rs` for why this only works under X11, not Wayland.

use sysinfo::{Pid, System};

use super::RunningApp;
use crate::linux_ewmh::{self, EwmhWindow};

/// System/desktop-shell processes that own an EWMH-tracked window but were
/// never something the user "used" — mirrors `MACOS_SYSTEM_PROCESSES` in
/// `system/mac.rs` for the same reason (keep junk out of the Right Now panel
/// and the knowledge graph).
const LINUX_SYSTEM_PROCESSES: &[&str] = &[
    "gnome-shell", "plasmashell", "xfwm4", "xfdesktop", "kwin_x11", "kwin",
    "polybar", "waybar", "i3bar", "plank", "latte-dock", "panel-plasma",
];

fn is_linux_system_process(name: &str) -> bool {
    LINUX_SYSTEM_PROCESSES.contains(&name.to_lowercase().as_str())
}

fn to_running_app(w: &EwmhWindow, sys: &System, current_desktop: Option<u32>) -> Option<RunningApp> {
    let process = sys.process(Pid::from_u32(w.pid))?;
    let name = process.name().to_string();
    if is_linux_system_process(&name) {
        return None;
    }
    let path = process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let title = if w.title.is_empty() {
        if w.wm_class.is_empty() { name.clone() } else { w.wm_class.clone() }
    } else {
        w.title.clone()
    };
    Some(RunningApp {
        id: format!("app-{}", w.pid),
        name,
        title,
        path,
        pid: w.pid,
        icon: None,
        handle: format!("{}", w.id),
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        desktop_id: None,
        desktop_number: w.desktop,
        is_on_current_desktop: match (w.desktop, current_desktop) {
            (None, _) => true, // sticky / no hint — treat as always current
            (Some(d), Some(cur)) => d == cur,
            (Some(_), None) => true,
        },
    })
}

pub fn get_focused_app_info() -> Option<RunningApp> {
    let snap = linux_ewmh::snapshot();
    let active_id = snap.active_window?;
    let w = snap.windows.iter().find(|w| w.id == active_id)?;
    let mut sys = System::new_all();
    sys.refresh_all();
    to_running_app(w, &sys, snap.current_desktop)
}

/// One entry per app currently owning an EWMH-tracked, non-minimized window,
/// first window per pid kept. Backs `/activity/visible`, the timeline
/// snapshot, and the session co-occurrence loop — same role this plays on
/// macOS (see `system/mac.rs`) and Windows.
pub fn get_visible_apps_info() -> Vec<RunningApp> {
    let snap = linux_ewmh::snapshot();
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut apps = Vec::new();
    let mut seen_pids = std::collections::HashSet::new();
    for w in &snap.windows {
        if !w.is_visible {
            continue;
        }
        if !seen_pids.insert(w.pid) {
            continue;
        }
        if let Some(app) = to_running_app(w, &sys, snap.current_desktop) {
            apps.push(app);
        }
    }
    apps
}
