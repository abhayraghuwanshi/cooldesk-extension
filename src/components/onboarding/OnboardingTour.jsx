import { faArrowLeft, faArrowRight, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
// CSS is imported in App.jsx to avoid lazy-load preload issues

// Internal component for game-like typing effect
const TypewriterText = ({ text, speed = 30, onComplete }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayedText('');
    setIsComplete(false);
    let index = 0;
    let intervalId = null;

    const startDelay = setTimeout(() => {
      intervalId = setInterval(() => {
        if (index < text.length) {
          // Capture the char now — don't rely on `index` inside the functional update
          // because React may call the updater after `index` has already incremented.
          const char = text.charAt(index);
          index++;
          setDisplayedText(prev => prev + char);
        } else {
          clearInterval(intervalId);
          setIsComplete(true);
          if (onComplete) onComplete();
        }
      }, speed);
    }, 400);

    return () => {
      clearTimeout(startDelay);
      if (intervalId) clearInterval(intervalId);
    };
  }, [text, speed]);

  return (
    <div className="onboarding-description">
      {displayedText}
      {!isComplete && <span className="cursor-animate">|</span>}
    </div>
  );
};

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to CoolDesk',
    description: "Your browser's command center — tabs, notes, workspaces, and focus tools in one place. We've pre-loaded two demo workspaces so you can see how it works right away.",
    target: null,
    position: 'center',
    action: 'navigate:workspace',
    duration: 4500,
    emoji: '🚀'
  },
  {
    id: 'workspaces',
    title: 'Smart Workspaces',
    description: "Check out the Development workspace — it already has GitHub, MDN, npm, and Stack Overflow saved. Click it to open everything at once, or add your own URLs by dragging tabs in.",
    target: null,
    position: 'center',
    action: 'navigate:workspace',
    duration: 5500,
    emoji: '📁'
  },
  {
    id: 'expand-workspace',
    title: 'Expanding a Workspace',
    description: "Click any card to expand it and see all its saved URLs, notes, and actions. Watch — opening the first workspace now.",
    target: '.cooldesk-workspace-card',
    position: 'center',
    action: 'click:.cooldesk-workspace-card',
    duration: 4500,
    emoji: '📂'
  },
  {
    id: 'tabs',
    title: 'Tab Control',
    description: "See every open tab in one clean list. Search by title or URL, group tabs by domain with one click, spot duplicates, and save the whole session into a new workspace — without losing anything.",
    target: null,
    position: 'center',
    action: 'navigate:tabs',
    duration: 5000,
    emoji: '🗂️'
  },
  {
    id: 'search',
    title: 'Command Center',
    description: "Press Ctrl+K to instantly search across tabs, workspaces, history, bookmarks, and installed apps — all from one box, no mouse needed. This is your fastest path to anything.",
    target: '.cooldesk-search-container',
    position: 'bottom',
    action: 'navigate:workspace',
    duration: 5000,
    emoji: '⚡'
  },
  {
    id: 'notes',
    title: 'Contextual Notes',
    description: "Notes attach to workspace cards — expand any workspace card and you'll find its notes panel. No separate app needed.",
    target: null,
    position: 'center',
    action: 'navigate:workspace',
    duration: 4500,
    emoji: '📝'
  },
  {
    id: 'team',
    title: 'Share with Your Team',
    description: "Send workspace links and resources directly to teammates via encrypted P2P — no cloud account, no upload. Works across browsers on the same network.",
    target: null,
    position: 'center',
    action: 'navigate:team',
    duration: 4500,
    emoji: '👥'
  },
  {
    id: 'ready',
    title: "You're All Set!",
    description: "Open the Design Resources workspace to explore, or press Ctrl+K and type anything to search. Add your first real project by saving your current tabs as a workspace.",
    target: null,
    position: 'center',
    action: 'navigate:workspace',
    duration: 4000,
    emoji: '✨'
  }
];

// Fake Cursor Component
const FakeCursor = ({ target }) => {
  const [position, setPosition] = useState({ top: '50%', left: '50%', opacity: 0 });

  useEffect(() => {
    if (!target) {
      // Park cursor in corner or fade out when no target
      setPosition(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    const updatePos = () => {
      const el = document.querySelector(target);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Move to center of target
        setPosition({
          top: rect.top + rect.height / 2,
          left: rect.left + rect.width / 2,
          opacity: 1
        });
      }
    };

    updatePos();
    // Tiny polling to follow moving elements (like in transitions)
    const interval = setInterval(updatePos, 100);
    return () => clearInterval(interval);
  }, [target]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 24,
        height: 24,
        zIndex: 10002, // Above highlight
        pointerEvents: 'none',
        transform: `translate(${position.left}px, ${position.top}px)`,
        transition: 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease',
        opacity: position.opacity
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19177L11.7841 12.3673H5.65376Z" fill="black" stroke="white" strokeWidth="1" />
      </svg>
    </div>
  );
};

export function OnboardingTour({ onComplete, onSkip, autoPlay = true }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [showSpotlight, setShowSpotlight] = useState(false);

  // Auto-play state
  const [isAutoPlaying, setIsAutoPlaying] = useState(autoPlay);
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [isActionRunning, setIsActionRunning] = useState(false);
  const [showTransition, setShowTransition] = useState(false);

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isFirstStep = currentStep === 0;


  // Magical Body Class Control
  useEffect(() => {
    // Add global active class
    document.body.classList.add('onboarding-active');

    // Manage step-specific classes
    const allStepIds = ONBOARDING_STEPS.map(s => `step-${s.id}`);
    document.body.classList.remove(...allStepIds);
    if (step) {
      document.body.classList.add(`step-${step.id}`);
    }

    return () => { };
  }, [currentStep, step]);

  // Clean up body classes on unmount/completion
  useEffect(() => {
    return () => {
      document.body.classList.remove('onboarding-active');
      const allStepIds = ONBOARDING_STEPS.map(s => `step-${s.id}`);
      document.body.classList.remove(...allStepIds);
    };
  }, []);

  // Ghost Typer Logic
  const performGhostTyping = async (selector, text) => {
    const input = document.querySelector(selector);
    if (!input) return;

    input.focus();

    // Helper to trigger React change
    const triggerChange = (val) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(input, val);
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);
    };

    // Clear first
    triggerChange('');

    // Simulate typing
    for (let i = 0; i < text.length; i++) {
      triggerChange(input.value + text[i]);
      // Random typing delay
      await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
    }

    // Small pause before Enter
    await new Promise(r => setTimeout(r, 600));

    // Dispatch Enter (Try multiple ways to be sure)
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    input.dispatchEvent(enterEvent);

    // Also try submitting the form directly if available
    const form = input.closest('form');
    if (form) {
      form.requestSubmit();
    }
  };

  // Handle step actions (Navigation/Focus/Type)
  useEffect(() => {
    setIsTypingComplete(false); // Reset text typing
    setIsActionRunning(true); // Start action block

    let actionTimer;

    const executeAction = async () => {
      if (step.action) {
        const parts = step.action.split(':');
        const type = parts[0];
        const payload = parts[1];
        const extra = parts[2]; // For type command text

        if (type === 'navigate') {
          window.dispatchEvent(new CustomEvent('cooldesk-navigate', { detail: { face: payload } }));
        } else if (type === 'click') {
          await new Promise(r => setTimeout(r, 700));
          const el = document.querySelector(payload);
          if (el) el.click();
        } else if (type === 'focus') {
          setTimeout(() => {
            const el = document.querySelector(payload);
            if (el) {
              el.focus();
              if (el.tagName === 'INPUT') el.select();
            }
          }, 300);
        } else if (type === 'type') {
          // payload is selector, extra is text
          await performGhostTyping(payload, extra);
        } else if (type === 'wait') {
          await new Promise(r => setTimeout(r, parseInt(payload)));
        }
      }
      setIsActionRunning(false); // Action complete
    };

    executeAction();

    return () => clearTimeout(actionTimer);
  }, [currentStep, step.action]);

  // Auto-advance logic
  useEffect(() => {
    // Only advance if: AutoPlay is ON, Description Typing is DONE, Component VISIBLE, Action DONE
    if (!isAutoPlaying || !isTypingComplete || !isVisible || isActionRunning) return;

    const readTime = step.duration || 4000;
    const timer = setTimeout(() => {
      if (isLastStep) handleComplete();
      else handleNext();
    }, readTime);
    return () => clearTimeout(timer);
  }, [isAutoPlaying, isTypingComplete, currentStep, isLastStep, isVisible, isActionRunning, step.duration]);


  // Trigger chat scrape when onboarding starts
  useEffect(() => {
    if (chrome?.runtime?.id) {
      chrome.runtime.sendMessage({ type: 'TRIGGER_MANUAL_CHATS_SCRAPE' });
    }
  }, []);

  // Spotlight Logic
  useEffect(() => {
    setShowSpotlight(false);

    if (!step.target) return;

    let retryCount = 0;
    const maxRetries = 50;
    let retryTimeout;

    const updateHighlight = () => {
      const element = document.querySelector(step.target);
      if (!element) {
        if (retryCount < maxRetries) {
          retryCount++;
          retryTimeout = setTimeout(updateHighlight, 100);
        }
        return;
      }

      setShowSpotlight(true);
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

      document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
      element.classList.add('onboarding-highlight');
    };

    updateHighlight();
    window.addEventListener('resize', updateHighlight);

    return () => {
      clearTimeout(retryTimeout);
      window.removeEventListener('resize', updateHighlight);
      document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
    };
  }, [currentStep, step]);

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      // Show cinematic transition flash
      setShowTransition(true);
      setTimeout(() => setShowTransition(false), 600);
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    setIsAutoPlaying(false);
    if (!isFirstStep) setCurrentStep(prev => prev - 1);
  };

  const handleSkip = () => {
    setIsVisible(false);
    if (onSkip) onSkip();
  };

  const handleComplete = () => {
    setIsVisible(false);
    if (onComplete) onComplete();
  };

  const handleUserInteraction = () => {
    setIsAutoPlaying(false);
  };

  if (!isVisible) return null;

  return (
    <>
      {/* Vignette overlay - separate from backdrop to not conflict with wallpaper */}
      <div className="onboarding-vignette" />

      {showTransition && <div className="onboarding-transition-flash" />}

      {isAutoPlaying && <FakeCursor target={step.target} />}

      <div
        className={`onboarding-tooltip subtitle-style ${step.id}`}
        style={{
          position: 'fixed',
          bottom: 48,
          left: '50%',
          transform: 'translateX(-50%)',
          top: 'auto',
          right: 'auto',
          margin: 0,
          zIndex: 10003,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '40vh',
          transition: 'all 0.3s ease',
          textAlign: 'center'
        }}
      >
        <div className="onboarding-gradient-border" />

        <button className="onboarding-close" onClick={handleSkip} title="Skip tour">
          <FontAwesomeIcon icon={faTimes} />
        </button>

        <div className="onboarding-content" id="onboarding-chat-container">
          {/* Compact header with emoji + title inline */}
          <div className="onboarding-header-row">
            {step.emoji && <span className="onboarding-emoji">{step.emoji}</span>}
            <h3 className="onboarding-title">{step.title}</h3>
            <span className="onboarding-step-count">{currentStep + 1}/{ONBOARDING_STEPS.length}</span>
          </div>

          <TypewriterText
            key={step.id}
            text={step.description}
            speed={18}
            onComplete={() => setIsTypingComplete(true)}
          />

          {/* Compact footer */}
          <div className="onboarding-footer-row">
            <div className="onboarding-progress-bar">
              <div className="onboarding-progress-fill" style={{ width: `${((currentStep + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
            </div>
            <div className="onboarding-actions">
              {!isFirstStep && (
                <button className="onboarding-btn secondary" onClick={handlePrev}>
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
              )}
              <button className="onboarding-btn primary" onClick={() => { handleUserInteraction(); handleNext(); }}>
                {isLastStep ? 'Start' : (isAutoPlaying ? '⏸' : <FontAwesomeIcon icon={faArrowRight} />)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default OnboardingTour;
