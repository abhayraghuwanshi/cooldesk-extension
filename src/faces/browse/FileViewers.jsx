import { faBoxArchive, faCheck, faChevronDown, faChevronRight, faCopy, faFile, faFileAudio, faFolder, faFolderOpen, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useMemo, useState } from 'react';

// Quick-Look-style viewers for a file tab, beyond PreviewPane's code /
// image / video / PDF: JSON as a tree, CSV as a table, audio, and archive
// contents (with Extract). Kinds are picked in FileTab from the extension.

export const ARCHIVE_RE = /\.(zip|tar|tgz|tbz2|txz|7z|rar|tar\.gz|tar\.bz2|tar\.xz)$/i;
export const AUDIO_RE = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aiff?)$/i;

const baseName = (p) => p.split(/[/\\]/).filter(Boolean).pop() || p;

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

function formatSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** The file's text (capped by the backend at 512 KB). */
function useText(path) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    invoke('preview_text_file', { path })
      .then(d => { if (!cancelled) setState({ status: 'ready', content: d.content, truncated: d.truncated }); })
      .catch(err => { if (!cancelled) setState({ status: 'error', error: String(err?.message || err) }); });
    return () => { cancelled = true; };
  }, [path]);
  return state;
}

function Message({ children }) {
  return <div className="fv-nopreview"><span>{children}</span></div>;
}

function CopyBtn({ label, text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="bp-btn vw-textbtn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch { /* clipboard refused */ }
      }}
    >
      <FontAwesomeIcon icon={done ? faCheck : faCopy} /> {label}
    </button>
  );
}

// ── JSON ──────────────────────────────────────────────────────────────

function JsonValue({ value }) {
  if (value === null) return <span className="js-null">null</span>;
  if (typeof value === 'string') return <span className="js-str">"{value}"</span>;
  if (typeof value === 'number') return <span className="js-num">{String(value)}</span>;
  return <span className="js-bool">{String(value)}</span>;
}

function JsonNode({ name, value, depth, openTo }) {
  const isObj = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < openTo.depth);
  // Expand all / Collapse all re-seed every node.
  useEffect(() => { setOpen(depth < openTo.depth); }, [openTo, depth]);
  const label = name !== undefined && <span className="js-key">{name}<span className="js-punct">: </span></span>;
  if (!isObj) {
    return <div className="js-row" style={{ paddingLeft: depth * 16 + 18 }}>{label}<JsonValue value={value} /></div>;
  }
  const isArr = Array.isArray(value);
  const keys = isArr ? value.map((_, i) => i) : Object.keys(value);
  return (
    <>
      <div className="js-row js-branch" style={{ paddingLeft: depth * 16 }} onClick={() => setOpen(o => !o)}>
        <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="js-caret" />
        {label}
        <span className="js-punct">{isArr ? '[' : '{'}</span>
        {!open && <span className="js-summary">{keys.length} {isArr ? (keys.length === 1 ? 'item' : 'items') : (keys.length === 1 ? 'key' : 'keys')}</span>}
        {!open && <span className="js-punct">{isArr ? ']' : '}'}</span>}
      </div>
      {open && keys.map(k => <JsonNode key={k} name={k} value={value[k]} depth={depth + 1} openTo={openTo} />)}
      {open && <div className="js-row js-punct" style={{ paddingLeft: depth * 16 + 18 }}>{isArr ? ']' : '}'}</div>}
    </>
  );
}

export function JsonView({ path }) {
  const text = useText(path);
  const [openTo, setOpenTo] = useState({ depth: 2 });
  const parsed = useMemo(() => {
    if (text.status !== 'ready') return null;
    try { return { value: JSON.parse(text.content) }; } catch (err) { return { error: err.message }; }
  }, [text]);

  if (text.status === 'loading') return <Message>Reading…</Message>;
  if (text.status === 'error') return <Message>Couldn’t read this file.</Message>;
  if (parsed.error) {
    return (
      <Message>
        {text.truncated ? 'This file is too large to format here (only the first 512 KB was read). Use Source.' : `Not valid JSON — ${parsed.error}`}
      </Message>
    );
  }
  return (
    <div className="vw-root">
      <div className="vw-bar">
        <button className="bp-btn vw-textbtn" onClick={() => setOpenTo({ depth: Infinity })}>Expand all</button>
        <button className="bp-btn vw-textbtn" onClick={() => setOpenTo({ depth: 1 })}>Collapse all</button>
        <span className="nt-grow" />
        <CopyBtn label="Copy formatted" text={() => JSON.stringify(parsed.value, null, 2)} />
        <CopyBtn label="Copy minified" text={() => JSON.stringify(parsed.value)} />
      </div>
      <div className="vw-scroll js-tree">
        <JsonNode value={parsed.value} depth={0} openTo={openTo} />
      </div>
    </div>
  );
}

// ── CSV / TSV ─────────────────────────────────────────────────────────

const MAX_ROWS = 2000;

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function CsvView({ path }) {
  const text = useText(path);
  const table = useMemo(() => {
    if (text.status !== 'ready') return null;
    const firstLine = text.content.slice(0, text.content.indexOf('\n') >>> 0);
    const delim = /\.tsv$/i.test(path) ? '\t'
      : [',', ';', '\t', '|'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
    return parseDelimited(text.content, delim);
  }, [text, path]);

  if (text.status === 'loading') return <Message>Reading…</Message>;
  if (text.status === 'error') return <Message>Couldn’t read this file.</Message>;
  if (!table.length) return <Message>This file is empty.</Message>;
  const [head, ...rows] = table;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="vw-root">
      <div className="vw-bar">
        <span className="vw-meta">
          {shown.length}{rows.length > MAX_ROWS || text.truncated ? '+' : ''} rows · {head.length} columns
          {(rows.length > MAX_ROWS || text.truncated) && ' · showing the start of the file'}
        </span>
      </div>
      <div className="vw-scroll">
        <table className="csv-table">
          <thead><tr><th className="csv-n">#</th>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}><td className="csv-n">{i + 1}</td>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Audio ─────────────────────────────────────────────────────────────

export function AudioView({ path }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    import('@tauri-apps/api/core').then(({ convertFileSrc }) => { if (!cancelled) setSrc(convertFileSrc(path)); });
    return () => { cancelled = true; };
  }, [path]);
  return (
    <div className="vw-center">
      <FontAwesomeIcon icon={faFileAudio} className="vw-big-icon" />
      <strong>{baseName(path)}</strong>
      {src && <audio className="vw-audio" controls src={src} preload="metadata" />}
    </div>
  );
}

// ── Archives ──────────────────────────────────────────────────────────

/**
 * @param onOpenFile   (path) → preview an extracted file
 * @param onShowFolder (dir) → show a folder in the Files panel
 */
export function ArchiveView({ path, onOpenFile, onShowFolder }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(null);   // 'extract' | entry name
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError(null);
    invoke('archive_list', { path })
      .then(l => { if (!cancelled) setListing(l); })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [path]);

  const files = useMemo(() => {
    if (!listing) return [];
    const q = filter.trim().toLowerCase();
    return listing.entries
      .filter(e => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [listing, filter]);
  const total = useMemo(() => (listing?.entries || []).reduce((n, e) => n + (e.size || 0), 0), [listing]);
  const fileCount = listing?.entries.filter(e => !e.is_dir).length || 0;

  const extract = async () => {
    setBusy('extract');
    setStatus(null);
    try {
      const dest = await invoke('archive_extract', { path });
      setStatus({ ok: true, text: `Extracted to ${baseName(dest)}`, dest });
      onShowFolder?.(dest);
    } catch (err) {
      setStatus({ ok: false, text: `Couldn’t extract — ${err}` });
    } finally {
      setBusy(null);
    }
  };
  const openEntry = async (entry) => {
    if (entry.is_dir) { setFilter(entry.name); return; }
    setBusy(entry.name);
    try {
      onOpenFile?.(await invoke('archive_extract_entry', { path, entry: entry.name }));
    } catch (err) {
      setStatus({ ok: false, text: `Couldn’t open ${baseName(entry.name)} — ${err}` });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Message>Can’t read this archive — {error}</Message>;
  if (!listing) return <Message>Reading the archive…</Message>;
  return (
    <div className="vw-root">
      <div className="vw-bar">
        <FontAwesomeIcon icon={faBoxArchive} className="vw-bar-icon" />
        <span className="vw-meta">
          {fileCount} file{fileCount === 1 ? '' : 's'}{total ? ` · ${formatSize(total)} unpacked` : ''}{listing.truncated ? ' · showing the first 5,000' : ''}
        </span>
        <span className="nt-grow" />
        <div className="vw-filter">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" spellCheck={false} />
        </div>
        <button className="bp-btn vw-textbtn vw-primary" onClick={extract} disabled={!!busy}>
          <FontAwesomeIcon icon={faFolderOpen} /> {busy === 'extract' ? 'Extracting…' : 'Extract here'}
        </button>
      </div>
      {status && (
        <div className={`vw-status ${status.ok ? 'ok' : 'bad'}`}>
          {status.text}
          {status.dest && <button className="fm-status-link" onClick={() => onShowFolder?.(status.dest)}>Show</button>}
        </div>
      )}
      <div className="vw-scroll">
        {files.map(e => {
          const parts = e.name.replace(/\/$/, '').split('/');
          const depth = parts.length - 1;
          return (
            <div
              key={e.name}
              className={`ar-row ${e.is_dir ? 'is-dir' : ''}`}
              style={{ paddingLeft: 12 + (filter ? 0 : depth * 16) }}
              onClick={() => openEntry(e)}
              title={e.is_dir ? e.name : `${e.name}\nClick to preview`}
            >
              <FontAwesomeIcon icon={e.is_dir ? faFolder : faFile} className="ar-icon" />
              <span className="ar-name">{filter ? e.name : parts[parts.length - 1]}</span>
              <span className="ar-size">{busy === e.name ? 'Opening…' : formatSize(e.size)}</span>
            </div>
          );
        })}
        {!files.length && <div className="bp-empty">{filter ? 'Nothing matches.' : 'This archive is empty.'}</div>}
      </div>
    </div>
  );
}
