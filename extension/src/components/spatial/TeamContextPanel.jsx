import { faBan, faBullseye, faCheck, faExclamationTriangle, faFire, faPause, faPen, faPlay, faWifi } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';
import { p2pSyncService } from '../../services/p2p/syncService';

export default function TeamContextPanel({ teamId }) {
    console.log('[TeamContext] Component rendered with teamId:', teamId);

    const [context, setContext] = useState({
        sprintGoal: '',
        incident: '',
        todaysFocus: '',
        deploymentFreeze: false
    });
    const [isEditing, setIsEditing] = useState(false);
    const [isSyncPaused, setIsSyncPaused] = useState(false);

    // Refs for holding Y.Map and observer
    const mapRef = useRef(null);

    useEffect(() => {
        console.log('[TeamContext] useEffect triggered. teamId:', teamId);
        if (!teamId) {
            console.warn('[TeamContext] No teamId provided, skipping initialization');
            return;
        }

        let observer = null;
        let pMap = null;

        const load = async () => {
            console.log('[TeamContext] Initializing for team:', teamId);
            await p2pStorage.initializeTeamStorage(teamId);
            pMap = p2pStorage.getSharedContext(teamId);
            mapRef.current = pMap;

            const updateState = () => {
                const newContext = {
                    sprintGoal: pMap.get('sprintGoal') || '',
                    incident: pMap.get('incident') || '',
                    todaysFocus: pMap.get('todaysFocus') || '',
                    deploymentFreeze: pMap.get('deploymentFreeze') || false
                };
                console.log('[TeamContext] Updating state:', newContext);
                setContext(newContext);
            };

            updateState();

            observer = () => {
                console.log('[TeamContext] Observer fired!');
                updateState();
            };
            pMap.observe(observer);
            console.log('[TeamContext] Observer attached for team:', teamId);
        };
        load();

        return () => {
            if (pMap && observer) pMap.unobserve(observer);
            mapRef.current = null;
            console.log('[TeamContext] Cleanup for team:', teamId);
        };
    }, [teamId]);

    const handleSave = () => {
        if (mapRef.current) {
            mapRef.current.set('sprintGoal', context.sprintGoal);
            mapRef.current.set('incident', context.incident);
            mapRef.current.set('todaysFocus', context.todaysFocus);
            mapRef.current.set('deploymentFreeze', context.deploymentFreeze);
        }
        setIsEditing(false);
    };

    const toggleFreeze = () => {
        if (mapRef.current) {
            const newVal = !context.deploymentFreeze;
            mapRef.current.set('deploymentFreeze', newVal);
            // Optimistic update handled by observer, but good UX to feel instant
            setContext(prev => ({ ...prev, deploymentFreeze: newVal }));
        }
    };

    // Check sync status on mount and subscribe to changes
    useEffect(() => {
        if (!teamId) return;
        setIsSyncPaused(p2pSyncService.isSyncPaused(teamId));

        const unsubscribe = p2pSyncService.subscribe(() => {
            setIsSyncPaused(p2pSyncService.isSyncPaused(teamId));
        });

        return unsubscribe;
    }, [teamId]);

    const toggleSync = () => {
        if (!teamId) return;

        if (isSyncPaused) {
            p2pSyncService.resumeSync(teamId);
        } else {
            p2pSyncService.pauseSync(teamId);
        }
    };

    return (
        <div style={{
            margin: '16px',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.4) 100%)',
            borderRadius: 20,
            border: context.deploymentFreeze
                ? '1px solid rgba(239, 68, 68, 0.4)'
                : '1px solid rgba(255,255,255,0.08)',
            boxShadow: context.deploymentFreeze
                ? '0 0 0 1px rgba(239, 68, 68, 0.2), 0 12px 32px rgba(239, 68, 68, 0.15)'
                : '0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.05)',
            overflow: 'hidden',
            backdropFilter: 'blur(24px)',
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative'
        }}>
            {/* Background Texture */}
            <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: 'radial-gradient(circle at top right, rgba(255,255,255,0.03) 0%, transparent 40%)',
                pointerEvents: 'none'
            }} />

            {/* Header Status Bar */}
            <div style={{
                padding: '16px 20px',
                background: context.deploymentFreeze
                    ? 'linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%)'
                    : 'rgba(255,255,255,0.02)',
                borderBottom: context.deploymentFreeze
                    ? '1px solid rgba(239, 68, 68, 0.2)'
                    : '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '12px',
                position: 'relative', zIndex: 1
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                        fontSize: 'var(--font-sm)', fontWeight: 700, letterSpacing: '0.08em',
                        color: context.deploymentFreeze ? '#fca5a5' : 'rgba(255,255,255,0.5)',
                        textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', gap: 8
                    }}>
                        <div style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: context.deploymentFreeze ? '#ef4444' : '#10b981',
                            boxShadow: context.deploymentFreeze ? '0 0 8px #ef4444' : '0 0 8px #10b981'
                        }} />
                        Team Context
                    </div>
                </div>

                {context.deploymentFreeze && (
                    <div style={{
                        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                        fontSize: 'var(--font-base)', fontWeight: 800, color: '#fee2e2',
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 16px', background: 'rgba(220, 38, 38, 0.8)',
                        borderRadius: 20,
                        boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
                        animation: 'pulse-freeze 2s infinite',
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap',
                        zIndex: 10
                    }}>
                        <FontAwesomeIcon icon={faBan} />
                        FREEZE
                    </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Sync Toggle Button */}
                    <button
                        onClick={toggleSync}
                        title={isSyncPaused ? 'Resume P2P Sync' : 'Pause P2P Sync'}
                        style={{
                            background: isSyncPaused
                                ? 'rgba(239, 68, 68, 0.15)'
                                : 'rgba(16, 185, 129, 0.15)',
                            border: `1px solid ${isSyncPaused ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                            color: isSyncPaused ? '#fca5a5' : '#6ee7b7',
                            cursor: 'pointer',
                            fontSize: 'var(--font-sm)', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '6px 12px',
                            borderRadius: 8,
                            transition: 'all 0.2s'
                        }}
                    >
                        <FontAwesomeIcon icon={isSyncPaused ? faPlay : faPause} style={{ fontSize: 'var(--font-xs)' }} />
                        <FontAwesomeIcon icon={faWifi} />
                        <span style={{ display: 'none', '@media (min-width: 500px)': { display: 'inline' } }}>
                            {isSyncPaused ? 'Resume' : 'Pause'}
                        </span>
                    </button>

                    <button
                        onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                        style={{
                            background: isEditing
                                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                                : 'rgba(255, 255, 255, 0.06)',
                            border: isEditing ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                            color: isEditing ? '#fff' : 'rgba(255,255,255,0.7)',
                            cursor: 'pointer',
                            fontSize: 'var(--font-sm)', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 14px',
                            borderRadius: 8,
                            transition: 'all 0.2s',
                            boxShadow: isEditing ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none'
                        }}
                        onMouseEnter={e => !isEditing && (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                        onMouseLeave={e => !isEditing && (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    >
                        <FontAwesomeIcon icon={isEditing ? faCheck : faPen} />
                        {isEditing ? 'Save' : 'Edit'}
                    </button>
                </div>
            </div>

            {/* Content Grid */}
            <div style={{
                padding: '20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                gap: 16,
                position: 'relative',
                zIndex: 1
            }}>

                {/* Sprint Goal Card */}
                <div style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 16,
                    padding: 20,
                    border: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', flexDirection: 'column', gap: 12
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 10,
                            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faBullseye} style={{ color: '#fff', fontSize: 'var(--font-xl)' }} />
                        </div>
                        <span style={{ fontSize: 'var(--font-base)', fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Current Sprint Goal</span>
                    </div>

                    {isEditing ? (
                        <textarea
                            value={context.sprintGoal}
                            onChange={e => setContext({ ...context, sprintGoal: e.target.value })}
                            placeholder="What's the main goal for this sprint?"
                            rows={3}
                            style={{
                                background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(59, 130, 246, 0.3)',
                                borderRadius: 10, padding: '12px', color: '#fff', fontSize: 'var(--font-lg)',
                                width: '100%', outline: 'none', resize: 'none', lineHeight: 1.5,
                                fontFamily: 'inherit'
                            }}
                        />
                    ) : (
                        <div style={{
                            fontSize: 'var(--font-2xl)', color: '#e2e8f0', lineHeight: 1.6, fontWeight: 500
                        }}>
                            {context.sprintGoal ? (
                                context.sprintGoal
                            ) : (
                                <span style={{ opacity: 0.4, fontStyle: 'italic', fontSize: 'var(--font-xl)' }}>No sprint goal set yet...</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Today's Focus Card */}
                <div style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 16,
                    padding: 20,
                    border: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', flexDirection: 'column', gap: 12
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 10,
                            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)'
                        }}>
                            <FontAwesomeIcon icon={faFire} style={{ color: '#fff', fontSize: 'var(--font-xl)' }} />
                        </div>
                        <span style={{ fontSize: 'var(--font-base)', fontWeight: 700, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Today's Focus</span>
                    </div>

                    {isEditing ? (
                        <textarea
                            value={context.todaysFocus}
                            onChange={e => setContext({ ...context, todaysFocus: e.target.value })}
                            placeholder="What is the team executing on today?"
                            rows={3}
                            style={{
                                background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(245, 158, 11, 0.3)',
                                borderRadius: 10, padding: '12px', color: '#fff', fontSize: 'var(--font-lg)',
                                width: '100%', outline: 'none', resize: 'none', lineHeight: 1.5,
                                fontFamily: 'inherit'
                            }}
                        />
                    ) : (
                        <div style={{
                            fontSize: 'var(--font-2xl)', color: '#e2e8f0', lineHeight: 1.6, fontWeight: 500
                        }}>
                            {context.todaysFocus ? (
                                context.todaysFocus
                            ) : (
                                <span style={{ opacity: 0.4, fontStyle: 'italic', fontSize: 'var(--font-xl)' }}>No daily focus set...</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Incident Status */}
                {(context.incident || isEditing) && (
                    <div style={{
                        gridColumn: '1 / -1',
                        marginTop: 8,
                        position: 'relative',
                        overflow: 'hidden',
                        borderRadius: 12
                    }}>
                        {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <label style={{ fontSize: 'var(--font-sm)', fontWeight: 700, color: '#fda4af', textTransform: 'uppercase' }}>
                                    Active Incident / Blocker
                                </label>
                                <input
                                    type="text"
                                    value={context.incident}
                                    onChange={e => setContext({ ...context, incident: e.target.value })}
                                    placeholder="Describe any active incidents or blockers..."
                                    style={{
                                        background: 'rgba(69, 10, 10, 0.3)', border: '1px solid rgba(239, 68, 68, 0.3)',
                                        borderRadius: 10, padding: '12px 16px', color: '#fca5a5', fontSize: 'var(--font-xl)',
                                        width: '100%', outline: 'none'
                                    }}
                                />
                            </div>
                        ) : (
                            <div style={{
                                padding: '16px 20px', borderRadius: 12,
                                background: 'linear-gradient(90deg, rgba(220, 38, 38, 0.15) 0%, rgba(220, 38, 38, 0.05) 100%)',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                display: 'flex', alignItems: 'center', gap: 16,
                                position: 'relative', overflow: 'hidden'
                            }}>
                                <div style={{
                                    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                                    background: '#ef4444'
                                }} />
                                <div style={{
                                    width: 36, height: 36, borderRadius: '50%',
                                    background: 'rgba(239, 68, 68, 0.2)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                    boxShadow: '0 0 15px rgba(239, 68, 68, 0.2)',
                                    animation: 'pulse-red 2s infinite'
                                }}>
                                    <FontAwesomeIcon icon={faExclamationTriangle} style={{ color: '#ef4444', fontSize: 'var(--font-2xl)' }} />
                                </div>
                                <div>
                                    <div style={{ fontSize: 'var(--font-xs)', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', marginBottom: 2 }}>
                                        Active Incident
                                    </div>
                                    <div style={{ fontSize: 'var(--font-xl)', color: '#fecaca', fontWeight: 500 }}>
                                        {context.incident}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Editing Footer: Freeze Flag Toggle */}
            {isEditing && (
                <div style={{
                    padding: '16px 24px',
                    background: 'rgba(0,0,0,0.3)',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', gap: 16
                }}>
                    <label style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        cursor: 'pointer', userSelect: 'none',
                        padding: '8px 16px', background: 'rgba(255,255,255,0.05)',
                        borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)',
                        transition: 'all 0.2s'
                    }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    >
                        <div style={{
                            width: 20, height: 20, borderRadius: 4,
                            border: context.deploymentFreeze ? 'none' : '2px solid rgba(255,255,255,0.3)',
                            background: context.deploymentFreeze ? '#ef4444' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            {context.deploymentFreeze && <FontAwesomeIcon icon={faCheck} style={{ color: '#fff', fontSize: 'var(--font-sm)' }} />}
                        </div>
                        <input
                            type="checkbox"
                            checked={context.deploymentFreeze}
                            onChange={e => setContext({ ...context, deploymentFreeze: e.target.checked })}
                            style={{ display: 'none' }}
                        />
                        <span style={{
                            fontSize: 'var(--font-xl)',
                            color: context.deploymentFreeze ? '#ef4444' : '#94a3b8',
                            fontWeight: 600
                        }}>
                            Enable Deployment Freeze
                        </span>
                    </label>
                    <div style={{ fontSize: 'var(--font-base)', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                        This will show a prominent warning on the board.
                    </div>
                </div>
            )}

            <style>{`
                @keyframes pulse-freeze {
                    0% { transform: translateX(-50%) scale(1); box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
                    50% { transform: translateX(-50%) scale(1.05); box-shadow: 0 8px 20px rgba(220, 38, 38, 0.5); }
                    100% { transform: translateX(-50%) scale(1); box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
                }
                @keyframes pulse-red {
                    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
            `}</style>
        </div>
    );
}
