/**
 * Project Detector - Identifies and manages project contexts from browsing sessions
 * Handles gradual project discovery and auto-creation
 */

import { sessionTracker } from './sessionTracker.js';

/**
 * Project data structure:
 * {
 *   id: string,
 *   name: string,
 *   created: number,
 *   urlPatterns: Array<string>,
 *   environments: {
 *     dev: Array<string>,
 *     staging: Array<string>,
 *     production: Array<string>
 *   },
 *   categories: Object,
 *   lastActive: number,
 *   color: string
 * }
 */

class ProjectDetector {
  constructor() {
    this.projects = new Map();
    this.activeProjectId = null;
    this.pendingDiscovery = null; // For projects awaiting user confirmation
    this._loadState();
  }

  /**
   * Load projects from storage
   */
  async _loadState() {
    try {
      const { projects, activeProjectId } = await chrome.storage.local.get(['projects', 'activeProjectId']);

      if (projects && typeof projects === 'object') {
        Object.entries(projects).forEach(([id, project]) => {
          this.projects.set(id, project);
        });
      }

      this.activeProjectId = activeProjectId || null;
      console.log(`[ProjectDetector] Loaded ${this.projects.size} projects`);
    } catch (error) {
      console.error('[ProjectDetector] Failed to load state:', error);
    }
  }

  /**
   * Save projects to storage
   */
  async _saveState() {
    try {
      const projectsObj = {};
      this.projects.forEach((project, id) => {
        projectsObj[id] = project;
      });

      await chrome.storage.local.set({
        projects: projectsObj,
        activeProjectId: this.activeProjectId,
        projectsLastUpdate: Date.now()
      });
    } catch (error) {
      console.error('[ProjectDetector] Failed to save state:', error);
    }
  }

  /**
   * Generate a unique project ID
   * @param {string} name
   * @returns {string}
   */
  _generateProjectId(name) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_');
    return `proj_${slug}_${Date.now()}`;
  }

  /**
   * Generate a color for a project
   * @returns {string} Hex color
   */
  _generateProjectColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#6C5CE7', '#FDCB6E', '#E17055', '#74B9FF', '#A29BFE'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Detect environment from URL
   * @param {string} url
   * @returns {'dev'|'staging'|'production'|'unknown'}
   */
  _detectEnvironment(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const fullUrl = url.toLowerCase();

      // Development
      if (hostname === 'localhost' ||
          hostname.startsWith('127.') ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.match(/^\d+\.\d+\.\d+\.\d+$/) ||
          fullUrl.includes('dev.') ||
          fullUrl.includes('-dev.') ||
          fullUrl.includes('.dev/') ||
          fullUrl.includes('local.')) {
        return 'dev';
      }

      // Staging
      if (fullUrl.includes('staging.') ||
          fullUrl.includes('-staging.') ||
          fullUrl.includes('.staging/') ||
          fullUrl.includes('stg.') ||
          fullUrl.includes('-stg.') ||
          fullUrl.includes('preview.') ||
          fullUrl.includes('-preview.')) {
        return 'staging';
      }

      // Production (default for deployed apps)
      if (hostname.endsWith('.vercel.app') ||
          hostname.endsWith('.netlify.app') ||
          hostname.endsWith('.herokuapp.com') ||
          hostname.endsWith('.onrender.com') ||
          hostname.endsWith('.railway.app') ||
          hostname.endsWith('.fly.dev') ||
          !hostname.includes('localhost')) {
        return 'production';
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Create a new project
   * @param {string} name
   * @param {Array<string>} urlPatterns
   * @param {Object} options
   * @returns {Object} Created project
   */
  async createProject(name, urlPatterns = [], options = {}) {
    const id = this._generateProjectId(name);

    const project = {
      id,
      name: name.trim(),
      created: Date.now(),
      urlPatterns: urlPatterns.filter(Boolean),
      environments: {
        dev: [],
        staging: [],
        production: []
      },
      categories: {},
      lastActive: Date.now(),
      color: options.color || this._generateProjectColor(),
      metadata: options.metadata || {}
    };

    // Auto-categorize URLs by environment
    urlPatterns.forEach(url => {
      const env = this._detectEnvironment(url);
      if (env !== 'unknown' && !project.environments[env].includes(url)) {
        project.environments[env].push(url);
      }
    });

    this.projects.set(id, project);
    await this._saveState();

    console.log('[ProjectDetector] Created project:', name, id);
    return project;
  }

  /**
   * Get project by ID
   * @param {string} projectId
   * @returns {Object|null}
   */
  getProject(projectId) {
    return this.projects.get(projectId) || null;
  }

  /**
   * Get all projects
   * @returns {Array<Object>}
   */
  getAllProjects() {
    return Array.from(this.projects.values())
      .sort((a, b) => b.lastActive - a.lastActive);
  }

  /**
   * Update project
   * @param {string} projectId
   * @param {Object} updates
   */
  async updateProject(projectId, updates) {
    const project = this.projects.get(projectId);
    if (!project) {
      console.warn('[ProjectDetector] Project not found:', projectId);
      return;
    }

    Object.assign(project, updates, { lastActive: Date.now() });
    this.projects.set(projectId, project);
    await this._saveState();
  }

  /**
   * Add URL pattern to project
   * @param {string} projectId
   * @param {string} url
   */
  async addUrlToProject(projectId, url) {
    const project = this.projects.get(projectId);
    if (!project) return;

    if (!project.urlPatterns.includes(url)) {
      project.urlPatterns.push(url);

      // Auto-categorize by environment
      const env = this._detectEnvironment(url);
      if (env !== 'unknown' && !project.environments[env].includes(url)) {
        project.environments[env].push(url);
      }

      project.lastActive = Date.now();
      await this._saveState();
    }
  }

  /**
   * Find project by URL
   * @param {string} url
   * @returns {Object|null} Matching project
   */
  findProjectByUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;

      // Check exact pattern matches first
      for (const [, project] of this.projects) {
        for (const pattern of project.urlPatterns) {
          if (url.includes(pattern) || pattern.includes(hostname)) {
            project.lastActive = Date.now();
            this._saveState();
            return project;
          }
        }

        // Check environment URLs
        for (const envUrls of Object.values(project.environments)) {
          for (const envUrl of envUrls) {
            if (url.startsWith(envUrl) || envUrl.includes(hostname)) {
              project.lastActive = Date.now();
              this._saveState();
              return project;
            }
          }
        }

        // GitHub repo matching
        if (hostname === 'github.com' && pathname) {
          const parts = pathname.split('/').filter(Boolean);
          if (parts.length >= 2) {
            const repoPattern = `github.com/${parts[0]}/${parts[1]}`;
            if (project.urlPatterns.some(p => p.includes(repoPattern))) {
              project.lastActive = Date.now();
              this._saveState();
              return project;
            }
          }
        }

        // Localhost port matching
        if (hostname === 'localhost' || hostname.startsWith('127.')) {
          const port = urlObj.port;
          const localhostPattern = `localhost:${port}`;
          if (project.urlPatterns.some(p => p.includes(localhostPattern))) {
            project.lastActive = Date.now();
            this._saveState();
            return project;
          }
        }
      }
    } catch (error) {
      console.error('[ProjectDetector] Error finding project by URL:', error);
    }

    return null;
  }

  /**
   * Set active project
   * @param {string|null} projectId
   */
  async setActiveProject(projectId) {
    if (projectId && !this.projects.has(projectId)) {
      console.warn('[ProjectDetector] Cannot set non-existent project as active:', projectId);
      return;
    }

    this.activeProjectId = projectId;

    if (projectId) {
      const project = this.projects.get(projectId);
      if (project) {
        project.lastActive = Date.now();
      }
    }

    await this._saveState();

    // Broadcast active project change
    chrome.runtime.sendMessage({
      action: 'activeProjectChanged',
      projectId,
      project: projectId ? this.projects.get(projectId) : null
    }).catch(() => {});

    console.log('[ProjectDetector] Active project:', projectId);
  }

  /**
   * Get active project
   * @returns {Object|null}
   */
  getActiveProject() {
    return this.activeProjectId ? this.projects.get(this.activeProjectId) : null;
  }

  /**
   * Analyze current session and suggest project
   * @returns {Object|null} Project suggestion
   */
  async analyzeSessionForProject() {
    if (!sessionTracker.isEnabled()) {
      return null;
    }

    const detected = sessionTracker.detectProject();
    if (!detected) {
      return null;
    }

    // Check if this project already exists
    const existingProject = Array.from(this.projects.values()).find(project => {
      return project.name.toLowerCase() === detected.name.toLowerCase() ||
             project.urlPatterns.some(pattern => pattern.includes(detected.pattern));
    });

    if (existingProject) {
      // Auto-switch to existing project
      await this.setActiveProject(existingProject.id);
      return {
        type: 'existing',
        project: existingProject,
        confidence: detected.confidence
      };
    }

    // New project suggestion
    this.pendingDiscovery = {
      name: detected.name,
      pattern: detected.pattern,
      anchors: detected.anchors,
      confidence: detected.confidence,
      detectedAt: Date.now()
    };

    return {
      type: 'new',
      suggestion: this.pendingDiscovery
    };
  }

  /**
   * Confirm and create pending project
   * @param {string} confirmedName - User-confirmed project name
   * @returns {Object} Created project
   */
  async confirmPendingProject(confirmedName) {
    if (!this.pendingDiscovery) {
      throw new Error('No pending project to confirm');
    }

    const project = await this.createProject(
      confirmedName || this.pendingDiscovery.name,
      this.pendingDiscovery.anchors
    );

    await this.setActiveProject(project.id);

    this.pendingDiscovery = null;
    return project;
  }

  /**
   * Reject pending project discovery
   */
  rejectPendingProject() {
    this.pendingDiscovery = null;
  }

  /**
   * Delete a project
   * @param {string} projectId
   */
  async deleteProject(projectId) {
    if (!this.projects.has(projectId)) return;

    this.projects.delete(projectId);

    if (this.activeProjectId === projectId) {
      this.activeProjectId = null;
    }

    await this._saveState();
    console.log('[ProjectDetector] Deleted project:', projectId);
  }

  /**
   * Get project context for a URL (for AI categorization)
   * @param {string} url
   * @returns {Object} Context object
   */
  getProjectContext(url) {
    const project = this.findProjectByUrl(url);
    const session = sessionTracker.getCurrentSession();

    return {
      project: project ? {
        id: project.id,
        name: project.name,
        categories: Object.keys(project.categories || {})
      } : null,
      session: session ? {
        recentTabs: session.recentTabs.slice(0, 5).map(t => ({
          url: t.url,
          title: t.title
        })),
        topPatterns: session.topPatterns.slice(0, 3)
      } : null,
      environment: this._detectEnvironment(url)
    };
  }
}

// Export singleton instance
export const projectDetector = new ProjectDetector();
