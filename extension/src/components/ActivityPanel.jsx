import React from 'react';
import { getFaviconUrl } from '../utils';
// No favicon or extra UI; render URLs only

export default function ActivityPanel() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [sortBy, setSortBy] = React.useState('time'); // 'time' | 'clicks' | 'scroll' | 'forms'

  React.useEffect(() => {
    let mounted = true;
    const sendMessage = (msg, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for background response'));
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          clearTimeout(timer);
          // Handle MV3 lastError (service worker inactive, etc.)
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            return reject(new Error(`Service worker not reachable: ${lastErr.message || 'unknown error'}`));
          }
          resolve(res);
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
    (async () => {
      try {
        setLoading(true);
        const resp = await sendMessage({ action: 'getActivityData' }, 6000);
        if (!mounted) return;
        if (resp && resp.ok) {
          const arr = Array.isArray(resp.rows) ? resp.rows : [];
          // Normalize defaults and sort by time desc
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
        if (mounted) {
          console.warn('getActivityData failed:', e);
          setError(String(e && e.message ? e.message : e));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const fmt = (ms) => {
    const m = Math.round(ms / 60000);
    if (m <= 0) return '0m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  };

  // Weighted ranking algorithm to produce suggestions from activity
  const WEIGHTS = React.useMemo(() => ({ time: 0.5, clicks: 0.25, forms: 0.2, scroll: 0.05 }), []);
  const NORMALIZERS = React.useMemo(() => ({
    timeMs: 20 * 60 * 1000, // 20 minutes caps at 1.0
    clicks: 20,             // 20 clicks caps at 1.0
    forms: 5,               // 5 form interactions caps at 1.0
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

  // Current open tabs
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const refreshTabs = React.useCallback(() => {
    setTabsError(null);
    try {
      chrome.tabs.query({}, (list) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          setTabsError(lastErr.message || 'Unable to query tabs');
          setTabs([]);
          return;
        }
        setTabs(Array.isArray(list) ? list : []);
      });
    } catch (e) {
      setTabsError(String(e));
      setTabs([]);
    }
  }, []);

  React.useEffect(() => {
    refreshTabs();
  }, [refreshTabs]);

  const focusTab = React.useCallback((tab) => {
    if (!tab || !tab.id) return;
    try {
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (e) {
      console.warn('Failed to focus tab', e);
    }
  }, []);

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
      if (match) return focusTab(match);
      chrome.tabs.create({ url });
    } catch (e) {
      console.warn('Failed to open/focus url', url, e);
    }
  }, [tabs, focusTab]);

  const { suggestions, fallbackUsed } = React.useMemo(() => {
    const enriched = rows.map(r => {
      const score = scoreRow(r);
      return { ...r, score, category: categorize(score) };
    });
    // Allow switching primary sorting metric if desired
    if (sortBy === 'time') enriched.sort((a, b) => b.score - a.score);
    else if (sortBy === 'clicks') enriched.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
    else if (sortBy === 'scroll') enriched.sort((a, b) => (b.scroll || 0) - (a.scroll || 0));
    else if (sortBy === 'forms') enriched.sort((a, b) => (b.forms || 0) - (a.forms || 0));

    const filtered = enriched.filter(x => x.category !== 'low');
    if (filtered.length > 0) return { suggestions: filtered.slice(0, 50), fallbackUsed: false };
    // Fallback: show top by time even if categorized as low
    const topByTime = [...rows]
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 50)
      .map(r => ({ ...r, score: scoreRow(r), category: categorize(scoreRow(r)) }));
    return { suggestions: topByTime, fallbackUsed: true };
  }, [rows, scoreRow, sortBy]);

  // Early returns must come after all hooks to satisfy Rules of Hooks
  if (loading) return <div className="empty">Loading activity…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!rows.length) return <div className="empty">No activity recorded yet</div>;

  return (
    <section style={{ marginTop: 12 }}>
      {/* Current Tabs Section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Current Tabs <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({tabs.length})</span></h3>
        <button onClick={refreshTabs} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}>Refresh</button>
      </div>
      {tabsError ? (
        <div className="error" style={{ marginBottom: 12 }}>{String(tabsError)}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {tabs.map(tab => (
            <div key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
              {(() => {
                const primary = tab.favIconUrl || getFaviconUrl(tab.url, 16);
                let originIco = '';
                try { const u = new URL(tab.url || ''); originIco = `${u.origin}/favicon.ico`; } catch { }
                const src = primary || originIco || '';
                return src ? (
                  <img
                    src={src}
                    alt=""
                    width={16}
                    height={16}
                    style={{ borderRadius: 3 }}
                    onError={(e) => {
                      if (originIco && e.currentTarget.src !== originIco) { e.currentTarget.src = originIco; return; }
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : <div style={{ width: 16, height: 16 }} />;
              })()}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title || tab.url}</div>
                <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.url}</div>
              </div>
              <button onClick={() => focusTab(tab)} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}>Go</button>
            </div>
          ))}
          {!tabs.length && !tabsError && (
            <div className="empty">No tabs found</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Activity Feed <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({rows.length}{fallbackUsed ? ', showing all' : ''})</span></h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Sort by</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '4px 8px', borderRadius: 8, border: '1px solid #273043',
              background: '#1b2331', color: '#e5e7eb', fontSize: 12,
            }}
          >
            <option value="time">Time</option>
            <option value="clicks">Clicks</option>
            <option value="scroll">Scroll</option>
            <option value="forms">Forms</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {suggestions.map((r) => {
          let host = r.url;
          let originIco = '';
          try { const u = new URL(r.url); host = u.hostname; originIco = `${u.origin}/favicon.ico`; } catch { }
          const firstSrc = getFaviconUrl(r.url, 16) || originIco || '';
          return (
            <div key={r.url} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
              {firstSrc ? (
                <img
                  src={firstSrc}
                  alt=""
                  width={16}
                  height={16}
                  style={{ borderRadius: 3 }}
                  onError={(e) => {
                    if (originIco && e.currentTarget.src !== originIco) { e.currentTarget.src = originIco; return; }
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : <div style={{ width: 16, height: 16 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{host}</div>
                <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.url}</div>
              </div>
              <button onClick={() => openOrFocusUrl(r.url)} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}>Open</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
