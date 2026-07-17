import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getHostUrl } from '../../services/syncConfig';
import './ActivityOverview.css';

// Context colors for the timeline bars + legend (assigned by rank, stable per render)
const CONTEXT_PALETTE = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa'];
const OTHER_COLOR = '#475569';
// All sparklines share one hue — trend shape is the data, not the color
const SPARKLINE_COLOR = '#818cf8';

const BROWSER_NAMES = ['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'safari'];
const isBrowserName = (name = '') => {
  const n = name.toLowerCase();
  return BROWSER_NAMES.some(b => n.includes(b));
};

function isLocalhostUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')
      || h.startsWith('127.') || h === '0.0.0.0' || h === '[::1]';
  } catch { return false; }
}

function fmtDur(secs) {
  if (!secs || secs < 60) return '<1m';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

// Strip ".exe" and title-case for display ("code.exe" -> "Code")
function prettyApp(name = '') {
  const bare = name.replace(/\.exe$/i, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

// "0 → 12a, 13 → 1p" — shared by timeline labels, tooltip, and hour-based stats
function fmtHour(h) {
  const n = ((h % 24) + 24) % 24;
  return n === 0 ? '12a' : n < 12 ? `${n}a` : n === 12 ? '12p' : `${n - 12}p`;
}

async function fetchUsage(params = '') {
  const res = await fetch(`${getHostUrl()}/activity/app-usage${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function Sparkline({ values, color }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 64},${19 - (v / max) * 16}`)
    .join(' ');
  return (
    <svg className="ao-sparkline" width="64" height="20" viewBox="0 0 64 20">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
                strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const DIRECTION_META = {
  rising:  { arrow: '▲', cls: 'up' },
  falling: { arrow: '▼', cls: 'down' },
  new:     { arrow: '✦', cls: 'new' },
  steady:  { arrow: '—', cls: 'flat' },
};

// Local YYYY-MM-DD for N days ago (the backend keys per-day files by local date)
function dateStrDaysAgo(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ActivityOverview({ embedded = false, hideWhenEmpty = false }) {
  const [today, setToday] = useState(null);
  const [range, setRange] = useState(14);
  const [rangeData, setRangeData] = useState(null);
  const [runningApps, setRunningApps] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [siteUsage, setSiteUsage] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [hoverHour, setHoverHour] = useState(null);
  const [error, setError] = useState(null);
  // 0 = today (live), 1 = yesterday, … — drives ?date= on /activity/app-usage
  const [dayOffset, setDayOffset] = useState(0);

  // Per-day per-domain browsing dwell, rolled up by the backend
  // (GET /activity/site-usage — sites-YYYY-MM-DD.json + live rows).
  // Fetch enough days to cover the selected day plus a 14-day trend window.
  const loadSites = useCallback(() => {
    fetch(`${getHostUrl()}/activity/site-usage?days=${dayOffset + 14}`)
      .then(r => r.json())
      .then(d => setSiteUsage(Array.isArray(d?.days) ? d.days : []))
      .catch(() => {});
  }, [dayOffset]);

  useEffect(() => { loadSites(); }, [loadSites]);

  useEffect(() => {
    fetch(`${getHostUrl()}/workspaces`)
      .then(r => r.json())
      .then(w => setWorkspaces(Array.isArray(w) ? w : []))
      .catch(() => {});
  }, []);

  // The sidecar on 4545 may still be binding when this mounts at app startup,
  // so transient fetch failures are expected — only surface the error banner
  // after several consecutive misses.
  const failsRef = useRef(0);

  const loadLive = useCallback(async () => {
    try {
      const [todayData, visible, tabsRes] = await Promise.all([
        fetchUsage(),
        fetch(`${getHostUrl()}/activity/visible`).then(r => r.json()).catch(() => []),
        fetch(`${getHostUrl()}/tabs`).then(r => r.json()).catch(() => []),
      ]);
      setToday(todayData);
      setRunningApps(Array.isArray(visible) ? visible : []);
      setTabs(Array.isArray(tabsRes) ? tabsRes : []);
      failsRef.current = 0;
      setError(null);
      return true;
    } catch (e) {
      failsRef.current += 1;
      if (failsRef.current >= 3) setError(String(e?.message || e));
      return false;
    }
  }, []);

  useEffect(() => {
    if (dayOffset !== 0) {
      let cancelled = false;
      setToday(null);
      fetchUsage(`?date=${dateStrDaysAgo(dayOffset)}`)
        .then(d => { if (!cancelled) { setToday(d); setError(null); } })
        .catch(e => { if (!cancelled) setError(String(e?.message || e)); })
      return () => { cancelled = true; };
    }
    // Live view: retry quickly while the backend comes up, then refresh on the
    // sampler's 30s cadence so today's numbers stay current.
    let timer;
    let cancelled = false;
    const tick = async () => {
      const ok = await loadLive();
      if (cancelled) return;
      timer = setTimeout(tick, ok ? 30000 : 3000);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [dayOffset, loadLive]);

  const dayLabel = useMemo(() => {
    if (dayOffset === 0) return 'Today';
    if (dayOffset === 1) return 'Yesterday';
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }, [dayOffset]);

  useEffect(() => {
    fetchUsage(`?days=${range}`).then(setRangeData).catch(() => setRangeData(null));
  }, [range]);

  // ── Today stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const apps = today?.apps || {};
    let active = 0, media = 0;
    const contextTotals = {};
    let topApp = null;
    Object.entries(apps).forEach(([name, u]) => {
      active += u.activeS || 0;
      media += (u.mediaS || 0) + (u.passiveMediaS || 0);
      if (!topApp || (u.activeS || 0) > (apps[topApp]?.activeS || 0)) topApp = name;
      Object.entries(u.contexts || {}).forEach(([ctx, s]) => {
        contextTotals[ctx] = (contextTotals[ctx] || 0) + s;
      });
    });
    const topContext = Object.entries(contextTotals)
      .filter(([name]) => name !== '(other)')
      .sort((a, b) => b[1] - a[1])[0] || null;
    const focusPct = active + media > 0 ? Math.round((active / (active + media)) * 100) : null;

    // Hourly-derived insight: busiest hour
    const hourly = today?.hourly || {};
    const hourTotals = Array.from({ length: 24 }, (_, h) => {
      const perCtx = hourly[String(h).padStart(2, '0')] || hourly[String(h)] || {};
      return Object.values(perCtx).reduce((s, v) => s + v, 0);
    });
    let peakHour = null;
    hourTotals.forEach((t, h) => {
      if (t > 0 && (peakHour === null || t > hourTotals[peakHour])) peakHour = h;
    });
    if (peakHour !== null && hourTotals[peakHour] < 900) peakHour = null; // only meaningful past ~15m

    return { active, media, topApp, topContext, focusPct, peakHour };
  }, [today]);

  // ── Timeline: 24 hour cells, dominant context per hour ─────────────────────
  const timeline = useMemo(() => {
    const hourly = today?.hourly || {};
    // Rank contexts by total secs today to assign stable colors
    const ctxTotals = {};
    Object.values(hourly).forEach(perCtx => {
      Object.entries(perCtx).forEach(([ctx, s]) => { ctxTotals[ctx] = (ctxTotals[ctx] || 0) + s; });
    });
    const ranked = Object.entries(ctxTotals).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const colorOf = ctx => {
      const i = ranked.indexOf(ctx);
      return i >= 0 && i < CONTEXT_PALETTE.length ? CONTEXT_PALETTE[i] : OTHER_COLOR;
    };
    const hours = Array.from({ length: 24 }, (_, h) => {
      const perCtx = hourly[String(h).padStart(2, '0')] || hourly[String(h)] || {};
      const entries = Object.entries(perCtx).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((s, [, v]) => s + v, 0);
      return { hour: h, total, entries, dominant: entries[0]?.[0] || null };
    });
    const legend = ranked.slice(0, CONTEXT_PALETTE.length)
      .map(name => ({ name, color: colorOf(name), secs: ctxTotals[name] }));
    return { hours, colorOf, legend };
  }, [today]);

  // Nearest snapshot for the hovered hour (for the tooltip's "what was open")
  const snapshotForHour = useCallback(hour => {
    const snaps = today?.snapshots || [];
    if (snaps.length === 0) return null;
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - dayOffset);
    dayStart.setHours(hour, 30, 0, 0);
    const target = dayStart.getTime();
    let best = null, bestDist = Infinity;
    snaps.forEach(s => {
      const d = Math.abs(s.ts - target);
      if (d < bestDist) { bestDist = d; best = s; }
    });
    return bestDist <= 90 * 60 * 1000 ? best : null; // within ±90 min only
  }, [today, dayOffset]);

  // ── Projects (context trends over the selected range) ──────────────────────
  const projects = useMemo(() => {
    const contexts = rangeData?.trends?.contexts || [];
    return contexts
      .filter(c => c.name !== '(other)'
        && !isBrowserName(c.name)
        && !c.name.toLowerCase().includes('cooldesk'))
      .slice(0, 6);
  }, [rangeData]);

  // Total tracked seconds across all contexts in the range — for share-of-time %
  const rangeTotal = useMemo(() =>
    (rangeData?.trends?.contexts || []).reduce((s, c) => s + (c.totalActiveS || 0), 0),
  [rangeData]);

  // ── Top sites: the selected day's domains + a 14-day trend per domain ──────
  const topSites = useMemo(() => {
    if (siteUsage.length === 0) return [];
    const dateStr = dateStrDaysAgo(dayOffset);
    const selIdx = siteUsage.findIndex(d => d.date === dateStr);
    if (selIdx < 0) return [];
    const trendDays = siteUsage.slice(Math.max(0, selIdx - 13), selIdx + 1);
    return Object.entries(siteUsage[selIdx].domains || {})
      .map(([domain, secs]) => ({
        domain,
        secs,
        trend: trendDays.map(d => (d.domains || {})[domain] || 0),
      }))
      .filter(s => s.secs >= 30)
      .sort((a, b) => b.secs - a.secs)
      .slice(0, 8);
  }, [siteUsage, dayOffset]);

  // ── Workspaces: attribute the day's domain dwell to workspaces whose URL
  // list contains that domain (a domain shared by N workspaces splits N ways;
  // dwell on domains in no workspace lands in `unassigned`) ────────────────────
  const workspaceStats = useMemo(() => {
    if (workspaces.length === 0 || siteUsage.length === 0) return null;
    const selIdx = siteUsage.findIndex(d => d.date === dateStrDaysAgo(dayOffset));
    if (selIdx < 0) return null;
    const trendDays = siteUsage.slice(Math.max(0, selIdx - 13), selIdx + 1);
    const lastIdx = trendDays.length - 1;

    const domainOf = url => {
      try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
      catch { return null; }
    };
    const owners = new Map(); // domain -> Set<workspace id>
    workspaces.forEach(w => (w.urls || []).forEach(u => {
      const d = domainOf(u?.url);
      if (!d) return;
      if (!owners.has(d)) owners.set(d, new Set());
      owners.get(d).add(w.id);
    }));

    const perWs = new Map(workspaces.map(w =>
      [w.id, { name: w.name, secs: 0, trend: new Array(trendDays.length).fill(0) }]));
    let unassigned = 0;
    trendDays.forEach((day, i) => {
      Object.entries(day.domains || {}).forEach(([domain, secs]) => {
        const ids = owners.get(domain);
        if (!ids) {
          if (i === lastIdx) unassigned += secs;
          return;
        }
        const share = secs / ids.size;
        ids.forEach(id => {
          const e = perWs.get(id);
          e.trend[i] += share;
          if (i === lastIdx) e.secs += share;
        });
      });
    });

    const list = [...perWs.values()]
      .map(e => ({ ...e, secs: Math.round(e.secs) }))
      .filter(e => e.secs >= 30)
      .sort((a, b) => b.secs - a.secs)
      .slice(0, 6);
    return { list, unassigned: Math.round(unassigned) };
  }, [workspaces, siteUsage, dayOffset]);

  // ── Right now (live) ────────────────────────────────────────────────────────
  const now = useMemo(() => {
    const seen = new Set();
    const apps = [];
    runningApps.forEach(a => {
      if (!a?.name || isBrowserName(a.name)) return;
      const key = a.name.toLowerCase();
      if (key.includes('cooldesk') || seen.has(key)) return;
      seen.add(key);
      apps.push(prettyApp(a.name));
    });
    const localhost = [];
    const lhSeen = new Set();
    tabs.forEach(t => {
      if (!t?.url || !isLocalhostUrl(t.url)) return;
      try {
        const u = new URL(t.url);
        const entry = u.port ? `${u.hostname}:${u.port}` : u.hostname;
        if (!lhSeen.has(entry)) { lhSeen.add(entry); localhost.push(entry); }
      } catch { /* ignore */ }
    });
    return { apps: apps.slice(0, 10), localhost: localhost.slice(0, 6), tabCount: tabs.length };
  }, [runningApps, tabs]);

  const isEmpty = !today || Object.keys(today.apps || {}).length === 0;
  const maxHourSecs = Math.max(...timeline.hours.map(h => h.total), 1800);

  // On the overview page the section earns its space only when there is data
  // (needs the desktop app on :4545) — otherwise disappear entirely.
  if (hideWhenEmpty && isEmpty && dayOffset === 0) return null;

  return (
    <div className={`ao-root ${embedded ? 'ao-embed' : ''}`}>
      {error && <div className="ao-error">Couldn't reach the CoolDesk backend: {error}</div>}

      {/* ── Day navigator ── */}
      <div className="ao-day-nav">
        <button className="ao-pill ao-nav-btn" title="Previous day"
                onClick={() => setDayOffset(o => o + 1)}>‹</button>
        <span className="ao-day-label">{dayLabel}</span>
        <button className="ao-pill ao-nav-btn" title="Next day" disabled={dayOffset === 0}
                onClick={() => setDayOffset(o => Math.max(0, o - 1))}>›</button>
        {dayOffset > 0 && (
          <button className="ao-pill" onClick={() => setDayOffset(0)}>Today</button>
        )}
        {/* One-line summary: active time + where it mostly went. Everything
            else (contexts, workspaces, sites) has its own section below. */}
        <div className="ao-day-summary">
          <strong>{fmtDur(stats.active)}</strong> active
          {workspaceStats?.list?.[0] && (
            <> · {workspaceStats.list[0].name} {fmtDur(workspaceStats.list[0].secs)}</>
          )}
          {stats.topApp && (
            <> · {prettyApp(stats.topApp)} {fmtDur(today.apps[stats.topApp]?.activeS)}</>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="ao-empty">
          <div className="ao-empty-icon">⏱</div>
          {dayOffset === 0 ? (
            <>
              <h4>No activity recorded yet</h4>
              <p>CoolDesk samples your focused apps in the background. Keep the app
                 running and this page fills up with your day — what you worked on, hours, trends.</p>
            </>
          ) : (
            <>
              <h4>No activity on this day</h4>
              <p>Nothing was recorded on {dayLabel.toLowerCase() === 'yesterday' ? 'yesterday' : dayLabel}.</p>
            </>
          )}
        </div>
      ) : (
        <div className="ao-layout">
          <div className="ao-main">
          {/* ── Timeline ── */}
          <div className="ao-section ao-panel">
            <div className="ao-section-head">
              <div className="ao-section-title">
                {dayOffset === 0 ? "Today's timeline" : `Timeline · ${dayLabel}`}
              </div>
              {stats.peakHour !== null && (
                <span className="ao-peak-note">
                  peak {fmtHour(stats.peakHour)}–{fmtHour(stats.peakHour + 1)}
                </span>
              )}
            </div>
            <div className="ao-timeline" onMouseLeave={() => setHoverHour(null)}>
              {timeline.hours.map(({ hour, total, dominant }) => {
                const heightPct = Math.min(100, (total / maxHourSecs) * 100);
                const isNow = dayOffset === 0 && hour === new Date().getHours();
                return (
                  <div key={hour}
                       className={`ao-hour ${isNow ? 'now' : ''} ${total > 0 ? 'has-data' : ''}`}
                       onMouseEnter={() => setHoverHour(hour)}>
                    <div className="ao-hour-bar-wrap">
                      {total > 0 && (
                        <div className="ao-hour-bar"
                             style={{ height: `${Math.max(heightPct, 8)}%`,
                                      background: timeline.colorOf(dominant) }} />
                      )}
                    </div>
                    {hour % 3 === 0 && (
                      <span className="ao-hour-label">{fmtHour(hour)}</span>
                    )}
                  </div>
                );
              })}
              {hoverHour !== null && timeline.hours[hoverHour].total > 0 && (() => {
                const h = timeline.hours[hoverHour];
                const snap = snapshotForHour(hoverHour);
                return (
                  <div className="ao-timeline-tip" style={{ left: `${(hoverHour / 24) * 100}%` }}>
                    <div className="ao-tip-title">
                      {fmtHour(hoverHour)}–{fmtHour(hoverHour + 1)}&nbsp;·&nbsp;{fmtDur(h.total)}
                    </div>
                    {h.entries.slice(0, 4).map(([ctx, s]) => (
                      <div key={ctx} className="ao-tip-row">
                        <span className="ao-tip-dot" style={{ background: timeline.colorOf(ctx) }} />
                        <span className="ao-tip-name">{ctx}</span>
                        <span className="ao-tip-secs">{fmtDur(s)}</span>
                      </div>
                    ))}
                    {snap && (
                      <div className="ao-tip-snap">
                        {snap.apps.slice(0, 4).map(prettyApp).join(' · ')}
                        {snap.localhost.length > 0 && ` · ⚡${snap.localhost[0]}`}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {timeline.legend.length > 0 && (
              <div className="ao-legend">
                {timeline.legend.map(({ name, color, secs }) => (
                  <span key={name} className="ao-legend-chip">
                    <span className="ao-tip-dot" style={{ background: color }} />
                    {name} <span className="ao-legend-secs">{fmtDur(secs)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Projects ── */}
          <div className="ao-section ao-panel ao-projects">
              <div className="ao-section-head">
                <div className="ao-section-title">What you worked on</div>
                <div className="ao-range-pills">
                  {[7, 14, 30].map(d => (
                    <button key={d}
                            className={`ao-pill ${range === d ? 'active' : ''}`}
                            onClick={() => setRange(d)}>
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              {projects.length === 0 ? (
                <div className="ao-muted">Nothing tracked in this window yet.</div>
              ) : (
                <div className="ao-project-list">
                  {(() => {
                    const maxActive = Math.max(...projects.map(p => p.totalActiveS || 0), 1);
                    return projects.map(p => {
                      const meta = DIRECTION_META[p.direction] || DIRECTION_META.steady;
                      const share = rangeTotal > 0
                        ? Math.max(1, Math.round((p.totalActiveS / rangeTotal) * 100))
                        : null;
                      return (
                        <div key={p.name} className="ao-project-card">
                          <div className="ao-project-name"
                               title={share !== null ? `${p.name} — ${share}% of tracked time` : p.name}>
                            {p.name}
                          </div>
                          <div className="ao-project-bar"
                               title={share !== null
                                 ? `${fmtDur(p.totalActiveS)} — ${share}% of all tracked time`
                                 : fmtDur(p.totalActiveS)}>
                            <span style={{ width: `${Math.max(2, (p.totalActiveS / maxActive) * 100)}%` }} />
                          </div>
                          <span className="ao-project-time">{fmtDur(p.totalActiveS)}</span>
                          <Sparkline values={p.dailyActiveS} color={SPARKLINE_COLOR} />
                          <span className={`ao-trend ${meta.cls}`}
                                title={`${p.direction} ${p.changePct > 0 ? '+' : ''}${p.changePct}%`}>
                            {meta.arrow}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Right rail — top sites for the selected day + live context on today */}
          <aside className="ao-rail">
            {dayOffset === 0 && (
            <div className="ao-section ao-panel ao-now">
              <div className="ao-section-head">
                <div className="ao-section-title">Right now</div>
                <button className="ao-pill" title="Refresh"
                        onClick={() => { loadLive(); loadSites(); }}>↺</button>
              </div>
              {now.apps.length > 0 && (
                <div className="ao-now-group">
                  <div className="ao-now-label">Apps</div>
                  <div className="ao-chip-row">
                    {now.apps.map(a => <span key={a} className="ao-chip">{a}</span>)}
                  </div>
                </div>
              )}
              {now.localhost.length > 0 && (
                <div className="ao-now-group">
                  <div className="ao-now-label">Dev servers</div>
                  <div className="ao-chip-row">
                    {now.localhost.map(l => <span key={l} className="ao-chip dev">⚡ {l}</span>)}
                  </div>
                </div>
              )}
              <div className="ao-now-group">
                <div className="ao-now-label">Browser</div>
                <div className="ao-chip-row">
                  <span className="ao-chip">{now.tabCount} tabs open</span>
                </div>
              </div>
            </div>
            )}

            <div className="ao-section ao-panel">
              <div className="ao-section-title">Workspaces</div>
              {!workspaceStats || workspaceStats.list.length === 0 ? (
                <div className="ao-muted">
                  No workspace browsing {dayOffset === 0 ? 'yet today' : 'on this day'}.
                </div>
              ) : (
                <div className="ao-site-list">
                  {workspaceStats.list.map(w => (
                    <div key={w.name} className="ao-site-row">
                      <span className="ao-site-domain" title={w.name}>{w.name}</span>
                      <Sparkline values={w.trend} color={SPARKLINE_COLOR} />
                      <span className="ao-site-time">{fmtDur(w.secs)}</span>
                    </div>
                  ))}
                </div>
              )}
              {workspaceStats && workspaceStats.unassigned >= 60 && (
                <div className="ao-site-row ao-site-unassigned">
                  <span className="ao-site-domain">Sites in no workspace</span>
                  <span className="ao-site-time">{fmtDur(workspaceStats.unassigned)}</span>
                </div>
              )}
            </div>

            <div className="ao-section ao-panel">
              <div className="ao-section-title">Top sites</div>
              {topSites.length === 0 ? (
                <div className="ao-muted">
                  No site activity {dayOffset === 0 ? 'yet today' : 'recorded on this day'}.
                </div>
              ) : (
                <div className="ao-site-list">
                  {topSites.map(s => (
                    <div key={s.domain} className="ao-site-row">
                      <span className="ao-site-domain" title={s.domain}>{s.domain}</span>
                      <Sparkline values={s.trend} color={SPARKLINE_COLOR} />
                      <span className="ao-site-time">{fmtDur(s.secs)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
