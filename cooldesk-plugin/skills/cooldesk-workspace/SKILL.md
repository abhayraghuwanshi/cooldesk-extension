---
name: cooldesk-workspace
description: Create and maintain a project's .cooldesk/ workspace — shareable, committed project knowledge (README, architecture, decisions, todos, and a dock/resource manifest the CoolDesk desktop app reads). Use when asked to set up, sync, document, or add todos/decisions/resources to a CoolDesk project, or whenever you produce project knowledge worth keeping.
---

# CoolDesk Workspace

A project is more than a repository. `.cooldesk/` is the folder where a project's shared
knowledge lives so that a teammate — or a different AI model — can pick up the project after
cloning, without rebuilding context by hand.

## This is NOT Claude memory

| Claude memory (`~/.claude/.../memory`) | `.cooldesk/` |
| --- | --- |
| Private to one user / Claude | Committed to the repo, shared with the team |
| Claude's cross-session recall | The project's own knowledge, model-agnostic |
| Notes about *how Claude should work* | Facts about *the project itself* |
| Never leaves the machine | Travels with the project on clone |

So: write `.cooldesk/` for a human teammate reading it in 6 months. Never put secrets,
credentials, API keys, personal preferences, window layouts, editor choice, or session
history in `.cooldesk/`. Those belong in the CoolDesk backend/user layer or in `.cooldesk/local/`
(gitignored), never in the shared, committed files.

## Layout

```
.cooldesk/
├── cooldesk.json        # manifest: project + resources + dock + sidebar (machine-read)
├── README.md            # human + AI entry point — what this project is, how to run it
├── architecture.md      # how it fits together
├── decisions.md         # append-only decision log (ADR style)
├── commands.json        # launch / run commands (dev, build, test…)
├── services.json        # local services (ports, urls, docker)
├── todos.json           # shared todos (machine-read; surfaced in the CoolDesk sidebar)
├── knowledge/           # glossary, conventions, deep-dives (one topic per file)
├── prompts/             # reusable prompt templates for this project
├── workflows/           # multi-step procedures (release, onboarding…)
├── notes/               # shared team notes
├── .gitignore           # ignores local/
└── local/               # gitignored: personal notes / progress / session scratch
```

Create only what the project needs. A fresh init should always produce `cooldesk.json`,
`README.md`, `todos.json`, `.gitignore`, and `local/`. Add the rest as real content exists —
never leave empty placeholder prose.

## File formats

`cooldesk.json` — the manifest the desktop app reads to render the dock, resources and sidebar.
The `auto` block is machine-owned: **do not hand-edit it**; the plugin's sync hook regenerates it.

```json
{
  "schemaVersion": 1,
  "project": { "id": "cooldesk", "name": "CoolDesk", "description": "One line.", "status": "active" },
  "resources": [
    { "type": "github", "name": "ui", "url": "https://github.com/org/cooldesk-ui" },
    { "type": "folder", "name": "backend", "path": "src-tauri" },
    { "type": "figma",  "name": "design", "url": "https://figma.com/..." }
  ],
  "dock": { "pinned": [ { "type": "command", "ref": "dev" }, { "type": "resource", "ref": "ui" } ] },
  "sidebar": { "sections": ["todos", "decisions", "notes"] },
  "auto": {}
}
```

`status` is one of `active | planning | on-hold`. `resource.type` is provider-agnostic
(`github`, `gitlab`, `folder`, `link`, `figma`, `notion`, `jira`, `slack`, `docker`, `service`, …) —
adding a provider is just a new `type` string.

`commands.json`
```json
{ "commands": [ { "id": "dev", "label": "Dev server", "run": "npm run dev", "cwd": "." } ] }
```

`services.json`
```json
{ "services": [ { "id": "sidecar", "label": "Sidecar API", "url": "http://localhost:4545", "port": 4545 } ] }
```

`todos.json` — `status` is `todo | in_progress | done`. Keep `shared: true` items team-facing;
put personal ones in `local/`.
```json
{ "todos": [ { "id": "t1", "title": "Wire dock to cooldesk.json", "status": "in_progress", "shared": true } ] }
```

`group.json` (optional, hub only) — links many projects into one workspace using a **star
topology**: the hub lists all members; each member holds a single back-pointer. Scales linearly
(10 projects = 1 group file + 10 back-pointers), unlike pairwise two-way links (N²). Managed by
`/cd-link`.
```json
{
  "schemaVersion": 1,
  "group": { "id": "cooldesk-suite", "name": "CoolDesk Suite" },
  "members": [
    { "name": "extension", "path": ".", "repo": "https://github.com/org/cooldesk-extension" },
    { "name": "website", "path": "../cooldesk-onboard-smoothly", "repo": "https://github.com/org/site" }
  ]
}
```
A member's own `cooldesk.json` carries only the back-pointer (never sibling links):
```json
"group": { "name": "CoolDesk Suite", "hub": "../extension", "hubRepo": "https://github.com/org/cooldesk-extension" }
```
Paths are relative to the hub (survive a sibling clone); `repo` is the canonical fallback. The app
reader follows the hub's `group.json`, resolves each member's `.cooldesk/`, and merges them.

`decisions.md` — append-only, newest first, one block per decision:
```
## 2026-07-22 — Store project knowledge in .cooldesk/, not the backend
**Status:** accepted
**Context:** …
**Decision:** …
**Consequences:** …
```

## How to init (`/cd-init`)

1. Inspect the repo: read `package.json` / `Cargo.toml` / `README`, detect scripts, ports,
   git remotes, obvious services. Infer, don't interrogate.
2. Create `.cooldesk/` with `cooldesk.json` (project + detected resources + real run commands),
   `README.md`, `todos.json` (seed with 2–4 concrete next steps you actually see), `commands.json`,
   `services.json` when there are services, `.gitignore` (`local/\n`), and an empty `local/`.
3. Leave `auto` as `{}` — the hook fills it.
4. Tell the user what you created and what to review.

## How to sync (`/cd-sync`)

Reconcile `.cooldesk/` with the current state of the project: update `architecture.md`,
refresh resources/commands in `cooldesk.json`, close/add todos, append any decisions made this
session. Then the deterministic `auto` block is refreshed by the hook. Prefer editing existing
files over rewriting them; keep human prose the human wrote.

## Rules

- Team-shareable and committed. Reads cleanly after a fresh clone.
- No secrets, no personal layout, no session history in the shared files.
- Machine files are valid JSON; the `auto` block is off-limits to hand edits.
- Keep it small and true. Delete stale knowledge rather than letting it rot.
