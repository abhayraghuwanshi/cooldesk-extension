import { faComments, faFolder, faHome, faStickyNote, faTh, faUsers } from '@fortawesome/free-solid-svg-icons';
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
            if (currentFace === 'overview') navigateToFace('workspace');
            else if (currentFace === 'workspace') navigateToFace('chat');
            else if (currentFace === 'tabs') navigateToFace('overview');
            else if (currentFace === 'team') navigateToFace('tabs');
            else if (currentFace === 'notes') navigateToFace('team');
            break;
          case 'ArrowRight':
            // Navigate right through faces
            if (currentFace === 'overview') navigateToFace('tabs');
            else if (currentFace === 'tabs') navigateToFace('team');
            else if (currentFace === 'team') navigateToFace('notes');
            else if (currentFace === 'workspace') navigateToFace('overview');
            else if (currentFace === 'chat') navigateToFace('workspace');
            break;
          case 'ArrowDown':
          case 'ArrowUp':
            navigateToFace('overview');
            break;
          default:
            break;
        }
      }

      // Number keys with modifier (1-6 for direct navigation)
      if (modifierPressed && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault();
        const faceMap = {
          '1': 'chat',
          '2': 'workspace',
          '3': 'overview',
          '4': 'tabs',
          '5': 'team',
          '6': 'notes'
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
        } else if (scrollDelta < -threshold) {
          // Scroll left
          if (currentFace === 'notes') navigateToFace('team');
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
    const transforms = {
      'chat': 'translateX(0)',
      'workspace': 'translateX(-16.666667%)',
      'overview': 'translateX(-33.333333%)',
      'tabs': 'translateX(-50%)',
      'team': 'translateX(-66.666667%)',
      'notes': 'translateX(-83.333333%)'
    };
    return transforms[currentFace] || transforms.overview;
  }, [currentFace]);

  return (
    <div className="workspace-shell">
      {/* Global Search Bar */}
      {/* Global Search Bar - REPLACED by merged header in CoolDeskContainer */}
      {/* <div style={{ padding: '0 24px 16px 24px', flexShrink: 0, zIndex: 101 }}>
        <CoolSearch onSearch={onSearch} />
      </div> */}

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
          <FontAwesomeIcon icon={faFolder} className="face-icon" style={{ transform: 'translateY(-1px)' }} />
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
          <FontAwesomeIcon icon={faUsers} className="face-icon" style={{ transform: 'translateY(-1px)' }} />
        </button>
        <button
          className={`face-dot ${currentFace === 'notes' ? 'active' : ''}`}
          onClick={() => navigateToFace('notes')}
          onMouseEnter={() => setHoveredFace('notes')}
          title="Notes (Ctrl + 6)"
        >
          <FontAwesomeIcon icon={faStickyNote} className="face-icon" />
        </button>
      </div>

      {/* Sliding container */}
      <div className={`workspace-faces ${isTransitioning ? 'transitioning' : ''}`} style={{ transform, willChange: 'transform' }}>
        {/* We assume 'children' are passed in a specific order or we construct them here if they are static faces */}
        {/* But wait, 'children' was used before. Let's see how App.jsx passes them. */}
        {/* Assuming children contains the 3 existing faces: Chat, Workspace, Overview. Notes was hardcoded? No, notes logic was missing in view? */}
        {/* Actually, let's look at how children are rendered. Using <Face> components? */}
        {/* The original code just rendered {children}. */}
        {/* We need to inject the TeamView component into the children or as a new Face */}
        {/* If children is an array, we can insert into it. */}

        {/* But simply rendering {children} implies the parent (App.jsx) controls the content. */}
        {/* I should check App.jsx again to see what it passes to WorkspaceShell. */}

        {/* HOWEVER, for now I will render {children} AND my new faces? */}
        {/* No, standard pattern is to update App.jsx to pass the new face. */}
        {/* But I can also inject it here if I want to encapsulate it. */}

        {/* Best practice: Update App.jsx to pass the TeamView face. */}
        {/* BUT I will try to support it here to minimize App.jsx edits if possible. */}

        {/* Let's render children, but ensure we have slots for our new faces? */}
        {/* If I change App.jsx, I have to be careful. */}

        {children}
        {/* I'll need to modify App.jsx to include TeamView in the children list */}
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
