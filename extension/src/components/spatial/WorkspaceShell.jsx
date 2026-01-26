import { faComments, faFolder, faHome, faStickyNote, faTh, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { teamManager } from '../../services/p2p/teamManager';
import '../../styles/spatial.css';


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
  const [currentFace, setCurrentFace] = useState(activeFace);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activeTeam, setActiveTeam] = useState(null);
  const [hoveredFace, setHoveredFace] = useState(null);
  const [activeTabTitle, setActiveTabTitle] = useState('');
  const transitionTimeoutRef = useRef(null);
  const wheelStateRef = useRef({
    accumulator: 0,
    isLatched: false,
    lastTimestamp: 0,
    lastDirection: 0,
    lastSwitchTime: 0
  });

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
    if (activeFace && activeFace !== currentFace) {
      console.log('[WorkspaceShell] Responding to activeFace change:', activeFace);
      setCurrentFace(activeFace);
    }
  }, [activeFace, currentFace]);

  const navigateToFace = useCallback((face) => {
    if (face === currentFace) return;

    // Smart Travel: Dynamic duration based on distance
    const faces = ['chat', 'workspace', 'overview', 'tabs', 'team', 'notes'];
    const currentIndex = faces.indexOf(currentFace);
    const targetIndex = faces.indexOf(face);
    const distance = Math.abs(targetIndex - currentIndex);

    // Instant feel: 200ms single, 100ms multi
    const duration = distance > 1 ? 100 : 200;

    const container = document.querySelector('.workspace-faces');
    if (container) {
      // Snappier bezier
      container.style.transition = `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`;
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
  }, [currentFace, onFaceChange]);

  useEffect(() => {
    const handleKeyboard = (e) => {
      const modifierPressed = e.ctrlKey || e.metaKey;
      const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;

      // Don't override default text navigation in inputs unless specifically requested
      // (This prevents Ctrl+Arrow from breaking cursor movement in text fields)
      if (isInput && modifierPressed && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      if (modifierPressed && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        console.log('[WorkspaceShell] Spatial Nav triggered:', e.key);
        e.preventDefault();

        const faces = ['chat', 'workspace', 'overview', 'tabs', 'team', 'notes'];
        const currentIndex = faces.indexOf(currentFace);

        if (currentIndex === -1) {
          console.warn('[WorkspaceShell] Invalid currentFace:', currentFace);
          // Fallback to overview if state is corrupted
          navigateToFace('overview');
          return;
        }

        if (e.key === 'ArrowLeft') {
          if (currentIndex > 0) navigateToFace(faces[currentIndex - 1]);
        } else if (e.key === 'ArrowRight') {
          if (currentIndex < faces.length - 1) navigateToFace(faces[currentIndex + 1]);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          navigateToFace('overview');
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
    const GESTURE_TIMEOUT = 150; // Ms before considering gesture ended
    const MIN_SWITCH_COOLDOWN = 300; // Minimum ms between auto-hops to prevent flying to end

    const handleWheel = (e) => {
      const isMouseWheel = e.deltaMode !== 0; // 1 = lines, 2 = pages (mouse wheel)
      const THRESHOLD = isMouseWheel ? 50 : 200; // Increased for trackpads to require more energy
      const NEUTRAL_THRESHOLD = isMouseWheel ? 10 : 20;
      const VELOCITY_DECAY_THRESHOLD = isMouseWheel ? 40 : 80; // Harder to reset latch during active swipe

      // Priority 1: Strict Vertical Rejection
      if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) * 0.5) {
        wheelStateRef.current.accumulator = 0;
        return;
      }

      const delta = e.shiftKey ? e.deltaY : e.deltaX;
      const now = Date.now();
      const state = wheelStateRef.current;

      // Reset state if too much time has passed since last event (new physical gesture)
      if (now - state.lastTimestamp > GESTURE_TIMEOUT) {
        state.isLatched = false;
        state.accumulator = 0;
      }

      state.lastTimestamp = now;

      // Cooldown check: No processing if we JUST switched
      if (now - state.lastSwitchTime < MIN_SWITCH_COOLDOWN) {
        state.accumulator = 0;
        return;
      }

      // Direction check: Reset latch if user reverses scroll
      const currentDirection = Math.sign(delta);
      if (state.lastDirection !== 0 && currentDirection !== state.lastDirection && Math.abs(delta) > NEUTRAL_THRESHOLD) {
        state.isLatched = false;
        state.accumulator = 0;
      }
      state.lastDirection = currentDirection;

      // If latched, we allow reset ONLY if user slows down significantly
      if (state.isLatched) {
        if (Math.abs(delta) < VELOCITY_DECAY_THRESHOLD) {
          state.isLatched = false;
          state.accumulator = 0; // Important: Clear any built-up energy
        }
        return;
      }

      // Consuming energy
      state.accumulator += delta;

      if (Math.abs(state.accumulator) > THRESHOLD) {
        e.preventDefault();

        const faces = ['chat', 'workspace', 'overview', 'tabs', 'team', 'notes'];
        const currentIndex = faces.indexOf(currentFace);

        let switched = false;
        if (state.accumulator > 0 && currentIndex < faces.length - 1) {
          navigateToFace(faces[currentIndex + 1]);
          switched = true;
        } else if (state.accumulator < 0 && currentIndex > 0) {
          navigateToFace(faces[currentIndex - 1]);
          switched = true;
        }

        if (switched) {
          state.isLatched = true;
          state.lastSwitchTime = now;
        }
        state.accumulator = 0;
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
