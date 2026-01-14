import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getUrlParts } from '../utils';
import { WorkspaceItem } from './WorkspaceItem';

export function ItemGrid({ items, workspaces = [], onAddRelated, onDelete, onAddDefault, allItems = [], savedItems = [], currentWorkspace = 'All', onAddItem, onAddSavedItem }) {
  const [timeSpent, setTimeSpent] = useState({});
  const itemRefs = useRef([]);
  const columns = 4; // matches .workspace-grid.fixed-four
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
    return groups
  }, [groups])




  // Default focus: first card
  useEffect(() => {
    const tag = (document.activeElement && document.activeElement.tagName)
      ? document.activeElement.tagName.toLowerCase() : ''
    if (tag === 'input' || tag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) return
    const flat = itemRefs.current.filter(Boolean)
    if (flat.length > 0) {
      // Defer to ensure refs are set
      setTimeout(() => flat[0]?.focus?.(), 0)
    }
  }, [displayGroups.length])


  // Reset refs before rendering lists to avoid stale entries
  itemRefs.current = []

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
                onDelete={onDelete}
                onAddToWorkspace={onAddSavedItem}
              />
            );
          })()
        ))}
      </ul>
    </div >
  )
}
