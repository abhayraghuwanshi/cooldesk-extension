import workspacePatterns from '../data/workspace-patterns.json';
import { getFaviconUrl } from '../utils';

/**
 * Unified workspace URL parser using the new configuration system
 */

// Cache for compiled regex patterns
const patternCache = new Map();

/**
 * Get compiled regex pattern (cached)
 */
function getCompiledPattern(pattern) {
  if (!patternCache.has(pattern)) {
    try {
      patternCache.set(pattern, new RegExp(pattern));
    } catch (error) {
      console.warn(`Invalid regex pattern: ${pattern}`, error);
      return null;
    }
  }
  return patternCache.get(pattern);
}

/**
 * Check if URL matches any global exclude patterns
 */
function isGloballyExcluded(url) {
  return workspacePatterns.globalExcludes.some(pattern => {
    const regex = getCompiledPattern(pattern);
    return regex && regex.test(url);
  });
}

/**
 * Check if URL matches platform patterns
 */
function matchesPlatformPatterns(url, platform) {
  // Check include patterns
  const includeMatches = platform.patterns.include.some(pattern => {
    const regex = getCompiledPattern(pattern);
    return regex && regex.test(url);
  });

  if (!includeMatches) return false;

  // Check exclude patterns
  const excludeMatches = platform.patterns.exclude.some(pattern => {
    const regex = getCompiledPattern(pattern);
    return regex && regex.test(url);
  });

  return !excludeMatches;
}

/**
 * Extract information from URL using platform extraction config
 */
function extractFromUrl(url, platform) {
  const { extraction } = platform;
  if (!extraction) return null;

  try {
    const urlObj = new URL(url);

    switch (extraction.type) {
      case 'chatId': {
        const regex = getCompiledPattern(extraction.pattern);
        const match = regex ? url.match(regex) : null;
        if (match && match[1]) {
          const id = match[1].substring(0, 8);
          return {
            id,
            title: extraction.titleFormat.replace('{id}', id),
            project: extraction.projectFormat
          };
        }
        break;
      }

      case 'queryParam': {
        const paramValue = urlObj.searchParams.get(extraction.parameter);
        if (paramValue) {
          const decodedValue = decodeURIComponent(paramValue);
          const truncated = extraction.maxLength 
            ? decodedValue.substring(0, extraction.maxLength) + (decodedValue.length > extraction.maxLength ? '...' : '')
            : decodedValue;
          return {
            query: truncated,
            title: extraction.titleFormat.replace('{query}', truncated),
            project: extraction.projectFormat
          };
        }
        return {
          title: extraction.fallback || extraction.projectFormat,
          project: extraction.projectFormat
        };
      }

      case 'pathSegments': {
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const segments = {};
        extraction.segments.forEach((segmentIndex, i) => {
          if (pathParts[segmentIndex - 1]) {
            segments[`segment${i}`] = pathParts[segmentIndex - 1];
          }
        });

        if (extraction.segments.length === 2 && pathParts[0] && pathParts[1]) {
          const owner = pathParts[0];
          const repo = pathParts[1];
          return {
            owner,
            repo,
            title: extraction.titleFormat.replace('{owner}', owner).replace('{repo}', repo),
            project: extraction.projectFormat.replace('{owner}', owner).replace('{repo}', repo),
            segments
          };
        }
        break;
      }

      case 'figmaFile': {
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if ((pathParts[0] === 'file' || pathParts[0] === 'design') && pathParts.length >= 3) {
          const fileId = pathParts[1];
          const fileName = decodeURIComponent(pathParts[2])
            .replace(/[?#].*$/, '')
            .replace(/-/g, ' ');
          return {
            fileId,
            fileName,
            title: extraction.titleFormat.replace('{fileName}', fileName),
            project: extraction.projectFormat.replace('{fileName}', fileName)
          };
        } else if (pathParts[0] === 'proto' && pathParts.length >= 2) {
          const fileId = pathParts[1];
          return {
            fileId,
            fileName: 'Figma Prototype',
            title: 'Figma Prototype',
            project: 'Figma Prototype'
          };
        }
        break;
      }

      case 'jiraProject': {
        const match = urlObj.pathname.match(/\/browse\/([A-Z]+)-/) || 
                     urlObj.pathname.match(/\/projects\/([A-Z]+)/);
        if (match) {
          const projectKey = match[1];
          const domain = urlObj.hostname.split('.')[0];
          return {
            projectKey,
            domain,
            title: extraction.titleFormat.replace('{projectKey}', projectKey),
            project: extraction.projectFormat.replace('{projectKey}', projectKey)
          };
        }
        break;
      }

      case 'trelloBoard': {
        const match = urlObj.pathname.match(/\/b\/([a-zA-Z0-9]+)\/([^\/]+)/);
        if (match) {
          const boardId = match[1];
          const boardName = decodeURIComponent(match[2]).replace(/-/g, ' ');
          return {
            boardId,
            boardName,
            title: extraction.titleFormat.replace('{boardName}', boardName),
            project: extraction.projectFormat.replace('{boardName}', boardName)
          };
        }
        break;
      }

      case 'notionPage': {
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 1) {
          const pageId = pathParts[pathParts.length - 1];
          const workspaceName = pathParts.length >= 2 ? pathParts[0] : 'Personal';
          const pageName = pathParts.length >= 2 ? pathParts[1] : pageId;
          return {
            pageId,
            workspaceName,
            pageName,
            title: extraction.titleFormat.replace('{pageName}', pageName),
            project: extraction.projectFormat.replace('{workspaceName}', workspaceName)
          };
        }
        break;
      }

      case 'slackWorkspace': {
        const workspaceName = urlObj.hostname.split('.')[0];
        return {
          workspaceName,
          title: extraction.titleFormat.replace('{workspaceName}', workspaceName),
          project: extraction.projectFormat.replace('{workspaceName}', workspaceName)
        };
      }

      case 'discordServer': {
        const match = urlObj.pathname.match(/\/channels\/(\d+)/);
        if (match) {
          const serverId = match[1];
          const serverIdShort = serverId.slice(-4);
          return {
            serverId,
            serverIdShort,
            title: extraction.titleFormat.replace('{serverIdShort}', serverIdShort),
            project: extraction.projectFormat.replace('{serverIdShort}', serverIdShort)
          };
        }
        break;
      }

      case 'fallback': {
        return {
          title: extraction.titleFormat,
          project: extraction.projectFormat
        };
      }
    }
  } catch (error) {
    console.error('Error extracting from URL:', error);
  }

  return null;
}

/**
 * Parse a single URL and return workspace information
 */
export function parseUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // Check global excludes
  if (isGloballyExcluded(url)) return null;

  // Find matching platform
  for (const category of workspacePatterns.categories) {
    for (const platform of category.platforms) {
      if (matchesPlatformPatterns(url, platform)) {
        const extracted = extractFromUrl(url, platform);
        
        return {
          url,
          category: {
            id: category.id,
            name: category.name,
            icon: category.icon
          },
          platform: {
            id: platform.id,
            name: platform.name,
            color: platform.color,
            icon: platform.icon,
            domains: platform.domains
          },
          extracted: extracted || {},
          workspace: {
            type: platform.workspace.type,
            groupBy: platform.workspace.groupBy,
            autoCreate: platform.workspace.autoCreate,
            gridType: platform.workspace.gridType || 'ItemGrid'
          },
          favicon: getFaviconUrl(url, 32)
        };
      }
    }
  }

  return null;
}

/**
 * Parse multiple URLs and group them by workspace
 */
export function parseUrls(urls) {
  if (!Array.isArray(urls)) return { groups: [], stats: {} };

  const groups = new Map();
  const stats = {
    total: urls.length,
    parsed: 0,
    byCategory: {},
    byPlatform: {}
  };

  urls.forEach(url => {
    const parsed = parseUrl(url);
    if (!parsed) return;

    stats.parsed++;
    
    // Update category stats
    const categoryId = parsed.category.id;
    stats.byCategory[categoryId] = (stats.byCategory[categoryId] || 0) + 1;
    
    // Update platform stats
    const platformId = parsed.platform.id;
    stats.byPlatform[platformId] = (stats.byPlatform[platformId] || 0) + 1;

    // Determine grouping key
    let groupKey;
    switch (parsed.workspace.groupBy) {
      case 'owner':
        groupKey = parsed.extracted.owner || parsed.platform.name;
        break;
      case 'project':
        groupKey = parsed.extracted.project || parsed.platform.name;
        break;
      case 'workspace':
        groupKey = parsed.extracted.workspaceName || parsed.platform.name;
        break;
      case 'server':
        groupKey = parsed.extracted.serverId || parsed.platform.name;
        break;
      case 'platform':
      default:
        groupKey = parsed.platform.name;
        break;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        name: groupKey,
        category: parsed.category,
        platform: parsed.platform,
        workspace: parsed.workspace,
        urls: [],
        favicon: parsed.favicon,
        gridType: parsed.workspace.gridType || 'ItemGrid'
      });
    }

    groups.get(groupKey).urls.push({
      url,
      title: parsed.extracted.title || url,
      extracted: parsed.extracted,
      timestamp: Date.now()
    });
  });

  return {
    groups: Array.from(groups.values()).sort((a, b) => b.urls.length - a.urls.length),
    stats
  };
}

/**
 * Get all available platforms grouped by category
 */
export function getAllPlatforms() {
  return workspacePatterns.categories.map(category => ({
    ...category,
    platforms: category.platforms.map(platform => ({
      ...platform,
      favicon: getFaviconUrl(`https://${platform.domains[0]}`, 32)
    }))
  }));
}

/**
 * Get platform by ID
 */
export function getPlatformById(platformId) {
  for (const category of workspacePatterns.categories) {
    const platform = category.platforms.find(p => p.id === platformId);
    if (platform) {
      return {
        ...platform,
        category: {
          id: category.id,
          name: category.name,
          icon: category.icon
        },
        favicon: getFaviconUrl(`https://${platform.domains[0]}`, 32)
      };
    }
  }
  return null;
}

/**
 * Create workspace configuration from parsed URL data
 */
export function createWorkspaceConfig(groupData) {
  return {
    id: groupData.key,
    name: groupData.name,
    description: `${groupData.platform.name} workspace`,
    type: groupData.workspace.type,
    platform: groupData.platform,
    category: groupData.category,
    urls: groupData.urls,
    favicon: groupData.favicon,
    createdAt: Date.now(),
    autoCreated: groupData.workspace.autoCreate
  };
}