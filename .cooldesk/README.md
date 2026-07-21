# CoolDesk

Desktop app (**Tauri / Rust backend + React frontend**) plus a **Chrome extension**. A launcher
that organizes your work by project — search, dock, workspaces, and AI over your apps and tabs.

## Layout

| Path | What |
| --- | --- |
| `src/` | React frontend (search, spotlight, workspaces, dock) |
| `src-tauri/` | Rust backend: Tauri commands + axum sidecar HTTP/WS server on port **4545** |
| `cooldesk-plugin/` | Claude Code plugin that authors this `.cooldesk/` workspace |
| `scripts/`, `worker/`, `docs/` | tooling, background worker, docs |

The Chrome extension syncs to the desktop app over HTTP+WS on port **4545**.

## Run

```
npm install
npm run dev:tauri     # full desktop app (Rust + frontend)
npm run dev           # frontend only (Vite)
npm run build:tauri   # build the desktop app
```

## Services

- **Sidecar API** — axum server on `http://localhost:4545` (search, workspaces, activity, `.cooldesk` reader, …).

## Project knowledge

This `.cooldesk/` folder holds shared, committed project knowledge maintained by the CoolDesk
Claude Code plugin. Personal notes/progress go in `.cooldesk/local/` (gitignored), never in the
shared files. Maintain with `/cd-sync`, `/cd-todo`, `/cd-decision`.
