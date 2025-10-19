import { faChevronDown, faEye } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { applyViewMode, getCurrentViewMode, getViewModesList } from '../../config/viewModes';
import './ViewModeSelector.css';

export function ViewModeSelector() {
  const [currentMode, setCurrentMode] = useState(() => getCurrentViewMode());
  const [isOpen, setIsOpen] = useState(false);
  const viewModes = getViewModesList();
  const activeMode = viewModes.find(m => m.id === currentMode) || viewModes[0];

  // Listen for view mode changes from other sources
  useEffect(() => {
    const handleViewModeChange = (event) => {
      setCurrentMode(event.detail.modeId);
    };

    window.addEventListener('viewModeChanged', handleViewModeChange);
    return () => window.removeEventListener('viewModeChanged', handleViewModeChange);
  }, []);

  const handleModeChange = (modeId) => {
    applyViewMode(modeId);
    setCurrentMode(modeId);
    setIsOpen(false);
  };

  return (
    <div className="view-mode-selector">
      <button
        className="view-mode-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Change View Mode"
      >
        <span className="mode-icon">{activeMode.icon}</span>
        <span className="mode-label">{activeMode.label}</span>
        <FontAwesomeIcon 
          icon={faChevronDown} 
          className={`chevron ${isOpen ? 'open' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="view-mode-backdrop" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="view-mode-dropdown">
            <div className="dropdown-header">
              <FontAwesomeIcon icon={faEye} />
              <span>View Modes</span>
            </div>
            
            {viewModes.map(mode => (
              <button
                key={mode.id}
                className={`view-mode-option ${currentMode === mode.id ? 'active' : ''}`}
                onClick={() => handleModeChange(mode.id)}
              >
                <span className="option-icon">{mode.icon}</span>
                <div className="option-content">
                  <div className="option-label">{mode.label}</div>
                  <div className="option-description">{mode.description}</div>
                </div>
                {currentMode === mode.id && (
                  <span className="option-checkmark">✓</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ViewModeSelector;
