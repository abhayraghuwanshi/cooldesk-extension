import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef } from 'react';

export function ExpandedSearchPanel({
    isOpen,
    suggestions,
    selectedIndex,
    onSelect,
    onHover,
    onClose,
    searchValue
}) {
    const panelRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) {
                onClose?.();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    if (!isOpen || suggestions.length === 0) return null;

    return (
        <div
            ref={panelRef}
            className="expanded-search-panel"
            style={{
                position: 'absolute',
                top: 'calc(100% + 12px)',
                left: 0,
                right: 0,
                maxHeight: '60vh',
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: '16px',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(139, 92, 246, 0.1)',
                overflow: 'hidden',
                zIndex: 2000,
                animation: 'expandedPanelSlideIn 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
        >
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid rgba(139, 92, 246, 0.15)',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(59, 130, 246, 0.03) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#94A3B8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                }}>
                    {searchValue.startsWith('/') ? 'Navigation Commands' :
                        searchValue.startsWith('!') ? 'Voice Commands' :
                            `${suggestions.length} Results`}
                </div>
                <div style={{
                    fontSize: '11px',
                    color: '#64748B',
                    fontStyle: 'italic'
                }}>
                    {searchValue.startsWith('/') && suggestions.length > 0 ?
                        '↹ Tab Complete • ↑↓ Navigate • Enter Select • Esc Close' :
                        '↑↓ Navigate • Enter Select • Esc Close'}
                </div>
            </div>

            {/* Results List */}
            <div style={{
                maxHeight: 'calc(60vh - 60px)',
                overflowY: 'auto',
                padding: '8px'
            }}>
                {suggestions.map((suggestion, idx) => (
                    <div
                        key={idx}
                        className={`expanded-search-item ${selectedIndex === idx ? 'selected' : ''}`}
                        onMouseEnter={() => onHover?.(idx)}
                        onClick={() => onSelect?.(suggestion, idx)}
                        style={{
                            padding: '14px 16px',
                            borderRadius: '10px',
                            marginBottom: '4px',
                            cursor: 'pointer',
                            background: selectedIndex === idx
                                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.12) 100%)'
                                : 'transparent',
                            border: selectedIndex === idx
                                ? '1px solid rgba(139, 92, 246, 0.3)'
                                : '1px solid transparent',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px'
                        }}
                    >
                        {/* Icon/Favicon */}
                        <div style={{
                            width: '32px',
                            height: '32px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '8px',
                            background: 'rgba(139, 92, 246, 0.1)',
                            fontSize: '16px'
                        }}>
                            {suggestion.icon ? (
                                <span>{suggestion.icon}</span>
                            ) : suggestion.favicon ? (
                                <img
                                    src={suggestion.favicon}
                                    alt=""
                                    style={{ width: '20px', height: '20px', borderRadius: '4px' }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            ) : (
                                <span style={{ color: '#A78BFA' }}>🔗</span>
                            )}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: '14px',
                                fontWeight: 500,
                                color: '#F1F5F9',
                                marginBottom: '4px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {suggestion.title || suggestion.command}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: '#94A3B8',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {suggestion.description || suggestion.url}
                            </div>
                        </div>

                        {/* Badge */}
                        <div style={{
                            flexShrink: 0,
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 500,
                            background: suggestion.type === 'workspace-url' ? 'rgba(139, 92, 246, 0.15)' :
                                suggestion.type === 'bookmark' ? 'rgba(251, 191, 36, 0.15)' :
                                    suggestion.type === 'history' ? 'rgba(59, 130, 246, 0.15)' :
                                        'rgba(52, 199, 89, 0.15)',
                            color: suggestion.type === 'workspace-url' ? '#C4B5FD' :
                                suggestion.type === 'bookmark' ? '#FCD34D' :
                                    suggestion.type === 'history' ? '#93C5FD' :
                                        '#86EFAC'
                        }}>
                            {suggestion.type === 'workspace-url' ? '📎 Workspace' :
                                suggestion.type === 'bookmark' ? '⭐ Bookmark' :
                                    suggestion.type === 'history' ? '🕐 History' :
                                        suggestion.category || 'Command'}
                        </div>

                        {/* Arrow indicator for selected */}
                        {selectedIndex === idx && (
                            <FontAwesomeIcon
                                icon={faArrowRight}
                                style={{
                                    color: '#A78BFA',
                                    fontSize: '14px',
                                    flexShrink: 0
                                }}
                            />
                        )}
                    </div>
                ))}
            </div>
        </div >
    );
}
