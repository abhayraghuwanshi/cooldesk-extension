import React, { useEffect, useRef, useState } from 'react';
import { SearchModal } from '../popups/SearchModal.jsx';

export function SearchBox({ search, setSearch, openInSidePanel, focusSignal }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const shiftKeysRef = useRef({ left: false, right: false, lastShiftTime: 0 });

    // Open modal when focusSignal changes
    useEffect(() => {
        if (focusSignal) {
            setOpen(true);
        }
    }, [focusSignal]);

    // Double shift key listener
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Shift') {
                const now = Date.now();
                const timeSinceLastShift = now - shiftKeysRef.current.lastShiftTime;

                // If shift was pressed within 500ms, open search
                if (timeSinceLastShift < 500 && timeSinceLastShift > 50) {
                    setOpen(true);
                }

                shiftKeysRef.current.lastShiftTime = now;
            }
        };

        const handleKeyUp = (e) => {
            if (e.key === 'Shift') {
                // Reset after a delay to allow for double press detection
                setTimeout(() => {
                    if (Date.now() - shiftKeysRef.current.lastShiftTime > 400) {
                        shiftKeysRef.current.lastShiftTime = 0;
                    }
                }, 500);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    return (
        <>
            <div ref={wrapRef} style={{
                width: '100%',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}>
                {/* Search Trigger Button */}
                <div
                    onClick={() => setOpen(true)}
                    style={{
                        width: '100%',
                        maxWidth: '600px',
                        margin: '0 auto',
                        background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                        borderRadius: 8,
                        padding: '8px 12px',
                        minHeight: 36,
                        minWidth: 0, // allow flex children to shrink for ellipsis
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.1))';
                        e.currentTarget.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.1))';
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary, rgba(255, 255, 255, 0.7))" style={{ display: 'block' }}>
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                    </svg>
                    <span style={{
                        color: search ? 'var(--text-primary, rgba(255, 255, 255, 0.9))' : 'var(--text-secondary, rgba(255, 255, 255, 0.5))',
                        fontSize: 14,
                        flex: 1,
                        textAlign: 'left',
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {search || 'Almighty Search..'}
                    </span>
                </div>
            </div>

            <SearchModal
                isOpen={open}
                onClose={() => setOpen(false)}
                search={search}
                setSearch={setSearch}
                openInSidePanel={openInSidePanel}
            />
        </>
    );
}