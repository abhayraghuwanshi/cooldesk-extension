import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import '../../styles/cooldesk.css';
import { getHostUrl } from '../../services/syncConfig';

const ActivityFeed = lazy(() => import('./ActivityFeed').then(m => ({ default: m.ActivityFeed })));

function fmtDur(secs) {
    if (!secs || secs < 60) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function prettyApp(name = '') {
    const bare = name.replace(/\.exe$/i, '');
    return bare.charAt(0).toUpperCase() + bare.slice(1);
}

const TREND_GLYPHS = {
    rising:  { arrow: '▲', color: '#4ade80' },
    falling: { arrow: '▼', color: '#f87171' },
    new:     { arrow: '✦', color: '#fbbf24' },
    steady:  { arrow: '—', color: '#64748b' },
};

const OverviewDashboard = memo(function OverviewDashboard() {
    const [time, setTime] = useState(new Date());
    const [today, setToday] = useState(null);
    const [projects, setProjects] = useState([]);

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        fetch(`${getHostUrl()}/activity/app-usage`)
            .then(r => (r.ok ? r.json() : null))
            .then(setToday)
            .catch(() => {});
        fetch(`${getHostUrl()}/activity/app-usage?days=7`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                const contexts = d?.trends?.contexts || [];
                setProjects(contexts.filter(c => c.name !== '(other)').slice(0, 4));
            })
            .catch(() => {});
    }, []);

    const stats = useMemo(() => {
        const apps = today?.apps || {};
        let active = 0;
        let topApp = null;
        const contextTotals = {};
        Object.entries(apps).forEach(([name, u]) => {
            active += u.activeS || 0;
            if (!topApp || (u.activeS || 0) > (apps[topApp]?.activeS || 0)) topApp = name;
            Object.entries(u.contexts || {}).forEach(([ctx, s]) => {
                contextTotals[ctx] = (contextTotals[ctx] || 0) + s;
            });
        });
        const topProject = Object.entries(contextTotals)
            .filter(([name]) => name !== '(other)')
            .sort((a, b) => b[1] - a[1])[0] || null;
        return { active, topApp, topProject };
    }, [today]);

    const hour = time.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    return (
        <div className="overview-dashboard-grid">
            {/* Left: clock hero + today's pulse */}
            <div className="overview-left-column">
                <div className="overview-hero">
                    <div className="overview-clock">
                        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="overview-date">
                        {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>
                    <div className="overview-greeting">{greeting}</div>
                </div>

                {stats.active >= 60 && (
                    <div className="overview-card">
                        <div className="overview-card-title">Today</div>
                        <div className="overview-stat-row">
                            <div className="overview-stat">
                                <span className="overview-stat-val">{fmtDur(stats.active)}</span>
                                <span className="overview-stat-label">active</span>
                            </div>
                            {stats.topProject && (
                                <div className="overview-stat">
                                    <span className="overview-stat-val accent" title={stats.topProject[0]}>
                                        {stats.topProject[0]}
                                    </span>
                                    <span className="overview-stat-label">
                                        top project · {fmtDur(stats.topProject[1])}
                                    </span>
                                </div>
                            )}
                            {stats.topApp && (
                                <div className="overview-stat">
                                    <span className="overview-stat-val">{prettyApp(stats.topApp)}</span>
                                    <span className="overview-stat-label">
                                        top app · {fmtDur(today.apps[stats.topApp]?.activeS)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {projects.length > 0 && (
                    <div className="overview-card">
                        <div className="overview-card-title">Projects · last 7 days</div>
                        <div className="overview-project-list">
                            {projects.map(p => {
                                const glyph = TREND_GLYPHS[p.direction] || TREND_GLYPHS.steady;
                                return (
                                    <div key={p.name} className="overview-project-row">
                                        <span className="overview-project-name" title={p.name}>{p.name}</span>
                                        <span className="overview-project-time">{fmtDur(p.totalActiveS) || '<1m'}</span>
                                        <span className="overview-project-trend" style={{ color: glyph.color }}
                                              title={`${p.direction} ${p.changePct > 0 ? '+' : ''}${p.changePct}%`}>
                                            {glyph.arrow}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Activity Feed — unchanged */}
            <div className="overview-activity-column">
                <Suspense fallback={<div style={{ minHeight: 400 }} />}>
                    <ActivityFeed />
                </Suspense>
            </div>
        </div>
    );
});

export { OverviewDashboard };
