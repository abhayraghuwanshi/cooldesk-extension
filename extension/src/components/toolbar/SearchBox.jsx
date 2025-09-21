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
                        backdropFilter: 'blur(20px)',
                        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
                        borderRadius: '12px',
                        padding: '12px 20px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.background = 'var(--glass-bg-hover, rgba(255, 255, 255, 0.15))';
                        e.target.style.borderColor = 'var(--border-hover, rgba(255, 255, 255, 0.3))';
                        e.target.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.1))';
                        e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.2))';
                        e.target.style.transform = 'translateY(0)';
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary, rgba(255, 255, 255, 0.7))">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                    </svg>
                    <span style={{
                        color: search ? 'var(--text-primary, rgba(255, 255, 255, 0.9))' : 'var(--text-secondary, rgba(255, 255, 255, 0.5))',
                        fontSize: '16px',
                        flex: 1,
                        textAlign: 'left'
                    }}>
                        {search || 'Almighty Search..'}
                    </span>
                    <div style={{
                        background: 'var(--surface-2, rgba(255, 255, 255, 0.1))',
                        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '12px',
                        color: 'var(--text-dim, rgba(255, 255, 255, 0.6))',
                        fontWeight: '500'
                    }}>
                        ⇧⇧
                    </div>
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