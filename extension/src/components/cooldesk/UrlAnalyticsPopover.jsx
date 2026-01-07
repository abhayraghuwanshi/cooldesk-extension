import { faCalendarAlt, faClock, faEye, faHistory } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUrlAnalytics } from '../../db/index.js';

export function UrlAnalyticsPopover({ url, title, onClose, triggerRect }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const popoverRef = useRef(null);

    useEffect(() => {
        let mounted = true;
        const loadStats = async () => {
            try {
                setLoading(true);
                const data = await getUrlAnalytics(url);
                if (mounted) setStats(data);
            } catch (err) {
                console.error("[Analytics] Failed to load:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        };
        loadStats();
        return () => { mounted = false; };
    }, [url]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const formatDuration = (ms) => {
        if (!ms) return '0m';
        const sec = Math.floor(ms / 1000);
        if (sec < 60) return `${sec}s`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m`;
        const hr = Math.floor(min / 60);
        return `${hr}h ${min % 60}m`;
    };

    const formatDate = (ts) => {
        if (!ts) return 'Never';
        return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    const formatTimeAgo = (ts) => {
        if (!ts) return 'Never';
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    if (!triggerRect) return null;

    // Calculate position
    const style = {
        position: 'fixed',
        bottom: `${window.innerHeight - triggerRect.top + 8}px`,
        left: `${triggerRect.left - 220}px`, // Align somewhat to the left of the icon
        width: '240px',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        borderRadius: '12px',
        padding: '12px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
        zIndex: 9999, // High z-index to sit on top of everything
        color: '#F1F5F9',
        fontSize: '13px'
    };

    return createPortal(
        <div
            className="analytics-popover"
            style={style}
            ref={popoverRef}
            onClick={e => e.stopPropagation()}
            onMouseLeave={onClose}
        >
            {/* Arrow - adjusted for fixed positioning */}
            <div style={{
                position: 'absolute',
                bottom: '-6px',
                right: '12px', // Align with icon roughly
                width: '12px',
                height: '12px',
                background: 'inherit',
                borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                borderRight: '1px solid rgba(148, 163, 184, 0.2)',
                transform: 'rotate(45deg)'
            }} />

            {/* Header */}
            <div style={{
                marginBottom: '12px',
                borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                paddingBottom: '8px'
            }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title || new URL(url).hostname}
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>Analytics Overview</div>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '10px', color: '#64748B' }}>
                    Loading...
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {/* Visits */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px' }}>
                        <div style={{ color: '#60A5FA', marginBottom: '4px' }}>
                            <FontAwesomeIcon icon={faEye} />
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 600 }}>{stats?.totalVisits || 0}</div>
                        <div style={{ fontSize: '10px', color: '#94A3B8' }}>Total Visits</div>
                    </div>

                    {/* Time Spent */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px' }}>
                        <div style={{ color: '#F472B6', marginBottom: '4px' }}>
                            <FontAwesomeIcon icon={faClock} />
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 600 }}>{formatDuration(stats?.totalTime)}</div>
                        <div style={{ fontSize: '10px', color: '#94A3B8' }}>Time Spent</div>
                    </div>

                    {/* Last Active */}
                    <div style={{ gridColumn: 'span 2', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ color: '#34D399' }}>
                            <FontAwesomeIcon icon={faHistory} />
                        </div>
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 500 }}>{formatTimeAgo(stats?.lastActive)}</div>
                            <div style={{ fontSize: '10px', color: '#94A3B8' }}>Last Active</div>
                        </div>
                    </div>

                    {/* Added Date */}
                    <div style={{ gridColumn: 'span 2', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ color: '#A78BFA' }}>
                            <FontAwesomeIcon icon={faCalendarAlt} />
                        </div>
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 500 }}>{formatDate(stats?.firstVisit)}</div>
                            <div style={{ fontSize: '10px', color: '#94A3B8' }}>First Visited</div>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}
