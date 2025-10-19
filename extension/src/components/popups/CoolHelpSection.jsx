import {
    faBook,
    faComments,
    faFolder,
    faLightbulb,
    faMicrophone,
    faRocket,
    faTableCellsLarge,
    faThumbtack,
    faTimes
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { createPortal } from 'react-dom';

export function CoolHelpSection({ isOpen, onClose }) {
    if (!isOpen) return null;

    const features = [
        {
            icon: faThumbtack,
            title: 'Pins',
            desc: 'Quick access to your most important links',
            howTo: 'Right-click any link → Pin. Pinned items appear at the top of your dashboard.',
            modify: 'Right-click pinned items to unpin or manage them.',
        },
        {
            icon: faBook,
            title: 'Activity',
            desc: 'Track your browsing history and time spent',
            howTo: 'Automatically tracks all your web activity. View in the Activity tab.',
            modify: 'Clear history from Settings → Privacy.',
        },
        {
            icon: faRocket,
            title: 'Pinned Workspaces',
            desc: 'Keep important workspaces at the top',
            howTo: 'Right-click any workspace → Pin to Pinned Workspaces.',
            modify: 'Right-click to unpin or delete workspace.',
        },
        {
            icon: faFolder,
            title: 'Workspace List',
            desc: 'Organize tabs and links by project',
            howTo: 'Click + button to create workspace. Add current tab or paste URLs.',
            modify: 'Right-click workspace to rename, pin, or delete.',
        },
        {
            icon: faTableCellsLarge,
            title: 'Tabs',
            desc: 'Manage all open browser tabs',
            howTo: 'View all tabs in one place. Click to switch, close, or organize.',
            modify: 'Drag to reorder, right-click for options.',
        },
        {
            icon: faMicrophone,
            title: 'Voice Navigation',
            desc: 'Control browser with voice commands',
            howTo: 'Click microphone icon. Say "show numbers" to see clickable elements.',
            modify: 'Say commands like "scroll down", "click 5", "go back".',
        },
        {
            icon: faComments,
            title: 'AI Chats',
            desc: 'Auto-save ChatGPT, Claude, Gemini & Grok',
            howTo: 'Automatically scrapes chats when you visit AI platforms.',
            modify: 'Search, filter by platform, or delete from AI Chats section.',
        },
        {
            icon: faLightbulb,
            title: 'Todo & Thoughts',
            desc: 'Daily notes and task management',
            howTo: 'Click date to add notes. Select text on any page to save.',
            modify: 'Edit notes directly, delete selections, or export data.',
        },
    ];

    const modal = (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(12px)',
                zIndex: 2147483647,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            onDoubleClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    background: 'var(--glass-bg, rgba(15, 21, 34, 0.95))',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '20px',
                    width: '90vw',
                    maxWidth: '700px',
                    maxHeight: '85vh',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                    margin: 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '20px 28px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <FontAwesomeIcon
                            icon={faBook}
                            style={{ fontSize: '24px', color: '#7c3aed' }}
                        />
                        <h2
                            style={{
                                margin: 0,
                                fontSize: '22px',
                                fontWeight: 600,
                                color: 'rgba(255, 255, 255, 0.95)',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                                letterSpacing: '-0.5px',
                            }}
                        >
                            CoolDesk Help
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            color: 'rgba(255, 255, 255, 0.7)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.95)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                        }}
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                {/* Scrollable Features Content */}
                <div
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        padding: '28px',
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {features.map((feature, idx) => (
                            <div
                                key={idx}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.04)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '16px',
                                    padding: '28px 24px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                    transition: 'all 0.2s',
                                    cursor: 'default',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                    e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                                    <FontAwesomeIcon
                                        icon={feature.icon}
                                        style={{
                                            fontSize: '28px',
                                            color: '#7c3aed',
                                            filter: 'drop-shadow(0 0 10px rgba(124, 58, 237, 0.4))',
                                            marginTop: '4px',
                                        }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <div
                                            style={{
                                                fontSize: '20px',
                                                fontWeight: 600,
                                                color: 'rgba(255, 255, 255, 0.95)',
                                                marginBottom: '8px',
                                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                                                letterSpacing: '-0.4px',
                                            }}
                                        >
                                            {feature.title}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '15px',
                                                color: 'rgba(255, 255, 255, 0.7)',
                                                lineHeight: '1.6',
                                                marginBottom: '12px',
                                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                                            }}
                                        >
                                            {feature.desc}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '14px',
                                                color: 'rgba(255, 255, 255, 0.85)',
                                                lineHeight: '1.7',
                                                marginBottom: '8px',
                                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                                            }}
                                        >
                                            <span style={{ fontWeight: 600, color: 'rgba(124, 58, 237, 0.9)' }}>How to use:</span> {feature.howTo}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '14px',
                                                color: 'rgba(255, 255, 255, 0.85)',
                                                lineHeight: '1.7',
                                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                                            }}
                                        >
                                            <span style={{ fontWeight: 600, color: 'rgba(52, 199, 89, 0.9)' }}>Modify:</span> {feature.modify}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}
