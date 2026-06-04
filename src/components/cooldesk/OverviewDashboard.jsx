import { lazy, memo, Suspense, useEffect, useState } from 'react';
import '../../styles/cooldesk.css';
import { defaultFontFamily } from '../../utils/fontUtils';
import { ResumeWorkWidget } from '../widgets/ResumeWorkWidget';

const ActivityFeed = lazy(() => import('./ActivityFeed').then(m => ({ default: m.ActivityFeed })));

const OverviewDashboard = memo(function OverviewDashboard() {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const hour = time.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    return (
        <div className="overview-dashboard-grid" style={{
            borderRadius: 16,
            border: '1px solid transparent',
            marginTop: '24px',
        }}>
            {/* Left: Clock + Widgets */}
            <div className="overview-left-column">
                {/* Clock */}
                <div style={{ padding: '20px 0 16px 0' }}>
                    <div style={{
                        fontSize: 'clamp(52px, 5.5vw, 76px)',
                        fontWeight: 700,
                        color: '#F8FAFC',
                        fontFamily: defaultFontFamily,
                        lineHeight: 1,
                        letterSpacing: '-2px',
                    }}>
                        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{
                        fontSize: '14px',
                        color: 'rgba(148, 163, 184, 0.75)',
                        fontWeight: 500,
                        fontFamily: defaultFontFamily,
                        marginTop: '8px',
                    }}>
                        {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>
                    <div style={{
                        fontSize: '13px',
                        color: 'rgba(147, 197, 253, 0.65)',
                        fontWeight: 500,
                        fontFamily: defaultFontFamily,
                        marginTop: '4px',
                    }}>
                        {greeting}
                    </div>
                </div>

                {/* Resume last session */}
                <ResumeWorkWidget />
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
