import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import { formatTime, getDomainFromUrl, getFaviconUrl, getUrlParts } from '../utils';
import { ProjectSublinks } from './ProjectSublinks';

export const WorkspaceItem = React.forwardRef(function WorkspaceItem({ base, values, onAddRelated, timeSpentMs, onAddLink, onDelete }, ref) {
  const [showDetails, setShowDetails] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fallbackTimeMs, setFallbackTimeMs] = useState(0);
  const favicon = getFaviconUrl(base);
  const cleanedBase = getUrlParts(base).key;
  const timeString = formatTime(timeSpentMs || fallbackTimeMs);


  useEffect(() => {
    // Defer fetching per-item timeSpent until interaction to reduce initial load
    if (timeSpentMs) return; // parent provided
    if (!(showDetails || hovered)) return; // only fetch when needed
    let mounted = true;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
          if (!hasRuntime) return;
          const resp = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (res) => {
                const lastErr = chrome.runtime?.lastError;
                if (lastErr) return resolve({ ok: false, error: lastErr.message });
                resolve(res);
              });
            } catch (e) { resolve({ ok: false, error: String(e) }); }
          });
          if (mounted && resp?.ok) {
            const ms = resp.timeSpent?.[cleanedBase] || 0;
            setFallbackTimeMs(ms);
          }
        } catch (e) {
          // non-fatal
        }
      })();
    }, 300); // small delay to avoid blocking immediate interactions
    return () => { mounted = false; clearTimeout(timer); };
  }, [cleanedBase, timeSpentMs, showDetails, hovered]);

  // Get unique tags from all items in the workspace
  const tags = useMemo(() => {
    const allTags = values.flatMap(item => item.tags || []);
    return [...new Set(allTags)];
  }, [values]);

  const handleItemClick = () => {
    window.open(base, '_blank');
  };

  const toggleDetails = (e) => {
    e.stopPropagation();
    setShowDetails(!showDetails);
  };

  const handleGetRelated = (e) => {
    e.stopPropagation();
    onAddRelated(base, getDomainFromUrl(base));
  };

  const handleAddLinkClick = (e) => {
    e.stopPropagation();
    onAddLink();
  };

  return (
    <li
      className="workspace-item"
      tabIndex={0}
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleItemClick();
        }
      }}
      style={{
        borderRadius: '12px',
        marginBottom: '12px',
        backdropFilter: 'blur(10px)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)'
      }}
    >
      <div className="item-header" onClick={handleItemClick} style={{
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        {favicon && (
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <img
              src={favicon}
              alt=""
              width={18}
              height={18}
              style={{ borderRadius: 4 }}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Workspace Title - show workspace name instead of individual URL */}
          <div style={{
            fontSize: 16,
            color: 'var(--text, #ffffff)',
            lineHeight: 1.4,
            marginBottom: 2,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {(() => {
              // Try to get workspace name from extracted data, fallback to hostname
              if (values && values.length > 0 && values[0].extractedData && values[0].extractedData.workspace) {
                return values[0].extractedData.workspace;
              }
              try {
                return new URL(base).hostname;
              } catch {
                return base.length > 40 ? base.slice(0, 37) + '…' : base;
              }
            })()}
          </div>
          
          {/* URL Count and Platform Info */}
          <div style={{
            fontSize: 13,
            color: 'var(--text-dim, rgba(255, 255, 255, 0.7))',
            lineHeight: 1.4,
            marginBottom: 0,
            fontWeight: 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {(() => {
              if (values && values.length > 1) {
                // Check if this is an AI chat workspace with conversations
                const hasConversations = values.some(item => 
                  item.extractedData?.details?.type === 'conversation'
                );
                
                if (hasConversations) {
                  const conversationCount = values.filter(item => 
                    item.extractedData?.details?.type === 'conversation'
                  ).length;
                  return `${conversationCount} conversation${conversationCount !== 1 ? 's' : ''}`;
                } else {
                  return `${values.length} URLs`;
                }
              } else if (values && values.length > 0 && values[0].extractedData && values[0].extractedData.title) {
                return values[0].extractedData.title;
              } else {
                try {
                  return new URL(base).hostname;
                } catch {
                  return base.length > 40 ? base.slice(0, 37) + '…' : base;
                }
              }
            })()}
          </div>
        </div>
        <div className="item-actions">
          {values && values.length > 1 && (
            <button
              className="expand-btn"
              title={showDetails ? "Hide details" : "Show all URLs"}
              onClick={toggleDetails}
              style={{
                background: 'var(--primary, rgba(0, 122, 255, 0.1))',
                border: '1px solid var(--primary, rgba(0, 122, 255, 0.3))',
                borderRadius: '6px',
                padding: '4px 8px',
                color: 'var(--primary, #007AFF)',
                cursor: 'pointer',
                fontSize: '12px',
                marginRight: 8,
                transition: 'all 0.2s ease',
                opacity: 0.8
              }}
            >
              {showDetails ? '−' : `${values.length}`}
            </button>
          )}
          {timeString && <span className="time-spent-badge">{timeString}</span>}
          {onDelete && (
            <button
              className="delete-btn"
              title="Delete from workspace"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(base, values);
              }}
              style={{
                display: hovered ? 'inline-flex' : 'none',
                marginLeft: 8,
                background: 'rgba(255, 59, 48, 0.1)',
                border: '1px solid rgba(255, 59, 48, 0.3)',
                borderRadius: '6px',
                padding: '4px 8px',
                color: '#FF3B30',
                cursor: 'pointer',
                fontSize: '12px',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                zIndex: 10
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#FF3B30';
                e.target.style.color = 'white';
                e.target.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(255, 59, 48, 0.1)';
                e.target.style.color = '#FF3B30';
                e.target.style.transform = 'scale(1)';
              }}
            >
              <FontAwesomeIcon icon="faTrash" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Details - Show all URLs when there are multiple */}
      {showDetails && <ProjectSublinks values={values} />}

    </li>
  );
});
