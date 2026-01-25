import { faComments, faFolder, faHome, faStickyNote, faTh, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
// Create context for face state management to avoid prop drilling
const WorkspaceFaceContext = React.createContext({ currentFace: 'overview' });

export function WorkspaceShell({ children, activeFace = 'overview', onFaceChange, onSearch }) {
  const [currentFace, setCurrentFace] = useState(() => {
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
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) setActiveTabTitle(tabs[0].title);
      });

      const handleTabUpdate = (tabId, changeInfo, tab) => {
        if (tab.active && changeInfo.title) {
          setActiveTabTitle(changeInfo.title);
        }
      };

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

  const debouncedSave = useMemo(
    () =>
      debounce((face) => {
        localStorage.setItem('cooldesk-active-face', face);
      }, 300),
    []
  );

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

  useEffect(() => {
    debouncedSave(currentFace);
  }, [currentFace, debouncedSave]);

  useEffect(() => {
    if (activeFace && activeFace !== currentFace) {
      console.log('[WorkspaceShell] Responding to activeFace change:', activeFace);
      setCurrentFace(activeFace);
    }
  }, [activeFace, currentFace]);

  const navigateToFace = useCallback((face) => {
    if (face === currentFace || isTransitioning) return;

    // Smart Travel: Dynamic duration based on distance
    const faces = ['chat', 'workspace', 'overview', 'tabs', 'team', 'notes'];
    const currentIndex = faces.indexOf(currentFace);
    const targetIndex = faces.indexOf(face);
    const distance = Math.abs(targetIndex - currentIndex);

    // Aggressive optimization for "seamless" feel
    // < 1 hop: smooth 600ms
    // > 1 hop: super fast 300ms (whoosh effect)
    const duration = distance > 1 ? 350 : 600;

    const container = document.querySelector('.workspace-faces');
    if (container) {
      // Use efficient bezier for seamless landing
      container.style.transition = `transform ${duration}ms cubic-bezier(0.2, 1, 0.4, 1)`;
    }

    setIsTransitioning(true);
    setCurrentFace(face);

    if (onFaceChange) {
      onFaceChange(face);
    }

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    transitionTimeoutRef.current = setTimeout(() => {
      setIsTransitioning(false);
    }, duration);
  }, [currentFace, isTransitioning, onFaceChange]);

  useEffect(() => {
    const handleKeyboard = (e) => {
      const modifierPressed = e.ctrlKey || e.metaKey;

      if (modifierPressed && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        switch (e.key) {
          case 'ArrowLeft':
            if (currentFace === 'overview') navigateToFace('workspace');
            else if (currentFace === 'workspace') navigateToFace('chat');
            else if (currentFace === 'tabs') navigateToFace('overview');
            else if (currentFace === 'team') navigateToFace('tabs');
            else if (currentFace === 'notes') navigateToFace('team');
            break;
          case 'ArrowRight':
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

      if (modifierPressed && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault();
        const faceMap = {
          '1': 'chat', '2': 'workspace', '3': 'overview', '4': 'tabs', '5': 'team', '6': 'notes'
        };
        navigateToFace(faceMap[e.key]);
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        navigateToFace('overview');
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [navigateToFace, currentFace]);

  // Hyper-Spatial: Global Fluid Navigation (Two-finger scroll)
  useEffect(() => {
    let lastPulseTime = 0;
    const PULSE_COOLDOWN = 600; // Match transition duration
    const THRESHOLD = 30; // High sensitivity

    const handleWheel = (e) => {
      // Ignore vertical scrolling unless Shift is held
      if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;

      const delta = e.shiftKey ? e.deltaY : e.deltaX;

      // Prevent rapid fire hops
      const now = Date.now();
      if (now - lastPulseTime < PULSE_COOLDOWN) return;

      if (Math.abs(delta) > THRESHOLD) {
        e.preventDefault();

        if (delta > 0) {
          if (currentFace === 'chat') navigateToFace('workspace');
          else if (currentFace === 'workspace') navigateToFace('overview');
          else if (currentFace === 'overview') navigateToFace('tabs');
          else if (currentFace === 'tabs') navigateToFace('team');
          else if (currentFace === 'team') navigateToFace('notes');
        } else {
          if (currentFace === 'notes') navigateToFace('team');
          else if (currentFace === 'team') navigateToFace('tabs');
          else if (currentFace === 'tabs') navigateToFace('overview');
          else if (currentFace === 'overview') navigateToFace('workspace');
          else if (currentFace === 'workspace') navigateToFace('chat');
        }

        lastPulseTime = now;
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [navigateToFace, currentFace]);

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
    <WorkspaceFaceContext.Provider value={{ currentFace }}>
      <div className="workspace-shell">
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
            title="Collections (Ctrl + 2)"
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
            title="Spaces (Ctrl + 5)"
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

        <div className={`workspace-faces ${isTransitioning ? 'transitioning' : ''}`} style={{ transform, willChange: 'transform' }}>
          {children}
        </div>
      </div>
    </WorkspaceFaceContext.Provider>
  );
}

export function Face({ index, children, className = '' }) {
  // Consume context to check if this face is active
  const { currentFace } = React.useContext(WorkspaceFaceContext);
  const isActive = currentFace === index;

  return (
    <div
      className={`workspace-face ${className} ${isActive ? 'active' : 'inactive'}`}
      data-face={index}
    >
      {/* Optimization: While blurred/inactive, we can also hint browser to deprioritize hit testing */}
      <div style={{
        height: '100%',
        pointerEvents: isActive ? 'auto' : 'none',
        transition: 'opacity 0.4s ease' // Smooth internal fade
      }}>
        {children}
      </div>
    </div>
  );
}
