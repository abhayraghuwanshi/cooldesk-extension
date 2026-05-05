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
  onCreateNew
}) {
  if (isLoading) {
    return (
      <div className="awm-suggestions">
        <div className="awm-suggestions-loading">
          <div className="awm-spinner" />
          <span>Analysing your workspace...</span>
          <p>Finding tabs, apps, and open projects to suggest smart groups</p>
        </div>
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="awm-suggestions">
        <div className="awm-suggestions-empty">
          <FontAwesomeIcon icon={faMagicWandSparkles} className="awm-empty-icon" />
          {error ? (
            <>
              <h4>AI unavailable</h4>
              <p className="awm-suggestions-error">{error}</p>
            </>
          ) : (
            <>
              <h4>Ready to analyse your workspace</h4>
              <p>Hit one of the prompts above or type your own — the agent will look at your open tabs, running apps, and editor projects to suggest workspaces.</p>
            </>
          )}
          <button className="awm-btn awm-btn-secondary" onClick={onCreateNew}>
            <FontAwesomeIcon icon={faPlus} />
            Create Manually
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
