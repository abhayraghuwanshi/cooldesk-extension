import { faCode, faPlay, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SIDECAR_HTTP } from '../../../shared/config/sidecar.js';
import { joinProjectPath } from '../../../shared/hooks/useCooldeskItems.js';
import { buildLocalGroups, parseLocal, startCommands } from './localServersModel.js';
import { TileIcon } from './TileIcon.jsx';

// "Local" tab: dev servers grouped by project (see localServersModel.js).
//
// Liveness and ownership come from the sidecar's /local/servers (which
// process listens on each port, from which project folder, launched by
// whom). Without it — the extension running without the desktop app — each
// port is probed for reachability instead, and grouping falls back to title.
//
// Start/Stop run real commands, so both are desktop-only Tauri calls and
// always need an explicit click plus a confirm — never an HTTP route, never
// automatic.

const POLL_MS = 5000;
const FAST_POLL_MS = 1500;      // while a server we started is coming up
const START_WATCH_MS = 60_000;  // stop waiting for it after this
const PROBE_TIMEOUT_MS = 1200;
const PROBE_MAX = 24;

const isTauri = () => typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
const LAUNCHER_NAMES = { claude: 'Claude', codex: 'Codex', opencode: 'opencode', aider: 'Aider', gemini: 'Gemini', 'cursor-agent': 'Cursor' };

async function fetchServers() {
    try {
        const res = await fetch(`${SIDECAR_HTTP}/local/servers`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return null;
        const body = await res.json();
        return Array.isArray(body?.servers) ? body : null;
    } catch {
        return null; // no desktop app running
    }
}

// Reachable = anything answered (opaque responses count); refused/timeout = down.
async function probePort(port) {
    try {
        await fetch(`http://localhost:${port}/`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        return true;
    } catch {
        return false;
    }
}

function ago(ts) {
    if (!ts) return '';
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export function LocalServers({ tabs, history, active, onOpen, onCloseTab }) {
    const desktop = isTauri();
    const [data, setData] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [probe, setProbe] = useState(() => new Map());
    const [starting, setStarting] = useState({});   // group key → { until, cmd }
    const [confirm, setConfirm] = useState(null);   // { kind: 'start'|'stop', key, port?, cmds? }
    const [showOld, setShowOld] = useState(false);
    const [notice, setNotice] = useState(null);
    const noticeTimer = useRef(null);

    const flash = useCallback((text) => {
        setNotice(text);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    }, []);
    useEffect(() => () => clearTimeout(noticeTimer.current), []);

    const refresh = useCallback(async () => {
        setData(await fetchServers());
        setLoaded(true);
    }, []);

    // Poll only while the tab is visible; faster while a start is pending.
    const fast = Object.values(starting).some(s => s.until > Date.now());
    useEffect(() => {
        if (!active) return undefined;
        refresh();
        const id = setInterval(refresh, fast ? FAST_POLL_MS : POLL_MS);
        return () => clearInterval(id);
    }, [active, fast, refresh]);

    // No sidecar → probe the loopback ports we know about.
    const ports = useMemo(() => {
        const set = new Set();
        for (const x of [...(tabs || []), ...(history || [])]) {
            const loc = x?.url && parseLocal(x.url);
            if (loc?.loopback) set.add(loc.port);
        }
        return [...set].slice(0, PROBE_MAX);
    }, [tabs, history]);
    useEffect(() => {
        if (!active || !loaded || data || !ports.length) return undefined;
        let alive = true;
        const run = async () => {
            const results = await Promise.all(ports.map(async p => [p, await probePort(p)]));
            if (alive) setProbe(new Map(results));
        };
        run();
        const id = setInterval(run, POLL_MS * 2);
        return () => { alive = false; clearInterval(id); };
    }, [active, loaded, data, ports]);

    const groups = useMemo(
        () => buildLocalGroups({ tabs: tabs || [], history: history || [], data, probe }),
        [tabs, history, data, probe]
    );

    // A pending start resolves once its project has a live port (or times out).
    useEffect(() => {
        setStarting(prev => {
            let changed = false;
            const next = { ...prev };
            for (const [key, s] of Object.entries(prev)) {
                const g = groups.find(x => x.key === key);
                if ((g && g.running) || s.until < Date.now()) { delete next[key]; changed = true; }
            }
            return changed ? next : prev;
        });
    }, [groups]);

    const openEntry = (entry) => {
        if (!entry) return;
        onOpen(entry.url, entry.tab ? { id: `tab_${entry.tab.id}`, url: entry.url } : { url: entry.url });
    };

    const runStart = async (g, cmd) => {
        setConfirm(null);
        const cwd = cmd.cwd && cmd.cwd !== '.' ? joinProjectPath(g.root, cmd.cwd) : g.root;
        if (!desktop) {
            try { await navigator.clipboard.writeText(cmd.run); } catch { /* clipboard blocked */ }
            flash(`Copied "${cmd.run}" — run it in ${cwd}, or start it from the CoolDesk app.`);
            return;
        }
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('run_project_command', { command: cmd.run, cwd });
            setStarting(prev => ({ ...prev, [g.key]: { until: Date.now() + START_WATCH_MS, cmd: cmd.run } }));
        } catch (e) {
            flash(`Couldn't start: ${e?.message || e}`);
        }
    };

    const runStop = async (port) => {
        setConfirm(null);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('kill_process_on_port', { port });
            flash(`Stopped :${port}`);
            refresh();
        } catch (e) {
            flash(`Couldn't stop :${port}: ${e?.message || e}`);
        }
    };

    const projectGroups = groups.filter(g => g.running || g.root);
    const oldGroups = groups.filter(g => !g.running && !g.root);

    if (!groups.length) {
        return (
            <div className="local-empty">
                <FontAwesomeIcon icon={faCode} />
                <div>No local dev servers detected</div>
            </div>
        );
    }

    const renderCard = (g) => {
        const primary = g.primary;
        const isStarting = !!starting[g.key];
        const cmds = !g.running && g.root ? startCommands(g.commands, g.dead.find(d => d.yours)?.label || g.dead[0]?.label) : [];
        const sub = g.running
            ? g.note || (primary.label ? `${primary.label} · :${primary.port}` : `Running on :${primary.port}`)
            : isStarting
                ? `Starting… (${starting[g.key].cmd})`
                : `Not running · last on :${g.dead[0]?.port} · ${ago(g.dead[0]?.ts)}`;
        const showPorts = g.live.length + g.dead.length > 1 || g.live.some(e => e.launcher || e.yours);
        const confirmHere = confirm?.key === g.key ? confirm : null;

        return (
            <div key={g.key} className={`local-card${g.running ? ' is-running' : ''}${isStarting ? ' is-starting' : ''}`}>
                <div
                    className="local-card-main"
                    role="button"
                    tabIndex={0}
                    title={g.root || primary?.url}
                    onClick={() => openEntry(primary)}
                    onKeyDown={e => { if (e.key === 'Enter') openEntry(primary); }}
                >
                    <TileIcon item={{ url: primary?.url, favIconUrl: primary?.tab?.favIconUrl }} label={g.name} />
                    <div className="local-card-text">
                        <div className="local-card-name">{g.name}</div>
                        <div className={`local-card-sub${g.note ? ' is-note' : ''}`}>{sub}</div>
                    </div>
                    {cmds.length > 0 && !isStarting && (
                        <button
                            type="button"
                            className="local-start-btn"
                            title={cmds.length === 1 ? cmds[0].run : 'Choose a command to start'}
                            onClick={e => { e.stopPropagation(); setConfirm({ kind: 'start', key: g.key, cmds }); }}
                        >
                            <FontAwesomeIcon icon={faPlay} /> Start
                        </button>
                    )}
                    {isStarting && <FontAwesomeIcon icon={faRotateRight} spin className="local-starting-icon" />}
                </div>

                {confirmHere?.kind === 'start' && (
                    <div className="local-confirm" onClick={e => e.stopPropagation()}>
                        <div className="local-confirm-text">
                            {desktop ? 'Run in a new terminal:' : 'Copy the command to run it yourself:'}
                        </div>
                        <div className="local-confirm-cmds">
                            {confirmHere.cmds.map(c => (
                                <button key={c.id || c.run} type="button" className="local-confirm-cmd" onClick={() => runStart(g, c)} title={c.cwd ? `in ${c.cwd}` : undefined}>
                                    <code>{c.run}</code>
                                    {c.label && <span>{c.label}</span>}
                                </button>
                            ))}
                        </div>
                        <button type="button" className="local-confirm-cancel" onClick={() => setConfirm(null)}>Cancel</button>
                    </div>
                )}

                {showPorts && (
                    <div className="local-ports">
                        {g.live.map(e => {
                            const stopping = confirmHere?.kind === 'stop' && confirmHere.port === e.port;
                            return (
                                <span key={`l${e.port}`} className={`local-port is-live${e.yours ? ' is-yours' : ''}`}>
                                    <button type="button" className="local-port-open" onClick={() => openEntry(e)} title={e.label || e.url}>
                                        <i className="local-port-dot" />:{e.port}
                                    </button>
                                    {e.yours && <span className="local-port-tag">yours</span>}
                                    {e.launcher && <span className="local-port-tag is-agent" title={`Started by ${LAUNCHER_NAMES[e.launcher] || e.launcher}`}>{LAUNCHER_NAMES[e.launcher] || e.launcher}</span>}
                                    {desktop && data && (stopping ? (
                                        <>
                                            <button type="button" className="local-port-confirm" onClick={() => runStop(e.port)}>Stop</button>
                                            <button type="button" className="local-port-x" onClick={() => setConfirm(null)} aria-label="Cancel">×</button>
                                        </>
                                    ) : (
                                        <button type="button" className="local-port-x" title={`Stop the server on :${e.port}`} aria-label={`Stop :${e.port}`}
                                            onClick={() => setConfirm({ kind: 'stop', key: g.key, port: e.port })}>×</button>
                                    ))}
                                </span>
                            );
                        })}
                        {g.dead.map(d => (
                            <span key={`d${d.port}`} className={`local-port is-dead${d.yours ? ' is-yours' : ''}`}>
                                <button type="button" className="local-port-open" onClick={() => openEntry(d)} title={`Not running · last opened ${ago(d.ts)}`}>
                                    :{d.port}
                                </button>
                                {d.yours && <span className="local-port-tag">yours</span>}
                                {d.tabs?.length > 0 && (
                                    <button type="button" className="local-port-x" title="Close the stale tab(s) for this port" aria-label="Close stale tabs"
                                        onClick={(e) => d.tabs.forEach(t => onCloseTab({ id: `tab_${t.id}` }, e))}>×</button>
                                )}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="local-list">
            {!data && loaded && (
                <div className="local-hint">
                    Open the CoolDesk app to see which project and agent each port belongs to.
                </div>
            )}
            {notice && <div className="local-notice">{notice}</div>}
            {projectGroups.map(renderCard)}
            {oldGroups.length > 0 && (
                <>
                    <button type="button" className="local-old-toggle" onClick={() => setShowOld(v => !v)}>
                        {showOld ? 'Hide' : 'Show'} {oldGroups.length} not running
                    </button>
                    {showOld && oldGroups.map(renderCard)}
                </>
            )}
        </div>
    );
}
