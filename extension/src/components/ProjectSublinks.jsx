import React from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../utils';

export function ProjectSublinks({ item, colors, onItemClick }) {
  const domain = getDomainFromUrl(item.url);
  const title = item.title || item.extractedData?.title || domain || 'Untitled';

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (onItemClick) {
          onItemClick(item.url);
        } else {
          window.open(item.url, '_blank');
        }
      }}
      className="workspace-item"
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '8px',
        flexShrink: 0
      }}>
        <img
          src={getFaviconUrl(item.url)}
          alt=""
          style={{
            width: '16px',
            height: '16px',
            marginRight: '8px',
            flexShrink: 0,
            borderRadius: '2px'
          }}
        />
        <div style={{
          fontSize: '12px',
          color: colors.accent || '#f43f5e',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: 500
        }}>
          {domain}
        </div>
      </div>
      <div style={{
        fontSize: '13px',
        color: '#fff',
        fontWeight: 400,
        lineHeight: '1.4',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flexGrow: 1,
        wordBreak: 'break-word'
      }}>
        {title}
      </div>
    </div>
  );
}