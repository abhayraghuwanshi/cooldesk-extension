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
          test: (paths, url) => {
            // Must have at least 2 paths (owner/repo) and no tab parameters
            return paths.length >= 2 && !url.search.includes('tab=');
          },
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
        // User profile pattern (only clean profile URLs)
        {
          name: 'user_profile',
          test: (paths, url) => {
            // Only match single-path user profiles without query parameters
            return paths.length === 1 && url.search === '';
          },
          extract: (paths) => ({
            workspace: 'GitHub',
            title: `@${paths[0]}`,
            details: {
              primary: paths[0],
              secondary: 'Profile',
              path: null,
              id: paths[0],
              type: 'user',
              username: paths[0]
            }
          })
        },
        // Fallback for root GitHub
        {
          name: 'general',
          test: (paths, url) => paths.length === 0 && url.search === '',
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
      excludeParams: ['model', 'q'],
      patterns: [
        // Conversation/chat pattern
        {
          name: 'conversation',
          test: (paths, url) => url.pathname.includes('/c/') || (paths[0] === 'c' && paths[1]),
          extract: (paths, url, domTitle) => {
            const match = url.pathname.match(/\/c\/([a-f0-9-]{8,})/);
            const chatId = match ? match[1] : (paths[1] || 'unknown');

            // Generate better title - prioritize meaningful browser titles
            let title = domTitle;

            // Check if browser title is meaningful (not generic platform names)
            const isGenericTitle = !title ||
              title === 'ChatGPT' || title === 'Claude' || title === 'Gemini' ||
              title === 'Perplexity' || title === 'Copilot' || title === 'Grok' ||
              title === 'New Chat' || title === 'Untitled' ||
              title.toLowerCase().includes('new chat') ||
              title.toLowerCase().includes('untitled') ||
              title.toLowerCase().includes('loading') ||
              title === 'chat.openai.com';

            // Debug logging to understand what's happening
            console.log('[GenericUrlParser] ChatGPT title processing:', {
              url: url.href,
              inputTitle: title,
              isGenericTitle,
              chatId
            });

            // If browser title is meaningful, keep it; otherwise extract from URL
            if (isGenericTitle || !title) {
              // Try URL title parameter (shared conversations)
              if (url.searchParams.has('title')) {
                const urlTitle = decodeURIComponent(url.searchParams.get('title'));
                if (urlTitle) {
                  title = urlTitle;
                } else {
                  // Use fallback title generation like sample-working.js
                  title = GenericUrlParser.generateFallbackTitle('ChatGPT', url, Date.now(), chatId);
                }
              } else {
                // Use fallback title generation like sample-working.js
                title = GenericUrlParser.generateFallbackTitle('ChatGPT', url, Date.now(), chatId);
              }
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
          test: (paths, url) => {
            // Exclude URLs with unnecessary query parameters
            if (url.searchParams.has('model') || url.searchParams.has('q')) {
              const qValue = url.searchParams.get('q');
              // Allow q parameter only if it has meaningful content
              if (qValue === 'undefined' || qValue === '' || qValue === null) {
                return false;
              }
            }
            return paths.length === 0; // Only match root domain
          },
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
      excludeParams: ['model', 'q'],
      patterns: [
        // Conversation/chat pattern (same as chat.openai.com)
        {
          name: 'conversation',
          test: (paths, url) => url.pathname.includes('/c/') || (paths[0] === 'c' && paths[1]),
          extract: (paths, url, domTitle) => {
            const match = url.pathname.match(/\/c\/([a-f0-9-]{8,})/);
            const chatId = match ? match[1] : (paths[1] || 'unknown');

            // Generate better title - prioritize meaningful browser titles
            let title = domTitle;

            // Check if browser title is meaningful (not generic platform names)
            const isGenericTitle = !title ||
              title === 'ChatGPT' || title === 'Claude' || title === 'Gemini' ||
              title === 'Perplexity' || title === 'Copilot' || title === 'Grok' ||
              title === 'New Chat' || title === 'Untitled' ||
              title.toLowerCase().includes('new chat') ||
              title.toLowerCase().includes('untitled') ||
              title.toLowerCase().includes('loading') ||
              title === 'chatgpt.com';

            // Debug logging to understand what's happening
            console.log('[GenericUrlParser] ChatGPT.com title processing:', {
              url: url.href,
              inputTitle: title,
              isGenericTitle,
              chatId
            });

            // If browser title is meaningful, keep it; otherwise extract from URL
            if (isGenericTitle || !title) {
              // Try URL title parameter (shared conversations)
              if (url.searchParams.has('title')) {
                const urlTitle = decodeURIComponent(url.searchParams.get('title'));
                if (urlTitle) {
                  title = urlTitle;
                } else {
                  // Use fallback title generation like sample-working.js
                  title = GenericUrlParser.generateFallbackTitle('ChatGPT', url, Date.now(), chatId);
                }
              } else {
                // Use fallback title generation like sample-working.js
                title = GenericUrlParser.generateFallbackTitle('ChatGPT', url, Date.now(), chatId);
              }
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
          test: (paths, url) => {
            // Exclude URLs with unnecessary query parameters
            if (url.searchParams.has('model') || url.searchParams.has('q')) {
              const qValue = url.searchParams.get('q');
              // Allow q parameter only if it has meaningful content
              if (qValue === 'undefined' || qValue === '' || qValue === null) {
                return false;
              }
            }
            return paths.length === 0; // Only match root domain
          },
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
      excludePaths: ['login', 'oauth', 'settings', 'recents', 'new', 'upgrade', 'billing', 'profile', 'account', 'terms', 'privacy'],
      patterns: [
        {
          name: 'chat',
          test: (paths, url) => url.pathname.includes('/chat/'),
          extract: (paths, url, domTitle) => {
            const match = url.pathname.match(/\/chat\/([a-f0-9-]+)/);
            const chatId = match ? match[1] : 'unknown';

            // Generate better title - prioritize meaningful browser titles
            let title = domTitle;

            // Check if browser title is meaningful (not generic platform names)
            const isGenericTitle = !title || GenericUrlParser.isGenericTitle(title);

            // If browser title is meaningful, keep it; otherwise extract from URL
            if (isGenericTitle || !title) {
              // Use fallback title generation like sample-working.js
              title = GenericUrlParser.generateFallbackTitle('Claude', url, Date.now(), chatId);
            }

            return {
              workspace: 'Claude',
              title: title,
              details: {
                primary: 'Claude',
                secondary: title,
                path: null,
                id: chatId,
                type: 'conversation'
              }
            };
          }
        },
        {
          name: 'general',
          test: (paths) => {
            // Exclude specific paths we don't want to categorize
            if (paths.length > 0 && this.config['claude.ai'].excludePaths.includes(paths[0])) {
              return false;
            }
            return true;
          },
          extract: () => ({
            workspace: 'Claude',
            title: 'Claude',
            details: {
              primary: 'Claude',
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
      excludeParams: ['node-id', 't', 'p', 'fuid', 'viewport'], // View parameters that create duplicates
      patterns: [
        // Design file pattern (most specific)
        {
          name: 'design_file',
          test: (paths, url) => {
            // Exclude URLs with view parameters that create duplicates
            if (url.searchParams.has('node-id') || url.searchParams.has('t') || url.searchParams.has('p') || url.searchParams.has('fuid')) {
              return false;
            }
            return ['file', 'design'].includes(paths[0]) && paths[1] && paths[2];
          },
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
          test: (paths, url) => {
            // Exclude URLs with view parameters that create duplicates
            if (url.searchParams.has('node-id') || url.searchParams.has('t') || url.searchParams.has('p') || url.searchParams.has('fuid')) {
              return false;
            }
            return paths[0] === 'proto' && paths[1];
          },
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
          test: (paths, url) => {
            // Exclude URLs with view parameters
            if (url.searchParams.has('fuid')) {
              return false;
            }
            return ['team', 'project'].includes(paths[0]) && paths[1];
          },
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
          test: (paths, url) => {
            // Exclude URLs with view parameters that create duplicates
            if (url.searchParams.has('node-id') || url.searchParams.has('t') || url.searchParams.has('p') || url.searchParams.has('fuid')) {
              return false;
            }
            return url.hostname.includes('figjam') || paths[0] === 'board';
          },
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
          test: (paths, url) => {
            // Only match clean root Figma URLs without view parameters
            return paths.length === 0 && !url.searchParams.has('node-id') && !url.searchParams.has('t') && !url.searchParams.has('p') && !url.searchParams.has('fuid');
          },
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
      excludeParams: ['pvs', 'showMoveTo', 'v', 'pm', 'tab'], // View/navigation parameters to ignore
      patterns: [
        // Workspace page pattern (most specific)
        {
          name: 'workspace_page',
          test: (paths, url) => {
            // Exclude URLs with view parameters that create duplicates
            if (url.searchParams.has('pvs') || url.searchParams.has('showMoveTo')) {
              return false;
            }
            return paths.length >= 2 && paths[1].length >= 32;
          },
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
          test: (paths, url) => {
            // Exclude URLs with view parameters that create duplicates
            if (url.searchParams.has('pvs') || url.searchParams.has('showMoveTo')) {
              return false;
            }
            return paths.length >= 1 && paths[0].length >= 32;
          },
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
          test: (paths, url) => {
            // Exclude URLs with view parameters
            if (url.searchParams.has('pvs') || url.searchParams.has('showMoveTo')) {
              return false;
            }
            return paths.length === 1;
          },
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
        // Fallback - only match clean root URLs
        {
          name: 'general',
          test: (paths, url) => {
            // Only match root notion.so without any paths or view parameters
            return paths.length === 0 && !url.searchParams.has('pvs') && !url.searchParams.has('showMoveTo');
          },
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
   * Generate fallback titles for AI chats (based on sample-working.js)
   * @param {string} platform - Platform name
   * @param {URL} url - URL object
   * @param {number} timestamp - Timestamp for title generation
   * @param {string} chatId - Chat ID if available
   * @returns {string} - Generated title
   */
  static generateFallbackTitle(platform, url, timestamp, chatId = null) {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Try to extract chat ID from URL first
    const chatIdMatch = url.href.match(/([a-f0-9-]{8,})/);
    if (chatIdMatch || chatId) {
      const id = chatId || chatIdMatch[1];
      return `${platform} Chat ${id.substring(0, 8)}`;
    }

    // Use fallback format with timestamp
    return `${platform} Chat - ${timeStr}`;
  }

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
   * Check if a title is generic/meaningless
   * @param {string} title - The title to check
   * @returns {boolean} - True if the title is generic
   */
  static isGenericTitle(title) {
    if (!title) return true;

    const exactGenericTitles = [
      'ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot', 'Grok',
      'New Chat', 'Untitled', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'Loading'
    ];

    const containsGenericPhrases = [
      'new chat', 'untitled', 'loading'
    ];

    // Check for exact matches (case insensitive)
    if (exactGenericTitles.some(generic => title.toLowerCase() === generic.toLowerCase())) {
      return true;
    }

    // Check for generic phrases (but not platform names in meaningful titles)
    if (containsGenericPhrases.some(phrase => title.toLowerCase().includes(phrase))) {
      return true;
    }

    // Special case: If title is just "Platform - Platform" format, it's generic
    const platformOnlyPattern = /^(ChatGPT|Claude|Gemini|Perplexity|Copilot|Grok)\s*-\s*(ChatGPT|Claude|Gemini|Perplexity|Copilot|Grok)$/i;
    if (platformOnlyPattern.test(title)) {
      return true;
    }

    return false;
  }

  /**
   * Format timestamp into human-readable "time ago" format
   * @param {number} timestamp - Timestamp in milliseconds
   * @returns {string} - Formatted time ago string
   */
  static formatTimeAgo(timestamp) {
    if (!timestamp) return 'unknown time';

    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }

  /**
   * Parse multiple URLs and group them
   * @param {Array} items - Array of URLs or items with url/title to parse
   * @returns {Object} - Grouped results with stats
   */
  static async parseMultiple(items) {
    if (!Array.isArray(items)) return { groups: [], stats: { total: 0, parsed: 0 } };

    const groups = new Map();
    const stats = {
      total: items.length,
      parsed: 0,
      byPlatform: {},
      byType: {},
      byWorkspace: {}
    };

    // Process items with existing titles and optional history enrichment
    const browserAPI = typeof chrome !== 'undefined' ? chrome : null;

    for (const item of items) {
      // Extract URL, title, and timing info from item (support both string URLs and item objects)
      const url = typeof item === 'string' ? item : item.url;
      const existingTitle = typeof item === 'object' ? item.title : null;
      const lastVisitTime = typeof item === 'object' ? item.lastVisitTime : null;
      const visitCount = typeof item === 'object' ? item.visitCount : null;

      let finalTitle = existingTitle;

      // Always enrich ChatGPT and Claude URLs to get the best possible titles
      const isChatGPT = url.includes('chatgpt.com') || url.includes('chat.openai.com');
      const isClaude = url.includes('claude.ai');

      if (browserAPI && (isChatGPT || isClaude)) {
        try {
          const platform = isChatGPT ? 'ChatGPT' : 'Claude';
          console.log(`[GenericUrlParser] Enriching ${platform} URL: ${url} (existing: "${existingTitle}")`);
          const enriched = await this.enrichWithHistory(url, existingTitle, browserAPI);
          if (enriched.title && !this.isGenericTitle(enriched.title)) {
            console.log(`[GenericUrlParser] Using enriched title: "${enriched.title}"`);
            finalTitle = enriched.title;
          } else {
            console.log(`[GenericUrlParser] Enriched title was generic or null: "${enriched.title}"`);
          }
        } catch (err) {
          console.warn('History enrichment failed for:', url, err);
        }
      }

      const parsed = this.parse(url, finalTitle);
      if (!parsed) {
        continue;
      }

      // Enhance ChatGPT and Claude titles with timing information
      if ((isChatGPT || isClaude) && lastVisitTime) {
        const timeAgo = this.formatTimeAgo(lastVisitTime);

        // Add timing info as subtitle/metadata but keep original title clean
        parsed.subtitle = `Last accessed ${timeAgo}`;
        parsed.lastVisitTime = lastVisitTime;
        parsed.visitCount = visitCount || 1;
      }

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
        subtitle: parsed.subtitle,
        details: parsed.details,
        timestamp: parsed.timestamp,
        lastVisitTime: parsed.lastVisitTime,
        visitCount: parsed.visitCount
      });
    }

    const result = {
      groups: Array.from(groups.values()).sort((a, b) => b.urls.length - a.urls.length),
      stats
    };

    console.log(`[GenericUrlParser] parseMultiple result:`, {
      totalGroups: result.groups.length,
      chatgptGroups: result.groups.filter(g => g.platform?.name === 'ChatGPT').length,
      stats: result.stats
    });

    return result;
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
      // Browser internal URLs
      /chrome:\/\//,
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
      /edge:\/\//,
      /about:/,
      
      // OAuth and authentication URLs
      /\/o\/oauth2\//,
      /\/oauth\//,
      /\/auth\//,
      /\/sso\//,
      /accounts\.google\.com\/o\/oauth2/,
      /accounts\.google\.com\/signin/,
      /login\.microsoftonline\.com/,
      /github\.com\/login\/oauth/,
      /facebook\.com\/v\d+\.\d+\/dialog\/oauth/,
      /twitter\.com\/oauth/,
      /linkedin\.com\/oauth/,
      
      // Login, logout, signup pages
      /\/login\/?(\?.*)?$/,
      /\/logout\/?(\?.*)?$/,
      /\/signup\/?(\?.*)?$/,
      /\/signin\/?(\?.*)?$/,
      /\/signout\/?(\?.*)?$/,
      /\/register\/?(\?.*)?$/,
      /\/auth\/.*$/,
      
      // Settings and configuration pages
      /\/settings\//,
      /\/config\//,
      /\/admin\//,
      /\/preferences\//,
      /\/account\//,
      /\/billing\//,
      /\/profile\//,
      /\/user\//,
      
      // API endpoints and callbacks
      /\/api\//,
      /\/callback/,
      /\/redirect/,
      /\/return/,
      /\/finish_.*_sso/,
      
      // Marketing and tracking URLs
      /utm_source=/,
      /utm_medium=/,
      /utm_campaign=/,
      /utm_term=/,
      /utm_content=/,
      /fbclid=/,
      /gclid=/,
      /msclkid=/,
      
      // Temporary and session URLs
      /storagerelay:/,
      /\/tmp\//,
      /\/temp\//,
      /sessionid=/,
      /session_token=/,
      /access_token=/,
      /refresh_token=/,
      
      // Privacy and legal pages
      /\/privacy/,
      /\/terms/,
      /\/cookies/,
      /\/legal/,
      /\/policy/,
      
      // Development and testing
      /localhost/,
      /127\.0\.0\.1/,
      /192\.168\./,
      /\.local/,
      /staging\./,
      /test\./,
      /dev\./,
      
      // File downloads and resources
      /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|tar|gz)(\?|#|$)/i,
      /\/download/,
      /\/uploads\//,
      /\/assets\//,
      /\/static\//,
      /\/media\//,
      
      // Error and status pages
      /\/404/,
      /\/500/,
      /\/error/,
      /\/maintenance/,
      /\/status/,
      
      // Specific known problematic patterns from Claude
      /claude\.ai\/login/,
      /claude\.ai\/oauth/,
      /claude\.ai\/settings/,
      /claude\.ai\/recents/,
      /claude\.ai\/new$/,
      /claude\.ai\/upgrade/,
      
      // ChatGPT URLs with unnecessary parameters
      /chatgpt\.com\/\?model=/,
      /chatgpt\.com\/\?q=undefined/,
      /chat\.openai\.com\/\?model=/,
      
      // GitHub auxiliary URLs that are not useful for workspaces
      /github\.com\/.*\/tree\//,
      /github\.com\/.*\/blob\//,
      /github\.com\/.*\/commits\//,
      /github\.com\/.*\/commit\//,
      /github\.com\/.*\/branches/,
      /github\.com\/.*\/tags/,
      /github\.com\/.*\/releases/,
      /github\.com\/.*\/issues\//,
      /github\.com\/.*\/pull\//,
      /github\.com\/.*\/actions/,
      /github\.com\/.*\/security/,
      /github\.com\/.*\/insights/,
      /github\.com\/.*\/settings/,
      /github\.com\/.*\/network/,
      /github\.com\/.*\/graphs/,
      /github\.com\/.*\/pulse/,
      /github\.com\/.*\/wiki/,
      /github\.com\/.*\/projects/,
      /github\.com\/.*\/compare/,
      /github\.com\/.*\/stargazers/,
      /github\.com\/.*\/watchers/,
      /github\.com\/.*\/forks/,
      /\?tab=readme/,
      /\?tab=code/,
      /\?tab=issues/,
      /\?tab=pulls/,
      /\?tab=actions/,
      /\?tab=projects/,
      /\?tab=wiki/,
      /\?tab=security/,
      /\?tab=insights/,
      /\?tab=settings/,
      /\?tab=overview/,
      /\?tab=repositories/,
      /\?tab=stars/,
      /\?tab=followers/,
      /\?tab=following/,
      /\?tab=packages/,
      /\?tab=sponsors/,
      /github\.com\/.*\?.*from=.*&to=/,  // Date range parameters like ?from=2024-12-01&to=2024-12-31
      /github\.com\/.*\?.*type=source/,   // Repository type filters
      /github\.com\/.*\?.*sort=updated/,  // Sorting parameters
      /github\.com\/.*\?.*q=/,            // Search query parameters
      /#start-of-content$/,
      /#readme$/,
      
      // Generic OAuth providers
      /auth0\.com/,
      /okta\.com/,
      /\.auth\./,
      /sso\./,
      
      // Session and state parameters (these are usually temporary URLs)
      /state=/,
      /code=/,
      /token=/,
      /nonce=/,
      /session=/,
      
      // Notion view parameters that create duplicates
      /notion\.so\/.*\?pvs=/,           // Private view parameters like ?pvs=12
      /notion\.so\/.*\?showMoveTo=/,    // Move dialog parameters
      /notion\.so\/.*\?.*&pvs=/,        // pvs in combination with other params
      /notion\.so\/.*\?.*&showMoveTo=/, // showMoveTo in combination
      /notion\.so\/.*showMoveTo=/,      // showMoveTo anywhere in query string
      
      // Figma view parameters that create duplicates
      /figma\.com\/.*\?node-id=/,       // Node selection parameters
      /figma\.com\/.*\?t=/,             // View/frame parameters 
      /figma\.com\/.*\?p=/,             // Prototype parameters
      /figma\.com\/.*\?fuid=/,          // User ID parameters
      /figma\.com\/.*\?.*&node-id=/,    // node-id in combination
      /figma\.com\/.*\?.*&t=/,          // t parameter in combination
      /figma\.com\/.*\?.*&p=/,          // p parameter in combination
      /figma\.com\/.*\?.*&fuid=/,       // fuid parameter in combination
    ];

    return excludePatterns.some(pattern => pattern.test(url));
  }

  /**
   * Auto-create workspaces from URLs (replaces workspaceAutoCreator)
   * @param {Array} urls - Array of URL strings
   * @param {Array} existingWorkspaces - Existing workspaces to check against
   * @returns {Array} - Array of workspace configurations to create
   */
  static async createWorkspacesFromUrls(urls, existingWorkspaces = []) {
    if (!Array.isArray(urls)) return [];
    if (!Array.isArray(existingWorkspaces)) existingWorkspaces = [];

    // Filter out URLs that should be excluded (OAuth, login, settings, etc.)
    const filteredUrls = urls.filter(url => url && !this.shouldExclude(url));

    console.log('[GenericUrlParser] createWorkspacesFromUrls processing:', filteredUrls.length, 'URLs');
    const { groups } = await GenericUrlParser.parseMultiple(filteredUrls);
    console.log('[GenericUrlParser] createWorkspacesFromUrls got', groups?.length || 0, 'groups');

    if (!Array.isArray(groups)) {
      console.warn('[GenericUrlParser] createWorkspacesFromUrls: groups is not an array:', groups);
      return [];
    }

    const existingNames = new Set(existingWorkspaces.map(ws => ws.name?.toLowerCase()));
    const workspacesToCreate = [];

    groups.forEach(group => {
      const normalizedName = group.workspace.toLowerCase();

      if (!existingNames.has(normalizedName)) {
        workspacesToCreate.push({
          name: group.workspace,
          description: `${group.platform.name} workspace`,
          gridType: 'ProjectGrid',
          urls: Array.isArray(group.urls) ? group.urls.map(urlData => ({
            url: urlData.url,
            title: urlData.title,
            addedAt: urlData.timestamp || Date.now(),
            favicon: group.favicon
          })) : []
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
      // Debug logging to see what we're searching for
      console.log('[GenericUrlParser] enrichWithHistory searching for:', url);

      const historyItems = await browserAPI.history.search({
        text: url,
        maxResults: 10,
        startTime: Date.now() - (30 * 24 * 60 * 60 * 1000) // last 30 days
      });

      console.log('[GenericUrlParser] enrichWithHistory found:', historyItems?.length || 0, 'items');

      if (historyItems?.length) {
        // Find exact URL match first
        let match = historyItems.find(h => h.url === url && h.title && h.title.trim().length > 0);

        // If no exact match, try partial match for ChatGPT conversation IDs
        if (!match && url.includes('/c/')) {
          const conversationId = url.match(/\/c\/([a-f0-9-]+)/)?.[1];
          if (conversationId) {
            match = historyItems.find(h =>
              h.url && h.url.includes(conversationId) &&
              h.title && h.title.trim().length > 0 &&
              h.title !== 'ChatGPT' && h.title !== 'New Chat'
            );
          }
        }

        // If no exact match, try partial match for Claude conversation IDs
        if (!match && url.includes('/chat/')) {
          const conversationId = url.match(/\/chat\/([a-f0-9-]+)/)?.[1];
          if (conversationId) {
            match = historyItems.find(h =>
              h.url && h.url.includes(conversationId) &&
              h.title && h.title.trim().length > 0 &&
              h.title !== 'Claude' && h.title !== 'New Chat'
            );
          }
        }

        if (match && match.title) {
          console.log('[GenericUrlParser] enrichWithHistory found title:', match.title, 'for URL:', url);
          return { url, title: match.title };
        }
      }
    } catch (err) {
      console.warn("History enrichment failed", err);
    }

    console.log('[GenericUrlParser] enrichWithHistory no title found, using fallback for:', url);
    return { url, title };
  }
}

export default GenericUrlParser;