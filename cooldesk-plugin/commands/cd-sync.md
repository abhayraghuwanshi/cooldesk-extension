---
description: Reconcile .cooldesk/ with the current state of the project and this session's work.
---

Bring `.cooldesk/` up to date. Follow the `cooldesk-workspace` skill for formats and rules.

1. If `.cooldesk/cooldesk.json` doesn't exist, tell the user to run `/cd-init` first and stop.
2. Reconcile against reality:
   - Refresh `resources` and `commands.json` if remotes/scripts/services changed.
   - Update `architecture.md` / `knowledge/` if the design moved — edit in place, keep the human's prose.
   - In `todos.json`: mark finished items `done`, add concrete new ones surfaced this session.
   - Append any decision made this session to `decisions.md` (newest first, ADR block).
3. Keep everything team-shareable — never write secrets, personal layout, or session history into
   the shared files (personal scratch goes in `.cooldesk/local/`).
4. Do not touch the `auto` block in `cooldesk.json` — the plugin's hook owns it.
5. Push the changes to a running CoolDesk app so it re-reads without a refresh:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/cooldesk-sync.mjs" announce`
   Silent success when the app isn't running — don't report that as a failure.
6. Summarize what changed.

$ARGUMENTS, if present, is a focus hint (e.g. "just todos", "update architecture").
