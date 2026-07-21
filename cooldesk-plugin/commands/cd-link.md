---
description: Link this project to other .cooldesk projects as one group (discovers candidates, star/hub model).
---

Link `.cooldesk` projects together so the app shows them as one merged workspace. Follow the
`cooldesk-workspace` skill for the `group.json` format.

**Model — star, not pairwise.** The project you run this in is the **hub**. The hub owns
`.cooldesk/group.json` listing all members. Each member gets ONE back-pointer to the hub. This
scales to many projects (adding the 10th = append one member + write one back-pointer), unlike
two-way pairwise links which grow N².

## Modes

Parse `$ARGUMENTS`:
- **empty** → **discover candidates** (default, below).
- **one or more paths / repo URLs** → link those directly (skip discovery).
- **`list`** → print the current group and stop.
- **`remove <name|path>`** → drop that member from `group.json` (and its back-pointer) and stop.

## Discovery (when no path is given)

1. Require `.cooldesk/cooldesk.json` in the current (hub) project; if missing, tell the user to run
   `/cd-init` first and stop.
2. Run the scanner to find nearby projects that already have their own `.cooldesk/`:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cooldesk-sync.mjs" discover
   ```
   It returns `{ hub, candidates: [{ name, status, description, path, linked }] }` — sibling folders
   (and the hub's subfolders) containing `.cooldesk/cooldesk.json`. `linked: true` = already in the group.
3. If there are no unlinked candidates, tell the user and offer to link an explicit path instead. Stop.
4. Otherwise present the unlinked candidates as a **multi-select pick list**, all **pre-selected by
   default** (lazy-first — accepting the defaults links them all in one tap), each labeled
   `name · status · path`. Always include a "Something else… (enter a path)" escape hatch. Do not
   re-offer already-linked candidates (show them as context only).

## Linking (chosen or explicit paths)

For each project to add:
1. Ensure `.cooldesk/group.json` exists. If creating it, seed the hub itself as the first member:
   ```json
   {
     "schemaVersion": 1,
     "group": { "id": "<kebab-hub-id>-suite", "name": "<Hub Name> Suite" },
     "members": [ { "name": "<hub>", "path": ".", "repo": "<hub git remote or null>" } ]
   }
   ```
2. Confirm the target has its own `.cooldesk/cooldesk.json` (warn if not, but still allow the link).
3. Append `{ "name", "path": "<relative-from-hub>", "repo": "<member remote or null>" }` to
   `group.members` (skip duplicates by resolved path).
4. Write a back-pointer into that member's `.cooldesk/cooldesk.json` (top-level, next to `project`):
   ```json
   "group": { "name": "<Hub Name> Suite", "hub": "<relative-path-back-to-hub>", "hubRepo": "<hub remote or null>" }
   ```
   Members hold only this single back-pointer — never links to sibling members.
5. Keep paths relative (survive a sibling clone); keep `repo` as the canonical fallback.
6. Report the group name and its full member list.

Do not touch the machine-owned `auto` block. `group.json` is shared/committed — no secrets.
