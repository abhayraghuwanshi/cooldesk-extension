import { faArrowLeft, faArrowRight, faCheckCircle, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import './OnboardingTour.css';

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: '👋 Welcome to CoolDesk!',
    description: 'Let\'s take a quick tour of your new workspace dashboard. This will only take a minute!',
    target: null, // Center modal
    position: 'center'
  },
  {
    id: 'workspace-section',
    title: '💼 Workspaces',
    description: 'Organize your tabs into workspaces. Auto-created workspaces group related sites (GitHub, ChatGPT, etc.). Click titles to collapse sections and save space!',
    target: '[data-onboarding="workspace-filters"]',
    position: 'bottom'
  },
  {
    id: 'current-tabs',
    title: '📑 Current Tabs',
    description: 'See all your open browser tabs in one place. Right-click URLs to add notes! Auto-cleanup keeps your tabs organized (20 tab limit, 10min timeout).',
    target: '[data-onboarding="current-tabs-section"]',
    position: 'left'
  },
  {
    id: 'voice-navigation',
    title: '🎤 Voice Navigation',
    description: 'Control ChatGPT with voice commands. Say "scroll down", "click send", or "read response" for hands-free navigation!',
    target: '[data-onboarding="voice-navigation-section"]',
    position: 'left'
  },
  {
    id: 'ai-chats',
    title: '🤖 AI Chats History',
    description: 'All your AI conversations in one place! View chat history from ChatGPT, Claude, Gemini, and other platforms. Click to reopen chats.',
    target: '[data-onboarding="ai-chats-section"]',
    position: 'left'
  },
  {
    id: 'notes',
    title: '📝 Smart Notes',
    description: 'Create quick notes, todos, or URL-specific notes! Use voice input 🎤 or type. Right-click any URL in workspaces to add a note for that link.',
    target: '[data-onboarding="notes-section"]',
    position: 'left'
  },
  {
    id: 'drag-sections',
    title: '🎯 Drag & Drop Sections',
    description: 'Pro tip: You can drag and reorder ALL sections below! Click and hold the section title, then drag to rearrange your layout however you like.',
    target: '[data-onboarding="current-tabs-section"]',
    position: 'left'
  },
  {
    id: 'settings',
    title: '⚙️ Settings & Themes',
    description: 'Customize everything! Change themes, fonts, wallpapers, toggle sections, export data, and restart this tour anytime from Help.',
    target: '[data-onboarding="settings-button"]',
    position: 'bottom'
  },
  {
    id: 'complete',
    title: '🎉 You\'re All Set!',
    description: 'Remember: Sections are draggable, titles are collapsible, and you can right-click URLs for quick actions. Enjoy your personalized workspace!',
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
