import React, { useCallback, useMemo, useRef } from 'react';

export function WorkspaceFilters({ items, active, onChange }) {
  const workspaces = useMemo(() => {
    const set = new Set()
    items.forEach((i) => i.workspaceGroup && set.add(i.workspaceGroup))
    return Array.from(set)
  }, [items])

  const btnRefs = useRef([])
  const onKeyDown = useCallback((e, idx, ws) => {
    if (e.defaultPrevented) return
    const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
    const isActivate = e.key === 'Enter' || e.key === ' '
    if (!(isArrow || isActivate)) return
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    if (isActivate) { e.preventDefault(); onChange(ws); return }
    const flat = btnRefs.current.filter(Boolean)
    const total = flat.length
    if (!total) return
    if (e.key === 'ArrowDown') {
      // Move to first chip in ItemGrid
      const chip = document.querySelector('.workspace-chips .workspace-chip')
      if (chip && typeof chip.focus === 'function') { chip.focus(); e.preventDefault(); }
      return
    }
    if (e.key === 'ArrowUp') {
      // Move focus to active tab in App tablist
      const activeTabBtn = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')
      if (activeTabBtn && typeof activeTabBtn.focus === 'function') {
        activeTabBtn.focus();
        e.preventDefault();
        return
      }
      e.preventDefault();
      return
    }
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const next = (idx + dir + total) % total
    const el = flat[next]
    if (el && typeof el.focus === 'function') { el.focus(); e.preventDefault(); }
  }, [onChange])

  return (
    <div id="workspace-filters" className="ws-filters">
      {workspaces.map((ws, i) => (
        <button
          key={ws}
          className={`filter-btn ${ws === active ? 'active' : ''}`}
          onClick={() => onChange(ws)}
          ref={el => btnRefs.current[i] = el}
          onKeyDown={(e) => onKeyDown(e, i, ws)}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
