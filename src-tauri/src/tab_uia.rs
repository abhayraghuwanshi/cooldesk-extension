//! Tab-level focus & enumeration via UI Automation (UIA).
//!
//! Raw Win32 (`EnumWindows`) only sees one HWND per window, so apps that pack
//! multiple sessions into a single window — Windows Terminal, Win11 File
//! Explorer — expose just the *active* tab's title and nothing else. UIA sees
//! deeper: the tab strip is a UIA `TabView` whose children are `TabItem`
//! elements, each readable (title) and selectable even when inactive.
//!
//! The mechanism here is fully generic (it just walks UIA `TabItem`s of any
//! HWND). Which apps we actually drill into is gated by `supports_tabs()` —
//! an allowlist, so we never pay the UIA cost or risk false tabs on apps that
//! don't benefit. Add an app = add a string, no new code.
//!
//! The UIA calls themselves are Windows-only and live in `tab_uia/windows.rs`.

#[derive(serde::Serialize, Clone, Debug)]
pub struct TabInfo {
    /// Position in the tab strip (0-based). Used as a stable-ish focus target.
    pub index: usize,
    pub title: String,
}

/// Whether an app needs UIA tab drill-in. Matched against a normalized form
/// (lowercased, alphanumerics only) of either the exe name or the display name,
/// so "explorer" and "File Explorer" both resolve.
///
/// NOTE: only apps whose tabs are NOT separate OS windows belong here — which
/// is exactly the case for both entries. File Explorer packs all tabs into one
/// `CabinetWClass` window; Windows Terminal packs all tabs into one
/// `CASCADIA_HOSTING_WINDOW_CLASS` window whose title tracks only the *active*
/// tab. In both cases UIA is the only way to see or select an inactive tab.
///
/// WT was removed from this list in 77981e1 on the belief that each tab is its
/// own top-level window surfaced by the scanner. It isn't — enumerating WT's
/// PID yields a single visible window plus non-visible helpers, so dropping it
/// here silently reduced WT to one searchable entry. Re-expansion cost is
/// bounded by the `probed` hwnd set in `matcher::match_apps`, which drills each
/// window exactly once.
pub fn supports_tabs(ident: &str) -> bool {
    let norm: String = ident
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    matches!(
        norm.as_str(),
        "explorer" | "fileexplorer" | "windowsterminal" | "terminal"
    )
}

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::{focus_tab, list_tabs};

#[cfg(not(target_os = "windows"))]
pub fn list_tabs(_hwnd: isize) -> Vec<TabInfo> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
pub fn focus_tab(_hwnd: isize, _index: Option<usize>, _title: Option<&str>) -> bool {
    false
}
