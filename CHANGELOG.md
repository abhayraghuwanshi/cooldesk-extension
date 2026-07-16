# Changelog

All notable changes to CoolDesk (desktop app + Chrome extension) are documented here.

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
