import { faEyeSlash, faGlobe, faHistory, faStar } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { createPortal } from 'react-dom';
import { getUIState, saveUIState } from '../../db/unified-api.js';
import { getActivityData } from '../../services/activityService';
import { enqueueOpenInChrome, getHostActivity, getHostDashboard } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function CoolFeedSection({ tabs, pings, maxItems = 10 }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [sortBy, setSortBy] = React.useState('all'); // 'all' | 'time' | 'clicks' | 'scroll' | 'forms'
  const [maxFeed, setMaxFeed] = React.useState(maxItems);
  const [hiddenUrls, setHiddenUrls] = React.useState(() => new Set());
  const uiStateRef = React.useRef(null);
  const [ctxMenu, setCtxMenu] = React.useState({ show: false, x: 0, y: 0, url: null });

  const loadActivity = React.useCallback(async () => {
    let mounted = true;
    const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
    try {
      setLoading(true);
      setError('');
      if (!hasRuntime) {
        // Electron host mode: fetch true activity from host first
        const act = await getHostActivity(0);
        if (!mounted) return;
        if (act?.ok && Array.isArray(act.rows) && act.rows.length) {
          const norm = act.rows
            .filter(r => {
              const url = r.url || '';
              // Filter out edge system tabs
              return !url.startsWith('edge://newtab') && !url.startsWith('edge://extensions');
            })
            .map(r => ({
              url: r.url,
              time: Number(r.time) || 0,
              scroll: Number(r.scroll) || 0,
              clicks: Number(r.clicks) || 0,
              forms: Number(r.forms) || 0,
            })).sort((a, b) => b.time - a.time);
          setRows(norm);
          setError('');
          return;
        }

        // Fallback: use mirrored dashboard history if available
        const host = await getHostDashboard();
        if (!mounted) return;
        if (host.ok && host.dashboard && Array.isArray(host.dashboard.history)) {
          const norm = host.dashboard.history
            .filter(h => {
              const url = h.url || '';
              // Filter out edge system tabs
              return !url.startsWith('edge://newtab') && !url.startsWith('edge://extensions');
            })
            .map(h => ({
              url: h.url,
              // Approximate time using visitCount to drive ranking visuals
              time: Number(h.visitCount || 0) * 60000,
              scroll: 0,
              clicks: 0,
              forms: 0,
            })).sort((a, b) => b.time - a.time);
          setRows(norm);
          setError('');
        } else {
          // Keep UI clean in Electron mode
          setRows([]);
          setError('');
        }
        return;
      }

      // Chrome extension mode: use new activityService for direct data access
      console.log('[CoolFeed Debug] Using activityService for data access');
      const activityRows = await getActivityData();
      if (!mounted) return;

      const norm = activityRows
        .filter(r => {
          const url = r.url || '';
          // Filter out edge system tabs
          return !url.startsWith('edge://newtab') && !url.startsWith('edge://extensions');
        })
        .map(r => ({
          url: r.url,
          time: Number(r.time) || 0,
          scroll: Number(r.scroll) || 0,
          clicks: Number(r.clicks) || 0,
          forms: Number(r.forms) || 0,
        })).sort((a, b) => b.time - a.time);

      console.log('[CoolFeed Debug] Setting rows with', norm.length, 'items:', norm.slice(0, 3));
      setRows(norm);
      setError('');
    } catch (e) {
      console.warn('getActivityData failed:', e);
      // Suppress noisy error in Electron; show real errors only in extension context
      setError(hasRuntime ? (String(e && e.message ? e.message : e)) : '');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    (async () => { if (!disposed) await loadActivity(); })();
    const id = setInterval(() => { if (!disposed) loadActivity(); }, 30000);
    return () => { disposed = true; clearInterval(id); };
  }, [loadActivity]);

  // Load hidden URLs from unified DB UI_STATE
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ui = await getUIState();
        if (cancelled) return;
        uiStateRef.current = ui || { id: 'default' };
        const arr = Array.isArray(ui?.hiddenActivityUrls) ? ui.hiddenActivityUrls : [];
        setHiddenUrls(new Set(arr));
      } catch (e) {
        console.warn('[CoolFeed] Failed to load hiddenActivityUrls', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hideUrl = React.useCallback(async (url) => {
    if (!url) return;
    setHiddenUrls((prev) => {
      const next = new Set(prev);
      next.add(url);
      const base = uiStateRef.current || { id: 'default' };
      uiStateRef.current = { ...base, hiddenActivityUrls: Array.from(next) };
      saveUIState(uiStateRef.current).catch((e) => console.warn('[CoolFeed] saveUIState failed', e));
      return next;
    });
    setCtxMenu({ show: false, x: 0, y: 0, url: null });
  }, []);

  // Close context menu on outside click / escape
  React.useEffect(() => {
    if (!ctxMenu.show) return;
    const onDown = () => setCtxMenu((c) => ({ ...c, show: false }));
    const onKey = (e) => { if (e.key === 'Escape') setCtxMenu((c) => ({ ...c, show: false })); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [ctxMenu.show]);

  // Enhanced weighted ranking algorithm for comprehensive activity scoring
  const WEIGHTS = React.useMemo(() => ({
    time: 0.4,    // Time spent is most important indicator
    clicks: 0.3,   // Click interactions show engagement
    forms: 0.25,   // Form submissions indicate task completion
    scroll: 0.05   // Scroll depth shows content consumption
  }), []);
  const NORMALIZERS = React.useMemo(() => ({
    timeMs: 30 * 60 * 1000, // 30 minutes caps at 1.0 (increased for better distribution)
    clicks: 25,             // 25 clicks caps at 1.0 (increased threshold)
    forms: 3,               // 3 form interactions caps at 1.0 (lowered - forms are rare but valuable)
    scrollPct: 100,         // 100% scroll caps at 1.0
  }), []);

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const scoreRow = React.useCallback((r) => {
    const t = clamp01((r.time || 0) / NORMALIZERS.timeMs);
    const c = clamp01((r.clicks || 0) / NORMALIZERS.clicks);
    const f = clamp01((r.forms || 0) / NORMALIZERS.forms);
    const s = clamp01((r.scroll || 0) / NORMALIZERS.scrollPct);
    return (WEIGHTS.time * t) + (WEIGHTS.clicks * c) + (WEIGHTS.forms * f) + (WEIGHTS.scroll * s);
  }, [WEIGHTS, NORMALIZERS]);

  const categorize = (score) => {
    if (score >= 0.7) return 'strong';
    if (score >= 0.4) return 'medium';
    return 'low';
  };

  const openOrFocusUrl = React.useCallback((url) => {
    if (!url) return;
    try {
      let match = null;
      try {
        const target = new URL(url).href;
        match = tabs.find(t => {
          try { return t.url && new URL(t.url).href === target; } catch { return false; }
        }) || null;
      } catch { }
      const hasTabsApi = typeof chrome !== 'undefined' && chrome?.tabs?.create;
      if (match && (typeof chrome !== 'undefined' && chrome?.tabs?.update)) {
        chrome.tabs.update(match.id, { active: true });
        if (match.windowId != null && chrome?.windows?.update) {
          chrome.windows.update(match.windowId, { focused: true });
        }
        return;
      }
      if (hasTabsApi) {
        if (chrome?.tabs?.update) {
          chrome.tabs.update({ url });
        } else if (chrome?.tabs?.create) {
          chrome.tabs.create({ url });
        }
      } else {
        // Electron: use extension bridge only to avoid duplicate opens
        enqueueOpenInChrome(url).catch(() => { });
      }
    } catch (e) {
      console.warn('Failed to open/focus url', url, e);
    }
  }, [tabs]);

  // New intelligent feed processing
  const processedFeed = React.useMemo(() => {
    const now = Date.now();

    // Helper: Extract Hostname
    const getHost = (u) => { try { return new URL(u).hostname.replace('www.', ''); } catch { return u; } };
    const toHref = (u) => { try { return new URL(u).href; } catch { return null; } };

    // Helper: Find Title from tabs
    const findTitle = (url) => {
      const tabMatch = tabs?.find(t => t.url === url);
      return tabMatch?.title || getHost(url);
    };

    // Scoring with recency and context
    const scored = rows
      .filter(r => !hiddenUrls.has(toHref(r.url) || r.url))
      .map(r => {
        // Base engagement score
        const engagementScore = (r.time / 3600000) * 0.4 + (r.clicks / 20) * 0.3 + (r.forms / 2) * 0.3;

        // Recency decay (assuming we have lastVisit or using current time)
        const lastVisit = r.lastVisit || now - (r.time || 0); // Fallback estimation
        const hoursSince = Math.max(0, (now - lastVisit) / 3600000);
        const recencyFactor = 1 / (1 + (hoursSince * 0.1));

        // Context boost for habitual sites visited around same time daily
        const isHabitual = engagementScore > 0.5;
        const timeContextBonus = isHabitual && (hoursSince < 24 && hoursSince > 20) ? 0.3 : 0;

        const totalScore = (engagementScore * 0.6) + (recencyFactor * 0.4) + timeContextBonus;

        return {
          ...r,
          host: getHost(r.url),
          displayTitle: findTitle(r.url),
          totalScore,
          isRecent: hoursSince < 12,  // Visited in last 12 hours
          isActive: tabs?.some(t => t.url === r.url) // Currently open
        };
      });

    // Grouping & Deduplication
    const seenHosts = new Set();
    const feed = {
      jumpBackIn: [],  // Recent & Active
      dailyTop: [],    // High score, general
    };

    // Sort by score
    scored.sort((a, b) => b.totalScore - a.totalScore);

    scored.forEach(item => {
      // Skip duplicate hosts unless very high score
      if (seenHosts.has(item.host)) {
        if (item.totalScore < 0.8) return;
      }
      seenHosts.add(item.host);

      // Categorize
      if (item.isActive || (item.isRecent && item.totalScore > 0.1)) {
        feed.jumpBackIn.push(item);
      } else if (item.totalScore > 0.4) {
        feed.dailyTop.push(item);
      }
    });

    return {
      jumpBackIn: feed.jumpBackIn.slice(0, 4),
      dailyTop: feed.dailyTop.slice(0, 8),
      all: scored.slice(0, maxItems)
    };
  }, [rows, tabs, hiddenUrls, maxItems]);

  // Activity Card Component
  const ActivityCard = ({ item, badge, badgeColor }) => {
    const favicon = getFaviconUrl(item.url, 64);

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          openOrFocusUrl(item.url);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const href = (() => { try { return new URL(item.url).href; } catch { return item.url; } })();
          setCtxMenu({ show: true, x: e.clientX, y: e.clientY, url: href });
        }}
        title={`${item.displayTitle || item.host}\\n${item.url}`}
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          position: 'relative',
          overflow: 'hidden',
          minWidth: '200px',
          flex: '1 1 200px',
          maxWidth: '300px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {/* Icon */}
        <div style={{
          minWidth: '32px', height: '32px', borderRadius: '8px',
          background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {favicon ? (
            <img src={favicon} alt="" style={{ width: '20px', height: '20px' }} onError={(e) => e.target.style.display = 'none'} />
          ) : (
            <FontAwesomeIcon icon={faGlobe} size="sm" color="rgba(255,255,255,0.3)" />
          )}
        </div>

        {/* Text Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <span style={{
            fontSize: '13px', color: '#fff', fontWeight: '500',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {item.displayTitle || item.host}
          </span>
          <span style={{
            fontSize: '11px', color: 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {item.host}
          </span>
        </div>

        {/* Badge Indicator */}
        {badge && (
          <div style={{
            fontSize: '10px', fontWeight: 'bold', color: badgeColor,
            background: `${badgeColor}20`, padding: '2px 6px', borderRadius: '4px'
          }}>
            {badge}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-onboarding="activity-section"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
      }}>

      {
        loading ? (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            Loading activity…
          </div>
        ) : error ? (
          <div style={{
            textAlign: 'center',
            color: '#FF3B30',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 400,
            padding: '40px 20px',
            background: 'rgba(255, 59, 48, 0.1)',
            borderRadius: 12,
            border: '1px solid rgba(255, 59, 48, 0.2)'
          }}>
            {error}
          </div>
        ) : !rows.length ? (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            No activity recorded yet
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '8px',
            paddingBottom: '16px',
            flexWrap: 'wrap'
          }}>
            {processedFeed.all.map((r) => {
              let host = r.url;
              let originIco = '';
              try {
                const u = new URL(r.url);
                host = u.hostname;
                if (u.protocol === 'http:' || u.protocol === 'https:') {
                  originIco = `${u.origin}/favicon.ico`;
                }
              } catch { }
              const firstSrc = getFaviconUrl(r.url, 64) || originIco || '';

              // Create activity indicator based on score
              const getActivityColor = (category) => {
                switch (category) {
                  case 'strong': return '#34C759'; // Green for high activity
                  case 'medium': return '#FF9500'; // Orange for medium activity
                  case 'low': return '#8E8E93';    // Gray for low activity
                  default: return '#8E8E93';
                }
              };

              const activityColor = getActivityColor(r.category);
              const activityLevel = r.category === 'strong' ? 'High' : r.category === 'medium' ? 'Med' : 'Low';

              return (
                <div
                  key={r.url}
                  onClick={(e) => {
                    e.stopPropagation();
                    openOrFocusUrl(r.url);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const href = (() => { try { return new URL(r.url).href; } catch { return r.url; } })();
                    setCtxMenu({ show: true, x: e.clientX, y: e.clientY, url: href });
                  }}
                  title={`${host}\n${r.url}\nActivity: ${activityLevel} | Time: ${Math.round((r.time || 0) / 1000)}s | Clicks: ${r.clicks || 0}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px',
                    cursor: 'pointer',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '10px',
                    border: `1px solid rgba(255, 255, 255, 0.05)`,
                    transition: 'all 0.2s ease',
                    width: '48px',
                    height: '48px',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `rgba(52, 199, 89, 0.08)`;
                    e.currentTarget.style.border = `1px solid rgba(52, 199, 89, 0.3)`;
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                    e.currentTarget.style.border = `1px solid rgba(255, 255, 255, 0.05)`;
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  {firstSrc ? (
                    <img
                      src={firstSrc}
                      alt={host}
                      style={{
                        width: '28px',
                        height: '28px',
                        objectFit: 'contain',
                        borderRadius: '6px'
                      }}
                      onError={(e) => {
                        if (originIco && e.target.src !== originIco) {
                          e.target.src = originIco;
                          return;
                        }
                        // If all favicon attempts fail, show globe icon
                        const fallback = document.createElement('div');
                        fallback.style.cssText = `
                          width: 28px;
                          height: 28px;
                          border-radius: 6px;
                          background: rgba(52, 199, 89, 0.2);
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          font-size: 16px;
                          color: #34C759;
                        `;
                        fallback.innerHTML = '🌐';
                        e.target.parentNode.replaceChild(fallback, e.target);
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: 'rgba(52, 199, 89, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      color: '#34C759'
                    }}>
                      <FontAwesomeIcon icon={faGlobe} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      }
      {ctxMenu.show && createPortal(
        <div
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 60),
            left: Math.min(ctxMenu.x, window.innerWidth - 220),
            width: 200,
            background: 'var(--glass-bg, rgba(20,20,30,0.95))',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 999999,
            overflow: 'hidden'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => hideUrl(ctxMenu.url)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary, #fff)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg, rgba(255,255,255,0.08))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            title="Hide this URL from Activity"
          >
            <FontAwesomeIcon icon={faEyeSlash} style={{ color: '#FF3B30' }} />
            <span>Hide this URL</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}