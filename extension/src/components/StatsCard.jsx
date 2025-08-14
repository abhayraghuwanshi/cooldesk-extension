import React from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../utils';

export function StatsCard({ item, showCount = false, onAISuggest }) {
  const favicon = getFaviconUrl(item.url)
  const domain = getDomainFromUrl(item.url)

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
      </div>
    </li>
  )
}
