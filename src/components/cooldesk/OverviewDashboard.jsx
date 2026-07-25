import { memo } from 'react';
import '../../styles/cooldesk.css';
import { ActivityFeed } from './ActivityFeed';
import { ActivityOverview } from './ActivityOverview';
import { WidgetBoard } from './WidgetBoard';

// Thin composition layer: widget board (clock/date live there as widgets now)
// + the shared ActivityOverview (same component the Knowledge Graph modal's
// Overview tab renders) + ActivityFeed.
//
// Everything imports statically on purpose: these ARE the page. Lazy chunks
// here just staged the mount (board after activity, feed after both) and
// produced ~0.7 CLS as each arrival re-laid the grid. The bundle loads from
// disk, so splitting it saved no network.
const OverviewDashboard = memo(function OverviewDashboard() {
    return (
        // .overview-scope establishes the container-query context; the grid
        // inside responds to this width, not the viewport.
        <div className="overview-scope">
            <div className="overview-dashboard-grid">
                {/* Left: widget board + shared activity overview */}
                <div className="overview-left-column">
                    <WidgetBoard />
                    <ActivityOverview embedded hideWhenEmpty />
                </div>

                {/* Right: Activity Feed */}
                <div className="overview-activity-column">
                    <ActivityFeed />
                </div>
            </div>
        </div>
    );
});

export { OverviewDashboard };
