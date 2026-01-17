/**
 * User Profile Service
 * Manages user display name and profile settings
 */

class UserProfileService {
    constructor() {
        this.username = null;
        this.listeners = new Set();
    }

    /**
     * Initialize and load username from storage
     */
    async init() {
        if (this.username) return this.username;

        try {
            const { userProfile } = await chrome.storage.local.get(['userProfile']);

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
