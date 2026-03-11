/**
 * Voice Response Utility
 * Provides text-to-speech feedback for voice commands
 */

class VoiceResponseManager {
  constructor() {
    this.isSpeaking = false;
    this.queue = [];
    this.enabled = true;
  }

  /**
   * Speak text using Web Speech API
   */
  speak(text, options = {}) {
    if (!this.enabled || !('speechSynthesis' in window)) {
      console.warn('[VoiceResponse] Speech synthesis not available');
      return;
    }

    // Cancel any ongoing speech if priority is high
    if (options.priority === 'high' && this.isSpeaking) {
      window.speechSynthesis.cancel();
      this.queue = [];
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice settings
    utterance.rate = options.rate || 1.1; // Slightly faster for responsiveness
    utterance.pitch = options.pitch || 1.0;
    utterance.volume = options.volume || 0.8;
    utterance.lang = options.lang || 'en-US';

    // Event handlers
    utterance.onstart = () => {
      this.isSpeaking = true;
      console.log('[VoiceResponse] Speaking:', text);
    };

    utterance.onend = () => {
      this.isSpeaking = false;
      // Process queue if there are pending messages
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        this.speak(next.text, next.options);
      }
    };

    utterance.onerror = (event) => {
      console.error('[VoiceResponse] Speech error:', event.error);
      this.isSpeaking = false;
    };

    // Queue or speak immediately
    if (this.isSpeaking && !options.interrupt) {
      this.queue.push({ text, options });
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * Quick response for successful actions
   */
  success(action, target) {
    const responses = [
      `Opening ${target}`,
      `${action} ${target}`,
      `Done, ${action} ${target}`
    ];
    const response = responses[Math.floor(Math.random() * responses.length)];
    this.speak(response, { rate: 1.2 });
  }

  /**
   * Response for fuzzy search matches
   */
  fuzzyMatch(searchTerm, matchedItem) {
    // Extract clean name from URL or title
    let cleanName = matchedItem.title || matchedItem.url;
    
    // If it's a URL, extract domain
    if (cleanName.startsWith('http')) {
      try {
        const url = new URL(cleanName);
        cleanName = url.hostname.replace('www.', '').split('.')[0];
      } catch (e) {
        // Keep original if URL parsing fails
      }
    }

    // Capitalize first letter
    cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

    const responses = [
      `Opening ${cleanName}`,
      `Found ${cleanName}, opening now`,
      `${cleanName}`
    ];
    
    const response = responses[Math.floor(Math.random() * responses.length)];
    this.speak(response, { rate: 1.2, priority: 'high' });
  }

  /**
   * Response for tab switching
   */
  tabSwitch(tabTitle) {
    const cleanTitle = tabTitle.split('-')[0].trim(); // Remove site name suffix
    this.speak(`Switching to ${cleanTitle}`, { rate: 1.2 });
  }

  /**
   * Response for search actions
   */
  search(engine, term) {
    this.speak(`Searching ${engine} for ${term}`, { rate: 1.1 });
  }

  /**
   * Response for errors
   */
  error(message) {
    this.speak(message, { rate: 1.0, pitch: 0.9 });
  }

  /**
   * Cancel all speech
   */
  cancel() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
    this.queue = [];
  }

  /**
   * Enable/disable voice responses
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.cancel();
    }
  }

  /**
   * Check if currently speaking
   */
  get speaking() {
    return this.isSpeaking;
  }
}

// Export singleton instance
export const voiceResponse = new VoiceResponseManager();

// Export class for custom instances
export { VoiceResponseManager };
