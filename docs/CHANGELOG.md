# Changelog

All notable changes to CoolDesk (desktop app + Chrome extension) are documented here.

## [Unreleased]

## [2.0.13] — 2026-09-06

### Added
- **"Media" tab in the activity feed** (`ActivityFeed.jsx`): shows tabs currently playing audio (polled via `chrome.tabs.query({ audible: true })`) plus a "Recently played" history capped at 20 entries and persisted to `localStorage`, so pausing or closing a tab doesn't lose the last video/song. A real pause action (injects a script that pauses every `<video>`/`<audio>` element on the page) sits alongside the existing mute, with a short suppression window to work around Chrome keeping a tab's `audible` flag true for a couple seconds after playback actually stops.
- **Recently-played media is now deduped by hostname instead of exact URL** — Netflix and similar single-page sites rewrite the tab URL/title on every in-app navigation while audio keeps playing, which previously produced a fresh "Netflix" row on every browse instead of updating the existing one.
- **"Suites" tab in the activity feed**: automatically groups multi-service accounts (Google, Microsoft, Apple, etc. — anything with 3+ distinct services seen) instead of listing each service separately. The active feed tab (All Activity/Local/Suites/Search/Media/...) now also persists across refreshes (`cooldesk-feed-active-tab`), and Local/Suites pull from a 90-day history + live-tabs snapshot instead of the main feed's 4-hour/100-item window.
- **Search and history in the Search tab**: the curated app/search launcher now shows up to 3 recent history visits per app (90 days) when that app isn't currently open in any tab, so a closed ChatGPT thread or similar stays one click away instead of disappearing once the tab closes.
- **"Search my browser" from the spotlight** (`GlobalSpotlight.jsx`): a query can now route through `chrome.search.query`, which opens it in the user's actual default search engine, falling back to a plain Google search tab on the desktop app (no `chrome.search` there) or if the call fails.
- **Edit a workspace directly from its card**: workspace cards can trigger `/edit-workspace` (new `editTarget`/`onExitEditMode` props on `GlobalSpotlight`) instead of requiring the user to type the workspace's name into the spotlight first.
- **The agent can now see the user's actual tabs, history, bookmarks, and apps.** It previously had no tool for this (only WebSearch/WebFetch) and would fabricate plausible-looking URLs when asked to "search my history" instead of saying it couldn't. `runAgentWithBrowsingSnapshot` gathers a real snapshot the same way a bare `/u`/`/a` browse already does and hands it over as an attachment, so the agent picks from real rows instead of inventing them.

### Fixed
- **Deleting a workspace could silently fail and leave it in place.** `deleteWorkspace` is wrapped in an error handler that never throws — it resolves to `{success, data}` or `{success: false, error}` — but `WorkspaceList.jsx`'s delete handler only did a bare `await`/`try`/`catch`, so any failure was treated as success and the page reloaded anyway with the workspace still there. It now checks `result.success` before treating the delete as done.
- **The workspace-delete confirmation used `window.confirm`**, a native dialog that this Tauri app's windowing setup can leave stuck — never dismissing, or appearing behind the app with no way to click through. Replaced with a custom in-app confirmation modal.
- **A corrupted `sync-data.json` was silently overwritten with an empty default on the very next save**, permanently destroying whatever was still recoverable in it. `sidecar::storage::load_data` now renames an unparseable file aside to `sync-data.corrupt-<timestamp>.json` before falling back to defaults, and both `sync-data.json` and the per-day site-usage files (`sites.rs::save_day`) now write to a temp file and atomically rename it into place instead of writing in place — a crash mid-write can no longer leave a truncated file behind.
- **The sidecar server could panic on chat/graph requests containing accented letters, CJK text, or emoji.** Four log-truncation call sites (`normalize_url_for_graph`, `v3_simple_chat`, `v3_chat`, `v3_suggest`) sliced strings at a raw byte offset, which panics if a multi-byte UTF-8 character straddles that boundary — killing the request's connection. All four now walk back to the nearest valid char boundary first.
- **`POST /sync`'s tab handling wrote straight to the aggregated tab list**, bypassing the per-device map every other tab-write path uses — it could wipe out other connected devices' tabs, and the very next background sync would silently undo `/sync`'s own write on top of that. It now goes through the same `device_tabs_map`/`recompute_aggregated_tabs` path, keyed by each tab's own device id.
- **Remote workspace/note/pin updates that only touched existing items (no new ones in the batch) were merged correctly in memory but never written to IndexedDB** (`syncOrchestrator.js`) — the UI looked right for the rest of the session, then reverted to the stale pre-update data on the next restart.
- **The delta-sync watermark used for "what local changes still need pushing" was also being advanced by unrelated incoming remote updates**, and advanced before a push was even confirmed sent — either way, a still-unpushed local edit could be silently and permanently excluded from sync. Inbound and outbound cursors are now tracked separately, and the outbound one only advances once a push is confirmed to have gone out (the Tauri desktop IPC shim was also found unconditionally reporting success regardless of the actual HTTP status, and fixed alongside this).
- Incoming remote sync updates arriving while a full sync was already in progress raced it — whichever write finished last could silently undo the other's changes. They're now deferred and replayed after the full sync completes.
- **The `dailyCleanup` alarm listener was registered after an `await` in the extension's background script**, so if that alarm itself woke a suspended service worker, the wake event fired before the listener existed and was dropped — the daily activity cleanup could silently stop running.
- **Tab-activity time tracking could attribute a page's viewing time to the wrong tab.** Tab-activation handling resolved the URL from whichever window currently had OS focus rather than the tab that was actually activated, and switching focus between two open windows without changing either one's active tab left tracking pointed at the previous window's stale tab.
- **`EXECUTE_COMMAND` voice/spotlight commands always failed silently** — the extension referenced a `commandExecutor` whose import had been commented out. Restored after confirming it's safe to re-enable.
- The preview pane's drag-to-resize handle could get stuck resizing if the mouse was released outside the app window (no pointer capture); the Places overlay in the file manager didn't close after picking an item on narrow windows; a `501–599px` layout breakpoint had been accidentally deleted, giving that width band the wrong padding. All three fixed.
- The docked sidebar panel's macOS positioning was queued to run after `show()`/`set_focus()` with no ordering guarantee between them, which could let the panel flash at a stale position for a frame; the leave-intent auto-collapse watcher was applying the floating vertical panel's edge margin to the horizontal dock bar too, which has no such gap. Both fixed.
- `run_project_command`'s saved shell commands broke for any project path containing a space (common on macOS: `~/Library/...`, `~/Google Drive/...`) — the working directory was interpolated into the `cd` unquoted.
- The three file-preview Tauri commands (`preview_text_file`/`preview_image_file`/`preview_pdf_file`) read and base64-encoded large files directly on the async command's worker thread, which could stall other IPC calls for the duration; they now run via `spawn_blocking`.
- Roughly 20 IndexedDB write paths across `db/unified-api.js` resolved as soon as the individual request succeeded rather than waiting for the transaction to actually commit, so a transaction abort (e.g. quota exceeded) could report success while persisting nothing. Also fixed: a couple of internal callers that didn't unwrap another function's `{success, data}` result, which could report `success: true` for a write that had actually failed.
- A handful of smaller data-integrity and lock-safety fixes across the same areas: duplicate/colliding-id handling in array merges, two `chrome.storage.local` keys that could race on concurrent writes, an activity-stats flush that dropped stats permanently if the desktop app was offline instead of retrying, and a bounce-detection heuristic that could misattribute session stats to the wrong URL when a background-audio tab was open.

## [2.0.11] — 2026-08-25

### Added
- **The collapsed dock/sidebar edge handle now expands on hover-intent, not just a click.** `handle-main.js` starts a 200ms timer on `mouseenter` before calling `dock_expand`, cancelled on `mouseleave` — long enough that just passing the cursor over the edge (reaching for a traffic-light button, Mission Control, a scroll edge) doesn't pop the panel open, short enough not to feel laggy. Click still expands instantly as before; collapsing back down is unchanged (the panel's existing blur handler).
- **macOS dock/sidebar can now render over another app's fullscreen Space**, not just follow ordinary Space switches. `dock::join_fullscreen_space` (`src-tauri/src/dock/mac.rs`) reuses the same private CGS Spaces API call that powers the Spotlight overlay, but deliberately skips the elevated `NSStatusWindowLevel`/`Stationary`/`IgnoresCycle` treatment (see 2.0.9's fix) so the drawer/handle stay normal, Cmd+Tab-able windows. Since a CGS Space join is a one-time snapshot rather than a standing subscription, a new macOS-only watcher thread in `lib.rs` (gated on `MAC_DOCK_ACTIVE`) rejoins the active Space every 600ms while the dock is visible.

## [2.0.10] — 2026-08-22

### Fixed
- **Clicking a running-but-backgrounded macOS app (Music, Notes, ...) from CoolDesk's dock, workspace cards, Tab Management, or the activity feed did nothing — even though the same app opened fine from the real Dock.** `focus_window_by_pid` (`src-tauri/src/focus/mac.rs`) tried AppleScript (`tell application "X" to activate`, then `System Events` frontmost-by-pid) to bring the app forward. Both can report success without ever presenting a window for an app that's running headless — e.g. Music launched at login as a background media/Continuity helper with zero open windows. The real Dock instead goes through LaunchServices' `open -a <name>`, which reliably triggers the app's reopen-and-show-main-window behavior; `focus_window_by_pid` now tries that first, falling back to AppleScript only if `open -a` can't resolve the app.
- **A failed `focusApp` call was silently swallowed on most screens**, so a click just did nothing with no fallback. `workspaceActivityService.activate()` (used by the dock bar and workspace cards), `TabManagement.jsx`'s `handleAppClick`, and `ActivityFeed.jsx`'s running-app click handler now all fall back to `launchApp` when `focusApp` fails — matching the fallback `GlobalSpotlight.jsx` already had.
- **`launch_app`'s macOS branch fired `open` with `.spawn()` and never checked whether it actually succeeded** — a bad path or a LaunchServices failure was silently discarded. It now uses `.output()` and returns the real error (surfacing to the UI's fallback/error paths) instead of pretending the launch worked.
- macOS window scanning (`scanner/mac.rs`) now only applies the `LSUIElement`/`LSBackgroundOnly` Info.plist filter to processes with no on-screen window, instead of dropping any process matching those flags outright — a menu-bar app that ships `LSUIElement=YES` but flips to a regular activation policy at runtime (putting a real window on screen) was being excluded from the running-apps list entirely.

## [2.0.9] — 2026-08-14

### Fixed
- **Sidebar/bottom-bar dock could get permanently stuck, unreachable from the in-app "back to full window" control.** The fullscreen-Spotlight-overlay work in 2.0.8 raised the main window to `NSStatusWindowLevel` and marked it `Stationary`/`IgnoresCycle` whenever the sidebar or taskbar dock was expanded — behavior meant only for the transient Spotlight overlay, not a window the user needs to keep interacting with. Split into `allow_over_fullscreen_spaces` (sidebar/handle — unchanged, safe scope) and `promote_spotlight_over_fullscreen_spaces` (Spotlight only) in `src-tauri/src/dock/mac.rs`.
- **The docked taskbar bar (and its collapsed edge handle) could render underneath the real macOS Dock or menu bar** — invisible and unclickable, with no way back once collapsed. `drawer_geom` positions horizontal docks against the full monitor rect; `dock::clamp_to_visible_frame` (macOS-only, via `NSScreen.visibleFrame`) now nudges the bar/handle back above whatever the Dock or menu bar actually reserves.
- **macOS installs showing "CoolDesk is damaged and can't be opened."** The DMG is still unsigned/unnotarized, so this can't be fully eliminated yet, but the bundled fix is no longer easy to miss: renamed to "① RUN THIS FIRST — Fix & Open CoolDesk.command", a README explaining why the dialog appears, and the DMG's Finder window is now arranged (`scripts/repack-mac-dmg.sh`) instead of an unstyled file listing.
- **The Homebrew cask silently stopped tracking new releases** — stuck on 1.3.0 while the `homebrew` release job kept reporting success. The update script now fails loudly (with diagnostics) instead of no-oping, and verifies the push actually landed on `origin/master` before declaring victory.
- AI CLI agents (Claude Code, opencode, Codex) spawned from the spotlight could fail to find a binary that works fine in Terminal, on macOS/Linux. The app only inherits launchd's bare `PATH`; `ai_cli.rs` now asks the user's login shell for its real `PATH` (nvm, Homebrew, `~/.local/bin`, etc.) once at startup and merges it in.

### Added
- **Dock-to-side button in the bottom/top taskbar bar** (`WorkspaceDockBar.jsx`): jumps straight to a vertical side dock without backing out to full window first.
- **Explicit per-layout recovery options in the tray/menu-bar icon**: "Full Window", "Side Dock", and "Bottom Bar" now each have their own always-reachable menu item (replacing a single ambiguous "Toggle Workspace Dock") that forces the window visible regardless of whatever state it's currently stuck in.
- **Per-column accent color on the Overview dashboard** (`OverviewDashboard.jsx`): a hover-revealed "card color" chip on both the widget-board and activity-feed columns, same swatch picker as widget tiles.

### Changed
- Onboarding tour's wallpaper step now works in extension mode too (`ExtensionApp.jsx` passes through the wallpaper enabled/url props it was missing).

## [2.0.8] — 2026-08-04

### Added
- **Terminal AI agents inside the spotlight** (`src-tauri/src/ai_cli.rs`, `src/features/spotlight/useAiCli.js`, `aiAdapters.js`, `AgentMarkdown.jsx`, `CopyButton.jsx`): a new agent mode runs Claude Code, opencode, or Codex CLI headlessly and streams the reply straight into the search panel, with a switcher to pick the adapter, a "New chat" control to drop context, and a history of past prompts. The Rust side only knows how to spawn a binary and stream stdout/stderr as Tauri events — which CLI, its args, and whether the prompt goes on argv or stdin is config in `aiAdapters.js`, so adding a new terminal agent is a config entry, not a Rust change. `resolve_bin` walks PATHEXT across every PATH directory on Windows so npm's `.cmd` shim is found instead of the extensionless sh script that Win32 can't start (os error 193).
- **Add-to-workspace via search**: workspace cards no longer own a modal or a search box of their own — clicking their add affordance puts the shared spotlight into "add mode" (`addTarget`/`onAddItem`/`onExitAddMode` props on `GlobalSpotlight`), so the same index used to find a tab to jump to is used to file that tab into a workspace. Picking a result adds it and keeps the panel open for filing several items in a row; Escape exits add mode before it closes the spotlight.
- **Remove items from a workspace card** (`WorkspaceCard.jsx`): every url/app chip now has a × to remove it via a filtered save, in both the compact icon and expanded list layouts. Items that came from a project's committed `.cooldesk` manifest (carrying `_cd`) have no ×, since removing them here wouldn't touch the manifest they actually live in.

### Changed
- **Agent adapter switcher redesigned** (`GlobalSpotlight.jsx`): the row of adapter chips became a single dropdown so it fits alongside the new "New chat" and history controls without crowding the header.

### Removed
- **`AIWorkspaceManager` and its whole tree** (`src/features/ai-workspace/`, ~2,700 lines: `AIWorkspaceManager.jsx`, `AIPromptBar.jsx`, `AISuggestionPanel.jsx`, `WorkspaceEditor.jsx`, `WorkspaceSwitcher.jsx`, `useAISuggestions.js`, `useBrowserData.js`, `useMemory.js`, `useWorkspaceAgent.js`) — its own internal sidebar was the source of a stuck/unresponsive panel; deleting the component in favour of spotlight add-mode above removes the bug along with the code.
- Duplicate curated-wallpaper URL lists in `App.jsx`, `ExtensionApp.jsx`, `ThemesTab.jsx`, and `OnboardingTour.jsx` consolidated into `src/shared/data/wallpapers.js`.

### Fixed
- Stray test scripts and docs moved into `scripts/` and `docs/` (`test_*.js` → `scripts/`, `CHANGELOG.md`/`DEPLOY.md`/`SECURITY_REVIEW.md` → `docs/`) instead of living at the repo root.

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
