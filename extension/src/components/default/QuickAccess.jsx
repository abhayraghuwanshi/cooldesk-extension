import { useEffect, useState } from 'react';
import { CoolFeedSection } from './CoolFeedSection';
import { PingsSection } from './PingsSection';

export function QuickAccess({
    displaySettings = {}
}) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            const saved = localStorage.getItem('quickAccess_collapsed');
            return saved === 'true';
        } catch {
            return false;
        }
    });

    // Persist collapsed state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('quickAccess_collapsed', String(isCollapsed));
        } catch (e) {
            console.warn('[QuickAccess] Failed to save collapsed state', e);
        }
    }, [isCollapsed]);

    // Single variable to control entire QuickAccess visibility
    if (displaySettings.quickAccess === false) {
        return null;
    }

    // If collapsed from header, show only title
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
                    {/* <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ color: '#34C759', fontSize: 'var(--font-size-xl)' }} /> */}
                    Quick Access
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
        }}>
            {/* Header with toggle */}
            <div
                onClick={() => setIsCollapsed(true)}
                style={{

                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                    transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.7';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
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
                    {/* <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ color: '#34C759', fontSize: 'var(--font-size-xl)' }} /> */}
                    Quick Access
                </h3>
                <span style={{
                    fontSize: '0.75rem',
                    opacity: 0.4,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to hide
                </span>
            </div>

            {/* Content */}
            <div style={{
                display: 'flex',
                gap: '24px',
                border: '1px solid rgba(70, 70, 75, 0.7)',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
                borderRadius: '16px',
                background: 'rgba(28, 28, 33, 0.45)',
                padding: '16px',
            }}>
                {isExpanded ? (
                    <>
                        {/* Feed Section */}
                        <div className="feed-section" style={{
                            flex: 1,
                            position: 'relative'
                        }}>
                            <div onDoubleClick={() => setIsExpanded(false)}>
                                <CoolFeedSection />
                            </div>
                        </div>

                        {/* Vertical Divider */}
                        <div style={{
                            width: '1px',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            margin: '0 8px'
                        }} />

                        {/* Pins Section */}
                        <div className="pins-section" style={{
                            flex: 1,
                            position: 'relative'
                        }}>
                            <div onDoubleClick={() => setIsExpanded(false)}>
                                <PingsSection />
                            </div>
                        </div>
                    </>
                ) : (
                    <div style={{ flex: 1, position: 'relative' }}>
                        <CollapsedSection
                            label="Quick Access"
                            onDoubleClick={() => setIsExpanded(true)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

const CollapsedSection = ({ label, onDoubleClick }) => (
    <div
        className="coolDesk-section"
        onDoubleClick={onDoubleClick}
        style={{
            padding: '12px',
            textAlign: 'center',
            cursor: 'pointer',
            opacity: 0.6,
            border: '1px dashed var(--border-color, rgba(255, 255, 255, 0.2))',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            '&:hover': {
                opacity: 0.8,
                backgroundColor: 'rgba(255, 255, 255, 0.05)'
            }
        }}
    >
        <span style={{ fontSize: '0.9em' }}>Double-click to show {label}</span>
    </div>
);

export default QuickAccess;
