import { faExternalLinkAlt, faLink, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getFaviconUrl } from '../../utils/helpers';

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
        width: '380px',
        maxHeight: '520px',
        background: '#1a1d24',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '0',
        boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        zIndex: 20000,
        color: '#F1F5F9',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'popoverIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    };

    // Adjust if going off-screen
    if (window.innerHeight - triggerRect.bottom < 520) {
        style.top = 'auto';
        style.bottom = `${window.innerHeight - triggerRect.top + 12}px`;
    }
    if (triggerRect.left + 380 > window.innerWidth) {
        style.left = 'auto';
        style.right = '24px';
    }

    // Get group info
    const label = group.label || group.domain;
    const subLabel = group.subLabel || (group.domain !== label ? group.domain : null);
    const headerFavicon = getFaviconUrl(group.primaryUrl || group.urls[0]?.url, 64);

    return createPortal(
        <>
            <style>{`
        @keyframes popoverIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .popover-item:hover {
          background: rgba(255, 255, 255, 0.06) !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
        }
        .popover-item:hover .external-icon {
          color: #F1F5F9 !important;
        }
      `}</style>
            <div
                className="grouped-links-popover"
                style={style}
                ref={popoverRef}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '24px 20px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    background: 'rgba(255, 255, 255, 0.02)'
                }}>
                    {/* Header Icon */}
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        flexShrink: 0,
                        overflow: 'hidden'
                    }}>
                        {headerFavicon ? (
                            <img src={headerFavicon} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                        ) : (
                            <FontAwesomeIcon icon={faLink} color="#94A3B8" size="lg" />
                        )}
                    </div>

                    {/* Header Text */}
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{
                            fontSize: '18px',
                            fontWeight: 700,
                            color: '#F8FAFC',
                            marginBottom: '2px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}>
                            {label}
                        </div>
                        <div style={{
                            fontSize: '13px',
                            color: '#94A3B8',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>{subLabel || group.domain}</span>
                            <span style={{ color: '#475569' }}>·</span>
                            <span>{group.urls.length} items</span>
                        </div>
                    </div>

                    {/* Close Button */}
                    <div
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        style={{
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            color: '#64748B',
                            transition: 'all 0.2s',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                            e.currentTarget.style.color = '#F1F5F9';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.color = '#64748B';
                        }}
                    >
                        <FontAwesomeIcon icon={faTimes} size="sm" />
                    </div>
                </div>

                {/* List */}
                <div className="custom-scrollbar" style={{
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    overflowY: 'auto'
                }}>
                    {group.urls.map((urlObj, idx) => {
                        const faviconUrl = getFaviconUrl(urlObj.url, 48);
                        return (
                            <div
                                key={idx}
                                className="popover-item"
                                onClick={() => window.open(urlObj.url, '_blank')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    padding: '16px 14px',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                                    background: 'transparent',
                                    border: '1px solid transparent',
                                    textDecoration: 'none'
                                }}
                            >
                                {/* Icon */}
                                <div style={{
                                    width: '44px',
                                    height: '44px',
                                    flexShrink: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#fff',
                                    borderRadius: '10px',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                                    overflow: 'hidden'
                                }}>
                                    {faviconUrl ? (
                                        <img src={faviconUrl} alt="" style={{ width: '30px', height: '30px', objectFit: 'contain' }} />
                                    ) : (
                                        <FontAwesomeIcon icon={faLink} size="sm" color="#64748B" />
                                    )}
                                </div>

                                {/* Title/URL */}
                                <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '15px',
                                        fontWeight: 600,
                                        color: '#F1F5F9',
                                        marginBottom: '2px',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {urlObj.title || new URL(urlObj.url).hostname}
                                    </div>
                                    <div style={{
                                        fontSize: '13px',
                                        color: '#64748B',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {new URL(urlObj.url).hostname}
                                    </div>
                                </div>

                                {/* External Link Icon */}
                                <div className="external-icon" style={{
                                    color: '#334155',
                                    transition: 'color 0.2s',
                                    padding: '4px'
                                }}>
                                    <FontAwesomeIcon icon={faExternalLinkAlt} style={{ fontSize: '14px' }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>,
        document.body
    );
}
