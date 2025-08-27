import { faArrowUpRightFromSquare, faClone, faRotateRight, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { enqueueOpenInChrome, getHostTabs } from '../services/extensionApi';
import { getFaviconUrl } from '../utils';

export function CurrentTabsSection({ onAddPing, onRequestPreview }) {
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [hoveredTabId, setHoveredTabId] = React.useState(null);

  const refreshTabs = React.useCallback(() => {
    setTabsError(null);
    try {
      const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;
      if (hasTabsQuery) {
        chrome.tabs.query({}, (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            setTabsError(lastErr.message || 'Unable to query tabs');
            setTabs([]);
            return;
          }
          setTabs(Array.isArray(list) ? list : []);
        });
      } else {
        // Fallback: fetch tabs mirrored by the extension to the host (Electron mode)
        (async () => {
          const res = await getHostTabs();
          if (res.ok) {
            setTabs(res.tabs || []);
            setTabsError(null);
          } else {
            setTabs([]);
            // Keep UI clean in Electron: don't surface noisy errors
            setTabsError('');
          }
        })();
      }
    } catch (e) {
      // Keep UI quiet in non-Chrome environments
      setTabsError('');
      setTabs([]);
    }
  }, []);

  React.useEffect(() => {
    refreshTabs();
    const id = setInterval(refreshTabs, 15000);
    return () => clearInterval(id);
  }, [refreshTabs]);

  // Dynamic gradient generation based on domain
  const getDomainColor = React.useCallback((url) => {
    let hostname = '';
    try {
      hostname = new URL(url || '').hostname.toLowerCase();
    } catch {
      return { 
        bg: 'linear-gradient(135deg, #0f1724 0%, #1b2331 100%)', 
        border: '#273043', 
        accent: '#4a5568' 
      };
    }
    
    // Accent colors for variety
    const accentColors = [
      '#3b82f6', // Blue
      '#6b7280', // Gray  
      '#4b5563', // Slate
      '#22c55e', // Green
      '#ea580c', // Orange
      '#a855f7', // Purple
      '#f43f5e', // Rose
      '#0891b2', // Cyan
    ];
    
    // Simple hash function for consistent color selection
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = ((hash << 5) - hash) + hostname.charCodeAt(i);
      hash = hash & hash;
    }
    
    // Select an accent color based on hash
    const colorIndex = Math.abs(hash) % accentColors.length;
    const accent = accentColors[colorIndex];
    
    // Create gradient variations with the same base but different accent hints
    const variation = Math.abs(hash >> 8) % 4;
    let bg, border;
    
    switch (variation) {
      case 0:
        bg = `linear-gradient(135deg, #0f1724 0%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.1) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
        break;
      case 1:
        bg = `linear-gradient(145deg, #0f1724 0%, #1b2331 50%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.05) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.25)`;
        break;
      case 2:
        bg = `linear-gradient(125deg, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.03) 0%, #0f1724 40%, #1b2331 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.2)`;
        break;
      default:
        bg = `linear-gradient(155deg, #0f1724 0%, #1b2331 70%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.08) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
        break;
    }
    
    return {
      bg,
      border,
      accent,
      hostname
    };
  }, []);

  // Sort tabs by hostname (DNS) so similar URLs are grouped
  const sortedTabs = React.useMemo(() => {
    const getHost = (t) => {
      try { return new URL(t?.url || '').hostname || ''; } catch { return ''; }
    };
    const arr = Array.isArray(tabs) ? [...tabs] : [];
    arr.sort((a, b) => {
      const ha = getHost(a);
      const hb = getHost(b);
      if (ha !== hb) return ha.localeCompare(hb);
      // Secondary sort: by full URL for stable grouping
      const ua = a?.url || '';
      const ub = b?.url || '';
      return ua.localeCompare(ub);
    });
    return arr;
  }, [tabs]);

  const focusTab = React.useCallback((tab) => {
    if (!tab || !tab.id) return;
    try {
      const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
      if (!hasTabsUpdate) return;
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null && chrome?.windows?.update) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (e) {
      console.warn('Failed to focus tab', e);
    }
  }, []);

  const removeTab = React.useCallback((tab) => {
    try {
      if (!tab) return;
      const hasRemove = typeof chrome !== 'undefined' && chrome?.tabs?.remove;
      if (hasRemove && tab.id != null) {
        chrome.tabs.remove(tab.id);
      }
    } catch (e) {
      console.warn('Failed to remove tab', e);
    }
  }, []);

  const duplicateTab = React.useCallback((tab) => {
    try {
      if (!tab) return;
      const hasDuplicate = typeof chrome !== 'undefined' && chrome?.tabs?.duplicate;
      if (hasDuplicate && tab.id != null) {
        chrome.tabs.duplicate(tab.id, (newTab) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            // Fallback to create with URL if duplicate fails
            if (tab.url && chrome?.tabs?.create) chrome.tabs.create({ url: tab.url });
          }
        });
        return;
      }
      // Fallbacks: create or enqueue open via host bridge
      if (tab?.url && typeof chrome !== 'undefined' && chrome?.tabs?.create) {
        chrome.tabs.create({ url: tab.url });
      } else if (tab?.url) {
        enqueueOpenInChrome(tab.url).catch(() => { });
      }
    } catch (e) {
      console.warn('Failed to duplicate tab', e);
      if (tab?.url) enqueueOpenInChrome(tab.url).catch(() => { });
    }
  }, []);

  return (
    <div style={{ 
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      {/* Apple-style Header */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h2 style={{ 
          fontSize: 22,
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faClone} style={{ color: '#007AFF', fontSize: 18 }} />
          Tabs
          <span style={{ 
            fontSize: 12, 
            color: '#ffffff', 
            background: 'rgba(0, 122, 255, 0.2)', 
            padding: '4px 8px', 
            borderRadius: 12,
            fontWeight: 500,
            border: '1px solid rgba(0, 122, 255, 0.3)'
          }}>
            {tabs.length}
          </span>
        </h2>
        <button
          onClick={refreshTabs}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'rgba(255, 255, 255, 0.15)';
            e.target.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(255, 255, 255, 0.1)';
            e.target.style.transform = 'scale(1)';
          }}
          aria-label="Reload"
          title="Reload tabs"
        >
          <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: 14 }} />
        </button>
      </div>

      {tabsError ? (
        <div style={{ 
          background: 'rgba(255, 59, 48, 0.1)',
          border: '1px solid rgba(255, 59, 48, 0.2)',
          borderRadius: 12,
          padding: 12,
          color: '#FF3B30',
          fontSize: 14,
          marginBottom: 16
        }}>
          {String(tabsError)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedTabs.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              color: 'rgba(255, 255, 255, 0.5)', 
              fontSize: 16,
              fontWeight: 400,
              padding: '40px 20px',
              fontStyle: 'italic'
            }}>
              No tabs found
            </div>
          ) : (
            sortedTabs.map(tab => {
              const colors = getDomainColor(tab.url);
              return (
                <div
                  key={tab.id}
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: 12,
                    padding: 16,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(10px)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = `0 4px 16px rgba(0, 122, 255, 0.15)`;
                    setHoveredTabId(tab.id);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                    setHoveredTabId(null);
                  }}
                >
                  {/* Favicon */}
                  {(() => {
                    const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
                    const primaryRaw = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 64);
                    let originIco = '';
                    try {
                      const u = new URL(tab.url || '');
                      if (u.protocol === 'http:' || u.protocol === 'https:') {
                        originIco = `${u.origin}/favicon.ico`;
                      }
                    } catch { }
                    const src = primaryRaw || originIco || '';
                    return src ? (
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <img
                          src={src}
                          alt=""
                          width={18}
                          height={18}
                          style={{ borderRadius: 4 }}
                          onError={(e) => {
                            if (originIco && e.currentTarget.src !== originIco) { 
                              e.currentTarget.src = originIco; 
                              return; 
                            }
                            if (e.currentTarget.src.indexOf('/default-favicon.svg') === -1) { 
                              e.currentTarget.src = '/default-favicon.svg'; 
                              return; 
                            }
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.1)',
                        flexShrink: 0
                      }} />
                    );
                  })()}

                  {/* Tab Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontSize: 16, 
                      color: '#ffffff', 
                      lineHeight: 1.4,
                      marginBottom: 4,
                      fontWeight: 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {tab.title || (() => { 
                        try { 
                          return new URL(tab?.url || '').hostname; 
                        } catch { 
                          return tab?.url || ''; 
                        } 
                      })()}
                    </div>
                    {colors.hostname && (
                      <div style={{ 
                        fontSize: 13, 
                        color: 'rgba(255, 255, 255, 0.6)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {colors.hostname}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {/* Pin Button (hover only) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddPing(tab);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        border: 'none',
                        background: 'rgba(255, 149, 0, 0.1)',
                        color: '#FF9500',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        opacity: hoveredTabId === tab.id ? 1 : 0.3
                      }}
                      title="Pin tab"
                      onMouseEnter={(e) => {
                        e.target.style.background = '#FF9500';
                        e.target.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(255, 149, 0, 0.1)';
                        e.target.style.color = '#FF9500';
                      }}
                    >
                      <FontAwesomeIcon icon={faThumbtack} style={{ fontSize: 12 }} />
                    </button>

                    {/* Focus Tab Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                        if (hasTabsUpdate) return focusTab(tab);
                        if (tab?.url) {
                          enqueueOpenInChrome(tab.url).catch(() => { });
                        }
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        border: 'none',
                        background: 'rgba(0, 122, 255, 0.1)',
                        color: '#007AFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      title="Focus tab"
                      onMouseEnter={(e) => {
                        e.target.style.background = '#007AFF';
                        e.target.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(0, 122, 255, 0.1)';
                        e.target.style.color = '#007AFF';
                      }}
                    >
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ fontSize: 12 }} />
                    </button>

                    {/* Duplicate Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateTab(tab);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        border: 'none',
                        background: 'rgba(52, 199, 89, 0.1)',
                        color: '#34C759',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      title="Duplicate tab"
                      onMouseEnter={(e) => {
                        e.target.style.background = '#34C759';
                        e.target.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(52, 199, 89, 0.1)';
                        e.target.style.color = '#34C759';
                      }}
                    >
                      <FontAwesomeIcon icon={faClone} style={{ fontSize: 12 }} />
                    </button>

                    {/* Remove Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTab(tab);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        border: 'none',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#FF3B30',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        opacity: 0.7
                      }}
                      title="Close tab"
                      onMouseEnter={(e) => {
                        e.target.style.background = '#FF3B30';
                        e.target.style.color = 'white';
                        e.target.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                        e.target.style.color = '#FF3B30';
                        e.target.style.opacity = '0.7';
                      }}
                    >
                      <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
