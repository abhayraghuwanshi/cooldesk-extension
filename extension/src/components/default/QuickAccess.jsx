import { useState } from 'react';
import { CoolFeedSection } from './CoolFeedSection';
import { PingsSection } from './PingsSection';

export function QuickAccess({
    displaySettings = {},
    initialShowPins = true,
    initialShowFeed = true
}) {
    const [showPingsSection, setShowPingsSection] = useState(initialShowPins);
    const [showFeedSection, setShowFeedSection] = useState(initialShowFeed);

    return (
        <div style={{
            display: 'flex',
            gap: '24px',
            marginBottom: 'var(--section-spacing)',
            border: '1px solid rgba(70, 70, 75, 0.7)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
            borderRadius: '16px',
            background: '#1c1c2180',
            padding: '16px',
            backgroundColor: 'var(--card-bg, rgba(28, 28, 28, 0.8))'
        }}>
            {/* Feed Section */}
            {displaySettings.feedSection !== false && (
                <div className="feed-section" style={{
                    flex: 1,
                    position: 'relative'
                }}>
                    {showFeedSection ? (
                        <div onDoubleClick={() => setShowFeedSection(false)}>
                            <CoolFeedSection />
                        </div>
                    ) : (
                        <CollapsedSection
                            label="Feed"
                            onDoubleClick={() => setShowFeedSection(true)}
                        />
                    )}
                </div>
            )}

            {/* Vertical Divider */}
            <div style={{
                width: '1px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                margin: '0 8px'
            }} />

            {/* Pins Section */}
            {displaySettings.pinsSection !== false && (
                <div className="pins-section" style={{
                    flex: 1,
                    position: 'relative'
                }}>
                    {showPingsSection ? (
                        <div onDoubleClick={() => setShowPingsSection(false)}>
                            <PingsSection />
                        </div>
                    ) : (
                        <CollapsedSection
                            label="Pins"
                            onDoubleClick={() => setShowPingsSection(true)}
                        />
                    )}
                </div>
            )}
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