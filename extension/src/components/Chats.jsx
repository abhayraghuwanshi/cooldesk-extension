import React, { useEffect, useState } from 'react';
import aiPlatformsConfig from '../data/aiPlatforms.json';
import { getFaviconUrl } from '../utils';
import { ItemGrid } from './ItemGrid';

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
    const [items, setItems] = useState([]);
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
                        url: item.url,
                        title,
                        lastVisitTime: item.lastVisitTime || Date.now(),
                        dateAdded: item.lastVisitTime || Date.now(),
                        favicon: platform?.favicon || getFaviconUrl(item.url, 32),
                        platform: platform || null,
                        timestamp: item.lastVisitTime || Date.now(),
                        workspaceId: platform?.id // Use platform ID as workspace ID for grouping
                    };
                }).sort((a, b) => b.timestamp - a.timestamp); // Sort by most recent

                setItems(aiChats);
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

    // Filter items by platform and time
    let filteredItems = selectedPlatform === 'all'
        ? items
        : items.filter(item => item.platform?.id === selectedPlatform);

    filteredItems = getTimeFilteredChats(filteredItems, selectedTimeFilter);

    // Create workspace objects for ItemGrid
    const workspaces = aiPlatforms.map(platform => ({
        id: platform.id,
        name: platform.name,
        favicon: platform.favicon,
        color: platform.color
    }));

    // Get platform stats
    const platformStats = aiPlatforms.map(platform => ({
        ...platform,
        count: items.filter(item => item.platform?.id === platform.id).length
    }));

    // Time filter options
    const timeFilters = [
        { id: 'all', name: 'All Time', count: items.length },
        { id: 'today', name: 'Today', count: getTimeFilteredChats(items, 'today').length },
        { id: 'yesterday', name: 'Yesterday', count: getTimeFilteredChats(items, 'yesterday').length },
        { id: 'week', name: 'This Week', count: getTimeFilteredChats(items, 'week').length },
        { id: 'month', name: 'This Month', count: getTimeFilteredChats(items, 'month').length },
        { id: 'older', name: 'Older', count: getTimeFilteredChats(items, 'older').length }
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

            {/* Chat Grid */}
            {filteredItems.length === 0 ? (
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
                <ItemGrid
                    items={filteredItems}
                    workspaces={workspaces}
                    onAddRelated={() => { }}
                    onAddLink={openChat}
                />
            )}
        </div>
    );
}