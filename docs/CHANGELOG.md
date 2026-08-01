# Changelog

All notable changes to CoolDesk (desktop app + Chrome extension) are documented here.

## [2.0.7] — 2026-08-01

Desktop app and Chrome extension now share one version number.

### Changed
- **The desktop app jumped from 1.7.1 to 2.0.7 to match the Chrome extension.** Two version lines for one product meant every release note, support thread and bug report had to say which number it meant. From here there is a single CoolDesk version: the app and the extension ship the same number, and the Settings → Version row means the same thing on either surface. Nothing about the app changed in this release — the jump is bookkeeping, and 2.0.7 is a normal semver upgrade from 1.7.1, so the updater treats it like any other.
- Desktop releases are tagged `vX.Y.Z` and extension releases `ext-vX.Y.Z` off the same number. The release workflow reads the version from the tag, so the tag and the `version` fields in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` have to be bumped together.

## [1.7.1] — 2026-07-26

Desktop app 1.7.1 · Chrome extension 2.0.7

### Fixed
- **Jumping to a tab focused the wrong browser, or an unrelated app.** Clicking a tab that lives in another browser made every open browser fight for the foreground. Three causes, all fixed:
  - `syncWebSocket.handleJumpToTab` acted on any incoming tab id with no device, url, or browser guard. Tab ids are small per-browser integers that collide constantly, so each browser activated an unrelated tab of its own and demanded OS focus. Jumps now route by `deviceId` (unique per browser instance), confirm the url before trusting a tab id, and dedupe against the bridge's WS and HTTP-poll receivers via a shared guard (`src/services/jumpGuard.js`).
  - Every Chromium browser reported itself as `"chrome"`, so a jump in Brave asked the desktop app to focus a `chrome.exe` window at Brave's coordinates — and maximised windows share coordinates, so Chrome got the focus. Browser identity now comes from one detector (`detectBrowser` in `src/services/syncConfig.js`) and travels with pushed tabs and focus requests.
  - Native focus matched process names by substring, so `"edge"` also matched `msedgewebview2.exe` and a missed browser focus foregrounded whatever WebView2-hosted app enumerated first. `focus.rs` now maps a browser id to exact executable stems, and the substring fallback skips WebView2 hosts.
- The `native-focus-done` acknowledgement is broadcast to every connected browser; only the browser that requested the focus now re-activates a tab with that id.

### Removed
- Dead `syncOrchestrator.handleRemoteJumpToTab()` — unwired, and it reimplemented the unguarded jump above.

## [1.7.0] — 2026-07-25

### Added
- **Widget board and widget store** (`WidgetBoard.jsx`, `src/data/widgetCatalog.js`, `src/data/customWidgets.js`): a tiled widget surface on the workspace canvas, backed by **39 bundled widgets** in `public/widgets/` — clock, calendar, pomodoro, habits, notes, crypto, currency, converter, GitHub, moon phase, on-this-day, password generator, colour palette, JSON tools, countdown, breathing timer, and more. Widgets render inside a sandboxed host page (`widget-sandbox.html`, `src/services/widgetHostBridge.js`) and receive their tile colour from the host.
- **Workspace dock bar** (`src-tauri/src/dock.rs`, `WorkspaceDockBar.jsx`, `src/styles/dockbar.css`, `src/hooks/useDockState.js`): a persistent docked sidebar registered as a native Windows AppBar via `SHAppBarMessage`, so it reserves screen space instead of floating over other windows. Includes a drag handle surface (`handle.html`, `src/handle-main.js`).
- **File Manager** (`FileManager.jsx`, `src/styles/fileManager.css`): a built-in file browser that links folders on disk to CoolDesk projects.
- **`.cooldesk` project folder and Claude Code plugin** (`cooldesk-plugin/`, `src-tauri/src/sidecar/cooldesk.rs`, `src/services/cooldeskService.js`): a committed, shareable per-project knowledge folder (README, architecture, decisions, todos, resource manifest). Authored by a Claude Code plugin providing `/cd-init`, `/cd-sync`, `/cd-todo`, `/cd-decision`, and `/cd-link` plus session hooks, and read back by the app over `GET /cooldesk`.
- **Onboarding tour** (`OnboardingTour.jsx`, `OnboardingTour.css`): a first-run walkthrough of the app's faces and shortcuts, shown at startup.
- **Backup and restore** (`src/services/backupService.js`, `src/services/backupRestore.js`): export and re-import workspaces and settings.
- **Voice and slash commands** (`src/hooks/useVoiceCommands.js`, `src/hooks/useSlashCommands.js`) wired into the spotlight input.
- **Workspace activity tracking** (`src/services/workspaceActivityService.js`) — per-workspace visit counts and last-activity ordering.
- Accent colour picker and font controls in Settings (`AccentColorPicker.jsx`, `FontFamilyDropdown.jsx`, `FontSizeDropdown.jsx`), plus an expanded wallpaper collection.
- Knowledge-graph node salience scoring (`src/utils/graphSalience.js`).
- Chrome Web Store listing copy (`docs/chrome-store-listing.md`) and this changelog.

### Changed
- **Unified search**: `GlobalSpotlight` is now the single search implementation, used both as the global overlay and embedded inside the desktop app. The separate in-app search UI was removed (see below), so both surfaces share one ranking path and one set of keyboard bindings.
- **Settings and theming redesigned** (`ThemesTab.jsx`, `SettingsModal.jsx`).
- **Workspace cards redesigned** (`WorkspaceCard.jsx`, `WorkspaceList.jsx`) with clearer click-to-navigate behaviour.
- Extension new tab page moved to its own lightweight entry point, separate from the desktop app bundle.
- Extension production builds now strip `console.log` / `.debug` / `.info` / `.trace` via esbuild pure annotations; `console.error` and `console.warn` are kept, and the dev server is unaffected.
- `src-tauri/src/lib.rs` gained the dock, cooldesk, and widget command surfaces (~1,300 lines).

### Fixed
- **Auto-updater `latest.json` generation** in the release workflow. The publish step read a `.browserDownloadUrl` field that `gh release view` does not emit, producing the string `"null"`, which made `curl` fail to resolve a host and killed the job with exit 6. URLs are now built from the tag (draft asset URLs change on publish), signatures are fetched with an authenticated download, the `-nsis` / `-msi` platform keys are preserved so MSI installs can still update, and the step now fails loudly rather than publishing a release with a dead updater.
- Scroll behaviour on the workspace details view.
- Assorted dock and workspace layout fixes.

### Removed
- `CoolSearch.jsx` (~2,500 lines) and `ExpandedSearchPanel.jsx` — superseded by the unified `GlobalSpotlight`.

### Known issues
- **macOS auto-update is not yet functional.** The release workflow builds macOS with `--bundles dmg`, so no `.app.tar.gz` updater artifact is produced, and the Tauri updater cannot install from a `.dmg`. Windows updates are unaffected.

## [1.6.0] — 2026-07-15

### Added
- **Activity tracking engine** (`src-tauri/src/sidecar/sampler.rs`): the Rust backend now samples the focused window, idle state, and audio every 30 seconds and classifies time per app as *active*, *media*, or *passive media*. Daily usage is persisted as per-day JSON files under `sync-data/activity/` and exposed via `GET /activity/app-usage`.
- **Per-domain browsing time** (`src-tauri/src/sidecar/sites.rs`): dwell time per website, exposed via `GET /activity/site-usage`. Spans from the extension are clamped so multi-tab browsing no longer over-counts time (previously inflated up to ~15x).
- **Activity Overview dashboard** (`ActivityOverview.jsx`): a redesigned overview showing app and site usage built on the new activity endpoints.
- Project interview question bank design doc (`docs/PROJECT_INTERVIEW_BANK.md`) — foundation for the upcoming interview-based agent.

### Changed
- **Knowledge Graph rewrite**: `KnowledgeGraph.jsx` was substantially reworked (~730 lines refactored) with rendering and layout fixes, plus updated styling.
- Overview dashboard integrates the new activity data.

### Fixed
- Multiple knowledge-graph frontend bugs (layout, rendering glitches).
- Minor spotlight CSS issues.

## [1.5.0] — 2026-07-06

### Added
- **Web app widgets on the canvas** (`WebAppPreviews.jsx`, `src-tauri/src/webapp_embed.rs`): live web app tiles embedded in the workspace canvas using Win32 `--app` window glue-embedding, with orphan-window cleanup and fullscreen pan support.
- **Search click learning**: the ranker now learns which URL you pick for a given query (`POST /feedback/url-click`, `GET /feedback/url-boosts`) and boosts those results on future searches.
- **Agent quality test harness** (`scripts/test-agent.mjs`) for evaluating the cloud AI agent's answers.
- **Chrome Web Store auto-publish** workflow (`.github/workflows/extension-release.yml`) — extension releases are now published from CI.
- Feature-flag system (`src/config/features.js`).
- Work-lifecycle taxonomy data (`src/data/lifecycle.js`) — groundwork, not yet wired into the UI.

### Changed
- **Spotlight keyboard navigation overhaul**: Tab moves between result sections, ←/→ switches workspaces, `/u` `/a` `/f` scope filters, and a clearer selection color scheme.
- Team / P2P view temporarily hidden behind the `TEAM_FEATURE_ENABLED` flag (Ctrl+3, `/team`, Settings tab, and onboarding step all gated) to simplify the app.
- General CSS polish for spotlight and AI surfaces.

### Fixed
- Gemini 3 tool-call loop in the cloud agent (tool history is now passed as plain text so `thought_signature` round-trips correctly).
- Spotlight hover vs. keyboard scroll fight — hovering no longer hijacks the keyboard selection.
- Workspace switching via keyboard.

## [1.4.0] — 2026-06-25

### Added
- Search tab next to the activity feed in the new tab page.
- Homebrew distribution for macOS.

### Changed
- Redesigned search bar UI.
- Analytics endpoint now points at the Cloudflare Worker.

### Fixed
- macOS apps missing from search results (regression from an earlier commit).
- Startup issue caused by a stale local port — the app now kills leftover port bindings on launch.
- Memory usage improvements.

## [1.3.0] — 2026-06-20

### Added
- Anonymous usage analytics and update heartbeat.
- Windows Terminal and File Explorer windows are now captured by the app scanner, so they appear in search.
- Search and close buttons in the spotlight.
- Chrome-sync alarm in the extension with a tab-management UI alert.

### Changed
- Navigation controls with folder navigation buttons in CoolDesk; settings verified.

### Fixed
- Scanner issue with terminal/explorer window capture.

### Security
- Auth hardening and rate limiting on the local API.
