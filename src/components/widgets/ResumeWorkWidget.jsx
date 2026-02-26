/**
 * Resume Work Widget V2
 * Shows the last active browsing session with rich context
 * Features: Activity-based scoring, workspace associations, time tracking
 */

import {
    faBolt,
    faComments,
    faFilm,
    faFolder,
    faFutbol,
    faGraduationCap,
    faHeartPulse,
    faMagic,
    faNewspaper,
    faPalette,
    faPlane,
    faRobot,
    faShoppingCart,
    faStar,
    faTasks,
    faUtensils,
    faWallet,
    faWrench
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import appstoreData from '../../data/appstore.json';
import { getUrlAnalytics, listWorkspaces } from '../../db/unified-api.js';
import { getActiveSessions } from '../../services/memory/sessionBuilder.js';

// Category config with icons and colors
const CATEGORY_CONFIG = {
    finance: { icon: faWallet, label: 'Finance', color: '#10B981', gradient: 'linear-gradient(135deg, #10B981 0%, #059669 100%)' },
    health: { icon: faHeartPulse, label: 'Health', color: '#EC4899', gradient: 'linear-gradient(135deg, #EC4899 0%, #DB2777 100%)' },
    education: { icon: faGraduationCap, label: 'Education', color: '#8B5CF6', gradient: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' },
    sports: { icon: faFutbol, label: 'Sports', color: '#F59E0B', gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
    social: { icon: faComments, label: 'Social', color: '#3B82F6', gradient: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)' },
    travel: { icon: faPlane, label: 'Travel', color: '#06B6D4', gradient: 'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)' },
    entertainment: { icon: faFilm, label: 'Entertainment', color: '#EF4444', gradient: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)' },
    shopping: { icon: faShoppingCart, label: 'Shopping', color: '#F97316', gradient: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)' },
    food: { icon: faUtensils, label: 'Food', color: '#84CC16', gradient: 'linear-gradient(135deg, #84CC16 0%, #65A30D 100%)' },
    utilities: { icon: faWrench, label: 'Utilities', color: '#6B7280', gradient: 'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)' },
    creativity: { icon: faPalette, label: 'Creativity', color: '#A855F7', gradient: 'linear-gradient(135deg, #A855F7 0%, #9333EA 100%)' },
    information: { icon: faNewspaper, label: 'News', color: '#64748B', gradient: 'linear-gradient(135deg, #64748B 0%, #475569 100%)' },
    productivity: { icon: faTasks, label: 'Productivity', color: '#0EA5E9', gradient: 'linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)' },
    ai: { icon: faRobot, label: 'AI', color: '#8B5CF6', gradient: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }
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
    const [workspaceMap, setWorkspaceMap] = useState(new Map()); // URL -> workspace associations
    const [hoveredUrl, setHoveredUrl] = useState(null);

    useEffect(() => {
        loadLastSession();
    }, []);

    // Format duration for display
    function formatDuration(ms) {
        if (ms < 60000) return `${Math.round(ms / 1000)}s`;
        if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
        return `${Math.round(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`;
    }

    // Load workspace associations for URLs
    async function loadWorkspaceAssociations() {
        try {
            const wsResult = await listWorkspaces();
            const workspaces = wsResult?.success ? wsResult.data : (Array.isArray(wsResult) ? wsResult : []);

            const urlToWorkspace = new Map();
            for (const ws of workspaces) {
                if (!ws.urls) continue;
                for (const urlEntry of ws.urls) {
                    const url = typeof urlEntry === 'string' ? urlEntry : urlEntry.url;
                    if (!urlToWorkspace.has(url)) {
                        urlToWorkspace.set(url, []);
                    }
                    urlToWorkspace.get(url).push({
                        id: ws.id,
                        name: ws.name,
                        category: ws.context?.category,
                        icon: ws.icon
                    });
                }
            }
            setWorkspaceMap(urlToWorkspace);
        } catch (e) {
            console.warn('[ResumeWorkWidget] Failed to load workspace associations:', e);
        }
    }

    async function loadLastSession() {
        try {
            // Look back 6 hours to capture more context
            const sessions = await getActiveSessions(6 * 60 * 60 * 1000);

            if (sessions.length > 0) {
                // Merge ALL recent sessions into one view
                const allActivities = sessions.flatMap(s => s.activities);
                const latestEndTime = Math.max(...sessions.map(s => s.endTime));
                const earliestStartTime = Math.min(...sessions.map(s => s.startTime));

                const session = {
                    ...sessions[0],
                    activities: allActivities,
                    endTime: latestEndTime,
                    startTime: earliestStartTime,
                    metadata: sessions[0]?.metadata || {}
                };
                const activities = session.activities;

                // 1. Enhanced Noise Filtering
                const noisePatterns = [
                    /google\.com\/search/,
                    /bing\.com\/search/,
                    /duckduckgo\.com/,
                    /localhost/,
                    /127\.0\.0\.1/,
                    /newtab/,
                    /chrome:\/\//,
                    /edge:\/\//,
                    /about:blank/,
                    /accounts\.google\.com/,
                    /signin/i,
                    /login/i,
                    /signup/i,
                    /auth\./,
                    /oauth/,
                    /\/callback/,
                    /maps\.google\.com\/maps\/search/, // One-off map searches
                ];

                const relevantActivities = activities.filter(a => {
                    try {
                        const url = new URL(a.url);
                        if (noisePatterns.some(p => p.test(a.url))) return false;
                        if (url.hostname === 'www.google.com' && url.pathname === '/') return false;
                        return true;
                    } catch { return false; }
                }).sort((a, b) => a.timestamp - b.timestamp);

                // 2. Calculate Stats with Enhanced Metrics
                const urlStats = {};
                relevantActivities.forEach((act, idx) => {
                    const nextAct = relevantActivities[idx + 1];
                    let duration = nextAct
                        ? nextAct.timestamp - act.timestamp
                        : (Date.now() - act.timestamp > 300000 ? 30000 : Date.now() - act.timestamp);
                    duration = Math.max(0, duration);

                    if (!urlStats[act.url]) {
                        urlStats[act.url] = {
                            url: act.url,
                            duration: 0,
                            visits: 0,
                            lastVisit: act.timestamp,
                            firstVisit: act.timestamp,
                            title: act.title || new URL(act.url).hostname,
                            interactions: 0
                        };
                    }
                    const stat = urlStats[act.url];
                    stat.duration += Math.min(duration, 600000); // Cap at 10 min per visit
                    stat.visits++;
                    if (act.timestamp > stat.lastVisit) stat.lastVisit = act.timestamp;
                    if (act.timestamp < stat.firstVisit) stat.firstVisit = act.timestamp;
                    // Count interactions from metrics if available
                    if (act.metrics) {
                        stat.interactions += (act.metrics.clicks || 0) + (act.metrics.forms || 0);
                    }
                });

                // 3. Enhanced Scoring with Activity Data
                const now = Date.now();
                const scoredUrlsPromises = Object.values(urlStats).map(async stat => {
                    // Get historical analytics for better scoring
                    let historicalBonus = 0;
                    try {
                        const analytics = await getUrlAnalytics(stat.url);
                        if (analytics) {
                            // Bonus for recurring sites (qualified in our system)
                            const uniqueDays = analytics.dailyStats?.filter(d => d.time > 0).length || 0;
                            if (uniqueDays >= 2) historicalBonus += 20;
                            if (analytics.totalVisits >= 5) historicalBonus += 10;
                        }
                    } catch { /* ignore */ }

                    const hoursSince = Math.max(0.1, (now - stat.lastVisit) / 3600000);
                    const recencyScore = 15 / hoursSince;
                    const durationScore = Math.min(stat.duration / 10000, 40);
                    const visitScore = Math.min(stat.visits * 5, 20);
                    const interactionScore = Math.min(stat.interactions * 2, 15);
                    const category = getCategoryForUrl(stat.url);

                    const totalScore = recencyScore + durationScore + visitScore + interactionScore + historicalBonus;

                    return {
                        ...stat,
                        score: totalScore,
                        category,
                        historicalBonus,
                        isRecurring: historicalBonus >= 20
                    };
                });

                const scoredUrls = (await Promise.all(scoredUrlsPromises))
                    .sort((a, b) => b.score - a.score);

                // 4. Smart Deduplication with Domain Variety
                const domainCounts = {};
                const allUrls = [];

                for (const stat of scoredUrls) {
                    if (allUrls.length >= 8) break;
                    try {
                        const domain = new URL(stat.url).hostname;
                        const currentCount = domainCounts[domain] || 0;
                        // Allow 2 per domain for high engagement/recurring, else 1
                        const maxAllowed = (stat.duration > 600000 || stat.isRecurring) ? 2 : 1;

                        if (currentCount < maxAllowed) {
                            // Extract meaningful context from title
                            let context = '';
                            if (stat.title && stat.title !== domain) {
                                context = stat.title
                                    .replace(/\s*[-|·–—]\s*(ChatGPT|Claude|Gemini|Google|YouTube|GitHub|Reddit|Twitter|X|LinkedIn|Facebook|Amazon|eBay|Stack Overflow).*$/i, '')
                                    .replace(/\s*[-|·–—]\s*[^-|·–—]+$/, '')
                                    .trim();
                                if (context.length > 50) {
                                    context = context.substring(0, 47) + '...';
                                }
                            }
                            allUrls.push({
                                ...stat,
                                context,
                                formattedDuration: formatDuration(stat.duration)
                            });
                            domainCounts[domain] = currentCount + 1;
                        }
                    } catch { /* ignore */ }
                }

                if (allUrls.length === 0) {
                    setLastSession(null);
                    return;
                }

                // Load workspace associations
                loadWorkspaceAssociations();

                // Detect categories
                const categoryCounts = {};
                allUrls.forEach(item => {
                    if (item.category) {
                        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
                    }
                });

                const topCategories = Object.entries(categoryCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([cat]) => cat);

                // Calculate total session stats
                const totalDuration = allUrls.reduce((sum, u) => sum + u.duration, 0);
                const noteCount = session.metadata?.noteIds?.length || 0;
                const highlightCount = session.metadata?.highlightIds?.length || 0;

                setLastSession({
                    ...session,
                    allUrls,
                    topCategories,
                    noteCount,
                    highlightCount,
                    totalDuration,
                    formattedTotalDuration: formatDuration(totalDuration),
                    timeAgo: formatTimeAgo(session.endTime),
                    sessionDuration: latestEndTime - earliestStartTime
                });

                // Try to get AI summary
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

    const visibleUrls = expanded ? lastSession.allUrls : lastSession.allUrls.slice(0, 6);
    const remainingCount = Math.max(0, lastSession.allUrls.length - 6);

    // Get primary category for theming
    const primaryCategory = lastSession.topCategories?.[0];
    const primaryConfig = primaryCategory ? CATEGORY_CONFIG[primaryCategory] : null;
    const themeColor = primaryConfig?.color || '#8B5CF6';

    return (
        <div
            className={`resume-widget ${expanded ? 'expanded' : ''}`}
            style={{ '--theme-color': themeColor }}
        >
            {/* Compact Header Row */}
            <div className="rw-header">
                <div className="rw-title-row">
                    <span className="rw-icon" style={{ background: primaryConfig?.gradient || 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}>
                        <FontAwesomeIcon icon={faBolt} />
                    </span>
                    <span className="rw-title">Resume</span>
                    <span className="rw-time">{lastSession.timeAgo}</span>
                    {lastSession.formattedTotalDuration && (
                        <span className="rw-duration">{lastSession.formattedTotalDuration}</span>
                    )}
                    {/* Inline category pills */}
                    {lastSession.topCategories?.slice(0, 2).map(cat => {
                        const config = CATEGORY_CONFIG[cat];
                        if (!config) return null;
                        return (
                            <span key={cat} className="rw-cat" style={{ color: config.color }}>
                                <FontAwesomeIcon icon={config.icon} />
                            </span>
                        );
                    })}
                </div>
                <div className="rw-actions">
                    <button className="rw-btn-continue" onClick={handleContinue}>
                        Continue
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                    <button className="rw-btn-close" onClick={handleDismiss} aria-label="Dismiss">×</button>
                </div>
            </div>

            {/* AI Summary - Compact */}
            {aiSummary && (
                <div className="rw-ai">
                    <span className="rw-ai-icon"><FontAwesomeIcon icon={faMagic} /></span>
                    <span className="rw-ai-text">{aiSummary}</span>
                </div>
            )}

            {/* Compact URL Grid */}
            <div className="rw-urls">
                {visibleUrls.map((item, index) => {
                    let domain = '';
                    try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { }
                    const catConfig = item.category ? CATEGORY_CONFIG[item.category] : null;
                    const context = item.aiDescription || item.context || null;
                    const workspaces = workspaceMap.get(item.url) || [];

                    return (
                        <div
                            key={index}
                            className="rw-url"
                            onClick={() => chrome.tabs.create({ url: item.url, active: false })}
                            title={`${domain}${context ? ` - ${context}` : ''}`}
                        >
                            <img
                                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                alt=""
                                className="rw-favicon"
                                onError={(e) => { e.target.style.opacity = '0.3'; }}
                            />
                            <div className="rw-url-info">
                                <span className="rw-domain">{domain}</span>
                                {context && <span className="rw-context">{context}</span>}
                            </div>
                            <div className="rw-url-meta">
                                {item.formattedDuration && (
                                    <span className="rw-url-time">{item.formattedDuration}</span>
                                )}
                                {catConfig && <span className="rw-url-cat"><FontAwesomeIcon icon={catConfig.icon} /></span>}
                                {item.isRecurring && <span className="rw-star"><FontAwesomeIcon icon={faStar} /></span>}
                            </div>
                            {workspaces.length > 0 && (
                                <span className="rw-ws" title={workspaces[0].name}><FontAwesomeIcon icon={faFolder} /></span>
                            )}
                        </div>
                    );
                })}

                {!expanded && remainingCount > 0 && (
                    <button className="rw-more" onClick={() => setExpanded(true)}>
                        +{remainingCount} more
                    </button>
                )}

                {expanded && lastSession.allUrls.length > 6 && (
                    <button className="rw-more" onClick={() => setExpanded(false)}>
                        Show less
                    </button>
                )}
            </div>

            <style jsx>{`
                .resume-widget {
                    --theme-color: #8B5CF6;
                    background: rgba(20, 20, 28, 0.6);
                    backdrop-filter: blur(16px);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: 14px;
                    padding: 12px 14px;
                    color: #fff;
                    margin-bottom: 20px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    transition: all 0.2s ease;
                }

                .rw-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 8px;
                }

                .rw-title-row {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-wrap: wrap;
                }

                .rw-icon {
                    width: 22px;
                    height: 22px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 13px;
                    flex-shrink: 0;
                    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
                }

                .rw-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                }

                .rw-time, .rw-duration {
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.5);
                    font-weight: 500;
                }

                .rw-cat {
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255, 255, 255, 0.05);
                    padding: 2px 6px;
                    border-radius: 4px;
                    border: 1px solid rgba(255,255,255,0.05);
                }

                .rw-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                }

                .rw-btn-continue {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 5px 12px;
                    background: #fff;
                    color: #000;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .rw-btn-continue:hover {
                    background: #f0f0f0;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.2);
                }
                
                .rw-btn-close {
                    width: 24px;
                    height: 24px;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.05);
                    color: rgba(255,255,255,0.6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 16px;
                    transition: all 0.2s;
                }
                
                .rw-btn-close:hover {
                    background: rgba(255,255,255,0.1);
                    color: #fff;
                }

                .rw-ai {
                    font-size: 12px;
                    color: rgba(255,255,255,0.7);
                    background: rgba(139, 92, 246, 0.08);
                    border: 1px dashed rgba(139, 92, 246, 0.2);
                    padding: 8px 12px;
                    border-radius: 8px;
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    line-height: 1.4;
                }

                .rw-urls {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .rw-url {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 6px 10px;
                    background: rgba(255, 255, 255, 0.02);
                    border: 1px solid rgba(255, 255, 255, 0.03);
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .rw-url:hover {
                    background: rgba(255, 255, 255, 0.06);
                    border-color: rgba(255, 255, 255, 0.08);
                    transform: translateX(2px);
                }

                .rw-favicon {
                    width: 16px;
                    height: 16px;
                    border-radius: 4px;
                }

                .rw-url-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .rw-domain {
                    font-size: 13px;
                    font-weight: 500;
                    color: #e2e8f0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .rw-context {
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.4);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .rw-url-meta {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                    font-size: 12px;
                }

                .rw-url-time {
                    color: rgba(255,255,255,0.4);
                    font-size: 11px;
                    background: rgba(255,255,255,0.05);
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .rw-url-cat {
                    font-size: 12px;
                }

                .rw-ws {
                    font-size: 12px;
                    opacity: 0.8;
                }

                .rw-star {
                    color: #FBBF24;
                    font-size: 12px;
                }

                .rw-more {
                    background: transparent;
                    border: 1px dashed rgba(255, 255, 255, 0.1);
                    color: rgba(255, 255, 255, 0.5);
                    padding: 6px;
                    border-radius: 8px;
                    font-size: 11px;
                    cursor: pointer;
                    margin-top: 2px;
                    transition: all 0.2s;
                }
                
                .rw-more:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: #fff;
                }
                
                .resume-work-widget.loading {
                    min-height: 80px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .spinner {
                    width: 20px;
                    height: 20px;
                    border: 2px solid rgba(255, 255, 255, 0.1);
                    border-top-color: var(--theme-color);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
