import { faGauge, faHouse, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef } from 'react';
import { ShelfView } from '../../features/shelf/ShelfView';
import { NotesView } from '../../features/browser/NotesView';
import { PageView } from '../../features/browser/PageView';

// Browse's side panel: two tabs.
//   Home — one scroll: tabs, the workspace's links, folders (BrowseView's
//          nav), then your notes on the current page and the Shelf
//          (downloads, pasted clips, dropped files).
//   Page — the current page's controls and memory.
// Files aren't here: a folder opens as a tab in the main view, with the full
// file manager (FileTab). `tab` may still name a spot inside Home — 'notes'
// or 'shelf' (the downloads badge) — which Home scrolls to.

const PANEL_TABS = [
  { id: 'tabs', label: 'Home', icon: faHouse, title: 'Home: tabs, workspace links, folders, notes and the Shelf' },
  { id: 'page', label: 'Page', icon: faGauge, title: "This page's controls and memory" },
];
const TOP_OF = { shelf: 'tabs', notes: 'tabs', files: 'tabs' };

/**
 * @param onOpen        (path, isDir) → open a file or folder as a main-view tab
 * @param active        the panel is on screen
 * @param onClose       hide the panel
 * @param tab / onTab   which panel tab (BrowseView owns it, so its badge can
 *                      open the Shelf)
 * @param nav           Home's content
 * @param shelf         from useShelf
 * @param notesUrl / notesPaneId  page in the active tab, for its notes
 * @param page          props for the page controls (PageView)
 */
export function FilesView({ onOpen, active, onClose, tab = 'tabs', onTab, shelf, nav, notesUrl, notesPaneId, page }) {
  const top = TOP_OF[tab] || tab;
  const shelfCount = shelf?.items.length || 0;
  const notesRef = useRef(null);
  const shelfRef = useRef(null);

  // Opened onto a spot inside Home (the downloads badge → Shelf): bring it
  // into view.
  useEffect(() => {
    const el = tab === 'shelf' ? shelfRef.current : tab === 'notes' ? notesRef.current : null;
    if (el && active) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [tab, active]);

  return (
    <div className="fp-root">
      <div className="fp-head">
        <div className="bp-capsule fp-tabs" role="tablist" aria-label="Side panel">
          {PANEL_TABS.map(t => (
            <button
              key={t.id}
              className={`bp-btn ${top === t.id ? 'on' : ''}`}
              role="tab"
              aria-selected={top === t.id}
              onClick={() => onTab?.(t.id)}
              title={t.title}
            >
              <FontAwesomeIcon icon={t.icon} />
              <span>{t.label}</span>
              {t.id === 'tabs' && shelfCount > 0 && <span className="fp-tab-count">{shelfCount}</span>}
            </button>
          ))}
        </div>
        <span className="fp-spacer" />
        <button className="bp-btn" onClick={onClose} title="Hide the side panel">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {top === 'tabs' && (
        <div className="fp-body nav-body">
          {nav}
          {/* Notes on the page you're on — only a web page has them. */}
          {notesUrl && (
            <section className="nav-section fp-home-section" ref={notesRef}>
              <div className="nav-section-head"><span>Notes on this page</span></div>
              <NotesView url={notesUrl} paneId={notesPaneId} shelf={shelf} />
            </section>
          )}
          {/* Downloads, pasted clips and dropped files (kept 7 days). */}
          {shelfCount > 0 && (
            <section className="nav-section fp-home-section" ref={shelfRef}>
              <div className="nav-section-head">
                <span>Shelf</span>
                <span className="browse-count">{shelfCount}</span>
              </div>
              <ShelfView shelf={shelf} active={active && top === 'tabs'} onOpen={(p) => onOpen(p, false)} />
            </section>
          )}
        </div>
      )}

      {top === 'page' && (
        <div className="fp-body fp-page">
          {page?.tools || page?.pages?.length
            ? <PageView {...page} />
            : <div className="browse-hint">Open a web page to see its controls and memory here.</div>}
        </div>
      )}
    </div>
  );
}
