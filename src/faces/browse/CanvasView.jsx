import { faArrowUpRightFromSquare, faGripVertical, faPlus, faRotateRight, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { AddressSuggestions } from '../../features/browser/AddressSuggestions';
import { PageLoader } from '../../features/browser/BrowserPane';
import { useAddressSuggestions } from '../../features/browser/useAddressSuggestions';
import { hostOf, useNativePane } from '../../features/browser/useNativePane';
import { getFaviconUrl } from '../../utils/helpers.js';
import { COLS, GAP, MIN_H, MIN_W, ROW_H, compact, rowsUsed } from './canvasLayout';

// Browse canvas: several live pages as tiles on a snapping grid. Each tile is
// its own native webview (useNativePane). Native layers can't be clipped by
// the scrolling canvas or follow a drag smoothly, so:
//  - a tile only shows its live page while fully inside the canvas viewport;
//  - while any tile is being dragged/resized, every page hides and tiles show
//    their face (favicon + title) until the drop settles.

function tileRect(t, colW) {
  return {
    left: t.x * (colW + GAP),
    top: t.y * (ROW_H + GAP),
    width: t.w * colW + (t.w - 1) * GAP,
    height: t.h * ROW_H + (t.h - 1) * GAP,
  };
}

function WebTile({ tile, rect, live, clipRef, dragging, onPointerDown, onResizeDown, onRemove, onOpenInBrowse }) {
  const { slotRef, pageUrl, title, loading, shown, revealing, nav } = useNativePane({
    paneId: `tile-${tile.id}`,
    url: tile.url,
    active: live,
    clipRef,
  });
  const host = hostOf(pageUrl || tile.url);
  const icon = getFaviconUrl(pageUrl || tile.url, 32);

  return (
    <div
      className={`cv-tile ${dragging ? 'is-dragging' : ''} ${loading ? 'is-loading' : ''}`}
      style={{ transform: `translate(${rect.left}px, ${rect.top}px)`, width: rect.width, height: rect.height }}
    >
      <div className="cv-tile-head" onPointerDown={onPointerDown}>
        <FontAwesomeIcon icon={faGripVertical} className="cv-grip" />
        {icon && <img className="cv-favicon" src={icon} alt="" />}
        <span className="cv-title" title={pageUrl}>{title || host}</span>
        <div className="cv-actions" onPointerDown={e => e.stopPropagation()}>
          <button className="bp-btn" onClick={() => nav('reload')} title="Reload">
            <FontAwesomeIcon icon={faRotateRight} className={loading ? 'bp-spin' : ''} />
          </button>
          <button className="bp-btn" onClick={() => onOpenInBrowse(pageUrl || tile.url)} title="Open in Browse">
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
          <button className="bp-btn cv-close" onClick={onRemove} title="Remove from canvas">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <span className="bp-progress" />
      </div>
      <div className="cv-slot" ref={slotRef}>
        {/* Face shown whenever the live page is hidden (dragging, scrolled
            partly out of view, overlay on top). */}
        {revealing && <PageLoader url={tile.url} compact />}
        {!shown && !revealing && (
          <div className="cv-face">
            {icon && <img src={icon} alt="" />}
            <strong>{title || host}</strong>
            <span>{host}</span>
          </div>
        )}
      </div>
      <div className="cv-resize" onPointerDown={onResizeDown} title="Resize" />
    </div>
  );
}

/**
 * @param tiles / onChange   the layout (owned by BrowseView, persisted there)
 * @param active             false while the Browse face or canvas mode is off-screen
 */
export function CanvasView({ tiles, onChange, active, onAddUrl, onOpenInBrowse, quickPicks = [], toolbarStart = null, toolbarEnd = null }) {
  const scrollRef = useRef(null);
  const gridRef = useRef(null);
  const [colW, setColW] = useState(0);
  const [interaction, setInteraction] = useState(null); // { id, kind: 'move' | 'resize' }
  const [address, setAddress] = useState('');
  // Same suggestions as the Browse bar (links only: a tile can't be a file).
  // Typed text is item 0; nothing opens on Enter without it or a pick.
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(-1);
  const addInputRef = useRef(null);
  const { items, scope } = useAddressSuggestions(address, { enabled: editing, withFiles: false });
  useEffect(() => { setSelected(items[0]?.id === 'typed' ? 0 : -1); }, [items]);
  const finishAdding = () => {
    setEditing(false);
    setAddress('');
    addInputRef.current?.blur();
  };
  const pickSuggestion = (item) => {
    if (item?.url) onAddUrl(item.url);
    finishAdding();
  };
  const onAddKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected(i => (i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishAdding();
    }
  };
  const tilesRef = useRef(tiles);
  useEffect(() => { tilesRef.current = tiles; }, [tiles]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setColW((entry.contentRect.width - GAP * (COLS - 1)) / COLS);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag (header) or resize (corner): pointer deltas → grid units; the layout
  // reflows live around the pinned tile and is committed on release.
  const startInteraction = (e, tile, kind) => {
    if (e.button !== 0 || !colW) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, tile: { ...tile } };
    const unitX = colW + GAP;
    const unitY = ROW_H + GAP;
    setInteraction({ id: tile.id, kind });
    const onMove = (ev) => {
      const dx = Math.round((ev.clientX - start.x) / unitX);
      const dy = Math.round((ev.clientY - start.y) / unitY);
      const next = kind === 'move'
        ? { ...start.tile, x: start.tile.x + dx, y: start.tile.y + dy }
        : { ...start.tile, w: Math.max(MIN_W, start.tile.w + dx), h: Math.max(MIN_H, start.tile.h + dy) };
      const current = tilesRef.current.find(t => t.id === tile.id);
      if (current && current.x === next.x && current.y === next.y && current.w === next.w && current.h === next.h) return;
      onChange(compact(tilesRef.current.map(t => (t.id === tile.id ? next : t)), tile.id), { transient: true });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setInteraction(null);
      onChange(compact(tilesRef.current));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const remove = (id) => onChange(compact(tiles.filter(t => t.id !== id)));

  const submit = (e) => {
    e.preventDefault();
    if (items[selected]) pickSuggestion(items[selected]);
  };

  const rows = rowsUsed(tiles);
  const gridHeight = rows ? rows * ROW_H + (rows - 1) * GAP : 0;

  return (
    <div className="bp-root cv-root">
      <div className="bp-toolbar">
        {toolbarStart}
        <form className="bp-address cv-add" onSubmit={submit}>
          <FontAwesomeIcon className="bp-address-icon" icon={faPlus} />
          <input
            ref={addInputRef}
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={onAddKey}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            placeholder="Add a page to the canvas: URL, search, or a saved link"
            spellCheck={false}
          />
        </form>
        <span className="cv-count">{tiles.length} {tiles.length === 1 ? 'page' : 'pages'}</span>
        {toolbarEnd}
      </div>
      <div className="bp-stage">
      <div className="cv-scroll" ref={scrollRef}>
        <div className="cv-grid" ref={gridRef} style={{ height: gridHeight }}>
          {colW > 0 && tiles.map(tile => (
            <WebTile
              key={tile.id}
              tile={tile}
              rect={tileRect(tile, colW)}
              live={active && !interaction}
              clipRef={scrollRef}
              dragging={interaction?.id === tile.id}
              onPointerDown={e => startInteraction(e, tile, 'move')}
              onResizeDown={e => startInteraction(e, tile, 'resize')}
              onRemove={() => remove(tile.id)}
              onOpenInBrowse={onOpenInBrowse}
            />
          ))}
        </div>
        {tiles.length === 0 && (
          <div className="browse-hero cv-empty">
            <div className="browse-hero-orb"><FontAwesomeIcon icon={faPlus} /></div>
            <h2>Pin pages side by side</h2>
            <p>Add a URL above, or click links in the list. Drag tiles by their header, resize from the corner.</p>
            {quickPicks.length > 0 && (
              <div className="browse-hero-picks">
                {quickPicks.map(item => (
                  <button key={item.url} className="browse-chip" onClick={() => onAddUrl(item.url)} title={item.url}>
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {editing && (
        <AddressSuggestions items={items} selected={selected} onPick={pickSuggestion} onHover={setSelected} scope={scope} />
      )}
      </div>
    </div>
  );
}
