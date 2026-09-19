// Linux (X11/EWMH) window enumeration — the analog of macOS's
// CGWindowListCopyWindowInfo (see `system/mac.rs`, `scanner/mac.rs`) and
// Windows' EnumWindows. Talks directly to the X server over the X11 core +
// EWMH (Extended Window Manager Hints) protocols via `x11rb`, so unlike
// `focus.rs` (which only *activates* a window via the external `xdotool`
// binary) this needs no external process.
//
// EWMH is implemented by effectively every X11 window manager (GNOME, KDE,
// XFCE, i3, Openbox, ...) but has no equivalent under Wayland — there is no
// protocol for a client to list *other* apps' windows there, by design (see
// `focus.rs`'s doc comment for the same limitation). `snapshot()` degrades to
// an empty result rather than erroring whenever there's no reachable X
// server (Wayland-only session, headless CI, `$DISPLAY` unset, ...) or the
// window manager doesn't populate a given hint — every field here is
// best-effort, never a hard requirement.

use std::collections::HashMap;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, Window};
use x11rb::rust_connection::RustConnection;

/// One top-level, EWMH-managed window.
pub struct EwmhWindow {
    pub id: u32,
    pub pid: u32,
    pub title: String,
    /// WM_CLASS instance name (e.g. "firefox", "code") — the closest X11
    /// equivalent of an exe basename; most taskbars/docks group windows by
    /// this same property.
    pub wm_class: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// `None` means no `_NET_WM_DESKTOP` hint, or the window is pinned to
    /// all desktops (the 0xFFFFFFFF sentinel).
    pub desktop: Option<u32>,
    /// False when `_NET_WM_STATE` carries `_NET_WM_STATE_HIDDEN` (minimized).
    pub is_visible: bool,
}

/// One connection's worth of EWMH state — grouped so callers only pay for
/// one X server round-trip set instead of reconnecting per query.
#[derive(Default)]
pub struct EwmhSnapshot {
    pub windows: Vec<EwmhWindow>,
    pub active_window: Option<u32>,
    pub current_desktop: Option<u32>,
}

struct Atoms {
    net_client_list: u32,
    net_active_window: u32,
    net_wm_name: u32,
    net_wm_pid: u32,
    net_wm_desktop: u32,
    net_current_desktop: u32,
    net_wm_state: u32,
    net_wm_state_hidden: u32,
}

fn intern(conn: &RustConnection, name: &'static str) -> Option<u32> {
    conn.intern_atom(false, name.as_bytes()).ok()?.reply().ok().map(|r| r.atom)
}

fn load_atoms(conn: &RustConnection) -> Option<Atoms> {
    Some(Atoms {
        net_client_list: intern(conn, "_NET_CLIENT_LIST")?,
        net_active_window: intern(conn, "_NET_ACTIVE_WINDOW")?,
        net_wm_name: intern(conn, "_NET_WM_NAME")?,
        net_wm_pid: intern(conn, "_NET_WM_PID")?,
        net_wm_desktop: intern(conn, "_NET_WM_DESKTOP")?,
        net_current_desktop: intern(conn, "_NET_CURRENT_DESKTOP")?,
        net_wm_state: intern(conn, "_NET_WM_STATE")?,
        net_wm_state_hidden: intern(conn, "_NET_WM_STATE_HIDDEN")?,
    })
}

/// Fetch a property and hand back its raw reply, or `None` on any error /
/// absent property. `AtomEnum::ANY` as the requested type accepts whatever
/// type the property actually has (inspected via `reply.format` by callers)
/// rather than failing when a WM stores it slightly differently than spec.
fn get_prop(
    conn: &RustConnection,
    window: Window,
    atom: u32,
) -> Option<x11rb::protocol::xproto::GetPropertyReply> {
    conn.get_property(false, window, atom, AtomEnum::ANY, 0, u32::MAX)
        .ok()?
        .reply()
        .ok()
}

fn get_prop_u32(conn: &RustConnection, window: Window, atom: u32) -> Option<u32> {
    let reply = get_prop(conn, window, atom)?;
    let first = reply.value32()?.next();
    first
}

fn get_prop_u32_list(conn: &RustConnection, window: Window, atom: u32) -> Vec<u32> {
    get_prop(conn, window, atom)
        .and_then(|r| r.value32().map(|it| it.collect()))
        .unwrap_or_default()
}

fn get_prop_string(conn: &RustConnection, window: Window, atom: u32) -> Option<String> {
    let reply = get_prop(conn, window, atom)?;
    if reply.value.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&reply.value).trim_end_matches('\0').to_string())
}

/// WM_CLASS is two null-terminated strings back to back: instance, then
/// class. Returns the instance name (first string).
fn get_wm_class_instance(conn: &RustConnection, window: Window) -> String {
    let reply = match get_prop(conn, window, AtomEnum::WM_CLASS.into()) {
        Some(r) => r,
        None => return String::new(),
    };
    reply
        .value
        .split(|&b| b == 0)
        .next()
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .unwrap_or_default()
}

/// Absolute (x, y) of `window` on the root, via `TranslateCoordinates` from
/// the window's own origin — `GetGeometry`'s (x, y) is parent-relative, which
/// is wrong for any reparenting WM (i.e. almost all of them).
fn absolute_position(conn: &RustConnection, root: Window, window: Window) -> (i32, i32) {
    conn.translate_coordinates(window, root, 0, 0)
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| (r.dst_x as i32, r.dst_y as i32))
        .unwrap_or((0, 0))
}

fn is_hidden(conn: &RustConnection, window: Window, atoms: &Atoms) -> bool {
    get_prop_u32_list(conn, window, atoms.net_wm_state)
        .contains(&atoms.net_wm_state_hidden)
}

fn describe_window(conn: &RustConnection, root: Window, window: Window, atoms: &Atoms) -> Option<EwmhWindow> {
    // PID anchors this window to a process; without it we can't correlate it
    // to anything downstream, so skip rather than emit a half-populated entry.
    let pid = get_prop_u32(conn, window, atoms.net_wm_pid)?;
    if pid == 0 {
        return None;
    }

    let title = get_prop_string(conn, window, atoms.net_wm_name)
        .or_else(|| get_prop_string(conn, window, AtomEnum::WM_NAME.into()))
        .unwrap_or_default();
    let wm_class = get_wm_class_instance(conn, window);

    let geom = conn.get_geometry(window).ok()?.reply().ok();
    let (width, height) = geom.map(|g| (g.width as i32, g.height as i32)).unwrap_or((0, 0));
    let (x, y) = absolute_position(conn, root, window);

    let desktop = match get_prop_u32(conn, window, atoms.net_wm_desktop) {
        Some(0xFFFF_FFFF) | None => None,
        Some(d) => Some(d),
    };

    Some(EwmhWindow {
        id: window,
        pid,
        title,
        wm_class,
        x,
        y,
        width,
        height,
        desktop,
        is_visible: !is_hidden(conn, window, atoms),
    })
}

/// Query the X server for every EWMH-managed top-level window plus the
/// active window and current desktop. Returns an empty snapshot (never
/// panics, never blocks indefinitely) if there's no reachable X server or
/// the window manager doesn't implement EWMH.
pub fn snapshot() -> EwmhSnapshot {
    let (conn, screen_num) = match RustConnection::connect(None) {
        Ok(c) => c,
        Err(_) => return EwmhSnapshot::default(),
    };
    let Some(atoms) = load_atoms(&conn) else {
        return EwmhSnapshot::default();
    };
    let root = conn.setup().roots[screen_num].root;

    let client_list = get_prop_u32_list(&conn, root, atoms.net_client_list);
    let active_window = get_prop_u32(&conn, root, atoms.net_active_window).filter(|&w| w != 0);
    let current_desktop = get_prop_u32(&conn, root, atoms.net_current_desktop);

    // De-dup by pid isn't done here — callers with different needs (window
    // list vs. one focused app) disagree on how to collapse multiple windows
    // per pid, so this stays one entry per X window.
    let mut windows = Vec::with_capacity(client_list.len());
    let mut seen: HashMap<Window, ()> = HashMap::with_capacity(client_list.len());
    for win in client_list {
        if seen.insert(win, ()).is_some() {
            continue;
        }
        if let Some(w) = describe_window(&conn, root, win, &atoms) {
            windows.push(w);
        }
    }

    EwmhSnapshot { windows, active_window, current_desktop }
}
