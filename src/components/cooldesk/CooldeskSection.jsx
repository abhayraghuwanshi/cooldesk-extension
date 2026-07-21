import { memo } from 'react';

/**
 * Compact identity header for a workspace's committed `.cooldesk/` project — name,
 * status, git head, and resource chips. Presentational: the parent panel owns the
 * fetch and feeds it `cooldesk`. Shared todos and README are surfaced elsewhere in the
 * panel (Next Up list + notes editor), not here. Renders nothing without `.cooldesk/`.
 */
export const CooldeskSection = memo(function CooldeskSection({ cooldesk }) {
  if (!cooldesk) return null;

  const branch = cooldesk.auto?.git?.branch;
  const head = cooldesk.auto?.git?.head;

  return (
    <section className="wcp-section cdk-section">
      <header className="wcp-section-head" data-accent="cooldesk">
        <span className="wcp-section-bar" aria-hidden="true" />
        <h4 className="wcp-section-title">Project · .cooldesk</h4>
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

      {cooldesk.resources.length > 0 && (
        <div className="cdk-chips">
          {cooldesk.resources.map((r, i) => (
            <span key={i} className="cdk-chip" title={r.url || r.path || r.type}>
              <span className="cdk-chip-type">{r.type}</span>{r.name ? ` ${r.name}` : ''}
            </span>
          ))}
        </div>
      )}
    </section>
  );
});
