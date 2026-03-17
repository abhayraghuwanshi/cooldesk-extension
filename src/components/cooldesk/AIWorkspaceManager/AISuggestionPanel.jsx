import {
  faFolder,
  faGlobe,
  faLayerGroup,
  faMagicWandSparkles,
  faPlus,
  faTimes
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
          <span>Analyzing your tabs...</span>
          <p>AI is finding patterns to suggest workspace groups</p>
        </div>
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="awm-suggestions">
        <div className="awm-suggestions-empty">
          <FontAwesomeIcon icon={faMagicWandSparkles} className="awm-empty-icon" />
          <h4>No AI Suggestions Yet</h4>
          {error ? (
            <p className="awm-suggestions-error">{error}</p>
          ) : (
            <p>Type a prompt above and click send, or open more tabs to get workspace suggestions</p>
          )}
          <button className="awm-btn awm-btn-secondary" onClick={onCreateNew}>
            <FontAwesomeIcon icon={faPlus} />
            Create Workspace Manually
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
        {suggestions.map((group, idx) => (
          <div key={idx} className="awm-suggestion-card">
            <div className="awm-suggestion-icon">
              <FontAwesomeIcon icon={faFolder} />
            </div>
            <div className="awm-suggestion-content">
              <h4>{group.name}</h4>
              {group.description && (
                <p className="awm-suggestion-desc">{group.description}</p>
              )}
              <div className="awm-suggestion-meta">
                {group.items?.length > 0 && (
                  <span className="awm-suggestion-tabs">{group.items.length} tabs</span>
                )}
                {group.suggestedUrls?.length > 0 && (
                  <span className="awm-suggestion-urls-count">+{group.suggestedUrls.length} suggested</span>
                )}
              </div>
              {/* Show suggested URLs prominently */}
              {group.suggestedUrls?.length > 0 && (
                <div className="awm-suggested-urls-grid">
                  {group.suggestedUrls.slice(0, 4).map((su, i) => (
                    <div key={i} className="awm-suggested-url-chip" title={su.reason}>
                      <FontAwesomeIcon icon={faGlobe} />
                      <span>{su.title || su.url}</span>
                    </div>
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
                Create
              </button>
            </div>
          </div>
        ))}
      </div>

      {suggestions[0]?.suggestions?.length > 0 && (
        <div className="awm-suggestions-tips">
          <strong>Tip:</strong> {suggestions[0].suggestions[0]}
        </div>
      )}
    </div>
  );
}
