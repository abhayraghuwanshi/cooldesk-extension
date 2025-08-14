import React, { useMemo } from 'react';

export function WorkspaceFilters({ items, active, onChange }) {
  const workspaces = useMemo(() => {
    const set = new Set()
    items.forEach((i) => i.workspaceGroup && set.add(i.workspaceGroup))
    return ['All', ...Array.from(set)]
  }, [items])

  return (
    <div id="workspace-filters" className="ws-filters">
      {workspaces.map((ws) => (
        <button
          key={ws}
          className={`filter-btn ${ws === active ? 'active' : ''}`}
          onClick={() => onChange(ws)}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
