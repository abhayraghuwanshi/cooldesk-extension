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
/// NOTE: only apps whose tabs are NOT separate OS windows belong here. File
/// Explorer packs all tabs into one `CabinetWClass` window, so UIA is the only
/// way to see/select them. Windows Terminal is deliberately absent: each WT tab
/// is its own (cloaked) top-level window, surfaced directly by the scanner and
/// focusable by hwnd — running UIA on it would re-expand every tab N×N.
pub fn supports_tabs(ident: &str) -> bool {
    let norm: String = ident
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    matches!(norm.as_str(), "explorer" | "fileexplorer")
}

#[cfg(target_os = "windows")]
mod imp {
    use super::TabInfo;
    use windows::core::VARIANT;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationSelectionItemPattern, TreeScope_Descendants,
        UIA_ControlTypePropertyId, UIA_SelectionItemPatternId, UIA_TabItemControlTypeId,
    };

    /// Build a UIA instance. COM is initialised per call as MTA; an already
    /// initialised apartment returns RPC_E_CHANGED_MODE which we ignore.
    unsafe fn automation() -> Option<IUIAutomation> {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()
    }

    /// Collect every `TabItem` descendant of `hwnd`'s root element.
    /// Returns `(automation, elements)` so callers can reuse patterns.
    unsafe fn collect_tab_elements(
        hwnd: isize,
    ) -> Option<(IUIAutomation, Vec<windows::Win32::UI::Accessibility::IUIAutomationElement>)> {
        let auto = automation()?;
        let root = auto.ElementFromHandle(HWND(hwnd as *mut _)).ok()?;

        // Condition: ControlType == TabItem. Far cheaper than walking the whole
        // subtree (a terminal buffer can be thousands of text elements).
        let cond = auto
            .CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_TabItemControlTypeId.0))
            .ok()?;
        let arr = root.FindAll(TreeScope_Descendants, &cond).ok()?;

        let len = arr.Length().unwrap_or(0);
        let mut out = Vec::with_capacity(len as usize);
        for i in 0..len {
            if let Ok(el) = arr.GetElement(i) {
                out.push(el);
            }
        }
        Some((auto, out))
    }

    pub fn list_tabs(hwnd: isize) -> Vec<TabInfo> {
        unsafe {
            let Some((_auto, els)) = collect_tab_elements(hwnd) else {
                return Vec::new();
            };
            els.iter()
                .enumerate()
                .map(|(i, el)| {
                    let title = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
                    TabInfo { index: i, title }
                })
                .collect()
        }
    }

    /// Select the tab matching `title` (case-insensitive substring) or, failing
    /// that, `index`. Title is preferred because indices shift as tabs open and
    /// close between scan and click. Returns true if a tab was selected.
    pub fn focus_tab(hwnd: isize, index: Option<usize>, title: Option<&str>) -> bool {
        unsafe {
            let Some((_auto, els)) = collect_tab_elements(hwnd) else {
                return false;
            };
            if els.is_empty() {
                return false;
            }

            // 1) Title match (most reliable for user intent).
            let chosen = title
                .map(|t| t.to_lowercase())
                .and_then(|t| {
                    els.iter().find(|el| {
                        el.CurrentName()
                            .map(|b| b.to_string().to_lowercase().contains(&t))
                            .unwrap_or(false)
                    })
                })
                // 2) Fall back to index if title didn't match.
                .or_else(|| index.and_then(|i| els.get(i)));

            let Some(el) = chosen else { return false };

            // SelectionItemPattern.Select() switches the active tab.
            let selected = el
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
                .map(|pat| pat.Select().is_ok())
                .unwrap_or(false);

            // Bring the host window forward regardless — selecting a tab without
            // foregrounding the window would be a no-op to the user.
            let _ = crate::focus::focus_window_by_hwnd(hwnd);
            selected
        }
    }
}

#[cfg(target_os = "windows")]
pub fn list_tabs(hwnd: isize) -> Vec<TabInfo> {
    imp::list_tabs(hwnd)
}

#[cfg(target_os = "windows")]
pub fn focus_tab(hwnd: isize, index: Option<usize>, title: Option<&str>) -> bool {
    imp::focus_tab(hwnd, index, title)
}

#[cfg(not(target_os = "windows"))]
pub fn list_tabs(_hwnd: isize) -> Vec<TabInfo> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
pub fn focus_tab(_hwnd: isize, _index: Option<usize>, _title: Option<&str>) -> bool {
    false
}
