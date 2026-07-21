---
description: Record an architecture/design decision in .cooldesk/decisions.md (ADR style).
---

Append a decision to `.cooldesk/decisions.md` (create the file if missing).

- Take the decision from `$ARGUMENTS`. If it's terse, expand Context/Consequences from what you
  know of this session and the codebase — but don't fabricate; keep it honest and short.
- Prepend a new block at the top (newest first), dated today:

```
## <YYYY-MM-DD> — <short title>
**Status:** accepted
**Context:** why this came up
**Decision:** what we chose
**Consequences:** what this implies / what it rules out
```

- Decisions are shared team knowledge — no secrets, no personal preferences.
- Show the block you added.

Arguments: $ARGUMENTS
