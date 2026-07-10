import { useCallback, useEffect, useMemo, useState } from 'react';
import { getHostUrl } from '../../services/syncConfig';
import './ActivityOverview.css';

// Context colors for timeline + project cards (assigned by rank, stable per render)
const CONTEXT_PALETTE = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa'];
const OTHER_COLOR = '#475569';

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

export function ActivityOverview() {
  const [today, setToday] = useState(null);
  const [range, setRange] = useState(14);
  const [rangeData, setRangeData] = useState(null);
  const [runningApps, setRunningApps] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [hoverHour, setHoverHour] = useState(null);
  const [error, setError] = useState(null);

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
      setError(null);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => { loadLive(); }, [loadLive]);

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
    return { active, media, topApp, topContext, focusPct };
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
    const dayStart = new Date(); dayStart.setHours(hour, 30, 0, 0);
    const target = dayStart.getTime();
    let best = null, bestDist = Infinity;
    snaps.forEach(s => {
      const d = Math.abs(s.ts - target);
      if (d < bestDist) { bestDist = d; best = s; }
    });
    return bestDist <= 90 * 60 * 1000 ? best : null; // within ±90 min only
  }, [today]);

  // ── Projects (context trends over the selected range) ──────────────────────
  const projects = useMemo(() => {
    const contexts = rangeData?.trends?.contexts || [];
    return contexts
      .filter(c => c.name !== '(other)'
        && !isBrowserName(c.name)
        && !c.name.toLowerCase().includes('cooldesk'))
      .slice(0, 6);
  }, [rangeData]);

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

  return (
    <div className="ao-root">
      {error && <div className="ao-error">Couldn't reach the CoolDesk backend: {error}</div>}

      {/* ── Stat strip ── */}
      <div className="ao-stats">
        <div className="ao-stat">
          <span className="ao-stat-val">{fmtDur(stats.active)}</span>
          <span className="ao-stat-label">active today</span>
        </div>
        {stats.topContext && (
          <div className="ao-stat">
            <span className="ao-stat-val ao-accent">{stats.topContext[0]}</span>
            <span className="ao-stat-label">top project · {fmtDur(stats.topContext[1])}</span>
          </div>
        )}
        {stats.topApp && (
          <div className="ao-stat">
            <span className="ao-stat-val">{prettyApp(stats.topApp)}</span>
            <span className="ao-stat-label">top app · {fmtDur(today.apps[stats.topApp]?.activeS)}</span>
          </div>
        )}
        {stats.focusPct !== null && (
          <div className="ao-stat">
            <span className="ao-stat-val">{stats.focusPct}%</span>
            <span className="ao-stat-label">focused vs media</span>
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="ao-empty">
          <div className="ao-empty-icon">⏱</div>
          <h4>No activity recorded yet</h4>
          <p>CoolDesk samples your focused apps in the background. Keep the app
             running and this page fills up with your day — projects, hours, trends.</p>
        </div>
      ) : (
        <>
          {/* ── Timeline ── */}
          <div className="ao-section">
            <div className="ao-section-title">Today's timeline</div>
            <div className="ao-timeline" onMouseLeave={() => setHoverHour(null)}>
              {timeline.hours.map(({ hour, total, dominant }) => {
                const heightPct = Math.min(100, (total / maxHourSecs) * 100);
                const isNow = hour === new Date().getHours();
                return (
                  <div key={hour}
                       className={`ao-hour ${isNow ? 'now' : ''}`}
                       onMouseEnter={() => setHoverHour(hour)}>
                    <div className="ao-hour-bar-wrap">
                      {total > 0 && (
                        <div className="ao-hour-bar"
                             style={{ height: `${Math.max(heightPct, 8)}%`,
                                      background: timeline.colorOf(dominant) }} />
                      )}
                    </div>
                    {hour % 3 === 0 && (
                      <span className="ao-hour-label">
                        {hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
                      </span>
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
                      {hoverHour === 0 ? '12am' : hoverHour < 12 ? `${hoverHour}am` : hoverHour === 12 ? '12pm' : `${hoverHour - 12}pm`}
                      &nbsp;·&nbsp;{fmtDur(h.total)}
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

          {/* ── Projects + Right now ── */}
          <div className="ao-columns">
            <div className="ao-section ao-projects">
              <div className="ao-section-head">
                <div className="ao-section-title">Projects</div>
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
                <div className="ao-muted">No project activity in this window yet.</div>
              ) : (
                <div className="ao-project-list">
                  {projects.map((p, i) => {
                    const meta = DIRECTION_META[p.direction] || DIRECTION_META.steady;
                    const color = CONTEXT_PALETTE[i % CONTEXT_PALETTE.length];
                    return (
                      <div key={p.name} className="ao-project-card" style={{ '--accent': color }}>
                        <div className="ao-project-info">
                          <div className="ao-project-name" title={p.name}>{p.name}</div>
                          <div className="ao-project-sub">{fmtDur(p.totalActiveS)} · last {range}d</div>
                        </div>
                        <Sparkline values={p.dailyActiveS} color={color} />
                        <span className={`ao-trend ${meta.cls}`}
                              title={`${p.direction} ${p.changePct > 0 ? '+' : ''}${p.changePct}%`}>
                          {meta.arrow}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="ao-section ao-now">
              <div className="ao-section-head">
                <div className="ao-section-title">Right now</div>
                <button className="ao-pill" onClick={loadLive} title="Refresh">↺</button>
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
          </div>
        </>
      )}
    </div>
  );
}
