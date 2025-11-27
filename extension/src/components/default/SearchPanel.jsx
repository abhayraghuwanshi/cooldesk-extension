import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useState } from 'react';
import { getUIState, saveUIState } from '../../db/index.js';

export function SearchPanel() {
    const [search, setSearch] = useState('');
    const [quickUrls, setQuickUrls] = useState([]);
    const [quickUrlsLoaded, setQuickUrlsLoaded] = useState(false);
    const [showAddUrl, setShowAddUrl] = useState(false);
    const [newUrl, setNewUrl] = useState('');
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            const saved = localStorage.getItem('searchPanel_collapsed');
            return saved === 'true';
        } catch {
            return false;
        }
    });

    // Load quick URLs from UI state
    useEffect(() => {
        (async () => {
            try {
                const ui = await getUIState();
                if (Array.isArray(ui?.quickUrls)) {
                    setQuickUrls(ui.quickUrls.slice(0, 8));
                }
                setQuickUrlsLoaded(true);
            } catch {
                setQuickUrlsLoaded(true);
            }
        })();
    }, []);

    // Persist quick URLs whenever they change
    useEffect(() => {
        if (!quickUrlsLoaded) return;
        (async () => {
            try {
                const ui = await getUIState();
                const payload = { ...ui, quickUrls: quickUrls.slice(0, 8) };
                await saveUIState(payload);
            } catch { }
        })();
    }, [quickUrls, quickUrlsLoaded]);

    // Persist collapsed state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('searchPanel_collapsed', String(isCollapsed));
        } catch (e) {
            console.warn('[SearchPanel] Failed to save collapsed state', e);
        }
    }, [isCollapsed]);

    const handleSearch = (e) => {
        e.preventDefault();
        if (!search.trim()) return;

        // Determine if it's a URL or search query
        const query = search.trim();
        let url;

        if (/^https?:\/\//i.test(query)) {
            url = query;
        } else if (/\.\w{2,}/.test(query) && !query.includes(' ')) {
            url = `https://${query}`;
        } else {
            url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        }

        // Open in new tab
        if (chrome?.tabs?.create) {
            chrome.tabs.create({ url });
        } else {
            window.open(url, '_blank');
        }

        setSearch('');
    };

    const handleAddUrl = () => {
        if (!newUrl.trim() || quickUrls.length >= 8) return;

        let url = newUrl.trim();
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }

        try {
            new URL(url); // Validate URL
            if (!quickUrls.includes(url)) {
                setQuickUrls([...quickUrls, url]);
            }
            setNewUrl('');
            setShowAddUrl(false);
        } catch {
            alert('Please enter a valid URL');
        }
    };

    const handleRemoveUrl = (urlToRemove) => {
        setQuickUrls(quickUrls.filter(url => url !== urlToRemove));
    };

    const openUrl = (url) => {
        if (chrome?.tabs?.create) {
            chrome.tabs.create({ url });
        } else {
            window.open(url, '_blank');
        }
    };

    // If collapsed, show only title
    if (isCollapsed) {
        return (
            <div
                onClick={() => setIsCollapsed(false)}
                style={{
                    marginBottom: 'var(--section-spacing)',
                    padding: '12px 20px',
                    border: '1px solid rgba(70, 70, 75, 0.7)',
                    borderRadius: '16px',
                    background: 'rgba(28, 28, 33, 0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(28, 28, 33, 0.65)';
                    e.currentTarget.style.borderColor = 'rgba(100, 100, 105, 0.7)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(28, 28, 33, 0.45)';
                    e.currentTarget.style.borderColor = 'rgba(70, 70, 75, 0.7)';
                }}
            >
                <h3 style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 600,
                    margin: 0,
                    color: '#ffffff',
                    letterSpacing: '-0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                }}>
                    Search
                </h3>
                <span style={{
                    fontSize: '0.85rem',
                    opacity: 0.5,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to expand
                </span>
            </div>
        );
    }

    return (
        <div style={{
            marginBottom: 'var(--section-spacing)',
            padding: '60px 40px 80px',
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.03))',
            border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
            borderRadius: '16px',
            minHeight: '320px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
        }}>
            {/* Header */}
            <div
                onClick={() => setIsCollapsed(true)}
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.7';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                }}
            >
                <span style={{
                    fontSize: '0.75rem',
                    opacity: 0.4,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to hide
                </span>
            </div>

            {/* Search Bar - Centered */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
            }}>
                <form onSubmit={handleSearch} style={{
                    width: '100%',
                    maxWidth: '680px',
                    margin: '0 auto',
                }}>
                    <div style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                    }}>
                        <FontAwesomeIcon
                            icon={faSearch}
                            style={{
                                position: 'absolute',
                                left: '24px',
                                color: 'rgba(255, 255, 255, 0.4)',
                                fontSize: '20px',
                                pointerEvents: 'none',
                            }}
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search Google or type a URL"
                            style={{
                                width: '100%',
                                height: '60px',
                                paddingLeft: '60px',
                                paddingRight: '24px',
                                fontSize: '17px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '2px solid rgba(255, 255, 255, 0.15)',
                                borderRadius: '30px',
                                color: 'var(--text, #e5e7eb)',
                                outline: 'none',
                                transition: 'all 0.3s ease',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                                boxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
                            }}
                            onFocus={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                                e.currentTarget.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.25)';
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                                e.currentTarget.style.boxShadow = '0 1px 6px rgba(0, 0, 0, 0.15)';
                            }}
                        />
                    </div>
                </form>
            </div>

        </div>
    );
}
