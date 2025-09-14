import React, { useMemo, useRef } from 'react';

export function WorkspaceFilters({ items, active, onChange }) {
  const workspaces = useMemo(() => {
    const set = new Set()
    items.forEach((i) => i.workspaceGroup && set.add(i.workspaceGroup))
    return Array.from(set)
  }, [items])

  const btnRefs = useRef([])

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
          style={{
            background: ws === active
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(255, 255, 255, 0.08)',
            border: ws === active
              ? '1px solid rgba(255, 255, 255, 0.3)'
              : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            padding: '8px 12px',
            color: ws === active ? '#ffffff' : 'rgba(255, 255, 255, 0.8)',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            height: '32px',
            justifyContent: 'center',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            outline: 'none',
            position: 'relative',
            whiteSpace: 'nowrap'
          }}
          onMouseEnter={(e) => {
            if (ws !== active) {
              e.target.style.background = 'rgba(255, 255, 255, 0.12)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }
          }}
          onMouseLeave={(e) => {
            if (ws !== active) {
              e.target.style.background = 'rgba(255, 255, 255, 0.08)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }
          }}
        >
          {ws}
        </button>
      ))}
    </div>
  )
}
