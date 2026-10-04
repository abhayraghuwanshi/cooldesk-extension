/**
 * `.cooldesk/` project knowledge for the /agent chat.
 *
 * The chat run can't read files itself (its only tools are WebSearch/WebFetch,
 * see aiAdapters.js) and runs in an app-owned folder rather than any project,
 * so a project's README, architecture notes, decisions and todos never reached
 * it — "what should I work on next in X?" got answered blind. Same fix as the
 * browsing snapshot in GlobalSpotlight.jsx: this code *can* read them (via the
 * sidecar's /cooldesk reader), so it does, and hands the result over as a
 * 'data' attachment.
 *
 * Detail is budgeted rather than dumped: workspaces the request is actually
 * about (the one it was started from, or any named in the question) get their
 * docs, todos and resources; every other `.cooldesk` project gets one summary
 * line, so the agent knows it exists and can ask or be asked about it.
 */
import { fetchCooldesk } from '../../services/cooldeskService';
import { projectFolderOf } from '../../shared/hooks/useCooldeskItems';

const FOCUS_MAX = 3;          // projects that get full detail
const DOC_CAP = 4_000;        // per README / architecture / decisions
const NOTE_CAP = 1_500;       // per note
const NOTES_MAX = 6;
const PROJECT_CAP = 14_000;   // everything for one focused project
const TOTAL_CAP = 40_000;     // the whole attachment
const FETCH_TIMEOUT_MS = 2_500;

const clip = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n)}\n…(truncated)` : t;
};

const isOpen = (t) => !['done', 'completed', 'closed', 'cancelled'].includes(String(t?.status || 'todo').toLowerCase());

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
}

/** Does the request mention this workspace by name (whole word, any case)? */
function mentions(request, name) {
  if (!name || name.length < 2) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(request || '');
}

function todoLine(t) {
  return `  - [${t.status || 'todo'}] ${t.title || t.text || t.id}${t.id ? `  (id: ${t.id})` : ''}`;
}

function describeFull(ws, cd) {
  const out = [];
  const p = cd.project || {};
  out.push(`## ${ws.name} — .cooldesk project "${p.name || ws.name}" at ${cd.path}`);
  if (p.description) out.push(`Description: ${p.description}`);
  if (p.status) out.push(`Status: ${p.status}`);

  const open = cd.todos.filter(isOpen);
  const done = cd.todos.length - open.length;
  if (cd.todos.length) {
    out.push(`\nTodos (${open.length} open, ${done} done):`);
    for (const t of open.slice(0, 40)) out.push(todoLine(t));
  }
  if (cd.readme) out.push(`\nREADME.md:\n${clip(cd.readme, DOC_CAP)}`);
  if (cd.architecture) out.push(`\narchitecture.md:\n${clip(cd.architecture, DOC_CAP)}`);
  if (cd.decisions) out.push(`\ndecisions.md:\n${clip(cd.decisions, DOC_CAP)}`);
  if (cd.resources.length) {
    out.push('\nShared resources (committed, the team sees these):');
    for (const r of cd.resources.slice(0, 40)) {
      out.push(`  - ${r.name || r.url || r.path}${r.url ? `: ${r.url}` : r.path ? `: ${r.path}` : ''}${r.type ? `  [${r.type}]` : ''}`);
    }
  }
  const personal = cd.localResources || [];
  if (personal.length) {
    out.push('\nPersonal resources (the user\'s own, in .cooldesk/local/ — not shared with the team):');
    for (const r of personal.slice(0, 40)) {
      out.push(`  - ${r.name || r.url || r.path}${r.url ? `: ${r.url}` : r.path ? `: ${r.path}` : ''}${r.source ? `  (from ${r.source})` : ''}`);
    }
  }
  if (cd.commands.length) {
    out.push('\nCommands:');
    for (const c of cd.commands.slice(0, 20)) out.push(`  - ${c.label || c.id}: ${c.run}`);
  }
  if (cd.services.length) {
    out.push('\nServices:');
    for (const s of cd.services.slice(0, 20)) out.push(`  - ${s.label || s.id}: ${s.url || `port ${s.port}`}`);
  }
  for (const n of cd.notes.slice(0, NOTES_MAX)) {
    out.push(`\nNote ${n.name}:\n${clip(n.content, NOTE_CAP)}`);
  }
  const linked = (cd.members || []).filter(m => m.path !== cd.path);
  if (linked.length) {
    out.push('\nLinked projects:');
    for (const m of linked) {
      const mo = (m.todos || []).filter(isOpen).length;
      out.push(`  - ${m.name || m.path} (${m.path})${m.project?.description ? ` — ${m.project.description}` : ''}${mo ? `, ${mo} open todo(s)` : ''}`);
    }
  }
  if (cd.hub?.path) out.push(`\nPart of the linked group whose hub is ${cd.hub.path}.`);
  return clip(out.join('\n'), PROJECT_CAP);
}

function describeBrief(ws, cd) {
  const p = cd.project || {};
  const open = cd.todos.filter(isOpen);
  const sample = open.slice(0, 3).map(t => t.title || t.text).filter(Boolean);
  return `- ${ws.name} (${cd.path})${p.description ? ` — ${p.description}` : ''}`
    + `${open.length ? `; ${open.length} open todo(s)${sample.length ? `: ${sample.join('; ')}` : ''}` : ''}`;
}

/**
 * @param {Array} workspaces       every workspace (as passed to buildPrompt)
 * @param {string} request         the user's message
 * @param {string[]} focusIds      workspace ids the run was started from / is about
 * @returns {Promise<{attachment: object, projects: string[]}|null>}
 *   A 'data' attachment for buildAttachments, plus the names of the projects
 *   sent in full (for the transcript); null if no workspace has a .cooldesk/.
 */
export async function buildCooldeskAttachment(workspaces, request, focusIds = []) {
  const candidates = (workspaces || [])
    .map(ws => ({ ws, root: projectFolderOf(ws) }))
    .filter(c => c.root);
  if (!candidates.length) return null;

  const loaded = await Promise.all(candidates.map(async (c) => {
    const cd = await withTimeout(fetchCooldesk(c.root).catch(() => null), FETCH_TIMEOUT_MS);
    return cd?.exists ? { ...c, cd } : null;
  }));
  const projects = loaded.filter(Boolean);
  if (!projects.length) return null;

  const focus = new Set(focusIds.filter(Boolean));
  const isFocus = (p) => focus.has(p.ws.id) || mentions(request, p.ws.name) || mentions(request, p.cd.project?.name);
  // Explicit focus first, then name mentions; capped so one question can't
  // pull in every project's docs.
  const full = [
    ...projects.filter(p => focus.has(p.ws.id)),
    ...projects.filter(p => !focus.has(p.ws.id) && isFocus(p)),
  ].slice(0, FOCUS_MAX);
  // With a single .cooldesk project there's no question which one is meant.
  if (!full.length && projects.length === 1) full.push(projects[0]);
  const rest = projects.filter(p => !full.includes(p));

  const sections = full.map(p => describeFull(p.ws, p.cd));
  if (rest.length) {
    sections.push(`${full.length ? 'Other workspaces' : 'Workspaces'} with a .cooldesk project (summary only — ask the user to name one for detail):\n${rest.map(p => describeBrief(p.ws, p.cd)).join('\n')}`);
  }

  return {
    attachment: {
      id: `ctx-cooldesk-${Date.now()}`,
      kind: 'data',
      name: 'Project knowledge (.cooldesk)',
      path: null,
      content: clip(sections.join('\n\n'), TOTAL_CAP),
      status: 'ready',
    },
    projects: full.map(p => p.cd.project?.name || p.ws.name),
  };
}
