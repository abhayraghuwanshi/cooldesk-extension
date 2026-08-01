import {
  faChevronDown,
  faFolder,
  faFolderOpen,
  faMagnifyingGlass,
  faPlus,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Replaces the old left sidebar. A compact dropdown in the top bar that lets
 * you search/select a workspace ("project selection"), jump to AI Suggestions,
 * or create a new one.
 */
export default function WorkspaceSwitcher({
  workspaces = [],
  selectedId,
  isSuggestionsMode = false,
  onSelect,
  onShowSuggestions,
  onCreateNew
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(w => w.name?.toLowerCase().includes(q));
  }, [workspaces, query]);

  const selected = workspaces.find(w => w.id === selectedId);
  const label = isSuggestionsMode ? 'AI Suggestions' : (selected?.name || 'New workspace');

  const choose = (fn) => { fn?.(); setOpen(false); };

  return (
    <div className="awm-switcher" ref={ref}>
      <button
        className={`awm-switcher-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <FontAwesomeIcon
          icon={isSuggestionsMode ? faWandMagicSparkles : faFolderOpen}
          className="awm-switcher-trigger-icon"
        />
        <span className="awm-switcher-label">{label}</span>
        <FontAwesomeIcon icon={faChevronDown} className="awm-switcher-caret" />
      </button>

      {open && (
        <div className="awm-switcher-menu">
          <div className="awm-switcher-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workspaces…"
            />
          </div>

          <div className="awm-switcher-list">
            <button
              className={`awm-switcher-item ${isSuggestionsMode ? 'selected' : ''}`}
              onClick={() => choose(onShowSuggestions)}
            >
              <FontAwesomeIcon icon={faWandMagicSparkles} className="awm-switcher-item-icon ai" />
              <span>AI Suggestions</span>
            </button>

            {filtered.map(w => {
              const count = (w.urls?.length || 0) + (w.apps?.length || 0);
              const isSel = w.id === selectedId && !isSuggestionsMode;
              return (
                <button
                  key={w.id}
                  className={`awm-switcher-item ${isSel ? 'selected' : ''}`}
                  onClick={() => choose(() => onSelect?.(w))}
                >
                  <FontAwesomeIcon
                    icon={isSel ? faFolderOpen : faFolder}
                    className="awm-switcher-item-icon"
                  />
                  <span>{w.name}</span>
                  {count > 0 && <em>{count}</em>}
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="awm-switcher-empty">No workspaces match “{query}”</div>
            )}
          </div>

          <button className="awm-switcher-create" onClick={() => choose(onCreateNew)}>
            <FontAwesomeIcon icon={faPlus} />
            Create new workspace
          </button>
        </div>
      )}
    </div>
  );
}
