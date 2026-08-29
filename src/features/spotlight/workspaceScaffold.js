/**
 * "Create workspace" (the /agent panel's scaffold action) — scaffold a
 * project's `.cooldesk/` folder with Claude Code directly, in-app, instead of
 * requiring the separate cooldesk-plugin (its `/cd-init` + `/cd-sync`
 * commands) to be installed in the user's own Claude Code CLI.
 *
 * This is a distinct run mode from `/agent`'s chat (see aiAdapters.js):
 * that one is deliberately read-only (`--allowedTools WebSearch,WebFetch`,
 * no filesystem access) because it only ever edits CoolDesk's own workspace
 * records. Scaffolding has to write real files into the project folder, so
 * this grants Read/Glob/Grep (to inspect the repo) and Write/Edit (to author
 * `.cooldesk/*`) — but never Bash, so the run can't do anything beyond
 * reading and writing files under the project root it was pointed at.
 */

export const SCAFFOLD_BIN = 'claude';
export const SCAFFOLD_ALLOWED_TOOLS = 'Read,Glob,Grep,Write,Edit';

/**
 * Turn a scaffold prompt into the spec `ai_cli_run` expects. Always stdin —
 * the prompt is long, fenced markdown, and none of that survives argv intact.
 */
export function buildScaffoldSpec(prompt, cwd) {
  return {
    bin: SCAFFOLD_BIN,
    args: ['-p', '--allowedTools', SCAFFOLD_ALLOWED_TOOLS],
    stdin: prompt,
    cwd: cwd || null,
  };
}

// Condensed from cooldesk-plugin's `/cd-init` command and the
// `cooldesk-workspace` skill's format spec — kept here instead of installed
// separately so this works with zero setup on the user's Claude Code CLI.
const SCAFFOLD_PREAMBLE = `You are scaffolding a CoolDesk project workspace in the current working directory.

Goal: create (or bring up to date) a \`.cooldesk/\` folder — shared, committed project
knowledge (README, resources, todos, a dock/resource manifest) that any teammate or AI
can read after cloning this repo. This is NOT your own memory or scratch space; it is
the project's own knowledge, so write it for a human reading it in six months. Never put
secrets, credentials, personal preferences or session history in it.

Step 1 — check for an existing workspace:
- If \`.cooldesk/cooldesk.json\` already exists, treat this as an update: reconcile it
  with the repo's current state rather than overwriting it. Refresh \`resources\` and
  \`commands.json\` if they're stale, keep any human-written prose in \`README.md\` /
  \`architecture.md\` / \`decisions.md\` as-is, and in \`todos.json\` mark finished items
  \`done\` without inventing new ones. Do not touch the \`auto\` block in cooldesk.json —
  it is machine-owned.
- Otherwise, scaffold fresh (step 2).

Step 2 — inspect the repo to infer real content. Do not ask questions; infer from what's
actually there:
- \`package.json\` / \`Cargo.toml\` / \`pyproject.toml\` → name, description, run/build/test
  scripts.
- \`.git/config\` (read it directly — you have no Bash access, so this replaces
  \`git remote -v\`) → a \`github\`/\`gitlab\` resource from the \`origin\` remote's URL.
- obvious local services (dev server, sidecar, docker) → services.json.
- top-level source directories → folder resources.

Step 3 — create:
- \`.cooldesk/cooldesk.json\`:
  \`\`\`json
  {
    "schemaVersion": 1,
    "project": { "id": "<kebab-id>", "name": "...", "description": "One line.", "status": "active" },
    "resources": [
      { "type": "github", "name": "...", "url": "..." },
      { "type": "folder", "name": "...", "path": "..." }
    ],
    "dock": { "pinned": [ { "type": "command", "ref": "dev" } ] },
    "sidebar": { "sections": ["todos", "decisions", "notes"] },
    "auto": {}
  }
  \`\`\`
  \`status\` is one of \`active | planning | on-hold\`. \`resource.type\` is provider-agnostic
  (\`github\`, \`gitlab\`, \`folder\`, \`link\`, \`figma\`, \`notion\`, \`jira\`, \`slack\`, \`docker\`,
  \`service\`, …) — pick whatever actually applies. Leave \`auto\` as \`{}\`.
- \`.cooldesk/README.md\` — what this project is and how to run it, from what you found.
- \`.cooldesk/commands.json\` — \`{ "commands": [ { "id", "label", "run", "cwd" } ] }\`, the
  real run/build/test commands you detected.
- \`.cooldesk/services.json\` — \`{ "services": [ { "id", "label", "url", "port" } ] }\`,
  only if local services actually exist.
- \`.cooldesk/todos.json\` — \`{ "todos": [ { "id", "title", "status": "todo", "shared": true } ] }\`,
  seeded with 2-4 concrete next steps you can actually see in the repo (a TODO comment,
  an obviously unfinished file, a missing test).
- \`.cooldesk/.gitignore\` containing \`local/\`.
- an empty \`.cooldesk/local/\` directory (add a \`.gitkeep\` file — it is gitignored personal
  scratch space, never write project knowledge there).

Do not invent architecture or decision prose you can't back up — leave \`architecture.md\`
and \`decisions.md\` for later, once real decisions exist to record.

When you're done, reply in plain prose (no fenced json block) with a short summary of what
you created or changed and 2-3 things the user should review or correct. Do not run any
shell commands — you only have file read/write tools.`;

/**
 * @param {string} [focusHint] optional free-text steer from the user
 *   (e.g. "focus on the backend", "we use pnpm not npm").
 * @param {object} [opts]
 * @param {Array<{name: string, path: string}>} [opts.plainFolders] sibling
 *   folders in the same CoolDesk workspace that this run should list as plain
 *   `folder` resources — used only for the hub's run when a workspace mixes
 *   real projects with plain reference folders (a Downloads-style folder, a
 *   notes folder, …) that don't get their own `.cooldesk/`.
 * @param {Array<{name: string, path: string}>} [opts.linkedProjects] other
 *   project folders in the same workspace that will be (or already are)
 *   linked to this one as a group — mentioned for context only; the actual
 *   link is written separately via `linkCooldeskProject`, not by this run.
 */
export function buildScaffoldPrompt(focusHint, opts = {}) {
  const focus = (focusHint || '').trim();
  const { plainFolders, linkedProjects } = opts;

  let extra = '';
  if (plainFolders?.length) {
    const list = plainFolders.map(f => `  - ${f.name}: ${f.path}`).join('\n');
    extra += `\n\nThis CoolDesk workspace also has these plain folders alongside the project — add each as a \`"type": "folder"\` resource in cooldesk.json (name + path exactly as given), not a project of its own:\n${list}`;
  }
  if (linkedProjects?.length) {
    const list = linkedProjects.map(f => `  - ${f.name}: ${f.path}`).join('\n');
    extra += `\n\nThis project is (or will be) linked as a group with these sibling projects, each scaffolded separately — no action needed here, this is context only, do not add them as resources:\n${list}`;
  }

  return `${SCAFFOLD_PREAMBLE}${focus ? `\n\nUser's focus for this run: ${focus}` : ''}${extra}\n`;
}
