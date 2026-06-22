import {
  faDesktop,
  faFolder,
  faFolderOpen,
  faGlobe,
  faLayerGroup,
  faMagicWandSparkles,
  faPlus,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

export default function AISuggestionPanel({
  suggestions = [],
  isLoading,
  error,
  onAccept,
  onCreateNew,
  composer
}) {
  if (isLoading) {
    return (
      <div className="awm-suggestions">
        <div className="awm-hero">
          <div className="awm-hero-orb is-loading">
            <FontAwesomeIcon icon={faMagicWandSparkles} />
          </div>
          <h3 className="awm-hero-title">Reading your workspace…</h3>
          <p className="awm-hero-sub">Scanning open tabs, running apps and editor projects to suggest smart groups.</p>
          <div className="awm-hero-bar"><span /></div>
        </div>
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="awm-suggestions">
        <div className="awm-hero">
          <span className={`awm-hero-kicker ${error ? 'is-error' : ''}`}>
            <FontAwesomeIcon icon={faMagicWandSparkles} />
            {error ? 'AI unavailable' : 'AI Organizer'}
          </span>

          {error ? (
            <>
              <h3 className="awm-hero-title">Something went sideways</h3>
              <p className="awm-hero-sub awm-hero-error">{error}</p>
            </>
          ) : (
            <>
              <h3 className="awm-hero-title">What should we organize?</h3>
              <p className="awm-hero-sub">
                Tell the agent how to group things. It scans your tabs, apps and
                projects, then suggests workspaces you can fine-tune.
              </p>
            </>
          )}

          {/* Gemini-style centered composer lives right here in the empty state */}
          {composer}

          <button className="awm-hero-ghost" onClick={onCreateNew}>
            <FontAwesomeIcon icon={faPlus} />
            {error ? 'Create a workspace manually' : 'or build one manually'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="awm-suggestions">
      <div className="awm-suggestions-header">
        <FontAwesomeIcon icon={faLayerGroup} />
        <span>AI Suggested Workspaces</span>
        <span className="awm-suggestions-count">{suggestions.length} groups</span>
      </div>

      <div className="awm-suggestions-grid">
        {suggestions.map((group, idx) => {
          const tabCount    = (group.items || []).length;
          const urlCount    = (group.suggestedUrls || []).length;
          const appCount    = (group.apps || []).length;
          const folderCount = (group.folders || []).length;

          return (
            <div key={idx} className="awm-suggestion-card">
              <div className="awm-suggestion-icon">
                <FontAwesomeIcon icon={faFolder} />
              </div>

              <div className="awm-suggestion-content">
                <h4>{group.name}</h4>
                {group.description && (
                  <p className="awm-suggestion-desc">{group.description}</p>
                )}

                {/* Summary badges */}
                <div className="awm-suggestion-meta">
                  {tabCount > 0 && (
                    <span className="awm-suggestion-badge awm-badge-tab">
                      <FontAwesomeIcon icon={faGlobe} /> {tabCount} tab{tabCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {urlCount > 0 && (
                    <span className="awm-suggestion-badge awm-badge-url">
                      +{urlCount} link{urlCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {appCount > 0 && (
                    <span className="awm-suggestion-badge awm-badge-app">
                      <FontAwesomeIcon icon={faDesktop} /> {appCount} app{appCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {folderCount > 0 && (
                    <span className="awm-suggestion-badge awm-badge-folder">
                      <FontAwesomeIcon icon={faFolderOpen} /> {folderCount} project{folderCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* URL chips */}
                {group.suggestedUrls?.length > 0 && (
                  <div className="awm-suggestion-chips">
                    {group.suggestedUrls.slice(0, 3).map((su, i) => (
                      <span key={i} className="awm-chip awm-chip-url" title={su.reason}>
                        <FontAwesomeIcon icon={faGlobe} />
                        {su.title || su.url}
                      </span>
                    ))}
                  </div>
                )}

                {/* App chips */}
                {group.apps?.length > 0 && (
                  <div className="awm-suggestion-chips">
                    {group.apps.slice(0, 4).map((appName, i) => (
                      <span key={i} className="awm-chip awm-chip-app">
                        <FontAwesomeIcon icon={faDesktop} />
                        {appName}
                      </span>
                    ))}
                  </div>
                )}

                {/* Folder/project chips */}
                {group.folders?.length > 0 && (
                  <div className="awm-suggestion-chips">
                    {group.folders.map((f, i) => (
                      <span key={i} className="awm-chip awm-chip-folder">
                        <FontAwesomeIcon icon={faFolderOpen} />
                        {f.name}
                        {f.editor && <em> ({f.editor})</em>}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="awm-suggestion-actions">
                <button
                  className="awm-btn awm-btn-primary awm-btn-sm"
                  onClick={() => onAccept(group)}
                >
                  <FontAwesomeIcon icon={faPlus} />
                  Use
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {suggestions[0]?.suggestions?.length > 0 && (
        <div className="awm-suggestions-tips">
          <strong>Tip:</strong> {suggestions[0].suggestions[0]}
        </div>
      )}
    </div>
  );
}
