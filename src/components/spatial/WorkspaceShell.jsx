import { faFolder, faGear, faStickyNote, faTh, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { teamManager } from '../../services/p2p/teamManager';
import '../../styles/spatial.css';


/**
 * WorkspaceShell - Spatial container for workspace faces (cube metaphor)
 *
 * Manages navigation between:
 * - Workspace (left) - workspace details, management, and ChatContext
 * - Overview (center) - main workspace grid
 * - Tabs (right) - tab management
 * - Team (further right) - P2P shared items
 * - Notes (far right) - deep focus writing
 */
// Create context for face state management to avoid prop drilling
const WorkspaceFaceContext = React.createContext({ currentFace: 'overview', isDesktopApp: false });

export function WorkspaceShell({ children, activeFace = 'overview', onFaceChange, onSearch, onOpenSettings, isDesktopApp = false }) {
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
    const faces = isDesktopApp ? ['workspace', 'tabs', 'team', 'notes'] : ['overview'];
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
    // Skip keyboard navigation in extension mode (only one face)
    if (!isDesktopApp) return;

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

        const faces = isDesktopApp ? ['workspace', 'tabs', 'team', 'notes'] : ['overview'];
        const currentIndex = faces.indexOf(currentFace);

        if (currentIndex === -1) {
          console.warn('[WorkspaceShell] Invalid currentFace:', currentFace);
          // Fallback to first face if state is corrupted
          navigateToFace(faces[0]);
          return;
        }

        if (e.key === 'ArrowLeft') {
          if (currentIndex > 0) navigateToFace(faces[currentIndex - 1]);
        } else if (e.key === 'ArrowRight') {
          if (currentIndex < faces.length - 1) navigateToFace(faces[currentIndex + 1]);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          navigateToFace(faces[0]);
        }
      }

      if (modifierPressed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const faceMap = {
          '1': 'workspace', '2': 'tabs', '3': 'team', '4': 'notes'
        };
        navigateToFace(faceMap[e.key]);
      }

      if (e.key === 'Escape') {
        if (isInput) {
          e.target.blur();
          return;
        }
        // In Notes view, Escape should not navigate away (allow it for local UI like modals)
        if (currentFace === 'notes') {
          return;
        }

        e.preventDefault();
        navigateToFace('workspace');
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [navigateToFace, currentFace, isDesktopApp]);

  // Hyper-Spatial: Global Fluid Navigation (Two-finger scroll)
  useEffect(() => {
    // Skip wheel navigation in extension mode (only one face)
    if (!isDesktopApp) return;

    const GESTURE_TIMEOUT = 150; // Ms before considering gesture ended
    const MIN_SWITCH_COOLDOWN = 600; // Increased to 600ms to prevent double-skipping

    const handleWheel = (e) => {
      // Ignore zoom gestures (pinch-to-zoom sends Ctrl + Wheel)
      if (e.ctrlKey) return;

      const isMouseWheel = e.deltaMode !== 0; // 1 = lines, 2 = pages (mouse wheel)
      const THRESHOLD = isMouseWheel ? 50 : 300; // Increased for trackpads to require more energy
      const NEUTRAL_THRESHOLD = isMouseWheel ? 10 : 20;
      const VELOCITY_DECAY_THRESHOLD = isMouseWheel ? 40 : 30; // Reduced: must stop almost completely to reset

      // Priority 1: Strict Vertical Rejection
      // Increased to 0.85 to strict requirement for horizontal movement
      if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) * 0.85) {
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
        if (e.cancelable) e.preventDefault();

        const faces = isDesktopApp ? ['workspace', 'tabs', 'team', 'notes'] : ['overview'];
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
  }, [navigateToFace, currentFace, isDesktopApp]);

  const transform = useMemo(() => {
    // In extension mode, only overview is shown - no transform needed
    if (!isDesktopApp) {
      return 'translateX(0)';
    }

    // Desktop app: 4 faces, each taking 25% of the 400% container
    const transforms = {
      'workspace': 'translateX(0)',
      'tabs': 'translateX(-25%)',
      'team': 'translateX(-50%)',
      'notes': 'translateX(-75%)'
    };
    return transforms[currentFace] || transforms.workspace;
  }, [currentFace, isDesktopApp]);

  return (
    <WorkspaceFaceContext.Provider value={{ currentFace, isDesktopApp }}>
      <div className="workspace-shell">
        {/* Navigation bar - Desktop App Only */}
        {isDesktopApp && (
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
              className={`face-dot ${currentFace === 'workspace' ? 'active' : ''}`}
              onClick={() => navigateToFace('workspace')}
              onMouseEnter={() => setHoveredFace('workspace')}
              title="Collections (Ctrl + 1)"
              data-onboarding="nav-collections"
            >
              <FontAwesomeIcon icon={faFolder} className="face-icon" style={{ transform: 'translateY(-1px)' }} />
            </button>
            <button
              className={`face-dot ${currentFace === 'tabs' ? 'active' : ''}`}
              onClick={() => navigateToFace('tabs')}
              onMouseEnter={() => setHoveredFace('tabs')}
              title="Tabs (Ctrl + 2)"
              data-onboarding="nav-tabs"
            >
              <FontAwesomeIcon icon={faTh} className="face-icon" />
            </button>
            <button
              className={`face-dot ${currentFace === 'team' ? 'active' : ''}`}
              onClick={() => navigateToFace('team')}
              onMouseEnter={() => setHoveredFace('team')}
              title="Spaces (Ctrl + 3)"
              data-onboarding="nav-team"
            >
              <FontAwesomeIcon icon={faUsers} className="face-icon" style={{ transform: 'translateY(-1px)' }} />
            </button>
            <button
              className={`face-dot ${currentFace === 'notes' ? 'active' : ''}`}
              onClick={() => navigateToFace('notes')}
              onMouseEnter={() => setHoveredFace('notes')}
              title="Notes (Ctrl + 4)"
              data-onboarding="nav-notes"
            >
              <FontAwesomeIcon icon={faStickyNote} className="face-icon" />
            </button>
            {onOpenSettings && (
              <button
                className="face-dot"
                onClick={onOpenSettings}
                onMouseEnter={() => setHoveredFace('settings')}
                onMouseLeave={() => setHoveredFace(null)}
                title="Settings"
                data-onboarding="nav-settings"
              >
                <FontAwesomeIcon icon={faGear} className="face-icon" />
              </button>
            )}
          </div>
        )}

        <div
          className={`workspace-faces ${isTransitioning ? 'transitioning' : ''}`}
          style={{
            transform,
            willChange: 'transform',
            // In extension mode: single face takes 100% width
            // In desktop mode: 6 faces at 600% total width (handled by CSS)
            ...(isDesktopApp ? {} : { width: '100%' })
          }}
        >
          {children}
        </div>
      </div>
    </WorkspaceFaceContext.Provider>
  );
}

export function Face({ index, children, className = '' }) {
  // Consume context to check if this face is active
  const { currentFace, isDesktopApp } = React.useContext(WorkspaceFaceContext);
  const isActive = currentFace === index;

  return (
    <div
      className={`workspace-face ${className} ${isActive ? 'active' : 'inactive'}`}
      data-face={index}
      style={isDesktopApp ? undefined : { flex: '0 0 100%', width: '100%' }}
    >
      {/* Optimization: While blurred/inactive, we can also hint browser to deprioritize hit testing */}
      <div style={{
        height: '100%',
        pointerEvents: isActive ? 'auto' : 'none',
        transition: 'opacity 0.4s ease'
      }}>
        {children}
      </div>
    </div>
  );
}
