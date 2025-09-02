/**
 * Dynamic Project Categorization System
 * Automatically detects and creates workspaces based on URL patterns
 */
export const PROJECT_CATEGORIES = [
  {
    id: 'github',
    name: 'GitHub Repository',
    detect: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname === 'github.com') {
          const pathParts = u.pathname.split('/').filter(Boolean);
          if (pathParts.length >= 2) {
            return {
              projectId: `${pathParts[0]}/${pathParts[1]}`,
              projectName: `${pathParts[0]}/${pathParts[1]}`,
              owner: pathParts[0],
              repo: pathParts[1],
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'GitHub',
      description: `GitHub projects and repositories`,
      context: {
        ...context,
        repository: context.projectId,
        type: 'github',
        createdFrom: 'auto_github',
        projectName: context.projectName
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return u.hostname === 'github.com' && url.includes(context.projectId);
      } catch {
        return false;
      }
    }
  },

  {
    id: 'figma',
    name: 'Figma Design',
    detect: (url) => {
      try {
        const u = new URL(url);
        if ((u.hostname === 'www.figma.com' || u.hostname === 'figma.com')) {
          // Handle various Figma URL patterns
          if (u.pathname.startsWith('/design/')) {
            // Design files: /design/{file-id}/{file-name}
            const pathParts = u.pathname.split('/');
            if (pathParts.length >= 3) {
              const projectId = pathParts[2];
              const projectNameFromUrl = pathParts[3] || 'Untitled Design';
              const projectName = decodeURIComponent(projectNameFromUrl)
                .replace(/[?#].*$/, '')
                .replace(/-/g, ' ');
              return {
                projectId,
                projectName: projectName || 'Untitled Design',
              };
            }
          } else if (u.pathname.startsWith('/file/')) {
            // File URLs: /file/{file-id}/{file-name}
            const pathParts = u.pathname.split('/');
            if (pathParts.length >= 3) {
              const projectId = pathParts[2];
              const projectNameFromUrl = pathParts[3] || 'Untitled File';
              const projectName = decodeURIComponent(projectNameFromUrl)
                .replace(/[?#].*$/, '')
                .replace(/-/g, ' ');
              return {
                projectId,
                projectName: projectName || 'Untitled File',
              };
            }
          } else if (u.pathname.startsWith('/proto/')) {
            // Prototype URLs: /proto/{file-id}
            const pathParts = u.pathname.split('/');
            if (pathParts.length >= 3) {
              const projectId = pathParts[2];
              return {
                projectId,
                projectName: 'Figma Prototype',
              };
            }
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'Figma',
      description: `Design projects and prototypes`,
      context: {
        ...context,
        type: 'figma',
        createdFrom: 'auto_figma',
        projectName: context.projectName
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return (u.hostname === 'www.figma.com' || u.hostname === 'figma.com') && 
               url.includes(context.projectId);
      } catch {
        return false;
      }
    }
  },

  {
    id: 'jira',
    name: 'Jira Project',
    detect: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname.includes('atlassian.net') && u.pathname.includes('/browse/')) {
          const match = u.pathname.match(/\/browse\/([A-Z]+)-/);
          if (match) {
            const projectKey = match[1];
            const domain = u.hostname.split('.')[0];
            return {
              projectId: projectKey,
              projectName: projectKey,
              domain,
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'Jira',
      description: `Project management and issue tracking`,
      context: {
        ...context,
        type: 'jira',
        createdFrom: 'auto_jira',
        projectName: context.projectName,
        domain: context.domain
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return u.hostname.includes('atlassian.net') && 
               (url.includes(`/browse/${context.projectId}-`) || 
                url.includes(`/projects/${context.projectId}`));
      } catch {
        return false;
      }
    }
  },

  {
    id: 'notion',
    name: 'Notion Workspace',
    detect: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname === 'www.notion.so') {
            const pathParts = u.pathname.split('/').filter(Boolean);
          if (pathParts.length >= 1) {
            const pageId = pathParts[pathParts.length - 1];
            const workspaceName = pathParts.length >= 2 ? pathParts[0] : 'Personal';
            return {
              projectId: workspaceName,
              projectName: workspaceName,
              pageId,
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'Notion',
      description: `Documentation and knowledge management`,
      context: {
        ...context,
        type: 'notion',
        createdFrom: 'auto_notion',
        projectName: context.projectName
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return u.hostname === 'www.notion.so' && 
               (url.includes(context.projectId) || url.includes(context.pageId));
      } catch {
        return false;
      }
    }
  },

  {
    id: 'trello',
    name: 'Trello Board',
    detect: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname === 'trello.com' && u.pathname.includes('/b/')) {
          const match = u.pathname.match(/\/b\/([a-zA-Z0-9]+)\/([^\/]+)/);
          if (match) {
            const boardId = match[1];
            const boardName = decodeURIComponent(match[2])
              .replace(/-/g, ' ');
            return {
              projectId: boardId,
              projectName: boardName,
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'Trello',
      description: `Project boards and task management`,
      context: {
        ...context,
        type: 'trello',
        createdFrom: 'auto_trello',
        projectName: context.projectName
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return u.hostname === 'trello.com' && url.includes(context.projectId);
      } catch {
        return false;
      }
    }
  },

  {
    id: 'slack',
    name: 'Slack Workspace',
    detect: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname.endsWith('.slack.com')) {
          const workspaceName = u.hostname.split('.')[0];
          return {
            projectId: workspaceName,
            projectName: workspaceName,
          };
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'Slack',
      description: `Team communication and collaboration`,
      context: {
        ...context,
        type: 'slack',
        createdFrom: 'auto_slack',
        projectName: context.projectName
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return u.hostname === `${context.projectId}.slack.com`;
      } catch {
        return false;
      }
    }
  },

  {
    id: 'discord',
    name: 'Discord Server',
    detect: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname === 'discord.com' && u.pathname.includes('/channels/')) {
          const match = u.pathname.match(/\/channels\/(\d+)/);
          if (match) {
            const serverId = match[1];
            return {
              projectId: serverId,
              projectName: `Server ${serverId.slice(-4)}`,
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    createWorkspace: (context) => ({
      name: 'Discord',
      description: `Community servers and voice channels`,
      context: {
        ...context,
        type: 'discord',
        createdFrom: 'auto_discord',
        projectName: context.projectName
      }
    }),
    matchUrl: (url, context) => {
      try {
        const u = new URL(url);
        return u.hostname === 'discord.com' && url.includes(context.projectId);
      } catch {
        return false;
      }
    }
  }
];

/**
 * Detect project from URL using all available categories
 * @param {string} url - The URL to analyze
 * @returns {Object|null} - Project detection result or null
 */
export const detectProject = (url) => {
  for (const category of PROJECT_CATEGORIES) {
    const result = category.detect(url);
    if (result) {
      return {
        category: category.id,
        categoryName: category.name,
        ...result,
        workspace: category.createWorkspace(result)
      };
    }
  }
  return null;
};

/**
 * Check if a URL matches an existing project context
 * @param {string} url - The URL to check
 * @param {Object} projectContext - The project context to match against
 * @returns {boolean} - Whether the URL matches the project
 */
export const matchesProject = (url, projectContext) => {
  if (!projectContext?.type) return false;
  
  const category = PROJECT_CATEGORIES.find(cat => cat.id === projectContext.type);
  return category ? category.matchUrl(url, projectContext) : false;
};

/**
 * Get all URLs from data that belong to a specific project
 * @param {Array} data - Array of data items (history/bookmarks)
 * @param {Object} projectContext - The project context to match
 * @returns {Array} - Filtered array of matching items
 */
export const getProjectUrls = (data, projectContext) => {
  if (!Array.isArray(data) || !projectContext) return [];
  
  return data.filter(item => {
    if (!item.url) return false;
    return matchesProject(item.url, projectContext);
  });
};

/**
 * Analyze data and find all potential projects
 * @param {Array} data - Array of data items to analyze
 * @param {Array} existingWorkspaces - Array of existing workspaces to avoid duplicates
 * @returns {Map} - Map of project names to project data
 */
export const analyzeForProjects = (data, existingWorkspaces = []) => {
  if (!Array.isArray(data)) return new Map();
  
  const existingNames = new Set(existingWorkspaces.map(ws => ws.name.toLowerCase()));
  const projectsToCreate = new Map();
  const projectsByType = new Map();
  
  data.forEach(item => {
    if (!item.url) return;
    
    const detection = detectProject(item.url);
    if (!detection) return;
    
    const workspaceName = detection.workspace.name;
    const projectName = detection.projectName;
    
    if (existingNames.has(workspaceName.toLowerCase())) {
      return;
    }
    
    if (!projectsToCreate.has(workspaceName)) {
      projectsToCreate.set(workspaceName, {
        ...detection.workspace,
        detection,
        urls: [],
        projects: new Set()
      });
    }
    
    // Track individual projects within the workspace
    const workspace = projectsToCreate.get(workspaceName);
    workspace.projects.add(projectName);
    
    // Add URL as an object with metadata (not just string)
    let favicon = item.favIconUrl || item.favicon;
    if (!favicon) {
      try {
        const urlObj = new URL(item.url);
        favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
      } catch {
        favicon = null;
      }
    }
    
    const urlObj = {
      url: item.url,
      title: item.title || item.url,
      favicon,
      addedAt: Date.now()
    };
    workspace.urls.push(urlObj);
  });
  
  // Convert projects Set to Array for serialization
  projectsToCreate.forEach((workspace, name) => {
    workspace.projects = Array.from(workspace.projects);
  });
  
  return projectsToCreate;
};

/**
 * Create workspaces automatically from browser URLs
 * @param {Array} browserUrls - Array of URL strings from browser history/bookmarks
 * @param {Array} existingWorkspaces - Array of existing workspaces to avoid duplicates
 * @returns {Array} - Array of workspace objects ready to be created
 */
export const createWorkspacesFromUrls = (browserUrls, existingWorkspaces = []) => {
  if (!Array.isArray(browserUrls)) return [];
  
  const urlData = browserUrls.map(url => ({ url }));
  const projectsMap = analyzeForProjects(urlData, existingWorkspaces);
  
  return Array.from(projectsMap.values());
};

/**
 * Process a single URL and create workspace if pattern matches
 * @param {string} url - Single URL to process
 * @param {Array} existingWorkspaces - Array of existing workspaces to check against
 * @returns {Object|null} - Workspace object or null if no match/already exists
 */
export const createWorkspaceFromSingleUrl = (url, existingWorkspaces = []) => {
  if (!url) return null;
  
  const detection = detectProject(url);
  if (!detection) return null;
  
  const workspaceName = detection.workspace.name;
  const existingNames = new Set(existingWorkspaces.map(ws => ws.name.toLowerCase()));
  
  if (existingNames.has(workspaceName.toLowerCase())) {
    return null;
  }
  
  return {
    ...detection.workspace,
    detection,
    urls: [url]
  };
};

/**
 * Get workspace suggestions from current browser tab
 * @param {string} currentUrl - Current active tab URL
 * @param {Array} existingWorkspaces - Array of existing workspaces
 * @returns {Object|null} - Workspace suggestion or null
 */
export const getSuggestedWorkspaceFromCurrentTab = (currentUrl, existingWorkspaces = []) => {
  return createWorkspaceFromSingleUrl(currentUrl, existingWorkspaces);
};