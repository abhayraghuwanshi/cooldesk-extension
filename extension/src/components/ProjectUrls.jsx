import React, { useEffect, useState } from 'react';
import { listUrlsByWorkspace } from '../db';
import { getFaviconUrl } from '../utils';

export function ProjectUrls({ selectedWorkspace, onUrlClick }) {
    const [urls, setUrls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState('all');

    // Detect workspace type for different display formats
    const getWorkspaceType = (workspace) => {
        if (!workspace || !workspace.context) return 'generic';

        const platformTypes = ['github', 'figma', 'jira', 'notion', 'trello', 'slack', 'discord'];
        const workspaceType = workspace.context.type;

        return platformTypes.includes(workspaceType) ? 'platform' : 'generic';
    };

    const workspaceType = getWorkspaceType(selectedWorkspace);


    // Load URLs for the selected workspace
    useEffect(() => {
        const loadUrls = async () => {
            if (!selectedWorkspace) {
                setUrls([]);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const workspaceUrls = await listUrlsByWorkspace(selectedWorkspace.id);

                // Enhance URLs with additional metadata
                const enhancedUrls = workspaceUrls.map(url => {
                    const urlObj = new URL(url.url);
                    const domain = urlObj.hostname;
                    const project = extractProjectFromUrl(url.url);

                    return {
                        ...url,
                        domain,
                        project,
                        timestamp: url.addedAt || Date.now(),
                        favicon: url.favicon || getFaviconUrl(url.url, 32)
                    };
                }).sort((a, b) => b.timestamp - a.timestamp);

                setUrls(enhancedUrls);
            } catch (error) {
                console.error('Failed to load workspace URLs:', error);
                setUrls([]);
            } finally {
                setLoading(false);
            }
        };

        loadUrls();
    }, [selectedWorkspace]);

    // Time filter functions
    const getTimeFilteredUrls = (urls, timeFilter) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        switch (timeFilter) {
            case 'today':
                return urls.filter(url => new Date(url.timestamp) >= today);
            case 'yesterday':
                return urls.filter(url => {
                    const urlDate = new Date(url.timestamp);
                    return urlDate >= yesterday && urlDate < today;
                });
            case 'week':
                return urls.filter(url => new Date(url.timestamp) >= weekAgo);
            case 'month':
                return urls.filter(url => new Date(url.timestamp) >= monthAgo);
            case 'older':
                return urls.filter(url => new Date(url.timestamp) < monthAgo);
            default:
                return urls;
        }
    };

    // Group URLs by domain
    const groupUrlsByDomain = (urls) => {
        const groups = {};
        urls.forEach(url => {
            if (!groups[url.domain]) {
                groups[url.domain] = [];
            }
            groups[url.domain].push(url);
        });
        return groups;
    };

    // Group URLs by date
    const groupUrlsByDate = (urls) => {
        const groups = {};

        urls.forEach(url => {
            const urlDate = new Date(url.timestamp);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

            let groupKey;
            if (urlDate >= today) {
                groupKey = 'Today';
            } else if (urlDate >= yesterday) {
                groupKey = 'Yesterday';
            } else if (urlDate >= new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
                groupKey = urlDate.toLocaleDateString('en-US', { weekday: 'long' });
            } else if (urlDate >= new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)) {
                groupKey = urlDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            } else {
                groupKey = urlDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            }

            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(url);
        });

        return groups;
    };

    // Extract project info from URL (for GitHub repos)
    const extractProjectFromUrl = (url) => {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname === 'github.com') {
                const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
                if (pathParts.length >= 2) {
                    return `${pathParts[0]}/${pathParts[1]}`;
                }
            }
            // For non-GitHub URLs, return the domain
            return urlObj.hostname;
        } catch {
            return 'Unknown';
        }
    };

    // Get project stats grouped by user (replaces domain stats)
    const getProjectStats = (urls) => {
        const userProjects = {};
        const standaloneProjects = {};

        urls.forEach(url => {
            const project = url.project || url.domain;

            // Check if it's a GitHub project (contains '/')
            if (project.includes('/')) {
                const [user, repo] = project.split('/');
                if (!userProjects[user]) {
                    userProjects[user] = {
                        user,
                        totalCount: 0,
                        projects: {}
                    };
                }
                userProjects[user].projects[repo] = (userProjects[user].projects[repo] || 0) + 1;
                userProjects[user].totalCount += 1;
            } else {
                // Non-GitHub URLs (domains)
                standaloneProjects[project] = (standaloneProjects[project] || 0) + 1;
            }
        });

        // Convert to array format
        const userStats = Object.values(userProjects)
            .sort((a, b) => b.totalCount - a.totalCount);

        const standaloneStats = Object.entries(standaloneProjects)
            .map(([project, count]) => ({ project, count, isStandalone: true }))
            .sort((a, b) => b.count - a.count);

        return { userStats, standaloneStats };
    };

    // Filter URLs by selected category only
    const filteredUrls = selectedCategory === 'all'
        ? urls
        : urls.filter(url => {
            const project = url.project || url.domain;

            // If filtering by user, check if any project belongs to that user
            if (project.includes('/')) {
                const [user] = project.split('/');
                if (selectedCategory === user) return true;
            }

            // Otherwise check exact match (for domains or full project names)
            return project === selectedCategory;
        });

    // Deduplicate URLs to show only unique projects (keep most recent visit)
    const uniqueProjectUrls = {};
    filteredUrls.forEach(url => {
        const project = url.project || url.domain;
        if (!uniqueProjectUrls[project] || url.timestamp > uniqueProjectUrls[project].timestamp) {
            uniqueProjectUrls[project] = url;
        }
    });

    // Convert back to array and sort by timestamp
    const finalFilteredUrls = Object.values(uniqueProjectUrls).sort((a, b) => b.timestamp - a.timestamp);

    // Get project stats from all URLs
    const { userStats, standaloneStats } = getProjectStats(urls);
    const totalProjects = userStats.length + standaloneStats.length;

    const openUrl = (url) => {
        try {
            if (onUrlClick) {
                onUrlClick(url);
            } else if (chrome?.tabs?.create) {
                chrome.tabs.create({ url: url.url });
            } else {
                window.open(url.url, '_blank');
            }
        } catch (error) {
            console.error('Failed to open URL:', error);
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

    // Dynamic gradient generation based on domain (matching WorkspaceItem)
    const getDomainColor = React.useCallback((url) => {
        let hostname = '';
        try {
            hostname = new URL(url || '').hostname.toLowerCase();
        } catch {
            return { 
                bg: 'linear-gradient(135deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 100%)', 
                border: '#273043', 
                accent: '#4a5568' 
            };
        }

        // Accent colors for variety
        const accentColors = [
            '#3b82f6', // Blue
            '#6b7280', // Gray  
            '#4b5563', // Slate
            '#22c55e', // Green
            '#ea580c', // Orange
            '#a855f7', // Purple
            '#f43f5e', // Rose
            '#0891b2', // Cyan
        ];

        // Simple hash function for consistent color selection
        let hash = 0;
        for (let i = 0; i < hostname.length; i++) {
            hash = ((hash << 5) - hash) + hostname.charCodeAt(i);
            hash = hash & hash;
        }

        // Select an accent color based on hash
        const colorIndex = Math.abs(hash) % accentColors.length;
        const accent = accentColors[colorIndex];

        // Create gradient variations with transparency for workspace items
        const variation = Math.abs(hash >> 8) % 4;
        let bg, border;

        switch (variation) {
            case 0:
                bg = `linear-gradient(135deg, rgba(15, 23, 36, 0.8) 0%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.1) 100%)`;
                border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
                break;
            case 1:
                bg = `linear-gradient(145deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 50%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.05) 100%)`;
                border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.25)`;
                break;
            case 2:
                bg = `linear-gradient(125deg, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.03) 0%, rgba(15, 23, 36, 0.8) 40%, rgba(27, 35, 49, 0.8) 100%)`;
                border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.2)`;
                break;
            default:
                bg = `linear-gradient(155deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 70%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.08) 100%)`;
                border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
                break;
        }

        return {
            bg,
            border,
            accent,
            hostname
        };
    }, []);

    // ItemGrid component for generic workspaces (using CSS grid layout)
    const ItemGrid = () => (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            padding: '0'
        }}>
            {finalFilteredUrls.map((url, index) => {
                const colors = getDomainColor(url.url);
                return (
                    <div
                        key={`${url.url}-${index}`}
                        onClick={() => openUrl(url)}
                        style={{
                            background: colors.bg,
                            border: `1px solid ${colors.border}`,
                            borderRadius: '12px',
                            backdropFilter: 'blur(10px)',
                            boxShadow: 'none',
                            transition: 'all 0.2s ease',
                            cursor: 'pointer',
                            transform: 'translateY(0)',
                            minHeight: '120px',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 122, 255, 0.15)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = 'none';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                    <div style={{
                        padding: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        flex: 1
                    }}>
                        <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            background: 'rgba(255, 255, 255, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                        }}>
                            <img
                                src={url.favicon}
                                alt=""
                                width={20}
                                height={20}
                                style={{ borderRadius: 5 }}
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.parentElement.innerHTML = '🔗';
                                    e.target.parentElement.style.fontSize = '20px';
                                }}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 15,
                                color: '#ffffff',
                                lineHeight: 1.3,
                                marginBottom: 6,
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                {url.project || url.domain}
                            </div>
                            <div style={{
                                fontSize: 12,
                                color: 'rgba(255, 255, 255, 0.6)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                marginBottom: 8
                            }}>
                                {colors.hostname}
                            </div>
                            <div style={{
                                fontSize: '10px',
                                color: 'rgba(255, 255, 255, 0.5)',
                                background: 'rgba(255, 255, 255, 0.08)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                display: 'inline-block'
                            }}>
                                {formatTime(url.timestamp)}
                            </div>
                        </div>
                    </div>
                </div>
                );
            })}
        </div>
    );

    if (!selectedWorkspace) {
        return (
            <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
                Select a workspace to view URLs
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
                Loading workspace URLs...
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
                {/* Domain Filter */}
                <div style={{ marginBottom: '12px' }}>
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px'
                    }}>
                        <button
                            onClick={() => setSelectedCategory('all')}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '20px',
                                border: 'none',
                                background: selectedCategory === 'all'
                                    ? 'rgba(52, 199, 89, 0.2)'
                                    : 'rgba(255, 255, 255, 0.1)',
                                color: selectedCategory === 'all'
                                    ? '#34C759'
                                    : 'rgba(255, 255, 255, 0.7)',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            All ({urls.length})
                        </button>
                        {/* GitHub Users */}
                        {userStats.slice(0, 6).map(({ user, totalCount }) => (
                            <button
                                key={user}
                                onClick={() => setSelectedCategory(user)}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    border: 'none',
                                    background: selectedCategory === user
                                        ? `${getDomainColor(`https://${user}.github.io`).accent}20`
                                        : 'rgba(255, 255, 255, 0.1)',
                                    color: selectedCategory === user
                                        ? getDomainColor(`https://${user}.github.io`).accent
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
                                <img
                                    src={getFaviconUrl('https://github.com', 16)}
                                    alt={user}
                                    width={16}
                                    height={16}
                                    style={{ borderRadius: 3 }}
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                    }}
                                />
                                <span>{user} ({totalCount})</span>
                            </button>
                        ))}

                        {/* Standalone Projects (domains) */}
                        {standaloneStats.slice(0, Math.max(2, 8 - userStats.length)).map(({ project, count }) => (
                            <button
                                key={project}
                                onClick={() => setSelectedCategory(project)}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    border: 'none',
                                    background: selectedCategory === project
                                        ? `${getDomainColor(`https://${project}`).accent}20`
                                        : 'rgba(255, 255, 255, 0.1)',
                                    color: selectedCategory === project
                                        ? getDomainColor(`https://${project}`).accent
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
                                <img
                                    src={getFaviconUrl(`https://${project}`, 16)}
                                    alt={project}
                                    width={16}
                                    height={16}
                                    style={{ borderRadius: 3 }}
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                    }}
                                />
                                <span>{project} ({count})</span>
                            </button>
                        ))}
                    </div>
                </div>

            </div>

            {/* URL List - Grid format for all workspace types */}
            {finalFilteredUrls.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: '14px'
                }}>
                    {selectedCategory === 'all'
                        ? 'No URLs found'
                        : `No URLs from ${selectedCategory} found`
                    }
                </div>
            ) : (
                <ItemGrid />
            )}
        </div>
    );
}