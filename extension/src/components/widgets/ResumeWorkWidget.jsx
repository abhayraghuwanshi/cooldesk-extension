/**
 * Resume Work Widget
 * Shows the last active browsing session with option to continue
 */

import { useEffect, useState } from 'react';
import { getActiveSessions } from '../../services/memory/sessionBuilder.js';

export function ResumeWorkWidget() {
    const [lastSession, setLastSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        loadLastSession();
    }, []);

    async function loadLastSession() {
        try {
            // Look back 6 hours to capture more context if recent activity was monomaniacal
            const sessions = await getActiveSessions(6 * 60 * 60 * 1000);

            if (sessions.length > 0) {
                // Get the most recent session
                const session = sessions[0];
                const activities = session.activities;

                // 1. Filter Noise
                const noisePatterns = [
                    /google\.com\/search/,
                    /bing\.com\/search/,
                    /duckduckgo\.com/,
                    /localhost/,
                    /127\.0\.0\.1/,
                    /newtab/,
                    /chrome:\/\/*/,
                    /about:blank/,
                    /accounts\.google\.com/,
                    /signin/,
                    /login/,
                    /signup/,
                    /youtube\.com\/watch/ // Often distracting, maybe exclude unless deep work?
                ];

                const relevantActivities = activities.filter(a => {
                    try {
                        const url = new URL(a.url);
                        if (noisePatterns.some(p => p.test(a.url))) return false;
                        if (url.hostname === 'www.google.com' && url.pathname === '/') return false;
                        return true;
                    } catch (e) { return false; }
                });

                // 2. Calculate Stats
                const urlStats = {};
                relevantActivities.forEach((act, idx) => {
                    const nextAct = relevantActivities[idx + 1];
                    // If last item, assume 30s or use current time if very recent
                    const duration = nextAct ? nextAct.timestamp - act.timestamp : (Date.now() - act.timestamp > 300000 ? 30000 : Date.now() - act.timestamp);

                    if (!urlStats[act.url]) {
                        urlStats[act.url] = {
                            url: act.url,
                            duration: 0,
                            visits: 0,
                            lastVisit: act.timestamp,
                            title: act.title || new URL(act.url).hostname
                        };
                    }
                    urlStats[act.url].duration += duration;
                    urlStats[act.url].visits++;
                    // Keep the LATEST visit timestamp
                    if (act.timestamp > urlStats[act.url].lastVisit) {
                        urlStats[act.url].lastVisit = act.timestamp;
                    }
                });

                // 3. Score & Rank
                // Score = (Duration in minutes * 10) + (100 / Hours Since Visit)
                // This balances "spent a lot of time" with "just was there"
                const now = Date.now();
                const scoredUrls = Object.values(urlStats).map(stat => {
                    const durationMins = stat.duration / 60000;
                    const hoursSince = Math.max(0.1, (now - stat.lastVisit) / 3600000);
                    const recencyScore = 10 / hoursSince; // Higher if recent
                    const durationScore = Math.min(stat.duration / 10000, 50); // Cap duration impact

                    return { ...stat, score: recencyScore + durationScore };
                }).sort((a, b) => b.score - a.score);

                // 4. Stricter Deduplication
                const domainCounts = {};
                const allUrls = [];

                for (const stat of scoredUrls) {
                    if (allUrls.length >= 8) break;
                    try {
                        const domain = new URL(stat.url).hostname;

                        // Strict Caps:
                        // Normal domains: Max 1
                        // High engagement domains ( > 10 mins): Max 2
                        // Never more than 2 per domain to ensure variety
                        const currentCount = domainCounts[domain] || 0;
                        const maxAllowed = stat.duration > 600000 ? 2 : 1;

                        if (currentCount < maxAllowed) {
                            allUrls.push(stat.url);
                            domainCounts[domain] = currentCount + 1;
                        }
                    } catch (e) { }
                }

                // If no relevant URLs found
                if (allUrls.length === 0) {
                    setLastSession(null);
                    return;
                }

                // Get note and highlight counts
                const noteCount = session.metadata?.noteIds?.length || 0;
                const highlightCount = session.metadata?.highlightIds?.length || 0;

                setLastSession({
                    ...session,
                    allUrls,
                    noteCount,
                    highlightCount,
                    timeAgo: formatTimeAgo(session.endTime)
                });
            } else {
                setLastSession(null);
            }
        } catch (error) {
            console.error('[ResumeWorkWidget] Failed to load session:', error);
        } finally {
            setLoading(false);
        }
    }

    function formatTimeAgo(timestamp) {
        const minutes = Math.floor((Date.now() - timestamp) / 60000);
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        const days = Math.floor(hours / 24);
        return `${days} day${days > 1 ? 's' : ''} ago`;
    }

    async function handleContinue() {
        if (!lastSession) return;

        try {
            // Open top 3 URLs in new tabs
            const urlsToOpen = lastSession.allUrls.slice(0, 3);
            for (const url of urlsToOpen) {
                await chrome.tabs.create({ url, active: false });
            }
            setDismissed(true);
        } catch (error) {
            console.error('[ResumeWorkWidget] Failed to open tabs:', error);
        }
    }

    function handleDismiss() {
        setDismissed(true);
    }

    if (loading) {
        return (
            <div className="resume-work-widget loading">
                <div className="spinner"></div>
            </div>
        );
    }

    if (!lastSession || dismissed) {
        return null;
    }

    const visibleUrls = expanded ? lastSession.allUrls : lastSession.allUrls.slice(0, 3);
    const remainingCount = Math.max(0, lastSession.allUrls.length - 3);

    return (
        <div className={`resume-work-widget ${expanded ? 'expanded' : ''}`}>
            <div className="widget-header">
                <div className="header-left">
                    <div className="icon-badge">
                        <span role="img" aria-label="resume">⚡</span>
                    </div>
                    <div>
                        <h3>Resume Work</h3>
                        <span className="time-ago">Active {lastSession.timeAgo}</span>
                    </div>
                </div>
                <button className="close-btn" onClick={handleDismiss} aria-label="Dismiss">
                    ×
                </button>
            </div>

            <div className="widget-content">
                <div className="session-urls">
                    {visibleUrls.map((url, index) => {
                        let domain = '';
                        try { domain = new URL(url).hostname; } catch (e) { }
                        return (
                            <div key={index} className="url-item" onClick={() => chrome.tabs.create({ url, active: false })}>
                                <img
                                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                    alt=""
                                    className="favicon"
                                    onError={(e) => e.target.style.display = 'none'}
                                />
                                <span className="url-text" title={url}>
                                    {domain.replace(/^www\./, '')}
                                </span>
                            </div>
                        );
                    })}

                    {!expanded && remainingCount > 0 && (
                        <div className="url-item more" onClick={() => setExpanded(true)}>
                            <span className="more-badge">+{remainingCount}</span>
                            <span className="url-text">more pages</span>
                        </div>
                    )}

                    {expanded && (
                        <div className="url-item more" onClick={() => setExpanded(false)}>
                            <span className="url-text">Show less</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="widget-actions">
                <button className="btn-secondary" onClick={handleDismiss}>
                    Dismiss
                </button>
                <button className="btn-primary" onClick={handleContinue}>
                    Continue Session <span className="arrow">→</span>
                </button>
            </div>

            <style jsx>{`
                .resume-work-widget {
                    background: rgba(30, 30, 35, 0.6);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    padding: 20px;
                    color: var(--text-primary, #fff);
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                    margin-bottom: 24px;
                    animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    position: relative;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }

                /* Subtle gradient overlay */
                .resume-work-widget::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 100%;
                    background: linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%);
                    pointer-events: none;
                }

                @keyframes slideIn {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .widget-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 20px;
                    position: relative;
                    z-index: 1;
                }

                .header-left {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                }

                .icon-badge {
                    width: 40px;
                    height: 40px;
                    border-radius: 12px;
                    background: linear-gradient(135deg, var(--accent-primary, #6366f1), var(--accent-secondary, #8b5cf6));
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
                }

                .widget-header h3 {
                    margin: 0 0 2px 0;
                    font-size: 16px;
                    font-weight: 600;
                    letter-spacing: -0.01em;
                }

                .time-ago {
                    font-size: 13px;
                    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
                }

                .close-btn {
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
                    border-radius: 8px;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 18px;
                    line-height: 1;
                }

                .close-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                .widget-content {
                    margin-bottom: 20px;
                    position: relative;
                    z-index: 1;
                }

                .session-urls {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                }

                .url-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: rgba(0, 0, 0, 0.2);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    padding: 8px 12px;
                    border-radius: 10px;
                    font-size: 13px;
                    color: var(--text-primary, #fff);
                    cursor: pointer;
                    transition: all 0.2s;
                    max-width: 200px;
                }

                .url-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                    border-color: rgba(255, 255, 255, 0.1);
                    transform: translateY(-1px);
                    background: rgba(255, 255, 255, 0.1);
                }
                
                .url-item.more {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px dashed rgba(255, 255, 255, 0.2);
                }
                
                .url-item.more:hover {
                     background: rgba(255, 255, 255, 0.2);
                     border-color: rgba(255, 255, 255, 0.3);
                }

                .favicon {
                    width: 16px;
                    height: 16px;
                    border-radius: 3px;
                }

                .url-text {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .more-badge {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .widget-actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                    position: relative;
                    z-index: 1;
                }

                .btn-primary,
                .btn-secondary {
                    padding: 10px 18px;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    border: none;
                }

                .btn-secondary {
                    background: transparent;
                    color: var(--text-secondary, rgba(255, 255, 255, 0.7));
                }

                .btn-secondary:hover {
                    color: #fff;
                    background: rgba(255, 255, 255, 0.05);
                }

                .btn-primary {
                    background: var(--text-primary, #fff);
                    color: #000;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 600;
                }

                .btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.2);
                }

                .arrow {
                    transition: transform 0.2s;
                }

                .btn-primary:hover .arrow {
                    transform: translateX(2px);
                }
            `}</style>
        </div>
    );
}
