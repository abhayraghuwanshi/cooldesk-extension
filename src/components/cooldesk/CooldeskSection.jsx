import { memo } from 'react';
import { collectCommands, collectDocs } from '../../services/cooldeskService.js';

function groupByProject(items) {
  const map = new Map();
  for (const it of items) {
    const k = it.project || '';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.entries()].map(([project, list]) => ({ project, list }));
}

// Working directory for a command: its project root, plus the command's own relative cwd.
function commandCwd(c) {
  if (!c.projectPath) return undefined;
  if (!c.cwd || c.cwd === '.') return c.projectPath;
  const base = c.projectPath.replace(/[\\/]+$/, '');
  const rel = String(c.cwd).replace(/[/\\]+/g, '\\').replace(/^\\+/, '');
  return `${base}\\${rel}`;
}

function runCommand(c) {
  if (!c.run || !window.electronAPI?.runCommand) return;
  window.electronAPI.runCommand(c.run, commandCwd(c));
}

/**
 * Compact identity header for a workspace's committed `.cooldesk/` project — name,
 * status, git head, resources, run commands, and shared docs. Presentational: the
 * parent panel owns the fetch and feeds it `cooldesk`. Shared todos and README are
 * surfaced elsewhere in the panel (Next Up list + notes editor). Renders nothing
 * without `.cooldesk/`.
 */
export const CooldeskSection = memo(function CooldeskSection({ cooldesk }) {
  if (!cooldesk) return null;

  const branch = cooldesk.auto?.git?.branch;
  const head = cooldesk.auto?.git?.head;
  const group = cooldesk.group;
  const members = cooldesk.members || [];
  const isGroup = !!group && members.length > 1;
  const commands = collectCommands(cooldesk);
  const docs = collectDocs(cooldesk);

  return (
    <section className="wcp-section cdk-section">
      <header className="wcp-section-head" data-accent="cooldesk">
        <span className="wcp-section-bar" aria-hidden="true" />
        <h4 className="wcp-section-title">{isGroup ? 'Group · .cooldesk' : 'Project · .cooldesk'}</h4>
        <span className="cdk-badge" title="Committed, team-shared project knowledge">shared</span>
      </header>

      <div className="cdk-ident">
        <span className="cdk-name">{cooldesk.project?.name || 'Project'}</span>
        {cooldesk.project?.status && (
          <span className={`cdk-status cdk-status-${cooldesk.project.status}`}>{cooldesk.project.status}</span>
        )}
        {branch && (
          <span className="cdk-git" title={head ? `${branch} @ ${head}` : branch}>
            {branch}{head ? ` · ${head}` : ''}
          </span>
        )}
      </div>

      {cooldesk.project?.description && <p className="cdk-desc">{cooldesk.project.description}</p>}

      {commands.length > 0 && (
        <div className="cdk-sub">
          <div className="cdk-sub-head">Commands</div>
          {groupByProject(commands).map(g => (
            <div key={g.project} className="cdk-cmd-group">
              {isGroup && <span className="cdk-cmd-group-name">{g.project}</span>}
              <div className="cdk-cmd-pills">
                {g.list.map((c, i) => (
                  <button
                    key={`${c.id || c.label}:${i}`}
                    type="button"
                    className="cdk-cmd-pill"
                    title={`Run: ${c.run}`}
                    onClick={(e) => { e.stopPropagation(); runCommand(c); }}
                  >
                    <span className="cdk-cmd-play" aria-hidden="true">▷</span>
                    {c.label || c.id}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="cdk-sub">
          <div className="cdk-sub-head">Docs</div>
          <div className="cdk-chips">
            {docs.map((d, i) => (
              <span key={`${d.project}:${d.kind}:${d.file}:${i}`} className="cdk-chip" title={`${d.kind}${isGroup ? ` · ${d.project}` : ''}`}>
                <span className="cdk-chip-type">{d.kind}</span> {d.file}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
});
