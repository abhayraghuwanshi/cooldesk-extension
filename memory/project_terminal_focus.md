---
name: project_terminal_focus
description: UIA-based per-tab focus/search for Windows Terminal & File Explorer; scanner must only collect visible windows
metadata:
  type: project
---

Tab-level focus & search for multi-tab apps (Windows Terminal, Win11 File Explorer), built 2026-06-15. **The two apps need OPPOSITE mechanisms** — discovered the hard way:

**Windows Terminal: each tab IS its own top-level HWND (no UIA needed).** WT packs every tab into a separate `CASCADIA_HOSTING_WINDOW_CLASS` window under one PID. The active tab's window is `cloaked=0`; inactive tabs are `cloaked=2` (DWM shell-cloaked) but still `IsWindowVisible=true`. Window title = tab title. Verified: `SetForegroundWindow`+`ShowWindow(SW_RESTORE)` on a cloaked tab-window switches WT to that tab (it un-cloaks, old active cloaks). So WT tabs are surfaced by the scanner as ordinary window entries and focused by hwnd — the UIA path is NOT used for WT.

**File Explorer: tabs are UIA `TabItem`s in ONE `CabinetWClass` window — but only realized when foreground.** Critical quirk: UIA `FindAll(Descendants, TabItem)` returns the tabs ONLY when the Explorer window is the foreground/active window. Backgrounded (i.e. during a scan) it returns 0. So Explorer tab expansion is best-effort and usually fails at scan time — an OS realization limitation, not fixable without disruptively activating windows.

**WT fix (the one that mattered) — scanner + matcher, no UIA:**
1. `scanner.rs` `enum_windows_callback`: dedup collected titles by **hwnd, not title** — three identical "Command Prompt" tabs are distinct windows; title-dedup hid all but one.
2. `matcher.rs` title-fallback loop: skip `windowsterminal` (alongside `explorer`/`applicationframehost`). Otherwise the first app whose name matches a tab title (e.g. "Windows PowerShell") *claims the whole WT window*, and `meaningful_titles` then filters to just that one title — the other tabs vanish. Skipping lets all tab titles surface via the existing "no title carries the app name → surface every real title" path → one entry per tab, each with its own hwnd.
- Verified live: all 5 WT sessions (active + PowerShell + 3× Command Prompt) show in `/search` with distinct hwnds.

**The UIA plugin `src-tauri/src/tab_uia.rs`** — used for File Explorer only now:
- `list_tabs(hwnd)` / `focus_tab(hwnd, index, title)` / `supports_tabs(ident)` (allowlist normalized alnum-lowercase = `explorer|fileexplorer` ONLY; WT removed to avoid N×N re-expansion of its per-hwnd tab entries).
- VARIANT lives at `windows::core::VARIANT` (NOT `Win32::System::Variant`) in windows 0.58; needs `Win32_UI_Accessibility` + `Win32_System_Variant` Cargo features.

**Wiring (full chain, used by Explorer):** matcher expands `supports_tabs` running windows into one `AppEntry` per tab (`tabIndex`) → `APP_CACHE` → `/search` passes `tabIndex` (both branches) → `searchService.js` maps it → `GlobalSpotlight.jsx` routes `item.tabIndex != null` to `electronAPI.focusAppTab` → `electron-shim.js` invokes `focus_window_tab` → `tab_uia::focus_tab`. (Limited by the foreground-realization quirk above.)

**Scanner phantom-window fix (still required):** `enum_windows_callback` only collects titles `if is_visible` — kills WT's hidden "monarch" helper window that otherwise showed as a bogus entry focusing nothing.

Related: [[project_search_close_buttons]]
