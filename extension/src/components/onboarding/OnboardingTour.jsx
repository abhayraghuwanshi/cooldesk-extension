import { faArrowLeft, faArrowRight, faCheckCircle, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import './OnboardingTour.css';

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: '👋 Welcome to CoolDesk!',
    description: 'Let\'s take a quick tour of your new workspace dashboard.',
    target: null, // Center modal
    position: 'center'
  },
  {
    id: 'current-pins-section',
    title: 'Favourite Pins',
    description: 'Quick access to your favorite Pins. Pin tabs you use frequently for instant access.',
    target: '[data-onboarding="current-pins-section"]',
    position: 'bottom'
  },
  {
    id: 'activity-section',
    title: 'Activity',
    description: 'Quick access to your activity.',
    target: '[data-onboarding="activity-section"]',
    position: 'bottom'
  },
  {
    id: 'pinned-workspaces',
    title: '📌 Pinned Workspaces',
    description: 'Quick access to your favorite workspaces. Pin workspaces you use frequently for instant access.',
    target: '[data-onboarding="pinned-workspaces"]',
    position: 'bottom'
  },
  {
    id: 'workspace-filters',
    title: '💼 Workspace Filters',
    description: 'Filter and organize your tabs by workspace. Create new workspaces to group related tabs together.',
    target: '[data-onboarding="workspace-filters"]',
    position: 'bottom'
  },
  {
    id: 'current-tabs',
    title: '📑 Current Tabs',
    description: 'See all your open browser tabs in one place. Quickly switch, close, or organize them by workspace.',
    target: '[data-onboarding="current-tabs-section"]',
    position: 'left'
  },
  {
    id: 'voice-navigation',
    title: '🎤 Voice Navigation',
    description: 'Control ChatGPT with voice commands. Navigate hands-free and boost your productivity!',
    target: '[data-onboarding="voice-navigation-section"]',
    position: 'left'
  },
  {
    id: 'ai-chats',
    title: '🤖 AI Chats',
    description: 'View your chat history from ChatGPT, Claude, Gemini, and other AI platforms all in one place.',
    target: '[data-onboarding="ai-chats-section"]',
    position: 'left'
  },
  {
    id: 'notes',
    title: '📝 Notes',
    description: 'Quick notes and reminders with markdown support. Jot down ideas as you work.',
    target: '[data-onboarding="notes-section"]',
    position: 'left'
  },
  {
    id: 'shared-workspace',
    title: ' Shared Workspace',
    description: 'Share Links and Workspace Across the browser',
    target: '[data-onboarding="dropbox-shared-section"]',
    position: 'left'
  },
  {
    id: 'view-modes',
    title: '👁️ View Modes',
    description: 'Switch between different view modes to customize your workspace. Try Focus Mode for distraction-free work!',
    target: '.view-mode-selector',
    position: 'top'
  },
  {
    id: 'settings',
    title: '⚙️ Settings',
    description: 'Customize your experience! Access help, control which components are visible, export your data, and more.',
    target: '[data-onboarding="settings-button"]',
    position: 'top'
  },
  {
    id: 'sidebar',
    title: '📱 Open in Sidebar',
    description: 'Open CoolDesk in your browser\'s sidebar for quick access while browsing.',
    target: '[data-onboarding="sidebar-button"]',
    position: 'top'
  },
  {
    id: 'complete',
    title: '🎉 You\'re All Set!',
    description: 'You\'re ready to boost your productivity with CoolDesk. You can always access this tour from Settings → Help.',
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
