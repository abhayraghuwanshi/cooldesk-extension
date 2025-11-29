import { EyeOff, Globe, History, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// --- MOCK SERVICES & UTILS (Replaces missing local files) ---

const getFaviconUrl = (url, size = 64) => {
    try {
        const hostname = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`;
    } catch (e) {
        return '';
    }
};

// Mock Data Generator for "Expected Visits" demo
const generateMockActivity = () => {
    const now = Date.now();
    const sites = [
        { url: 'https://github.com', title: 'GitHub', baseScore: 0.9 },
        { url: 'https://stackoverflow.com', title: 'Stack Overflow', baseScore: 0.85 },
        { url: 'https://youtube.com', title: 'YouTube', baseScore: 0.7 },
        { url: 'https://gmail.com', title: 'Inbox (2) - Gmail', baseScore: 0.95 },
        { url: 'https://reddit.com', title: 'Reddit', baseScore: 0.6 },
        { url: 'https://figma.com', title: 'Figma', baseScore: 0.8 },
        { url: 'https://notion.so', title: 'Notion', baseScore: 0.88 },
        { url: 'https://chatgpt.com', title: 'ChatGPT', baseScore: 0.92 },
    ];

    return sites.map((site, i) => ({
        url: site.url,
        title: site.title,
        time: 3600000 * site.baseScore, // Simulated duration
        clicks: Math.floor(50 * site.baseScore),
        forms: i % 3 === 0 ? 5 : 0,
        scroll: 1000,
        lastVisitTime: now - (Math.random() * (i < 3 ? 3600000 : 86400000)), // Top 3 are recent
    }));
};

const mockService = {
    getActivityData: async () => {
        // Simulate network delay
        await new Promise(r => setTimeout(r, 800));
        return generateMockActivity();
    },
    getUIState: async () => {
        try {
            const stored = localStorage.getItem('mock_ui_state');
            return stored ? JSON.parse(stored) : { hiddenActivityUrls: [] };
        } catch { return { hiddenActivityUrls: [] }; }
    },
    saveUIState: async (state) => {
        try {
            localStorage.setItem('mock_ui_state', JSON.stringify(state));
        } catch { }
    }
};

// --- COMPONENT IMPLEMENTATION ---

// Styling Constants
const CARD_STYLE = {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    position: 'relative',
    overflow: 'hidden',
    minWidth: '200px',
    flex: '1 1 200px',
    maxWidth: '300px'
};

const SECTION_TITLE_STYLE = {
    fontSize: '13px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: '24px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
};

export default function CoolFeedSection({ tabs = [], maxItems = 15 }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hiddenUrls, setHiddenUrls] = useState(() => new Set());
    const uiStateRef = useRef(null);
    const [ctxMenu, setCtxMenu] = useState({ show: false, x: 0, y: 0, url: null });

    // --- Data Loading ---
    const loadActivity = useCallback(async () => {
        try {
            if (!rows.length) setLoading(true);

            // Use mock service instead of local files
            const rawData = await mockService.getActivityData();

            const norm = rawData.map(r => ({
                url: r.url,
                title: r.title || null,
                time: Number(r.time) || 0,
                lastVisit: Number(r.lastVisitTime) || Date.now(),
                clicks: Number(r.clicks) || 0,
                forms: Number(r.forms) || 0,
            }));

            setRows(norm);
        } catch (e) {
            console.warn('Activity Load Failed', e);
        } finally {
            setLoading(false);
        }
    }, [rows.length]);

    useEffect(() => {
        let disposed = false;
        loadActivity();
        // Simulate live updates
        const id = setInterval(loadActivity, 60000);
        return () => { disposed = true; clearInterval(id); };
    }, [loadActivity]);

    // --- Hidden URL Management ---
    useEffect(() => {
        (async () => {
            try {
                const ui = await mockService.getUIState();
                uiStateRef.current = ui || {};
                if (ui?.hiddenActivityUrls) setHiddenUrls(new Set(ui.hiddenActivityUrls));
            } catch (e) { }
        })();
    }, []);

    const hideUrl = useCallback((url) => {
        setHiddenUrls(prev => {
            const next = new Set(prev);
            next.add(url);
            const base = uiStateRef.current || {};
            mockService.saveUIState({ ...base, hiddenActivityUrls: Array.from(next) });
            return next;
        });
        setCtxMenu(c => ({ ...c, show: false }));
    }, []);

    // --- Context Menu Handlers ---
    useEffect(() => {
        if (!ctxMenu.show) return;
        const close = () => setCtxMenu(c => ({ ...c, show: false }));
        document.addEventListener('click', close);
        document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
        return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
    }, [ctxMenu.show]);

    const openOrFocusUrl = useCallback((url) => {
        if (!url) return;
        try {
            window.open(url, '_blank');
        } catch (e) {
            console.error("Open failed", e);
        }
    }, []);

    // --- INTELLIGENT SCORING ALGORITHM ---
    const processedFeed = useMemo(() => {
        const now = Date.now();

        // 1. Helper: Extract Hostname
        const getHost = (u) => { try { return new URL(u).hostname.replace('www.', ''); } catch { return u; } };

        // 2. Helper: Find Title
        const findTitle = (url, storedTitle) => {
            const tabMatch = tabs?.find(t => t.url === url);
            return tabMatch?.title || storedTitle || getHost(url);
        };

        // 3. Scoring
        const scored = rows
            .filter(r => !hiddenUrls.has(r.url))
            .map(r => {
                // Base Metrics
                const engagementScore = (r.time / 3600000) * 0.4 + (r.clicks / 20) * 0.3 + (r.forms / 2) * 0.3;

                // Recency Decay
                const hoursSince = Math.max(0, (now - r.lastVisit) / 3600000);
                const recencyFactor = 1 / (1 + (hoursSince * 0.1));

                // Context Boost: High engagement + visited recently (simulating daily habit)
                const isHabitual = engagementScore > 0.5;
                const timeContextBonus = isHabitual && (hoursSince < 24 && hoursSince > 20) ? 0.3 : 0;

                const totalScore = (engagementScore * 0.6) + (recencyFactor * 0.4) + timeContextBonus;

                return {
                    ...r,
                    host: getHost(r.url),
                    displayTitle: findTitle(r.url, r.title),
                    totalScore,
                    isRecent: hoursSince < 12, // Visited in last 12 hours
                    isActive: tabs?.some(t => t.url === r.url) // Is currently open
                };
            });

        // 4. Grouping & Deduplication
        const seenHosts = new Set();
        const feed = {
            jumpBackIn: [], // High recency, active context
            dailyTop: [],   // High score, general
            rediscover: []  // High score, low recency
        };

        // Sort by score first
        scored.sort((a, b) => b.totalScore - a.totalScore);

        scored.forEach(item => {
            if (seenHosts.has(item.host)) {
                if (item.totalScore < 0.8) return;
            }
            seenHosts.add(item.host);

            if (item.isActive || (item.isRecent && item.totalScore > 0.1)) {
                feed.jumpBackIn.push(item);
            } else if (item.totalScore > 0.4) {
                feed.dailyTop.push(item);
            } else {
                feed.rediscover.push(item);
            }
        });

        return {
            jumpBackIn: feed.jumpBackIn.slice(0, 4),
            dailyTop: feed.dailyTop.slice(0, 8),
            all: scored.slice(0, maxItems) // Fallback
        };

    }, [rows, hiddenUrls, tabs, maxItems]);


    // --- Render Helper: The Card ---
    const ActivityCard = ({ item, badge, badgeColor }) => {
        const favicon = getFaviconUrl(item.url, 64);

        return (
            <div
                style={CARD_STYLE}
                onClick={() => openOrFocusUrl(item.url)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ show: true, x: e.clientX, y: e.clientY, url: item.url });
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = CARD_STYLE.background;
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'none';
                }}
            >
                {/* Icon */}
                <div style={{
                    minWidth: '32px', height: '32px', borderRadius: '8px',
                    background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden'
                }}>
                    {favicon ?
                        <img src={favicon} alt="" style={{ width: '20px', height: '20px' }} onError={(e) => e.target.style.display = 'none'} /> :
                        <Globe size={16} color="rgba(255,255,255,0.3)" />
                    }
                </div>

                {/* Text Content */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <span style={{
                        fontSize: '13px', color: '#fff', fontWeight: '500',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>
                        {item.displayTitle || item.host}
                    </span>
                    <span style={{
                        fontSize: '11px', color: 'rgba(255,255,255,0.5)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>
                        {item.host}
                    </span>
                </div>

                {/* Badge Indicator */}
                {badge && (
                    <div style={{
                        fontSize: '10px', fontWeight: 'bold', color: badgeColor,
                        background: `${badgeColor}20`, padding: '2px 6px', borderRadius: '4px'
                    }}>
                        {badge}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="bg-slate-900 text-white p-6 min-h-screen" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' }}>

            {loading && !rows.length && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                    Analyzing browsing habits...
                </div>
            )}

            {/* SECTION 1: JUMP BACK IN (Recent & Active) */}
            {processedFeed.jumpBackIn.length > 0 && (
                <>
                    <div style={SECTION_TITLE_STYLE}>
                        <History size={14} /> Jump Back In
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {processedFeed.jumpBackIn.map(item => (
                            <ActivityCard
                                key={item.url}
                                item={item}
                                badge={item.isActive ? 'OPEN' : 'RECENT'}
                                badgeColor={item.isActive ? '#34C759' : '#0A84FF'}
                            />
                        ))}
                    </div>
                </>
            )}

            {/* SECTION 2: EXPECTED VISITS (Top Daily) */}
            {(processedFeed.dailyTop.length > 0 || (!loading && processedFeed.jumpBackIn.length === 0)) && (
                <>
                    <div style={SECTION_TITLE_STYLE}>
                        <Star size={14} /> Expected Visits
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {processedFeed.dailyTop.length > 0 ? processedFeed.dailyTop.map(item => (
                            <ActivityCard
                                key={item.url}
                                item={item}
                                badge={item.totalScore > 0.8 ? 'TOP' : null}
                                badgeColor={'#FF9500'}
                            />
                        )) : (
                            // Fallback if no specific top items found yet
                            processedFeed.all.slice(0, 5).map(item => <ActivityCard key={item.url} item={item} />)
                        )}
                    </div>
                </>
            )}

            {/* Empty State */}
            {!loading && rows.length === 0 && (
                <div style={{
                    padding: '40px', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)',
                    borderRadius: '12px', color: 'rgba(255,255,255,0.4)'
                }}>
                    No history data found to generate feed.
                </div>
            )}

            {/* Context Menu Portal */}
            {ctxMenu.show && createPortal(
                <div
                    style={{
                        position: 'fixed', top: ctxMenu.y, left: ctxMenu.x,
                        background: '#1c1c1e', border: '1px solid #333', borderRadius: '8px',
                        padding: '4px', zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => hideUrl(ctxMenu.url)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: 'transparent', border: 'none', color: '#ff453a',
                            padding: '8px 12px', cursor: 'pointer', fontSize: '13px', width: '100%', textAlign: 'left'
                        }}
                    >
                        <EyeOff size={14} /> Hide from Feed
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
}