import { faMagicWandSparkles, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useRef } from 'react';

const EXAMPLE_PROMPTS = [
  'Group by project',
  'Separate work from personal',
  'Focus on React development',
  'Find research tabs'
];

export default function AIPromptBar({
  value,
  onChange,
  onSubmit,
  isLoading
}) {
  const inputRef = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(value);
    }
  }, [onSubmit, value]);

  const handleExampleClick = useCallback((example) => {
    onChange(example);
    inputRef.current?.focus();
  }, [onChange]);

  return (
    <div className="awm-prompt-bar">
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
          placeholder="Describe how to organize your tabs... (e.g., 'Group by project')"
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

      <div className="awm-prompt-examples">
        <span>Try:</span>
        {EXAMPLE_PROMPTS.map((example, idx) => (
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
