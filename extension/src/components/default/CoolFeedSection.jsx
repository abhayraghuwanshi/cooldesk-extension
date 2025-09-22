import { faGlobe, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { enqueueOpenInChrome, getHostActivity, getHostDashboard } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function CoolFeedSection({ tabs, pings }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [sortBy, setSortBy] = React.useState('all'); // 'all' | 'time' | 'clicks' | 'scroll' | 'forms'
  const [maxFeed, setMaxFeed] = React.useState(12);

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

      // Chrome extension mode: ask background for IndexedDB-backed activity
      console.log('[CoolFeed Debug] About to send getActivityData message');
      const resp = await new Promise((resolve) => {
        let resolved = false;

        // Set timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn('[CoolFeed] Request timeout after 5 seconds');
            resolve({ ok: false, error: 'Request timeout' });
          }
        }, 5000);

        chrome.runtime.sendMessage({ action: 'getActivityData' }, (response) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);

            if (chrome.runtime.lastError) {
              console.warn('[CoolFeed] Runtime error:', chrome.runtime.lastError.message);
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { ok: false, error: 'No response received' });
            }
          }
        });
      });
      console.log('[CoolFeed Debug] Received response:', resp);
      if (!mounted) return;
      if (resp && resp.ok) {
        const arr = Array.isArray(resp.rows) ? resp.rows : [];
        const norm = arr
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
      } else {
        setError((resp && resp.error) ? String(resp.error) : 'Failed to load activity data');
      }
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

  const { suggestions, fallbackUsed } = React.useMemo(() => {
    // Helpers
    const toHref = (u) => { try { return new URL(u).href; } catch { return null; } };
    const getHost = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

    // Build quick-lookup sets
    const openSet = new Set(
      (Array.isArray(tabs) ? tabs : [])
        .map(t => toHref(t?.url))
        .filter(Boolean)
    );
    const pingSet = new Set(
      (Array.isArray(pings) ? pings : [])
        .map(p => toHref(p?.url))
        .filter(Boolean)
    );

    // Base enrich with score
    const base = rows.map(r => {
      const score = scoreRow(r);
      return { ...r, score };
    });

    // Apply non-linear engagement smoothing and context-aware boosts
    const adjusted = base.map(r => {
      const href = toHref(r.url);
      const clicksNL = Math.sqrt(Math.max(0, r.clicks || 0));
      const scrollNL = Math.sqrt(Math.max(0, r.scroll || 0));
      const formsNL = Math.min(1, (r.forms || 0) / 2); // small but meaningful
      let bonus = 0;
      bonus += 0.06 * (clicksNL / Math.sqrt(WEIGHTS.clicks > 0 ? (NORMALIZERS.clicks) : 1));
      bonus += 0.03 * (scrollNL / Math.sqrt(WEIGHTS.scroll > 0 ? (NORMALIZERS.scrollPct) : 1));
      bonus += 0.08 * formsNL;
      if (href && pingSet.has(href)) bonus += 0.12; // elevate pinned
      if (href && openSet.has(href)) bonus -= 0.08; // slightly de-prioritize already-open exact URL
      const adjustedScore = Math.max(0, Math.min(1.5, r.score + bonus));
      return { ...r, adjustedScore };
    });

    // Sort according to UI selection
    if (sortBy === 'all') {
      adjusted.sort((a, b) => (b.adjustedScore || 0) - (a.adjustedScore || 0));
    } else if (sortBy === 'time') {
      adjusted.sort((a, b) => (b.time || 0) - (a.time || 0));
    } else if (sortBy === 'clicks') {
      adjusted.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
    } else if (sortBy === 'scroll') {
      adjusted.sort((a, b) => (b.scroll || 0) - (a.scroll || 0));
    } else if (sortBy === 'forms') {
      adjusted.sort((a, b) => (b.forms || 0) - (a.forms || 0));
    }

    // Diversity & dedupe: cap per host and avoid exact URL duplicates
    const PER_HOST_CAP = 3;
    const hostCount = new Map();
    const seenHref = new Set();
    const pick = [];
    for (const r of adjusted) {
      const href = toHref(r.url);
      if (!href || seenHref.has(href)) continue;
      const host = getHost(href);
      const cnt = hostCount.get(host) || 0;
      if (cnt >= PER_HOST_CAP) continue;
      seenHref.add(href);
      hostCount.set(host, cnt + 1);
      pick.push(r);
      if (pick.length >= 50) break;
    }

    // If too few after filtering, fallback to time-based but still dedupe/diversify lightly
    if (pick.length > 0) {
      return {
        suggestions: pick.map(r => ({ ...r, score: r.adjustedScore, category: categorize((r.adjustedScore || 0)) })),
        fallbackUsed: false
      };
    }

    const fallbackSorted = [...rows].sort((a, b) => (b.time || 0) - (a.time || 0));
    const fbPick = [];
    seenHref.clear();
    hostCount.clear();
    for (const r of fallbackSorted) {
      const href = toHref(r.url);
      if (!href || seenHref.has(href)) continue;
      const host = getHost(href);
      const cnt = hostCount.get(host) || 0;
      if (cnt >= PER_HOST_CAP) continue;
      seenHref.add(href);
      hostCount.set(host, cnt + 1);
      const sc = scoreRow(r);
      fbPick.push({ ...r, score: sc, category: categorize(sc) });
      if (fbPick.length >= 50) break;
    }
    return { suggestions: fbPick, fallbackUsed: true };
  }, [rows, sortBy, tabs, pings, scoreRow]);

  // Limit the size of Cool Feed list via dropdown
  const displayedSuggestions = React.useMemo(
    () => suggestions.slice(0, Math.max(1, Number(maxFeed) || 12)),
    [suggestions, maxFeed]
  );

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
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {/* <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ color: '#34C759', fontSize: 'var(--font-size-xl)' }} /> */}
          Activity
        </h2>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={loadActivity}
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
            aria-label="Reload activity"
            title="Reload activity"
          >
            <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: 'var(--font-size-base)' }} />
          </button>

          {/* <select
            value={maxFeed}
            onChange={(e) => setMaxFeed(parseInt(e.target.value, 10))}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              fontSize: 'var(--font-size-sm)',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
            title="Max items"
          >
            <option value={12}>12</option>
            <option value={15}>15</option>
          </select> */}

          {/* <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              fontSize: 'var(--font-size-sm)',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
            title="Sort by"
          >
            <option value="all">All</option>
            <option value="time">Time</option>
            <option value="clicks">Clicks</option>
            <option value="scroll">Scroll</option>
            <option value="forms">Forms</option>
          </select> */}
        </div>
      </div>
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
            {displayedSuggestions.map((r) => {
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
                  title={`${host}\n${r.url}\nActivity: ${activityLevel} | Time: ${Math.round((r.time || 0) / 1000)}s | Clicks: ${r.clicks || 0}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px',
                    cursor: 'pointer',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '8px',
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
                        width: '24px',
                        height: '24px',
                        objectFit: 'contain',
                        borderRadius: '4px'
                      }}
                      onError={(e) => {
                        if (originIco && e.target.src !== originIco) {
                          e.target.src = originIco;
                          return;
                        }
                        // If all favicon attempts fail, show globe icon
                        const fallback = document.createElement('div');
                        fallback.style.cssText = `
                          width: 24px;
                          height: 24px;
                          border-radius: 4px;
                          background: rgba(52, 199, 89, 0.2);
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          font-size: 12px;
                          color: #34C759;
                        `;
                        fallback.innerHTML = '🌐';
                        e.target.parentNode.replaceChild(fallback, e.target);
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      background: 'rgba(52, 199, 89, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--font-size-sm)',
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
    </div>
  );
}
