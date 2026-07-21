---
description: Add or update a shared todo in .cooldesk/todos.json.
---

Manage shared project todos in `.cooldesk/todos.json` (format defined in the `cooldesk-workspace` skill).

- If `.cooldesk/todos.json` doesn't exist, create it (`{ "todos": [] }`).
- Parse `$ARGUMENTS` as the intent:
  - A new task title → append `{ id, title, status: "todo", shared: true }` with a fresh short id.
  - "done <text/id>" → set the matching todo's status to `done`.
  - "start <text/id>" → set it to `in_progress`.
  - "list" → just show the current todos, no edit.
- Match existing todos fuzzily by title when an id isn't given; if ambiguous, ask which one.
- Keep it valid JSON. Personal-only tasks belong in `.cooldesk/local/`, not here.
- After editing, show the updated open todos.

Arguments: $ARGUMENTS
