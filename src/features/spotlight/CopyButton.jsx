import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy some text, with a brief "copied" acknowledgement on the button itself.
 *
 * `getText` is a function rather than a value so nothing is read until the
 * click — copying a long agent reply shouldn't cost anything on every render.
 *
 * If the user has selected part of the text, that selection wins. Copying the
 * whole answer when someone has clearly highlighted two lines of it is the
 * wrong answer to an unambiguous question.
 */
export function CopyButton({ getText, title = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const selection = String(window.getSelection?.() || '').trim();
    const text = selection || getText?.() || '';
    if (!text) return;

    try {
      // navigator.clipboard needs a secure context. The packaged app serves
      // from http://tauri.localhost, which counts as one (*.localhost is
      // treated as potentially trustworthy), but the fallback stays for the
      // cases where it isn't — an older webview, or an embedded surface.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.warn('[Copy] failed:', err);
    }
  }, [getText]);

  return (
    <button
      type="button"
      className={`spotlight-copy-btn${copied ? ' is-copied' : ''} ${className}`.trim()}
      // mousedown, not click: the panel's other controls preventDefault on
      // mousedown to keep focus in the input, but here the opposite matters —
      // letting mousedown through would collapse the user's selection before
      // the click handler ever runs, and the selection is what we want to copy.
      onMouseDown={copy}
      title={title}
      aria-label={title}
    >
      <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
