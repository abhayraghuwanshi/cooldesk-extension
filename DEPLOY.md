# CoolDesk — Deployment Guide

How to build and distribute the **Tauri desktop app** and **Chrome extension** on macOS and Windows.

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
