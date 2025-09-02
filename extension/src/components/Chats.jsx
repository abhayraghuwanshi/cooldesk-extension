import React, { useEffect, useState } from 'react';
import { getFaviconUrl } from '../utils';
import aiPlatformsConfig from '../config/aiPlatforms.json';

// Helper function to create title extractor from config
const createTitleExtractor = (config) => {
    return (url) => {
        if (!config) return null;
        
        switch (config.type) {
            case 'chatId': {
                const match = url.match(new RegExp(config.pattern));
                if (match && match[1]) {
                    const id = match[1].substring(0, 8);
                    return config.format.replace('{id}', id);
                }
                return null;
            }
            
            case 'queryParam': {
                try {
                    const urlObj = new URL(url);
                    const query = urlObj.searchParams.get(config.parameter);
                    if (query) {
                        const decodedQuery = decodeURIComponent(query);
                        return decodedQuery.length > (config.maxLength || 50) 
                            ? decodedQuery.substring(0, config.maxLength || 50) + '...' 
                            : decodedQuery;
                    }
                    return config.fallback || null;
                } catch (e) {
                    return config.fallback || null;
                }
            }
            
            case 'multi': {
                for (const pattern of config.patterns) {
                    const match = url.match(new RegExp(pattern.pattern));
                    if (match && match[1]) {
                        const id = match[1].substring(0, 8);
                        return pattern.format.replace('{id}', id);
                    }
                }
                return null;
            }
            
            case 'fallback':
                return config.format;
                
            default:
                return null;
        }
    };
};

// Helper function to check if URL matches include patterns but not exclude patterns
const matchesUrlPattern = (url, patterns) => {
    // Check include patterns
    const includeMatches = patterns.include.some(pattern => 
        new RegExp(pattern).test(url)
    );
    
    if (!includeMatches) return false;
    
    // Check exclude patterns
    const excludeMatches = patterns.exclude.some(pattern => 
        new RegExp(pattern).test(url)
    );
    
    return !excludeMatches;
};

// Helper function to check global excludes
const isGloballyExcluded = (url) => {
    return aiPlatformsConfig.globalExcludes.some(pattern => 
        new RegExp(pattern).test(url)
    );
};

// Convert JSON config to runtime platform objects
const aiPlatforms = aiPlatformsConfig.platforms.map(platform => ({
    ...platform,
    favicon: getFaviconUrl(`https://${platform.domains[0]}`, 32),
    urlPatterns: platform.urlPatterns.include.map(pattern => new RegExp(pattern)),
    getTitleFromUrl: createTitleExtractor(platform.titleExtraction),
    matchesUrl: (url) => matchesUrlPattern(url, platform.urlPatterns)
}));

// Generate fallback titles for AI chats
const generateFallbackTitle = (platform, url, timestamp) => {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    // Try to extract chat ID from URL first
    const chatIdMatch = url.match(/([a-f0-9-]{8,})/);
    if (chatIdMatch) {
        return `${platform.name} Chat ${chatIdMatch[1].substring(0, 8)}`;
    }

    // Use fallback format from config or default
    const fallbackFormat = aiPlatformsConfig.fallbackTitleFormat;
    return fallbackFormat
        .replace('{platform}', platform.name)
        .replace('{time}', timeStr);
};

export function Chats() {
    const [chats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPlatform, setSelectedPlatform] = useState('all');
    const [selectedTimeFilter, setSelectedTimeFilter] = useState('all');

    // Load chat history from browser history
    useEffect(() => {
        const loadChats = async () => {
            try {
                const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
                const history = dashboardData?.history || [];

                // Filter history for AI platform chats
                const aiChats = history.filter(item => {
                    if (!item.url) return false;
                    
                    // Check global excludes first
                    if (isGloballyExcluded(item.url)) return false;

                    return aiPlatforms.some(platform => {
                        // Only use pattern matching - must match include patterns and not match exclude patterns
                        return platform.matchesUrl(item.url);
                    });
                }).map(item => {
                    // Add platform info to each chat
                    const platform = aiPlatforms.find(p => {
                        // Only use pattern matching - must match include patterns and not match exclude patterns
                        return p.matchesUrl(item.url);
                    });

                    // Generate better title - prioritize meaningful browser titles
                    let title = item.title;

                    // Check if browser title is meaningful (not generic platform names)
                    const isGenericTitle = !title || 
                        title === 'ChatGPT' || title === 'Claude' || title === 'Gemini' ||
                        title === 'Perplexity' || title === 'Copilot' || title === 'Grok' ||
                        title === 'New Chat' || title === 'Untitled' ||
                        title.toLowerCase().includes('new chat') || 
                        title.toLowerCase().includes('untitled') ||
                        title.toLowerCase().includes('loading') ||
                        title === platform?.name; // Generic platform name

                    // For Gemini, also check for common generic titles
                    if (platform?.id === 'gemini') {
                        const geminiGenericTitles = [
                            'Gemini',
                            'Google AI',
                            'Bard',
                            'Google Bard',
                            'Gemini - Google AI'
                        ];
                        if (geminiGenericTitles.includes(title)) {
                            title = null; // Treat as generic
                        }
                    }

                    // If browser title is meaningful, keep it; otherwise extract from URL
                    if (isGenericTitle || !title) {
                        // Try platform-specific title extraction
                        const urlTitle = platform?.getTitleFromUrl?.(item.url);
                        if (urlTitle) {
                            title = urlTitle;
                        } else {
                            // Use fallback title generation
                            title = generateFallbackTitle(platform, item.url, item.lastVisitTime);
                        }
                    }

                    return {
                        ...item,
                        title,
                        platform: platform || null,
                        timestamp: item.lastVisitTime || Date.now()
                    };
                }).sort((a, b) => b.timestamp - a.timestamp); // Sort by most recent

                setChats(aiChats);
            } catch (error) {
                console.error('Failed to load chats:', error);
            } finally {
                setLoading(false);
            }
        };

        loadChats();
    }, []);

    // Time filter functions
    const getTimeFilteredChats = (chats, timeFilter) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        switch (timeFilter) {
            case 'today':
                return chats.filter(chat => new Date(chat.timestamp) >= today);
            case 'yesterday':
                return chats.filter(chat => {
                    const chatDate = new Date(chat.timestamp);
                    return chatDate >= yesterday && chatDate < today;
                });
            case 'week':
                return chats.filter(chat => new Date(chat.timestamp) >= weekAgo);
            case 'month':
                return chats.filter(chat => new Date(chat.timestamp) >= monthAgo);
            case 'older':
                return chats.filter(chat => new Date(chat.timestamp) < monthAgo);
            default:
                return chats;
        }
    };

    // Group chats by date
    const groupChatsByDate = (chats) => {
        const groups = {};

        chats.forEach(chat => {
            const chatDate = new Date(chat.timestamp);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

            let groupKey;
            if (chatDate >= today) {
                groupKey = 'Today';
            } else if (chatDate >= yesterday) {
                groupKey = 'Yesterday';
            } else if (chatDate >= new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
                groupKey = chatDate.toLocaleDateString('en-US', { weekday: 'long' });
            } else if (chatDate >= new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)) {
                groupKey = chatDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            } else {
                groupKey = chatDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            }

            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(chat);
        });

        return groups;
    };

    // Filter chats by selected platform and time
    let filteredChats = selectedPlatform === 'all'
        ? chats
        : chats.filter(chat => chat.platform?.id === selectedPlatform);

    filteredChats = getTimeFilteredChats(filteredChats, selectedTimeFilter);

    // Group filtered chats by date
    const groupedChats = groupChatsByDate(filteredChats);

    // Get platform stats
    const platformStats = aiPlatforms.map(platform => ({
        ...platform,
        count: chats.filter(chat => chat.platform?.id === platform.id).length
    }));

    // Time filter options
    const timeFilters = [
        { id: 'all', name: 'All Time', count: chats.length },
        { id: 'today', name: 'Today', count: getTimeFilteredChats(chats, 'today').length },
        { id: 'yesterday', name: 'Yesterday', count: getTimeFilteredChats(chats, 'yesterday').length },
        { id: 'week', name: 'This Week', count: getTimeFilteredChats(chats, 'week').length },
        { id: 'month', name: 'This Month', count: getTimeFilteredChats(chats, 'month').length },
        { id: 'older', name: 'Older', count: getTimeFilteredChats(chats, 'older').length }
    ].filter(filter => filter.count > 0);

    const openChat = (url) => {
        try {
            if (chrome?.tabs?.create) {
                chrome.tabs.create({ url });
            } else {
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('Failed to open chat:', error);
        }
    };

    const formatTime = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (days === 1) {
            return 'Yesterday';
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    };

    if (loading) {
        return (
            <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
                Loading chats...
            </div>
        );
    }

    return (
        <div style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            color: '#ffffff',
            marginTop: '20px',
        }}>
            {/* Filters */}
            <div style={{ marginBottom: '20px' }}>
                {/* Platform Filter */}
                <div style={{ marginBottom: '12px' }}>
                    <div style={{
                        fontSize: '12px',
                        color: 'rgba(255, 255, 255, 0.6)',
                        marginBottom: '8px',
                        fontWeight: '500'
                    }}>
                        AI Platform
                    </div>
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px'
                    }}>
                        <button
                            onClick={() => setSelectedPlatform('all')}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '20px',
                                border: 'none',
                                background: selectedPlatform === 'all'
                                    ? 'rgba(52, 199, 89, 0.2)'
                                    : 'rgba(255, 255, 255, 0.1)',
                                color: selectedPlatform === 'all'
                                    ? '#34C759'
                                    : 'rgba(255, 255, 255, 0.7)',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            All ({chats.length})
                        </button>
                        {platformStats.filter(p => p.count > 0).map(platform => (
                            <button
                                key={platform.id}
                                onClick={() => setSelectedPlatform(platform.id)}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    border: 'none',
                                    background: selectedPlatform === platform.id
                                        ? `${platform.color}20`
                                        : 'rgba(255, 255, 255, 0.1)',
                                    color: selectedPlatform === platform.id
                                        ? platform.color
                                        : 'rgba(255, 255, 255, 0.7)',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: '500',
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                {platform.favicon ? (
                                    <img 
                                        src={platform.favicon} 
                                        alt={platform.name}
                                        width={16}
                                        height={16}
                                        style={{ borderRadius: 3 }}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.textContent = `${platform.icon} ${platform.name} (${platform.count})`;
                                        }}
                                    />
                                ) : (
                                    <span>{platform.icon}</span>
                                )}
                                <span>{platform.name} ({platform.count})</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Time Filter */}
                <div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px'
                    }}>
                        <div style={{
                            fontSize: '12px',
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontWeight: '500'
                        }}>
                            Time Period
                        </div>
                        <select
                            value={selectedTimeFilter}
                            onChange={(e) => setSelectedTimeFilter(e.target.value)}
                            style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                color: '#ffffff',
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                outline: 'none',
                                minWidth: '120px'
                            }}
                        >
                            {timeFilters.map(filter => (
                                <option 
                                    key={filter.id} 
                                    value={filter.id}
                                    style={{
                                        background: '#1a1a1a',
                                        color: '#ffffff'
                                    }}
                                >
                                    {filter.name} ({filter.count})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Chat List */}
            {filteredChats.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: '14px'
                }}>
                    {selectedPlatform === 'all'
                        ? 'No AI chats found for the selected time period'
                        : `No ${aiPlatforms.find(p => p.id === selectedPlatform)?.name} chats found for the selected time period`
                    }
                </div>
            ) : (
                <div>
                    {Object.entries(groupedChats)
                        .sort(([a], [b]) => {
                            const order = ['Today', 'Yesterday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                            const aIndex = order.indexOf(a);
                            const bIndex = order.indexOf(b);
                            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                            if (aIndex !== -1) return -1;
                            if (bIndex !== -1) return 1;
                            return b.localeCompare(a);
                        })
                        .map(([dateGroup, groupChats]) => (
                            <div key={dateGroup} style={{ marginBottom: '24px' }}>
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    color: 'rgba(255, 255, 255, 0.8)',
                                    marginBottom: '12px',
                                    padding: '0 4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span>{dateGroup}</span>
                                    <div style={{
                                        height: '1px',
                                        flex: 1,
                                        background: 'rgba(255, 255, 255, 0.1)'
                                    }} />
                                    <span style={{
                                        fontSize: '12px',
                                        color: 'rgba(255, 255, 255, 0.5)',
                                        fontWeight: '400'
                                    }}>
                                        {groupChats.length} chat{groupChats.length !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {groupChats.map((chat, index) => (
                                        <div
                                            key={`${chat.url}-${index}`}
                                            onClick={() => openChat(chat.url)}
                                            style={{
                                                padding: '12px',
                                                borderRadius: '8px',
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {chat.platform && (
                                                    <div style={{
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 8,
                                                        background: `${chat.platform.color}20`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0,
                                                        fontSize: '16px'
                                                    }}>
                                                        {chat.platform.favicon ? (
                                                            <img 
                                                                src={chat.platform.favicon} 
                                                                alt="" 
                                                                width={18}
                                                                height={18}
                                                                style={{ borderRadius: 4 }}
                                                                onError={(e) => {
                                                                    e.target.style.display = 'none';
                                                                    e.target.parentElement.innerHTML = chat.platform.icon;
                                                                }}
                                                            />
                                                        ) : (
                                                            chat.platform.icon
                                                        )}
                                                    </div>
                                                )}

                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: '14px',
                                                        fontWeight: '500',
                                                        color: '#ffffff',
                                                        marginBottom: '4px',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                        {chat.title || 'Untitled Chat'}
                                                    </div>

                                                    <div style={{
                                                        fontSize: '12px',
                                                        color: 'rgba(255, 255, 255, 0.6)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px'
                                                    }}>
                                                        <span>{chat.platform?.name || 'Unknown Platform'}</span>
                                                        <span>•</span>
                                                        <span>{formatTime(chat.timestamp)}</span>
                                                    </div>
                                                </div>

                                                <div style={{
                                                    fontSize: '12px',
                                                    color: 'rgba(255, 255, 255, 0.4)',
                                                    flexShrink: 0
                                                }}>
                                                    →
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
}