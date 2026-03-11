# Cross-Platform Window Focus

This document explains how to build and use the native Rust window focus module that replaces `AppFocus.exe`.

## Overview

The `focus.rs` module provides cross-platform window focusing without external C# dependencies:

| Platform | Method | Requirements |
|----------|--------|--------------|
| Windows | Win32 APIs | None (built-in) |
| macOS | AppleScript | None (osascript pre-installed) |
| Linux X11 | xdotool | `xdotool` package |
| Linux Wayland | ❌ | Not supported (security model) |

## Building

### Windows

No extra setup required. The `windows` crate handles everything.

```bash
cargo build --release
```

### macOS

No extra setup required. Uses `osascript` which is pre-installed on all Macs.

```bash
cargo build --release
```

### Linux (X11)

Install xdotool first:

```bash
# Ubuntu/Debian
sudo apt install xdotool

# Fedora
sudo dnf install xdotool

# Arch
sudo pacman -S xdotool
```

Then build:

```bash
cargo build --release
```

### Linux (Wayland)

**Not supported.** Wayland's security model prevents applications from focusing arbitrary windows. Users on Wayland will see a `PlatformNotSupported` error.

## API

### Tauri Command

The `focus_window` command is exposed to the frontend:

```javascript
// Focus by window handle (fastest, Windows only)
await invoke('focus_window', { pid: 1234, hwnd: 12345678 });

// Focus by PID with name fallback
await invoke('focus_window', { pid: 1234, name: 'firefox' });
```

### Rust API

```rust
use crate::focus::{focus_window, focus_window_by_hwnd, focus_window_by_pid};

// Focus by handle (Windows/Linux X11)
focus_window_by_hwnd(hwnd)?;

// Focus by PID with optional name fallback
focus_window_by_pid(1234, Some("firefox"))?;

// Convenience function
focus_window(Some(hwnd), Some(pid), Some("firefox"))?;
```

## Error Handling

```rust
pub enum FocusError {
    WindowNotFound,       // No window found for PID
    PlatformNotSupported, // Wayland or unknown platform
    CommandFailed(String), // xdotool/osascript failed
    InvalidHandle,        // Bad HWND
}
```

## Differences from AppFocus.exe

| Feature | AppFocus.exe | focus.rs |
|---------|--------------|----------|
| Language | C# | Rust |
| Cross-platform | Windows only | Windows, macOS, Linux X11 |
| External dependency | .NET runtime | None |
| Process overhead | Spawns new process | In-process |
| Build | Separate C# compilation | Part of cargo build |

## Removing AppFocus.exe

Once verified working, you can remove:

- `AppFocus.cs`
- `AppFocus.exe`
- `src-tauri/bin/AppFocus-*.exe`
- Any references in `tauri.conf.json` sidecar config
