import { useEffect, useState } from 'react';
import { checkForUpdate, getUpdateState, subscribeUpdate } from '../services/updateService';

/**
 * Subscribes to the shared update state and kicks off the check on first mount.
 * Safe to use from as many components as you like — the service de-dupes both
 * the request and the re-check interval.
 *
 * Returns { info, checking, installing } where `info` is null when there is
 * nothing to install.
 */
export function useUpdateAvailable() {
  const [state, setState] = useState(getUpdateState);

  useEffect(() => {
    const unsubscribe = subscribeUpdate(setState);
    checkForUpdate();
    return unsubscribe;
  }, []);

  return state;
}

export default useUpdateAvailable;
