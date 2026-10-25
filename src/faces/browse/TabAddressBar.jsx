import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { AddressSuggestions } from '../../features/browser/AddressSuggestions';
import { useAddressSuggestions } from '../../features/browser/useAddressSuggestions';

// The address box of a non-web Browse tab (file, note, shell). At rest it's
// that tab's label; clicked, it's a search box like a web tab's address bar:
// recent links, files and shells while empty (useAddressSuggestions), the
// /u + /f searches as you type. A pick opens where it belongs — a link in a
// new tab, a file / shell through the host.

/**
 * @param icon, label, sub  what the box shows at rest (sub: dim second part)
 * @param title             tooltip at rest
 * @param onOpenUrl         (url) => void
 * @param onOpenPath        (path, isDir) => void
 * @param onOpenShell       (cwd) => void
 */
export function TabAddressBar({ icon, label, sub = null, title, onOpenUrl, onOpenPath, onOpenShell }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef(null);

  const { items, scope } = useAddressSuggestions(text, { enabled: editing, withFiles: !!onOpenPath, withShells: !!onOpenShell });
  // Typed text: item 0 ("go to / search that") starts highlighted, as in the
  // web address bar; empty: nothing is, so Enter never opens a guess.
  useEffect(() => { setSelected(items[0]?.id === 'typed' ? 0 : -1); }, [items]);

  const finish = () => {
    setEditing(false);
    setText('');
    inputRef.current?.blur();
  };

  const pick = (item) => {
    finish();
    if (item.kind === 'shell') onOpenShell?.(item.cwd);
    else if (item.path) onOpenPath?.(item.path, item.isDir);
    else if (item.url) onOpenUrl?.(item.url);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected(i => (i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't also leave focus mode / the Browse face
      finish();
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (items[selected]) pick(items[selected]);
  };

  return (
    <div className="tab-address">
      <form className={`bp-address ft-address ${editing ? 'editing' : ''}`} onSubmit={submit} title={editing ? undefined : title}>
        {editing
          ? <FontAwesomeIcon className="bp-address-icon" icon={faMagnifyingGlass} />
          : icon}
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setEditing(true)}
          onBlur={() => { setEditing(false); setText(''); }}
          placeholder={editing ? 'Search links, files and shells, or type a URL' : ''}
          spellCheck={false}
          className={editing ? '' : 'masked'}
        />
        {!editing && (
          <span className="bp-address-display" aria-hidden="true">
            <span className="bp-host">{label}</span>
            {sub && <span className="bp-path ft-dir">{sub}</span>}
          </span>
        )}
      </form>
      {editing && (
        <AddressSuggestions items={items} selected={selected} onPick={pick} onHover={setSelected} scope={scope} />
      )}
    </div>
  );
}
