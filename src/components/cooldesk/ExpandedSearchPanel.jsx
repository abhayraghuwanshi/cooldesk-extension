import { faRobot, faSearch, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useRef, useState } from 'react';

export const ExpandedSearchPanel = React.memo(function ExpandedSearchPanel({
    isOpen,
    suggestions,
    selectedIndex,
    onSelect,
    onHover,
    onClose,
    searchValue,
    activePill
}) {
    const panelRef = useRef(null);
    const [showAISection, setShowAISection] = useState(false);

    // Detect AI search queries
    useEffect(() => {
        if (!isOpen || !searchValue || searchValue.length < 5) {
            setShowAISection(false);
            return;
        }

        const isNLQuery = searchValue.length >= 10 ||
            searchValue.includes('?') ||
            /^(what|where|how|when|why|which|find|show|get)\s/i.test(searchValue);

        setShowAISection(isNLQuery);
    }, [isOpen, searchValue]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose?.();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || suggestions.length === 0) return null;

    const isCommandMode = searchValue.startsWith('/') || searchValue.startsWith('!');

    // Inline results panel - renders inside the search container
    return (
        <div
            ref={panelRef}
            className="expanded-search-panel inline-results"
            style={{
                position: 'relative',
                width: '100%',
                marginTop: '0',

                borderTop: 'none', // Remove top border to merge

                // // Radius - Top corners sharp, bottom corners rounded
                // borderTopLeftRadius: '0',
                // borderTopRightRadius: '0',
                // borderBottomLeftRadius: '12px',
                // borderBottomRightRadius: '12px',

                overflow: 'hidden',
                maxHeight: '60vh',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 10001,
                // boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
            }}
        >
            {/* Premium Header */}
            <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
                background: 'rgba(15, 23, 42, 0.4)', // Slightly transparent to blend
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: showAISection ? '#A78BFA' : '#34C759',
                        boxShadow: showAISection ? '0 0 8px rgba(139, 92, 246, 0.6)' : '0 0 8px rgba(52, 199, 89, 0.6)'
                    }} />
                    <span style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#E2E8F0', // Brighter text
                        letterSpacing: '0.02em'
                    }}>
                        {isCommandMode ? 'COMMANDS' : showAISection ? 'AI RESULTS' : 'SUGGESTIONS'}
                        <span style={{
                            color: '#64748B',
                            marginLeft: '8px',
                            fontWeight: 500,
                            background: 'rgba(255,255,255,0.05)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '11px'
                        }}>
                            {suggestions.length}
                        </span>
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                        fontSize: '10px',
                        color: '#64748B',
                        fontFamily: "'Fira Code', monospace",
                        opacity: 0.7
                    }}>
                        TAB to navigate
                    </span>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.05)',
                            borderRadius: '4px',
                            width: '20px',
                            height: '20px',
                            cursor: 'pointer',
                            color: '#94A3B8',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                            e.target.style.color = '#EF4444';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = 'rgba(255,255,255,0.05)';
                            e.target.style.color = '#94A3B8';
                        }}
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
            </div>

            {/* AI indicator banner - Sleeker */}
            {showAISection && (
                <div style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.1) 0%, transparent 100%)',
                    borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <FontAwesomeIcon icon={faRobot} style={{ color: '#C4B5FD', fontSize: '11px' }} />
                    <span style={{ fontSize: '11px', color: '#C4B5FD', fontWeight: 500 }}>
                        Thinking: "{searchValue.slice(0, 40)}{searchValue.length > 40 ? '...' : ''}"
                    </span>
                </div>
            )}

            <div style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: activePill ? '8px' : '0' // Remove global padding for list view to let headers flush
            }}>
                {activePill ? (
                    // Grid layout for pill actions
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                        gap: '8px',
                        padding: '4px'
                    }}>
                        {suggestions.map((suggestion, idx) => {
                            const isSelected = selectedIndex === idx;
                            return (
                                <div
                                    key={idx}
                                    onMouseEnter={() => onHover?.(idx)}
                                    onClick={() => onSelect?.(suggestion, idx)}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        background: isSelected ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                                        border: isSelected ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255,255,255,0.06)',
                                        transition: 'all 0.1s ease'
                                    }}
                                >
                                    <div style={{ fontSize: '18px', marginBottom: '6px' }}>
                                        {suggestion.icon ? (
                                            typeof suggestion.icon === 'object' ?
                                                <FontAwesomeIcon icon={suggestion.icon} style={{ fontSize: '18px', color: '#A78BFA' }} /> :
                                                suggestion.icon
                                        ) : '✨'}
                                    </div>
                                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#E2E8F0', marginBottom: '2px' }}>
                                        {suggestion.title || suggestion.command}
                                    </div>
                                    <div style={{ fontSize: '10px', color: '#64748B' }}>
                                        {suggestion.description}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    // Grouped Grid Layout
                    (() => {
                        // 1. Group items preserving index
                        const groups = {};
                        const groupOrder = []; // To maintain insertion order of categories

                        suggestions.forEach((suggestion, originalIndex) => {
                            let category = 'SUGGESTIONS';
                            if (suggestion.category) category = suggestion.category.toUpperCase();
                            else if (suggestion.type === 'workspace-url') category = 'WORKSPACES';
                            else if (suggestion.type === 'history') category = 'HISTORY';
                            else if (suggestion.type === 'bookmark') category = 'BOOKMARKS';

                            if (!groups[category]) {
                                groups[category] = [];
                                groupOrder.push(category);
                            }
                            groups[category].push({ ...suggestion, originalIndex });
                        });

                        // 2. Render groups
                        return groupOrder.map((category) => (
                            <div key={category} style={{ marginBottom: '12px' }}>
                                {/* Category Header */}
                                <div style={{
                                    padding: '12px 0 8px 0',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    color: '#94A3B8',
                                    letterSpacing: '0.05em',
                                    fontFamily: "'Fira Code', monospace",
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    {category}
                                    <div style={{ height: '1px', flex: 1, background: 'rgba(255,255,255,0.05)' }} />
                                </div>

                                {/* Grid Container */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, 1fr)', // Force 2 columns side-by-side
                                    gap: '8px'
                                }}>
                                    {groups[category].map((item) => {
                                        const { originalIndex, ...suggestion } = item;
                                        const isSelected = selectedIndex === originalIndex;
                                        const hasAIRank = suggestion._aiRanked;

                                        return (
                                            <div
                                                key={originalIndex}
                                                onMouseEnter={() => onHover?.(originalIndex)}
                                                onClick={() => onSelect?.(suggestion, originalIndex)}
                                                style={{
                                                    padding: '10px 12px',
                                                    borderRadius: '12px',
                                                    cursor: 'pointer',
                                                    // Merged aesthetic: Very subtle highlight, no borders
                                                    background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    transition: 'all 0.1s ease',
                                                    position: 'relative',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                {/* Selection Bar - Subtle & Integrated */}
                                                {isSelected && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        left: '0',
                                                        top: '12%',
                                                        bottom: '12%',
                                                        width: '3px',
                                                        borderRadius: '0 4px 4px 0',
                                                        background: '#A78BFA', // Muted accent
                                                        opacity: 0.8
                                                    }} />
                                                )}

                                                {/* Icon */}
                                                <div style={{
                                                    width: '36px',
                                                    height: '36px',
                                                    flexShrink: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    borderRadius: '10px',
                                                    // No background for icon to merge better, just color change
                                                    background: isSelected ? 'rgba(255,255,255,0.05)' : 'transparent',
                                                    fontSize: '15px',
                                                    color: isSelected ? '#A78BFA' : '#64748B', // Highlight icon with accent on select
                                                    transition: 'all 0.15s ease'
                                                }}>
                                                    {suggestion.icon ? (
                                                        typeof suggestion.icon === 'object' ?
                                                            <FontAwesomeIcon icon={suggestion.icon} /> :
                                                            <span>{suggestion.icon}</span>
                                                    ) : suggestion.favicon ? (
                                                        <img
                                                            src={suggestion.favicon}
                                                            alt=""
                                                            style={{ width: '18px', height: '18px', borderRadius: '4px' }}
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <FontAwesomeIcon icon={faSearch} style={{ fontSize: '12px', opacity: 0.5 }} />
                                                    )}
                                                </div>

                                                {/* Content */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: '13px',
                                                        fontWeight: 500,
                                                        color: '#F1F5F9',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {suggestion.title || suggestion.command}
                                                    </div>
                                                    <div style={{
                                                        fontSize: '11px',
                                                        color: '#64748B',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        marginTop: '2px'
                                                    }}>
                                                        {suggestion.description || suggestion.url}
                                                    </div>
                                                </div>

                                                {/* Type Badge (Optional, small) */}
                                                <div style={{
                                                    fontSize: '9px',
                                                    fontWeight: 600,
                                                    color: 'rgba(255,255,255,0.2)',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {suggestion.type === 'workspace-url' ? 'WS' : ''}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ));
                    })()
                )}
            </div>

            {/* Footer */}
            <div style={{
                padding: '6px 12px',
                borderTop: '1px solid rgba(139, 92, 246, 0.1)',
                background: 'rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
            }}>
                <span style={{ fontSize: '9px', color: '#4B5563' }}>
                    {showAISection ? 'AI powered' : 'Tab to complete'}
                </span>
                <span style={{ fontSize: '9px', color: '#374151' }}>
                    nano
                </span>
            </div>

            <style>{`
                .inline-results {
                    animation: slideDown 0.15s ease-out;
                }
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .inline-results > div:nth-child(3) > div:hover {
                    background: rgba(139, 92, 246, 0.08) !important;
                }
            `}</style>
        </div>
    );
});
