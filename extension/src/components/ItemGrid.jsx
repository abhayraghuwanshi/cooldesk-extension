import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDomainFromUrl, getUrlParts } from '../utils';
import { WorkspaceItem } from './WorkspaceItem';
import categoryManager from '../data/categories.js';

export function ItemGrid({ items, workspaces = [], onAddRelated, onAddLink, onDelete }) {
  const [timeSpent, setTimeSpent] = useState({});
  const [selectedGroup, setSelectedGroup] = useState('All');
  const itemRefs = useRef([]);
  const columns = 4; // matches .workspace-grid.fixed-four
  const chipRefs = useRef([]);
  const rootRef = useRef(null);

  // Keyboard navigation handler
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

    const nextIndex = getNextIndex(activeIndex, e.key);
    if (flat[nextIndex]) {
      flat[nextIndex].focus();
      e.preventDefault();
    }
  };

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
      .filter((it) => it && typeof it.url === 'string' && it.url.length > 0)
      .forEach((it) => {
        const parts = getUrlParts(it.url)
        const key = (parts && parts.key) ? parts.key : it.url
        if (!map.has(key)) map.set(key, new Set())
        map.get(key).add(it)
      })
    let grouped = Array.from(map.entries()).map(([key, set]) => {
      const firstItem = set.values().next().value;
      const arr = Array.from(set)
        .sort((a, b) => {
          const at = (typeof a?.lastVisitTime === 'number' ? a.lastVisitTime : 0) || (typeof a?.dateAdded === 'number' ? a.dateAdded : 0);
          const bt = (typeof b?.lastVisitTime === 'number' ? b.lastVisitTime : 0) || (typeof b?.dateAdded === 'number' ? b.dateAdded : 0);
          return bt - at;
        });
      try { console.debug('[ItemGrid] group built', { key, count: arr.length, sample: arr.slice(0, 2).map(it => it.url) }); } catch { }
      return {
        key,
        values: arr,
        workspace: firstItem?.workspaceId ? workspaces.find(w => w.id === firstItem.workspaceId) : null,
      };
    });

    // AI Chats are now handled in main workspace filters, no longer needed here

    if (grouped.length === 0 && items.length > 0) {
      grouped = [{ key: 'All URLs', values: items.slice(), workspace: null }];
    }
    return grouped;
  }, [items])

  const displayGroups = useMemo(() => {
    if (selectedGroup === 'All') return groups
    return groups.filter(g => g.key === selectedGroup)
  }, [groups, selectedGroup])


  const onChipKeyDown = (e, index, key) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedCategory(key);
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


  // Default focus: first card, else first chip
  useEffect(() => {
    const tag = (document.activeElement && document.activeElement.tagName)
      ? document.activeElement.tagName.toLowerCase() : ''
    if (tag === 'input' || tag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) return
    const flat = itemRefs.current.filter(Boolean)
    if (flat.length > 0) {
      // Defer to ensure refs are set
      setTimeout(() => flat[0]?.focus?.(), 0)
    } else {
      const firstChip = chipRefs.current.find(Boolean)
      if (firstChip) setTimeout(() => firstChip.focus(), 0)
    }
  }, [displayGroups.length])


  // Reset refs before rendering lists to avoid stale entries
  itemRefs.current = []
  chipRefs.current = []

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
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '24px',
        padding: '0 4px'
      }}>
        <button
          key="All"
          onClick={() => setSelectedGroup('All')}
          type="button"
          ref={el => chipRefs.current[0] = el}
          onKeyDown={(e) => onChipKeyDown(e, 0, 'All')}
          style={{
            background: selectedGroup === 'All'
              ? 'rgba(52, 199, 89, 0.15)'
              : 'var(--surface-1)',
            border: selectedGroup === 'All'
              ? '1px solid rgba(52, 199, 89, 0.4)'
              : '1px solid var(--border)',
            borderRadius: '16px',
            padding: '8px 16px',
            color: selectedGroup === 'All' ? '#34C759' : 'var(--text)',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: '60px',
            outline: 'none',
            boxShadow: selectedGroup === 'All'
              ? '0 4px 16px rgba(52, 199, 89, 0.2)'
              : 'none'
          }}
          onMouseEnter={(e) => {
            if (selectedGroup !== 'All') {
              e.target.style.background = 'var(--surface-2)';
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 2px 8px var(--border)';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedGroup !== 'All') {
              e.target.style.background = 'var(--surface-1)';
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = 'none';
            }
          }}
          onFocus={(e) => {
            e.target.style.boxShadow = selectedGroup === 'All'
              ? '0 4px 16px rgba(52, 199, 89, 0.3), 0 0 0 2px rgba(52, 199, 89, 0.2)'
              : '0 0 0 2px rgba(255, 255, 255, 0.2)';
          }}
          onBlur={(e) => {
            e.target.style.boxShadow = selectedGroup === 'All'
              ? '0 4px 16px rgba(52, 199, 89, 0.2)'
              : 'none';
          }}
        >
          All
          <span style={{
            background: selectedGroup === 'All'
              ? 'rgba(52, 199, 89, 0.2)'
              : 'var(--surface-2)',
            borderRadius: '12px',
            padding: '2px 8px',
            fontSize: '12px',
            fontWeight: '600',
            color: selectedGroup === 'All' ? '#34C759' : 'var(--text-dim)',
            minWidth: '20px',
            textAlign: 'center'
          }}>
            {groups.reduce((sum, g) => sum + g.values.length, 0)}
          </span>
        </button>
        {groups.map(({ key, values }, i) => (
          <button
            key={key}
            title={key}
            onClick={() => setSelectedGroup(key)}
            type="button"
            ref={el => chipRefs.current[i + 1] = el}
            onKeyDown={(e) => onChipKeyDown(e, i + 1, key)}
            style={{
              background: selectedGroup === key
                ? 'rgba(52, 199, 89, 0.15)'
                : 'var(--surface-1)',
              borderRadius: '16px',
              padding: '8px 16px',
              color: selectedGroup === key ? '#34C759' : 'var(--text)',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              minWidth: '60px',
              outline: 'none',
              boxShadow: selectedGroup === key
                ? '0 4px 16px rgba(52, 199, 89, 0.2)'
                : 'none'
            }}
            onMouseEnter={(e) => {
              if (selectedGroup !== key) {
                e.target.style.background = 'var(--surface-2)';
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 2px 8px var(--border)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectedGroup !== key) {
                e.target.style.background = 'var(--surface-1)';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }
            }}
            onFocus={(e) => {
              e.target.style.boxShadow = selectedGroup === key
                ? '0 4px 16px rgba(52, 199, 89, 0.3), 0 0 0 2px rgba(52, 199, 89, 0.2)'
                : '0 0 0 2px rgba(255, 255, 255, 0.2)';
            }}
            onBlur={(e) => {
              e.target.style.boxShadow = selectedGroup === key
                ? '0 4px 16px rgba(52, 199, 89, 0.2)'
                : 'none';
            }}
          >
            {getDomainFromUrl(key)}
            <span style={{
              background: selectedGroup === key
                ? 'rgba(52, 199, 89, 0.2)'
                : 'var(--surface-2)',
              borderRadius: '12px',
              padding: '2px 8px',
              fontSize: '12px',
              fontWeight: '600',
              color: selectedGroup === key ? '#34C759' : 'var(--text-dim)',
              minWidth: '20px',
              textAlign: 'center'
            }}>
              {values.length}
            </span>
          </button>
        ))}
      </div>
      <ul className="workspace-grid fixed-four">
        {displayGroups.map(({ key, values, workspace }, idx) => (
          (() => {
            const cleanedKey = getUrlParts(key).key;
            return (
              <WorkspaceItem
                key={key}
                ref={el => itemRefs.current[idx] = el}
                base={key}
                values={values}
                onAddRelated={onAddRelated}
                timeSpentMs={timeSpent[cleanedKey]}
                onAddLink={onAddLink && workspace ? () => onAddLink(workspace) : undefined}
                onDelete={onDelete}
              />
            );
          })()
        ))}
      </ul>


    </div >
  )
}
