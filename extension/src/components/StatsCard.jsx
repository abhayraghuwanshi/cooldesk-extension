import React, { useEffect, useState } from 'react';
import { getDomainFromUrl, getFaviconUrl, formatTime, getUrlParts } from '../utils';

export function StatsCard({ item, showCount = false, onAISuggest }) {
  const favicon = getFaviconUrl(item.url)
  const domain = getDomainFromUrl(item.url)
  const [timeMs, setTimeMs] = useState(0);
  const cleanedKey = getUrlParts(item.url).key || null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'getTimeSpent' });
        if (mounted && resp?.ok && cleanedKey) {
          setTimeMs(resp.timeSpent?.[cleanedKey] || 0);
        }
      } catch {
        // ignore
      }
    })();
    return () => { mounted = false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanedKey, item.url]);

  const handleCardClick = () => {
    window.open(item.url, '_blank')
  }

  const handleGetRelated = (e) => {
    e.stopPropagation()
    onAISuggest(item.url, item.title || domain)
  }

  return (
    <li className="stats-card" onClick={handleCardClick}>
      <div className="row">
        {favicon && <img className="stats-favicon" src={favicon} alt="" />}
        <span className="stats-title">{item.title || 'No Title'}</span>
      </div>
      <div className="row space">
        <span className="muted" title={domain}>
          {domain && domain.length > 16 ? `${domain.slice(0, 16)}…` : domain}
        </span>
        {formatTime(timeMs) && (
          <span className="time-spent-badge" style={{ marginLeft: 'auto' }}>{formatTime(timeMs)}</span>
        )}
      </div>
    </li>
  )
}
