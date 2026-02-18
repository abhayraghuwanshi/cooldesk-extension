import { useEffect, useState } from 'react';
import { listWorkspaces } from '../../../db/index.js';
import '../../../styles/theme.css';

export function SidebarDashboard({ onWorkspaceClick }) {
    const [workspaces, setWorkspaces] = useState([]);
    const [selectedWorkspace, setSelectedWorkspace] = useState(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await listWorkspaces();
                // Handle various response formats
                let data = [];
                if (Array.isArray(res)) data = res;
                else if (res?.data && Array.isArray(res.data)) data = res.data;

                setWorkspaces(data);
            } catch (e) {
                console.error('[Dashboard] Error loading workspaces:', e);
            }
        };
        load();
    }, []);

    const handleWorkspaceClick = (ws) => {
        setSelectedWorkspace(ws);
        if (onWorkspaceClick) onWorkspaceClick(ws);
    };

    if (selectedWorkspace) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', paddingTop: '16px' }}>
                <div style={{ padding: '0 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={() => setSelectedWorkspace(null)}
                        className="btn-ghost"
                        style={{ padding: '8px', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        ←
                    </button>
                    <h2 style={{ fontSize: 'var(--font-lg)', margin: 0, color: 'var(--text)' }}>
                        {selectedWorkspace.name}
                    </h2>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedWorkspace.urls && selectedWorkspace.urls.length > 0 ? (
                        selectedWorkspace.urls.map((url, idx) => (
                            <div
                                key={idx}
                                className="glass-card"
                                onClick={() => window.open(typeof url === 'string' ? url : url.url, '_blank')}
                                style={{
                                    padding: '12px', display: 'flex', alignItems: 'center', gap: '12px',
                                    cursor: 'pointer'
                                }}
                            >
                                <div style={{
                                    width: '24px', height: '24px', borderRadius: '6px',
                                    background: 'var(--surface-3)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                    <img
                                        src={`https://www.google.com/s2/favicons?sz=64&domain=${typeof url === 'string' ? url : url.url}`}
                                        alt=""
                                        style={{ width: '16px', height: '16px' }}
                                        onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                </div>
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{
                                        fontSize: 'var(--font-base)', color: 'var(--text)',
                                        whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden'
                                    }}>
                                        {typeof url === 'string' ? url : (url.title || url.url)}
                                    </div>
                                    <div style={{
                                        fontSize: 'var(--font-xs)', color: 'var(--text-muted)',
                                        whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden'
                                    }}>
                                        {typeof url === 'string' ? url : url.url}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px' }}>
                            No tabs in this workspace.
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Greeting Card */}
            <div className="glass-card" style={{
                padding: '20px',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                border: 'none'
            }}>
                <h2 style={{ fontSize: 'var(--font-2xl)', margin: '0 0 4px 0', color: 'var(--text)' }}>Hello!</h2>
                <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>
                    Ready to be productive?
                </div>
            </div>

            {/* Recent Workspaces */}
            <div>
                <h3 style={{
                    fontSize: 'var(--font-sm)', textTransform: 'uppercase',
                    color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '12px'
                }}>
                    Recent Spaces
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {workspaces.slice(0, 5).map(ws => (
                        <div
                            key={ws.id}
                            className="glass-card"
                            onClick={() => handleWorkspaceClick(ws)}
                            style={{
                                padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '10px',
                                background: 'var(--surface-3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 'var(--font-lg)'
                            }}>
                                {ws.icon || '📁'}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 'var(--font-base)', fontWeight: 600, color: 'var(--text)' }}>
                                    {ws.name}
                                </div>
                                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                                    {ws.urls?.length || 0} tabs
                                </div>
                            </div>
                        </div>
                    ))}
                    {workspaces.length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', fontStyle: 'italic' }}>
                            No workspaces found.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
