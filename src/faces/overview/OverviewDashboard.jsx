import { memo } from 'react';
import '../../styles/cooldesk.css';
import { ActivityFeed } from './parts/ActivityFeed';
import { CardBoard } from './CardBoard';
import { getVibe, isBoardLayout, isStageLayout } from './overviewLayouts';
import { StageBoard } from './StageBoard';
import { ActivityOverview } from '../../features/activity/ActivityOverview';
import { WidgetBoard } from '../../features/widgets/WidgetBoard';
import { TRANSPARENT_ACCENT } from '../../shared/components/AccentColorPicker.jsx';
import { accentTextVars } from '../../utils/readableColor.js';
import { ColumnColorChip } from './ColumnColorChip.jsx';
import { colorlessStyle, useColumnAccent, useColumnOpacity, useWallpaperBacking } from './columnColor.js';

const LEFT_COLOR_KEY = 'cooldesk-overview-left-color';
const ACTIVITY_COLOR_KEY = 'cooldesk-overview-activity-color';
const LEFT_OPACITY_KEY = 'cooldesk-overview-left-colorless-opacity';
const ACTIVITY_OPACITY_KEY = 'cooldesk-overview-activity-colorless-opacity';

// Thin composition layer: widget board (clock/date live there as widgets now)
// + the shared ActivityOverview (same component the Knowledge Graph modal's
// Overview tab renders) + ActivityFeed.
//
// Everything imports statically on purpose: these ARE the page. Lazy chunks
// here just staged the mount (board after activity, feed after both) and
// produced ~0.7 CLS as each arrival re-laid the grid. The bundle loads from
// disk, so splitting it saved no network.
// Everything visible unless the host says otherwise (only the extension's
// LayoutPicker hides parts; the desktop app always shows the full page).
const SHOW_ALL = { widgets: true, summary: true, feed: true, favorites: true, hiddenFeedTabs: [] };

const OverviewDashboard = memo(function OverviewDashboard({ layout = 'classic', visible = SHOW_ALL, cardEditing = false, onCardEditingDone }) {
    const [leftColor, setLeftColor] = useColumnAccent(LEFT_COLOR_KEY);
    const [activityColor, setActivityColor] = useColumnAccent(ACTIVITY_COLOR_KEY);
    const [leftOpacity, setLeftOpacity] = useColumnOpacity(LEFT_OPACITY_KEY);
    const [activityOpacity, setActivityOpacity] = useColumnOpacity(ACTIVITY_OPACITY_KEY);
    const wall = useWallpaperBacking();
    const showLeft = visible.widgets || visible.summary;

    // Start pages: fixed arrangements of the same pieces.
    if (isStageLayout(layout)) {
        return (
            <div className="overview-scope">
                <StageBoard key={layout} vibe={getVibe(layout)} />
            </div>
        );
    }

    // Custom layout and the vibes: a card grid instead of the two columns.
    // Keyed by board so switching vibes loads that vibe's own cards.
    if (isBoardLayout(layout)) {
        return (
            <div className="overview-scope">
                <CardBoard key={layout} board={layout} editing={cardEditing} onDone={onCardEditingDone} wall={wall} />
            </div>
        );
    }

    return (
        // .overview-scope establishes the container-query context; the grid
        // inside responds to this width, not the viewport.
        <div className="overview-scope">
            <div className="overview-dashboard-grid" data-layout={layout}>
                {/* Left: widget board + shared activity overview */}
                {showLeft && <div
                    className={`overview-left-column ${leftColor === TRANSPARENT_ACCENT ? 'is-colorless' : leftColor ? 'has-accent' : ''}`}
                    style={
                        leftColor === TRANSPARENT_ACCENT ? colorlessStyle(leftOpacity, wall)
                            : leftColor ? { '--card-accent': leftColor, ...accentTextVars(leftColor, 0.13) }
                                : undefined
                    }
                >
                    <ColumnColorChip
                        color={leftColor}
                        onChange={setLeftColor}
                        opacity={leftOpacity}
                        onOpacityChange={setLeftOpacity}
                    />
                    {/* Inner scroller, so the scroll-edge fade masks only the
                        content — not the column's own glass. */}
                    <div className="overview-left-scroll">
                        {visible.widgets && <WidgetBoard />}
                        {visible.summary && <ActivityOverview embedded hideWhenEmpty />}
                    </div>
                </div>}

                {/* Right: Activity Feed */}
                {visible.feed && <div
                    className={`overview-activity-column ${activityColor === TRANSPARENT_ACCENT ? 'is-colorless' : activityColor ? 'has-accent' : ''}`}
                    style={
                        activityColor === TRANSPARENT_ACCENT ? colorlessStyle(activityOpacity, wall)
                            : activityColor ? { '--card-accent': activityColor, ...accentTextVars(activityColor, 0.13) }
                                : undefined
                    }
                >
                    <ColumnColorChip
                        color={activityColor}
                        onChange={setActivityColor}
                        opacity={activityOpacity}
                        onOpacityChange={setActivityOpacity}
                    />
                    <ActivityFeed showFavorites={visible.favorites !== false} hiddenTabs={visible.hiddenFeedTabs} />
                </div>}
            </div>
        </div>
    );
});

export { OverviewDashboard };
