import { faBrain, faClock, faSync, faToggleOff, faToggleOn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { getBaseDomainFromUrl } from '../../utils/helpers.js';
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
  const [tabActivity, setTabActivity] = useState({});
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isPending, startTransition] = useTransition();

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

    if (isFocusMode) {
      // Focus mode: show pinned, active, and top 20% scored tabs
      // For now, let's just show top 15 tabs if focus mode is on
      result = result.slice(0, 15);
    }

    return result;
  }, [tabs, isFocusMode]);

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

  // Partition tabs into exclusive buckets to avoid duplication
  const partitionedTabs = useMemo(() => {
    // 1. Pinned Tabs (Priority 1)
    const pinned = filteredTabs.filter(t => t.pinned);
    const pinnedIds = new Set(pinned.map(t => t.id));

    // 2. Unpinned Tabs
    const unpinned = filteredTabs.filter(t => !pinnedIds.has(t.id));

    // 3. Grouped Tabs (Priority 2: >1 tab per domain)
    const groups = {};
    const singles = [];

    // First pass: organize unpinned by base domain
    const byDomain = {};
    unpinned.forEach(t => {
      const domain = getBaseDomainFromUrl(t.url);
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(t);
    });

    // Identify valid groups vs singles
    Object.entries(byDomain).forEach(([domain, domainTabs]) => {
      // Group if either:
      // 1. Auto-group is enabled and we have multiple tabs
      // 2. We have a lot of tabs (force group > 3 even if auto-group is off, for sanity?)
      // Actually, let's stick to autoGroupEnabled preference.
      if (autoGroupEnabled && domainTabs.length > 1) {
        groups[domain] = domainTabs;
      } else {
        singles.push(...domainTabs);
      }
    });

    // 4. Recent Unique (Priority 3: Top singles by activity)
    // Sort singles by activity if available
    const sortedSingles = [...singles].sort((a, b) => {
      const scoreA = tabActivity[a.id] || 0;
      const scoreB = tabActivity[b.id] || 0;
      return scoreB - scoreA;
    });

    // Take top 8 as "Recent" (active or high score)
    // Or strictly checks activity existence?
    // Let's take top 8 regardless, as "Recent/Singles"
    const recent = sortedSingles.slice(0, 8);

    // 5. Others (Priority 4: The rest)
    const others = sortedSingles.slice(8);

    return {
      pinned,
      grouped: groups,
      recent,
      others,
      hasGroups: Object.keys(groups).length > 0
    };
  }, [filteredTabs, tabActivity]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      borderRadius: 16,
      overflow: 'hidden',
      border: '1px solid transparent'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {/* <h3 style={{
          fontSize: 'var(--font-2xl, 16px)',
          fontWeight: 600,
          color: 'var(--text-primary, #F1F5F9)',
          margin: 0
        }}>
          Browser Tabs
          {tabs.length > 0 && <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '8px', fontWeight: 400 }}>({tabs.length})</span>}
        </h3> */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={async () => {
              const newState = !isFocusMode;
              setIsFocusMode(newState);
              // Ensure smart sort is enabled when focus is on
              if (newState) {
                setSmartSortEnabled(true);
                chrome.storage.local.set({ isFocusMode: newState, smartSortEnabled: true });
              } else {
                chrome.storage.local.set({ isFocusMode: newState });
              }
            }}
            style={{
              background: isFocusMode
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.15))'
                : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
              border: isFocusMode
                ? '1px solid rgba(139, 92, 246, 0.4)'
                : '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: isFocusMode ? '#A78BFA' : '#94A3B8',
              cursor: 'pointer',
              fontSize: 'var(--font-sm, 12px)',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              if (isFocusMode) {
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
              if (isFocusMode) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                e.currentTarget.style.transform = 'translateY(0)';
              } else {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
                e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            title={isFocusMode
              ? "Focus enabled - Showing most relevant tabs"
              : "Focus disabled - Showing all tabs"}
          >
            <FontAwesomeIcon
              icon={faBrain}
              size="lg"
              style={{ pointerEvents: 'none' }}
            />
            <span style={{ pointerEvents: 'none' }}>Focus</span>
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
        </div>
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
            {/* 1. Pinned Tabs Section */}
            {partitionedTabs.pinned.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Pinned ({partitionedTabs.pinned.length})
                </h3>
                <div className="tabs-grid">
                  {partitionedTabs.pinned.map(tab => (
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

            {/* 2. Grouped by Domain Section */}
            {partitionedTabs.hasGroups && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Grouped by Domain
                </h3>
                <div className="tabs-grid">
                  {Object.entries(partitionedTabs.grouped)
                    .map(([domain, domainTabs]) => (
                      <TabGroupCard
                        key={domain}
                        domain={domain}
                        tabs={domainTabs}
                        onToggleExpand={() => startTransition(() => setExpandedDomain(expandedDomain === domain ? null : domain))}
                        onTabClick={handleTabClick}
                        onTabClose={handleTabClose}
                        isExpanded={expandedDomain === domain}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* 3. Recent (Ungrouped) Section */}
            {partitionedTabs.recent.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
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
                  Recent
                </h3>
                <div className="tabs-grid">
                  {partitionedTabs.recent.map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={false}
                      isActive={tab.active}
                      isLastActive={tab.id === lastActiveTabId}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 4. Other Tabs Section */}
            {partitionedTabs.others.length > 0 && (
              <div>
                <h3 style={{
                  fontSize: 'var(--font-2xl, 20px)',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #94A3B8)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {`Others (${partitionedTabs.others.length})`}
                </h3>
                <div className="tabs-grid">
                  {/* Only show 'others' if not in focus mode, or just user preference? 
                        Focus mode already slices input `filteredTabs`, so `others` will likely be empty or small.
                        We can show what remains.
                    */}
                  {partitionedTabs.others.slice(0, visibleTabsCount).map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={false}
                      isActive={tab.active}
                      isLastActive={false}
                    />
                  ))}
                </div>
                {/* Load More Button for Others */}
                {partitionedTabs.others.length > visibleTabsCount && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                    <button
                      onClick={() => startTransition(() => setVisibleTabsCount(prev => prev + 12))}
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
                    >
                      Show More ({partitionedTabs.others.length - visibleTabsCount} remaining)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Empty State */}
            {filteredTabs.length === 0 && (
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

          </>
        )}
      </div>
    </div >
  );
}
