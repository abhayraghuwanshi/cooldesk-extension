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
