import { faArrowUpRightFromSquare, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { enqueueOpenInChrome, getHostActivity, getHostDashboard } from '../services/extensionApi';
import { getFaviconUrl } from '../utils';

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
          const norm = act.rows.map(r => ({
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
          const norm = host.dashboard.history.map(h => ({
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
      const resp = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for background response')), 6000);
        try {
          chrome.runtime.sendMessage({ action: 'getActivityData' }, (res) => {
            clearTimeout(timer);
            const lastErr = chrome.runtime?.lastError;
            if (lastErr) return reject(new Error(lastErr.message || 'Service worker unavailable'));
            resolve(res);
          });
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
      if (!mounted) return;
      if (resp && resp.ok) {
        const arr = Array.isArray(resp.rows) ? resp.rows : [];
        const norm = arr.map(r => ({
          url: r.url,
          time: Number(r.time) || 0,
          scroll: Number(r.scroll) || 0,
          clicks: Number(r.clicks) || 0,
          forms: Number(r.forms) || 0,
        })).sort((a, b) => b.time - a.time);
        setRows(norm);
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
        chrome.tabs.create({ url });
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
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ marginBottom: '10px' }}>
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginRight: 6 }} />
          Cool Feed <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({rows.length}{fallbackUsed ? ', showing all' : ''})</span>
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={loadActivity}
            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}
            className="icon-btn"
            aria-label="Reload activity"
            title="Reload activity"
          >
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Max</label>
          <select
            value={maxFeed}
            onChange={(e) => setMaxFeed(parseInt(e.target.value, 10))}
            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}
          >
            <option value={12}>12</option>
            <option value={15}>15</option>
            <option value={18}>18</option>
            <option value={21}>21</option>
            <option value={24}>24</option>
          </select>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Sort by</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}
          >
            <option value="all">All</option>
            <option value="time">Time</option>
            <option value="clicks">Clicks</option>
            <option value="scroll">Scroll</option>
            <option value="forms">Forms</option>
          </select>
        </div>
      </div>
      {
        loading ? (
          <div className="empty">Loading activity…</div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : !rows.length ? (
          <div className="empty">No activity recorded yet</div>
        ) : (
          <div className="activity-grid">
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
              return (
                <div key={r.url} className="activity-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
                  {firstSrc ? (
                    <img
                      src={firstSrc}
                      className="favicon"
                      alt=""
                      width={16}
                      height={16}
                      style={{ borderRadius: 3 }}
                      onError={(e) => {
                        if (originIco && e.currentTarget.src !== originIco) { e.currentTarget.src = originIco; return; }
                        if (e.currentTarget.src.indexOf('/default-favicon.svg') === -1) { e.currentTarget.src = '/default-favicon.svg'; return; }
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : <div style={{ width: 16, height: 16 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{host}</div>
                  </div>
                  <button onClick={() => openOrFocusUrl(r.url)} className="go-btn" style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}>
                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginRight: 6 }} />
                  </button>
                </div>
              );
            })}
          </div>
        )
      }
    </>
  );
}
