import { faHouse, faWindowRestore, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef } from 'react';
import { ShelfView } from '../../features/shelf/ShelfView';
import { NotesView } from '../../features/browser/NotesView';
import { ClipboardSection } from '../../features/clipboard/ClipboardSection';
import { openNewAppWindow } from '../../features/dock/surface';

const isDesktopApp = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

// Browse's side panel — Home, one scroll: tabs, the workspace's links,
// folders (BrowseView's nav), then your notes on the current page, clipboard
// history and the Shelf (downloads and dropped files).
// The page's own tools are on its toolbar (PageToolbox) and the memory list
// on the usage meter — there's no Page tab any more.
// Files aren't here: a folder opens as a tab in the main view, with the full
// file manager (FileTab). `tab` may name a spot inside Home — 'notes' or
// 'shelf' (the downloads badge) — which Home scrolls to.

/**
 * @param onOpen        (path, isDir) → open a file or folder as a main-view tab
 * @param active        the panel is on screen
 * @param onClose       hide the panel
 * @param tab           a spot to scroll Home to ('shelf', 'notes'), else 'tabs'
 * @param nav           Home's content
 * @param shelf         from useShelf
 * @param notesUrl / notesPaneId  page in the active tab, for its notes
 * @param search        the jump search box, shown in the header
 * @param create        the + menu (new tab / note / shell / folders)
 * @param menu          the app menu (Settings, Cool Activity, Sidebar / Dock,
 *                      updates) — it lives here, not on the toolbar
 */
export function FilesView({ onOpen, active, onClose, tab = 'tabs', shelf, nav, notesUrl, notesPaneId, menu = null, create = null, search = null }) {
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
        {search || (
          <>
            <span className="fp-title" title="Home: tabs, workspace links, folders, notes and the Shelf">
              <FontAwesomeIcon icon={faHouse} />
              <span>Home</span>
            </span>
            <span className="fp-spacer" />
          </>
        )}
        {create}
        {/* Another full CoolDesk window, on the screen you're on — its own
            tabs, terminals and space (like a second Explorer / Finder window). */}
        {isDesktopApp && (
          <button
            className="bp-btn"
            onClick={() => openNewAppWindow().catch((e) => console.error('[CoolDesk] New window failed:', e))}
            title="New window (Ctrl/Cmd+Shift+N)"
            aria-label="New window"
          >
            <FontAwesomeIcon icon={faWindowRestore} />
          </button>
        )}
        {menu}
        <button className="bp-btn" onClick={onClose} title="Hide the side panel">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      <div className="fp-body nav-body">
        {nav}
        {/* Notes on the page you're on — only a web page has them. */}
        {notesUrl && (
          <section className="nav-section fp-home-section" ref={notesRef}>
            <div className="nav-section-head"><span>Notes on this page</span></div>
            <NotesView url={notesUrl} paneId={notesPaneId} shelf={shelf} />
          </section>
        )}
        {/* Clipboard history — click copies back, to paste into a page or
            a terminal. The same section as the sidebar's; renders nothing
            while history is off in Settings. */}
        <div className="fp-home-clipboard">
          <ClipboardSection />
        </div>
        {/* Downloads and dropped files (kept 7 days). */}
        {shelfCount > 0 && (
          <section className="nav-section fp-home-section" ref={shelfRef}>
            <div className="nav-section-head">
              <span>Shelf</span>
              <span className="browse-count">{shelfCount}</span>
            </div>
            <ShelfView shelf={shelf} active={active} onOpen={(p) => onOpen(p, false)} />
          </section>
        )}
      </div>
    </div>
  );
}
