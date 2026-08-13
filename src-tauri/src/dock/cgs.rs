// Private, undocumented macOS Spaces API — internally called "CGS"
// (CoreGraphics Services), living in SkyLight.framework on current macOS.
//
// This is the actual mechanism apps like Alfred/Raycast/yabai use to make a
// window join *another app's* fullscreen Space. The public route
// (`NSWindowCollectionBehaviorCanJoinAllSpaces | FullScreenAuxiliary`, see
// `allow_over_fullscreen_spaces` in `mac.rs`) was verified NOT to do this:
// with a fullscreen-and-frontmost VS Code, the spotlight window's own
// `frontmost=` logging showed macOS never switched away from VS Code (no
// app-activation happened), yet the window's `occlusionState` never gained
// the "on screen" bit and `isOnActiveSpace()` came back false — i.e. the
// window stayed parked on the ordinary desktop Space the whole time,
// invisible, regardless of collection behavior or window level. That
// matches Apple's actual (undocumented) behavior: `FullScreenAuxiliary`
// only lets a window join a fullscreen Space belonging to the SAME
// application — not an arbitrary third-party app's fullscreen Space.
//
// These symbols aren't in any public header — declared here from the
// community reverse-engineered https://github.com/NUIKit/CGSInternal
// headers. They could be renamed or removed in a future macOS release, in
// which case this file fails to link and needs revisiting; the public
// collection-behavior path in `mac.rs` still covers the normal-desktop
// case regardless.

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, TCFType, TCFTypeRef};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use std::os::raw::{c_int, c_void};

type CGSConnectionID = c_int;
type UntypedDict = CFDictionary<*const c_void, *const c_void>;

#[link(name = "SkyLight", kind = "framework")]
extern "C" {
    fn CGSMainConnectionID() -> CGSConnectionID;
    fn CGSCopyManagedDisplaySpaces(cid: CGSConnectionID) -> CFArrayRef;
    fn CGSAddWindowsToSpaces(cid: CGSConnectionID, windows: CFArrayRef, spaces: CFArrayRef);
}

unsafe fn dict_get(dict: &UntypedDict, key: &str) -> Option<CFType> {
    let key_str = CFString::new(key);
    let key_ptr = key_str.as_concrete_TypeRef().as_void_ptr();
    dict.find(key_ptr)
        .map(|item| CFType::wrap_under_get_rule(*item as core_foundation::base::CFTypeRef))
}

/// The CGSSpaceID of whichever Space is currently active/on-screen, per
/// display (a multi-monitor setup can have more than one at once — each
/// display has its own independent "Current Space").
fn active_space_ids() -> Vec<i64> {
    unsafe {
        let cid = CGSMainConnectionID();
        let raw = CGSCopyManagedDisplaySpaces(cid);
        if raw.is_null() {
            log::warn!("[FullscreenSpaces][cgs] CGSCopyManagedDisplaySpaces returned null");
            return Vec::new();
        }
        let displays: CFArray<UntypedDict> = CFArray::wrap_under_create_rule(raw);
        let mut ids = Vec::new();
        for display in displays.iter() {
            let Some(current) = dict_get(&display, "Current Space") else { continue };
            let Some(current_dict) = current.downcast::<UntypedDict>() else { continue };
            let Some(id_num) = dict_get(&current_dict, "id64") else { continue };
            let Some(id_num) = id_num.downcast::<CFNumber>() else { continue };
            if let Some(id) = id_num.to_i64() {
                ids.push(id);
            }
        }
        ids
    }
}

/// Adds `window_number` (an `NSWindow.windowNumber`, i.e. its `CGWindowID`)
/// to whichever Space(s) are currently active/on-screen right now —
/// including a fullscreen Space, which the public collection-behavior API
/// cannot do (see module doc comment). Returns the space ids it attempted
/// to join, purely so the caller can log them.
pub fn join_active_spaces(window_number: i64) -> Vec<i64> {
    let space_ids = active_space_ids();
    if space_ids.is_empty() {
        log::warn!("[FullscreenSpaces][cgs] no active space ids found, skipping CGSAddWindowsToSpaces");
        return space_ids;
    }
    unsafe {
        let cid = CGSMainConnectionID();
        let windows = CFArray::from_CFTypes(&[CFNumber::from(window_number as i32)]);
        let spaces: CFArray<CFNumber> =
            CFArray::from_CFTypes(&space_ids.iter().map(|&id| CFNumber::from(id)).collect::<Vec<_>>());
        CGSAddWindowsToSpaces(cid, windows.as_concrete_TypeRef(), spaces.as_concrete_TypeRef());
    }
    space_ids
}
