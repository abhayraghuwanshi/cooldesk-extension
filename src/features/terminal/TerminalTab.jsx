import { faArrowUpRightFromSquare, faBroom, faFolderOpen, faLocationArrow, faRotateRight, faTerminal, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

// A Browse tab running a real shell (src-tauri/src/terminal.rs) drawn by
// xterm.js. The shell lives as long as the tab is mounted: switching tabs
// only hides it, closing the tab ends it. Tabs restored after a restart
// start a fresh shell in the same folder.

const IS_MAC = /Mac/.test(navigator.platform);

const baseName = (p) => p.split(/[/\\]/).filter(Boolean).pop() || p;

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

// Colours follow Browse's light/dark tokens (read off the element, whose CSS
// colour is --bv-text): a dark ink means the light theme.
function themeFor(el) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color);
  const light = m ? (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 < 0.5 : false;
  const accent = getComputedStyle(el).getPropertyValue('--bv-accent').trim() || '#60a5fa';
  return light ? {
    background: '#fbfbfc', foreground: '#1f2328', cursor: accent, cursorAccent: '#fbfbfc',
    selectionBackground: 'rgba(96, 165, 250, 0.28)',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#7d4e00', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  } : {
    background: '#0d0f16', foreground: '#d7dae0', cursor: accent, cursorAccent: '#0d0f16',
    selectionBackground: 'rgba(148, 163, 184, 0.3)',
    black: '#1c1f26', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d7dae0',
    brightBlack: '#5c6370', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
  };
}

/**
 * @param tabId       Browse tab id (shell ids derive from it)
 * @param cwd         folder the shell starts in (home if missing)
 * @param active      this tab is on screen: fit and focus
 * @param onTitle     (title) → the tab's title (from the shell, else the folder)
 * @param onOpenUrl   (url) → open a link printed in the terminal
 * @param onShowInFiles (path) → reveal the folder in the side panel
 * @param variant     'tab' (main view, full toolbar) | 'panel' (the drawer:
 *                    a slim bar, plus "cd" to the folder you're viewing)
 * @param filesPath   panel: that folder, for the cd button
 * @param onPopOut    panel: (cwd) → open a terminal tab in the main view
 * @param onHide      panel: hide the drawer (the shell keeps running)
 * @param run         a command typed in once the shell starts (and again on
 *                    Restart) — a project's dev server, build, tests…
 */
export function TerminalTab({ tabId, cwd, run = null, active, onTitle, onOpenUrl, onShowInFiles, variant = 'tab', filesPath = null, onPopOut, onHide, toolbarStart = null, toolbarEnd = null }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const [exited, setExited] = useState(null);   // exit code once the shell ends
  const [generation, setGeneration] = useState(0); // bump to restart the shell
  const [error, setError] = useState(null);
  const shellIdRef = useRef(null); // the running shell, for the panel's cd
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onOpenUrlRef = useRef(onOpenUrl);
  onOpenUrlRef.current = onOpenUrl;

  // xterm itself: once per tab.
  useEffect(() => {
    const host = hostRef.current;
    let disposed = false;
    let cleanup = () => { };
    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links'),
      ]);
      if (disposed) return;
      const term = new Terminal({
        fontFamily: '"SF Mono", Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace',
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        scrollback: 10000,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        theme: themeFor(host),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon((e, url) => {
        e.preventDefault();
        onOpenUrlRef.current?.(url);
      }));
      term.open(host);
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch { /* DOM renderer is fine */ }
      // ⌘K clears, as in Terminal.app; other ⌘ combos are the app's.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && IS_MAC && e.metaKey && e.key.toLowerCase() === 'k') {
          term.clear();
          return false;
        }
        // Ctrl+` toggles the terminal drawer (the app's), not a key for the shell.
        if (e.ctrlKey && e.key === '`') return false;
        return true;
      });
      const offTitle = term.onTitleChange(t => { if (t) onTitleRef.current?.(t); });
      termRef.current = term;
      fitRef.current = fit;
      try { fit.fit(); } catch { /* not laid out yet */ }

      // Re-fit whenever the tab's box changes (window, side panel, focus mode).
      const ro = new ResizeObserver(() => {
        if (host.offsetWidth > 0 && host.offsetHeight > 0) {
          try { fit.fit(); } catch { /* ignore */ }
        }
      });
      ro.observe(host);
      setGeneration(g => g + 1);
      cleanup = () => {
        ro.disconnect();
        offTitle.dispose();
        term.dispose();
        termRef.current = null;
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  // The shell: started once xterm exists, and again on restart.
  useEffect(() => {
    const term = termRef.current;
    if (!term || generation === 0) return undefined;
    const id = `${tabId}-${generation}`;
    let alive = true;
    setExited(null);
    setError(null);
    const subs = [];
    (async () => {
      const { Channel } = await import('@tauri-apps/api/core');
      const output = new Channel();
      output.onmessage = (msg) => {
        if (!alive) return;
        if (msg instanceof ArrayBuffer) term.write(new Uint8Array(msg));
        else if (msg && typeof msg.exit === 'number') {
          term.write(`\r\n\x1b[2m[Process exited${msg.exit ? ` with code ${msg.exit}` : ''} — press Enter to start a new shell]\x1b[0m\r\n`);
          setExited(msg.exit);
        }
      };
      try {
        await invoke('terminal_open', { id, cwd: cwd || null, cols: term.cols, rows: term.rows, output });
      } catch (err) {
        if (alive) setError(String(err));
        return;
      }
      if (!alive) { invoke('terminal_close', { id }).catch(() => { }); return; }
      shellIdRef.current = id;
      // Typed ahead: the shell reads it once its startup files have run.
      if (run) invoke('terminal_write', { id, data: `${run}\r` }).catch(() => { });
      subs.push(term.onData(data => invoke('terminal_write', { id, data }).catch(() => { })));
      subs.push(term.onResize(({ cols, rows }) => invoke('terminal_resize', { id, cols, rows }).catch(() => { })));
    })();
    return () => {
      alive = false;
      subs.forEach(s => s.dispose());
      invoke('terminal_close', { id }).catch(() => { });
    };
  }, [generation, tabId, cwd, run]);

  // After the shell ends, Enter starts a new one.
  useEffect(() => {
    const term = termRef.current;
    if (exited === null || !term) return undefined;
    const sub = term.onData(d => { if (d === '\r') setGeneration(g => g + 1); });
    return () => sub.dispose();
  }, [exited]);

  // Shown: fit to the (possibly changed) box and take the keyboard.
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [active, generation]);

  // Keys typed in the terminal belong to the shell: Ctrl+R/L/F/K/[ and
  // friends must not reach the app's window shortcuts. ⌘ combos (macOS) and
  // Ctrl+Shift combos (elsewhere) still do, so tabs and Home keep working.
  useEffect(() => {
    const host = hostRef.current;
    const onKey = (e) => {
      const appCombo = IS_MAC ? e.metaKey : (e.ctrlKey && e.shiftKey);
      if (!appCombo && !(e.ctrlKey && (e.key === 'Tab' || e.key === '`'))) e.stopPropagation();
    };
    host.addEventListener('keydown', onKey);
    return () => host.removeEventListener('keydown', onKey);
  }, []);

  const folder = cwd || '~';
  const clear = () => { termRef.current?.clear(); termRef.current?.focus(); };

  if (variant === 'panel') {
    // cd into the Files tab's folder — typed into the shell, as you would.
    const cdHere = () => {
      if (!filesPath || !shellIdRef.current) return;
      const quoted = IS_MAC || !/^[a-z]:\\/i.test(filesPath)
        ? `'${filesPath.replace(/'/g, "'\\''")}'`
        : `"${filesPath}"`;
      invoke('terminal_write', { id: shellIdRef.current, data: `cd ${quoted}\r` }).catch(() => { });
      termRef.current?.focus();
    };
    return (
      <div className="term-root term-panel">
        <div className="term-panel-bar">
          <FontAwesomeIcon icon={faTerminal} className="term-address-icon" />
          <span className="term-panel-name" title={folder}>{cwd ? baseName(cwd) : 'Terminal'}</span>
          {filesPath && (
            <button className="bp-btn" onClick={cdHere} title={`cd to ${baseName(filesPath)} — the folder you're viewing`}>
              <FontAwesomeIcon icon={faLocationArrow} />
            </button>
          )}
          <button className="bp-btn" onClick={clear} title={IS_MAC ? 'Clear (⌘K)' : 'Clear'}>
            <FontAwesomeIcon icon={faBroom} />
          </button>
          <button className="bp-btn" onClick={() => setGeneration(g => g + 1)} title="Restart the shell">
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
          {onPopOut && (
            <button className="bp-btn" onClick={() => onPopOut(cwd)} title="New terminal tab in the main view">
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </button>
          )}
          {onHide && (
            <button className="bp-btn" onClick={onHide} title="Hide the terminal (Ctrl+`) — it keeps running">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>
        <div className="term-body">
          <div ref={hostRef} className="term-host" />
          {error && <div className="term-error">Couldn’t start a shell — {error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="bp-root ft-root term-root">
      <div className="bp-toolbar">
        {toolbarStart}
        <div className="bp-address ft-address" title={folder}>
          <FontAwesomeIcon icon={faTerminal} className="ft-address-icon term-address-icon" />
          <span className="bp-host">{cwd ? baseName(cwd) : 'Terminal'}</span>
          <span className="bp-path ft-dir">{run ? `$ ${run}` : folder}</span>
        </div>
        <div className="bp-capsule">
          <button className="bp-btn" onClick={clear} title={IS_MAC ? 'Clear (⌘K)' : 'Clear'}>
            <FontAwesomeIcon icon={faBroom} />
          </button>
          <button className="bp-btn" onClick={() => setGeneration(g => g + 1)} title={run ? `Restart — runs “${run}” again` : 'Restart the shell'}>
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
          {cwd && onShowInFiles && (
            <button className="bp-btn" onClick={() => onShowInFiles(cwd)} title="Show this folder in the Files panel">
              <FontAwesomeIcon icon={faFolderOpen} />
            </button>
          )}
        </div>
        {toolbarEnd}
      </div>
      <div className="term-body">
        <div ref={hostRef} className="term-host" />
        {error && <div className="term-error">Couldn’t start a shell — {error}</div>}
      </div>
    </div>
  );
}
