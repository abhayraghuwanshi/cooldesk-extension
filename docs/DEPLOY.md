# CoolDesk — Deployment Guide

How to build and distribute the **Tauri desktop app** and **Chrome extension** on macOS, Windows, and Linux.

---

## Prerequisites

### All Platforms
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable, 1.77.2+)
- npm 9+

```bash
# Verify versions
node --version
npm --version
rustc --version
```

### macOS
- Xcode Command Line Tools: `xcode-select --install`
- For code signing/notarization: Apple Developer account

### Windows
- [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (included in Windows 11; install manually on Windows 10)
- .NET SDK 6+ (for recompiling AppScanner.cs if needed)

### Linux
- WebKitGTK, GTK3, and related dev headers:

```bash
# Debian/Ubuntu
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  libxdo-dev librsvg2-dev patchelf libssl-dev file

# Fedora
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  libxdo-devel librsvg2-devel patchelf openssl-devel

# Arch
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libappindicator-gtk3 xdotool librsvg patchelf openssl
```

Note: a real Linux `.deb`/`.AppImage`/`.rpm` bundle requires running the build
*on Linux* (native GTK/WebKit2GTK libs) — it cannot be cross-compiled from
macOS or Windows. `xdotool` is also needed at runtime for window-focus support
(`apt install xdotool` / `dnf install xdotool` / `pacman -S xdotool`), see
[`CROSS_PLATFORM_FOCUS.md`](./CROSS_PLATFORM_FOCUS.md).

---

## Install Dependencies

```bash
npm install
```

---

## Desktop App (Tauri)

### macOS

```bash
# Development (hot-reload)
npm run dev:tauri

# Production build
npm run build:tauri
```

Output: `src-tauri/target/release/bundle/`
- `dmg/cooldesk_0.1.0_aarch64.dmg` — Apple Silicon installer
- `dmg/cooldesk_0.1.0_x64.dmg` — Intel installer
- `macos/cooldesk.app` — App bundle

**Code Signing (optional but required for distribution)**

Set these environment variables before building:

```bash
export APPLE_CERTIFICATE="Developer ID Application: Your Name (TEAMID)"
export APPLE_CERTIFICATE_PASSWORD="keychain-password"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your@apple.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="YOURTEAMID"

npm run build:tauri
```

### Windows

```bash
# Development (hot-reload)
npm run dev:tauri

# Production build
npm run build:tauri
```

Output: `src-tauri/target/release/bundle/`
- `msi/cooldesk_0.1.0_x64_en-US.msi` — MSI installer
- `nsis/cooldesk_0.1.0_x64-setup.exe` — NSIS installer

### Linux

```bash
# Development (hot-reload)
npm run dev:tauri

# Production build
npm run build:tauri
```

Output: `src-tauri/target/release/bundle/`
- `deb/cooldesk_0.1.0_amd64.deb` — Debian/Ubuntu package
- `appimage/cooldesk_0.1.0_amd64.AppImage` — portable AppImage
- `rpm/cooldesk-0.1.0-1.x86_64.rpm` — Fedora/RHEL package

Feature parity on Linux vs. macOS/Windows:
- **App scanner** (`src-tauri/src/scanner/linux.rs`) — implemented. Parses
  `.desktop` files (freedesktop.org Desktop Entry Spec) across the standard
  XDG dirs, Flatpak, and Snap. Icon resolution is best-effort (checks common
  hicolor sizes + `/usr/share/pixmaps`, PNG only — no SVG/XPM, no full XDG
  icon-theme cascade), so some apps will show no icon.
- **Running-apps list** (`src-tauri/src/system/linux.rs`) — implemented via
  X11/EWMH (`_NET_CLIENT_LIST` etc., see `linux_ewmh.rs`). **X11 only** —
  under Wayland there is no protocol for a client to enumerate other apps'
  windows (by design), so this returns an empty list there, same as the
  `xdotool`-based focus module below.
- **Workspace dock** — partially implemented. Both halves are Windows-only
  precedent (macOS doesn't have either, not just Linux):
  - Fullscreen-detection for the drawer handle (`src-tauri/src/dock/linux.rs`)
    — implemented via X11/EWMH (`_NET_WM_STATE_FULLSCREEN` on the active
    window). Same X11-only caveat as the running-apps list above.
  - True screen-edge reservation (the AppBar equivalent, `set_dock` /
    `remove_dock` / `work_area` / `monitor_rect`) — **not implemented**. EWMH
    struts (`_NET_WM_STRUT_PARTIAL`) could do this, but it needs our own
    window's X11 id, which needs a GTK dependency (`gtk_window()` +
    `gdkx11`) this crate doesn't pull in yet. CoolDesk's floating drawer/
    panel mode already works on Linux without it — this only adds true OS-
    level screen reservation on top.
- **webapp-embed** — still Windows-only, no-op on Linux (see the
  `#[cfg(not(target_os = "windows"))]` fallbacks in
  `src-tauri/src/webapp_embed.rs`).

Window focus works via `xdotool` on X11; Wayland is not supported (see
[`CROSS_PLATFORM_FOCUS.md`](./CROSS_PLATFORM_FOCUS.md)) — install it with
`apt install xdotool` / `dnf install xdotool` / `pacman -S xdotool`.

A `.deb`/`.AppImage`/`.rpm` links against the glibc of whatever distro built
it, so it won't run on distros older than the build machine (e.g. a build on
Ubuntu 24.04 needs glibc ≥ 2.39 — it won't run on Ubuntu 20.04 or Debian 11).
CI builds on the oldest still-supported Ubuntu LTS runner GitHub offers to
keep that floor as low as practical; check `.github/workflows/release.yml`
for the current version.

**AppScanner binary (Windows only)**

The AppScanner sidecar is pre-built at `src-tauri/bin/AppScanner-x86_64-pc-windows-msvc.exe`.
To recompile from source if you change `scripts/AppScanner.cs`:

```bash
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe ^
  /target:exe ^
  /out:src-tauri\bin\AppScanner-x86_64-pc-windows-msvc.exe ^
  scripts\AppScanner.cs ^
  /r:System.Drawing.dll /unsafe
```

---

## Homebrew (macOS distribution)

CoolDesk ships a **Homebrew Cask** served as a tap from this same repo (no
separate `homebrew-cooldesk` repo needed). The cask file lives at
[`Casks/cooldesk.rb`](./Casks/cooldesk.rb).

**Users install with:**

```bash
brew tap abhayraghuwanshi/cooldesk https://github.com/abhayraghuwanshi/cooldesk-extension
brew install --cask cooldesk
brew upgrade --cask cooldesk   # later updates
```

**How it stays in sync:** the `homebrew` job in
[`.github/workflows/release.yml`](./.github/workflows/release.yml) runs after
`publish`, hashes the final (repacked) `*_aarch64.dmg`, rewrites the `version`
and `sha256` in `Casks/cooldesk.rb`, and commits back to the default branch.
No manual step is required per release.

**Notes / limitations:**
- Apple Silicon only — the release pipeline currently builds `aarch64` DMGs.
  Add an `x64` matrix entry and an `on_arch` block in the cask to cover Intel.
- The build is **not notarized**, so the cask's `postflight` clears the
  `com.apple.quarantine` flag (same idea as `scripts/repack-mac-dmg.sh`).
- To get into the **official** `homebrew/cask` (and the formulae.brew.sh
  backlink), the app must be signed + notarized and meet Homebrew's notability
  threshold. Once notarized, remove the `postflight` block and submit via
  `brew bump-cask-pr`.

---

## Chrome Extension

### Build

```bash
# Build extension (default Vite mode)
npm run build
```

Output: `dist/` — load this folder as an unpacked extension or zip it for the Chrome Web Store.

### Load Unpacked (for testing)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `dist/` folder

### Package for Chrome Web Store

```bash
npm run build

# Zip the dist folder
zip -r cooldesk-extension.zip dist/
```

Upload `cooldesk-extension.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## Full Stack (App + Extension Together)

The extension communicates with the Tauri app via WebSocket on `ws://127.0.0.1:4545`.
No special configuration is needed — the sidecar server starts automatically when the Tauri app launches.

**Typical workflow:**
1. Install the Tauri desktop app (`.dmg` or `.msi`)
2. Install the Chrome extension (from store or unpacked)
3. Open the app — the extension auto-connects

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `error: linker 'cc' not found` (macOS) | Run `xcode-select --install` |
| `VCRUNTIME140.dll not found` (Windows) | Install Visual C++ Redistributable |
| `WebView2 not found` (Windows) | Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| AppScanner not found | Ensure `src-tauri/bin/AppScanner-x86_64-pc-windows-msvc.exe` exists |
| WS connection fails | Check that app is running and port 4545 is not blocked by firewall |
| Extension not connecting | Open `chrome://extensions`, check the extension is enabled, reload it |
| Build fails on `llama-cpp-2` | Ensure you have a C++ compiler; on Windows use VS Build Tools 2022 |
| `error: failed to run custom build command for webkit2gtk-sys` (Linux) | Install the WebKitGTK/GTK3 dev headers listed above |
| AppImage won't launch: `dlopen(): error loading libfuse.so.2` | Install `fuse`/`fuse2` (`apt install libfuse2` on newer Ubuntu), or run with `--appimage-extract-and-run` |

---

## Environment Variables (optional)

| Variable | Description |
|---|---|
| `TAURI_ENV_PLATFORM` | Set automatically by Tauri CLI; triggers Tauri-specific Vite config |
| `APPLE_CERTIFICATE` | macOS code signing certificate name |
| `APPLE_ID` / `APPLE_PASSWORD` | macOS notarization credentials |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

---

## Project Scripts Reference

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server (extension/browser mode) |
| `npm run dev:tauri` | Tauri dev with hot-reload |
| `npm run build` | Build Chrome extension → `dist/` |
| `npm run build:tauri` | Build Tauri app → `src-tauri/target/release/bundle/` |
| `npm run preview` | Preview the Vite build locally |
| `npm run lint` | Run ESLint |
