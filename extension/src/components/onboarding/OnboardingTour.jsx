import { faArrowLeft, faArrowRight, faCheckCircle, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import './OnboardingTour.css';

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: '👋 Welcome to CoolDesk!',
    description: 'Your intelligent workspace dashboard is ready! Let\'s take a quick tour to help you get started.',
    target: null,
    position: 'center'
  },
  {
    id: 'workspaces',
    title: '💼 Organize with Workspaces',
    description: 'Create custom workspaces to organize your tabs! Use the floating + button (bottom right) to add URLs from your open tabs, history, or bookmarks. Click any workspace card to open all its URLs at once.',
    target: null,
    position: 'center'
  },
  {
    id: 'quick-add',
    title: '➕ Quick Add Button',
    description: 'Look for the blue + button in the bottom right corner! It\'s your quick access hub to add URLs to workspaces, create new workspaces, or jot down notes. You can browse your open tabs, history, and bookmarks all in one place.',
    target: null,
    position: 'center'
  },
  {
    id: 'features',
    title: '✨ Powerful Features',
    description: 'CoolDesk tracks your open tabs, saves AI chat history from ChatGPT/Claude/Gemini, and lets you create smart notes. All sections are draggable - click and hold any section title to rearrange your layout!',
    target: null,
    position: 'center'
  },
  {
    id: 'settings',
    title: '⚙️ Customize Everything',
    description: 'Click the settings button (top right) to customize themes, fonts, wallpapers, toggle sections, and manage your data. You can restart this tour anytime from the Help section!',
    target: '[data-onboarding="settings-button"]',
    position: 'bottom'
  },
  {
    id: 'complete',
    title: '🎉 You\'re All Set!',
    description: 'Remember: Use the + button for quick actions, sections are draggable, and workspaces keep you organized. Enjoy your personalized workspace!',
    target: null,
    position: 'center'
  }
];

export function OnboardingTour({ onComplete, onSkip }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isFirstStep = currentStep === 0;



  // Trigger chat scrape when onboarding starts
  useEffect(() => {
    if (chrome?.runtime?.id) {
      console.log('[Onboarding] Triggering background chat scrape...');
      chrome.runtime.sendMessage({ type: 'TRIGGER_MANUAL_CHATS_SCRAPE' }, (response) => {
        console.log('[Onboarding] Chat scrape triggered:', response);
      });
    }
  }, []);

  useEffect(() => {
    if (!step.target) return;

    let retryCount = 0;
    const maxRetries = 20;
    let retryTimeout;

    const updatePosition = () => {
      const element = document.querySelector(step.target);

      // If element not found, retry after a short delay
      if (!element) {
        if (retryCount < maxRetries) {
          retryCount++;
          retryTimeout = setTimeout(updatePosition, 100);
        } else {
          console.warn(`[Onboarding] Element not found: ${step.target}`);
        }
        return;
      }

      const rect = element.getBoundingClientRect();
      const tooltipWidth = 320;
      const tooltipHeight = 200;
      const padding = 16;

      let top = 0;
      let left = 0;

      switch (step.position) {
        case 'bottom':
          top = rect.bottom + padding;
          left = rect.left + rect.width / 2 - tooltipWidth / 2;
          break;
        case 'top':
          top = rect.top - tooltipHeight - padding;
          left = rect.left + rect.width / 2 - tooltipWidth / 2;
          break;
        case 'left':
          top = rect.top + rect.height / 2 - tooltipHeight / 2;
          left = rect.left - tooltipWidth - padding;
          break;
        case 'right':
          top = rect.top + rect.height / 2 - tooltipHeight / 2;
          left = rect.right + padding;
          break;
        default:
          break;
      }

      // Keep tooltip within viewport
      const maxLeft = window.innerWidth - tooltipWidth - padding;
      const maxTop = window.innerHeight - tooltipHeight - padding;
      left = Math.max(padding, Math.min(left, maxLeft));
      top = Math.max(padding, Math.min(top, maxTop));

      setTooltipPosition({ top, left });

      // Highlight element
      element.classList.add('onboarding-highlight');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);

    return () => {
      clearTimeout(retryTimeout);
      window.removeEventListener('resize', updatePosition);
      const element = document.querySelector(step.target);
      if (element) {
        element.classList.remove('onboarding-highlight');
      }
    };
  }, [currentStep, step]);

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSkip = () => {
    setIsVisible(false);
    if (onSkip) onSkip();
  };

  const handleComplete = () => {
    setIsVisible(false);
    if (onComplete) onComplete();
  };

  if (!isVisible) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="onboarding-backdrop" />

      {/* Spotlight for highlighted element */}
      {step.target && (
        <div className="onboarding-spotlight" />
      )}

      {/* Tooltip */}
      <div
        className={`onboarding-tooltip ${step.position || 'center'}`}
        style={step.target ? tooltipPosition : {}}
      >
        <button
          className="onboarding-close"
          onClick={handleSkip}
          title="Skip tour"
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>

        <div className="onboarding-content">
          <h3 className="onboarding-title">{step.title}</h3>
          <p className="onboarding-description">{step.description}</p>
        </div>

        <div className="onboarding-footer">
          <div className="onboarding-progress">
            {ONBOARDING_STEPS.map((_, index) => (
              <div
                key={index}
                className={`progress-dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              />
            ))}
          </div>

          <div className="onboarding-actions">
            {!isFirstStep && (
              <button
                className="onboarding-btn secondary"
                onClick={handlePrev}
              >
                <FontAwesomeIcon icon={faArrowLeft} />
                Back
              </button>
            )}

            <button
              className="onboarding-btn primary"
              onClick={handleNext}
            >
              {isLastStep ? (
                <>
                  <FontAwesomeIcon icon={faCheckCircle} />
                  Get Started
                </>
              ) : (
                <>
                  Next
                  <FontAwesomeIcon icon={faArrowRight} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default OnboardingTour;
