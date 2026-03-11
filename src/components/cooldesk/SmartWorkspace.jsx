import { faArrowRight, faChevronDown, faChevronRight, faMagicWandSparkles, faPaperPlane, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import scrapperConfig from '../../data/scrapper.json';
import { getTimeSeriesDataRange, listScrapedChats, listWorkspaces } from '../../db/index.js';
import * as LocalAI from '../../services/localAIService.js';
import { NanoAIService } from '../../services/nanoAIService.js';
import { defaultFontFamily } from '../../utils/fontUtils';
import { getBaseDomainFromUrl, getFaviconUrl, safeGetHostname } from '../../utils/helpers.js';

/**
 * SmartWorkspace — AI-driven unified workspace
 *
 * Loads ALL data sources:
 *  - Scraped AI chats (listScrapedChats)
 *  - Browser history (chrome.history)
 *  - Existing workspaces (listWorkspaces)
 *  - App activity (getTimeSeriesDataRange)
 *
 * Groups everything by project using AI or keyword matching.
 */

// Platform styles from scrapper.json
const PLATFORM_STYLES = scrapperConfig.platforms.reduce((acc, platform) => {
    acc[platform.name] = {
        color: platform.color,
        borderColor: platform.borderColor,
        textColor: platform.textColor,
        hoverBg: platform.hoverBg,
        hoverBorder: platform.hoverBorder
    };
    return acc;
}, {});

const DEFAULT_PLATFORM_STYLE = scrapperConfig.defaultStyle;

// Source type icons
const SOURCE_ICONS = {
    chat: '💬',
    history: '🌐',
    workspace: '📁',
    app: '💻',
};

/**
 * SmartWorkspace Props:
 * @param {number} maxItems - Max items to display per group
 * @param {Array} externalContext - Additional context to pass to AI (e.g., current workspace URLs, GitHub repos)
 * @param {string} contextType - Type of context: 'workspace' | 'github' | 'general'
 * @param {Function} onSuggestion - Callback when AI suggests an action (e.g., add URL to workspace)
 */
const SmartWorkspace = memo(function SmartWorkspace({
    maxItems = 30,
    externalContext = [],
    contextType = 'general',
    onSuggestion = null
}) {
    const [allItems, setAllItems] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [grouping, setGrouping] = useState(false);
    const [promptText, setPromptText] = useState('');
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [activePlatformFilter, setActivePlatformFilter] = useState(null);
    const [aiAvailable, setAiAvailable] = useState(false);
    const [error, setError] = useState(null);
    const [aiSuggestions, setAiSuggestions] = useState([]); // AI-generated suggestions

    // Check if AI is available (prefer LocalAI over NanoAI)
    const [aiProvider, setAiProvider] = useState('none'); // 'local' | 'nano' | 'none'

    useEffect(() => {
        const checkAI = async () => {
            // First try LocalAI (more powerful, runs on desktop)
            try {
                const localAvailable = await LocalAI.isAvailable();
                if (localAvailable) {
                    setAiAvailable(true);
                    setAiProvider('local');
                    return;
                }
            } catch (e) {
                console.log('[SmartWorkspace] LocalAI not available:', e.message);
            }

            // Fallback to NanoAI (Chrome built-in)
            try {
                await NanoAIService.init();
                if (NanoAIService.isAvailable()) {
                    setAiAvailable(true);
                    setAiProvider('nano');
                    return;
                }
            } catch (e) {
                console.log('[SmartWorkspace] NanoAI not available:', e.message);
            }

            setAiAvailable(false);
            setAiProvider('none');
        };
        checkAI();
    }, []);

    // ─── Data Loading ──────────────────────────────────────────

    const loadAllData = useCallback(async () => {
        setLoading(true);
        setError(null);
        const items = [];

        // 1. Scraped AI Chats
        try {
            const response = await listScrapedChats({ limit: 200, sortBy: 'scrapedAt', sortOrder: 'desc' });
            const chats = response?.data || response || [];
            (Array.isArray(chats) ? chats : []).forEach(chat => {
                items.push({
                    id: `chat_${chat.chatId || chat.id}`,
                    title: chat.title || 'Untitled Chat',
                    url: chat.url,
                    domain: getBaseDomainFromUrl(chat.url || ''),
                    source: 'chat',
                    platform: chat.platform,
                    timestamp: chat.scrapedAt || chat.lastVisitTime || Date.now(),
                });
            });
        } catch (e) {
            console.warn('[SmartWorkspace] Failed to load chats:', e);
        }

        // 2. Browser History (last 30 days)
        try {
            if (typeof chrome !== 'undefined' && chrome.history?.search) {
                const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                const historyItems = await chrome.history.search({
                    text: '',
                    maxResults: 500,
                    startTime: thirtyDaysAgo,
                });
                historyItems
                    .filter(h => h.url && !h.url.startsWith('chrome://') && !h.url.startsWith('chrome-extension://'))
                    .forEach(h => {
                        items.push({
                            id: `hist_${h.id}`,
                            title: h.title || safeGetHostname(h.url),
                            url: h.url,
                            domain: getBaseDomainFromUrl(h.url),
                            source: 'history',
                            visitCount: h.visitCount || 1,
                            timestamp: h.lastVisitTime || Date.now(),
                        });
                    });
            }
        } catch (e) {
            console.warn('[SmartWorkspace] Failed to load history:', e);
        }

        // 3. Existing Workspaces
        try {
            const workspaces = await listWorkspaces();
            (workspaces || []).forEach(ws => {
                (ws.urls || []).forEach(u => {
                    items.push({
                        id: `ws_${ws.id}_${u.url}`,
                        title: u.title || safeGetHostname(u.url),
                        url: u.url,
                        domain: getBaseDomainFromUrl(u.url || ''),
                        source: 'workspace',
                        workspaceName: ws.name,
                        timestamp: u.addedAt || ws.createdAt || Date.now(),
                    });
                });
            });
        } catch (e) {
            console.warn('[SmartWorkspace] Failed to load workspaces:', e);
        }

        // 4. App Activity (last 7 days)
        try {
            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const activities = await getTimeSeriesDataRange(sevenDaysAgo, Date.now());
            (activities || []).filter(a => a.type === 'app').slice(0, 100).forEach(a => {
                items.push({
                    id: `app_${a.id}`,
                    title: a.title || a.appName || 'Unknown App',
                    url: a.url || '#',
                    domain: a.appName || getBaseDomainFromUrl(a.url || ''),
                    source: 'app',
                    appName: a.appName,
                    duration: a.time || 0,
                    timestamp: a.timestamp || Date.now(),
                });
            });
        } catch (e) {
            console.warn('[SmartWorkspace] Failed to load activity:', e);
        }

        return items;
    }, []);

    // ─── Normalization (dedup by domain, merge stats) ──────────

    const normalizeItems = useCallback((items) => {
        const domainMap = new Map();

        items.forEach(item => {
            const key = item.domain || 'unknown';
            if (!domainMap.has(key)) {
                domainMap.set(key, {
                    domain: key,
                    title: item.title,
                    url: item.url,
                    sources: new Set(),
                    platforms: new Set(),
                    visitCount: 0,
                    totalDuration: 0,
                    latestTimestamp: 0,
                    items: [],
                });
            }
            const entry = domainMap.get(key);
            entry.sources.add(item.source);
            if (item.platform) entry.platforms.add(item.platform);
            entry.visitCount += item.visitCount || 1;
            entry.totalDuration += item.duration || 0;
            entry.latestTimestamp = Math.max(entry.latestTimestamp, item.timestamp || 0);
            entry.items.push(item);

            // Use the best title (prefer chat titles > workspace titles > history)
            if (item.source === 'chat' && item.title && item.title !== 'Untitled Chat') {
                entry.title = item.title;
            }
        });

        return Array.from(domainMap.values())
            .sort((a, b) => b.latestTimestamp - a.latestTimestamp);
    }, []);

    // ─── Keyword-based Grouping (browser fallback) ─────────────

    const groupByKeywords = useCallback((normalizedItems) => {
        const groups = new Map();
        const assigned = new Set();

        // Pass 1: Group chats by shared keywords in titles
        const chatItems = normalizedItems.filter(item =>
            item.items.some(i => i.source === 'chat')
        );

        // Extract keywords from chat titles (2+ word tokens, ignore common words)
        const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'in', 'to', 'for', 'of', 'and', 'or', 'new', 'with', 'from', 'how', 'what', 'why', 'this', 'that', 'conversation', 'untitled', 'chat']);
        const keywordToItems = new Map();

        chatItems.forEach(item => {
            item.items.filter(i => i.source === 'chat').forEach(chatItem => {
                const words = (chatItem.title || '').toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

                words.forEach(word => {
                    if (!keywordToItems.has(word)) keywordToItems.set(word, new Set());
                    keywordToItems.get(word).add(item.domain);
                });
            });
        });

        // Find keywords that appear in 2+ items → create groups
        keywordToItems.forEach((domains, keyword) => {
            if (domains.size >= 2) {
                const groupKey = keyword.charAt(0).toUpperCase() + keyword.slice(1);
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, {
                        name: groupKey,
                        items: [],
                        isAI: false,
                    });
                }
                domains.forEach(domain => {
                    const item = normalizedItems.find(n => n.domain === domain);
                    if (item && !assigned.has(domain)) {
                        groups.get(groupKey).items.push(item);
                        assigned.add(domain);
                    }
                });
            }
        });

        // Pass 2: Group by platform for remaining chat items
        chatItems.forEach(item => {
            if (assigned.has(item.domain)) return;
            const platform = Array.from(item.platforms)[0] || 'Other';
            const groupKey = `${platform} Chats`;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, { name: groupKey, items: [], isAI: false });
            }
            groups.get(groupKey).items.push(item);
            assigned.add(item.domain);
        });

        // Pass 3: Group remaining (non-chat) items by domain category
        const domainCategories = {
            'Development': ['github.com', 'gitlab.com', 'stackoverflow.com', 'npmjs.com', 'codepen.io', 'vercel.com', 'netlify.com', 'replit.com'],
            'Google Services': ['google.com', 'gmail.com', 'docs.google.com', 'drive.google.com', 'calendar.google.com', 'meet.google.com'],
            'Social Media': ['twitter.com', 'x.com', 'reddit.com', 'linkedin.com', 'instagram.com', 'facebook.com', 'discord.com'],
            'Design': ['figma.com', 'canva.com', 'dribbble.com', 'behance.net', 'unsplash.com', 'freepik.com'],
            'Productivity': ['notion.so', 'linear.app', 'slack.com', 'trello.com', 'asana.com'],
        };

        normalizedItems.forEach(item => {
            if (assigned.has(item.domain)) return;

            let placed = false;
            for (const [category, domains] of Object.entries(domainCategories)) {
                if (domains.some(d => item.domain.includes(d) || d.includes(item.domain))) {
                    if (!groups.has(category)) {
                        groups.set(category, { name: category, items: [], isAI: false });
                    }
                    groups.get(category).items.push(item);
                    assigned.add(item.domain);
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                if (!groups.has('Other')) {
                    groups.set('Other', { name: 'Other', items: [], isAI: false });
                }
                groups.get('Other').items.push(item);
                assigned.add(item.domain);
            }
        });

        // Sort groups by item count (largest first), "Other" always last
        return Array.from(groups.values())
            .filter(g => g.items.length > 0)
            .sort((a, b) => {
                if (a.name === 'Other') return 1;
                if (b.name === 'Other') return -1;
                return b.items.length - a.items.length;
            });
    }, []);

    // ─── Build External Context String ────────────────────────

    const buildContextString = useCallback(() => {
        if (!externalContext || externalContext.length === 0) return '';

        let contextStr = '\n\n=== CURRENT CONTEXT ===\n';

        if (contextType === 'workspace') {
            contextStr += 'User is viewing a workspace with these URLs:\n';
            externalContext.slice(0, 20).forEach((item, i) => {
                const title = item.title || item.name || safeGetHostname(item.url);
                contextStr += `- ${title} [${item.url}]\n`;
            });
        } else if (contextType === 'github') {
            contextStr += 'User has these GitHub repositories/activity:\n';
            externalContext.slice(0, 15).forEach((item, i) => {
                contextStr += `- ${item.name || item.title}: ${item.description || item.url || ''}\n`;
            });
        } else {
            contextStr += 'Additional context:\n';
            externalContext.slice(0, 15).forEach((item, i) => {
                const label = item.title || item.name || item.url || JSON.stringify(item);
                contextStr += `- ${label}\n`;
            });
        }

        return contextStr;
    }, [externalContext, contextType]);

    // ─── AI Grouping ───────────────────────────────────────────

    const groupByAI = useCallback(async (normalizedItems, customPrompt = '') => {
        if (!aiAvailable || aiProvider === 'none') {
            return groupByKeywords(normalizedItems);
        }

        setGrouping(true);
        try {
            // Build context: top 50 items by recency for the AI
            const topItems = normalizedItems.slice(0, 50).map((item, i) => {
                const sources = Array.from(item.sources).join('+');
                const extra = item.visitCount > 1 ? ` (${item.visitCount} visits)` : '';
                return `${i + 1}. "${item.title}" [${item.domain}] (${sources})${extra}`;
            });

            // Include external context if provided
            const externalContextStr = buildContextString();
            const itemsStr = topItems.join('\n');

            let result;

            // Use LocalAI if available (dedicated backend endpoint)
            if (aiProvider === 'local') {
                try {
                    const parsed = await LocalAI.groupWorkspaces(itemsStr, externalContextStr, customPrompt || null);

                    // LocalAI.groupWorkspaces already parses JSON
                    if (parsed?.groups && Array.isArray(parsed.groups)) {
                        // Extract suggestions
                        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
                            setAiSuggestions(parsed.suggestions.slice(0, 5));
                        }

                        // Map group indices to actual items
                        const assigned = new Set();
                        const aiGroups = parsed.groups
                            .map(g => {
                                const groupItems = (g.items || [])
                                    .filter(idx => idx >= 1 && idx <= normalizedItems.length)
                                    .map(idx => normalizedItems[idx - 1])
                                    .filter(item => item && !assigned.has(item.domain));
                                groupItems.forEach(item => assigned.add(item.domain));
                                return { name: g.name || 'Unnamed Group', items: groupItems, isAI: true };
                            })
                            .filter(g => g.items.length > 0);

                        // Add unassigned to "Other"
                        const unassigned = normalizedItems.filter(item => !assigned.has(item.domain));
                        if (unassigned.length > 0) {
                            aiGroups.push({ name: 'Other', items: unassigned, isAI: false });
                        }

                        return aiGroups;
                    }
                } catch (e) {
                    console.warn('[SmartWorkspace] LocalAI grouping failed, trying NanoAI:', e);
                }
            }

            // Fallback to NanoAI (browser-based)
            const instruction = customPrompt
                ? `${customPrompt}${externalContextStr}\n\nHere are the user's browsing items:\n${itemsStr}`
                : `You are organizing a user's browsing activity into smart workspace groups.
${externalContextStr}

Group these browsing items into 4-8 project/topic categories based on their relevance.
If external context is provided, prioritize grouping items that relate to that context.
Return ONLY a JSON object.

Items:
${itemsStr}

Return format: {"groups":[{"name":"Group Name","items":[1,2,3]}],"suggestions":["suggestion1","suggestion2"]}`;

            result = await NanoAIService.prompt(instruction, 45000);

            // Parse AI response — extract JSON
            let parsed;
            try {
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            } catch {
                console.warn('[SmartWorkspace] AI returned non-JSON, falling back to keywords');
                return groupByKeywords(normalizedItems);
            }

            if (!parsed?.groups || !Array.isArray(parsed.groups)) {
                return groupByKeywords(normalizedItems);
            }

            // Extract AI suggestions if present
            if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
                setAiSuggestions(parsed.suggestions.slice(0, 5));
            }

            // Map AI group indices back to real items
            const assigned = new Set();
            const aiGroups = parsed.groups
                .map(g => {
                    const groupItems = (g.items || [])
                        .filter(idx => idx >= 1 && idx <= normalizedItems.length)
                        .map(idx => normalizedItems[idx - 1])
                        .filter(item => item && !assigned.has(item.domain));

                    groupItems.forEach(item => assigned.add(item.domain));

                    return {
                        name: g.name || 'Unnamed Group',
                        items: groupItems,
                        isAI: true,
                    };
                })
                .filter(g => g.items.length > 0);

            // Put unassigned items into "Other"
            const unassigned = normalizedItems.filter(item => !assigned.has(item.domain));
            if (unassigned.length > 0) {
                aiGroups.push({
                    name: 'Other',
                    items: unassigned,
                    isAI: false,
                });
            }

            return aiGroups;
        } catch (e) {
            console.error('[SmartWorkspace] AI grouping failed:', e);
            return groupByKeywords(normalizedItems);
        } finally {
            setGrouping(false);
        }
    }, [groupByKeywords, buildContextString, aiAvailable, aiProvider]);

    // ─── Initial Load ──────────────────────────────────────────

    useEffect(() => {
        (async () => {
            const items = await loadAllData();
            setAllItems(items);

            const normalized = normalizeItems(items);
            const grouped = await groupByAI(normalized);
            setGroups(grouped);

            // Auto-expand the first 3 groups
            setExpandedGroups(new Set(grouped.slice(0, 3).map(g => g.name)));
            setLoading(false);
        })();
    }, [loadAllData, normalizeItems, groupByAI]);

    // ─── Handle AI Prompt ──────────────────────────────────────

    const handlePromptSubmit = useCallback(async () => {
        if (!promptText.trim()) return;

        const normalized = normalizeItems(allItems);
        const grouped = await groupByAI(normalized, promptText.trim());
        setGroups(grouped);
        setExpandedGroups(new Set(grouped.slice(0, 5).map(g => g.name)));
        setPromptText('');
    }, [promptText, allItems, normalizeItems, groupByAI]);

    // ─── Quick Access pills ────────────────────────────────────

    const quickAccessPills = useMemo(() => {
        const platformMap = new Map();

        allItems.forEach(item => {
            if (item.source === 'chat' && item.platform) {
                if (!platformMap.has(item.platform)) {
                    platformMap.set(item.platform, { name: item.platform, count: 0, url: item.url, type: 'platform' });
                }
                platformMap.get(item.platform).count++;
            }
        });

        // Add app usage pills
        const appMap = new Map();
        allItems.filter(i => i.source === 'app' && i.appName).forEach(item => {
            if (!appMap.has(item.appName)) {
                appMap.set(item.appName, { name: item.appName, totalDuration: 0, type: 'app' });
            }
            appMap.get(item.appName).totalDuration += item.duration || 0;
        });

        const pills = [
            ...Array.from(platformMap.values())
                .sort((a, b) => b.count - a.count)
                .map(p => ({ ...p, label: `${p.count}` })),
            ...Array.from(appMap.values())
                .filter(a => a.totalDuration > 60) // Only show apps used > 1 min
                .sort((a, b) => b.totalDuration - a.totalDuration)
                .slice(0, 5)
                .map(a => ({
                    ...a,
                    label: a.totalDuration > 3600
                        ? `${Math.round(a.totalDuration / 3600)}h`
                        : `${Math.round(a.totalDuration / 60)}m`,
                })),
        ];

        return pills;
    }, [allItems]);

    // ─── Helpers ───────────────────────────────────────────────

    const toggleGroup = useCallback((name) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    }, []);

    const handleItemClick = useCallback((url) => {
        if (url && url !== '#') window.open(url, '_blank');
    }, []);

    const formatTime = useCallback((timestamp) => {
        if (!timestamp) return '';
        const diffMs = Date.now() - timestamp;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }, []);

    // ─── Render ────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="cooldesk-panel" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: '#64748B' }}>
                    <FontAwesomeIcon icon={faSync} spin style={{ fontSize: '20px', marginBottom: '10px' }} />
                    <div style={{ fontSize: '14px' }}>Loading all data sources...</div>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: '12px',
            overflow: 'hidden',
        }}>
            {/* AI Prompt Input */}
            <div className="cooldesk-panel" style={{
                flexShrink: 0,
                padding: '0',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 16px',
                    background: aiAvailable
                        ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)'
                        : 'rgba(30, 41, 59, 0.5)',
                    borderRadius: '12px',
                    border: aiAvailable
                        ? '1px solid rgba(139, 92, 246, 0.2)'
                        : '1px solid rgba(148, 163, 184, 0.1)',
                }}>
                    <FontAwesomeIcon
                        icon={faMagicWandSparkles}
                        style={{
                            color: aiAvailable ? '#A78BFA' : '#64748B',
                            fontSize: '16px',
                            flexShrink: 0,
                        }}
                    />
                    <input
                        type="text"
                        placeholder={aiAvailable
                            ? 'Ask AI to organize... e.g. "Group by project"'
                            : 'AI not available — using keyword grouping'}
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && promptText.trim()) handlePromptSubmit();
                        }}
                        disabled={grouping}
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            color: '#F1F5F9',
                            fontSize: '13px',
                            fontFamily: defaultFontFamily,
                            outline: 'none',
                            padding: '4px 0',
                        }}
                    />
                    {promptText.trim() && (
                        <button
                            onClick={handlePromptSubmit}
                            disabled={grouping}
                            style={{
                                background: 'rgba(139, 92, 246, 0.3)',
                                border: '1px solid rgba(139, 92, 246, 0.5)',
                                borderRadius: '8px',
                                padding: '6px 12px',
                                color: '#A78BFA',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                flexShrink: 0,
                            }}
                        >
                            <FontAwesomeIcon icon={grouping ? faSync : faPaperPlane} spin={grouping} />
                        </button>
                    )}
                </div>
            </div>

            {/* AI Suggestions Panel */}
            {aiSuggestions.length > 0 && (
                <div className="cooldesk-panel" style={{
                    flexShrink: 0,
                    padding: '12px 16px',
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    borderRadius: '12px',
                }}>
                    <div style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: '#34D399',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                    }}>
                        <FontAwesomeIcon icon={faMagicWandSparkles} />
                        AI Suggestions
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {aiSuggestions.map((suggestion, idx) => (
                            <div
                                key={idx}
                                onClick={() => onSuggestion?.(suggestion)}
                                style={{
                                    padding: '8px 12px',
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    color: '#E2E8F0',
                                    cursor: onSuggestion ? 'pointer' : 'default',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => {
                                    if (onSuggestion) {
                                        e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                                        e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                                    }
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                                }}
                            >
                                💡 {suggestion}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Grouped Items Panel */}
            <div className="cooldesk-panel" style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div className="panel-header">
                    <h3 style={{
                        fontSize: '16px',
                        fontWeight: 600,
                        color: 'var(--text-secondary, #94A3B8)',
                        fontFamily: defaultFontFamily,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: 0,
                    }}>
                        Smart Workspaces
                        {grouping && <FontAwesomeIcon icon={faSync} spin style={{ fontSize: '12px', color: '#A78BFA' }} />}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#64748B' }}>
                        {allItems.length} items • {groups.length} groups
                    </div>
                </div>

                {/* Groups List */}
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 0 8px 0' }}>
                    {groups.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px 16px', color: '#64748B' }}>
                            <div style={{ fontSize: '28px', marginBottom: '10px' }}>📊</div>
                            <div>No data to group yet</div>
                            <div style={{ fontSize: '12px', marginTop: '6px', opacity: 0.7 }}>
                                Browse some sites or chat with AI platforms
                            </div>
                        </div>
                    ) : (
                        groups.map((group) => {
                            const isExpanded = expandedGroups.has(group.name);
                            const displayItems = isExpanded ? group.items.slice(0, maxItems) : [];

                            return (
                                <div key={group.name} style={{ marginBottom: '4px' }}>
                                    {/* Group Header */}
                                    <div
                                        onClick={() => toggleGroup(group.name)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '10px 16px',
                                            cursor: 'pointer',
                                            transition: 'background 0.15s',
                                            borderRadius: '8px',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <FontAwesomeIcon
                                            icon={isExpanded ? faChevronDown : faChevronRight}
                                            style={{ color: '#64748B', fontSize: '10px', width: '12px' }}
                                        />
                                        <span style={{
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#E2E8F0',
                                            fontFamily: defaultFontFamily,
                                            flex: 1,
                                        }}>
                                            {group.name}
                                        </span>
                                        {group.isAI && (
                                            <span style={{
                                                fontSize: '9px',
                                                background: 'rgba(139, 92, 246, 0.15)',
                                                color: '#A78BFA',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontWeight: 600,
                                            }}>AI</span>
                                        )}
                                        <span style={{
                                            fontSize: '11px',
                                            color: '#64748B',
                                            background: 'rgba(100, 116, 139, 0.15)',
                                            padding: '2px 8px',
                                            borderRadius: '10px',
                                            fontWeight: 600,
                                        }}>
                                            {group.items.length}
                                        </span>
                                    </div>

                                    {/* Expanded Items */}
                                    {isExpanded && (
                                        <div style={{ paddingLeft: '20px' }}>
                                            {displayItems.map((item, idx) => {
                                                const faviconUrl = item.url && item.url !== '#'
                                                    ? getFaviconUrl(item.url, 20)
                                                    : null;

                                                // Pick the "best" single item to represent this domain
                                                const bestItem = item.items.find(i => i.source === 'chat')
                                                    || item.items.find(i => i.source === 'workspace')
                                                    || item.items[0];

                                                const sourceLabels = Array.from(item.sources);
                                                const platformName = Array.from(item.platforms)[0];

                                                return (
                                                    <div
                                                        key={item.domain + idx}
                                                        onClick={() => handleItemClick(bestItem?.url || item.url)}
                                                        className="recent-chat-item cooldesk-flex"
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            padding: '8px 12px',
                                                            cursor: 'pointer',
                                                            borderRadius: '8px',
                                                            transition: 'background 0.15s',
                                                        }}
                                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                    >
                                                        {/* Favicon */}
                                                        <div style={{
                                                            width: '28px',
                                                            height: '28px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            background: 'rgba(59, 130, 246, 0.1)',
                                                            borderRadius: '6px',
                                                            flexShrink: 0,
                                                        }}>
                                                            {faviconUrl ? (
                                                                <img
                                                                    src={faviconUrl}
                                                                    alt=""
                                                                    style={{ width: '18px', height: '18px', borderRadius: '3px', objectFit: 'contain' }}
                                                                    onError={(e) => {
                                                                        e.target.style.display = 'none';
                                                                        e.target.parentElement.textContent = SOURCE_ICONS[bestItem?.source] || '🌐';
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span style={{ fontSize: '14px' }}>{SOURCE_ICONS[bestItem?.source] || '🌐'}</span>
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{
                                                                fontSize: '12px',
                                                                fontWeight: 500,
                                                                color: '#E2E8F0',
                                                                fontFamily: defaultFontFamily,
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                            }}>
                                                                {item.title || item.domain}
                                                            </div>
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                                marginTop: '2px',
                                                            }}>
                                                                {/* Source badges */}
                                                                {sourceLabels.map(source => (
                                                                    <span key={source} style={{
                                                                        fontSize: '9px',
                                                                        padding: '1px 5px',
                                                                        borderRadius: '3px',
                                                                        fontWeight: 500,
                                                                        background: source === 'chat'
                                                                            ? 'rgba(139, 92, 246, 0.15)'
                                                                            : source === 'app'
                                                                                ? 'rgba(16, 185, 129, 0.15)'
                                                                                : 'rgba(100, 116, 139, 0.15)',
                                                                        color: source === 'chat'
                                                                            ? '#A78BFA'
                                                                            : source === 'app'
                                                                                ? '#34D399'
                                                                                : '#94A3B8',
                                                                    }}>
                                                                        {source}
                                                                    </span>
                                                                ))}
                                                                {/* Platform badge */}
                                                                {platformName && (
                                                                    <span style={{
                                                                        fontSize: '9px',
                                                                        background: (PLATFORM_STYLES[platformName]?.color || 'rgba(100, 116, 139, 0.15)'),
                                                                        color: (PLATFORM_STYLES[platformName]?.textColor || '#94A3B8'),
                                                                        padding: '1px 5px',
                                                                        borderRadius: '3px',
                                                                        fontWeight: 500,
                                                                    }}>{platformName}</span>
                                                                )}
                                                                {/* Visit count */}
                                                                {item.visitCount > 1 && (
                                                                    <span style={{ fontSize: '9px', color: '#64748B' }}>
                                                                        {item.visitCount}x
                                                                    </span>
                                                                )}
                                                                {/* Duration */}
                                                                {item.totalDuration > 60 && (
                                                                    <span style={{ fontSize: '9px', color: '#64748B' }}>
                                                                        {item.totalDuration > 3600
                                                                            ? `${Math.round(item.totalDuration / 3600)}h`
                                                                            : `${Math.round(item.totalDuration / 60)}m`}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Arrow */}
                                                        <FontAwesomeIcon
                                                            icon={faArrowRight}
                                                            className="chat-arrow"
                                                            style={{
                                                                color: '#64748B',
                                                                fontSize: '11px',
                                                                opacity: 0,
                                                                transition: 'opacity 0.2s',
                                                                flexShrink: 0,
                                                            }}
                                                        />
                                                    </div>
                                                );
                                            })}

                                            {group.items.length > maxItems && (
                                                <div style={{
                                                    padding: '6px 12px',
                                                    fontSize: '11px',
                                                    color: '#64748B',
                                                    fontStyle: 'italic',
                                                }}>
                                                    +{group.items.length - maxItems} more items
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Quick Access Pills */}
            {quickAccessPills.length > 0 && (
                <div className="cooldesk-panel" style={{
                    flexShrink: 0,
                    padding: '12px 16px',
                }}>
                    <div style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: '#64748B',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        marginBottom: '10px',
                    }}>Quick Access</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {quickAccessPills.map((pill) => {
                            const style = PLATFORM_STYLES[pill.name] || DEFAULT_PLATFORM_STYLE;
                            const faviconUrl = pill.url ? getFaviconUrl(pill.url, 14) : null;

                            return (
                                <button
                                    key={pill.name}
                                    onClick={() => {
                                        if (pill.url) window.open(pill.url, '_blank');
                                    }}
                                    style={{
                                        background: style.color || 'rgba(100, 116, 139, 0.15)',
                                        border: `1px solid ${style.borderColor || 'rgba(100, 116, 139, 0.3)'}`,
                                        borderRadius: '6px',
                                        padding: '5px 10px',
                                        color: style.textColor || '#94A3B8',
                                        fontSize: '11px',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = style.hoverBg || 'rgba(100, 116, 139, 0.25)';
                                        e.currentTarget.style.borderColor = style.hoverBorder || 'rgba(100, 116, 139, 0.5)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = style.color || 'rgba(100, 116, 139, 0.15)';
                                        e.currentTarget.style.borderColor = style.borderColor || 'rgba(100, 116, 139, 0.3)';
                                    }}
                                >
                                    {faviconUrl && (
                                        <img
                                            src={faviconUrl}
                                            alt=""
                                            style={{ width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0 }}
                                            onError={(e) => e.target.style.display = 'none'}
                                        />
                                    )}
                                    {pill.type === 'app' && <span style={{ fontSize: '10px' }}>💻</span>}
                                    {pill.name}
                                    <span style={{
                                        background: 'rgba(0,0,0,0.2)',
                                        borderRadius: '10px',
                                        padding: '1px 5px',
                                        fontSize: '9px',
                                        fontWeight: 600,
                                    }}>
                                        {pill.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <style>{`
        .recent-chat-item:hover .chat-arrow {
          opacity: 1 !important;
        }
      `}</style>
        </div>
    );
});

export { SmartWorkspace };
