/**
 * Generic URL Parser - Unified workspace URL detection and parsing
 * Replaces workspace-patterns.json, workspaceParser.js, and workspaceAutoCreator.js
 */

import { getFaviconUrl } from '../utils.js';

export class GenericUrlParser {
  static config = {
    'github.com': {
      name: 'GitHub',
      icon: '💻',
      color: '#333',
      groupBy: 'platform', // Group all repos into one workspace
      systemPaths: ['settings', 'notifications', 'marketplace', 'explore', 'trending', 'new', 'login', 'signup', 'pricing', 'features'],
      patterns: [
        // Check system paths first (most specific)
        {
          name: 'system',
          test: (paths) => paths.length >= 1 && this.config['github.com'].systemPaths.includes(paths[0]),
          extract: (paths) => ({
            workspace: 'GitHub',
            title: paths.join(' ') || 'GitHub',
            details: {
              primary: 'GitHub',
              secondary: paths[0] || null,
              path: paths.slice(1).join('/') || null,
              id: 'github-system',
              type: 'settings'
            }
          })
        },
        // Repository pattern - group all into one workspace
        {
          name: 'repository',
          test: (paths) => paths.length >= 2,
          extract: (paths) => ({
            workspace: 'GitHub', // Group all repositories into one workspace
            title: `${paths[0]}/${paths[1]}`,
            details: {
              primary: paths[0], // owner
              secondary: paths[1], // repo
              path: paths.slice(2).join('/') || null,
              id: `${paths[0]}/${paths[1]}`,
              type: 'project',
              owner: paths[0],
              repo: paths[1]
            }
          })
        },
        // Fallback
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'GitHub',
            title: 'GitHub',
            details: {
              primary: 'GitHub',
              secondary: null,
              path: null,
              id: 'github',
              type: 'general'
            }
          })
        }
      ]
    },

    'chat.openai.com': {
      name: 'ChatGPT',
      icon: '🤖',
      color: '#10a37f',
      groupBy: 'platform', // Group all chats into one workspace
      patterns: [
        // Conversation/chat pattern
        {
          name: 'conversation',
          test: (paths, url) => url.pathname.includes('/c/') || (paths[0] === 'c' && paths[1]),
          extract: (paths, url, domTitle) => {
            const match = url.pathname.match(/\/c\/([a-f0-9-]{8,})/);
            const chatId = match ? match[1].slice(0, 8) : (paths[1] ? paths[1].slice(0, 8) : 'unknown');

            // Try to extract conversation title from DOM, URL params, or use default
            let title = `Chat ${chatId}`;
            if (domTitle && domTitle !== 'ChatGPT' && !domTitle.includes('New chat')) {
              title = domTitle;
            } else if (url.searchParams.has('title')) {
              title = decodeURIComponent(url.searchParams.get('title'));
            }

            return {
              workspace: 'ChatGPT',
              title: title,
              details: {
                primary: 'ChatGPT',
                secondary: title,
                path: paths.slice(2).join('/') || null,
                id: chatId,
                type: 'conversation',
                model: 'gpt'
              }
            };
          }
        },
        // GPTs/custom assistant pattern
        {
          name: 'gpts',
          test: (paths) => paths[0] === 'g' && paths[1],
          extract: (paths) => {
            const gptId = paths[1];
            const gptName = decodeURIComponent(paths[2] || 'Custom GPT').replace(/-/g, ' ');

            return {
              workspace: 'ChatGPT',
              title: gptName,
              details: {
                primary: 'GPTs',
                secondary: gptName,
                path: paths.slice(3).join('/') || null,
                id: gptId,
                type: 'assistant',
                model: 'custom-gpt'
              }
            };
          }
        },
        // Shared conversation links
        {
          name: 'share',
          test: (paths, url) => paths[0] === 'share' && paths[1],
          extract: (paths) => {
            const shareId = paths[1].slice(0, 8);
            const sharedTitle = `Shared Chat ${shareId}`;
            return {
              workspace: 'ChatGPT',
              title: sharedTitle,
              details: {
                primary: 'Shared',
                secondary: shareId,
                path: null,
                id: shareId,
                type: 'shared_conversation',
                model: 'gpt'
              }
            };
          }
        },
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'ChatGPT',
            title: 'ChatGPT',
            details: {
              primary: 'ChatGPT',
              secondary: null,
              path: null,
              id: 'chatgpt',
              type: 'general'
            }
          })
        }
      ]
    },

    'chatgpt.com': {
      name: 'ChatGPT',
      icon: '🤖',
      color: '#10a37f',
      groupBy: 'platform', // Group all chats into one workspace 
      patterns: [
        // Conversation/chat pattern (same as chat.openai.com)
        {
          name: 'conversation',
          test: (paths, url) => url.pathname.includes('/c/') || (paths[0] === 'c' && paths[1]),
          extract: (paths, url, domTitle) => {
            const match = url.pathname.match(/\/c\/([a-f0-9-]{8,})/);
            const chatId = match ? match[1].slice(0, 8) : (paths[1] ? paths[1].slice(0, 8) : 'unknown');

            let title = null;

            // Prefer DOM / history extracted title
            if (domTitle && domTitle.trim().length > 3) {
              if (!['ChatGPT', 'New chat'].includes(domTitle.trim())) {
                title = domTitle.trim();
              }
            }

            // If ?title query param exists (shared conversation links)
            if (!title && url.searchParams.has('title')) {
              title = decodeURIComponent(url.searchParams.get('title'));
            }

            // Fallback to <title> tag
            if (!title && typeof document !== 'undefined' && document.title) {
              const pageTitle = document.title.trim();
              if (pageTitle && !['ChatGPT', 'New chat'].includes(pageTitle)) {
                title = pageTitle;
              }
            }

            // Last resort → generic
            if (!title) {
              title = `Chat ${chatId}`;
            }

            return {
              workspace: 'ChatGPT',
              title,
              details: {
                primary: 'ChatGPT',
                secondary: title,
                path: paths.slice(2).join('/') || null,
                id: chatId,
                type: 'conversation',
                model: 'gpt'
              }
            };
          }

        },
        // GPTs/custom assistant pattern
        {
          name: 'gpts',
          test: (paths) => paths[0] === 'g' && paths[1],
          extract: (paths) => {
            const gptId = paths[1];
            const gptName = decodeURIComponent(paths[2] || 'Custom GPT').replace(/-/g, ' ');

            return {
              workspace: 'ChatGPT',
              title: gptName,
              details: {
                primary: 'GPTs',
                secondary: gptName,
                path: paths.slice(3).join('/') || null,
                id: gptId,
                type: 'assistant',
                model: 'custom-gpt'
              }
            };
          }
        },
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'ChatGPT',
            title: 'ChatGPT',
            details: {
              primary: 'ChatGPT',
              secondary: null,
              path: null,
              id: 'chatgpt',
              type: 'general'
            }
          })
        }
      ]
    },

    'claude.ai': {
      name: 'Claude',
      color: '#cc785c',
      groupBy: 'platform', // Group all chats into one workspace
      patterns: [
        {
          name: 'chat',
          test: (paths, url) => url.pathname.includes('/chat/'),
          extract: (paths, url) => {
            const match = url.pathname.match(/\/chat\/([a-f0-9-]{8,})/);
            const chatId = match ? match[1].slice(0, 8) : 'unknown';
            return {
              workspace: 'Claude',
              title: `Claude ${chatId}`,
              details: {
                primary: 'Claude',
                secondary: chatId,
                path: null,
                id: chatId,
                type: 'conversation'
              }
            };
          }
        },
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'Claude',
            title: 'Chats',
            details: {
              primary: 'Chats',
              secondary: null,
              path: null,
              id: 'claude',
              type: 'general'
            }
          })
        }
      ]
    },

    'gemini.google.com': {
      name: 'Gemini',
      color: '#4285F4',
      groupBy: 'platform', // Group all chats into one workspace
      patterns: [
        {
          name: 'chat',
          test: (paths) => paths[0] === 'app' && paths[1],
          extract: (paths) => {
            const chatId = paths[1].slice(0, 8);
            return {
              workspace: 'Gemini',
              title: `Gemini ${chatId}`,
              details: {
                primary: 'Gemini',
                secondary: chatId,
                path: null,
                id: chatId,
                type: 'conversation'
              }
            };
          }
        },
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'Gemini',
            title: 'Gemini',
            details: {
              primary: 'Gemini',
              secondary: null,
              path: null,
              id: 'gemini',
              type: 'general'
            }
          })
        }
      ]
    },

    'figma.com': {
      name: 'Figma',
      icon: '🎨',
      color: '#f24e1e',
      groupBy: 'platform', // Group all designs into one workspace
      patterns: [
        // Design file pattern (most specific)
        {
          name: 'design_file',
          test: (paths) => ['file', 'design'].includes(paths[0]) && paths[1] && paths[2],
          extract: (paths, url) => {
            const fileId = paths[1];
            let fileName = decodeURIComponent(paths[2]).replace(/-/g, ' ');

            return {
              workspace: 'Figma',
              title: fileName,
              details: {
                primary: 'Figma',
                secondary: fileName,
                path: paths.slice(3).join('/') || null,
                id: fileId,
                type: 'design',
                fileType: paths[0]
              }
            };
          }
        },
        // Prototype pattern
        {
          name: 'prototype',
          test: (paths) => paths[0] === 'proto' && paths[1],
          extract: (paths, url) => {
            const protoId = paths[1];
            return {
              workspace: 'Figma',
              title: 'Prototype View',
              details: {
                primary: 'Figma',
                secondary: 'Prototype',
                path: null,
                id: protoId,
                type: 'prototype'
              }
            };
          }
        },
        // Team/project dashboard
        {
          name: 'team',
          test: (paths) => ['team', 'project'].includes(paths[0]) && paths[1],
          extract: (paths) => {
            const teamId = paths[1];
            return {
              workspace: 'Figma',
              title: 'Figma Dashboard',
              details: {
                primary: 'Figma',
                secondary: 'Dashboard',
                path: null,
                id: teamId,
                type: 'team'
              }
            };
          }
        },
        // FigJam collaboration boards
        {
          name: 'figjam',
          test: (paths, url) => url.hostname.includes('figjam') || paths[0] === 'board',
          extract: (paths, url) => {
            const boardId = paths[1] || 'unknown';
            const boardName = decodeURIComponent(paths[2] || 'FigJam Board').replace(/-/g, ' ');

            return {
              workspace: 'Figma',
              title: boardName,
              details: {
                primary: 'FigJam',
                secondary: boardName,
                path: null,
                id: boardId,
                type: 'collaboration',
                boardType: 'figjam'
              }
            };
          }
        },
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'Figma',
            title: 'Figma',
            details: {
              primary: 'Figma',
              secondary: null,
              path: null,
              id: 'figma',
              type: 'general'
            }
          })
        }
      ]
    },

    'perplexity.ai': {
      name: 'Perplexity',
      icon: '🔍',
      color: '#6B5BFF',
      groupBy: 'platform', // Group all searches under Perplexity
      patterns: [
        // Thread/conversation pattern
        {
          name: 'thread',
          test: (paths, url) => paths.length >= 1 && paths[0].match(/^[a-f0-9-]{8,}$/),
          extract: (paths, url) => {
            const threadId = paths[0].slice(0, 8);
            const query = url.searchParams.get('q') || url.searchParams.get('s') || 'Search';
            const truncated = query.substring(0, 50) + (query.length > 50 ? '...' : '');

            return {
              workspace: 'Perplexity',
              title: truncated,
              details: {
                primary: 'Perplexity',
                secondary: truncated,
                path: paths.slice(1).join('/') || null,
                id: threadId,
                type: 'conversation',
                query: query
              }
            };
          }
        },
        // Search pattern with query
        {
          name: 'search',
          test: (paths, url) => paths[0] === 'search' || url.searchParams.has('q') || url.searchParams.has('s'),
          extract: (paths, url) => {
            const query = url.searchParams.get('q') || url.searchParams.get('s') || paths[1] || 'Search';
            const truncated = query.substring(0, 50) + (query.length > 50 ? '...' : '');

            return {
              workspace: 'Perplexity',
              title: truncated,
              details: {
                primary: 'Perplexity',
                secondary: truncated,
                path: null,
                id: `search-${Date.now()}`,
                type: 'conversation',
                query: query
              }
            };
          }
        },
        // Collections or saved searches
        {
          name: 'collections',
          test: (paths) => paths[0] === 'collections' && paths[1],
          extract: (paths) => {
            const collectionName = decodeURIComponent(paths[1]).replace(/-/g, ' ');
            return {
              workspace: collectionName,
              title: collectionName,
              details: {
                primary: 'Collections',
                secondary: collectionName,
                path: null,
                id: paths[1],
                type: 'collection'
              }
            };
          }
        },
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'Research',
            title: 'Research',
            details: {
              primary: 'Research',
              secondary: null,
              path: null,
              id: 'perplexity',
              type: 'general'
            }
          })
        }
      ]
    },

    'notion.so': {
      name: 'Notion',
      icon: '🗒️',
      color: '#000000',
      groupBy: 'platform', // Group all pages into one workspace
      patterns: [
        // Workspace page pattern (most specific)
        {
          name: 'workspace_page',
          test: (paths) => paths.length >= 2 && paths[1].length >= 32,
          extract: (paths, url) => {
            const workspaceName = decodeURIComponent(paths[0]).replace(/-/g, ' ');
            const pageId = paths[1].split('-').pop();
            const pageTitle = paths[1].split('-').slice(0, -1).join(' ') || 'Untitled';

            return {
              workspace: 'Notion',
              title: pageTitle,
              details: {
                primary: workspaceName,
                secondary: pageTitle,
                path: paths.slice(2).join('/') || null,
                id: pageId,
                type: 'document',
                workspace: workspaceName
              }
            };
          }
        },
        // Direct page pattern
        {
          name: 'page',
          test: (paths) => paths.length >= 1 && paths[0].length >= 32,
          extract: (paths, url) => {
            const pageId = paths[0].split('-').pop();
            const pageTitle = paths[0].split('-').slice(0, -1).join(' ') || 'Untitled';

            return {
              workspace: 'Notion',
              title: pageTitle,
              details: {
                primary: 'Notion',
                secondary: pageTitle,
                path: null,
                id: pageId,
                type: 'document'
              }
            };
          }
        },
        // Workspace pattern
        {
          name: 'workspace',
          test: (paths) => paths.length === 1,
          extract: (paths) => {
            const workspaceName = decodeURIComponent(paths[0]).replace(/-/g, ' ');
            return {
              workspace: 'Notion',
              title: workspaceName,
              details: {
                primary: workspaceName,
                secondary: 'Workspace',
                path: null,
                id: paths[0],
                type: 'workspace',
                workspace: workspaceName
              }
            };
          }
        },
        // Fallback
        {
          name: 'general',
          test: () => true,
          extract: () => ({
            workspace: 'Notion',
            title: 'Notion',
            details: {
              primary: 'Notion',
              secondary: null,
              path: null,
              id: 'notion',
              type: 'general'
            }
          })
        }
      ]
    }
  };

  /**
   * Parse a URL and return structured information
   * @param {string} url - URL to parse
   * @param {string} [domTitle] - Optional DOM title from the actual page
   * @returns {Object|null} - Parsed URL information or null
   */
  static parse(url, domTitle = null) {
    if (!url || typeof url !== 'string') return null;

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      const platformConfig = this.config[domain];

      if (!platformConfig) return null;

      const paths = urlObj.pathname.split('/').filter(Boolean);

      // Try patterns in order (most specific first)
      for (const pattern of platformConfig.patterns) {
        if (pattern.test(paths, urlObj)) {
          const extracted = pattern.extract(paths, urlObj, domTitle);

          return {
            url,
            platform: {
              id: domain.replace('.', '_'),
              name: platformConfig.name,
              icon: platformConfig.icon,
              color: platformConfig.color,
              domain
            },
            workspace: extracted.workspace,
            title: extracted.title,
            details: extracted.details,
            favicon: getFaviconUrl(url, 32),
            timestamp: Date.now()
          };
        }
      }
    } catch (error) {
      console.warn('Error parsing URL:', url, error);
    }

    return null;
  }

  /**
   * Parse multiple URLs and group them
   * @param {Array} urls - Array of URLs to parse
   * @returns {Object} - Grouped results with stats
   */
  static parseMultiple(urls) {
    if (!Array.isArray(urls)) return { groups: [], stats: { total: 0, parsed: 0 } };

    const groups = new Map();
    const stats = {
      total: urls.length,
      parsed: 0,
      byPlatform: {},
      byType: {},
      byWorkspace: {}
    };

    urls.forEach(url => {
      const parsed = this.parse(url);
      if (!parsed) return;

      stats.parsed++;

      // Update platform stats
      const platformName = parsed.platform.name;
      stats.byPlatform[platformName] = (stats.byPlatform[platformName] || 0) + 1;

      // Update type stats
      const type = parsed.details.type;
      stats.byType[type] = (stats.byType[type] || 0) + 1;

      // Update workspace stats
      const workspaceName = parsed.workspace;
      stats.byWorkspace[workspaceName] = (stats.byWorkspace[workspaceName] || 0) + 1;

      // Group by workspace (already determined by extraction logic)
      const workspaceKey = parsed.workspace;

      if (!groups.has(workspaceKey)) {
        groups.set(workspaceKey, {
          workspace: parsed.workspace,
          platform: parsed.platform,
          urls: [],
          favicon: parsed.favicon,
          type: parsed.details.type,
          groupBy: this.config[parsed.platform.domain]?.groupBy || 'platform'
        });
      }

      groups.get(workspaceKey).urls.push({
        url: parsed.url,
        title: parsed.title,
        details: parsed.details,
        timestamp: parsed.timestamp
      });
    });

    return {
      groups: Array.from(groups.values()).sort((a, b) => b.urls.length - a.urls.length),
      stats
    };
  }

  /**
   * Get all available platforms
   * @returns {Array} - Array of platform configurations
   */
  static getAllPlatforms() {
    return Object.entries(this.config).map(([domain, config]) => ({
      id: domain.replace('.', '_'),
      name: config.name,
      icon: config.icon,
      color: config.color,
      domain,
      groupBy: config.groupBy || 'platform',
      favicon: getFaviconUrl(`https://${domain}`, 32)
    }));
  }

  /**
   * Configure groupBy strategy for a specific platform
   * @param {string} domain - Platform domain (e.g., 'github.com')
   * @param {string} groupBy - Grouping strategy ('platform', 'owner', 'individual')
   */
  static setGroupingStrategy(domain, groupBy) {
    if (this.config[domain]) {
      this.config[domain].groupBy = groupBy;

      // Update GitHub patterns based on groupBy strategy
      if (domain === 'github.com') {
        const repoPattern = this.config[domain].patterns.find(p => p.name === 'repository');
        if (repoPattern) {
          if (groupBy === 'owner') {
            repoPattern.extract = (paths) => ({
              workspace: `@${paths[0]}`,
              title: `${paths[0]}/${paths[1]}`,
              details: {
                primary: paths[0],
                secondary: paths[1],
                path: paths.slice(2).join('/') || null,
                id: `${paths[0]}/${paths[1]}`,
                type: 'project',
                owner: paths[0],
                repo: paths[1]
              }
            });
          } else if (groupBy === 'individual') {
            repoPattern.extract = (paths) => ({
              workspace: `${paths[0]}/${paths[1]}`,
              title: `${paths[0]}/${paths[1]}`,
              details: {
                primary: paths[0],
                secondary: paths[1],
                path: paths.slice(2).join('/') || null,
                id: `${paths[0]}/${paths[1]}`,
                type: 'project',
                owner: paths[0],
                repo: paths[1]
              }
            });
          } else { // platform
            repoPattern.extract = (paths) => ({
              workspace: 'GitHub Projects',
              title: `${paths[0]}/${paths[1]}`,
              details: {
                primary: paths[0],
                secondary: paths[1],
                path: paths.slice(2).join('/') || null,
                id: `${paths[0]}/${paths[1]}`,
                type: 'project',
                owner: paths[0],
                repo: paths[1]
              }
            });
          }
        }
      }
    }
  }

  /**
   * Check if URL should be excluded globally
   * @param {string} url - URL to check
   * @returns {boolean} - Whether URL should be excluded
   */
  static shouldExclude(url) {
    if (!url) return true;

    const excludePatterns = [
      /chrome:\/\//,
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
      /\/login\/?$/,
      /\/logout\/?$/,
      /\/signup\/?$/,
      /utm_source=/,
      /utm_medium=/,
      /utm_campaign=/
    ];

    return excludePatterns.some(pattern => pattern.test(url));
  }

  /**
   * Auto-create workspaces from URLs (replaces workspaceAutoCreator)
   * @param {Array} urls - Array of URL strings
   * @param {Array} existingWorkspaces - Existing workspaces to check against
   * @returns {Array} - Array of workspace configurations to create
   */
  static createWorkspacesFromUrls(urls, existingWorkspaces = []) {
    if (!Array.isArray(urls)) return [];

    const { groups } = this.parseMultiple(urls);
    const existingNames = new Set(existingWorkspaces.map(ws => ws.name?.toLowerCase()));
    const workspacesToCreate = [];

    groups.forEach(group => {
      const normalizedName = group.workspace.toLowerCase();

      if (!existingNames.has(normalizedName)) {
        workspacesToCreate.push({
          name: group.workspace,
          description: `${group.platform.name} workspace`,
          gridType: 'ProjectGrid',
          urls: group.urls.map(urlData => ({
            url: urlData.url,
            title: urlData.title,
            addedAt: urlData.timestamp || Date.now(),
            favicon: group.favicon
          })),
          context: {
            platform: group.platform,
            type: group.type,
            createdFrom: 'auto_parser',
            autoCreated: true
          }
        });

        existingNames.add(normalizedName);
      }
    });

    return workspacesToCreate;
  }

  /**
   * Get cross-browser WebExtension API
   * @returns {Object|null} - Browser API object or null
   */
  static getBrowserAPI() {
    // Chrome/Chromium
    if (typeof chrome !== 'undefined' && chrome?.history) {
      return chrome;
    }

    // Firefox/Mozilla
    if (typeof browser !== 'undefined' && browser?.history) {
      return browser;
    }

    // Edge Legacy
    if (typeof msBrowser !== 'undefined' && msBrowser?.history) {
      return msBrowser;
    }

    return null;
  }

  /**
   * Scan browser history and create workspace suggestions (cross-browser)
   * @param {number} daysBack - How many days back to scan
   * @returns {Promise<Array>} - Array of workspace suggestions
   */
  static async scanBrowserHistory(daysBack = 30) {
    const browserAPI = this.getBrowserAPI();

    if (!browserAPI) {
      console.warn('Browser history API not available (requires WebExtension context)');
      return [];
    }

    try {
      const endTime = Date.now();
      const startTime = endTime - (daysBack * 24 * 60 * 60 * 1000);

      const historyItems = await browserAPI.history.search({
        text: '',
        startTime: startTime,
        endTime: endTime,
        maxResults: 1000
      });

      const urls = historyItems
        .map(item => item.url)
        .filter(url => url && !this.shouldExclude(url));

      console.log(`📚 Scanned ${historyItems.length} history items, found ${urls.length} valid URLs`);
      return urls;
    } catch (error) {
      console.error('Error scanning browser history:', error);
      return [];
    }
  }

  static async enrichWithHistory(url, title, browserAPI) {
    if (!browserAPI?.history) return { url, title };

    try {
      const historyItems = await browserAPI.history.search({
        text: url,
        maxResults: 5,
        startTime: Date.now() - (30 * 24 * 60 * 60 * 1000) // last 30 days
      });

      if (historyItems?.length) {
        const match = historyItems.find(h => h.url === url && h.title);
        if (match && match.title && match.title !== title) {
          return { url, title: match.title };
        }
      }
    } catch (err) {
      console.warn("History enrichment failed", err);
    }

    return { url, title };
  }
}

export default GenericUrlParser;