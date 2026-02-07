/**
 * Timeline View Component
 * Browse Memory - Activity Analytics
 */

import { faChartLine, faClock, faFire, faGlobe, faNoteSticky, faStar } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { DB_CONFIG, getUnifiedDB } from '../../db/unified-db.js';
import { getMemoryEvents } from '../../services/memory/eventAggregator.js';

export function TimelineView() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [dailyStats, setDailyStats] = useState(null);
    const [topSites, setTopSites] = useState([]);

    useEffect(() => {
        loadDayData();
    }, [selectedDate]);

    async function loadDayData() {
        setLoading(true);
        try {
            const date = new Date(selectedDate);
            const startOfDay = date.setHours(0, 0, 0, 0);
            const endOfDay = date.setHours(23, 59, 59, 999);

            const dayEvents = await getMemoryEvents({
                startDate: startOfDay,
                endDate: endOfDay,
                types: ['visit', 'note', 'highlight', 'save'],
                limit: 1000
            });

            setEvents(dayEvents);

            const stats = calculateDailyStats(dayEvents, startOfDay, endOfDay);
            setDailyStats(stats);

            const sites = await getTopSitesWithTime(startOfDay, endOfDay);
            setTopSites(sites);
        } catch (error) {
            console.error('[TimelineView] Failed to load day data:', error);
        } finally {
            setLoading(false);
        }
    }

    function calculateDailyStats(events, startOfDay, endOfDay) {
        const visits = events.filter(e => e.type === 'visit');
        const notes = events.filter(e => e.type === 'note');
        const highlights = events.filter(e => e.type === 'highlight');

        // Group visits by session and take MAX timeSpent per session
        const sessionMap = new Map();
        visits.forEach(v => {
            const sessionId = v.sessionId || `${v.url}_${v.timestamp}`;
            const existing = sessionMap.get(sessionId) || {
                timeSpent: 0,
                visibleTime: 0,
                clicks: 0,
                scrollDepth: 0
            };

            // Use MAX for cumulative metrics from heartbeats
            existing.timeSpent = Math.max(existing.timeSpent, v.metrics?.timeSpent || v.metadata?.timeSpent || 0);
            existing.visibleTime = Math.max(existing.visibleTime, v.metrics?.visibleTime || 0);
            existing.clicks = Math.max(existing.clicks, v.metrics?.clicks || 0);
            existing.scrollDepth = Math.max(existing.scrollDepth, v.metrics?.maxScrollDepth || 0);

            sessionMap.set(sessionId, existing);
        });

        // Sum up all session times
        const totalTime = Array.from(sessionMap.values()).reduce((sum, session) => sum + session.timeSpent, 0);

        const hourlyActivity = new Array(24).fill(0);
        visits.forEach(v => {
            const hour = new Date(v.timestamp).getHours();
            hourlyActivity[hour]++;
        });

        console.log('[TimelineView] Daily stats:', {
            totalTime,
            sessions: sessionMap.size,
            totalVisits: visits.length
        });

        return {
            totalTime,
            totalVisits: visits.length,
            totalNotes: notes.length,
            totalHighlights: highlights.length,
            hourlyActivity,
            peakHour: hourlyActivity.indexOf(Math.max(...hourlyActivity))
        };
    }

    async function getTopSitesWithTime(startDate, endDate) {
        const db = await getUnifiedDB();
        const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
        const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
        const index = store.index('by_timestamp');

        return new Promise((resolve, reject) => {
            const range = IDBKeyRange.bound(startDate, endDate);
            const request = index.getAll(range);

            request.onsuccess = () => {
                const activities = request.result || [];

                const urlMap = new Map();
                const sessionMap = new Map(); // Track sessions separately

                activities.forEach(activity => {
                    const sessionId = activity.sessionId || `${activity.url}_${activity.timestamp}`;

                    // Track max timeSpent per session (since heartbeats are cumulative)
                    const existingSession = sessionMap.get(sessionId) || {
                        timeSpent: 0,
                        visibleTime: 0,
                        clicks: 0,
                        scrollDepth: 0
                    };

                    // Use MAX for cumulative metrics, SUM for counters
                    existingSession.timeSpent = Math.max(existingSession.timeSpent, activity.metrics?.timeSpent || 0);
                    existingSession.visibleTime = Math.max(existingSession.visibleTime, activity.metrics?.visibleTime || 0);
                    existingSession.scrollDepth = Math.max(existingSession.scrollDepth, activity.metrics?.maxScrollDepth || 0);
                    existingSession.clicks = Math.max(existingSession.clicks, activity.metrics?.clicks || 0);

                    sessionMap.set(sessionId, existingSession);

                    // Aggregate by URL
                    const existing = urlMap.get(activity.url) || {
                        url: activity.url,
                        title: activity.title || new URL(activity.url).hostname,
                        visits: 0,
                        timeSpent: 0,
                        visibleTime: 0,
                        clicks: 0,
                        scrollDepth: 0,
                        lastVisit: 0,
                        sessions: new Set()
                    };

                    // Add session to this URL's sessions
                    if (!existing.sessions.has(sessionId)) {
                        existing.sessions.add(sessionId);
                        existing.visits++;
                    }

                    existing.lastVisit = Math.max(existing.lastVisit, activity.timestamp);
                    urlMap.set(activity.url, existing);
                });

                // Now sum up session metrics for each URL
                urlMap.forEach((urlData, url) => {
                    let totalTime = 0;
                    let totalVisible = 0;
                    let totalClicks = 0;
                    let maxScroll = 0;

                    urlData.sessions.forEach(sessionId => {
                        const session = sessionMap.get(sessionId);
                        if (session) {
                            totalTime += session.timeSpent;
                            totalVisible += session.visibleTime;
                            totalClicks += session.clicks;
                            maxScroll = Math.max(maxScroll, session.scrollDepth);
                        }
                    });

                    urlData.timeSpent = totalTime;
                    urlData.visibleTime = totalVisible;
                    urlData.clicks = totalClicks;
                    urlData.scrollDepth = maxScroll;
                    delete urlData.sessions; // Clean up
                });

                const sorted = Array.from(urlMap.values())
                    .sort((a, b) => b.timeSpent - a.timeSpent)
                    .slice(0, 5);

                resolve(sorted);
            };

            request.onerror = () => reject(request.error);
        });
    }

    function formatTime(ms) {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function changeDate(days) {
        const date = new Date(selectedDate);
        date.setDate(date.getDate() + days);
        setSelectedDate(date.toISOString().split('T')[0]);
    }

    function formatDateHeader(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function getFavicon(url) {
        try {
            const domain = new URL(url).hostname;
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        } catch {
            return null;
        }
    }

    if (loading) {
        return (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                Loading...
            </div>
        );
    }

    const maxHourlyActivity = Math.max(...(dailyStats?.hourlyActivity || [1]));

    return (
        <div style={{ padding: '0', width: '100%' }}>
            {/* Date Navigator */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px',
                background: 'rgba(30, 41, 59, 0.7)',
                backdropFilter: 'blur(16px)',
                borderRadius: '12px',
                padding: '12px 16px',
                border: '1px solid rgba(148, 163, 184, 0.2)'
            }}>
                <button onClick={() => changeDate(-1)} style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '8px',
                    width: '36px',
                    height: '36px',
                    color: '#E5E7EB',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    transition: 'all 0.2s'
                }}>←</button>
                <h2 style={{
                    margin: 0,
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#E5E7EB'
                }}>{formatDateHeader(selectedDate)}</h2>
                <button
                    onClick={() => changeDate(1)}
                    disabled={selectedDate >= new Date().toISOString().split('T')[0]}
                    style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(148, 163, 184, 0.2)',
                        borderRadius: '8px',
                        width: '36px',
                        height: '36px',
                        color: '#E5E7EB',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '16px',
                        opacity: selectedDate >= new Date().toISOString().split('T')[0] ? 0.3 : 1,
                        transition: 'all 0.2s'
                    }}
                >→</button>
            </div>

            {/* Stats Cards - Compact */}
            <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '20px',
                flexWrap: 'wrap'
            }}>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flex: '1 1 auto',
                    minWidth: '140px'
                }}>
                    <FontAwesomeIcon icon={faClock} style={{ fontSize: '18px', color: '#8b5cf6' }} />
                    <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: '#E5E7EB' }}>
                            {formatTime(dailyStats?.totalTime || 0)}
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Screen Time
                        </div>
                    </div>
                </div>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flex: '1 1 auto',
                    minWidth: '120px'
                }}>
                    <FontAwesomeIcon icon={faGlobe} style={{ fontSize: '18px', color: '#3b82f6' }} />
                    <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: '#E5E7EB' }}>
                            {dailyStats?.totalVisits || 0}
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Visits
                        </div>
                    </div>
                </div>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flex: '1 1 auto',
                    minWidth: '110px'
                }}>
                    <FontAwesomeIcon icon={faNoteSticky} style={{ fontSize: '18px', color: '#10b981' }} />
                    <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: '#E5E7EB' }}>
                            {dailyStats?.totalNotes || 0}
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Notes
                        </div>
                    </div>
                </div>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flex: '1 1 auto',
                    minWidth: '130px'
                }}>
                    <FontAwesomeIcon icon={faStar} style={{ fontSize: '18px', color: '#f59e0b' }} />
                    <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: '#E5E7EB' }}>
                            {dailyStats?.totalHighlights || 0}
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Highlights
                        </div>
                    </div>
                </div>
            </div>

            {/* Two Column Layout */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '20px',
                alignItems: 'start'
            }}>
                {/* Left Column: Activity Matrix & Graph */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Activity Heatmap Matrix */}
                    {dailyStats?.totalVisits > 0 && (
                        <div style={{
                            background: 'rgba(30, 41, 59, 0.7)',
                            backdropFilter: 'blur(16px)',
                            borderRadius: '12px',
                            padding: '16px',
                            border: '1px solid rgba(148, 163, 184, 0.2)'
                        }}>
                            <h3 style={{
                                margin: '0 0 16px 0',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: '#E5E7EB',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                <FontAwesomeIcon icon={faChartLine} style={{ color: '#8b5cf6' }} />
                                Hourly Activity
                            </h3>
                            <div style={{
                                display: 'flex',
                                alignItems: 'flex-end',
                                gap: '3px',
                                height: '100px'
                            }}>
                                {dailyStats.hourlyActivity.map((count, hour) => {
                                    const height = maxHourlyActivity > 0 ? (count / maxHourlyActivity) * 100 : 0;
                                    return (
                                        <div key={hour} style={{
                                            flex: 1,
                                            height: '100%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'flex-end',
                                            gap: '4px'
                                        }}>
                                            <div
                                                style={{
                                                    width: '100%',
                                                    height: `${height}%`,
                                                    background: height > 0 ? 'linear-gradient(to top, #8b5cf6, #a78bfa)' : 'rgba(148, 163, 184, 0.1)',
                                                    borderRadius: '3px 3px 0 0',
                                                    minHeight: '2px',
                                                    transition: 'all 0.3s',
                                                    cursor: 'pointer'
                                                }}
                                                title={`${hour}:00 - ${count} visits`}
                                            />
                                            {hour % 3 === 0 && (
                                                <div style={{
                                                    fontSize: '9px',
                                                    color: '#64748B',
                                                    textAlign: 'center'
                                                }}>
                                                    {hour}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Activity Heatmap Grid - GitHub Style */}
                    {dailyStats?.totalVisits > 0 && (
                        <div style={{
                            background: 'rgba(30, 41, 59, 0.7)',
                            backdropFilter: 'blur(16px)',
                            borderRadius: '12px',
                            padding: '16px',
                            border: '1px solid rgba(148, 163, 184, 0.2)'
                        }}>
                            <h3 style={{
                                margin: '0 0 12px 0',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: '#E5E7EB',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                <FontAwesomeIcon icon={faChartLine} style={{ color: '#3b82f6' }} />
                                Activity Matrix
                            </h3>
                            {/* Hour Labels */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(24, 1fr)',
                                gap: '3px',
                                marginBottom: '6px'
                            }}>
                                {Array.from({ length: 24 }, (_, i) => (
                                    <div key={i} style={{
                                        fontSize: '9px',
                                        color: '#64748B',
                                        textAlign: 'center',
                                        display: i % 3 === 0 ? 'block' : 'none'
                                    }}>
                                        {i}
                                    </div>
                                ))}
                            </div>
                            {/* GitHub-style Grid */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(24, 1fr)',
                                gap: '3px'
                            }}>
                                {dailyStats.hourlyActivity.map((count, hour) => {
                                    const intensity = maxHourlyActivity > 0 ? count / maxHourlyActivity : 0;
                                    let color;
                                    if (intensity === 0) {
                                        color = 'rgba(148, 163, 184, 0.1)';
                                    } else if (intensity < 0.25) {
                                        color = 'rgba(139, 92, 246, 0.3)';
                                    } else if (intensity < 0.5) {
                                        color = 'rgba(139, 92, 246, 0.5)';
                                    } else if (intensity < 0.75) {
                                        color = 'rgba(139, 92, 246, 0.7)';
                                    } else {
                                        color = 'rgba(139, 92, 246, 0.9)';
                                    }
                                    return (
                                        <div
                                            key={hour}
                                            style={{
                                                aspectRatio: '1',
                                                background: color,
                                                borderRadius: '2px',
                                                transition: 'all 0.2s',
                                                cursor: 'pointer',
                                                border: 'none'
                                            }}
                                            title={`${hour}:00 - ${count} visit${count !== 1 ? 's' : ''}`}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'scale(1.3)';
                                                e.currentTarget.style.zIndex = '10';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'scale(1)';
                                                e.currentTarget.style.zIndex = '1';
                                            }}
                                        />
                                    );
                                })}
                            </div>
                            {/* Legend */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginTop: '12px',
                                fontSize: '11px',
                                color: '#94A3B8'
                            }}>
                                <span>Less</span>
                                <div style={{ width: '10px', height: '10px', background: 'rgba(148, 163, 184, 0.1)', borderRadius: '2px' }} />
                                <div style={{ width: '10px', height: '10px', background: 'rgba(139, 92, 246, 0.3)', borderRadius: '2px' }} />
                                <div style={{ width: '10px', height: '10px', background: 'rgba(139, 92, 246, 0.5)', borderRadius: '2px' }} />
                                <div style={{ width: '10px', height: '10px', background: 'rgba(139, 92, 246, 0.7)', borderRadius: '2px' }} />
                                <div style={{ width: '10px', height: '10px', background: 'rgba(139, 92, 246, 0.9)', borderRadius: '2px' }} />
                                <span>More</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Column: Top Sites */}
                {topSites.length > 0 && (
                    <div style={{
                        background: 'rgba(30, 41, 59, 0.7)',
                        backdropFilter: 'blur(16px)',
                        borderRadius: '12px',
                        padding: '16px',
                        border: '1px solid rgba(148, 163, 184, 0.2)'
                    }}>
                        <h3 style={{
                            margin: '0 0 16px 0',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#E5E7EB',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <FontAwesomeIcon icon={faFire} style={{ color: '#f59e0b' }} />
                            Top Sites
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {topSites.map((site, idx) => (
                                <div key={site.url} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '12px',
                                    background: 'rgba(15, 23, 42, 0.4)',
                                    borderRadius: '10px',
                                    border: '1px solid rgba(148, 163, 184, 0.1)',
                                    transition: 'all 0.2s',
                                    cursor: 'pointer'
                                }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(15, 23, 42, 0.6)';
                                        e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                                        e.currentTarget.style.transform = 'translateX(4px)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(15, 23, 42, 0.4)';
                                        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)';
                                        e.currentTarget.style.transform = 'translateX(0)';
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        flex: 1,
                                        minWidth: 0
                                    }}>
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '8px',
                                            background: 'rgba(139, 92, 246, 0.1)',
                                            border: '1px solid rgba(139, 92, 246, 0.2)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            overflow: 'hidden'
                                        }}>
                                            <img
                                                src={getFavicon(site.url)}
                                                alt=""
                                                style={{
                                                    width: '20px',
                                                    height: '20px'
                                                }}
                                                onError={(e) => {
                                                    e.target.style.display = 'none';
                                                    e.target.parentElement.innerHTML = `<div style="color: #8b5cf6; font-size: 14px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16" fill="currentColor"><path d="M352 256c0 22.2-1.2 43.6-3.3 64H163.3c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64H348.7c2.2 20.4 3.3 41.8 3.3 64zm28.8-64H503.9c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64H380.8c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64zm112.6-32H376.7c-10-63.9-29.8-117.4-55.3-151.6c78.3 20.7 142 77.5 171.9 151.6zm-149.1 0H167.7c6.1-36.4 15.5-68.6 27-94.7c10.5-23.6 22.2-40.7 33.5-51.5C239.4 3.2 248.7 0 256 0s16.6 3.2 27.8 13.8c11.3 10.8 23 27.9 33.5 51.5c11.6 26 20.9 58.2 27 94.7zm-209 0H18.6C48.6 85.9 112.2 29.1 190.6 8.4C165.1 42.6 145.3 96.1 135.3 160zM8.1 192H131.2c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64H8.1C2.8 299.5 0 278.1 0 256s2.8-43.5 8.1-64zM194.7 446.6c-11.6-26-20.9-58.2-27-94.6H344.3c-6.1 36.4-15.5 68.6-27 94.6c-10.5 23.6-22.2 40.7-33.5 51.5C272.6 508.8 263.3 512 256 512s-16.6-3.2-27.8-13.8c-11.3-10.8-23-27.9-33.5-51.5zM135.3 352c10 63.9 29.8 117.4 55.3 151.6C112.2 482.9 48.6 426.1 18.6 352H135.3zm358.1 0c-30 74.1-93.6 130.9-171.9 151.6c25.5-34.2 45.2-87.7 55.3-151.6H493.4z"/></svg></div>`;
                                                }}
                                            />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                color: '#E5E7EB',
                                                fontSize: '13px',
                                                fontWeight: 500,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                marginBottom: '2px'
                                            }}>{site.title}</div>
                                            <div style={{
                                                color: '#64748B',
                                                fontSize: '11px',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis'
                                            }}>
                                                {site.visits} visit{site.visits !== 1 ? 's' : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        gap: '2px',
                                        flexShrink: 0,
                                        marginLeft: '12px'
                                    }}>
                                        <span style={{
                                            color: '#8b5cf6',
                                            fontSize: '14px',
                                            fontWeight: 700
                                        }}>{formatTime(site.timeSpent)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Empty State */}
            {dailyStats?.totalVisits === 0 && (
                <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#64748B',
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '12px',
                    border: '1px solid rgba(148, 163, 184, 0.2)'
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.3 }}>
                        <FontAwesomeIcon icon={faChartLine} />
                    </div>
                    <p style={{ margin: 0, fontSize: '14px' }}>No activity recorded for this day</p>
                </div>
            )}
        </div>
    );
}
