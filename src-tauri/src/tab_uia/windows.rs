// Windows UI Automation tab drill-in. See `tab_uia.rs` for the module-level
// overview and public API.

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

/// Normalize a tab title for comparison. Terminal tabs prefix a live
/// spinner frame ("⠂ ", "✳ ", ...) that advances between the scan that
/// cached the title and the click that uses it, so a raw comparison never
/// matches. Lowercase and drop any leading non-alphanumerics.
fn norm_tab_title(s: &str) -> String {
    s.trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

/// Select the tab matching `title` (case-insensitive substring) or, failing
/// that, `index`. Title is preferred because indices shift as tabs open and
/// close between scan and click. Returns true if a tab was selected.
pub fn focus_tab(hwnd: isize, index: Option<usize>, title: Option<&str>) -> bool {
    unsafe {
        // Foreground the host window FIRST, before touching the tab strip.
        // Selecting on a background window does not stick: the app
        // re-asserts its previously active tab when it is activated, which
        // silently reverted our Select() and made every tab entry land on
        // whichever tab was last used.
        let _ = crate::focus::focus_window_by_hwnd(hwnd);

        let Some((_auto, els)) = collect_tab_elements(hwnd) else {
            return false;
        };
        if els.is_empty() {
            return false;
        }

        // 1) Title match (most reliable for user intent).
        let chosen = title
            .map(norm_tab_title)
            .filter(|t| !t.is_empty())
            .and_then(|t| {
                els.iter().find(|el| {
                    el.CurrentName()
                        .map(|b| norm_tab_title(&b.to_string()).contains(&t))
                        .unwrap_or(false)
                })
            })
            // 2) Fall back to index if title didn't match.
            .or_else(|| index.and_then(|i| els.get(i)));

        let Some(el) = chosen else {
            log::warn!("[TabFocus] hwnd={hwnd:#x} no tab matched index={index:?}");
            return false;
        };

        let Ok(pat) =
            el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
        else {
            return false;
        };

        // The tab strip is virtualized and window activation can still race
        // us, so confirm the selection took and retry once before giving up.
        let mut ok = false;
        for _ in 0..2 {
            if pat.Select().is_err() {
                break;
            }
            ok = pat.CurrentIsSelected().map(|b| b.as_bool()).unwrap_or(false);
            if ok {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(60));
        }

        log::info!("[TabFocus] hwnd={hwnd:#x} index={index:?} selected={ok}");
        ok
    }
}
