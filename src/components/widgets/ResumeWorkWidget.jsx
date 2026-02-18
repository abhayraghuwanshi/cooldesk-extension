/**
 * Resume Work Widget
 * Shows the last active browsing session with option to continue
 * Now with category detection and optional AI summary
 */

import { useEffect, useState } from 'react';
import { getActiveSessions } from '../../services/memory/sessionBuilder.js';
import appstoreData from '../../data/appstore.json';

// Category config with emojis and colors
const CATEGORY_CONFIG = {
    finance: { emoji: '💰', label: 'Finance', color: '#10B981' },
    health: { emoji: '🏥', label: 'Health', color: '#EC4899' },
    education: { emoji: '📚', label: 'Education', color: '#8B5CF6' },
    sports: { emoji: '⚽', label: 'Sports', color: '#F59E0B' },
    social: { emoji: '💬', label: 'Social', color: '#3B82F6' },
    travel: { emoji: '✈️', label: 'Travel', color: '#06B6D4' },
    entertainment: { emoji: '🎬', label: 'Entertainment', color: '#EF4444' },
    shopping: { emoji: '🛒', label: 'Shopping', color: '#F97316' },
    food: { emoji: '🍕', label: 'Food', color: '#84CC16' },
    utilities: { emoji: '🔧', label: 'Utilities', color: '#6B7280' },
    creativity: { emoji: '🎨', label: 'Creativity', color: '#A855F7' },
    information: { emoji: '📰', label: 'News', color: '#64748B' },
    productivity: { emoji: '📋', label: 'Productivity', color: '#0EA5E9' },
    ai: { emoji: '🤖', label: 'AI', color: '#8B5CF6' }
};

// Build a domain -> category lookup map
const domainCategoryMap = new Map();
Object.entries(appstoreData).forEach(([category, domains]) => {
    domains.forEach(domain => {
        // Handle domains with paths (e.g., "yahoo.com/finance")
        const baseDomain = domain.split('/')[0];
        domainCategoryMap.set(baseDomain, category);
    });
});

// Get category for a URL
function getCategoryForUrl(url) {
    try {
        const hostname = new URL(url).hostname.replace('www.', '');

        // Direct match
        if (domainCategoryMap.has(hostname)) {
            return domainCategoryMap.get(hostname);
        }

        // Try parent domain (e.g., chat.openai.com -> openai.com)
        const parts = hostname.split('.');
        if (parts.length > 2) {
            const parentDomain = parts.slice(-2).join('.');
            if (domainCategoryMap.has(parentDomain)) {
                return domainCategoryMap.get(parentDomain);
            }
        }

        return null;
    } catch {
        return null;
    }
}

export function ResumeWorkWidget() {
    const [lastSession, setLastSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [aiSummary, setAiSummary] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);

    useEffect(() => {
        loadLastSession();
    }, []);

    async function loadLastSession() {
        try {
            // Look back 6 hours to capture more context if recent activity was monomaniacal
            const sessions = await getActiveSessions(6 * 60 * 60 * 1000);

            if (sessions.length > 0) {
                // Merge ALL recent sessions into one view (each URL gets its own sessionId)
                // so we need to combine them to show all recent activity
                const allActivities = sessions.flatMap(s => s.activities);
                const latestEndTime = Math.max(...sessions.map(s => s.endTime));

                // Create a combined session object
                const session = {
                    ...sessions[0],
                    activities: allActivities,
                    endTime: latestEndTime,
                    metadata: sessions[0]?.metadata || {}
                };
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
                    const category = getCategoryForUrl(stat.url);

                    return { ...stat, score: recencyScore + durationScore, category };
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
                            // Extract meaningful context from title
                            let context = '';
                            if (stat.title && stat.title !== domain) {
                                // Clean up common suffixes and extract meaningful part
                                context = stat.title
                                    .replace(/\s*[-|·–—]\s*(ChatGPT|Claude|Gemini|Google|YouTube|GitHub|Reddit|Twitter|X|LinkedIn|Facebook|Amazon|eBay).*$/i, '')
                                    .replace(/\s*[-|·–—]\s*[^-|·–—]+$/, '') // Remove site name suffix
                                    .trim();
                                // Truncate if too long
                                if (context.length > 40) {
                                    context = context.substring(0, 37) + '...';
                                }
                            }
                            allUrls.push({ url: stat.url, category: stat.category, duration: stat.duration, title: stat.title, context });
                            domainCounts[domain] = currentCount + 1;
                        }
                    } catch (e) { }
                }

                // If no relevant URLs found
                if (allUrls.length === 0) {
                    setLastSession(null);
                    return;
                }

                // Detect categories from URLs
                const categoryCounts = {};
                allUrls.forEach(item => {
                    if (item.category) {
                        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
                    }
                });

                // Get top categories (max 3)
                const topCategories = Object.entries(categoryCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([cat]) => cat);

                // Get note and highlight counts
                const noteCount = session.metadata?.noteIds?.length || 0;
                const highlightCount = session.metadata?.highlightIds?.length || 0;

                setLastSession({
                    ...session,
                    allUrls,
                    topCategories,
                    noteCount,
                    highlightCount,
                    timeAgo: formatTimeAgo(session.endTime)
                });

                // Try to get AI summary if available
                fetchAiSummary(allUrls, topCategories);
            } else {
                setLastSession(null);
            }
        } catch (error) {
            console.error('[ResumeWorkWidget] Failed to load session:', error);
        } finally {
            setLoading(false);
        }
    }

    async function fetchAiSummary(urls, categories) {
        try {
            setAiLoading(true);

            // First check if NanoAI is available
            const statusResponse = await chrome.runtime.sendMessage({ type: 'NANO_AI_STATUS' });
            if (!statusResponse?.success || statusResponse?.availability !== 'available') {
                console.debug('[ResumeWorkWidget] NanoAI not available');
                return;
            }

            // Build context for AI - include titles for better descriptions
            const urlsWithTitles = urls.map(u => {
                let domain = '';
                try { domain = new URL(u.url).hostname.replace('www.', ''); } catch { }
                return {
                    url: u.url,
                    domain,
                    title: u.title || domain
                };
            });

            const categoryLabels = categories.map(c => CATEGORY_CONFIG[c]?.label || c);

            // Send to background for AI processing
            const response = await chrome.runtime.sendMessage({
                type: 'AI_SUMMARIZE_SESSION',
                data: {
                    urls: urlsWithTitles,
                    categories: categoryLabels,
                    urlCount: urls.length
                }
            });

            if (response?.summary) {
                setAiSummary(response.summary);
            }

            // Update URLs with AI-generated descriptions
            if (response?.descriptions && lastSession) {
                const updatedUrls = lastSession.allUrls.map((item, idx) => ({
                    ...item,
                    aiDescription: response.descriptions[idx] || null
                }));
                setLastSession(prev => ({ ...prev, allUrls: updatedUrls }));
            }
        } catch (error) {
            console.debug('[ResumeWorkWidget] AI summary unavailable:', error.message);
        } finally {
            setAiLoading(false);
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
            for (const item of urlsToOpen) {
                await chrome.tabs.create({ url: item.url, active: false });
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

            {/* Category Tags */}
            {lastSession.topCategories && lastSession.topCategories.length > 0 && (
                <div className="category-tags">
                    {lastSession.topCategories.map(cat => {
                        const config = CATEGORY_CONFIG[cat];
                        if (!config) return null;
                        return (
                            <span
                                key={cat}
                                className="category-tag"
                                style={{
                                    background: `${config.color}20`,
                                    borderColor: `${config.color}40`,
                                    color: config.color
                                }}
                            >
                                {config.emoji} {config.label}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* AI Summary (if available) */}
            {aiSummary && (
                <div className="ai-summary">
                    <span className="ai-badge">✨ AI</span>
                    <span className="summary-text">{aiSummary}</span>
                </div>
            )}
            {aiLoading && (
                <div className="ai-summary loading">
                    <span className="ai-badge">✨</span>
                    <span className="summary-text">Generating summary...</span>
                </div>
            )}

            <div className="widget-content">
                <div className="session-urls">
                    {visibleUrls.map((item, index) => {
                        let domain = '';
                        try { domain = new URL(item.url).hostname; } catch (e) { }
                        const catConfig = item.category ? CATEGORY_CONFIG[item.category] : null;

                        // Use AI description or fallback to extracted context from title
                        const description = item.aiDescription || item.context || null;

                        return (
                            <div
                                key={index}
                                className={`url-item ${description ? 'has-description' : ''}`}
                                onClick={() => chrome.tabs.create({ url: item.url, active: false })}
                                style={catConfig ? { borderColor: `${catConfig.color}30` } : {}}
                            >
                                <img
                                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                    alt=""
                                    className="favicon"
                                    onError={(e) => e.target.style.display = 'none'}
                                />
                                <div className="url-content">
                                    <span className="url-text" title={item.url}>
                                        {domain.replace(/^www\./, '')}
                                    </span>
                                    {description && (
                                        <span className="url-description">{description}</span>
                                    )}
                                </div>
                                {catConfig && (
                                    <span
                                        className="url-category"
                                        title={catConfig.label}
                                        style={{ color: catConfig.color }}
                                    >
                                        {catConfig.emoji}
                                    </span>
                                )}
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
                    margin-bottom: 12px;
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

                .category-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 12px;
                    position: relative;
                    z-index: 1;
                }

                .category-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    border: 1px solid;
                }

                .ai-summary {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    padding: 10px 12px;
                    background: rgba(139, 92, 246, 0.1);
                    border: 1px solid rgba(139, 92, 246, 0.2);
                    border-radius: 10px;
                    margin-bottom: 12px;
                    position: relative;
                    z-index: 1;
                }

                .ai-summary.loading {
                    opacity: 0.6;
                }

                .ai-badge {
                    font-size: 11px;
                    font-weight: 600;
                    color: #8B5CF6;
                    background: rgba(139, 92, 246, 0.2);
                    padding: 2px 6px;
                    border-radius: 4px;
                    flex-shrink: 0;
                }

                .summary-text {
                    font-size: 13px;
                    color: var(--text-secondary, rgba(255, 255, 255, 0.8));
                    line-height: 1.4;
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

                .url-item.has-description {
                    flex-direction: row;
                    align-items: flex-start;
                    max-width: 280px;
                }

                .url-content {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    flex: 1;
                    min-width: 0;
                }

                .url-description {
                    font-size: 11px;
                    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    line-height: 1.3;
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
                    flex: 1;
                }

                .url-category {
                    font-size: 12px;
                    flex-shrink: 0;
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
