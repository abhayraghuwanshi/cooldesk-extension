# CoolDesk plugin for Claude Code

Turns any repo into a **CoolDesk project**: a `.cooldesk/` workspace of shared, committed project
knowledge — README, architecture, decisions, todos, and a dock/resource manifest — that every AI
model and every teammate reads from.

This is deliberately **not** Claude's private memory. Claude memory is one user's cross-session
recall; `.cooldesk/` is the *project's own* knowledge, committed to git and model-agnostic, so a
teammate (or a different AI) can pick the project up after cloning without rebuilding context.

## What's inside

| Piece | Role |
| --- | --- |
| `skills/cooldesk-workspace` | The `.cooldesk/` format spec + rules Claude follows |
| `commands/cd-init` | Scaffold `.cooldesk/` by inspecting the repo |
| `commands/cd-sync` | Reconcile `.cooldesk/` with current project state |
| `commands/cd-todo` | Add / complete shared todos |
| `commands/cd-decision` | Record an ADR-style decision |
| `hooks/hooks.json` + `scripts/cooldesk-sync.mjs` | **Autoupdate** |

### Autoupdate (hooks)

- **SessionStart** → injects a `.cooldesk/` summary (project, resources, open todos) into the
  session, so every AI conversation starts already project-aware.
- **Stop** → refreshes the machine-owned `auto` block of `cooldesk.json` (git head, file inventory,
  todo counts). Idempotent, and completely **inert in any repo that has no `.cooldesk/`** — safe to
  leave installed globally.

## The `.cooldesk/` layout

```
.cooldesk/
├── cooldesk.json     # project + resources + dock + sidebar (desktop app reads this)
├── README.md         # human + AI entry point
├── architecture.md   decisions.md
├── commands.json     services.json      todos.json
├── knowledge/  prompts/  workflows/  notes/
├── .gitignore        # ignores local/
└── local/            # gitignored personal notes / progress
```

Data ownership, in short: **workspace/dock/personal prefs → CoolDesk backend**,
**project knowledge → `.cooldesk/` (committed)**, **embeddings/index/cache → local app cache**.

## Install (local dev)

From this repo's root (which holds `.claude-plugin/marketplace.json`):

```
/plugin marketplace add C:/Users/raghu/projects/extension
/plugin install cooldesk@cooldesk
```

Then in any project: `/cd-init` to scaffold, `/cd-sync` to keep it current.

## Usage

```
/cd-init                      scaffold .cooldesk/ from the current repo
/cd-sync                      update it to match reality
/cd-todo Wire dock to json    add a shared todo
/cd-todo done wire dock       complete one
/cd-decision Use .cooldesk/ over backend for project docs
```
