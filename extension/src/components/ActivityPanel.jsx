import { faArrowUpRightFromSquare, faClone, faRotateRight, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import TabPreviewModal from './TabPreviewModal.jsx';
import { enqueueOpenInChrome, getHostActivity, getHostDashboard, getHostTabs } from '../services/extensionApi';
import { getFaviconUrl } from '../utils';
// No favicon or extra UI; render URLs only

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Render error in ActivityPanel section:', error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Section crashed</div>
          <div>{String(this.state.error?.message || this.state.error || 'Unknown error')}</div>
          {this.state.info?.componentStack && (
            <pre style={{ marginTop: 8, opacity: 0.8 }}>{this.state.info.componentStack}</pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ActivityPanel() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [sortBy, setSortBy] = React.useState('all'); // 'all' | 'time' | 'clicks' | 'scroll' | 'forms'

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

  const requestPreview = React.useCallback(async (tab) => {
    const url = tab?.url;
    if (!url) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewData({ title: 'Loading…' });
    try {
      const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
      if (!hasRuntime) {
        // Fallback: open directly in non-extension environments
        setPreviewLoading(false);
        setPreviewError('Preview not available in this environment');
        return;
      }
      const resp = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out')), 8000);
        try {
          chrome.runtime.sendMessage({ action: 'fetchPreview', url }, (res) => {
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
      let data = resp?.ok ? (resp.data || null) : null;
      let err = resp?.ok ? '' : (resp?.error || 'Failed to load preview');

      // If response is weak, try to collect from the active tab's DOM via content script
      const isWeak = (d) => {
        if (!d) return true;
        const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
        const t = (d.title || '').trim();
        const desc = (d.description || d.extract || '').trim();
        const onlyHostTitle = t === '' || t.toLowerCase() === host.toLowerCase();
        return onlyHostTitle && desc === '' && !(d.image && d.image.length > 0);
      };

      const canMessageTab = tab?.id != null && typeof chrome !== 'undefined' && chrome?.tabs?.sendMessage;
      if ((!data || isWeak(data)) && canMessageTab) {
        try {
          const domResp = await new Promise((resolve) => {
            const timer2 = setTimeout(() => resolve({ ok: false, error: 'Timed out' }), 4000);
            try {
              chrome.tabs.sendMessage(tab.id, { action: 'collectPreview' }, (r) => {
                clearTimeout(timer2);
                resolve(r);
              });
            } catch {
              clearTimeout(timer2);
              resolve({ ok: false });
            }
          });
          if (domResp && domResp.ok && domResp.data) {
            data = domResp.data;
            err = '';
          }
        } catch {}
      }

      // Last resort: programmatic DOM scrape via chrome.scripting (requires "scripting" permission)
      const canScript = tab?.id != null && typeof chrome !== 'undefined' && chrome?.scripting?.executeScript;
      if ((!data || isWeak(data)) && canScript) {
        try {
          const [inj] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                const getMeta = (name) => {
                  const el = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
                  return el ? el.getAttribute('content') || '' : '';
                };
                const absUrl = (u) => { try { return new URL(u, document.baseURI).toString(); } catch { return u || ''; } };
                const title = getMeta('og:title') || getMeta('twitter:title') || document.title || '';
                const description = getMeta('og:description') || getMeta('description') || getMeta('twitter:description') || '';
                const image = absUrl(getMeta('og:image') || getMeta('twitter:image'));
                let fallbackDesc = description;
                if (!fallbackDesc) {
                  const h1 = document.querySelector('h1');
                  const p = document.querySelector('main p, article p, p');
                  fallbackDesc = (h1?.textContent || '').trim();
                  const ptxt = (p?.textContent || '').trim();
                  if (ptxt && (!fallbackDesc || ptxt.length > fallbackDesc.length)) fallbackDesc = ptxt;
                }
                return {
                  source: location.hostname,
                  title,
                  description: description || fallbackDesc || '',
                  image: image || '',
                  url: location.href
                };
              } catch (e) {
                return { source: location.hostname, title: document.title || '', description: '', image: '', url: location.href };
              }
            }
          });
          if (inj && inj.result) {
            data = inj.result;
            err = '';
          }
        } catch {}
      }

      if (data) {
        setPreviewData(data);
        setPreviewError('');
      } else {
        setPreviewError(err || 'Failed to load preview');
      }
    } catch (e) {
      setPreviewError(String(e?.message || e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    (async () => { if (!disposed) await loadActivity(); })();
    const id = setInterval(() => { if (!disposed) loadActivity(); }, 30000);
    return () => { disposed = true; clearInterval(id); };
  }, [loadActivity]);

  const fmt = (ms) => {
    const m = Math.round(ms / 60000);
    if (m <= 0) return '0m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  };

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

  // Current open tabs
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [previewData, setPreviewData] = React.useState(null);
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
      if (match && (typeof chrome !== 'undefined' && chrome?.tabs?.update)) return focusTab(match);
      if (hasTabsApi) {
        chrome.tabs.create({ url });
      } else {
        // Electron: use extension bridge only to avoid duplicate opens
        enqueueOpenInChrome(url).catch(() => { });
      }
    } catch (e) {
      console.warn('Failed to open/focus url', url, e);
    }
  }, [tabs, focusTab]);

  const { suggestions, fallbackUsed } = React.useMemo(() => {
    const enriched = rows.map(r => {
      const score = scoreRow(r);
      return { ...r, score, category: categorize(score) };
    });
    // Sort by selected metric
    if (sortBy === 'all') {
      // Use weighted score combining all metrics
      enriched.sort((a, b) => b.score - a.score);
    } else if (sortBy === 'time') {
      enriched.sort((a, b) => (b.time || 0) - (a.time || 0));
    } else if (sortBy === 'clicks') {
      enriched.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
    } else if (sortBy === 'scroll') {
      enriched.sort((a, b) => (b.scroll || 0) - (a.scroll || 0));
    } else if (sortBy === 'forms') {
      enriched.sort((a, b) => (b.forms || 0) - (a.forms || 0));
    }

    const filtered = enriched.filter(x => x.category !== 'low');
    if (filtered.length > 0) return { suggestions: filtered.slice(0, 50), fallbackUsed: false };
    // Fallback: show top by time even if categorized as low
    const topByTime = [...rows]
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 50)
      .map(r => ({ ...r, score: scoreRow(r), category: categorize(scoreRow(r)) }));
    return { suggestions: topByTime, fallbackUsed: true };
  }, [rows, scoreRow, sortBy]);

  // Note: Do not early-return so that Current Tabs section is always visible

  return (
    <section style={{ marginTop: 12 }}>
      {/* Current Tabs Section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Cool Tabs <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({tabs.length})</span></h3>
        <button
          onClick={refreshTabs}
          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}
          className="icon-btn"
          aria-label="Reload"
          title="Reload"
        >
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>
      {tabsError ? (
        <div className="error" style={{ marginBottom: 12 }}>{String(tabsError)}</div>
      ) : (
        <ErrorBoundary>
          <div className="activity-grid" style={{ marginBottom: 16 }}>
            {sortedTabs.map(tab => (
              <div key={tab.id} className="activity-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
                {(() => {
                  // Derive favicon in a safe way; avoid file:// or chrome:// origins that yield "null/favicon.ico"
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
                  ) : <div style={{ width: 16, height: 16 }} />;
                })()}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tab.title || (() => { try { return new URL(tab?.url || '').hostname; } catch { return tab?.url || ''; } })()}
                  </div>
                </div>
                <button
                  onClick={() => requestPreview(tab)}
                  className="icon-btn"
                  aria-label="Preview"
                  title="Preview"
                  style={{ width: 28, height: 28 }}
                >
                  🛈
                </button>
                <button
                  onClick={() => {
                    const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                    if (hasTabsUpdate) return focusTab(tab);
                    if (tab?.url) {
                      enqueueOpenInChrome(tab.url).catch(() => { });
                    }
                  }}
                  className="go-btn icon-btn"
                  aria-label="Open tab"
                  title="Open tab"
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                </button>
                <button
                  onClick={() => duplicateTab(tab)}
                  className="dup-btn icon-btn"
                  aria-label="Duplicate tab"
                  title="Duplicate tab"
                  style={{ width: 28, height: 28 }}
                >
                  <FontAwesomeIcon icon={faClone} />
                </button>
                <button
                  onClick={() => removeTab(tab)}
                  className="remove-btn icon-btn"
                  aria-label="Remove tab"
                  title="Remove tab"
                  style={{ width: 28, height: 28 }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </div>
            ))}
            {!tabs.length && !tabsError && (
              <div className="empty">No tabs found</div>
            )}
          </div>
        </ErrorBoundary>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ marginBottom: '10px' }}>Cool Feed <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({rows.length}{fallbackUsed ? ', showing all' : ''})</span></h3>
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
          <ErrorBoundary>
            <div className="activity-grid">
              {suggestions.map((r) => {
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
          </ErrorBoundary>
        )
      }
      <TabPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        data={previewData}
        loading={previewLoading}
        error={previewError}
        onOpenFull={() => {
          try {
            const url = previewData?.url || (typeof previewData === 'string' ? previewData : null);
            if (!url) { setPreviewOpen(false); return; }
            if (typeof chrome !== 'undefined' && chrome?.tabs?.create) chrome.tabs.create({ url });
            else window.open(url, '_blank');
          } catch {}
          setPreviewOpen(false);
        }}
      />
    </section >
  );
}
