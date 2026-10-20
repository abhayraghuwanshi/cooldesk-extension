import { faBoxArchive, faFolderOpen, faGauge, faHighlighter, faHouse, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { AddressSuggestions } from '../../features/browser/AddressSuggestions';
import { useAddressSuggestions } from '../../features/browser/useAddressSuggestions';
import { FileManager } from '../../features/file-manager/FileManager';
import { ShelfView } from '../../features/shelf/ShelfView';
import { NotesView } from '../../features/browser/NotesView';
import { PageView } from '../../features/browser/PageView';

// Browse's side panel (right): Home (workspace, open tabs, apps, folders,
// widgets), Files, Shelf,
// Notes, Page. Nothing is previewed in here — files opened from the Files or
// Shelf tab open as tabs in the main view, where there's room to read them.
// Rows in the file manager start a real OS file drag (tauri-plugin-drag), so
// dropping one on a site's upload field or drop zone uploads it.

const PANEL_TABS = [
  { id: 'tabs', label: 'Home', icon: faHouse, title: 'Home: workspace, open tabs, apps, folders and widgets' },
  { id: 'files', label: 'Files', icon: faFolderOpen, title: 'Files' },
  { id: 'shelf', label: 'Shelf', icon: faBoxArchive, title: 'Shelf: downloads, pasted clips and dropped files, kept for 7 days' },
  { id: 'notes', label: 'Notes', icon: faHighlighter, title: 'Notes: highlights and notes on this page' },
  { id: 'page', label: 'Page', icon: faGauge, title: 'Page: controls for this page, and memory' },
];

/**
 * @param path          folder the Files tab's manager shows (BrowseView owns it)
 * @param onPathChange  move the manager to another folder
 * @param onOpen        (path, isDir) → open a file or folder as a main-view tab
 * @param active        the panel is on screen
 * @param onClose       hide the panel
 * @param tab / onTab   which panel tab (BrowseView owns it, so its badge can
 *                      open the Shelf)
 * @param nav           Tabs tab content (view switch, workspace, tabs)
 * @param shelf         from useShelf
 * @param notesUrl / notesPaneId  page in the active tab, for the Notes tab
 * @param page          props for the Page tab (PageView)
 */
export function FilesView({ path, onPathChange, onOpen, active, onClose, tab = 'tabs', onTab, shelf, nav, notesUrl, notesPaneId, page }) {
  // Disk-wide file search (the spotlight's "/f": the Spotlight index over the
  // home folder). The manager's own filter box only narrows the current folder.
  const searchRef = useRef(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(-1);

  const { items } = useAddressSuggestions(query.trim() ? `/f ${query}` : '/f', { enabled: searching, withFiles: true });
  useEffect(() => { setSelected(-1); }, [items]);
  const endSearch = () => {
    setSearching(false);
    setQuery('');
    searchRef.current?.blur();
  };
  const pickResult = (item) => {
    if (!item?.path) return;
    if (item.isDir) onPathChange(item.path);
    else onOpen(item.path, false);
    endSearch();
  };
  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected(i => (i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length));
    } else if (e.key === 'Enter') {
      // Only an explicitly highlighted result opens.
      e.preventDefault();
      if (items[selected]) pickResult(items[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endSearch();
    }
  };

  return (
    <div className="fp-root">
      <div className="fp-head">
        <div className="bp-capsule fp-tabs" role="tablist" aria-label="Side panel">
          {PANEL_TABS.map(t => (
            <button
              key={t.id}
              className={`bp-btn ${tab === t.id ? 'on' : ''}`}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab?.(t.id)}
              title={t.title}
            >
              <FontAwesomeIcon icon={t.icon} />
              {/* Only the active tab spells out its name: five labels don't fit. */}
              {tab === t.id && <span>{t.label}</span>}
              {t.id === 'shelf' && shelf?.items.length > 0 && <span className="fp-tab-count">{shelf.items.length}</span>}
            </button>
          ))}
        </div>
        {tab === 'files' ? (
          <form className={`bp-address fv-search ${searching ? 'editing' : ''}`} onSubmit={e => e.preventDefault()}>
            <FontAwesomeIcon className="bp-address-icon" icon={faMagnifyingGlass} />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              placeholder="Search all files"
              spellCheck={false}
            />
          </form>
        ) : <span className="fp-spacer" />}
        <button className="bp-btn" onClick={onClose} title="Hide the side panel">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {tab === 'tabs' && nav && <div className="fp-body nav-body">{nav}</div>}
      {tab === 'shelf' && shelf && (
        <div className="fp-body">
          <ShelfView shelf={shelf} active={active && tab === 'shelf'} onOpen={(p) => onOpen(p, false)} />
        </div>
      )}
      {tab === 'notes' && (
        <div className="fp-body">
          <NotesView url={notesUrl} paneId={notesPaneId} shelf={shelf} />
        </div>
      )}
      {tab === 'page' && page && (
        <div className="fp-body">
          <PageView {...page} />
        </div>
      )}
      {/* Kept mounted on the other tabs so the manager's folder survives. */}
      <div className="fp-body" hidden={tab !== 'files'}>
        {searching && (
          <AddressSuggestions items={items} selected={selected} onPick={pickResult} onHover={setSelected} scope="f" />
        )}
        <div className="fp-manager">
          <FileManager
            embedded
            compact
            projectBar={false}
            placesRow
            quickLook={false}
            isOpen={active && tab === 'files'}
            initialPath={path}
            onClose={onClose}
            onOpenFile={(p) => onOpen(p, false)}
          />
        </div>
      </div>
    </div>
  );
}
