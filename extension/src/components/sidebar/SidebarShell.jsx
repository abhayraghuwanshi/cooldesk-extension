import { faChartPie, faComments, faHome, faStickyNote } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * SidebarShell - "PhoneOS" Layout Container
 * 
 * Features:
 * - Full-height mobile layout
 * - Bottom Glass Dock navigation
 * - View switching
 */
export function SidebarShell({ activeView, onViewChange, children }) {

    // Dock items configuration
    const DOCK_ITEMS = [
        { id: 'home', icon: faHome, label: 'Home' },
        { id: 'chat', icon: faComments, label: 'Chat' },
        { id: 'notes', icon: faStickyNote, label: 'Notes' },
        { id: 'dashboard', icon: faChartPie, label: 'Dash' }, // Overview/Dashboard
    ];

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            width: '100vw',
            overflow: 'hidden',
            background: 'transparent', // Will use theme background
            position: 'relative'
        }}>

            {/* Main Content Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                position: 'relative',
                paddingBottom: '80px', // Space for dock
                zIndex: 1
            }}>
                {children}
            </div>

            {/* Bottom Glass Dock */}
            <div style={{
                position: 'fixed',
                bottom: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100% - 32px)',
                maxWidth: '320px',
                height: '64px',
                background: 'var(--glass-bg)',
                backdropFilter: 'var(--glass-backdrop)',
                borderRadius: '24px',
                border: '1px solid var(--glass-border)',
                boxShadow: 'var(--shadow-xl)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                padding: '0 12px',
                zIndex: 1000
            }}>
                {DOCK_ITEMS.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onViewChange(item.id)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            padding: '8px',
                            width: '56px',
                            cursor: 'pointer',
                            position: 'relative',
                            opacity: activeView === item.id ? 1 : 0.6,
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            transform: activeView === item.id ? 'translateY(-4px)' : 'translateY(0)'
                        }}
                    >
                        {/* Active Indicator Glow */}
                        {activeView === item.id && (
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: '36px',
                                height: '36px',
                                borderRadius: '12px',
                                background: 'rgba(255, 255, 255, 0.1)',
                                zIndex: -1,
                                boxShadow: '0 0 16px rgba(139, 92, 246, 0.3)' // Theme accent color ideally
                            }} />
                        )}

                        <FontAwesomeIcon
                            icon={item.icon}
                            style={{
                                fontSize: '18px',
                                color: activeView === item.id ? 'var(--text)' : 'var(--text-secondary)',
                                filter: activeView === item.id ? 'drop-shadow(0 0 8px var(--accent-primary))' : 'none'
                            }}
                        />
                        <span style={{
                            fontSize: '9px',
                            fontWeight: 500,
                            color: activeView === item.id ? 'var(--text)' : 'var(--text-secondary)'
                        }}>
                            {item.label}
                        </span>

                        {/* Active Dot */}
                        {activeView === item.id && (
                            <div style={{
                                width: '4px',
                                height: '4px',
                                borderRadius: '50%',
                                background: '#fff',
                                position: 'absolute',
                                bottom: '4px',
                                boxShadow: '0 0 4px #fff'
                            }} />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
