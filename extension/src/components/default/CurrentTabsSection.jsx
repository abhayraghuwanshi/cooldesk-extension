import { faArrowUpRightFromSquare, faClone, faRotateRight, faThumbtack, faTrash, faCamera, faGlobe } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { enqueueOpenInChrome, getHostTabs } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function CurrentTabsSection({ onAddPing, onRequestPreview }) {
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [hoveredTabId, setHoveredTabId] = React.useState(null);
  const [removingTabIds, setRemovingTabIds] = React.useState(new Set());
  const [tabScreenshots, setTabScreenshots] = React.useState(new Map());
  const [capturingTabIds, setCapturingTabIds] = React.useState(new Set());

  // Capture screenshot for a specific tab using content script
  const captureTabScreenshot = React.useCallback(async (tab) => {
    if (!tab || !tab.id) return null;

    try {
      // Mark as capturing
      setCapturingTabIds(prev => new Set(prev).add(tab.id));

      // Send message to content script to capture screenshot
      const response = await new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome?.tabs?.sendMessage) {
          chrome.tabs.sendMessage(
            tab.id,
            { action: 'captureScreenshot' },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn('Content script screenshot failed:', chrome.runtime.lastError.message);
                resolve({ ok: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(response || { ok: false, error: 'No response' });
              }
            }
          );
        } else {
          resolve({ ok: false, error: 'Chrome tabs API not available' });
        }
      });

      if (response.ok && response.screenshot) {
        setTabScreenshots(prev => new Map(prev).set(tab.id, response.screenshot));
        return response.screenshot;
      } else {
        console.warn('Screenshot capture failed:', response.error);
        return null;
      }
    } catch (e) {
      console.warn('Failed to capture tab screenshot:', e);
      return null;
    } finally {
      // Remove from capturing set
      setCapturingTabIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(tab.id);
        return newSet;
      });
    }
  }, []);

  // Capture screenshot for the currently active tab only
  const captureActiveTabScreenshot = React.useCallback(async (tabList) => {
    if (!Array.isArray(tabList) || tabList.length === 0) return;

    try {
      // Find the currently active tab in the current window
      const activeTab = tabList.find(tab => tab.active && !tab.hidden);

      if (activeTab && !tabScreenshots.has(activeTab.id)) {
        // Capture screenshot for active tab without switching
        await captureTabScreenshot(activeTab);
      }
    } catch (e) {
      console.warn('Failed to capture active tab screenshot:', e);
    }
  }, [captureTabScreenshot, tabScreenshots]);

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

          // Capture screenshot for active tab only (async, don't wait)
          if (tabList.length > 0) {
            setTimeout(() => captureActiveTabScreenshot(tabList), 500);
          }
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
          <FontAwesomeIcon icon={faClone} style={{ color: '#007AFF', fontSize: 'var(--font-size-xl)' }} />
          Tabs
          <span style={{
            fontSize: 'var(--font-size-sm)',
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
          <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: 'var(--font-size-base)' }} />
        </button>
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          width: '100%'
        }}>
          {sortedTabs.length === 0 ? (
            <div style={{
              gridColumn: 'span 4',
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: 'var(--font-size-lg)',
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
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(10px)',
                    transition: 'all 0.2s ease',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();

                    // Simply navigate to the tab and stay there
                    const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                    if (hasTabsUpdate) {
                      focusTab(tab);
                    } else if (tab?.url) {
                      enqueueOpenInChrome(tab.url).catch(() => { });
                    }
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = `0 8px 24px rgba(0, 122, 255, 0.2)`;
                    setHoveredTabId(tab.id);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                    setHoveredTabId(null);
                  }}
                >
                  {/* Screenshot/Preview Area */}
                  <div style={{
                    width: '100%',
                    height: '120px',
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    {/* Screenshot or Favicon */}
                    {(() => {
                      const screenshot = tabScreenshots.get(tab.id);
                      const isCapturing = capturingTabIds.has(tab.id);

                      // Show capturing indicator
                      if (isCapturing) {
                        return (
                          <div style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0, 0, 0, 0.3)',
                            color: 'white',
                            fontSize: 'var(--font-size-sm)'
                          }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}>
                              <div style={{
                                width: '12px',
                                height: '12px',
                                border: '2px solid rgba(255, 255, 255, 0.3)',
                                borderTop: '2px solid white',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                              }} />
                              Capturing...
                            </div>
                          </div>
                        );
                      }

                      // Show actual screenshot if available
                      if (screenshot) {
                        return (
                          <img
                            src={screenshot}
                            alt={`Screenshot of ${tab.title}`}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              objectPosition: 'top left'
                            }}
                            onError={() => {
                              // Remove failed screenshot from cache
                              setTabScreenshots(prev => {
                                const newMap = new Map(prev);
                                newMap.delete(tab.id);
                                return newMap;
                              });
                            }}
                          />
                        );
                      }

                      // Fallback to favicon
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
                        <img
                          src={src}
                          alt=""
                          width={32}
                          height={32}
                          style={{
                            borderRadius: 6,
                            opacity: 0.8
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
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          background: 'rgba(255, 255, 255, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'rgba(255, 255, 255, 0.8)'
                        }}>
                          <FontAwesomeIcon icon={faGlobe} style={{ fontSize: 'var(--font-size-lg)' }} />
                        </div>
                      );
                    })()}

                    {/* Domain indicator */}
                    <div style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '4px',
                      background: 'rgba(0, 0, 0, 0.6)',
                      color: 'white',
                      fontSize: 'calc(var(--font-size-xs) * 0.85)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: '500'
                    }}>
                      {colors.hostname || 'Unknown'}
                    </div>
                  </div>

                  {/* Tab Title */}
                  <div style={{
                    padding: '12px',
                    background: 'rgba(0, 0, 0, 0.2)'
                  }}>
                    <div style={{
                      fontSize: 'var(--font-size-base)',
                      color: '#ffffff',
                      fontWeight: '500',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.3
                    }}>
                      {tab.title || (() => {
                        try {
                          return new URL(tab?.url || '').hostname;
                        } catch {
                          return tab?.url || '';
                        }
                      })()}
                    </div>
                  </div>

                  {/* Action Buttons - Positioned over screenshot on hover */}
                  {hoveredTabId === tab.id && (
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      display: 'flex',
                      gap: '4px',
                      background: 'rgba(0, 0, 0, 0.7)',
                      borderRadius: '6px',
                      padding: '4px'
                    }}>
                      {/* Screenshot Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          captureTabScreenshot(tab);
                        }}
                        disabled={capturingTabIds.has(tab.id)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          background: capturingTabIds.has(tab.id)
                            ? 'rgba(128, 128, 128, 0.9)'
                            : 'rgba(0, 122, 255, 0.9)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: capturingTabIds.has(tab.id) ? 'not-allowed' : 'pointer',
                          fontSize: 'calc(var(--font-size-xs) * 0.85)'
                        }}
                        title={capturingTabIds.has(tab.id) ? "Capturing..." : "Capture screenshot"}
                      >
                        <FontAwesomeIcon icon={faCamera} />
                      </button>

                      {/* Pin Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPing(tab);
                        }}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          background: 'rgba(255, 149, 0, 0.9)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: 'calc(var(--font-size-xs) * 0.85)'
                        }}
                        title="Pin tab"
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
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          background: 'rgba(255, 59, 48, 0.9)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: 'calc(var(--font-size-xs) * 0.85)'
                        }}
                        title="Close tab"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
