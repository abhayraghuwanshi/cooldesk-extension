import { faBoxArchive, faCheck, faCopy, faCrosshairs, faHighlighter, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from './useNativePane';
import '../../styles/browse.css';

// Notes tab of Browse's side panel: highlights and notes made on the page in
// the Browse pane (page tools — src-tauri/src/browser_pane/tools.js). Lists
// them, jumps to one, edits notes and colours, exports everything.

const COLORS = { yellow: '#fde047', green: '#86efac', blue: '#93c5fd', pink: '#f9a8d4', purple: '#c4b5fd' };

function toMarkdown(page) {
  const lines = [`# ${page.title || page.url}`, page.url, ''];
  for (const h of page.items) {
    lines.push(...h.quote.exact.split('\n').map(l => `> ${l}`));
    if (h.note) lines.push('', h.note);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

function HighlightCard({ item, onFocus, onUpdate, onDelete }) {
  const [draft, setDraft] = useState(item.note || '');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(item.note || ''); }, [item.note, editing]);

  const save = () => {
    setEditing(false);
    if (draft.trim() !== (item.note || '')) onUpdate({ note: draft.trim() });
  };

  return (
    <div className="nt-card" style={{ '--hl': COLORS[item.color] || COLORS.yellow }}>
      <button className="nt-quote" onClick={onFocus} title="Show on the page">
        {item.quote.exact}
      </button>
      {editing ? (
        <textarea
          className="nt-note-edit"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(item.note || ''); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          }}
          placeholder="Add a note…"
        />
      ) : (
        <button className={`nt-note ${item.note ? '' : 'empty'}`} onClick={() => setEditing(true)}>
          {item.note || 'Add a note…'}
        </button>
      )}
      <div className="nt-actions">
        {Object.entries(COLORS).map(([c, v]) => (
          <button
            key={c}
            className={`nt-dot ${c === item.color ? 'on' : ''}`}
            style={{ background: v }}
            onClick={() => c !== item.color && onUpdate({ color: c })}
            title={c}
          />
        ))}
        <span className="nt-grow" />
        <button className="bp-btn nt-act" onClick={onFocus} title="Show on the page">
          <FontAwesomeIcon icon={faCrosshairs} />
        </button>
        <button className="bp-btn nt-act danger" onClick={onDelete} title="Delete highlight">
          <FontAwesomeIcon icon={faTrashCan} />
        </button>
      </div>
    </div>
  );
}

/**
 * @param url     page shown in the Browse pane
 * @param paneId  its pane id (to jump to a highlight)
 * @param shelf   from useShelf, for "Save to Shelf"
 */
export function NotesView({ url, paneId = 'browse', shelf }) {
  const [page, setPage] = useState({ url: '', title: '', items: [] });
  const [copied, setCopied] = useState(null);

  const load = useCallback(() => {
    if (!url || !/^https?:/i.test(url)) { setPage({ url: '', title: '', items: [] }); return; }
    invoke('highlights_list', { url }).then(setPage).catch(() => { });
  }, [url]);

  useEffect(() => {
    load();
    let off = null;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('highlights-changed', load))
      .then(fn => { if (cancelled) fn(); else off = fn; });
    return () => { cancelled = true; off?.(); };
  }, [load]);

  const flash = (what) => { setCopied(what); setTimeout(() => setCopied(c => (c === what ? null : c)), 1200); };
  const update = (id, change) => invoke('highlights_update', { url, id, color: change.color ?? null, note: change.note ?? null }).catch(() => { });
  const remove = (id) => invoke('highlights_delete', { url, id }).catch(() => { });
  const focus = (id) => invoke('browser_pane_highlight_focus', { id: paneId, highlight: id }).catch(() => { });
  const items = [...page.items].sort((a, b) => a.created - b.created);

  return (
    <div className="nt-root">
      <div className="nt-bar">
        <span className="nt-title" title={page.url}>{page.title || (items.length ? page.url : 'This page')}</span>
        {items.length > 0 && (
          <>
            <button className="bp-btn nt-act" onClick={() => navigator.clipboard.writeText(toMarkdown({ ...page, items })).then(() => flash('md'))} title="Copy all as Markdown">
              <FontAwesomeIcon icon={copied === 'md' ? faCheck : faCopy} />
            </button>
            {shelf && (
              <button
                className="bp-btn nt-act"
                onClick={() => shelf.addText(toMarkdown({ ...page, items }), `Notes – ${(page.title || 'page').slice(0, 40)}`).then(() => flash('shelf'))}
                title="Save all to the Shelf (Markdown)"
              >
                <FontAwesomeIcon icon={copied === 'shelf' ? faCheck : faBoxArchive} />
              </button>
            )}
          </>
        )}
      </div>
      <div className="nt-list">
        {items.length === 0 ? (
          <div className="sh-empty">
            <FontAwesomeIcon icon={faHighlighter} />
            <strong>No highlights on this page</strong>
            <span>Select text on the page and pick a colour. Click a highlight to add a note. They come back whenever you open this page.</span>
          </div>
        ) : items.map(item => (
          <HighlightCard
            key={item.id}
            item={item}
            onFocus={() => focus(item.id)}
            onUpdate={(change) => update(item.id, change)}
            onDelete={() => remove(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
