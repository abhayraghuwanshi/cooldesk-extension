import { faServer, faStickyNote } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';

/**
 * Component to display saved-data and server-data from team database
 */
export default function TeamDataDisplay({ teamId, canWrite }) {
    const [savedData, setSavedData] = useState([]);
    const [serverData, setServerData] = useState([]);

    useEffect(() => {
        if (!teamId) {
            setSavedData([]);
            setServerData([]);
            return;
        }

        try {
            // Load saved data
            const savedDataArray = p2pStorage.getSharedSavedData(teamId);
            setSavedData(savedDataArray.toArray());

            // Subscribe to changes
            const savedDataObserver = () => {
                setSavedData(savedDataArray.toArray());
                console.log('[TeamDataDisplay] Saved data updated:', savedDataArray.length);
            };
            savedDataArray.observe(savedDataObserver);

            // Load server data
            const serverDataArray = p2pStorage.getSharedServerData(teamId);
            setServerData(serverDataArray.toArray());

            // Subscribe to changes
            const serverDataObserver = () => {
                setServerData(serverDataArray.toArray());
                console.log('[TeamDataDisplay] Server data updated:', serverDataArray.length);
            };
            serverDataArray.observe(serverDataObserver);

            console.log('[TeamDataDisplay] Loaded data for team:', teamId);
            console.log('  - Saved data:', savedDataArray.length, 'items');
            console.log('  - Server data:', serverDataArray.length, 'items');

            // Cleanup
            return () => {
                savedDataArray.unobserve(savedDataObserver);
                serverDataArray.unobserve(serverDataObserver);
            };
        } catch (error) {
            console.error('[TeamDataDisplay] Error loading data:', error);
        }
    }, [teamId]);

    return (
        <>
            {/* Saved Data Section */}
            <div style={{ padding: '0 20px', marginTop: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <FontAwesomeIcon icon={faStickyNote} style={{ color: '#10b981', opacity: 0.8 }} />
                    <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 600, margin: 0, color: '#e5e7eb' }}>
                        Saved Data
                    </h2>
                    <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,0.06)' }} />
                    <span style={{ fontSize: 'var(--font-sm)', opacity: 0.5 }}>{savedData.length} items</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {savedData.length === 0 ? (
                        <div style={{
                            gridColumn: '1 / -1',
                            textAlign: 'center', padding: '40px 20px',
                            color: 'rgba(255,255,255,0.3)', border: '2px dashed rgba(255,255,255,0.05)',
                            borderRadius: 16, background: 'rgba(0,0,0,0.1)'
                        }}>
                            <div style={{ fontSize: 'var(--font-sm)', opacity: 0.7 }}>No saved data yet.</div>
                            {canWrite && (
                                <div style={{ fontSize: 'var(--font-xs)', opacity: 0.5, marginTop: 8 }}>
                                    Use p2pStorage.addSavedData() to add items
                                </div>
                            )}
                        </div>
                    ) : (
                        savedData.map((item, index) => (
                            <div
                                key={item.id || index}
                                style={{
                                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)',
                                    borderRadius: 16, padding: 16,
                                    border: '1px solid rgba(16, 185, 129, 0.2)',
                                    position: 'relative', overflow: 'hidden',
                                    transition: 'all 0.2s',
                                    display: 'flex', flexDirection: 'column', gap: 8
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8 }}>
                                    <div style={{
                                        fontSize: 'var(--font-lg)', fontWeight: 600, color: '#fff',
                                        lineHeight: 1.4,
                                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                    }}>
                                        {item.title || 'Untitled'}
                                    </div>
                                </div>
                                <div style={{ fontSize: 'var(--font-xs)', color: '#10b981', fontWeight: 600, textTransform: 'uppercase' }}>
                                    {item.type}
                                </div>
                                {item.content && (
                                    <div style={{
                                        fontSize: 'var(--font-sm)', color: 'rgba(255,255,255,0.6)',
                                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                    }}>
                                        {item.content}
                                    </div>
                                )}
                                {item.url && (
                                    <a href={item.url} target="_blank" rel="noreferrer" style={{
                                        fontSize: 'var(--font-xs)', color: '#10b981', textDecoration: 'none',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                    }}>
                                        {item.url}
                                    </a>
                                )}
                                {item.tags && item.tags.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        {item.tags.map((tag, i) => (
                                            <span key={i} style={{
                                                fontSize: 'var(--font-xs)', background: 'rgba(16, 185, 129, 0.2)',
                                                color: '#10b981', padding: '2px 6px', borderRadius: 4
                                            }}>
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-xs)', opacity: 0.5 }}>
                                    <span>{item.createdBy || 'Unknown'}</span>
                                    <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Just now'}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Server Data Section */}
            <div style={{ padding: '0 20px', marginTop: 32, marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <FontAwesomeIcon icon={faServer} style={{ color: '#f59e0b', opacity: 0.8 }} />
                    <h2 style={{ fontSize: 'var(--font-xl)', fontWeight: 600, margin: 0, color: '#e5e7eb' }}>
                        Server Data
                    </h2>
                    <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,0.06)' }} />
                    <span style={{ fontSize: 'var(--font-sm)', opacity: 0.5 }}>{serverData.length} items</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {serverData.length === 0 ? (
                        <div style={{
                            gridColumn: '1 / -1',
                            textAlign: 'center', padding: '40px 20px',
                            color: 'rgba(255,255,255,0.3)', border: '2px dashed rgba(255,255,255,0.05)',
                            borderRadius: 16, background: 'rgba(0,0,0,0.1)'
                        }}>
                            <div style={{ fontSize: 'var(--font-sm)', opacity: 0.7 }}>No server data yet.</div>
                            {canWrite && (
                                <div style={{ fontSize: 'var(--font-xs)', opacity: 0.5, marginTop: 8 }}>
                                    Use p2pStorage.addServerData() to add items
                                </div>
                            )}
                        </div>
                    ) : (
                        serverData.map((item, index) => (
                            <div
                                key={item.id || index}
                                style={{
                                    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)',
                                    borderRadius: 16, padding: 16,
                                    border: '1px solid rgba(245, 158, 11, 0.2)',
                                    position: 'relative', overflow: 'hidden',
                                    transition: 'all 0.2s',
                                    display: 'flex', flexDirection: 'column', gap: 8
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8 }}>
                                    <div style={{
                                        fontSize: 'var(--font-lg)', fontWeight: 600, color: '#fff',
                                        lineHeight: 1.4
                                    }}>
                                        {item.source || 'Unknown Source'}
                                    </div>
                                    <div style={{
                                        fontSize: 'var(--font-xs)',
                                        background: item.status === 'processed' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                        color: item.status === 'processed' ? '#10b981' : '#f59e0b',
                                        padding: '2px 6px', borderRadius: 4, fontWeight: 600, textTransform: 'uppercase'
                                    }}>
                                        {item.status || 'pending'}
                                    </div>
                                </div>
                                <div style={{ fontSize: 'var(--font-xs)', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase' }}>
                                    {item.type}
                                </div>
                                <div style={{
                                    fontSize: 'var(--font-sm)', color: 'rgba(255,255,255,0.6)',
                                    maxHeight: 60, overflow: 'hidden'
                                }}>
                                    <pre style={{ margin: 0, fontSize: 'var(--font-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {JSON.stringify(item.payload, null, 2).substring(0, 100)}...
                                    </pre>
                                </div>
                                <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-xs)', opacity: 0.5 }}>
                                    <span>{item.source}</span>
                                    <span>{item.processedAt ? new Date(item.processedAt).toLocaleDateString() : 'Just now'}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
}
