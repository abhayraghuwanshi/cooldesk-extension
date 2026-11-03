import { faArrowRight, faArrowUpRightFromSquare, faCheck, faChevronDown, faChevronRight, faEye, faEyeSlash, faKey, faLock, faPen, faPlus, faRotate, faShieldHalved, faUser, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { generatePassword, useVaultEntries, useVaultStatus } from './useVault';
import '../clipboard/clipboard.css';
import './vault.css';

// Password vault in the side dock, under the clipboard card. Set a master
// password once, then unlock to see logins: click a row to copy its password
// (cleared from the clipboard after 30s), or use the row actions to copy the
// username, open the site, or edit. Locks itself after 5 minutes idle.
// Renders nothing until turned on in Settings.

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const COLLAPSED_KEY = 'cooldesk.vault.collapsed';
const PEEK = 5;

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}

function hostOf(url) {
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** A stable hue per name, so entries are told apart at a glance. */
function avatarStyle(name) {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) % 360;
  // As custom properties: wallpaper mode forces span colours with !important,
  // which an inline `color` can't beat (vault.css applies these).
  return { '--vt-av-bg': `hsl(${h} 60% 50% / 0.22)`, '--vt-av-fg': `hsl(${h} 85% 78%)` };
}

function Field({ label, children }) {
  return (
    <label className="vt-field">
      <span className="vt-label">{label}</span>
      {children}
    </label>
  );
}

function IconBtn({ icon, label, onClick, active = false }) {
  return (
    <button
      type="button"
      className={`cb-icon-btn${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}

/** Master password form, for both first-time setup and unlocking. */
function MasterForm({ creating, onSubmit }) {
  const [master, setMaster] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !master) return;
    if (creating && master !== confirm) { setError('Passwords don’t match'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit(master);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <form className="vt-lock" onSubmit={submit}>
      <div className="vt-lock-icon"><FontAwesomeIcon icon={creating ? faShieldHalved : faLock} /></div>
      <div className="vt-lock-title">{creating ? 'Set up your vault' : 'Vault locked'}</div>
      <p className="vt-note">
        {creating
          ? 'Pick a master password. It encrypts everything here and can’t be recovered if you forget it.'
          : 'Enter your master password to see your logins.'}
      </p>
      <div className={`vt-input-wrap${creating ? '' : ' has-1'}`}>
        <input
          className="vt-input"
          type="password"
          placeholder={creating ? 'New master password' : 'Master password'}
          value={master}
          onChange={e => setMaster(e.target.value)}
          autoComplete={creating ? 'new-password' : 'current-password'}
          aria-invalid={!!error}
        />
        {!creating && (
          <div className="vt-inline-actions">
            <button type="submit" className="vt-inline-btn vt-go" disabled={busy || !master} aria-label="Unlock" title="Unlock">
              {busy ? <span className="vt-spinner" /> : <FontAwesomeIcon icon={faArrowRight} />}
            </button>
          </div>
        )}
      </div>
      {creating && (
        <div className="vt-input-wrap">
          <input
            className="vt-input"
            type="password"
            placeholder="Confirm master password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      )}
      {error && <div className="vt-error">{error}</div>}
      {creating && (
        <button type="submit" className="vt-primary vt-block" disabled={busy || !master || !confirm}>
          {busy ? 'Creating…' : 'Create vault'}
        </button>
      )}
    </form>
  );
}

const EMPTY = { id: null, title: '', username: '', password: '', url: '', notes: '' };

function EntryForm({ initial, vault, onDone }) {
  const [entry, setEntry] = useState(initial);
  const [show, setShow] = useState(!initial.id);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k) => (e) => setEntry(prev => ({ ...prev, [k]: e.target.value }));

  // A new entry starts with a generated password.
  useEffect(() => {
    if (!initial.id && !initial.password) {
      generatePassword().then(p => setEntry(prev => (prev.password ? prev : { ...prev, password: p }))).catch(() => { });
    }
  }, [initial]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await vault.save(entry);
      onDone();
    } catch (err) {
      setError(String(err));
    }
  };

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await vault.remove(entry.id);
      onDone();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <form className="vt-form" onSubmit={submit}>
      <div className="vt-form-head">
        <span className="cb-thumb vt-avatar" style={avatarStyle(entry.title)}>{(entry.title.trim()[0] || '?').toUpperCase()}</span>
        <span className="vt-form-title">{initial.id ? 'Edit login' : 'New login'}</span>
        <IconBtn icon={faXmark} label="Close" onClick={onDone} />
      </div>
      <Field label="Name">
        <input className="vt-input" placeholder="GitHub" value={entry.title} onChange={set('title')} autoFocus />
      </Field>
      <Field label="Username">
        <input className="vt-input" placeholder="you@example.com" value={entry.username} onChange={set('username')} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Password">
        <div className="vt-input-wrap has-2">
          <input
            className="vt-input vt-mono"
            type={show ? 'text' : 'password'}
            value={entry.password}
            onChange={set('password')}
            autoComplete="new-password"
            spellCheck={false}
          />
          <div className="vt-inline-actions">
            <button type="button" className={`vt-inline-btn${show ? ' is-active' : ''}`} title={show ? 'Hide' : 'Show'} aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(v => !v)}>
              <FontAwesomeIcon icon={show ? faEyeSlash : faEye} />
            </button>
            <button
              type="button"
              className="vt-inline-btn"
              title="Generate a new password"
              aria-label="Generate a new password"
              onClick={() => generatePassword().then(p => { setEntry(prev => ({ ...prev, password: p })); setShow(true); }).catch(() => { })}
            >
              <FontAwesomeIcon icon={faRotate} />
            </button>
          </div>
        </div>
      </Field>
      <Field label="Website">
        <input className="vt-input" placeholder="github.com" value={entry.url} onChange={set('url')} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Notes">
        <textarea className="vt-input vt-notes" value={entry.notes} onChange={set('notes')} rows={2} />
      </Field>
      {error && <div className="vt-error">{error}</div>}
      <div className="vt-form-actions">
        {entry.id && (
          <button type="button" className={`vt-ghost is-danger${confirmDelete ? ' is-armed' : ''}`} onClick={remove}>
            {confirmDelete ? 'Click again to delete' : 'Delete'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="vt-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="vt-primary" disabled={!entry.title.trim()}>Save</button>
      </div>
    </form>
  );
}

function EntryRow({ item, vault, onEdit }) {
  const [copied, setCopied] = useState(null); // 'password' | 'username'
  const [error, setError] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (field) => {
    vault.copy(item.id, field).then(() => {
      setError('');
      setCopied(field);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    }).catch(err => {
      setError(String(err));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setError(''), 2000);
    });
  };

  const sub = item.username || (item.url ? hostOf(item.url) : '');
  const title = error || (copied === 'password' ? 'Password copied · clears in 30s' : copied === 'username' ? 'Username copied' : item.title);
  return (
    <li className="cb-row">
      <div
        className="cb-row-main"
        role="button"
        tabIndex={0}
        onClick={() => copy('password')}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); copy('password'); } }}
        title="Click to copy the password"
      >
        <span className="cb-thumb vt-avatar" style={avatarStyle(item.title)}>{(item.title[0] || '?').toUpperCase()}</span>
        <div className="cb-row-text">
          <div className={`cb-row-title${error ? ' vt-error-text' : ''}`}>{title}</div>
          {sub && <div className="cb-row-meta">{sub}</div>}
        </div>
        {copied
          ? <FontAwesomeIcon icon={faCheck} className="cb-copied" />
          : (
            <div className="cb-row-actions">
              {item.username && <IconBtn icon={faUser} label="Copy username" onClick={() => copy('username')} />}
              {item.url && (
                <IconBtn
                  icon={faArrowUpRightFromSquare}
                  label="Open site"
                  onClick={() => workspaceActivityService.activate({ url: /^[a-z]+:\/\//i.test(item.url) ? item.url : `https://${item.url}` })}
                />
              )}
              <IconBtn icon={faPen} label="Edit" onClick={onEdit} />
            </div>
          )}
      </div>
    </li>
  );
}

export function VaultSection() {
  const { status, create, unlock, lock } = useVaultStatus();
  const unlocked = !!status?.unlocked;
  const vault = useVaultEntries({ active: unlocked });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null); // entry being edited / EMPTY for new

  // Locking (by hand or idle) closes any open form and drops the filter.
  useEffect(() => {
    if (!unlocked) { setEditing(null); setFilter(''); }
  }, [unlocked]);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      try { localStorage.setItem(COLLAPSED_KEY, String(!c)); } catch { /* ignore */ }
      return !c;
    });
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? vault.items.filter(i => [i.title, i.username, i.url].some(v => v && v.toLowerCase().includes(q)))
      : vault.items;
    return showAll || q ? list : list.slice(0, PEEK);
  }, [vault.items, filter, showAll]);

  const edit = (id) => vault.get(id).then(setEditing).catch(() => { });

  if (!IS_TAURI || !status?.enabled) return null;

  let body;
  if (!status.exists) body = <MasterForm creating onSubmit={create} />;
  else if (!unlocked) body = <MasterForm onSubmit={unlock} />;
  else if (editing) body = <EntryForm key={editing.id || 'new'} initial={editing} vault={vault} onDone={() => setEditing(null)} />;
  else {
    body = (
      <>
        {vault.items.length > PEEK && (
          <input
            className="cb-filter vt-search"
            type="search"
            placeholder="Search passwords…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        )}
        {visible.length ? (
          <ul className="cb-list">
            {visible.map(item => <EntryRow key={item.id} item={item} vault={vault} onEdit={() => edit(item.id)} />)}
          </ul>
        ) : (
          <div className="vt-empty">
            {vault.items.length ? 'No matches' : 'No logins yet. Add one and it’s encrypted with your master password.'}
          </div>
        )}
        <div className="vt-footer">
          <button type="button" className="vt-add" onClick={() => setEditing({ ...EMPTY })}>
            <FontAwesomeIcon icon={faPlus} /> Add login
          </button>
          {vault.items.length > PEEK && !filter && (
            <button type="button" className="cb-link-btn" onClick={() => setShowAll(s => !s)}>
              {showAll ? 'Show less' : `Show all (${vault.items.length})`}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <section className="home-stack-vault cb-section">
      <div className="cb-header">
        <div
          className="cb-header-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(); } }}
        >
          <h3 className="cb-title">
            <FontAwesomeIcon icon={faKey} style={{ opacity: 0.6 }} />
            Passwords{unlocked && vault.items.length ? ` (${vault.items.length})` : ''}
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} className="cb-chevron" />
          </h3>
        </div>
        {unlocked && (
          <div className="cb-header-actions">
            <IconBtn icon={faLock} label="Lock now" onClick={() => lock().catch(() => { })} />
          </div>
        )}
      </div>
      {!collapsed && <div className="cb-card">{body}</div>}
    </section>
  );
}
