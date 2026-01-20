import { faComments, faDesktop, faFolder, faHome, faStickyNote, faTh, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { teamManager } from '../../services/p2p/teamManager';
import '../../styles/spatial.css';

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * WorkspaceShell - Spatial container for workspace faces (cube metaphor)
 *
 * Manages navigation between:
 * - Chat (far left) - AI context and conversation
 * - Workspace (left) - workspace details and management
 * - Overview (center) - main workspace grid
 * - Tabs (right) - tab management
 * - Team (further right) - P2P shared items
 * - Notes (far right) - deep focus writing
 * - Apps (farthest right) - Computer integration
 */
export function WorkspaceShell({ children, activeFace = 'overview', onFaceChange, onSearch }) {
  const [currentFace, setCurrentFace] = useState(() => {
    // Try to recover state from localStorage
    const savedFace = localStorage.getItem('cooldesk-active-face');
    return savedFace || activeFace;
  });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activeTeam, setActiveTeam] = useState(null);
  const [hoveredFace, setHoveredFace] = useState(null);
  const [activeTabTitle, setActiveTabTitle] = useState('');
  const transitionTimeoutRef = useRef(null);

  // Track active browser tab title
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      // Initial fetch
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) setActiveTabTitle(tabs[0].title);
      });

      // Listen for updates (URL/Title changes)
      const handleTabUpdate = (tabId, changeInfo, tab) => {
        if (tab.active && changeInfo.title) {
          setActiveTabTitle(changeInfo.title);
        }
      };

      // Listen for tab switching
      const handleTabActivated = (activeInfo) => {
        chrome.tabs.get(activeInfo.tabId, (tab) => {
          if (tab) setActiveTabTitle(tab.title);
        });
      };

      chrome.tabs.onUpdated.addListener(handleTabUpdate);
      chrome.tabs.onActivated.addListener(handleTabActivated);

      return () => {
        chrome.tabs.onUpdated.removeListener(handleTabUpdate);
        chrome.tabs.onActivated.removeListener(handleTabActivated);
      };
    }
  }, []);

  // Debounced localStorage save
  const debouncedSave = useMemo(
    () =>
      debounce((face) => {
        localStorage.setItem('cooldesk-active-face', face);
      }, 300),
    []
  );

  // Load active team on mount
  useEffect(() => {
    teamManager.init().then(() => {
      const team = teamManager.getTeam(teamManager.activeTeamId);
      if (team) setActiveTeam(team);
    });

    return teamManager.subscribe(({ activeTeamId, teams }) => {
      const team = teams.find(t => t.id === activeTeamId);
      setActiveTeam(team || null);
    });
  }, []);

  // Persist state to localStorage (debounced)
  useEffect(() => {
    debouncedSave(currentFace);
  }, [currentFace, debouncedSave]);

  // Update when parent changes active face
  useEffect(() => {
    if (activeFace && activeFace !== 'overview') {
      setCurrentFace(activeFace);
    }
  }, [activeFace]);

  // Navigate to a specific face (memoized)
  const navigateToFace = useCallback((face) => {
    if (face === currentFace || isTransitioning) return;

    setIsTransitioning(true);
    setCurrentFace(face);

    // Notify parent
    if (onFaceChange) {
      onFaceChange(face);
    }

    // Reset transition lock after animation completes (reduced to 200ms)
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    transitionTimeoutRef.current = setTimeout(() => {
      setIsTransitioning(false);
    }, 200);
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
            // Navigate left through faces
            if (currentFace === 'workspace') navigateToFace('chat');
            else if (currentFace === 'overview') navigateToFace('workspace');
            else if (currentFace === 'tabs') navigateToFace('overview');
            else if (currentFace === 'team') navigateToFace('tabs');
            else if (currentFace === 'notes') navigateToFace('team');
            else if (currentFace === 'apps') navigateToFace('notes');
            break;
          case 'ArrowRight':
            // Navigate right through faces
            if (currentFace === 'chat') navigateToFace('workspace');
            else if (currentFace === 'workspace') navigateToFace('overview');
            else if (currentFace === 'overview') navigateToFace('tabs');
            else if (currentFace === 'tabs') navigateToFace('team');
            else if (currentFace === 'team') navigateToFace('notes');
            else if (currentFace === 'notes') navigateToFace('apps');
            break;
          case 'ArrowDown':
          case 'ArrowUp':
            navigateToFace('overview');
            break;
          default:
            break;
        }
      }

      // Number keys with modifier (1-7 for direct navigation)
      if (modifierPressed && ['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) {
        e.preventDefault();
        const faceMap = {
          '1': 'chat',
          '2': 'workspace',
          '3': 'overview',
          '4': 'tabs',
          '5': 'team',
          '6': 'notes',
          '7': 'apps'
        };
        navigateToFace(faceMap[e.key]);
      }

      // Escape key
      if (e.key === 'Escape') {
        e.preventDefault();
        navigateToFace('overview');
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [navigateToFace, currentFace]);

  // Horizontal scroll navigation
  useEffect(() => {
    let scrollTimeout;
    let scrollDelta = 0;

    const handleWheel = (e) => {
      if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;

      e.preventDefault();
      scrollDelta += e.shiftKey ? e.deltaY : e.deltaX;
      clearTimeout(scrollTimeout);

      scrollTimeout = setTimeout(() => {
        const threshold = 50;

        if (scrollDelta > threshold) {
          // Scroll right
          if (currentFace === 'chat') navigateToFace('workspace');
          else if (currentFace === 'workspace') navigateToFace('overview');
          else if (currentFace === 'overview') navigateToFace('tabs');
          else if (currentFace === 'tabs') navigateToFace('team');
          else if (currentFace === 'team') navigateToFace('notes');
          else if (currentFace === 'notes') navigateToFace('apps');
        } else if (scrollDelta < -threshold) {
          // Scroll left
          if (currentFace === 'apps') navigateToFace('notes');
          else if (currentFace === 'notes') navigateToFace('team');
          else if (currentFace === 'team') navigateToFace('tabs');
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

  // Memoized transform calculation
  const transform = useMemo(() => {
    // 100% / 7 faces = 14.285714%
    const transforms = {
      'chat': 'translateX(0)',
      'workspace': 'translateX(-14.285714%)',
      'overview': 'translateX(-28.571428%)',
      'tabs': 'translateX(-42.857142%)',
      'team': 'translateX(-57.142857%)',
      'notes': 'translateX(-71.428571%)',
      'apps': 'translateX(-85.714285%)'
    };
    return transforms[currentFace] || transforms.overview;
  }, [currentFace]);

  return (
    <div className="workspace-shell">
      {/* Face indicator dots */}
      <div
        className="face-indicator"
        data-face={currentFace}
        onMouseLeave={() => setHoveredFace(null)}
      >
        <div className="face-label">
          {hoveredFace
            ? hoveredFace.charAt(0).toUpperCase() + hoveredFace.slice(1)
            : (activeTabTitle || currentFace.charAt(0).toUpperCase() + currentFace.slice(1))}
        </div>
        <button
          className={`face-dot ${currentFace === 'chat' ? 'active' : ''}`}
          onClick={() => navigateToFace('chat')}
          onMouseEnter={() => setHoveredFace('chat')}
          title="Chat (Ctrl + 1)"
        >
          <FontAwesomeIcon icon={faComments} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'workspace' ? 'active' : ''}`}
          onClick={() => navigateToFace('workspace')}
          onMouseEnter={() => setHoveredFace('workspace')}
          title="Workspace (Ctrl + 2)"
        >
          <FontAwesomeIcon icon={faFolder} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'overview' ? 'active' : ''}`}
          onClick={() => navigateToFace('overview')}
          onMouseEnter={() => setHoveredFace('overview')}
          title="Overview (Ctrl + 3)"
        >
          <FontAwesomeIcon icon={faHome} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'tabs' ? 'active' : ''}`}
          onClick={() => navigateToFace('tabs')}
          onMouseEnter={() => setHoveredFace('tabs')}
          title="Tabs (Ctrl + 4)"
        >
          <FontAwesomeIcon icon={faTh} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'team' ? 'active' : ''}`}
          onClick={() => navigateToFace('team')}
          onMouseEnter={() => setHoveredFace('team')}
          title="Team (Ctrl + 5)"
        >
          <FontAwesomeIcon icon={faUsers} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'notes' ? 'active' : ''}`}
          onClick={() => navigateToFace('notes')}
          onMouseEnter={() => setHoveredFace('notes')}
          title="Notes (Ctrl + 6)"
        >
          <FontAwesomeIcon icon={faStickyNote} className="face-icon" />
        </button>
        <button
          className={`face-dot ${currentFace === 'apps' ? 'active' : ''}`}
          onClick={() => navigateToFace('apps')}
          onMouseEnter={() => setHoveredFace('apps')}
          title="Apps (Ctrl + 7)"
        >
          <FontAwesomeIcon icon={faDesktop} className="face-icon" />
        </button>
      </div>

      {/* Sliding container */}
      <div className={`workspace-faces ${isTransitioning ? 'transitioning' : ''}`} style={{ transform, willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}

export function Face({ index, children, className = '' }) {
  return (
    <div className={`workspace-face ${className}`} data-face={index}>
      {children}
    </div>
  );
}
