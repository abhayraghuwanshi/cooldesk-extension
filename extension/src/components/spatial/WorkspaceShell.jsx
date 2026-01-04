import { faComments, faFolder, faHome, faStickyNote, faTh } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import '../../styles/spatial.css';
import { CoolSearch } from '../cooldesk/CoolSearch';

/**
 * WorkspaceShell - Spatial container for workspace faces (cube metaphor)
 *
 * Manages navigation between:
 * - Chat (far left) - AI context and conversation
 * - Workspace (left) - workspace details and management
 * - Overview (center) - main workspace grid
 * - Tabs (right) - tab management
 * - Notes (far right) - deep focus writing
 *
 * Navigation:
 * - Keyboard: Cmd/Ctrl + Arrow keys, Cmd/Ctrl + Number keys
 * - Mouse: Horizontal scroll with Shift
 * - Props: onFaceChange callback
 */
export function WorkspaceShell({ children, activeFace = 'overview', onFaceChange, onSearch }) {
  const [currentFace, setCurrentFace] = useState(activeFace);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Update when parent changes active face
  useEffect(() => {
    setCurrentFace(activeFace);
  }, [activeFace]);

  // Navigate to a specific face
  const navigateToFace = useCallback((face) => {
    if (face === currentFace || isTransitioning) return;

    setIsTransitioning(true);
    setCurrentFace(face);

    // Notify parent
    if (onFaceChange) {
      onFaceChange(face);
    }

    // Reset transition lock after animation completes
    setTimeout(() => {
      setIsTransitioning(false);
    }, 360); // Match CSS transition duration
  }, [currentFace, isTransitioning, onFaceChange]);

  // Keyboard navigation (supports both Ctrl for Windows and Cmd for Mac)
  useEffect(() => {
    const handleKeyboard = (e) => {
      // Check for modifier key (Ctrl on Windows/Linux, Cmd on Mac)
      const modifierPressed = e.ctrlKey || e.metaKey;

      // Arrow keys with modifier
      if (modifierPressed && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();

        switch (e.key) {
          case 'ArrowLeft':
            // Navigate left through faces: overview → workspace → chat
            if (currentFace === 'overview') navigateToFace('workspace');
            else if (currentFace === 'workspace') navigateToFace('chat');
            else if (currentFace === 'tabs') navigateToFace('overview');
            else if (currentFace === 'notes') navigateToFace('tabs');
            break;
          case 'ArrowRight':
            // Navigate right through faces: overview → tabs → notes
            if (currentFace === 'overview') navigateToFace('tabs');
            else if (currentFace === 'tabs') navigateToFace('notes');
            else if (currentFace === 'workspace') navigateToFace('overview');
            else if (currentFace === 'chat') navigateToFace('workspace');
            break;
          case 'ArrowDown':
            navigateToFace('overview');
            break;
          case 'ArrowUp':
            navigateToFace('overview');
            break;
          default:
            break;
        }
      }

      // Number keys with modifier (1-5 for direct navigation)
      if (modifierPressed && ['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        const faceMap = {
          '1': 'chat',
          '2': 'workspace',
          '3': 'overview',
          '4': 'tabs',
          '5': 'notes'
        };
        navigateToFace(faceMap[e.key]);
      }

      // Escape key (no modifier needed)
      if (e.key === 'Escape') {
        e.preventDefault();
        navigateToFace('overview');
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [navigateToFace, currentFace]);

  // Horizontal scroll navigation (with Shift key)
  useEffect(() => {
    let scrollTimeout;
    let scrollDelta = 0;

    const handleWheel = (e) => {
      // Only handle horizontal scroll or shift + vertical scroll
      if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;

      e.preventDefault();

      // Accumulate scroll delta
      scrollDelta += e.shiftKey ? e.deltaY : e.deltaX;

      // Clear previous timeout
      clearTimeout(scrollTimeout);

      // Debounce and trigger navigation
      scrollTimeout = setTimeout(() => {
        const threshold = 50;

        if (scrollDelta > threshold) {
          // Scroll right through faces
          if (currentFace === 'chat') navigateToFace('workspace');
          else if (currentFace === 'workspace') navigateToFace('overview');
          else if (currentFace === 'overview') navigateToFace('tabs');
          else if (currentFace === 'tabs') navigateToFace('notes');
        } else if (scrollDelta < -threshold) {
          // Scroll left through faces
          if (currentFace === 'notes') navigateToFace('tabs');
          else if (currentFace === 'tabs') navigateToFace('overview');
          else if (currentFace === 'overview') navigateToFace('workspace');
          else if (currentFace === 'workspace') navigateToFace('chat');
        }

        scrollDelta = 0;
      }, 100);
    };

    const container = document.querySelector('.workspace-shell');
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      clearTimeout(scrollTimeout);
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [navigateToFace, currentFace]);

  // Get transform for current face
  // Layout: [Chat | Workspace | Overview | Tabs | Notes] at 0%, 20%, 40%, 60%, 80%
  const getTransform = () => {
    switch (currentFace) {
      case 'chat':
        return 'translateX(0)'; // Show first face (Chat at 0%)
      case 'workspace':
        return 'translateX(-20%)'; // Show second face (Workspace at 20%)
      case 'overview':
        return 'translateX(-40%)'; // Show third face (Overview at 40%)
      case 'tabs':
        return 'translateX(-60%)'; // Show fourth face (Tabs at 60%)
      case 'notes':
        return 'translateX(-80%)'; // Show fifth face (Notes at 80%)
      default:
        return 'translateX(-40%)'; // Default to Overview
    }
  };

  return (
    <div className="workspace-shell">
      {/* Global Search Bar - Common to all faces */}
      <div style={{ padding: '0 24px 16px 24px', flexShrink: 0, zIndex: 101 }}>
        <CoolSearch onSearch={onSearch} />
      </div>

      {/* Face indicator dots */}
      <div className="face-indicator">
        <button
          className={`face-dot ${currentFace === 'chat' ? 'active' : ''}`}
          onClick={() => navigateToFace('chat')}
          title="Chat (Ctrl + 1)"
          aria-label="Navigate to chat"
        >
          <FontAwesomeIcon icon={faComments} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'workspace' ? 'active' : ''}`}
          onClick={() => navigateToFace('workspace')}
          title="Workspace (Ctrl + 2)"
          aria-label="Navigate to workspace"
        >
          <FontAwesomeIcon icon={faFolder} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'overview' ? 'active' : ''}`}
          onClick={() => navigateToFace('overview')}
          title="Overview (Ctrl + 3 or Esc)"
          aria-label="Navigate to overview"
        >
          <FontAwesomeIcon icon={faHome} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'tabs' ? 'active' : ''}`}
          onClick={() => navigateToFace('tabs')}
          title="Tabs (Ctrl + 4)"
          aria-label="Navigate to tabs"
        >
          <FontAwesomeIcon icon={faTh} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'notes' ? 'active' : ''}`}
          onClick={() => navigateToFace('notes')}
          title="Notes (Ctrl + 5)"
          aria-label="Navigate to notes"
        >
          <FontAwesomeIcon icon={faStickyNote} className="face-icon" />
        </button>
      </div>

      {/* Sliding container */}
      <div
        className={`workspace-faces ${isTransitioning ? 'transitioning' : ''}`}
        style={{ transform: getTransform() }}
      >
        {children}
      </div>

      {/* First-time hint (shows once) */}
      {currentFace === 'overview' && (
        <KeyboardHint />
      )}
    </div>
  );
}

/**
 * KeyboardHint - Shows once to teach navigation
 */
function KeyboardHint() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('cooldesk-spatial-hint-dismissed') === 'true'
  );

  const dismiss = () => {
    localStorage.setItem('cooldesk-spatial-hint-dismissed', 'true');
    setDismissed(true);
  };

  if (dismissed) return null;

  // Detect platform
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifierKey = isMac ? 'Cmd' : 'Ctrl';

  return (
    <div className="keyboard-hint" onClick={dismiss}>
      <div className="hint-content">
        <div className="hint-title">💡 Spatial Navigation</div>
        <div className="hint-shortcuts">
          <kbd>{modifierKey}</kbd> + <kbd>←/→</kbd> Navigate
          <span className="hint-separator">•</span>
          <kbd>{modifierKey}</kbd> + <kbd>1-5</kbd> Direct
          <span className="hint-separator">•</span>
          <kbd>Esc</kbd> Home
        </div>
        <div className="hint-dismiss">Click to dismiss</div>
      </div>
    </div>
  );
}

/**
 * Face - Individual workspace face component
 */
export function Face({ index, children, className = '' }) {
  return (
    <div className={`workspace-face ${className}`} data-face={index}>
      {children}
    </div>
  );
}
