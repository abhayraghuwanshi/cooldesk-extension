/**
 * Session Tracker - Monitors browsing sessions to detect project context
 * Tracks active tabs, analyzes patterns, and identifies project relationships
 */

/**
 * Session data structure:
 * {
 *   sessionId: string,
 *   startTime: number,
 *   lastUpdate: number,
 *   tabs: Array<{tabId, url, title, hostname, path, lastActive}>,
 *   urlPatterns: Map<pattern, count>
 * }
 */

class SessionTracker {
  constructor() {
    this.currentSession = null;
    this.sessionHistory = [];
    this.enabled = true;
    this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    this.MAX_SESSION_HISTORY = 10;

    // Initialize from storage
    this._loadState();
  }

  /**
   * Load session state from chrome.storage
   */
  async _loadState() {
    try {
      const { sessionTracking } = await chrome.storage.local.get(['sessionTracking']);
      if (sessionTracking) {
        this.enabled = sessionTracking.enabled !== false;
        this.currentSession = sessionTracking.currentSession || null;
        this.sessionHistory = Array.isArray(sessionTracking.history)
          ? sessionTracking.history.slice(-this.MAX_SESSION_HISTORY)
          : [];
      }
    } catch (error) {
      console.error('[SessionTracker] Failed to load state:', error);
    }
  }

  /**
   * Save session state to chrome.storage
   */
  async _saveState() {
    try {
      await chrome.storage.local.set({
        sessionTracking: {
          enabled: this.enabled,
          currentSession: this.currentSession,
          history: this.sessionHistory.slice(-this.MAX_SESSION_HISTORY),
          lastUpdate: Date.now()
        }
      });
    } catch (error) {
      console.error('[SessionTracker] Failed to save state:', error);
    }
  }

  /**
   * Enable or disable session tracking
   * @param {boolean} enabled
   */
  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    await this._saveState();
    console.log('[SessionTracker] Tracking:', this.enabled ? 'enabled' : 'disabled');
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Start a new session
   */
  _startNewSession() {
    // Save previous session to history
    if (this.currentSession) {
      this.sessionHistory.push({
        ...this.currentSession,
        endTime: Date.now()
      });
    }

    this.currentSession = {
      sessionId: `session_${Date.now()}`,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      tabs: [],
      urlPatterns: {}
    };

    console.log('[SessionTracker] New session started:', this.currentSession.sessionId);
  }

  /**
   * Extract hostname and path from URL
   * @param {string} url
   * @returns {{hostname: string, path: string, pattern: string}}
   */
  _parseUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const path = urlObj.pathname;

      // Extract pattern (e.g., github.com/user/repo)
      let pattern = hostname;
      if (hostname === 'github.com' || hostname === 'github.dev') {
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
          pattern = `${hostname}/${parts[0]}/${parts[1]}`;
        }
      } else if (hostname === 'localhost' || hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        // Include port for localhost
        pattern = `${hostname}:${urlObj.port || '80'}`;
      } else if (path.includes('/file/') || path.includes('/folder/') || path.includes('/workspace/')) {
        // For file-based services (Notion, Figma, Google Drive, etc.)
        const pathParts = path.split('/').filter(Boolean);
        const fileIndex = pathParts.findIndex(p => ['file', 'folder', 'workspace', 'page'].includes(p));
        if (fileIndex >= 0 && pathParts[fileIndex + 1]) {
          pattern = `${hostname}/${pathParts[fileIndex]}/${pathParts[fileIndex + 1]}`;
        }
      }

      return { hostname, path, pattern };
    } catch (error) {
      return { hostname: '', path: '', pattern: '' };
    }
  }

  /**
   * Update session with a tab
   * @param {number} tabId
   * @param {string} url
   * @param {string} title
   */
  async updateTab(tabId, url, title) {
    if (!this.enabled) return;

    // Skip chrome:// and extension:// URLs
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') || url.startsWith('about:')) {
      return;
    }

    // Start new session if needed
    if (!this.currentSession) {
      this._startNewSession();
    }

    // Check if session should timeout
    const timeSinceUpdate = Date.now() - this.currentSession.lastUpdate;
    if (timeSinceUpdate > this.SESSION_TIMEOUT) {
      this._startNewSession();
    }

    const { hostname, path, pattern } = this._parseUrl(url);
    if (!hostname) return;

    // Update or add tab
    const existingTabIndex = this.currentSession.tabs.findIndex(t => t.tabId === tabId);
    const tabData = {
      tabId,
      url,
      title: title || url,
      hostname,
      path,
      pattern,
      lastActive: Date.now()
    };

    if (existingTabIndex >= 0) {
      this.currentSession.tabs[existingTabIndex] = tabData;
    } else {
      this.currentSession.tabs.push(tabData);
    }

    // Update URL pattern counts
    if (pattern) {
      this.currentSession.urlPatterns[pattern] =
        (this.currentSession.urlPatterns[pattern] || 0) + 1;
    }

    this.currentSession.lastUpdate = Date.now();

    // Cleanup old tabs (keep last 50)
    if (this.currentSession.tabs.length > 50) {
      this.currentSession.tabs = this.currentSession.tabs
        .sort((a, b) => b.lastActive - a.lastActive)
        .slice(0, 50);
    }

    await this._saveState();
  }

  /**
   * Remove a tab from current session
   * @param {number} tabId
   */
  async removeTab(tabId) {
    if (!this.enabled || !this.currentSession) return;

    this.currentSession.tabs = this.currentSession.tabs.filter(t => t.tabId !== tabId);
    await this._saveState();
  }

  /**
   * Get current session context
   * @returns {Object} Session data with detected patterns
   */
  getCurrentSession() {
    if (!this.currentSession) return null;

    // Get most common patterns
    const patterns = Object.entries(this.currentSession.urlPatterns)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));

    // Get unique hostnames
    const hostnames = [...new Set(this.currentSession.tabs.map(t => t.hostname))];

    // Get recently active tabs (last 10 minutes)
    const recentCutoff = Date.now() - 10 * 60 * 1000;
    const recentTabs = this.currentSession.tabs
      .filter(t => t.lastActive >= recentCutoff)
      .sort((a, b) => b.lastActive - a.lastActive);

    return {
      sessionId: this.currentSession.sessionId,
      startTime: this.currentSession.startTime,
      lastUpdate: this.currentSession.lastUpdate,
      tabCount: this.currentSession.tabs.length,
      recentTabCount: recentTabs.length,
      recentTabs: recentTabs.slice(0, 10),
      topPatterns: patterns,
      hostnames,
      allTabs: this.currentSession.tabs
    };
  }

  /**
   * Get tabs that likely belong to the same project
   * @param {string} referenceUrl - URL to find related tabs for
   * @returns {Array} Related tabs
   */
  getRelatedTabs(referenceUrl) {
    if (!this.currentSession) return [];

    const { pattern, hostname } = this._parseUrl(referenceUrl);
    if (!pattern) return [];

    // Find tabs with same pattern or hostname
    return this.currentSession.tabs.filter(tab => {
      if (tab.pattern === pattern) return true;
      if (tab.hostname === hostname) return true;

      // Check for localhost variations
      if (hostname.startsWith('localhost') && tab.hostname.startsWith('localhost')) {
        return true;
      }

      return false;
    });
  }

  /**
   * Detect if current session suggests a project
   * @returns {Object|null} Detected project info
   */
  detectProject() {
    if (!this.currentSession || this.currentSession.tabs.length < 2) {
      return null;
    }

    const session = this.getCurrentSession();
    const topPattern = session.topPatterns[0];

    if (!topPattern || topPattern.count < 2) {
      return null;
    }

    // Extract project name from pattern
    const projectName = this._extractProjectName(topPattern.pattern, session.recentTabs);

    if (!projectName) return null;

    // Find anchor URLs (main project URLs)
    const anchors = session.recentTabs
      .filter(t => t.pattern === topPattern.pattern)
      .map(t => t.url);

    return {
      name: projectName,
      pattern: topPattern.pattern,
      confidence: Math.min(0.5 + (topPattern.count * 0.1), 1.0),
      anchors: anchors.slice(0, 3),
      relatedTabCount: topPattern.count,
      suggestedFrom: 'session_analysis'
    };
  }

  /**
   * Extract project name from URL pattern and tabs
   * @param {string} pattern
   * @param {Array} tabs
   * @returns {string|null}
   */
  _extractProjectName(pattern, tabs) {
    // Try to extract from GitHub URL
    if (pattern.includes('github.com/')) {
      const parts = pattern.split('/');
      if (parts.length >= 3) {
        const repoName = parts[2]
          .replace(/[-_]/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        return repoName;
      }
    }

    // Try to extract from localhost port + page titles
    if (pattern.includes('localhost:')) {
      const relevantTabs = tabs.filter(t => t.pattern === pattern);
      if (relevantTabs.length > 0) {
        // Look for common words in titles
        const titles = relevantTabs.map(t => t.title);
        const commonWords = this._findCommonWords(titles);
        if (commonWords.length > 0) {
          return commonWords.slice(0, 3).join(' ');
        }
      }
      return `Project ${pattern.split(':')[1]}`; // Fallback to port number
    }

    // Try to extract from domain
    const hostname = pattern.split('/')[0];
    if (hostname && !hostname.includes('.')) {
      return hostname.charAt(0).toUpperCase() + hostname.slice(1);
    }

    return null;
  }

  /**
   * Find common words in titles (for project name detection)
   * @param {Array<string>} titles
   * @returns {Array<string>}
   */
  _findCommonWords(titles) {
    if (titles.length === 0) return [];

    // Common stop words to ignore
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'app', 'page', 'site', 'web']);

    // Extract words from all titles
    const wordCounts = {};
    titles.forEach(title => {
      const words = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
    });

    // Find words that appear in most titles
    const threshold = Math.ceil(titles.length * 0.5);
    return Object.entries(wordCounts)
      .filter(([, count]) => count >= threshold)
      .sort(([, a], [, b]) => b - a)
      .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
  }

  /**
   * Clear current session
   */
  async clearSession() {
    if (this.currentSession) {
      this.sessionHistory.push({
        ...this.currentSession,
        endTime: Date.now()
      });
    }
    this.currentSession = null;
    await this._saveState();
    console.log('[SessionTracker] Session cleared');
  }

  /**
   * Get session history
   * @returns {Array} Past sessions
   */
  getHistory() {
    return this.sessionHistory;
  }
}

// Export singleton instance
export const sessionTracker = new SessionTracker();
