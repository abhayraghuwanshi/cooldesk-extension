import { faExternalLinkAlt, faLink, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getFaviconUrl } from '../../utils';

export function GroupedLinksPopover({ group, onClose, triggerRect }) {
    const popoverRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    if (!triggerRect || !group) return null;

    // Calculate position
    const style = {
        position: 'fixed',
        top: `${triggerRect.bottom + 12}px`,
        left: `${triggerRect.left}px`,
        width: '320px',
        maxHeight: '400px',
        overflowY: 'auto',
        background: 'rgba(30, 41, 59, 0.95)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '0',
        boxShadow: '0 20px 40px -5px rgba(0, 0, 0, 0.6), 0 0 1px rgba(255,255,255,0.1)',
        zIndex: 9999,
        color: '#F1F5F9',
        display: 'flex',
        flexDirection: 'column',
    };

    // Adjust if going off-screen
    if (window.innerHeight - triggerRect.bottom < 400) {
        style.top = 'auto';
        style.bottom = `${window.innerHeight - triggerRect.top + 12}px`;
    }
    if (triggerRect.left + 320 > window.innerWidth) {
        style.left = 'auto';
        style.right = '24px';
    }

    // Get group info
    const label = group.label || group.domain;
    const subLabel = group.subLabel || (group.domain !== label ? group.domain : null);
    const headerFavicon = getFaviconUrl(group.primaryUrl || group.urls[0]?.url, 24);

    return createPortal(
        <div
            className="grouped-links-popover"
            style={style}
            ref={popoverRef}
            onClick={e => e.stopPropagation()}
        >
            {/* Header */}
            <div style={{
                padding: '16px 16px 12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                position: 'relative' // For absolute close button if needed, or flex
            }}>
                {/* Header Icon */}
                <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    flexShrink: 0
                }}>
                    {headerFavicon ? (
                        <img src={headerFavicon} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px' }} />
                    ) : (
                        <FontAwesomeIcon icon={faLink} color="#94A3B8" />
                    )}
                </div>

                {/* Header Text */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#F8FAFC',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {label}
                    </div>
                    {(subLabel || group.domain) && (
                        <div style={{
                            fontSize: '11px',
                            color: '#94A3B8',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}>
                            <span>{subLabel || group.domain}</span>
                            <span style={{
                                width: '3px',
                                height: '3px',
                                borderRadius: '50%',
                                background: '#475569'
                            }} />
                            <span>{group.urls.length} items</span>
                        </div>
                    )}
                </div>

                {/* Close Button */}
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    style={{
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        color: '#94A3B8',
                        transition: 'all 0.2s',
                        background: 'rgba(255,255,255,0.05)'
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.color = '#F1F5F9';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                        e.currentTarget.style.color = '#94A3B8';
                    }}
                >
                    <FontAwesomeIcon icon={faTimes} size="sm" />
                </div>
            </div>

            {/* List */}
            <div className="custom-scrollbar" style={{
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                maxHeight: '320px',
                overflowY: 'auto'
            }}>
                {group.urls.map((urlObj, idx) => {
                    const faviconUrl = getFaviconUrl(urlObj.url, 16);
                    return (
                        <div
                            key={idx}
                            onClick={() => window.open(urlObj.url, '_blank')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '10px 12px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                background: 'transparent',
                                border: '1px solid transparent',
                                textDecoration: 'none'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.borderColor = 'transparent';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
                            {/* Icon */}
                            <div style={{
                                width: '20px',
                                height: '20px',
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255, 255, 255, 0.03)',
                                borderRadius: '6px'
                            }}>
                                {faviconUrl ? (
                                    <img src={faviconUrl} alt="" style={{ width: 'var(--font-5xl)', height: 'var(--font-5xl)', objectFit: 'contain' }} />
                                ) : (
                                    <FontAwesomeIcon icon={faLink} size="xs" color="#64748B" />
                                )}
                            </div>

                            {/* Title/URL */}
                            <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                                <div style={{
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    color: '#E2E8F0',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {urlObj.title || new URL(urlObj.url).pathname.split('/').pop() || 'Untitled'}
                                </div>
                                <div style={{
                                    fontSize: '11px',
                                    color: '#64748B',
                                    marginTop: '2px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {new URL(urlObj.url).pathname !== '/' ? new URL(urlObj.url).pathname : new URL(urlObj.url).hostname}
                                </div>
                            </div>

                            {/* External Link Icon */}
                            <FontAwesomeIcon icon={faExternalLinkAlt} style={{ fontSize: '10px', color: '#475569' }} />
                        </div>
                    );
                })}
            </div>
        </div>,
        document.body
    );
}
