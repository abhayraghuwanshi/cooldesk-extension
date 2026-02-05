/**
 * Timeline View Component
 * Browse Memory - Activity Analytics
 */

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

        const totalTime = visits.reduce((sum, v) => {
            const time = v.metadata?.timeSpent ?? 0;
            return sum + time;
        }, 0);

        const hourlyActivity = new Array(24).fill(0);
        visits.forEach(v => {
            const hour = new Date(v.timestamp).getHours();
            hourlyActivity[hour]++;
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
                activities.forEach(activity => {
                    const existing = urlMap.get(activity.url) || {
                        url: activity.url,
                        title: activity.title || new URL(activity.url).hostname,
                        visits: 0,
                        timeSpent: 0,
                        lastVisit: 0
                    };

                    existing.visits++;
                    existing.timeSpent += activity.metrics?.timeSpent || 0;
                    existing.lastVisit = Math.max(existing.lastVisit, activity.timestamp);

                    urlMap.set(activity.url, existing);
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

            {/* Stats Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '12px',
                marginBottom: '20px'
            }}>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    textAlign: 'center',
                    transition: 'all 0.2s'
                }}>
                    <div style={{ fontSize: '28px', marginBottom: '4px' }}>⏱️</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#E5E7EB', marginBottom: '4px' }}>
                        {formatTime(dailyStats?.totalTime || 0)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Screen Time
                    </div>
                </div>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    textAlign: 'center',
                    transition: 'all 0.2s'
                }}>
                    <div style={{ fontSize: '28px', marginBottom: '4px' }}>🌐</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#E5E7EB', marginBottom: '4px' }}>
                        {dailyStats?.totalVisits || 0}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Visits
                    </div>
                </div>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    textAlign: 'center',
                    transition: 'all 0.2s'
                }}>
                    <div style={{ fontSize: '28px', marginBottom: '4px' }}>📝</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#E5E7EB', marginBottom: '4px' }}>
                        {dailyStats?.totalNotes || 0}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Notes
                    </div>
                </div>
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    textAlign: 'center',
                    transition: 'all 0.2s'
                }}>
                    <div style={{ fontSize: '28px', marginBottom: '4px' }}>✨</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#E5E7EB', marginBottom: '4px' }}>
                        {dailyStats?.totalHighlights || 0}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Highlights
                    </div>
                </div>
            </div>

            {/* Activity Chart */}
            {dailyStats?.totalVisits > 0 && (
                <div style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    marginBottom: '20px'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '3px',
                        height: '80px'
                    }}>
                        {dailyStats.hourlyActivity.map((count, hour) => {
                            const height = maxHourlyActivity > 0 ? (count / maxHourlyActivity) * 100 : 0;
                            return (
                                <div key={hour} style={{
                                    flex: 1,
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'flex-end'
                                }}>
                                    <div
                                        style={{
                                            width: '100%',
                                            height: `${height}%`,
                                            background: height > 0 ? 'linear-gradient(to top, #8b5cf6, #a78bfa)' : 'rgba(148, 163, 184, 0.1)',
                                            borderRadius: '2px 2px 0 0',
                                            minHeight: '2px',
                                            transition: 'all 0.3s'
                                        }}
                                        title={`${hour}:00 - ${count} visits`}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Top Sites */}
            {topSites.length > 0 && (
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
                        <span>🔥</span> Top Sites
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {topSites.map((site, idx) => (
                            <div key={site.url} style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '10px 12px',
                                background: 'rgba(15, 23, 42, 0.4)',
                                borderRadius: '8px',
                                border: '1px solid rgba(148, 163, 184, 0.1)',
                                transition: 'all 0.2s'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    flex: 1,
                                    minWidth: 0
                                }}>
                                    <img
                                        src={getFavicon(site.url)}
                                        alt=""
                                        style={{
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '4px',
                                            flexShrink: 0
                                        }}
                                        onError={(e) => e.target.style.display = 'none'}
                                    />
                                    <span style={{
                                        color: '#E5E7EB',
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>{site.title}</span>
                                </div>
                                <span style={{
                                    color: '#8b5cf6',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    flexShrink: 0
                                }}>{formatTime(site.timeSpent)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {dailyStats?.totalVisits === 0 && (
                <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#64748B'
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.3 }}>📅</div>
                    <p style={{ margin: 0, fontSize: '14px' }}>No activity recorded</p>
                </div>
            )}
        </div>
    );
}
