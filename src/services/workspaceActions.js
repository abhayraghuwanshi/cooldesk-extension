/**
 * Apply a validated action list to the workspace store.
 *
 * This is the only place an AI CLI's output reaches persistent state, so it is
 * a whitelist, not a dispatcher: an action whose type isn't listed is dropped,
 * and every field is re-read from the action rather than spread in. An agent
 * that read a prompt-injected web page can put anything in this list, and the
 * confirm step in the UI is only as good as the summary it shows — so what
 * gets summarised and what gets applied must come from the same validation.
 */

import { deleteWorkspace, saveWorkspace } from '../db/unified-api';
import { updateCooldeskResources } from './cooldeskService';
import { projectFolderOf } from '../shared/hooks/useCooldeskItems';

const TYPES = new Set([
  'create_workspace',
  'rename_workspace',
  'add_url',
  'remove_url',
  'add_app',
  'remove_app',
  'add_project_resource',
  'remove_project_resource',
]);

// Mirrors the sidecar's check (cooldesk.rs `is_machine_specific`): absolute,
// home-relative and file: locations can't go in a committed manifest. Checked
// here too so the confirm step rejects it up front instead of failing on Apply.
const isMachineSpecific = (v) => /^(file:|[\\/~]|[a-z]:)/i.test(v);

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Drop anything malformed and normalise the rest. Returns
 * `{ valid, rejected }` so the UI can show both — silently discarding half an
 * agent's plan and applying the other half is worse than saying so.
 */
export function validateActions(actions) {
  const valid = [];
  const rejected = [];

  for (const raw of Array.isArray(actions) ? actions : []) {
    const type = str(raw?.type);
    if (!TYPES.has(type)) {
      rejected.push({ action: raw, reason: `unknown action "${type || '?'}"` });
      continue;
    }

    const a = { type };
    let bad = null;

    switch (type) {
      case 'create_workspace':
        a.name = str(raw.name);
        if (!a.name) bad = 'missing name';
        break;
      case 'rename_workspace':
        a.from = str(raw.from);
        a.to = str(raw.to);
        if (!a.from || !a.to) bad = 'missing from/to';
        break;
      case 'add_url':
        a.workspace = str(raw.workspace);
        a.url = str(raw.url);
        a.title = str(raw.title) || a.url;
        if (!a.workspace || !a.url) bad = 'missing workspace/url';
        // Only web links. A file:// or javascript: url here would become a
        // clickable chip that the card opens with the OS handler.
        else if (!/^https?:\/\//i.test(a.url)) bad = 'url must be http(s)';
        break;
      case 'remove_url':
        a.workspace = str(raw.workspace);
        a.url = str(raw.url);
        if (!a.workspace || !a.url) bad = 'missing workspace/url';
        break;
      case 'add_app':
        a.workspace = str(raw.workspace);
        a.path = str(raw.path);
        a.name = str(raw.name) || a.path.split(/[\\/]/).pop();
        a.appType = ['folder', 'file'].includes(str(raw.appType)) ? str(raw.appType) : undefined;
        if (!a.workspace || !a.path) bad = 'missing workspace/path';
        break;
      case 'remove_app':
        a.workspace = str(raw.workspace);
        a.path = str(raw.path);
        if (!a.workspace || !a.path) bad = 'missing workspace/path';
        break;
      // Project (.cooldesk) resources. "local" is personal and gitignored —
      // the default, and the only place browsing-derived links or local file
      // paths may go; "shared" is committed to the repo for teammates.
      case 'add_project_resource':
      case 'remove_project_resource': {
        a.workspace = str(raw.workspace);
        a.scope = str(raw.scope) === 'shared' ? 'shared' : 'local';
        a.url = str(raw.url) || undefined;
        a.path = str(raw.path) || undefined;
        if (!a.workspace || (!a.url && !a.path)) { bad = 'missing workspace and url/path'; break; }
        if (type === 'remove_project_resource') break;
        a.name = str(raw.name) || a.url || a.path.split(/[\\/]/).pop();
        a.resourceType = ['link', 'file', 'folder', 'github', 'doc'].includes(str(raw.resourceType || raw.kind))
          ? str(raw.resourceType || raw.kind)
          : (a.url && !/^file:/i.test(a.url) ? 'link' : 'file');
        if (a.url && !/^https?:\/\//i.test(a.url) && !(a.scope === 'local' && /^file:/i.test(a.url))) bad = 'url must be http(s)';
        else if (a.scope === 'shared' && [a.url, a.path].some(v => v && isMachineSpecific(v))) bad = 'a local path can only be saved as personal (scope "local")';
        else if (a.scope === 'shared' && a.path && a.path.split(/[\\/]/).includes('..')) bad = 'shared paths must stay inside the project';
        break;
      }
      default:
        bad = 'unhandled';
    }

    // The agent's one-line reason, shown on the card next to the action.
    const why = str(raw?.why).slice(0, 140);
    if (why) a.why = why;

    if (bad) rejected.push({ action: raw, reason: bad });
    else valid.push(a);
  }

  return { valid, rejected };
}

/** One-line human summary, used by the confirm step. */
export function describeAction(a) {
  switch (a.type) {
    case 'create_workspace': return `Create workspace "${a.name}"`;
    case 'rename_workspace': return `Rename "${a.from}" → "${a.to}"`;
    case 'add_url': return `Add link ${a.url} to "${a.workspace}"`;
    case 'remove_url': return `Remove link ${a.url} from "${a.workspace}"`;
    case 'add_app': return `Add ${a.appType || 'app'} ${a.path} to "${a.workspace}"`;
    case 'remove_app': return `Remove ${a.path} from "${a.workspace}"`;
    case 'add_project_resource':
      return `Save ${a.url || a.path} to "${a.workspace}" project — ${a.scope === 'shared' ? 'shared with team (committed)' : 'personal (not committed)'}`;
    case 'remove_project_resource':
      return `Remove ${a.url || a.path} from "${a.workspace}" project (${a.scope === 'shared' ? 'shared' : 'personal'})`;
    default: return a.type;
  }
}

/**
 * Apply actions in order against a live list of workspaces.
 *
 * Sequential on purpose: actions reference workspaces by *name*, and a list can
 * create a workspace and then fill it. Running these concurrently would race
 * the create against the adds, and saving two mutations of the same record in
 * parallel would lose one.
 *
 * @param actions  already through validateActions
 * @param workspaces  current records
 * @returns {{applied: number, errors: string[]}}
 */
export async function applyActions(actions, workspaces) {
  // Work on a local copy keyed by name so later actions see earlier ones.
  const byName = new Map((workspaces || []).map(w => [w.name, { ...w }]));
  const errors = [];
  let applied = 0;
  // Per action: did it end up in effect? "Already there" counts — the user
  // still wanted it — but a failure doesn't, so it isn't learned as kept.
  const ok = [];

  const need = (name) => {
    const w = byName.get(name);
    if (!w) errors.push(`No workspace named "${name}"`);
    return w;
  };

  for (const a of actions) {
    const errorsBefore = errors.length;
    try {
      switch (a.type) {
        case 'create_workspace': {
          if (byName.has(a.name)) { errors.push(`"${a.name}" already exists`); break; }
          const created = { id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: a.name, icon: 'folder', urls: [], apps: [], createdAt: Date.now(), updatedAt: Date.now() };
          await saveWorkspace(created);
          byName.set(a.name, created);
          applied++;
          break;
        }
        case 'rename_workspace': {
          const w = need(a.from);
          if (!w) break;
          if (byName.has(a.to)) { errors.push(`"${a.to}" already exists`); break; }
          const next = { ...w, name: a.to, updatedAt: Date.now() };
          await saveWorkspace(next);
          byName.delete(a.from);
          byName.set(a.to, next);
          applied++;
          break;
        }
        case 'add_url': {
          const w = need(a.workspace);
          if (!w) break;
          if ((w.urls || []).some(u => u.url === a.url)) break; // already there
          w.urls = [...(w.urls || []), { url: a.url, title: a.title, addedAt: Date.now() }];
          w.updatedAt = Date.now();
          await saveWorkspace(w);
          applied++;
          break;
        }
        case 'remove_url': {
          const w = need(a.workspace);
          if (!w) break;
          w.urls = (w.urls || []).filter(u => u.url !== a.url);
          w.updatedAt = Date.now();
          await saveWorkspace(w);
          applied++;
          break;
        }
        case 'add_app': {
          const w = need(a.workspace);
          if (!w) break;
          const p = a.path.toLowerCase();
          if ((w.apps || []).some(x => (x.path || '').toLowerCase() === p)) break;
          w.apps = [...(w.apps || []), { name: a.name, path: a.path, icon: null, ...(a.appType ? { appType: a.appType } : {}) }];
          w.updatedAt = Date.now();
          await saveWorkspace(w);
          applied++;
          break;
        }
        case 'remove_app': {
          const w = need(a.workspace);
          if (!w) break;
          const p = a.path.toLowerCase();
          w.apps = (w.apps || []).filter(x => (x.path || '').toLowerCase() !== p);
          w.updatedAt = Date.now();
          await saveWorkspace(w);
          applied++;
          break;
        }
        case 'add_project_resource':
        case 'remove_project_resource': {
          const w = need(a.workspace);
          if (!w) break;
          const root = projectFolderOf(w);
          if (!root) { errors.push(`"${a.workspace}" has no project folder`); break; }
          const adding = a.type === 'add_project_resource';
          const res = await updateCooldeskResources(root, {
            scope: a.scope,
            add: adding ? [{ type: a.resourceType, name: a.name, url: a.url, path: a.path, source: 'agent' }] : [],
            remove: adding ? [] : [a.url || a.path],
          });
          if (!res.ok) { errors.push(`${describeAction(a)}: ${res.error}`); break; }
          applied++;
          break;
        }
        default:
          break;
      }
    } catch (e) {
      errors.push(`${describeAction(a)}: ${e.message || e}`);
    }
    ok.push(errors.length === errorsBefore);
  }

  return { applied, errors, ok };
}

// Re-exported so callers don't need a second import for the rare delete path.
export { deleteWorkspace };
