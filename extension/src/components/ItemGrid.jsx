import React, { useEffect, useMemo, useState } from 'react';
import { useAISuggestions } from '../hooks/useAISuggestions';
import { getDomainFromUrl, getUrlParts } from '../utils';
import { WorkspaceItem } from './WorkspaceItem';

export function ItemGrid({ items, workspaces = [], onAddRelated, onAddLink }) {
  const [timeSpent, setTimeSpent] = useState({});
  const [selectedGroup, setSelectedGroup] = useState('All');

  useEffect(() => {
    const fetchTimeSpent = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getTimeSpent' });
        if (response?.ok) {
          setTimeSpent(response.timeSpent || {});
        }
      } catch (error) {
        if (error.message.includes('Receiving end does not exist')) {
          console.warn('Could not connect to the background service to get time spent. It might be initializing.');
        } else {
          console.error('Error getting time spent:', error);
        }
      }
    };

    fetchTimeSpent();
  }, []);
  const groups = useMemo(() => {
    const map = new Map()
    items
      .filter((it) => it.type === 'History' && (it.visitCount || 0) > 1)
      .forEach((it) => {
        const parts = getUrlParts(it.url)
        if (parts.queryEntries.length > 0) return
        const { key, remainder } = parts
        const val = remainder && remainder !== '' ? remainder : '/'
        if (!map.has(key)) map.set(key, new Set())
        map.get(key).add(it)
      })
    return Array.from(map.entries()).map(([key, set]) => {
      const firstItem = set.values().next().value;
      return {
        key,
        values: Array.from(set).sort(),
        workspace: firstItem?.workspaceId ? workspaces.find(w => w.id === firstItem.workspaceId) : null,
      };
    });
  }, [items])

  const displayGroups = useMemo(() => {
    if (selectedGroup === 'All') return groups
    return groups.filter(g => g.key === selectedGroup)
  }, [groups, selectedGroup])

  const { loading, suggestions, error, getSuggestions, clearSuggestions } = useAISuggestions()

  const handleGetSuggestions = () => {
    // Use the most frequent domain or a representative URL
    if ((selectedGroup === 'All' ? groups : displayGroups).length > 0) {
      // For simplicity, we'll use the first workspace group's base URL.
      // A more sophisticated approach could find the most common domain.
      const arr = selectedGroup === 'All' ? groups : displayGroups
      getSuggestions(arr[0].key)
    }
  }

  return (
    <div>
      <div className="workspace-chips">
        <button
          key="All"
          className={`tag-chip workspace-chip ${selectedGroup === 'All' ? 'active' : ''}`}
          onClick={() => setSelectedGroup('All')}
          type="button"
        >
          All
          <span className="chip-badge">{groups.reduce((sum, g) => sum + g.values.length, 0)}</span>
        </button>
        {groups.map(({ key, values }) => (
          <button
            key={key}
            className={`tag-chip workspace-chip ${selectedGroup === key ? 'active' : ''}`}
            title={key}
            onClick={() => setSelectedGroup(key)}
            type="button"
          >
            {getDomainFromUrl(key)}
            <span className="chip-badge">{values.length}</span>
          </button>
        ))}
      </div>
      <ul className="workspace-grid fixed-four">
        {displayGroups.map(({ key, values, workspace }) => (
          <WorkspaceItem key={key} base={key} values={values} onAddRelated={onAddRelated} timeSpentMs={timeSpent[key]} onAddLink={onAddLink && workspace ? () => onAddLink(workspace) : undefined} />
        ))}
      </ul>
      {/* <div className="suggestion-controls">
        <button onClick={handleGetSuggestions} disabled={loading}>
          {loading ? 'Getting Suggestions...' : 'Get Workspace Suggestions'}
        </button>
      </div> */}


    </div>
  )
}
