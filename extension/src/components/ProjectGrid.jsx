import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getUrlParts } from '../utils';
import GenericUrlParser from '../utils/GenericUrlParser';
import { WorkspaceProject } from './WorkspaceProject';

export const ProjectGrid = React.forwardRef(function ProjectGrid({ items, onAddRelated, onAddLink, onDelete, onItemClick }, ref) {
  const [timeSpent, setTimeSpent] = useState({});
  const [selectedWorkspace, setSelectedWorkspace] = useState('All');
  const itemRefs = useRef([]);
  const columns = 4;
  const chipRefs = useRef([]);
  const rootRef = useRef(null);

  useEffect(() => {
    const fetchTimeSpent = async () => {
      try {
        const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
        if (!hasRuntime) {
          console.log('[ProjectGrid] Chrome runtime not available, skipping time spent fetch');
          return;
        }

        // Add a timeout to prevent hanging if background script doesn't respond
        const timeoutMs = 5000; // 5 second timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          console.warn('[ProjectGrid] Timeout waiting for time spent data from background script');
        }, timeoutMs);

        const response = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (res) => {
              clearTimeout(timeoutId);
              const lastErr = chrome.runtime?.lastError;
              if (lastErr) return resolve({ ok: false, error: lastErr.message });
              resolve(res);
            });
          } catch (e) {
            clearTimeout(timeoutId);
            resolve({ ok: false, error: String(e) });
          }
        });

        if (response?.ok) {
          setTimeSpent(response.timeSpent || {});
        } else if (response?.error) {
          console.warn('[ProjectGrid] Failed to get time spent data:', response.error);
        }
      } catch (error) {
        console.error('Error getting time spent:', error);
      }
    };

    fetchTimeSpent();
  }, []);

  // Parse URLs and create hierarchical structure
  const [projectGroups, setProjectGroups] = useState({ allGroups: [], categoryStats: new Map() });
  const [workspaceOptions, setWorkspaceOptions] = useState([{ id: 'All', name: 'All', count: 0 }]);

  useEffect(() => {
    const processUrls = async () => {
      const validItems = items
        .filter(item => item && typeof item.url === 'string' && item.url.length > 0);

      const chatgptItems = validItems.filter(item =>
        item.url.includes('chatgpt.com') || item.url.includes('chat.openai.com')
      );
      console.log('[ProjectGrid] Processing items count:', validItems.length);
      if (chatgptItems.length > 0) {
        console.log('[ProjectGrid] ChatGPT items found:', chatgptItems.length);
        console.log('[ProjectGrid] Sample ChatGPT items:', chatgptItems.slice(0, 3).map(item => ({
          url: item.url,
          title: item.title,
          type: item.type
        })));
      } else {
        console.log('[ProjectGrid] No ChatGPT items found in data');
      }

      const parseResult = await GenericUrlParser.parseMultiple(validItems);

      console.log('[ProjectGrid] Parse result:', {
        totalGroups: parseResult.groups.length,
        stats: parseResult.stats,
        chatgptGroups: parseResult.groups.filter(g =>
          g.platform?.name === 'ChatGPT' || g.workspace?.includes('ChatGPT')
        ).length
      });

      // Transform all groups to a unified format
      const allGroups = [];

      if (!parseResult.groups || !Array.isArray(parseResult.groups)) {
        console.error('[ProjectGrid] parseResult.groups is not an array:', parseResult);
        setProjectGroups({ allGroups: [], categoryStats: new Map() });
        setWorkspaceOptions([{ id: 'All', name: 'All', count: 0 }]);
        return;
      }

      parseResult.groups.forEach(group => {
        const values = group.urls.map(urlData => {
          const originalItem = items.find(item => item.url === urlData.url);
          return {
            ...originalItem,
            title: urlData.title,
            subtitle: urlData.subtitle,
            extractedData: urlData.details,
            timestamp: urlData.timestamp,
            lastVisitTime: urlData.lastVisitTime,
            visitCount: urlData.visitCount
          };
        }).sort((a, b) => {
          const at = (typeof a?.lastVisitTime === 'number' ? a.lastVisitTime : 0) ||
            (typeof a?.dateAdded === 'number' ? a.dateAdded : 0);
          const bt = (typeof b?.lastVisitTime === 'number' ? b.lastVisitTime : 0) ||
            (typeof b?.dateAdded === 'number' ? b.dateAdded : 0);
          return bt - at;
        });

        allGroups.push({
          key: group.workspace,
          info: {
            category: group.platform.id,
            platform: group.platform.name,
            displayName: group.workspace,
            type: group.type
          },
          values,
          workspace: {
            id: group.platform.id,
            name: group.platform.name,
            type: group.type,
            favicon: group.favicon
          },
          favicon: group.favicon
        });
      });

      const categoryStats = new Map();
      Object.entries(parseResult.stats.byPlatform).forEach(([platformId, count]) => {
        categoryStats.set(platformId, count);
      });

      setProjectGroups({
        allGroups,
        categoryStats
      });

      // Create workspace filter options
      const options = [{ id: 'All', name: 'All', count: items.length }];

      console.log('Parse result stats:', parseResult.stats); // Debug log

      // Get categories from workspace patterns
      const categories = GenericUrlParser.getAllPlatforms();

      // Add platform-based options that have data
      categories.forEach(category => {
        const platformCount = parseResult.stats.byPlatform[category.name] || 0;

        if (platformCount > 0) {
          options.push({
            id: category.id,
            name: category.name,
            count: platformCount,
            color: category.color,
            favicon: category.favicon
          });
        }
      });

      setWorkspaceOptions(options);
    };

    processUrls();
  }, [items]);

  // Filter content by selected workspace
  const filteredContent = useMemo(() => {
    let filteredGroups = projectGroups.allGroups;

    // Filter by workspace category or specific platform
    if (selectedWorkspace !== 'All') {
      filteredGroups = filteredGroups.filter(group => {
        // Filter by platform type (e.g., 'project', 'conversation', etc.)
        if (group.workspace && group.workspace.type === selectedWorkspace) {
          return true;
        }
        // Filter by specific platform ID
        if (group.workspace && group.workspace.id === selectedWorkspace) {
          return true;
        }
        return false;
      });
    }

    return {
      groups: filteredGroups
    };
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
  }, [filteredContent.groups.length]);

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
    <div>
      {/* All Groups - Dynamic Template */}
      {filteredContent.groups.length > 0 && (
        <div>
          {filteredContent.groups
            .filter(group => group && group.key) // Filter out any undefined/null groups or groups without a key
            .map((group, idx) => {
              const cleanedKey = getUrlParts(group.key).key;
              return (
                <WorkspaceProject
                  key={group.key}
                  ref={el => itemRefs.current[itemRefs.current.length] = el}
                  workspace={{
                    key: group.key,
                    values: group.values,
                    workspace: group.workspace,
                    favicon: group.favicon,
                    info: group.info
                  }}
                  timeSpentMs={timeSpent[cleanedKey]}
                  onAddRelated={onAddRelated}
                  onAddLink={onAddLink}
                  onDelete={onDelete}
                  onItemClick={onItemClick}
                />
              );
            })}
        </div>
      )}
    </div>
  );
});