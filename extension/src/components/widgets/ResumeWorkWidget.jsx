/**
 * Resume Work Widget
 * Shows the last active browsing session with option to continue
 */

import { useEffect, useState } from 'react';
import { getUnifiedDB } from '../../db/unified-db.js';
import { getActiveSessions } from '../../services/memory/sessionBuilder.js';

export function ResumeWorkWidget() {
    const [lastSession, setLastSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        loadLastSession();
    }, []);

    async function loadLastSession() {
        try {
            const sessions = await getActiveSessions(2 * 60 * 60 * 1000); // Last 2 hours

            if (sessions.length > 0) {
                // Get the most recent session
                const session = sessions[0];

                // Get note and highlight counts
                const db = await getUnifiedDB();
                const noteCount = session.metadata?.noteIds?.length || 0;
                const highlightCount = session.metadata?.highlightIds?.length || 0;

                // Get unique URLs
                const uniqueUrls = [...new Set(session.activities.map(a => a.url))];
                const topUrls = uniqueUrls.slice(0, 3);

                setLastSession({
                    ...session,
                    topUrls,
                    noteCount,
                    highlightCount,
                    timeAgo: formatTimeAgo(session.endTime)
                });
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
            // Open top URLs in new tabs
            for (const url of lastSession.topUrls) {
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

    return (
        <div className="resume-work-widget">
            <div className="widget-header">
                <h3>Resume where you left off</h3>
                <button className="close-btn" onClick={handleDismiss} aria-label="Dismiss">
                    ✕
                </button>
            </div>

            <div className="widget-content">
                <div className="session-info">
                    <span className="time-ago">{lastSession.timeAgo}</span>
                    {lastSession.metadata?.summary && (
                        <p className="session-summary">{lastSession.metadata.summary}</p>
                    )}
                </div>

                <div className="session-urls">
                    {lastSession.topUrls.map((url, index) => (
                        <div key={index} className="url-item">
                            <span className="url-bullet">•</span>
                            <span className="url-text" title={url}>
                                {new URL(url).hostname}
                            </span>
                        </div>
                    ))}
                    {lastSession.activities.length > 3 && (
                        <div className="url-item more">
                            <span className="url-bullet">•</span>
                            <span className="url-text">
                                +{lastSession.activities.length - 3} more pages
                            </span>
                        </div>
                    )}
                </div>

                {(lastSession.noteCount > 0 || lastSession.highlightCount > 0) && (
                    <div className="session-metadata">
                        {lastSession.noteCount > 0 && (
                            <span className="meta-item">
                                📝 {lastSession.noteCount} note{lastSession.noteCount > 1 ? 's' : ''}
                            </span>
                        )}
                        {lastSession.highlightCount > 0 && (
                            <span className="meta-item">
                                ✨ {lastSession.highlightCount} highlight{lastSession.highlightCount > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="widget-actions">
                <button className="btn-secondary" onClick={handleDismiss}>
                    Dismiss
                </button>
                <button className="btn-primary" onClick={handleContinue}>
                    Continue
                </button>
            </div>

            <style jsx>{`
                .resume-work-widget {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 12px;
                    padding: 20px;
                    color: white;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    margin-bottom: 20px;
                    animation: slideIn 0.3s ease-out;
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .resume-work-widget.loading {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100px;
                }

                .spinner {
                    width: 24px;
                    height: 24px;
                    border: 3px solid rgba(255, 255, 255, 0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .widget-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                }

                .widget-header h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                }

                .close-btn {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    padding: 0;
                    width: 24px;
                    height: 24px;
                }

                .close-btn:hover {
                    opacity: 1;
                }

                .widget-content {
                    margin-bottom: 16px;
                }

                .session-info {
                    margin-bottom: 12px;
                }

                .time-ago {
                    font-size: 13px;
                    opacity: 0.9;
                    font-weight: 500;
                }

                .session-summary {
                    margin: 8px 0 0 0;
                    font-size: 14px;
                    opacity: 0.95;
                }

                .session-urls {
                    margin: 12px 0;
                }

                .url-item {
                    display: flex;
                    align-items: center;
                    margin: 6px 0;
                    font-size: 14px;
                }

                .url-bullet {
                    margin-right: 8px;
                    opacity: 0.7;
                }

                .url-text {
                    opacity: 0.95;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .url-item.more .url-text {
                    opacity: 0.8;
                    font-style: italic;
                }

                .session-metadata {
                    display: flex;
                    gap: 12px;
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                }

                .meta-item {
                    font-size: 13px;
                    opacity: 0.9;
                }

                .widget-actions {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }

                .btn-primary,
                .btn-secondary {
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                }

                .btn-primary {
                    background: white;
                    color: #667eea;
                }

                .btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                }

                .btn-secondary {
                    background: rgba(255, 255, 255, 0.2);
                    color: white;
                }

                .btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.3);
                }
            `}</style>
        </div>
    );
}
