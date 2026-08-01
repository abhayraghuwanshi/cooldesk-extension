import { useEffect, useState } from 'react';

const ONBOARDING_KEY = 'cooldesk_onboarding_completed';
// Bumped for the 3-step getting-started flow — existing users see it once more.
const ONBOARDING_VERSION = '2.0';

/**
 * Hook to manage onboarding state
 * @returns {Object} Onboarding state and controls
 */
export function useOnboarding() {
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
  const [isManualStart, setIsManualStart] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = () => {
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY);
      const version = localStorage.getItem(`${ONBOARDING_KEY}_version`);
      
      // Show onboarding if never completed or version changed
      if (!completed || version !== ONBOARDING_VERSION) {
        setShouldShowOnboarding(true);
      }
    } catch (error) {
      console.error('[Onboarding] Failed to check status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const completeOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, 'true');
      localStorage.setItem(`${ONBOARDING_KEY}_version`, ONBOARDING_VERSION);
      setShouldShowOnboarding(false);
      setIsManualStart(false);
    } catch (error) {
      console.error('[Onboarding] Failed to save completion:', error);
    }
  };

  const skipOnboarding = () => {
    setIsManualStart(false);
    completeOnboarding();
  };

  const resetOnboarding = () => {
    try {
      localStorage.removeItem(ONBOARDING_KEY);
      localStorage.removeItem(`${ONBOARDING_KEY}_version`);
      setShouldShowOnboarding(true);
    } catch (error) {
      console.error('[Onboarding] Failed to reset:', error);
    }
  };

  const startOnboarding = () => {
    setIsManualStart(true);
    setShouldShowOnboarding(true);
  };

  return {
    shouldShowOnboarding,
    isManualStart,
    isLoading,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
    startOnboarding,
  };
}

export default useOnboarding;
