import { useEffect, useState } from 'react';

const ONBOARDING_KEY = 'cooldesk_onboarding_completed';
const ONBOARDING_VERSION = '1.0';

/**
 * Hook to manage onboarding state
 * @returns {Object} Onboarding state and controls
 */
export function useOnboarding() {
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
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
    } catch (error) {
      console.error('[Onboarding] Failed to save completion:', error);
    }
  };

  const skipOnboarding = () => {
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
    setShouldShowOnboarding(true);
  };

  return {
    shouldShowOnboarding,
    isLoading,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
    startOnboarding,
  };
}

export default useOnboarding;
