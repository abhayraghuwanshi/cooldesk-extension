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
    <div style={{ 
      display: 'flex', 
      flexWrap: 'wrap', 
      gap: '16px', 
      alignItems: 'center',
      marginBottom: '8px'
    }}>
      {workspaces.map((ws, i) => (
        <button
          key={ws}
          onClick={() => onChange(ws)}
          ref={el => btnRefs.current[i] = el}
          onKeyDown={(e) => onKeyDown(e, i, ws)}
          style={{
            background: ws === active 
              ? 'linear-gradient(135deg, rgba(52, 199, 89, 0.2) 0%, rgba(52, 199, 89, 0.1) 100%)' 
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
            border: ws === active 
              ? '2px solid rgba(52, 199, 89, 0.5)' 
              : '2px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '24px',
            padding: '12px 24px',
            color: ws === active ? '#34C759' : '#ffffff',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            backdropFilter: 'blur(16px)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            alignItems: 'center',
            minWidth: '80px',
            minHeight: '44px',
            justifyContent: 'center',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            outline: 'none',
            boxShadow: ws === active 
              ? '0 8px 32px rgba(52, 199, 89, 0.25), 0 2px 8px rgba(0, 0, 0, 0.1)' 
              : '0 4px 16px rgba(0, 0, 0, 0.08)',
            position: 'relative',
            overflow: 'hidden'
          }}
          onMouseEnter={(e) => {
            if (ws !== active) {
              e.target.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)';
              e.target.style.transform = 'translateY(-2px) scale(1.02)';
              e.target.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.15)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.25)';
            }
          }}
          onMouseLeave={(e) => {
            if (ws !== active) {
              e.target.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)';
              e.target.style.transform = 'translateY(0) scale(1)';
              e.target.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.08)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            }
          }}
          onFocus={(e) => {
            e.target.style.boxShadow = ws === active 
              ? '0 8px 32px rgba(52, 199, 89, 0.35), 0 0 0 3px rgba(52, 199, 89, 0.3)' 
              : '0 4px 16px rgba(0, 0, 0, 0.15), 0 0 0 3px rgba(255, 255, 255, 0.3)';
          }}
          onBlur={(e) => {
            e.target.style.boxShadow = ws === active 
              ? '0 8px 32px rgba(52, 199, 89, 0.25), 0 2px 8px rgba(0, 0, 0, 0.1)' 
              : '0 4px 16px rgba(0, 0, 0, 0.08)';
          }}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
