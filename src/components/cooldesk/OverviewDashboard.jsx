import { lazy, memo, Suspense, useEffect, useState } from 'react';
import '../../styles/cooldesk.css';
import { ActivityOverview } from './ActivityOverview';

const ActivityFeed = lazy(() => import('./ActivityFeed').then(m => ({ default: m.ActivityFeed })));

// Thin composition layer: clock hero + the shared ActivityOverview (same
// component the Knowledge Graph modal's Overview tab renders) + ActivityFeed.
const OverviewDashboard = memo(function OverviewDashboard() {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const hour = time.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    return (
        <div className="overview-dashboard-grid">
            {/* Left: clock hero + shared activity overview */}
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

                <ActivityOverview embedded />
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
