import { faSync, faToggleOff, faToggleOn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useState } from 'react';
import { TabCard, TabGroupCard } from './TabCard';

export function TabManagement() {
  const [tabs, setTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [expandedDomain, setExpandedDomain] = useState(null);
  const [autoGroupEnabled, setAutoGroupEnabled] = useState(false);

  // Load auto-group state on mount
  useEffect(() => {
    chrome.storage.local.get(['autoGroupEnabled'], (result) => {
      setAutoGroupEnabled(result.autoGroupEnabled || false);
    });
  }, []);

  // Fetch browser tabs
  const refreshTabs = useCallback(async () => {
    // Only set loading on initial empty state to avoid flickering
    if (tabs.length === 0) setTabsLoading(true);

    try {
      if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
        const allTabs = await chrome.tabs.query({});

        // Sort: Active tabs first, then by windowId + index
        const sortedTabs = (allTabs || []).sort((a, b) => {
          if (a.active && !b.active) return -1;
          if (!a.active && b.active) return 1;
          if (a.windowId !== b.windowId) return a.windowId - b.windowId;
          return a.index - b.index;
        });

        setTabs(sortedTabs);
      }
    } catch (error) {
      console.error('[TabManagement] Failed to fetch tabs:', error);
    } finally {
      setTabsLoading(false);
    }
  }, []);

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

    const handleEvent = () => refreshTabs();

    events.forEach(event => {
      if (event?.addListener) {
        event.addListener(handleEvent);
      }
    });

    return () => {
      events.forEach(event => {
        if (event?.removeListener) {
          event.removeListener(handleEvent);
        }
      });
    };
  }, [refreshTabs]);

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
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
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
            {/* Pinned Tabs Section */}
            {tabs.filter(tab => tab.pinned).length > 0 && (
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
                All Tabs ({tabs.length})
              </h3>
              {tabs.length > 0 ? (
                <div className="tabs-grid">
                  {tabs.map(tab => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      onClick={handleTabClick}
                      onClose={handleTabClose}
                      onPin={handleTabPin}
                      isPinned={tab.pinned}
                      isActive={tab.active}
                    />
                  ))}
                </div>
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
    </div>
  );
}
