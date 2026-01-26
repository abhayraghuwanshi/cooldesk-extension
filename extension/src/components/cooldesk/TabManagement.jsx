import { faBrain, faClock, faFilter, faSearch, faSync, faToggleOff, faToggleOn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { scoreAndSortTabs } from '../../utils/tabScoring.js';
import { TabCard, TabGroupCard } from './TabCard';

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function TabManagement() {
  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [expandedDomain, setExpandedDomain] = useState(null);
  const [autoGroupEnabled, setAutoGroupEnabled] = useState(false);
  const [smartSortEnabled, setSmartSortEnabled] = useState(true);
  const [visibleTabsCount, setVisibleTabsCount] = useState(12);
  const [searchQuery, setSearchQuery] = useState('');
  const [tabActivity, setTabActivity] = useState({});
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Load auto-group and smart sort state on mount
  useEffect(() => {
    chrome.storage.local.get(['autoGroupEnabled', 'smartSortEnabled', 'isFocusMode'], (result) => {
      setAutoGroupEnabled(result.autoGroupEnabled || false);
      setSmartSortEnabled(result.smartSortEnabled !== false); // Default to true
      setIsFocusMode(result.isFocusMode || false);
    });
  }, []);

  // Fetch browser tabs
  const refreshTabs = useCallback(async () => {
    // Only set loading on initial empty state to avoid flickering
    if (tabs.length === 0) setTabsLoading(true);

    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
        const allTabs = await chrome.tabs.query({});

        // Sort based on user preference
        let sortedTabs;
        if (smartSortEnabled) {
          // Smart sort: Usage-based scoring
          sortedTabs = await scoreAndSortTabs(allTabs || []);
        } else {
          // Default sort: Active tabs first, then by windowId + index
          sortedTabs = (allTabs || []).sort((a, b) => {
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            if (a.windowId !== b.windowId) return a.windowId - b.windowId;
            return a.index - b.index;
          });
        }

        setTabs(sortedTabs);

        // Also fetch real-time activity data
        chrome.runtime.sendMessage({ type: 'GET_TAB_ACTIVITY' }, (response) => {
          if (response?.ok) {
            setTabActivity(response.activityData || {});
          }
        });
      }
    } catch (error) {
      console.error('[TabManagement] Failed to fetch tabs:', error);
    } finally {
      setTabsLoading(false);
    }
  }, [tabs.length, smartSortEnabled]);

  // Debounced refresh (300ms delay)
  const debouncedRefresh = useMemo(
    () => debounce(() => refreshTabs(), 300),
    [refreshTabs]
  );

  // Load tabs on mount and keep updated
  useEffect(() => {
    refreshTabs();

    // Add listeners for real-time updates
    const events = [
      chrome?.tabs?.onCreated,
      chrome?.tabs?.onUpdated,
      chrome?.tabs?.onRemoved,
      chrome?.tabs?.onActivated,
      chrome?.tabs?.onMoved,
      chrome?.tabs?.onDetached,
      chrome?.tabs?.onAttached
    ];

    // Use debounced refresh for all events
    events.forEach(event => {
      if (event?.addListener) {
        event.addListener(debouncedRefresh);
      }
    });

    return () => {
      events.forEach(event => {
        if (event?.removeListener) {
          event.removeListener(debouncedRefresh);
        }
      });
    };
  }, [refreshTabs, debouncedRefresh]);

  // Group tabs by domain
  const tabsByDomain = useCallback(() => {
    const grouped = {};
    tabs.forEach(tab => {
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;
        if (!grouped[domain]) {
          grouped[domain] = [];
        }
        grouped[domain].push(tab);
      } catch (e) {
        // Invalid URL, skip
      }
    });
    return grouped;
  }, [tabs]);

  // Handle tab actions
  const handleTabClick = useCallback(async (tab) => {
    try {
      // Switch to the existing tab instead of opening a new one
      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId && chrome?.windows?.update) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      }
    } catch (error) {
      console.error('[TabManagement] Failed to activate tab:', error);
    }
  }, []);

  const handleTabClose = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
        await chrome.tabs.remove(tab.id);
      }
    } catch (error) {
      console.error('[TabManagement] Failed to close tab:', error);
    }
  }, []);

  const handleTabPin = useCallback(async (tab) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
      }
    } catch (error) {
      console.error('[TabManagement] Failed to pin/unpin tab:', error);
    }
  }, []);

  // Filter tabs based on search and focus mode
  const filteredTabs = useMemo(() => {
    let result = tabs;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(tab =>
        tab.title?.toLowerCase().includes(query) ||
        tab.url?.toLowerCase().includes(query)
      );
    }

    if (isFocusMode && !searchQuery) {
      // Focus mode: show pinned, active, and top 20% scored tabs
      // For now, let's just show top 15 tabs if focus mode is on
      result = result.slice(0, 15);
    }

    return result;
  }, [tabs, searchQuery, isFocusMode]);

  // Get recently active tabs (excluding current active)
  const recentTabs = useMemo(() => {
    if (!tabActivity) return [];

    return tabs
      .filter(tab => !tab.active && tabActivity[tab.id])
      .sort((a, b) => (tabActivity[b.id] || 0) - (tabActivity[a.id] || 0))
      .slice(0, 4);
  }, [tabs, tabActivity]);

  // Find the VERY last active tab
  const lastActiveTabId = useMemo(() => {
    const sorted = Object.entries(tabActivity)
      .filter(([id, _]) => {
        const tab = tabs.find(t => t.id === parseInt(id));
        return tab && !tab.active;
      })
      .sort((a, b) => b[1] - a[1]);

    return sorted.length > 0 ? parseInt(sorted[0][0]) : null;
  }, [tabActivity, tabs]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      height: '100%'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h2 style={{
          fontSize: 'var(--font-2xl, 16px)',
          fontWeight: 600,
          color: 'var(--text-primary, #F1F5F9)',
          margin: 0
        }}>
          Browser Tabs
          {tabs.length > 0 && <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '8px', fontWeight: 400 }}>({tabs.length})</span>}
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={async () => {
              try {
                const newState = !smartSortEnabled;
                await chrome.storage.local.set({ smartSortEnabled: newState });
                setSmartSortEnabled(newState);
                console.log('[TabManagement] Smart sort toggled:', newState);
                refreshTabs(); // Refresh to apply new sorting
              } catch (error) {
                console.error('[TabManagement] Smart sort toggle error:', error);
              }
            }}
            style={{
              background: smartSortEnabled
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.15))'
                : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
              border: smartSortEnabled
                ? '1px solid rgba(139, 92, 246, 0.4)'
                : '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: smartSortEnabled ? '#A78BFA' : '#94A3B8',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              if (smartSortEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(124, 58, 237, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.6)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(71, 85, 105, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.5)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (smartSortEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                e.currentTarget.style.transform = 'translateY(0)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            title={smartSortEnabled
              ? "Smart sort enabled - Tabs sorted by usage patterns"
              : "Smart sort disabled - Tabs sorted by window and index"}
          >
            <FontAwesomeIcon
              icon={faBrain}
              size="lg"
              style={{ pointerEvents: 'none' }}
            />
            <span style={{ pointerEvents: 'none' }}>Smart Sort</span>
          </button>
          <button
            onClick={async () => {
              try {
                const newState = !autoGroupEnabled;
                const response = await chrome.runtime.sendMessage({
                  type: 'TOGGLE_AUTO_GROUP',
                  enabled: newState
                });

                if (response?.success) {
                  setAutoGroupEnabled(newState);
                  console.log('[TabManagement] Auto-group toggled:', newState);
                  refreshTabs(); // Refresh to show updated groups
                } else {
                  console.error('[TabManagement] Toggle failed:', response?.error);
                }
              } catch (error) {
                console.error('[TabManagement] Toggle error:', error);
              }
            }}
            style={{
              background: autoGroupEnabled
                ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15))'
                : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
              border: autoGroupEnabled
                ? '1px solid rgba(34, 197, 94, 0.4)'
                : '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: autoGroupEnabled ? '#4ADE80' : '#94A3B8',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              if (autoGroupEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(16, 185, 129, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(71, 85, 105, 0.25))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.5)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (autoGroupEnabled) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                e.currentTarget.style.transform = 'translateY(0)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            title={autoGroupEnabled
              ? "Auto-grouping enabled - Click to disable and ungroup all tabs"
              : "Auto-grouping disabled - Click to enable automatic grouping by domain"}
          >
            <FontAwesomeIcon
              icon={autoGroupEnabled ? faToggleOn : faToggleOff}
              size="lg"
              style={{ pointerEvents: 'none' }}
            />
            <span style={{ pointerEvents: 'none' }}>Auto Group</span>
          </button>
          <button
            onClick={refreshTabs}
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: '#60A5FA',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 500,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
            }}
          >
            <FontAwesomeIcon icon={faSync} style={{ pointerEvents: 'none' }} />
            <span style={{ pointerEvents: 'none' }}>Refresh</span>
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div style={{
          flex: 1,
          position: 'relative',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '10px',
          padding: '2px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <FontAwesomeIcon icon={faSearch} style={{ color: 'var(--text-secondary)', fontSize: '12px' }} />
          <input
            type="text"
            placeholder="Search tabs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '13px',
              padding: '6px 0',
              width: '100%',
              outline: 'none'
            }}
          />
          {searchQuery && (
            <FontAwesomeIcon
              icon={faTimes}
              onClick={() => setSearchQuery('')}
              style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '12px' }}
            />
          )}
        </div>
        <button
          onClick={() => {
            const newState = !isFocusMode;
            setIsFocusMode(newState);
            chrome.storage.local.set({ isFocusMode: newState });
          }}
          style={{
            background: isFocusMode ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            border: isFocusMode ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '10px',
            padding: '8px 12px',
            color: isFocusMode ? '#60A5FA' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s'
          }}
          title={isFocusMode ? "Exit Focus Mode" : "Focus Mode - Show only relevant tabs"}
        >
          <FontAwesomeIcon icon={faFilter} />
          <span>Focus</span>
        </button>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {tabsLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '40px 20px',
            color: 'var(--text-secondary, #64748B)',
            textAlign: 'center',
            height: '100%'
          }}>
            <FontAwesomeIcon icon={faSync} spin size="2x" style={{ opacity: 0.5 }} />
            <div style={{ fontSize: 'var(--font-sm, 12px)' }}>Loading tabs...</div>
          </div>
        ) : (
          <>
            {/* Recent Activity Section */}
            {!searchQuery && recentTabs.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-sm, 12px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <FontAwesomeIcon icon={faClock} style={{ opacity: 0.6 }} />
                  Recent Activity
                </h3>
                <div className="tabs-grid">
                  {recentTabs.map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={tab.pinned}
                      isActive={tab.active}
                      isLastActive={tab.id === lastActiveTabId}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Pinned Tabs Section */}
            {tabs.filter(tab => tab.pinned).length > 0 && !searchQuery && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-sm, 12px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Pinned ({tabs.filter(tab => tab.pinned).length})
                </h3>
                <div className="tabs-grid">
                  {tabs.filter(tab => tab.pinned).map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={true}
                      isActive={tab.active}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Grouped by Domain Section */}
            {Object.keys(tabsByDomain()).length > 1 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-sm, 12px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Grouped by Domain
                </h3>
                <div className="tabs-grid">
                  {Object.entries(tabsByDomain())
                    .filter(([_, domainTabs]) => domainTabs.length > 1)
                    .map(([domain, domainTabs]) => (
                      <TabGroupCard
                        key={domain}
                        domain={domain}
                        tabs={domainTabs}
                        onClick={() => setExpandedDomain(expandedDomain === domain ? null : domain)}
                        isExpanded={expandedDomain === domain}
                      />
                    ))}
                </div>
              </div>
            )}



            {/* All Tabs Section */}
            <div>
              <h3 style={{
                fontSize: 'var(--font-sm, 12px)',
                fontWeight: 600,
                color: 'var(--text-secondary, #94A3B8)',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {searchQuery ? `Search Results (${filteredTabs.length})` : `All Tabs (${filteredTabs.length})`}
              </h3>
              {filteredTabs.length > 0 ? (
                <>
                  <div className="tabs-grid">
                    {filteredTabs.slice(0, visibleTabsCount).map(tab => (
                      <TabCard
                        key={tab.id}
                        tab={tab}
                        onClick={handleTabClick}
                        onClose={handleTabClose}
                        onPin={handleTabPin}
                        isPinned={tab.pinned}
                        isActive={tab.active}
                        isLastActive={tab.id === lastActiveTabId}
                      />
                    ))}
                  </div>

                  {/* Load More Button */}
                  {tabs.length > visibleTabsCount && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                      <button
                        onClick={() => setVisibleTabsCount(prev => prev + 12)}
                        style={{
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#60A5FA',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          padding: '8px 24px',
                          borderRadius: '20px',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                          e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                          e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.2)';
                        }}
                      >
                        Show More ({tabs.length - visibleTabsCount} remaining)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  padding: '40px 20px',
                  color: 'var(--text-secondary, #64748B)',
                  textAlign: 'center',
                  background: 'var(--glass-bg, rgba(30, 41, 59, 0.95))',
                  borderRadius: '12px',
                  border: '1px solid rgba(59, 130, 246, 0.2)'
                }}>
                  <div style={{ fontSize: '48px', opacity: 0.3 }}>📑</div>
                  <div>
                    <div style={{
                      fontSize: 'var(--font-lg, 14px)',
                      fontWeight: 500,
                      marginBottom: '8px'
                    }}>
                      No Tabs Found
                    </div>
                    <div style={{ fontSize: 'var(--font-sm, 12px)' }}>
                      Open some browser tabs to see them here
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div >
  );
}
