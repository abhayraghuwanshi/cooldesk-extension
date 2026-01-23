import { useState } from 'react';

export function CalendarWidget() {
    // We use the 'agenda' view by default as it fits better in widgets
    // src=primary attempts to load the logged-in user's main calendar
    // bgcolor overrides aren't fully supported by the modern Google Embed, but we try some parameters
    const [iframeLoaded, setIframeLoaded] = useState(false);

    // Constructing the embed URL with minimal UI
    // mode=AGENDA: List view
    // showTitle=0: Hide header
    // showNav=0: Hide navigation arrows
    // showDate=0: Hide date header
    // showPrint=0: Hide print icon
    // showTabs=0: Hide view tabs (Week/Month/Agenda buttons)
    // showCalendars=0: Hide calendar list
    // showTz=0: Hide timezone
    // Constructing the embed URL
    // We restore Nav and Date so the user can ensure they are looking at the right time context.
    // mode=AGENDA is still best for vertical lists.
    const calendarUrl = `https://calendar.google.com/calendar/embed?height=600&wkst=1&bgcolor=%23FFFFFF&ctz=local&src=primary&color=%23039BE5&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=0&showCalendars=0&showTz=0&mode=AGENDA`;

    return (
        <div className="cooldesk-workspace-card calendar-widget" style={{
            padding: 0,
            overflow: 'hidden',
            height: '350px',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#1E293B'
        }}>
            {/* Custom Header since we hid the Google one */}
            <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(30, 41, 59, 0.5)'
            }}>
                <div style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#F1F5F9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span>📅</span> Upcoming Meetings
                </div>
                <a
                    href="https://calendar.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        fontSize: '12px',
                        color: '#60A5FA',
                        textDecoration: 'none',
                        fontWeight: 500
                    }}
                >
                    Open Calendar
                </a>
            </div>

            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {!iframeLoaded && (
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: '#94A3B8',
                        zIndex: 0,
                        fontSize: '13px'
                    }}>
                        Loading events...
                    </div>
                )}
                <iframe
                    src={calendarUrl}
                    style={{
                        border: 'none',
                        width: '100%',
                        height: '100%',
                        opacity: iframeLoaded ? 1 : 0,
                        transition: 'opacity 0.2s ease',
                        position: 'relative',
                        zIndex: 1,
                        // Filter to Dark Mode
                        filter: 'invert(0.92) hue-rotate(180deg) contrast(0.95) saturate(0.8)',
                        mixBlendMode: 'normal'
                    }}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    scrolling="no"
                    onLoad={() => setIframeLoaded(true)}
                    title="Google Calendar"
                />
            </div>

            {!iframeLoaded && <div style={{
                padding: '8px',
                textAlign: 'center',
                fontSize: '11px',
                color: '#64748B',
                borderTop: '1px solid rgba(148, 163, 184, 0.1)'
            }}>
                If events don't appear, ensure you are logged into Google.
            </div>}
        </div>
    );
}
