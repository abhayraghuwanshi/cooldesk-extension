import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getUrlParts } from '../utils';
import { getAllPlatforms, parseUrls } from '../utils/workspaceParser';
import { WorkspaceItem } from './WorkspaceItem';

export function ProjectGrid({ items, onAddRelated, onAddLink, onDelete }) {
  const [timeSpent, setTimeSpent] = useState({});
  const [selectedWorkspace, setSelectedWorkspace] = useState('All');
  const [selectedUser, setSelectedUser] = useState('All');
  const itemRefs = useRef([]);
  const columns = 4;
  const chipRefs = useRef([]);
  const rootRef = useRef(null);

  useEffect(() => {
    const fetchTimeSpent = async () => {
      try {
        const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
        if (!hasRuntime) return;
        const response = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (res) => {
              const lastErr = chrome.runtime?.lastError;
              if (lastErr) return resolve({ ok: false, error: lastErr.message });
              resolve(res);
            });
          } catch (e) { resolve({ ok: false, error: String(e) }); }
        });
        if (response?.ok) {
          setTimeSpent(response.timeSpent || {});
        }
      } catch (error) {
        console.error('Error getting time spent:', error);
      }
    };

    fetchTimeSpent();
  }, []);

  // Parse URLs and create hierarchical structure
  const projectGroups = useMemo(() => {
    const urls = items
      .filter(item => item && typeof item.url === 'string' && item.url.length > 0)
      .map(item => item.url);

    const parseResult = parseUrls(urls);

    // Separate GitHub and non-GitHub groups
    const githubGroups = [];
    const otherGroups = [];

    parseResult.groups.forEach(group => {
      if (group.platform.id === 'github') {
        githubGroups.push(group);
      } else {
        // Transform non-GitHub groups to match expected format
        const values = group.urls.map(urlData => {
          const originalItem = items.find(item => item.url === urlData.url);
          return {
            ...originalItem,
            title: urlData.title,
            extractedData: urlData.extracted,
            timestamp: urlData.timestamp
          };
        }).sort((a, b) => {
          const at = (typeof a?.lastVisitTime === 'number' ? a.lastVisitTime : 0) ||
            (typeof a?.dateAdded === 'number' ? a.dateAdded : 0);
          const bt = (typeof b?.lastVisitTime === 'number' ? b.lastVisitTime : 0) ||
            (typeof b?.dateAdded === 'number' ? b.dateAdded : 0);
          return bt - at;
        });

        otherGroups.push({
          key: group.key,
          info: {
            category: group.platform.id,
            platform: group.platform.name,
            displayName: group.name,
            type: group.workspace.type
          },
          values,
          workspace: {
            id: group.platform.id,
            name: group.platform.name,
            type: group.workspace.type,
            favicon: group.favicon
          },
          favicon: group.favicon
        });
      }
    });

    // Create nested structure for GitHub: users -> projects
    const githubNested = {};
    githubGroups.forEach(group => {
      const owner = group.key; // This is now the owner due to groupBy: "owner"

      if (!githubNested[owner]) {
        githubNested[owner] = {
          key: owner,
          info: {
            category: 'github-user',
            platform: 'GitHub',
            displayName: `@${owner}`,
            type: 'user'
          },
          projects: [],
          favicon: group.favicon
        };
      }

      // Group projects under each user
      const projectMap = new Map();
      group.urls.forEach(urlData => {
        const originalItem = items.find(item => item.url === urlData.url);
        const project = urlData.extracted.project || `${owner}/unknown`;

        if (!projectMap.has(project)) {
          projectMap.set(project, []);
        }

        projectMap.get(project).push({
          ...originalItem,
          title: urlData.title,
          extractedData: urlData.extracted,
          timestamp: urlData.timestamp
        });
      });

      // Convert project map to project objects
      Array.from(projectMap.entries()).forEach(([project, urls]) => {
        githubNested[owner].projects.push({
          key: project,
          info: {
            category: 'github-project',
            platform: 'GitHub',
            displayName: project,
            type: 'project'
          },
          values: urls.sort((a, b) => {
            const at = (typeof a?.lastVisitTime === 'number' ? a.lastVisitTime : 0) ||
              (typeof a?.dateAdded === 'number' ? a.dateAdded : 0);
            const bt = (typeof b?.lastVisitTime === 'number' ? b.lastVisitTime : 0) ||
              (typeof b?.dateAdded === 'number' ? b.dateAdded : 0);
            return bt - at;
          }),
          workspace: {
            id: 'github-project',
            name: 'GitHub Project',
            type: 'project',
            favicon: group.favicon
          },
          favicon: group.favicon
        });
      });
    });

    const categoryStats = new Map();
    Object.entries(parseResult.stats.byPlatform).forEach(([platformId, count]) => {
      categoryStats.set(platformId, count);
    });

    return {
      githubNested: Object.values(githubNested),
      otherGroups,
      categoryStats
    };
  }, [items]);

  // Filter content by selected workspace and user
  const filteredContent = useMemo(() => {
    let githubUsers = projectGroups.githubNested;
    let otherGroups = projectGroups.otherGroups;

    // Filter by workspace category using the category from parsed data
    if (selectedWorkspace === 'development') {
      // Only show development platforms (GitHub, GitLab, etc)
      otherGroups = otherGroups.filter(group =>
        group.workspace && group.workspace.type === 'repository'
      );
    } else if (selectedWorkspace === 'ai-chat') {
      // Only show AI chat platforms
      githubUsers = [];
      otherGroups = otherGroups.filter(group =>
        group.workspace && group.workspace.type === 'ai-chat'
      );
    } else if (selectedWorkspace === 'design') {
      // Only show design platforms
      githubUsers = [];
      otherGroups = otherGroups.filter(group =>
        group.workspace && group.workspace.type === 'design'
      );
    } else if (selectedWorkspace === 'project-management') {
      githubUsers = [];
      otherGroups = otherGroups.filter(group =>
        group.workspace && group.workspace.type === 'project-management'
      );
    } else if (selectedWorkspace === 'documentation') {
      githubUsers = [];
      otherGroups = otherGroups.filter(group =>
        group.workspace && group.workspace.type === 'documentation'
      );
    } else if (selectedWorkspace === 'communication') {
      githubUsers = [];
      otherGroups = otherGroups.filter(group =>
        group.workspace && group.workspace.type === 'communication'
      );
    } else if (selectedWorkspace !== 'All') {
      // Filter by specific category ID
      githubUsers = [];
      otherGroups = otherGroups.filter(group =>
        group.category && group.category.id === selectedWorkspace
      );
    }

    // Filter GitHub users by selected user
    if (selectedUser !== 'All' && githubUsers.length > 0) {
      githubUsers = githubUsers.filter(user => user.key === selectedUser);
    }

    return {
      type: selectedWorkspace === 'development' ? 'github-only' :
        selectedWorkspace === 'All' ? 'mixed' : 'other-only',
      githubUsers,
      otherGroups
    };
  }, [projectGroups, selectedWorkspace, selectedUser]);

  // Create workspace filter options using categories from workspace patterns
  const workspaceOptions = useMemo(() => {
    const options = [{ id: 'All', name: 'All', count: items.length }];

    // Get parse results with category stats
    const urls = items.filter(item => item?.url).map(item => item.url);
    const parseResult = parseUrls(urls);

    console.log('Parse result stats:', parseResult.stats); // Debug log

    // Get categories from workspace patterns
    const categories = getAllPlatforms();

    // Add category-based options that have data
    categories.forEach(category => {
      const categoryCount = parseResult.stats.byCategory[category.id] || 0;

      if (categoryCount > 0) {
        options.push({
          id: category.id,
          name: category.name,
          count: categoryCount,
          icon: category.icon,
          color: '#666666'
        });
      }
    });

    console.log('Final workspace options:', options); // Debug log

    return options.sort((a, b) => {
      if (a.id === 'All') return -1;
      if (b.id === 'All') return 1;
      return b.count - a.count;
    });
  }, [items]);

  // Create user filter options (for GitHub users when in development workspace)
  const userOptions = useMemo(() => {
    if (selectedWorkspace !== 'All' && selectedWorkspace !== 'development') {
      return [];
    }

    const options = [{ id: 'All', name: 'All Users', count: projectGroups.githubNested.length }];

    projectGroups.githubNested
      .sort((a, b) => b.projects.length - a.projects.length)
      .forEach(user => {
        options.push({
          id: user.key,
          name: `@${user.key}`,
          count: user.projects.length,
          icon: '👤'
        });
      });

    return options;
  }, [projectGroups, selectedWorkspace]);

  const onKeyDown = (e) => {
    if (e.defaultPrevented) return;
    if (!(e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    const flat = itemRefs.current.filter(Boolean);
    const activeIndex = flat.findIndex(el => el === document.activeElement);
    const total = flat.length;
    if (total === 0) return;

    const getNextIndex = (idx, key) => {
      if (key === 'ArrowRight') return Math.min(total - 1, idx + 1);
      if (key === 'ArrowLeft') return Math.max(0, idx - 1);
      if (key === 'ArrowDown') return Math.min(total - 1, idx + columns);
      if (key === 'ArrowUp') return Math.max(0, idx - columns);
      return idx;
    };

    let nextIndex = activeIndex === -1 ? 0 : getNextIndex(activeIndex, e.key);
    const nextEl = flat[nextIndex];
    if (nextEl && typeof nextEl.focus === 'function') {
      nextEl.focus();
      e.preventDefault();
    }
  };

  const onWorkspaceChipKeyDown = (e, index, key) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedWorkspace(key);
      setSelectedUser('All'); // Reset user filter when workspace changes
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = Math.min(chipRefs.current.length - 1, index + 1);
      chipRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = Math.max(0, index - 1);
      chipRefs.current[prevIndex]?.focus();
    }
  };

  const onUserChipKeyDown = (e, index, key) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedUser(key);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = Math.min(chipRefs.current.length - 1, index + 1);
      chipRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = Math.max(0, index - 1);
      chipRefs.current[prevIndex]?.focus();
    }
  };


  // Focus management
  useEffect(() => {
    const tag = (document.activeElement && document.activeElement.tagName)
      ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) return;

    const flat = itemRefs.current.filter(Boolean);
    if (flat.length > 0) {
      setTimeout(() => flat[0]?.focus?.(), 0);
    } else {
      const firstChip = chipRefs.current.find(Boolean);
      if (firstChip) setTimeout(() => firstChip.focus(), 0);
    }
  }, [filteredContent.githubUsers.length + filteredContent.otherGroups.length]);

  // Global key handler
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      onKeyDown(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Reset refs
  itemRefs.current = [];
  chipRefs.current = [];

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      role="grid"
      tabIndex={-1}
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
        marginTop: '16px'
      }}
    >
      {/* Content Area */}
      <div>
        {/* GitHub Users Section */}
        {filteredContent.githubUsers.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            {filteredContent.githubUsers.map((user) => (
              <div key={user.key} style={{ marginBottom: '24px' }}>

                {/* Projects Grid */}
                <ul className="workspace-grid fixed-four">
                  {user.projects.map((project, idx) => {
                    const cleanedKey = getUrlParts(project.key).key;
                    return (
                      <WorkspaceItem
                        key={project.key}
                        ref={el => itemRefs.current[itemRefs.current.length] = el}
                        base={project.key}
                        values={project.values}
                        onAddRelated={onAddRelated}
                        timeSpentMs={timeSpent[cleanedKey]}
                        onAddLink={onAddLink && project.workspace ? () => onAddLink(project.workspace) : undefined}
                        onDelete={onDelete}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Other Platforms Section */}
        {filteredContent.otherGroups.length > 0 && (
          <ul className="workspace-grid fixed-four">
            {filteredContent.otherGroups.map((group, idx) => {
              const cleanedKey = getUrlParts(group.key).key;
              return (
                <WorkspaceItem
                  key={group.key}
                  ref={el => itemRefs.current[itemRefs.current.length] = el}
                  base={group.key}
                  values={group.values}
                  onAddRelated={onAddRelated}
                  timeSpentMs={timeSpent[cleanedKey]}
                  onAddLink={onAddLink && group.workspace ? () => onAddLink(group.workspace) : undefined}
                  onDelete={onDelete}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}