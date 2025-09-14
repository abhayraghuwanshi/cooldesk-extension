import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react';
import { getDomainFromUrl, getFaviconUrl } from '../utils';

export function ProjectSublinks({ values = [], onDelete }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  if (!values || values.length === 0) {
    return null;
  }

  return (
    <div style={{
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
            style={{
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
              border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))',
              borderRadius: '8px',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Main clickable area */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                window.open(item.url, '_blank');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flex: 1
              }}
            >
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <img
                  src={getFaviconUrl(item.url)}
                  alt=""
                  width={32}
                  height={32}
                  style={{ borderRadius: 6 }}
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
              </div>
            </div>

            {/* Action buttons */}
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              display: 'flex',
              gap: '4px',
              opacity: hoveredIndex === index ? 1 : 0,
              transition: 'opacity 0.2s ease'
            }}>
              {/* External link button */}

              {/* Delete button */}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.url, [item]);
                  }}
                  style={{
                    background: 'rgba(255, 59, 48, 0.2)',
                    border: '1px solid rgba(255, 59, 48, 0.4)',
                    borderRadius: '4px',
                    padding: '4px',
                    color: '#FF3B30',
                    cursor: 'pointer',
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease'
                  }}
                  title="Delete this link"
                  onMouseEnter={(e) => {
                    e.target.style.background = '#FF3B30';
                    e.target.style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(255, 59, 48, 0.2)';
                    e.target.style.color = '#FF3B30';
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}