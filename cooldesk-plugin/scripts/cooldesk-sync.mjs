#!/usr/bin/env node
/**
 * CoolDesk workspace sync engine.
 *
 *   node cooldesk-sync.mjs summary   -> emit .cooldesk context for SessionStart (no writes)
 *   node cooldesk-sync.mjs update    -> refresh the auto-generated block of cooldesk.json (idempotent)
 *
 * Both commands are INERT when the current directory has no .cooldesk/cooldesk.json,
 * so the hook is safe to leave installed globally across every repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const cwd = process.cwd();
const root = path.join(cwd, '.cooldesk');
const manifestPath = path.join(root, 'cooldesk.json');
const cmd = process.argv[2] || 'summary';

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch { return null; }
};

// Not a CoolDesk project -> stay completely silent.
if (!exists(manifestPath)) process.exit(0);

function todos() {
  const data = readJSON(path.join(root, 'todos.json'));
  const list = Array.isArray(data?.todos) ? data.todos : [];
  return {
    items: list,
    open: list.filter((t) => t.status !== 'done').length,
    done: list.filter((t) => t.status === 'done').length,
    total: list.length,
  };
}

function inventory() {
  const files = ['README.md', 'architecture.md', 'decisions.md', 'commands.json', 'services.json'];
  const dirs = ['knowledge', 'prompts', 'workflows', 'notes'];
  const present = {};
  for (const f of files) present[f] = exists(path.join(root, f));
  for (const d of dirs) present[d] = exists(path.join(root, d));
  return present;
}

if (cmd === 'update') {
  const manifest = readJSON(manifestPath) || {};
  const t = todos();
  const auto = {
    lastSyncedAt: new Date().toISOString().slice(0, 19) + 'Z',
    git: { branch: git('rev-parse --abbrev-ref HEAD'), head: git('rev-parse --short HEAD') },
    files: inventory(),
    todoCounts: { open: t.open, done: t.done, total: t.total },
  };
  // Only write when something other than the timestamp actually changed, to avoid git churn.
  const strip = (a) => JSON.stringify({ ...(a || {}), lastSyncedAt: undefined });
  if (strip(auto) !== strip(manifest.auto)) {
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, auto }, null, 2) + '\n');
  }
  process.exit(0);
}

if (cmd === 'discover') {
  // Find candidate projects to link: sibling folders (and the hub's own children)
  // that contain their own .cooldesk/cooldesk.json. Flags ones already in the group.
  const groupDoc = readJSON(path.join(root, 'group.json'));
  const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

  const linked = new Set([realpath(cwd)]);
  if (Array.isArray(groupDoc?.members)) {
    for (const m of groupDoc.members) linked.add(realpath(path.resolve(cwd, m.path || '.')));
  }

  const scanDirs = [path.dirname(cwd), cwd]; // siblings of the hub, plus the hub's own subfolders
  const seen = new Set();
  const candidates = [];
  for (const dir of scanDirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const proj = path.join(dir, e.name);
      const rp = realpath(proj);
      if (seen.has(rp)) continue;
      seen.add(rp);
      const manifest = readJSON(path.join(proj, '.cooldesk', 'cooldesk.json'));
      if (!manifest) continue;
      candidates.push({
        name: manifest.project?.name || e.name,
        status: manifest.project?.status || null,
        description: manifest.project?.description || null,
        path: path.relative(cwd, proj).split(path.sep).join('/') || '.',
        linked: linked.has(rp),
      });
    }
  }
  candidates.sort((a, b) => Number(a.linked) - Number(b.linked) || a.name.localeCompare(b.name));
  process.stdout.write(JSON.stringify({ hub: manifest0Name(), candidates }, null, 2));
  process.exit(0);
}

function manifest0Name() {
  const m = readJSON(manifestPath);
  return m?.project?.name || path.basename(cwd);
}

// summary -> SessionStart additionalContext
const manifest = readJSON(manifestPath) || {};
const t = todos();
const L = [];
L.push(`# CoolDesk project: ${manifest.project?.name || path.basename(cwd)}`);
if (manifest.project?.description) L.push(manifest.project.description);
L.push('');
L.push('This repo has a `.cooldesk/` workspace: shared, committed project knowledge that every AI and teammate reads from. Read and update `.cooldesk/` instead of keeping ad-hoc notes. Keep it team-shareable — no secrets, no personal window layouts (those live in the CoolDesk backend/user layer, not here).');
if (Array.isArray(manifest.resources) && manifest.resources.length) {
  L.push('');
  L.push('Resources: ' + manifest.resources.map((r) => `${r.type}${r.name ? `(${r.name})` : ''}`).join(', '));
}
if (t.open) {
  L.push('');
  L.push(`Open shared todos (${t.open}):`);
  for (const item of t.items.filter((x) => x.status !== 'done').slice(0, 8)) {
    L.push(`- [${item.status === 'in_progress' ? '~' : ' '}] ${item.title}`);
  }
}
L.push('');
L.push('Entry points: `.cooldesk/README.md`, `architecture.md`, `decisions.md`, `commands.json`, `services.json`. Maintain with /cd-sync, /cd-todo, /cd-decision.');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: L.join('\n') },
}));
process.exit(0);
