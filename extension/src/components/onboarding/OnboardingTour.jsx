import { faArrowLeft, faArrowRight, faCheckCircle, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import './OnboardingTour.css';

// Internal component for game-like typing effect
const TypewriterText = ({ text, speed = 30, onComplete }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayedText('');
    setIsComplete(false);
    let index = 0;

    // Initial pause for dramatic effect
    const startDelay = setTimeout(() => {
      const interval = setInterval(() => {
        if (index < text.length) {
          setDisplayedText((prev) => prev + text.charAt(index));
          index++;
        } else {
          clearInterval(interval);
          setIsComplete(true);
          if (onComplete) onComplete();
        }
      }, speed);
      return () => clearInterval(interval);
    }, 400);

    return () => clearTimeout(startDelay);
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
    title: 'System Online',
    description: 'Welcome, Agent. Initiating automated system tour. Hands off—let me show you around the CoolDesk capabilities. Sequence starting...',
    target: null,
    position: 'center',
    action: 'navigate:3' // Overview
  },
  {
    id: 'overview',
    title: 'Sector 3: Mission Control',
    description: 'The Overview Dashboard. Your central hub for recent activity, quick stats, and high-priority items. Accessible anytime via Ctrl+3.',
    target: '.overview-dashboard-grid',
    position: 'center',
    action: 'navigate:3'
  },
  {
    id: 'search',
    title: 'Command Center',
    description: 'The Neural Interface. Press Ctrl+K to access global search. Type "/" to execute system commands or launch apps instantly.',
    target: '.cooldesk-search-container',
    position: 'bottom',
    action: 'focus:.cooldesk-search-input'
  },
  {
    id: 'notes_demo',
    title: 'Simulating Navigation',
    description: 'Watch closely. I am taking control of the interface to demonstrate command navigation. Typing "/notes"...',
    target: '.cooldesk-search-input',
    position: 'bottom',
    action: 'type:.cooldesk-search-input:/notes'
  },
  {
    id: 'notes',
    title: 'Sector 6: Deep Focus',
    description: 'We have arrived at the Notes Module. A distraction-free zone for tactical planning. Let\'s return to base.',
    target: null,
    position: 'center',
    action: 'wait:1000' // Just wait a bit
  },
  {
    id: 'return_search',
    title: 'Re-engaging Search',
    description: 'Bringing up the command line again (Ctrl+K). Now targeting the AI Chat module...',
    target: '.cooldesk-search-container',
    position: 'bottom',
    // action: 'navigate:3', // Reset to overview first to ensure search is visible or just open search
    // Actually search is available everywhere, let's just focus it again
    action: 'focus:.cooldesk-search-input'
  },
  // Split search re-focus into small step to ensure it happens
  {
    id: 'chat_demo',
    title: 'Executing Jump',
    description: 'Typing "/chat" to initiate AI Companion uplinking...',
    target: '.cooldesk-search-input',
    position: 'bottom',
    action: 'type:.cooldesk-search-input:/chat'
  },
  {
    id: 'chat',
    title: 'Sector 1: AI Companion',
    description: 'Connection established. Your intelligent assistant is ready to analyze data and execute complex tasks on command.',
    target: null,
    position: 'center',
    action: 'wait:1000'
  },
  {
    id: 'workspaces',
    title: 'Sector 2: Project Grid',
    description: 'Transporting to Workspaces (Ctrl+2)... You can also type "/workspace" to get here. One click restores your entire environment.',
    target: null, // Full view
    position: 'center',
    action: 'navigate:2'
  },
  {
    id: 'tabs',
    title: 'Sector 4: Tab Array',
    description: 'Warping to Tab Management (Ctrl+4)... The system automatically groups your scattered browser tabs. Purge duplicates with one click.',
    target: null,
    position: 'center',
    action: 'navigate:4'
  },
  {
    id: 'team',
    title: 'Sector 5: Team Ops',
    description: 'Engaging Team Link (Ctrl+5)... Share resources securely via P2P. No cloud servers, just direct encrypted collaboration.',
    target: null,
    position: 'center',
    action: 'navigate:5'
  },
  {
    id: 'magic',
    title: 'The Magic Button',
    description: 'Returning to Base... The Global Add button is your universal collector. Grab tabs, history, and assets from anywhere in the system.',
    target: '[data-onboarding="global-add-btn"]',
    position: 'left',
    action: 'navigate:3'
  },
  {
    id: 'ready',
    title: 'Controls Transferred',
    description: 'Tour complete. You have full manual control. Remember: "/" is your key to the entire system. Good luck, Agent.',
    target: null,
    position: 'center'
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

export function OnboardingTour({ onComplete, onSkip }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState([]); // Chat History
  const [isVisible, setIsVisible] = useState(true);
  const [showSpotlight, setShowSpotlight] = useState(false);

  // Auto-play state
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [isActionRunning, setIsActionRunning] = useState(false);

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  // Add step to history
  useEffect(() => {
    if (step) {
      setVisitedSteps(prev => {
        // Avoid duplicates (if strict mode runs twice)
        if (prev.length > 0 && prev[prev.length - 1].id === step.id) return prev;
        return [...prev, step];
      });
      // Scroll to bottom
      setTimeout(() => {
        const container = document.getElementById('onboarding-chat-container');
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
      }, 100);
    }
  }, [currentStep, step]);

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
          const event = new KeyboardEvent('keydown', {
            key: payload,
            code: `Digit${payload}`,
            ctrlKey: true,
            metaKey: true,
            bubbles: true
          });
          window.dispatchEvent(event);
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

    const readTime = isLastStep ? 5000 : 3500;
    const timer = setTimeout(() => {
      if (isLastStep) handleComplete();
      else handleNext();
    }, readTime);
    return () => clearTimeout(timer);
  }, [isAutoPlaying, isTypingComplete, currentStep, isLastStep, isVisible, isActionRunning]);


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
    if (isLastStep) handleComplete();
    else setCurrentStep(prev => prev + 1);
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
      <div className="onboarding-backdrop" onClick={handleUserInteraction} />

      {isAutoPlaying && <FakeCursor target={step.target} />}

      <div
        className={`onboarding-tooltip ${step.id}`}
        style={{
          position: 'fixed',
          bottom: 32,
          left: 32,
          right: 'auto',
          top: 'auto',
          transform: 'none',
          margin: 0,
          zIndex: 10003,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '60vh',
          transition: 'all 0.3s ease'
        }}
      >
        <div className="onboarding-gradient-border" />

        <button className="onboarding-close" onClick={handleSkip} title="Skip tour">
          <FontAwesomeIcon icon={faTimes} />
        </button>

        <div
          className="onboarding-content onboarding-chat-log"
          id="onboarding-chat-container"
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingRight: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          {visitedSteps.map((s, index) => {
            const isLatest = index === visitedSteps.length - 1;
            return (
              <div
                key={`${s.id}-${index}`}
                className={`onboarding-message ${isLatest ? 'latest' : 'history'}`}
                style={{
                  opacity: isLatest ? 1 : 0.6,
                  filter: isLatest ? 'none' : 'grayscale(0.3)',
                  transition: 'all 0.5s ease',
                  transformOrigin: 'bottom left',
                  animation: 'fadeInUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)'
                }}
              >
                <div className="onboarding-step-indicator" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Step {index + 1}</span>
                  {isLatest && isAutoPlaying && <span style={{ opacity: 0.7, color: '#4ade80' }}>▶ LIVE</span>}
                </div>
                <h3 className="onboarding-title" style={{ fontSize: isLatest ? 18 : 16, marginBottom: 8, opacity: isLatest ? 1 : 0.8 }}>{s.title}</h3>

                {isLatest ? (
                  <TypewriterText
                    text={s.description}
                    speed={20}
                    onComplete={() => setIsTypingComplete(true)}
                  />
                ) : (
                  <div className="onboarding-description" style={{ fontSize: 13 }}>{s.description}</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="onboarding-footer" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div className="onboarding-progress-bar">
            <div
              className="onboarding-progress-fill"
              style={{ width: `${((currentStep + 1) / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>

          <div className="onboarding-actions">
            {!isFirstStep && (
              <button className="onboarding-btn secondary" onClick={handlePrev}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
            )}

            <button
              className="onboarding-btn primary"
              onClick={() => { handleUserInteraction(); handleNext(); }}
            >
              {isLastStep ? (
                <>Get Started <FontAwesomeIcon icon={faCheckCircle} /></>
              ) : (
                <>{isAutoPlaying ? 'Pause' : 'Next'} <FontAwesomeIcon icon={faArrowRight} /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default OnboardingTour;
