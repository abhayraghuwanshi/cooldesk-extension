import { faArrowLeft, faArrowRight, faChevronDown, faChevronUp, faGlobe, faLock, faMagnifyingGlass, faRotateRight, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFaviconUrl } from '../../utils/helpers.js';
import '../../styles/browse.css';
import { AddressSuggestions } from './AddressSuggestions';
import { useAddressSuggestions } from './useAddressSuggestions';
import { AUTO_FIT_KEY, hostOf, invoke, useNativePane } from './useNativePane';

/** Shown in the slot while a requested page loads behind it. */
export function PageLoader({ url, compact = false }) {
  const host = hostOf(url);
  const icon = url ? getFaviconUrl(url, 64) : null;
  const name = host ? host.split('.').slice(-2, -1)[0] || host : '';
  return (
    <div className={`bp-loader ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
      <div className="bp-loader-ring">
        {icon ? <img src={icon} alt="" /> : <span>{name.charAt(0).toUpperCase()}</span>}
      </div>
      <strong>{name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Loading'}</strong>
      <span className="bp-loader-host">Loading {host}…</span>
      {!compact && (
        <div className="bp-loader-skeleton" aria-hidden="true">
          <i /><i /><i /><i />
        </div>
      )}
    </div>
  );
}

/**
 * In-app browser: toolbar + a slot the native webview is pinned over (see
 * useNativePane for how the page tracks the slot).
 * `url` is the requested page — changing it, or bumping `requestKey` to reload
 * the same URL, navigates. `active` is false while the hosting face is
 * off-screen. `onNavigate(url, { requested })` reports both in-page navigation
 * and addresses typed into the bar (`requested: true`, the host should load it).
 * `onOpenPath(path, isDir)` receives a file/folder picked from the address
 * bar's suggestions (the host shows it in its Files view). `onTitle` reports
 * the page title (tab names); bumping `focusAddressKey` focuses the address
 * bar (⌘T / ⌘L), bumping `findKey` opens find in page (⌘F). `onTools`
 * receives the visible tab's page controls (zoom, ad blocking, dark mode,
 * screenshot, find, open externally) for the side panel's Page tab.
 * `heavy` (from usePaneGuard) shows a notice offering to stop a page that's
 * been spinning a core; a page whose process died shows a Reload screen.
 */
export function BrowserPane({ paneId, url, requestKey = 0, active, heavy = false, onDismissHeavy, onNavigate, onOpenPath, onOpenShell, onTitle, onTools, focusAddressKey = 0, findKey = 0, emptyState = null, toolbarStart = null, toolbarEnd = null }) {
  const [autoFit, setAutoFit] = useState(() => localStorage.getItem(AUTO_FIT_KEY) !== 'false');
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);

  const {
    slotRef, pageUrl, title, loading, error, zoom, revealing, crashed,
    adblockSupported, blocking, currentHost, toggleAdblock, nav, reloadCrashed, stop,
  } = useNativePane({ paneId, url, requestKey, active, autoFit, onUrl: (u) => onNavigateRef.current?.(u) });

  const onTitleRef = useRef(onTitle);
  useEffect(() => { onTitleRef.current = onTitle; }, [onTitle]);
  useEffect(() => { if (title) onTitleRef.current?.(title); }, [title]);

  // The bar shows the live page URL, except while the user is typing in it.
  const [address, setAddress] = useState(url || '');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setAddress(pageUrl); }, [pageUrl, editing]);

  // Suggestions while editing (spotlight-style /u + /f search). When text is
  // typed, item 0 is "go to / search exactly that" and starts highlighted;
  // otherwise nothing is highlighted. Either way plain Enter never opens a
  // fuzzy match — a suggestion opens only when arrowed to or clicked.
  const inputRef = useRef(null);
  useEffect(() => {
    if (focusAddressKey) inputRef.current?.focus();
  }, [focusAddressKey]);
  const [selected, setSelected] = useState(-1);
  const typed = editing && address !== pageUrl ? address : '';
  const { items, scope } = useAddressSuggestions(typed, { enabled: editing, withFiles: !!onOpenPath, withShells: !!onOpenShell });
  useEffect(() => { setSelected(items[0]?.id === 'typed' ? 0 : -1); }, [items]);

  const finishEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };

  const pick = (item) => {
    finishEditing();
    if (item.kind === 'shell') onOpenShell?.(item.cwd);
    else if (item.path) onOpenPath?.(item.path, item.isDir);
    else if (item.url) onNavigateRef.current?.(item.url, { requested: true });
  };

  const submitAddress = (e) => {
    e.preventDefault();
    if (items[selected]) return pick(items[selected]);
    // Nothing highlighted: an unchanged bar reloads the page (as Safari does);
    // a scoped query like "/f invoice" waits for an explicit pick.
    if (typed) return;
    finishEditing();
    nav('reload');
  };

  const onAddressKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected(i => (i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't also leave focus mode / the Browse face
      setAddress(pageUrl);
      finishEditing();
    }
  };

  const toggleAutoFit = () => setAutoFit(prev => {
    try { localStorage.setItem(AUTO_FIT_KEY, String(!prev)); } catch { /* keep in memory */ }
    return !prev;
  });

  // ── Find in page (page tools: highlights every match) ──────────────
  const findRef = useRef(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState(null);
  const runFind = useCallback((query, step) => {
    invoke('browser_pane_find', { id: paneId, query, step })
      .then(r => setFindResult(query ? r : null))
      .catch(() => setFindResult(query ? { count: 0, index: 0 } : null));
  }, [paneId]);
  useEffect(() => {
    if (!findKey) return;
    setFindOpen(true);
    setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0);
  }, [findKey]);
  useEffect(() => {
    if (!findOpen) return undefined;
    const t = setTimeout(() => runFind(findQuery, 0), 150);
    return () => clearTimeout(t);
  }, [findQuery, findOpen, runFind]);
  const closeFind = () => {
    setFindOpen(false);
    setFindQuery('');
    setFindResult(null);
    runFind('', 0);
  };
  const onFindKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runFind(findQuery, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  };

  // ── Quick tools: screenshot to the Shelf, dark mode per site ────────
  // Their buttons live in the side panel's Page tab (via onTools), keeping
  // the toolbar to navigation and the address.
  const screenshot = () => invoke('browser_pane_screenshot', { id: paneId });
  // Pick a table / chart / block on the page; it arrives as browser-pane-clip.
  const clip = () => invoke('browser_pane_clip', { id: paneId });
  const [darkHosts, setDarkHosts] = useState(() => new Set());
  useEffect(() => {
    invoke('page_dark_hosts').then(list => setDarkHosts(new Set(list || []))).catch(() => { });
  }, []);
  const darkHost = currentHost.replace(/^www\./, '');
  const darkOn = !!darkHost && darkHosts.has(darkHost);
  const toggleDark = () => invoke('browser_pane_set_dark', { id: paneId, on: !darkOn })
    .then(on => setDarkHosts(prev => {
      const next = new Set(prev);
      if (on) next.add(darkHost); else next.delete(darkHost);
      return next;
    }))
    .catch(err => console.warn('[BrowserPane] dark mode failed:', err));

  // Report this tab's page controls (only while it's the visible tab) so the
  // host can show them in the side panel. Actions go through a ref so the
  // object only changes when the state shown changes.
  const onToolsRef = useRef(onTools);
  useEffect(() => { onToolsRef.current = onTools; }, [onTools]);
  const actionsRef = useRef(null);
  actionsRef.current = {
    toggleAutoFit,
    toggleAdblock,
    toggleDark,
    screenshot,
    clip,
    find: () => {
      setFindOpen(true);
      setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0);
    },
    openExternal: () => (pageUrl || url) && invoke('open_url', { url: pageUrl || url }),
  };
  const actions = useMemo(() => Object.fromEntries(
    ['toggleAutoFit', 'toggleAdblock', 'toggleDark', 'screenshot', 'clip', 'find', 'openExternal']
      .map(name => [name, (...args) => actionsRef.current[name](...args)]),
  ), []);
  useEffect(() => {
    if (!active) return;
    onToolsRef.current?.({
      paneId,
      url: pageUrl || url || null,
      host: darkHost,
      zoom,
      autoFit,
      adblockSupported,
      blocking,
      darkOn,
      ...actions,
    });
  }, [active, paneId, pageUrl, url, darkHost, zoom, autoFit, adblockSupported, blocking, darkOn, actions]);

  // Resting address shows like a site, not a URL: lock + bold host + dim path.
  let display = null;
  try {
    const u = new URL(address);
    display = { secure: u.protocol === 'https:', host: u.host.replace(/^www\./, ''), rest: `${u.pathname === '/' ? '' : u.pathname}${u.search}` };
  } catch { /* not a URL yet (typing / empty) */ }

  return (
    <div className={`bp-root ${loading ? 'is-loading' : ''}`}>
      <div className="bp-toolbar">
        {toolbarStart}
        <div className="bp-capsule">
          <button className="bp-btn" onClick={() => nav('back')} title="Back" disabled={!url}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <button className="bp-btn" onClick={() => nav('forward')} title="Forward" disabled={!url}>
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
          <button className="bp-btn" onClick={() => nav('reload')} title="Reload" disabled={!url}>
            <FontAwesomeIcon icon={faRotateRight} className={loading ? 'bp-spin' : ''} />
          </button>
        </div>
        {findOpen ? (
          <form className="bp-address editing bp-find" onSubmit={e => e.preventDefault()}>
            <FontAwesomeIcon className="bp-address-icon" icon={faMagnifyingGlass} />
            <input
              ref={findRef}
              value={findQuery}
              onChange={e => setFindQuery(e.target.value)}
              onKeyDown={onFindKey}
              placeholder="Find in page"
              spellCheck={false}
            />
            <span className="bp-find-count">
              {findResult ? (findResult.count ? `${findResult.index} / ${findResult.count}` : 'No matches') : ''}
            </span>
            <button type="button" className="bp-btn" onClick={() => runFind(findQuery, -1)} title="Previous (⇧↵)" disabled={!findResult?.count}>
              <FontAwesomeIcon icon={faChevronUp} />
            </button>
            <button type="button" className="bp-btn" onClick={() => runFind(findQuery, 1)} title="Next (↵)" disabled={!findResult?.count}>
              <FontAwesomeIcon icon={faChevronDown} />
            </button>
            <button type="button" className="bp-btn" onClick={closeFind} title="Close (Esc)">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </form>
        ) : (
        <form className={`bp-address ${editing ? 'editing' : ''}`} onSubmit={submitAddress}>
          <FontAwesomeIcon
            className={`bp-address-icon ${display?.secure ? 'secure' : ''}`}
            icon={editing || !display ? faMagnifyingGlass : display.secure ? faLock : faGlobe}
          />
          <input
            ref={inputRef}
            value={address}
            onKeyDown={onAddressKey}
            onChange={e => setAddress(e.target.value)}
            onFocus={e => { setEditing(true); e.target.select(); }}
            onBlur={() => setEditing(false)}
            placeholder="Search or type a URL"
            spellCheck={false}
            title={title || address}
            className={!editing && display ? 'masked' : ''}
          />
          {!editing && display && (
            <span className="bp-address-display" aria-hidden="true">
              <span className="bp-host">{display.host}</span>
              {display.rest && <span className="bp-path">{display.rest}</span>}
              {title && <span className="bp-title">{title}</span>}
            </span>
          )}
        </form>
        )}
        {toolbarEnd}
        <span className="bp-progress" />
      </div>
      {/* The suggestions panel is a sibling over the slot, not inside it, so
          the overlay check sees the slot covered and the page hides under it. */}
      {heavy && !crashed && (
        <div className="bp-notice" role="alert">
          <span><strong>{currentHost || 'This page'}</strong> is using a lot of CPU and may slow down your Mac.</span>
          <button className="bp-notice-btn" onClick={stop}>Stop page</button>
          <button className="bp-btn" onClick={onDismissHeavy} title="Keep running">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      )}
      <div className="bp-stage">
        <div className="bp-slot" ref={slotRef}>
          {error
            ? <div className="bp-empty bp-error">{error}</div>
            : crashed ? (
              <div className="bp-crashed" role="status">
                <strong>This page stopped</strong>
                <span>{currentHost ? `${currentHost} ran out of memory or crashed.` : 'The page ran out of memory or crashed.'}</span>
                <button className="bp-notice-btn" onClick={reloadCrashed}>Reload</button>
              </div>
            )
            : revealing ? <PageLoader url={url} /> : !url && emptyState}
        </div>
        {editing && (
          <AddressSuggestions items={items} selected={selected} onPick={pick} onHover={setSelected} scope={scope} />
        )}
      </div>
    </div>
  );
}
