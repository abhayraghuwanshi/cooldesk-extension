import { faBroom, faGlobe, faHistory, faRotateRight, faThumbtack, faTrash, faUndo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { enqueueOpenInChrome, getHostTabs } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function CurrentTabsSection({ onAddPing, onRequestPreview }) {
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [hoveredTabId, setHoveredTabId] = React.useState(null);
  const hoverTimeoutRef = React.useRef(null);
  const [removingTabIds, setRemovingTabIds] = React.useState(new Set());
  const [autoCleanupEnabled, setAutoCleanupEnabled] = React.useState(false);
  const [recentlyClosed, setRecentlyClosed] = React.useState([]);
  const [showRecentlyClosed, setShowRecentlyClosed] = React.useState(false);



  const refreshTabs = React.useCallback(() => {
    setTabsError(null);
    try {
      const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;
      if (hasTabsQuery) {
        chrome.tabs.query({}, async (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            setTabsError(lastErr.message || 'Unable to query tabs');
            setTabs([]);
            return;
          }
          const tabList = Array.isArray(list) ? list : [];
          setTabs(tabList);
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

  // Load auto-cleanup setting from storage
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
          const result = await chrome.storage.local.get(['autoCleanupEnabled']);
          setAutoCleanupEnabled(result.autoCleanupEnabled || false);
        }
      } catch (e) {
        console.warn('Failed to load auto-cleanup setting:', e);
      }
    };
    loadSettings();
  }, []);

  React.useEffect(() => {
    refreshTabs();
    const id = setInterval(refreshTabs, 15000);
    return () => {
      clearInterval(id);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, [refreshTabs]);

  // Toggle auto-cleanup and save to storage
  const toggleAutoCleanup = React.useCallback(async () => {
    const newValue = !autoCleanupEnabled;
    setAutoCleanupEnabled(newValue);

    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ autoCleanupEnabled: newValue });

        // Send message to background script to update cleanup state
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'setAutoCleanup',
            enabled: newValue
          });
        }
      }
    } catch (e) {
      console.warn('Failed to save auto-cleanup setting:', e);
    }
  }, [autoCleanupEnabled]);

  // Fetch recently closed tabs
  const fetchRecentlyClosed = React.useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.sessions?.getRecentlyClosed) {
        const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
        const closedTabs = sessions
          .filter(session => session.tab) // Only include tabs, not windows
          .map(session => session.tab)
          .filter(tab => {
            // Filter out system/extension tabs
            const url = tab.url || '';
            return !url.startsWith('chrome://') &&
              !url.startsWith('chrome-extension://') &&
              !url.startsWith('edge://') &&
              !url.startsWith('moz-extension://');
          });
        setRecentlyClosed(closedTabs);
      }
    } catch (e) {
      console.warn('Failed to fetch recently closed tabs:', e);
      setRecentlyClosed([]);
    }
  }, []);

  // Restore a recently closed tab
  const restoreTab = React.useCallback(async (sessionId) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.sessions?.restore) {
        await chrome.sessions.restore(sessionId);
        // Refresh the recently closed list after restoration
        setTimeout(fetchRecentlyClosed, 500);
        // Also refresh current tabs
        setTimeout(refreshTabs, 500);
      }
    } catch (e) {
      console.warn('Failed to restore tab:', e);
    }
  }, [fetchRecentlyClosed, refreshTabs]);

  // Load recently closed tabs when component mounts or when toggled
  React.useEffect(() => {
    if (showRecentlyClosed) {
      fetchRecentlyClosed();
    }
  }, [showRecentlyClosed, fetchRecentlyClosed]);

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

    // Accent colors for variety - warmer theme-aligned colors
    const accentColors = [
      '#8b5a3c', // Warm brown
      '#6b7280', // Gray
      '#4b5563', // Slate
      '#22c55e', // Green
      '#ea580c', // Orange
      '#a855f7', // Purple
      '#f43f5e', // Rose
      '#d97706', // Amber
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

  // Sort tabs by hostname (DNS) so similar URLs are grouped, filter out removing tabs
  const sortedTabs = React.useMemo(() => {
    const getHost = (t) => {
      try { return new URL(t?.url || '').hostname || ''; } catch { return ''; }
    };
    const arr = Array.isArray(tabs) ? [...tabs] : [];
    // Filter out tabs that are being removed
    const filteredArr = arr.filter(tab => !removingTabIds.has(tab.id));
    filteredArr.sort((a, b) => {
      const ha = getHost(a);
      const hb = getHost(b);
      if (ha !== hb) return ha.localeCompare(hb);
      // Secondary sort: by full URL for stable grouping
      const ua = a?.url || '';
      const ub = b?.url || '';
      return ua.localeCompare(ub);
    });
    return filteredArr;
  }, [tabs, removingTabIds]);

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

      // Immediate UI feedback - add to removing set
      setRemovingTabIds(prev => new Set([...prev, tab.id]));

      const hasRemove = typeof chrome !== 'undefined' && chrome?.tabs?.remove;
      if (hasRemove && tab.id != null) {
        chrome.tabs.remove(tab.id, () => {
          // Remove from removing set after API call completes
          setRemovingTabIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(tab.id);
            return newSet;
          });
          // Refresh tabs to get updated list
          setTimeout(refreshTabs, 100);
        });
      } else {
        // If no Chrome API, just remove from removing set
        setTimeout(() => {
          setRemovingTabIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(tab.id);
            return newSet;
          });
        }, 500);
      }
    } catch (e) {
      console.warn('Failed to remove tab', e);
      // Remove from removing set on error
      setRemovingTabIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(tab.id);
        return newSet;
      });
    }
  }, [refreshTabs]);

  const duplicateTab = React.useCallback((tab) => {
    try {
      if (!tab) return;
      const hasDuplicate = typeof chrome !== 'undefined' && chrome?.tabs?.duplicate;
      if (hasDuplicate && tab.id != null) {
        chrome.tabs.duplicate(tab.id, (newTab) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            // Fallback to navigate current tab if duplicate fails
            if (tab.url && chrome?.tabs?.update) {
              chrome.tabs.update({ url: tab.url });
            } else if (tab.url && chrome?.tabs?.create) {
              chrome.tabs.create({ url: tab.url });
            }
          }
        });
        return;
      }
      // Fallbacks: update current tab or enqueue open via host bridge
      if (tab?.url && typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        chrome.tabs.update({ url: tab.url });
      } else if (tab?.url && typeof chrome !== 'undefined' && chrome?.tabs?.create) {
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
      {/* CSS for spinner animation */}
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>

      {/* Apple-style Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h2 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {/* <FontAwesomeIcon icon={faClone} style={{ color: '#007AFF', fontSize: '20px', display: 'inline-block', width: '20px', height: '20px' }} /> */}
          Tabs
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Recently closed toggle */}
          <button
            onClick={() => setShowRecentlyClosed(!showRecentlyClosed)}
            style={{
              height: 32,
              borderRadius: 16,
              border: showRecentlyClosed
                ? '1px solid rgba(255, 149, 0, 0.3)'
                : '1px solid transparent',
              background: showRecentlyClosed
                ? 'rgba(255, 149, 0, 0.2)'
                : 'rgba(255, 255, 255, 0.1)',
              color: showRecentlyClosed ? '#FF9500' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            aria-label="Recently closed"
            title={`Recently closed tabs ${showRecentlyClosed ? 'shown' : 'hidden'}`}
          >
            <FontAwesomeIcon icon={faHistory} style={{ fontSize: '12px', color: 'currentColor', display: 'inline-block', width: '12px', height: '12px' }} />
          </button>

          {/* Auto-cleanup toggle */}
          <button
            onClick={toggleAutoCleanup}
            style={{
              height: 32,
              borderRadius: 16,
              border: 'none',
              background: autoCleanupEnabled
                ? 'rgba(52, 199, 89, 0.2)'
                : 'rgba(255, 255, 255, 0.1)',
              color: autoCleanupEnabled ? '#34C759' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            aria-label="Auto-cleanup"
            title={`Auto-cleanup ${autoCleanupEnabled ? 'enabled' : 'disabled'}`}
          >
            <FontAwesomeIcon icon={faBroom} style={{ fontSize: '12px', color: 'currentColor', display: 'inline-block', width: '12px', height: '12px' }} />
          </button>

          {/* Reload button */}
          <button
            onClick={refreshTabs}
            style={{
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
            <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: '12px', color: 'currentColor', display: 'inline-block', width: '12px', height: '12px' }} />
          </button>
        </div>
      </div>

      {tabsError ? (
        <div style={{
          background: 'rgba(255, 59, 48, 0.1)',
          border: '1px solid rgba(255, 59, 48, 0.2)',
          borderRadius: 12,
          padding: 12,
          color: '#FF3B30',
          fontSize: 'var(--font-size-base)',
          marginBottom: 16
        }}>
          {String(tabsError)}
        </div>
      ) : (
        <div>
          {/* Dock-style tab display */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'center',
            alignItems: 'flex-end',
            padding: '20px 16px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            minHeight: '100px',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 4px 20px rgba(0, 0, 0, 0.1)'
          }}>
            {sortedTabs.length === 0 ? (
              <div style={{
                width: '100%',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 400,
                padding: '20px',
                fontStyle: 'italic'
              }}>
                No tabs found
              </div>
            ) : (
              sortedTabs.map(tab => {
                const colors = getDomainColor(tab.url);
                const isHovered = hoveredTabId === tab.id;

                return (
                  <div
                    key={tab.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      transform: isHovered ? 'scale(1.15) translateY(-6px)' : 'scale(1)',
                      zIndex: isHovered ? 10 : 1,
                      position: 'relative',
                      padding: '8px',
                      margin: '4px',
                      borderRadius: '8px'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                      if (hasTabsUpdate) {
                        focusTab(tab);
                      } else if (tab?.url) {
                        enqueueOpenInChrome(tab.url).catch(() => { });
                      }
                    }}
                    onMouseEnter={() => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                        hoverTimeoutRef.current = null;
                      }
                      setHoveredTabId(tab.id);
                    }}
                    onMouseLeave={() => {
                      // Simple timeout to prevent flickering
                      hoverTimeoutRef.current = setTimeout(() => {
                        setHoveredTabId(null);
                        hoverTimeoutRef.current = null;
                      }, 150);
                    }}
                  >
                    {/* Dock Icon Container */}
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      background: `linear-gradient(145deg, ${colors.bg})`,
                      border: `2px solid ${colors.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      overflow: 'hidden',
                      boxShadow: isHovered
                        ? `0 8px 32px rgba(0, 122, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)`
                        : `0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
                      backdropFilter: 'blur(10px)'
                    }}>
                      {/* Favicon */}
                      {(() => {
                        const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
                        const primaryRaw = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 32);
                        let originIco = '';
                        try {
                          const u = new URL(tab.url || '');
                          if (u.protocol === 'http:' || u.protocol === 'https:') {
                            originIco = `${u.origin}/favicon.ico`;
                          }
                        } catch { }
                        const src = primaryRaw || originIco || '';
                        return src ? (
                          <img
                            src={src}
                            alt=""
                            width={24}
                            height={24}
                            style={{
                              borderRadius: 4,
                              opacity: 0.9
                            }}
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
                        ) : (
                          <div style={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            background: 'rgba(255, 255, 255, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'rgba(255, 255, 255, 0.8)'
                          }}>
                            <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '12px' }} />
                          </div>
                        );
                      })()}

                      {/* Active indicator dot */}
                      {tab.active && (
                        <div style={{
                          position: 'absolute',
                          bottom: '-2px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          background: '#34C759',
                          boxShadow: '0 0 6px #34C759'
                        }} />
                      )}
                    </div>

                    {/* Tab Label */}
                    <div style={{
                      marginTop: '4px',
                      fontSize: 'calc(var(--font-size-xs) * 0.85)',
                      color: 'rgba(255, 255, 255, 0.8)',
                      fontWeight: '500',
                      textAlign: 'center',
                      maxWidth: '60px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      opacity: isHovered ? 1 : 0.7,
                      transition: 'opacity 0.3s ease'
                    }}>
                      {(() => {
                        try {
                          return new URL(tab?.url || '').hostname.replace('www.', '');
                        } catch {
                          return 'Unknown';
                        }
                      })()}
                    </div>

                    {/* Hover Actions Popup */}
                    <div
                      className="tab-actions"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        position: 'absolute',
                        right: '8px',
                        top: '-40px',
                        background: 'var(--color-card-bg)',
                        padding: '2px 5px',
                        borderRadius: '12px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                        zIndex: 10, // Ensure it's above other content
                        opacity: hoveredTabId === tab.id ? 1 : 0,
                        visibility: hoveredTabId === tab.id ? 'visible' : 'hidden',
                        transition: 'opacity 0.2s ease, visibility 0.2s ease'
                      }}
                    >
                      {/* Pin Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPing(tab);
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'rgba(255, 149, 0, 0.9)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: '12px',
                          transition: 'all 0.2s ease'
                        }}
                        title="Pin tab"
                        onMouseEnter={(e) => {
                          e.target.style.background = 'rgba(255, 149, 0, 1)';
                          e.target.style.transform = 'scale(1.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = 'rgba(255, 149, 0, 0.9)';
                          e.target.style.transform = 'scale(1)';
                        }}
                      >
                        <FontAwesomeIcon icon={faThumbtack} />
                      </button>

                      {/* Close Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTab(tab);
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'rgba(255, 59, 48, 0.9)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: '12px',
                          transition: 'all 0.2s ease'
                        }}
                        title="Close tab"
                        onMouseEnter={(e) => {
                          e.target.style.background = 'rgba(255, 59, 48, 1)';
                          e.target.style.transform = 'scale(1.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = 'rgba(255, 59, 48, 0.9)';
                          e.target.style.transform = 'scale(1)';
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Recently Closed Tabs Section */}
      {showRecentlyClosed && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{
            fontSize: 'var(--font-size-lg)',
            fontWeight: 600,
            margin: '0 0 12px 0',
            color: '#ffffff',
            letterSpacing: '-0.3px',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <FontAwesomeIcon icon={faHistory} style={{ color: '#FF9500', fontSize: '14px' }} />
            Recently Closed
            <span style={{
              fontSize: 'var(--font-size-xs)',
              color: '#ffffff',
              background: 'rgba(255, 149, 0, 0.2)',
              padding: '2px 6px',
              borderRadius: 8,
              fontWeight: 500,
              border: '1px solid rgba(255, 149, 0, 0.3)'
            }}>
              {recentlyClosed.length}
            </span>
          </h3>

          {recentlyClosed.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 400,
              padding: '20px',
              fontStyle: 'italic',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              No recently closed tabs
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '8px',
              width: '100%'
            }}>
              {recentlyClosed.map((tab, index) => {
                const colors = getDomainColor(tab.url);
                return (
                  <div
                    key={`${tab.sessionId || index}-${tab.url}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 6,
                      border: '1px solid rgba(255, 149, 0, 0.2)',
                      backdropFilter: 'blur(10px)',
                      transition: 'all 0.2s ease',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreTab(tab.sessionId);
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 149, 0, 0.08)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = `0 4px 12px rgba(255, 149, 0, 0.2)`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {/* Favicon and Title */}
                    <div style={{
                      padding: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      {(() => {
                        const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
                        const primaryRaw = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 32);
                        let originIco = '';
                        try {
                          const u = new URL(tab.url || '');
                          if (u.protocol === 'http:' || u.protocol === 'https:') {
                            originIco = `${u.origin}/favicon.ico`;
                          }
                        } catch { }
                        const src = primaryRaw || originIco || '';
                        return src ? (
                          <img
                            src={src}
                            alt=""
                            width={16}
                            height={16}
                            style={{
                              borderRadius: 3,
                              opacity: 0.8,
                              flexShrink: 0
                            }}
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
                        ) : (
                          <div style={{
                            width: 16,
                            height: 16,
                            borderRadius: 3,
                            background: 'rgba(255, 149, 0, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#FF9500',
                            fontSize: '10px',
                            flexShrink: 0
                          }}>
                            <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '10px', display: 'inline-block', color: 'currentColor' }} />
                          </div>
                        );
                      })()}

                      <div style={{
                        flex: 1,
                        minWidth: 0
                      }}>
                        <div style={{
                          fontSize: 'var(--font-size-sm)',
                          color: '#ffffff',
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: 1.2
                        }}>
                          {tab.title || (() => {
                            try {
                              return new URL(tab?.url || '').hostname;
                            } catch {
                              return tab?.url || 'Unknown';
                            }
                          })()}
                        </div>
                        <div style={{
                          fontSize: 'calc(var(--font-size-xs) * 0.9)',
                          color: 'rgba(255, 255, 255, 0.6)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '2px'
                        }}>
                          {(() => {
                            try {
                              return new URL(tab?.url || '').hostname;
                            } catch {
                              return 'Invalid URL';
                            }
                          })()}
                        </div>
                      </div>

                      {/* Restore icon */}
                      <div style={{
                        width: 20,
                        height: 20,
                        borderRadius: 3,
                        background: 'rgba(255, 149, 0, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#FF9500',
                        fontSize: 'calc(var(--font-size-xs) * 0.8)',
                        flexShrink: 0
                      }}>
                        <FontAwesomeIcon icon={faUndo} style={{ fontSize: '10px', display: 'inline-block', color: 'currentColor' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
