/**
 * Appstore Dictionary Version
 *
 * Increment this version when appstore.json is updated.
 * This triggers re-classification of URLs that were previously
 * classified by Nano AI (not in dictionary).
 *
 * Version History:
 * - v1: Initial release with 13 categories
 */

export const APPSTORE_VERSION = 1;

/**
 * Storage key for tracking which URLs were classified by Nano
 * and at which dictionary version
 */
export const NANO_CLASSIFICATION_KEY = 'nanoClassifications';

/**
 * Check if a URL needs re-classification based on version
 * @param {Object} urlRecord - URL record with extra.ai data
 * @returns {boolean} True if re-classification needed
 */
export function needsReclassification(urlRecord) {
    const nanoData = urlRecord?.extra?.ai;
    if (!nanoData?.source || nanoData.source !== 'nano') {
        return false; // Not classified by Nano
    }
    if (!nanoData.version) {
        return true; // No version = old classification
    }
    return nanoData.version < APPSTORE_VERSION;
}

export default APPSTORE_VERSION;
