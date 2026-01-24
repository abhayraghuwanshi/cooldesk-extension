import { useEffect, useState } from 'react';

export function CalendarWidget() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [region, setRegion] = useState('');

    useEffect(() => {
        // Clock timer
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);

        // Detect Region/Timezone
        try {
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            // Format: "Asia/Calcutta" -> "Calcutta" (or cleaner display)
            const regionName = timeZone.split('/')[1] || timeZone;
            setRegion(regionName.replace(/_/g, ' '));
        } catch (e) {
            setRegion('Local Time');
        }

        return () => clearInterval(timer);
    }, []);

    const fetchEvents = async () => {
        setLoading(true);
        try {
            const result = await chrome.storage.local.get(['calendar_events', 'calendar_last_updated']);
            if (result.calendar_events) {
                setEvents(result.calendar_events);
            }
            if (result.calendar_last_updated) {
                setLastUpdated(result.calendar_last_updated);
            }
        } catch (e) {
            console.error('Failed to load calendar events:', e);
        } finally {
            setLoading(false);
        }
    };

    const triggerScrape = () => {
        setLoading(true);
        chrome.runtime.sendMessage({ type: 'TRIGGER_CALENDAR_SCRAPE' }, (response) => {
            setTimeout(fetchEvents, 5000);
            setTimeout(fetchEvents, 10000);
        });
    };

    useEffect(() => {
        fetchEvents();
        const listener = (changes, area) => changes.calendar_events && setEvents(changes.calendar_events.newValue) || (changes.calendar_last_updated && setLastUpdated(Date.now()));
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    // Helper to format event time
    const formatEventTime = (timeStr) => {
        if (!timeStr || timeStr === 'Unknown') return 'Time TBA';
        return timeStr;
    };

    const isAllDay = (timeStr) => {
        return timeStr && (timeStr.toLowerCase().includes('all day') || timeStr.toLowerCase().includes('unknown'));
    };

    return (
        <div className="calendar-widget" style={{
            padding: 0,
            overflow: 'hidden',
            flexShrink: 0,
            maxHeight: '250px',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgba(30, 41, 59, 0.4)',
            borderRadius: '12px',
            border: '1px solid rgba(148, 163, 184, 0.08)'
        }}>
            {/* Clock & Header Section */}
            <div style={{
                padding: '20px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(30, 41, 59, 0.4))',
                borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{
                            fontSize: '32px',
                            fontWeight: 700,
                            color: '#F8FAFC',
                            fontFamily: 'monospace', // Or a nice sans-serif depending on global styles
                            lineHeight: '1',
                            letterSpacing: '-1px'
                        }}>
                            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div style={{
                            fontSize: '13px',
                            color: '#94A3B8',
                            marginTop: '4px',
                            fontWeight: 500
                        }}>
                            {currentTime.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                        </div>
                    </div>

                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '6px'
                    }}>
                        <div style={{
                            padding: '4px 8px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '12px',
                            fontSize: '11px',
                            color: '#CBD5E1',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}>
                            <span>🌍</span> {region}
                        </div>
                    </div>
                </div>
            </div>

            {/* List Header (Mini) */}
            <div style={{
                padding: '12px 20px 8px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: '#64748B',
                    letterSpacing: '0.05em'
                }}>
                    Upcoming Events
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={triggerScrape} title="Sync" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', fontSize: '14px' }}>↻</button>
                    <a href="https://calendar.google.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#3B82F6', fontSize: '12px', fontWeight: 600 }}>View All</a>
                </div>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', padding: '0 12px 12px 12px', maxHeight: '120px' }} className="custom-scrollbar">
                {events.length === 0 ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: '#64748B',
                        textAlign: 'center',
                        gap: '8px',
                        padding: '20px 0'
                    }}>
                        {!loading ? (
                            <>
                                <div style={{ fontSize: '24px', opacity: 0.5 }}>☕</div>
                                <div style={{ fontSize: '13px' }}>No upcoming meetings</div>
                            </>
                        ) : (
                            <div style={{ color: '#94A3B8', fontSize: '13px' }}>Checking for meetings...</div>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {events.map((evt, idx) => {
                            const isAllDayEvent = isAllDay(evt.time);
                            return (
                                <div key={idx} style={{
                                    padding: '12px',
                                    borderRadius: '10px',
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid rgba(255, 255, 255, 0.05)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}>
                                    {/* Left Accent Bar */}
                                    <div style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: '3px',
                                        background: isAllDayEvent ? '#10B981' : '#3B82F6'
                                    }} />

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingLeft: '8px' }}>
                                        <span style={{
                                            color: '#E2E8F0',
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            lineHeight: '1.4'
                                        }}>
                                            {evt.title}
                                        </span>
                                    </div>

                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        paddingLeft: '8px',
                                        marginTop: '2px'
                                    }}>
                                        {isAllDayEvent ? (
                                            <span style={{
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                color: '#10B981',
                                                background: 'rgba(16, 185, 129, 0.1)',
                                                padding: '2px 6px',
                                                borderRadius: '8px',
                                            }}>
                                                All Day
                                            </span>
                                        ) : (
                                            <span style={{
                                                color: '#94A3B8',
                                                fontSize: '11px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                {formatEventTime(evt.time)}
                                            </span>
                                        )}

                                        {evt.link && (
                                            <a
                                                href={evt.link}
                                                target="_blank"
                                                rel="noreferrer"
                                                style={{
                                                    fontSize: '10px',
                                                    background: 'rgba(59, 130, 246, 0.1)',
                                                    color: '#60A5FA',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    textDecoration: 'none',
                                                    fontWeight: 600
                                                }}
                                            >
                                                Join
                                            </a>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Loading Bar */}
            {loading && (
                <div style={{
                    height: '2px',
                    width: '100%',
                    background: 'rgba(255,255,255,0.1)',
                    overflow: 'hidden'
                }}>
                    <div className="loading-bar-anim" style={{
                        height: '100%',
                        background: '#3B82F6',
                        width: '50%'
                    }} />
                    <style>{`
                        @keyframes loadingBar {
                            0% { transform: translateX(-100%); width: 20%; }
                            50% { width: 50%; }
                            100% { transform: translateX(200%); width: 20%; }
                        }
                        .loading-bar-anim {
                            animation: loadingBar 1.5s infinite linear;
                        }
                    `}</style>
                </div>
            )}
        </div>
    );
}

