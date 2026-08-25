// Folders & Index — the app-level folder registry from `folder_index.rs`.
// Not an OS permission grant (no security-scoped bookmarks / entitlements):
// just a list of folders the user has explicitly linked, each with its own
// enabled/exclude/auto-reindex settings, that `search_files` folds into its
// scan targets alongside the built-in home/Desktop/Downloads/Documents set.

import { faFolderOpen, faFolderPlus, faRocket, faRotate, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';

async function invoke(cmd, args) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke(cmd, args);
}

const AUTO_REINDEX_OPTIONS = [
    { value: 0, label: 'Manual only' },
    { value: 15, label: 'Every 15 min' },
    { value: 60, label: 'Every hour' },
    { value: 360, label: 'Every 6 hours' },
    { value: 1440, label: 'Daily' },
];

export default function FolderIndexTab() {
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [reindexing, setReindexing] = useState({}); // path -> bool
    const [error, setError] = useState('');

    const load = async () => {
        try {
            const list = await invoke('folder_index_list');
            setFolders(list || []);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleAdd = async () => {
        setError('');
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const picked = await open({ directory: true, multiple: false, title: 'Link a folder to CoolDesk search' });
            if (!picked) return;
            setAdding(true);
            const list = await invoke('folder_index_add', { path: picked });
            setFolders(list);
        } catch (e) {
            setError(String(e?.message || e));
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (path) => {
        const list = await invoke('folder_index_remove', { path });
        setFolders(list);
    };

    const handleReindex = async (path) => {
        setReindexing((r) => ({ ...r, [path]: true }));
        try {
            const updated = await invoke('folder_index_reindex', { path });
            setFolders((prev) => prev.map((f) => (f.path === path ? updated : f)));
        } catch (e) {
            setError(String(e?.message || e));
        } finally {
            setReindexing((r) => ({ ...r, [path]: false }));
        }
    };

    const handleReindexAll = async () => {
        setReindexing(Object.fromEntries(folders.map((f) => [f.path, true])));
        try {
            const list = await invoke('folder_index_reindex_all');
            setFolders(list);
        } finally {
            setReindexing({});
        }
    };

    const setOptions = async (path, patch) => {
        // Optimistic update so toggles/dropdowns feel instant.
        setFolders((prev) => prev.map((f) => (f.path === path ? { ...f, ...patch } : f)));
        try {
            await invoke('folder_index_set_options', { path, ...patch });
        } catch (e) {
            setError(String(e?.message || e));
            load();
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{
                padding: 16,
                background: 'rgba(59, 130, 246, 0.08)',
                borderRadius: 12,
                border: '1px solid rgba(59, 130, 246, 0.15)',
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)',
                lineHeight: 1.6,
            }}>
                Folder search normally only covers your home folder and well-known places
                (Desktop, Downloads, Documents). Link a folder here — an external drive, a
                mounted share, a project root elsewhere — to include it too. Turn on
                "Include apps" for a folder that has app installs the standard app list
                misses (a portable-apps folder, an external drive's Applications dir, ...).
                This is an app-level list, not an OS permission grant: nothing is requested
                from the system, CoolDesk just remembers which folders you've pointed it at.
            </div>

            {error && (
                <div style={{
                    padding: '10px 14px', borderRadius: 10,
                    background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: '#f87171', fontSize: 13,
                }}>
                    {error}
                </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
                <button
                    onClick={handleAdd}
                    disabled={adding}
                    style={{
                        padding: '9px 16px', borderRadius: 10, border: 'none',
                        background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                        color: '#fff', fontSize: 13, fontWeight: 500,
                        cursor: adding ? 'wait' : 'pointer', opacity: adding ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}
                >
                    <FontAwesomeIcon icon={faFolderPlus} />
                    {adding ? 'Linking…' : 'Link a folder'}
                </button>
                {folders.length > 0 && (
                    <button
                        onClick={handleReindexAll}
                        style={{
                            padding: '9px 14px', borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)',
                            color: '#fff', fontSize: 13, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}
                    >
                        <FontAwesomeIcon icon={faRotate} />
                        Reindex all
                    </button>
                )}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    Loading…
                </div>
            ) : folders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.4)' }}>
                    <FontAwesomeIcon icon={faFolderOpen} style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }} />
                    <p style={{ margin: 0, fontSize: 13 }}>No folders linked yet.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {folders.map((f) => (
                        <FolderRow
                            key={f.path}
                            folder={f}
                            reindexing={!!reindexing[f.path]}
                            onReindex={() => handleReindex(f.path)}
                            onRemove={() => handleRemove(f.path)}
                            onSetOptions={(patch) => setOptions(f.path, patch)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FolderRow({ folder, reindexing, onReindex, onRemove, onSetOptions }) {
    const [excludeText, setExcludeText] = useState((folder.exclude || []).join(', '));

    useEffect(() => {
        setExcludeText((folder.exclude || []).join(', '));
    }, [folder.path]);

    const commitExclude = () => {
        const next = excludeText.split(',').map((s) => s.trim()).filter(Boolean);
        onSetOptions({ exclude: next });
    };

    return (
        <div style={{
            padding: 14,
            background: folder.enabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.01)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            opacity: folder.enabled ? 1 : 0.55,
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}>
                    <FontAwesomeIcon icon={faFolderOpen} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', wordBreak: 'break-all' }}>
                        {folder.path}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                        {folder.status
                            ? folder.status
                            : folder.last_indexed
                                ? `${folder.file_count ?? 0} files · indexed ${folder.last_indexed}`
                                : 'Not indexed yet'}
                    </div>

                    <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select
                            value={folder.auto_reindex_minutes || 0}
                            onChange={(e) => onSetOptions({ auto_reindex_minutes: Number(e.target.value) })}
                            style={{
                                padding: '6px 8px', borderRadius: 8,
                                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', fontSize: 12, outline: 'none', cursor: 'pointer',
                            }}
                        >
                            {AUTO_REINDEX_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>

                        <input
                            value={excludeText}
                            onChange={(e) => setExcludeText(e.target.value)}
                            onBlur={commitExclude}
                            placeholder="Exclude (comma-separated), e.g. logs, cache"
                            style={{
                                flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 8,
                                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', fontSize: 12, outline: 'none',
                            }}
                        />

                        <button
                            onClick={() => onSetOptions({ include_apps: !folder.include_apps })}
                            title="Also scan this folder for apps"
                            style={{
                                padding: '6px 10px', borderRadius: 8,
                                border: folder.include_apps ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
                                background: folder.include_apps ? 'rgba(59,130,246,0.15)' : 'rgba(0,0,0,0.3)',
                                color: folder.include_apps ? '#93c5fd' : 'rgba(255,255,255,0.55)',
                                fontSize: 12, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                            }}
                        >
                            <FontAwesomeIcon icon={faRocket} />
                            Include apps
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                    <button
                        onClick={() => onSetOptions({ enabled: !folder.enabled })}
                        title={folder.enabled ? 'Disable' : 'Enable'}
                        style={{
                            width: 40, height: 22, borderRadius: 11, border: 'none',
                            background: folder.enabled ? '#3b82f6' : 'rgba(255,255,255,0.15)',
                            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                        }}
                    >
                        <div style={{
                            width: 16, height: 16, borderRadius: 8, background: '#fff',
                            position: 'absolute', top: 3, left: folder.enabled ? 21 : 3,
                            transition: 'left 0.2s',
                        }} />
                    </button>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            onClick={onReindex}
                            disabled={reindexing}
                            title="Reindex now"
                            style={{
                                padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.04)', color: '#fff',
                                cursor: reindexing ? 'wait' : 'pointer', fontSize: 12,
                            }}
                        >
                            <FontAwesomeIcon icon={faRotate} spin={reindexing} />
                        </button>
                        <button
                            onClick={onRemove}
                            title="Remove"
                            style={{
                                padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.25)',
                                background: 'rgba(239, 68, 68, 0.08)', color: '#f87171',
                                cursor: 'pointer', fontSize: 12,
                            }}
                        >
                            <FontAwesomeIcon icon={faTrash} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
