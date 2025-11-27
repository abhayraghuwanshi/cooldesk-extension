import { faCalendar, faEnvelope, faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useState } from 'react';
import { getUIState, saveUIState } from '../../db/index.js';
import { CommandExecutor } from '../../services/commandExecutor.js';
import { CommandParser } from '../../services/commandParser.js';
import { CoolFeedSection } from './CoolFeedSection.jsx';

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

    // Command execution state
    const [commandResults, setCommandResults] = useState(null);
    const [commandFeedback, setCommandFeedback] = useState(null);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandSuggestions, setCommandSuggestions] = useState([]);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

    // Activity feed state
    const [tabs, setTabs] = useState([]);
    const [pings, setPings] = useState([]);

    const [commandExecutor] = useState(() => new CommandExecutor((feedback) => {
        setCommandFeedback(feedback);

        // Show command palette for help
        if (feedback.type === 'help') {
            setShowCommandPalette(true);
        }

        // Auto-clear feedback after 3 seconds (except help)
        if (feedback.type !== 'help') {
            setTimeout(() => setCommandFeedback(null), 3000);
        }
    }));

    // Command suggestions based on input
    useEffect(() => {
        if (!search.startsWith('!') || search.length < 2) {
            setCommandSuggestions([]);
            setSelectedSuggestionIndex(-1);
            return;
        }

        const query = search.slice(1).toLowerCase(); // Remove ! and lowercase
        const allCommands = CommandParser.getAllCommands();

        // Filter commands that match the query
        const matches = allCommands.filter(cmd => {
            const cmdName = cmd.command.toLowerCase();
            return cmdName.includes(query) || cmd.description.toLowerCase().includes(query);
        }).slice(0, 5); // Limit to 5 suggestions

        setCommandSuggestions(matches);
        setSelectedSuggestionIndex(-1);
    }, [search]);

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

    // Load tabs and pings for activity feed
    useEffect(() => {
        const loadTabsAndPings = async () => {
            try {
                // Load tabs
                if (chrome?.tabs?.query) {
                    const allTabs = await chrome.tabs.query({});
                    setTabs(allTabs);
                }

                // Load pings from UI state
                const ui = await getUIState();
                if (Array.isArray(ui?.pinnedWorkspaces)) {
                    const allPings = ui.pinnedWorkspaces.flatMap(ws =>
                        (ws.urls || []).map(url => ({
                            url: typeof url === 'string' ? url : url.url,
                            title: typeof url === 'string' ? '' : url.title
                        }))
                    );
                    setPings(allPings);
                }
            } catch (e) {
                console.warn('[SearchPanel] Failed to load tabs/pings', e);
            }
        };

        loadTabsAndPings();
        const interval = setInterval(loadTabsAndPings, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);

    // Handle keyboard navigation for suggestions
    const handleKeyDown = (e) => {
        if (commandSuggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedSuggestionIndex(prev =>
                prev < commandSuggestions.length - 1 ? prev + 1 : prev
            );
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
        } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
            e.preventDefault();
            const selected = commandSuggestions[selectedSuggestionIndex];
            setSearch(selected.command);
            setCommandSuggestions([]);
            setSelectedSuggestionIndex(-1);
        } else if (e.key === 'Escape') {
            setCommandSuggestions([]);
            setSelectedSuggestionIndex(-1);
        }
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!search.trim()) return;

        const query = search.trim();

        // Check if it's a command
        if (CommandParser.isCommand(query)) {
            try {
                const parsed = CommandParser.parse(query);
                console.log('[SearchPanel] Executing command:', parsed);

                const result = await commandExecutor.execute(parsed);
                console.log('[SearchPanel] Command result:', result);

                setCommandResults(result);

                // Handle special result types
                if (result.data?.results) {
                    // Show results in a modal or dropdown
                    console.log('[SearchPanel] Command returned results:', result.data.results);
                }

                // If workspace switch, trigger UI update
                if (result.workspace) {
                    // Trigger workspace change event
                    window.dispatchEvent(new CustomEvent('workspaceChanged', {
                        detail: { workspace: result.workspace }
                    }));
                }

                setSearch('');
            } catch (error) {
                console.error('[SearchPanel] Command execution error:', error);
                setCommandFeedback({
                    type: 'error',
                    message: error.message || 'Command failed'
                });
            }
            return;
        }

        // Regular search handling
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

    const openQuickLink = (url) => {
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
            position: 'relative',
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
                            onKeyDown={handleKeyDown}
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

                {/* Quick Access Links & Activity Feed Row */}
                {!search.startsWith('!') && (
                    <div style={{
                        display: 'flex',
                        gap: '16px',
                        marginTop: '16px',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        width: '100%',
                        maxWidth: '680px'
                    }}>
                        {/* Left: Gmail & Calendar Buttons */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'row',
                            gap: '10px',
                            flex: '0 0 auto'
                        }}>
                            <button
                                onClick={() => openQuickLink('https://mail.google.com')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '10px 20px',
                                    background: 'rgba(234, 67, 53, 0.1)',
                                    border: '1px solid rgba(234, 67, 53, 0.3)',
                                    borderRadius: '10px',
                                    color: '#EA4335',
                                    fontSize: '14px',
                                    height: '48px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(234, 67, 53, 0.2)';
                                    e.currentTarget.style.borderColor = 'rgba(234, 67, 53, 0.5)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(234, 67, 53, 0.1)';
                                    e.currentTarget.style.borderColor = 'rgba(234, 67, 53, 0.3)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                <FontAwesomeIcon icon={faEnvelope} style={{ fontSize: '16px' }} />
                                <span>Gmail</span>
                            </button>

                            <button
                                onClick={() => openQuickLink('https://calendar.google.com')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '10px 20px',
                                    background: 'rgba(66, 133, 244, 0.1)',
                                    border: '1px solid rgba(66, 133, 244, 0.3)',
                                    borderRadius: '10px',
                                    color: '#4285F4',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    height: '48px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(66, 133, 244, 0.2)';
                                    e.currentTarget.style.borderColor = 'rgba(66, 133, 244, 0.5)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(66, 133, 244, 0.1)';
                                    e.currentTarget.style.borderColor = 'rgba(66, 133, 244, 0.3)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                <FontAwesomeIcon icon={faCalendar} style={{ fontSize: '16px' }} />
                                <span>Calendar</span>
                            </button>
                        </div>

                        {/* Right: Activity Feed */}
                        <div style={{
                            flex: '1 1 auto',
                            minWidth: 0
                        }}>
                            <CoolFeedSection tabs={tabs} pings={pings} maxItems={6} />
                        </div>
                    </div>
                )}

                {/* Command Suggestions Dropdown - Google style */}
                {commandSuggestions.length > 0 && (
                    <div
                        style={{
                            width: '100%',
                            maxWidth: '680px',
                            marginTop: '8px',
                            background: 'rgba(28, 28, 33, 0.98)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                            overflow: 'hidden',
                            zIndex: 1000
                        }}
                    >
                        {commandSuggestions.map((cmd, idx) => (
                            <div
                                key={idx}
                                style={{
                                    padding: '12px 20px',
                                    cursor: 'pointer',
                                    transition: 'background 0.1s ease',
                                    background: selectedSuggestionIndex === idx
                                        ? 'rgba(59, 130, 246, 0.2)'
                                        : 'transparent',
                                    borderBottom: idx < commandSuggestions.length - 1
                                        ? '1px solid rgba(255, 255, 255, 0.05)'
                                        : 'none'
                                }}
                                onMouseEnter={() => setSelectedSuggestionIndex(idx)}
                                onMouseLeave={() => setSelectedSuggestionIndex(-1)}
                                onClick={() => {
                                    setSearch(cmd.command);
                                    setCommandSuggestions([]);
                                    setSelectedSuggestionIndex(-1);
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    marginBottom: '4px'
                                }}>
                                    <code style={{
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        color: '#3b82f6',
                                        fontFamily: 'monospace'
                                    }}>
                                        {cmd.command}
                                    </code>
                                    <span style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(255, 255, 255, 0.06)',
                                        color: 'rgba(255, 255, 255, 0.5)',
                                        fontWeight: 500,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px'
                                    }}>
                                        {cmd.category}
                                    </span>
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'rgba(255, 255, 255, 0.6)',
                                    lineHeight: 1.3
                                }}>
                                    {cmd.description}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Command Feedback */}
                {commandFeedback && (
                    <div
                        style={{
                            marginTop: '16px',
                            padding: '12px 20px',
                            borderRadius: '12px',
                            background: commandFeedback.type === 'error'
                                ? 'rgba(239, 68, 68, 0.1)'
                                : commandFeedback.type === 'success'
                                    ? 'rgba(34, 197, 94, 0.1)'
                                    : 'rgba(59, 130, 246, 0.1)',
                            border: `1px solid ${commandFeedback.type === 'error'
                                ? 'rgba(239, 68, 68, 0.3)'
                                : commandFeedback.type === 'success'
                                    ? 'rgba(34, 197, 94, 0.3)'
                                    : 'rgba(59, 130, 246, 0.3)'}`,
                            color: commandFeedback.type === 'error'
                                ? '#ef4444'
                                : commandFeedback.type === 'success'
                                    ? '#22c55e'
                                    : '#3b82f6',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '14px',
                            maxWidth: '680px',
                            margin: '16px auto 0',
                        }}
                    >
                        <span>{commandFeedback.message}</span>
                    </div>
                )}

                {/* Command Results Display */}
                {commandFeedback && commandFeedback.data?.results && (
                    <div
                        style={{
                            marginTop: '12px',
                            width: '100%',
                            maxWidth: '680px',
                            background: 'rgba(28, 28, 33, 0.98)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                            overflow: 'hidden',
                            maxHeight: '400px',
                            overflowY: 'auto'
                        }}
                    >
                        {commandFeedback.data.results.map((result, idx) => {
                            const url = result.url || '';
                            const title = result.title || url;
                            const type = result.type || 'result';

                            return (
                                <div
                                    key={idx}
                                    style={{
                                        padding: '12px 20px',
                                        cursor: 'pointer',
                                        transition: 'background 0.1s ease',
                                        borderBottom: idx < commandFeedback.data.results.length - 1
                                            ? '1px solid rgba(255, 255, 255, 0.05)'
                                            : 'none'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'transparent';
                                    }}
                                    onClick={() => {
                                        if (url && chrome?.tabs?.create) {
                                            chrome.tabs.create({ url });
                                        } else if (url) {
                                            window.open(url, '_blank');
                                        }
                                        setCommandFeedback(null);
                                    }}
                                >
                                    <div style={{
                                        fontSize: '14px',
                                        fontWeight: 500,
                                        color: '#fff',
                                        marginBottom: '4px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {title}
                                    </div>
                                    <div style={{
                                        fontSize: '12px',
                                        color: 'rgba(255, 255, 255, 0.6)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <span>{url}</span>
                                        {type !== 'result' && (
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                background: 'rgba(255, 255, 255, 0.06)',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px'
                                            }}>
                                                {type}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Command Help Hint */}
                {search.startsWith('!') && !commandFeedback && !showCommandPalette && (
                    <div
                        style={{
                            marginTop: '12px',
                            fontSize: '13px',
                            opacity: 0.6,
                            textAlign: 'center',
                            color: 'var(--text-secondary, #aaa)'
                        }}
                    >
                        Type <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>!?</code> for help
                    </div>
                )}

                {/* Command Palette */}
                {showCommandPalette && commandFeedback?.data?.commands && (
                    <div
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'rgba(0, 0, 0, 0.7)',
                            backdropFilter: 'blur(8px)',
                            zIndex: 9999,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '20px'
                        }}
                        onClick={() => {
                            setShowCommandPalette(false);
                            setCommandFeedback(null);
                        }}
                    >
                        <div
                            style={{
                                background: 'var(--glass-bg, rgba(20, 20, 25, 0.95))',
                                border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
                                borderRadius: '16px',
                                maxWidth: '800px',
                                width: '100%',
                                maxHeight: '80vh',
                                overflow: 'auto',
                                padding: '24px',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '20px',
                                paddingBottom: '16px',
                                borderBottom: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))'
                            }}>
                                <h2 style={{
                                    margin: 0,
                                    fontSize: '24px',
                                    fontWeight: 600,
                                    color: 'var(--text, #e5e7eb)'
                                }}>
                                    🚀 Available Commands
                                </h2>
                                <button
                                    onClick={() => {
                                        setShowCommandPalette(false);
                                        setCommandFeedback(null);
                                    }}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--text-secondary, #aaa)',
                                        fontSize: '24px',
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        lineHeight: 1
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            {/* Commands by Category */}
                            {Object.entries(
                                commandFeedback.data.commands.reduce((acc, cmd) => {
                                    if (!acc[cmd.category]) acc[cmd.category] = [];
                                    acc[cmd.category].push(cmd);
                                    return acc;
                                }, {})
                            ).map(([category, commands]) => (
                                <div key={category} style={{ marginBottom: '24px' }}>
                                    <h3 style={{
                                        fontSize: '16px',
                                        fontWeight: 600,
                                        color: 'var(--text, #e5e7eb)',
                                        marginBottom: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        {category === 'Navigation' && '🧭'}
                                        {category === 'Workspace' && '💼'}
                                        {category === 'AI' && '🤖'}
                                        {category === 'Help' && '❓'}
                                        {category === 'Magic' && '✨'}
                                        {category}
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {commands.map((cmd, idx) => (
                                            <div
                                                key={idx}
                                                style={{
                                                    padding: '12px 16px',
                                                    background: 'rgba(255, 255, 255, 0.03)',
                                                    border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.08))',
                                                    borderRadius: '8px',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    transition: 'all 0.2s ease',
                                                    cursor: 'pointer'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                                                }}
                                                onClick={() => {
                                                    setSearch(cmd.command.split(' ')[0] + ' ');
                                                    setShowCommandPalette(false);
                                                    setCommandFeedback(null);
                                                }}
                                            >
                                                <div style={{ flex: 1 }}>
                                                    <code style={{
                                                        fontSize: '14px',
                                                        fontWeight: 600,
                                                        color: '#3b82f6',
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        {cmd.command}
                                                    </code>
                                                    <div style={{
                                                        fontSize: '13px',
                                                        color: 'var(--text-secondary, #aaa)',
                                                        marginTop: '4px'
                                                    }}>
                                                        {cmd.description}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {/* Footer */}
                            <div style={{
                                marginTop: '24px',
                                paddingTop: '16px',
                                borderTop: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
                                fontSize: '13px',
                                color: 'var(--text-secondary, #aaa)',
                                textAlign: 'center'
                            }}>
                                💡 Click on any command to use it, or press <kbd style={{
                                    background: 'rgba(255,255,255,0.1)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontFamily: 'monospace'
                                }}>Esc</kbd> to close
                            </div>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
