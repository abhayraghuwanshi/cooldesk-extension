/**
 * User Profile Service
 * Manages user display name and profile settings
 */

class UserProfileService {
    constructor() {
        this.username = null;
        this.browserId = null; // Stable ID that persists across username changes
        this.listeners = new Set();
    }

    /**
     * Generate a unique browser ID (UUID-like)
     */
    generateBrowserId() {
        return 'browser_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    }

    /**
     * Get or create a stable browser ID
     */
    async getBrowserId() {
        if (this.browserId) return this.browserId;

        try {
            const { userProfile } = await chrome.storage.local.get(['userProfile']);

            if (userProfile?.browserId) {
                this.browserId = userProfile.browserId;
            } else {
                // Generate new browser ID and save it
                this.browserId = this.generateBrowserId();
                await chrome.storage.local.set({
                    userProfile: {
                        ...userProfile,
                        browserId: this.browserId,
                        createdAt: Date.now()
                    }
                });
                console.log('[User Profile] Generated new browser ID:', this.browserId);
            }
        } catch (error) {
            console.error('[User Profile] Error loading browser ID:', error);
            this.browserId = this.generateBrowserId();
        }

        return this.browserId;
    }

    /**
     * Initialize and load username from storage
     */
    async init() {
        if (this.username) return this.username;

        try {
            const { userProfile } = await chrome.storage.local.get(['userProfile']);

            // Ensure browser ID exists
            await this.getBrowserId();

            if (userProfile?.username) {
                this.username = userProfile.username;
            } else {
                // Generate default username
                this.username = this.generateDefaultUsername();
                await this.setUsername(this.username);
            }
        } catch (error) {
            console.error('[User Profile] Error loading profile:', error);
            this.username = this.generateDefaultUsername();
        }

        return this.username;
    }

    /**
     * Generate a default username
     */
    generateDefaultUsername() {
        const adjectives = ['Swift', 'Bright', 'Cool', 'Smart', 'Quick', 'Bold', 'Wise', 'Keen', 'Sharp', 'Clever'];
        const nouns = ['Fox', 'Eagle', 'Tiger', 'Wolf', 'Hawk', 'Lion', 'Bear', 'Owl', 'Panda', 'Falcon'];

        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 100);

        return `${adj}${noun}${num}`;
    }

    /**
     * Get current username
     */
    async getUsername() {
        if (!this.username) {
            await this.init();
        }
        return this.username;
    }

    /**
     * Set username
     */
    async setUsername(newUsername) {
        if (!newUsername || !newUsername.trim()) {
            throw new Error('Username cannot be empty');
        }

        const trimmed = newUsername.trim();

        if (trimmed.length > 30) {
            throw new Error('Username must be 30 characters or less');
        }

        this.username = trimmed;

        try {
            await chrome.storage.local.set({
                userProfile: {
                    username: trimmed,
                    updatedAt: Date.now()
                }
            });

            this.notify();
            console.log('[User Profile] Username updated:', trimmed);
        } catch (error) {
            console.error('[User Profile] Error saving username:', error);
            throw error;
        }
    }

    /**
     * Subscribe to username changes
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Notify all listeners of changes
     */
    notify() {
        this.listeners.forEach(l => l(this.username));
    }
}

export const userProfileService = new UserProfileService();
