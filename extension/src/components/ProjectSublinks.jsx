import React from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../utils';

export function ProjectSublinks({ values = [] }) {
  if (!values || values.length === 0) {
    return null;
  }

  return (
    <div style={{
      padding: '16px',
      borderTop: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '12px'
    }}>
      {values.map((item, index) => {
        const domain = getDomainFromUrl(item.url);
        const title = item.title || item.extractedData?.title || domain || 'Untitled';

        return (
          <div
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              window.open(item.url, '_blank');
            }}
            style={{
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
              border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))',
              borderRadius: '8px',
              padding: '12px',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = 'var(--primary, rgba(0, 122, 255, 0.4))';
              e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.08))';
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = 'var(--glass-border, rgba(255, 255, 255, 0.1))';
              e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.05))';
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <img
                  src={getFaviconUrl(item.url)}
                  alt=""
                  width={14}
                  height={14}
                  style={{ borderRadius: 3 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14,
                  color: 'var(--text, #ffffff)',
                  lineHeight: 1.4,
                  marginBottom: 2,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {title}
                </div>
                <div style={{
                  fontSize: 12,
                  color: 'var(--text-dim, rgba(255, 255, 255, 0.6))',
                  lineHeight: 1.4,
                  fontWeight: 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {domain}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}