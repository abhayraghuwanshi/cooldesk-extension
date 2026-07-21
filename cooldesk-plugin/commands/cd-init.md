---
description: Scaffold a .cooldesk/ workspace for the current project by inspecting the repo.
---

Set up a `.cooldesk/` workspace for this project. Follow the `cooldesk-workspace` skill for the
exact file formats and rules (it is bundled with this plugin — load it first).

Steps:

1. If `.cooldesk/cooldesk.json` already exists, stop and tell the user it's already initialized —
   suggest `/cd-sync` instead. Do not overwrite.
2. Inspect the repo to infer real content — do not interrogate the user:
   - `package.json` / `Cargo.toml` / `pyproject.toml` → name, description, run/build/test scripts.
   - git remotes → `github`/`gitlab` resources.
   - obvious local services and ports (dev server, sidecar, docker) → `services.json`.
   - top-level source dirs → `folder` resources.
3. Create the workspace:
   - `.cooldesk/cooldesk.json` — project + detected resources + `dock`/`sidebar` defaults, `auto: {}`.
   - `.cooldesk/README.md` — what this project is and how to run it (from what you found).
   - `.cooldesk/commands.json` — the real run/build/test commands you detected.
   - `.cooldesk/services.json` — only if services exist.
   - `.cooldesk/todos.json` — seed 2–4 concrete next steps you can actually see in the repo.
   - `.cooldesk/.gitignore` containing `local/`.
   - empty `.cooldesk/local/` directory (add a `.gitkeep`).
4. Do NOT invent architecture/decisions prose you can't back up — leave those for `/cd-sync` as
   the project accrues real knowledge.
5. Report what you created and the 2–3 things the user should review or correct.

$ARGUMENTS may contain a project name or one-line description — use it to override what you inferred.
