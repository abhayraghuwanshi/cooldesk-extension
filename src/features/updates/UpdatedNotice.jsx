import { useEffect, useState } from 'react';
import './UpdateButton.css';

/**
 * One-time "Updated to x.y.z" toast for the extension new tab. The background
 * worker (background/autoUpdate.js) writes `justUpdated` on an update install;
 * the first page to read it shows the toast and clears the key.
 */
export function UpdatedNotice() {
  const [updated, setUpdated] = useState(null);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get('justUpdated').then(({ justUpdated }) => {
      if (!justUpdated?.to) return;
      setUpdated(justUpdated);
      chrome.storage.local.remove('justUpdated');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!updated) return;
    const t = setTimeout(() => setUpdated(null), 8000);
    return () => clearTimeout(t);
  }, [updated]);

  if (!updated) return null;

  return (
    <div className="upd-toast" role="status">
      <span className="upd-toast__dot" />
      <span>Updated to <strong>{updated.to}</strong></span>
      <a
        className="upd-toast__link"
        href="https://github.com/abhayraghuwanshi/cooldesk-extension/blob/master/docs/CHANGELOG.md"
        target="_blank"
        rel="noreferrer"
      >
        What's new
      </a>
      <button type="button" className="upd-toast__close" onClick={() => setUpdated(null)} aria-label="Dismiss">×</button>
    </div>
  );
}

export default UpdatedNotice;
