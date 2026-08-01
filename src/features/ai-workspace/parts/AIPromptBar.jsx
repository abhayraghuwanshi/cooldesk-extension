import { faMagicWandSparkles, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useRef } from 'react';

const SUGGESTION_PROMPTS = [
  'Group by project',
  'Separate work from personal',
  'Focus on React development',
  'Find research tabs'
];

const WORKSPACE_PROMPTS = [
  'Find related URLs',
  'Suggest similar sites',
  'Discover related tools',
  'Recommend resources'
];

export default function AIPromptBar({
  value,
  onChange,
  onSubmit,
  isLoading,
  mode = 'suggestions',
  workspaceName = '',
  variant = 'bar'
}) {
  const inputRef = useRef(null);

  const isWorkspaceMode = mode === 'edit' || mode === 'create';
  const examples = isWorkspaceMode ? WORKSPACE_PROMPTS : SUGGESTION_PROMPTS;
  const placeholder = isWorkspaceMode
    ? workspaceName
      ? `Ask AI to find URLs for "${workspaceName}"...`
      : 'Ask AI to find related URLs for this workspace...'
    : "Describe how to organize your tabs... (e.g., 'Group by project')";

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(value);
    }
  }, [onSubmit, value]);

  const handleExampleClick = useCallback((example) => {
    onChange(example);
    onSubmit(example);
  }, [onChange, onSubmit]);

  // ── Inline variant — compact composer embedded inside the editor ───────────
  if (variant === 'inline') {
    return (
      <div className="awm-inline-composer">
        <div className="awm-inline-composer-box">
          <FontAwesomeIcon
            icon={faMagicWandSparkles}
            className={`awm-inline-composer-icon ${isLoading ? 'spinning' : ''}`}
          />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
          />
          <button
            className="awm-inline-composer-send"
            onClick={() => onSubmit(value)}
            disabled={isLoading || !value.trim()}
          >
            {isLoading ? <div className="awm-spinner-sm" /> : <FontAwesomeIcon icon={faPaperPlane} />}
          </button>
        </div>
        <div className="awm-inline-composer-chips">
          {examples.map((example, idx) => (
            <button
              key={idx}
              className="awm-prompt-example"
              onClick={() => handleExampleClick(example)}
              disabled={isLoading}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Hero variant — large centered, Gemini-style composer ───────────────────
  if (variant === 'hero') {
    return (
      <div className="awm-hero-composer">
        <div className="awm-hero-composer-box">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
          />
          <div className="awm-hero-composer-actions">
            {isLoading ? (
              <span className="awm-hero-thinking">
                <div className="awm-spinner-sm" /> Thinking…
              </span>
            ) : value.trim() ? (
              <kbd className="awm-hero-kbd">↵&nbsp;Enter</kbd>
            ) : null}
          </div>
        </div>

        <div className="awm-hero-chips">
          {examples.map((example, idx) => (
            <button
              key={idx}
              className="awm-prompt-example"
              onClick={() => handleExampleClick(example)}
              disabled={isLoading}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="awm-prompt-bar">
      <div className="awm-prompt-examples">
        <span>Try:</span>
        {examples.map((example, idx) => (
          <button
            key={idx}
            className="awm-prompt-example"
            onClick={() => handleExampleClick(example)}
            disabled={isLoading}
          >
            {example}
          </button>
        ))}
      </div>

      <div className="awm-prompt-input-wrapper">
        <FontAwesomeIcon
          icon={faMagicWandSparkles}
          className={`awm-prompt-icon ${isLoading ? 'spinning' : ''}`}
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading}
        />
        <button
          className="awm-prompt-submit"
          onClick={() => onSubmit(value)}
          disabled={isLoading || !value.trim()}
        >
          {isLoading ? (
            <div className="awm-spinner-sm" />
          ) : (
            <FontAwesomeIcon icon={faPaperPlane} />
          )}
        </button>
      </div>
    </div>
  );
}
