import { faArrowRight, faFile, faFolder, faGlobe, faMagnifyingGlass, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef } from 'react';

// Panel under the address bar. It covers the page area while the bar is being
// edited (the native page hides under it, like a new-tab search page) — a
// dropdown over a live page would have to hide the page anyway.

const GROUPS = [
  { kinds: ['go', 'search'], label: null },
  { kinds: ['link'], label: 'Links' },
  { kinds: ['folder', 'file'], label: 'Files', recentLabel: 'Recent files' },
  { kinds: ['shell'], label: 'Recent shells' },
];

function KindIcon({ item }) {
  if (item.icon) return <img className="as-favicon" src={item.icon} alt="" />;
  const icon = item.kind === 'search' ? faMagnifyingGlass
    : item.kind === 'go' ? faArrowRight
      : item.kind === 'folder' ? faFolder
        : item.kind === 'file' ? faFile
          : item.kind === 'shell' ? faTerminal : faGlobe;
  return <FontAwesomeIcon className={`as-kind as-kind-${item.kind}`} icon={icon} />;
}

/**
 * @param items     from useAddressSuggestions, in display order
 * @param selected  index into items (keyboard highlight)
 * @param onPick    (item) => void
 * @param onHover   (index) => void
 */
export function AddressSuggestions({ items, selected, onPick, onHover, scope }) {
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.querySelector('.as-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="as-panel" ref={listRef} onMouseDown={e => e.preventDefault() /* keep focus in the bar */}>
      <div className="as-hint">
        {scope === 'u' ? 'Links only' : scope === 'f' ? 'Files only' : 'Links and files'}
        <span>· type <kbd>/u</kbd> or <kbd>/f</kbd> to narrow · <kbd>↑</kbd><kbd>↓</kbd> to choose · <kbd>Esc</kbd> to close</span>
      </div>
      {items.length === 0 && <div className="as-empty">No matches yet.</div>}
      {GROUPS.map(group => {
        const groupItems = items.filter(i => group.kinds.includes(i.kind));
        if (groupItems.length === 0) return null;
        return (
          <section key={group.kinds[0]} className="as-group">
            {group.label && <h4>{groupItems.every(i => i.recent) && group.recentLabel ? group.recentLabel : group.label}</h4>}
            {groupItems.map(item => {
              const i = items.indexOf(item);
              return (
                <button
                  key={item.id}
                  className={`as-item ${i === selected ? 'selected' : ''}`}
                  onMouseEnter={() => onHover(i)}
                  onClick={() => onPick(item)}
                  title={item.url || item.path || item.sub}
                >
                  <span className="as-icon"><KindIcon item={item} /></span>
                  <span className="as-text">
                    <span className="as-title">{item.title}</span>
                    <span className="as-sub">{item.sub}</span>
                  </span>
                  {i === selected && <kbd className="as-enter">↵</kbd>}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
