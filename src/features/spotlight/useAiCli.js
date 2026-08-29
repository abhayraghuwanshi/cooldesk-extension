import { useCallback, useEffect, useRef, useState } from 'react';
import { allAdapters, buildPrompt, buildSpec, extractReply, parseActions } from './aiAdapters';
import { buildScaffoldPrompt, buildScaffoldSpec } from './workspaceScaffold';
import { validateActions } from '../../services/workspaceActions';

const isTauri = () =>
  typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

const ADAPTER_KEY = 'cooldesk-ai-cli-adapter';
const HISTORY_KEY = 'cooldesk-ai-cli-history';
const HISTORY_MAX = 40;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(e => e && typeof e.text === 'string') : [];
  } catch {
    return [];
  }
}

function persistHistory(next) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* quota — history is expendable, never fail a run over it */ }
  return next;
}

/**
 * Drive a terminal AI CLI from the UI, as a conversation.
 *
 * History is kept here rather than in the CLI: `claude --continue` and its
 * equivalents are all spelled differently (and some agents have no resume at
 * all), so carrying the transcript in the prompt is the only approach that
 * holds for "any terminal AI". Each run is a fresh process that receives the
 * prior turns as context.
 *
 * Output streams into the open turn because these agents routinely take tens of
 * seconds. The action list is only parsed once a process exits — agents emit
 * partial json mid-stream while they think, and parsing eagerly acts on drafts.
 */
export function useAiCli() {
  const [adapterId, setAdapterId] = useState(() => localStorage.getItem(ADAPTER_KEY) || 'claude');
  const [available, setAvailable] = useState(null); // { [bin]: boolean }
  const [turns, setTurns] = useState([]);
  const [running, setRunning] = useState(false);
  // Past requests, newest first — survives closing the panel and the app, which
  // the in-memory transcript deliberately does not.
  const [history, setHistory] = useState(loadHistory);

  const activeRef = useRef(null);   // id of the turn currently streaming
  const bufferRef = useRef('');
  const unlistenRef = useRef([]);
  const turnsRef = useRef([]);      // mirror, so run() can read history without re-binding

  turnsRef.current = turns;

  const adapters = allAdapters();
  const adapter = adapters.find(a => a.id === adapterId) || adapters[0];

  // Which CLIs are actually installed — so the picker can grey out the rest
  // instead of failing at the first prompt.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const found = await invoke('ai_cli_detect', { bins: adapters.map(a => a.bin) });
        if (!cancelled) setAvailable(found);
      } catch (e) {
        console.warn('[AiCli] detect failed:', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterId]);

  const selectAdapter = useCallback((id) => {
    setAdapterId(id);
    localStorage.setItem(ADAPTER_KEY, id);
  }, []);

  const teardown = useCallback(() => {
    unlistenRef.current.forEach(fn => { try { fn(); } catch { /* already gone */ } });
    unlistenRef.current = [];
  }, []);

  useEffect(() => teardown, [teardown]);

  /** Patch one turn in place, leaving the rest of the transcript alone. */
  const patchTurn = useCallback((id, patch) => {
    setTurns(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Returns a Promise resolving to `{ id, error, reply, proposal }` once the
  // run finishes — used by the "Create workspace" orchestration to await one
  // folder's scaffold before starting the next (they can depend on each
  // other: a member links against the hub, which must exist on disk first).
  // Existing fire-and-forget callers (plain /agent chat) just don't await it.
  const run = useCallback((request, workspaces, cwd, opts = {}) => {
    if (!request?.trim() || running) return Promise.resolve({ id: null, error: 'A run is already in progress.' });
    // 'scaffold' is the /agent panel's "Create workspace" action: a one-shot
    // Claude Code run with Write/Edit allowed against a real project folder,
    // entirely separate from the sandboxed workspace-record chat below (see
    // workspaceScaffold.js).
    const scaffold = opts.mode === 'scaffold';

    const id = `run-${Date.now()}`;
    const turn = { id, request: request.trim(), lines: [], reply: '', proposal: null, error: null, running: true };

    if (!isTauri()) {
      const error = 'The AI CLI only runs in the desktop app.';
      setTurns(prev => [...prev, { ...turn, running: false, error }]);
      return Promise.resolve({ id, error });
    }

    // Recorded up-front, keyed by the run id, so the reply can be filled in
    // when the process exits. Shell-style: re-asking something moves it to the
    // top rather than stacking another copy of the same question.
    setHistory(prev => {
      const text = request.trim();
      const next = [{ id, text, reply: '', at: Date.now() }, ...prev.filter(e => e.text !== text)].slice(0, HISTORY_MAX);
      return persistHistory(next);
    });

    const priorTurns = turnsRef.current;
    activeRef.current = id;
    bufferRef.current = '';
    setTurns(prev => [...prev, turn]);
    setRunning(true);

    return new Promise((resolve) => {
      (async () => {
        try {
          const [{ invoke }, { listen }] = await Promise.all([
            import('@tauri-apps/api/core'),
            import('@tauri-apps/api/event'),
          ]);

          const onOutput = await listen('ai-cli-output', (e) => {
            const p = e.payload;
            if (!p || p.id !== activeRef.current) return;
            if (p.stream === 'stdout') bufferRef.current += p.line + '\n';
            setTurns(prev => prev.map(t =>
              t.id === p.id ? { ...t, lines: [...t.lines, { stream: p.stream, text: p.line }] } : t
            ));
          });

          const onDone = await listen('ai-cli-done', (e) => {
            const p = e.payload;
            if (!p || p.id !== activeRef.current) return;

            setRunning(false);
            activeRef.current = null;
            teardown();

            if (p.error) {
              patchTurn(p.id, { running: false, error: p.error });
              resolve({ id: p.id, error: p.error });
              return;
            }
            if (p.code !== 0 && p.code !== null) {
              const error = `${adapter.label} exited with code ${p.code}`;
              patchTurn(p.id, { running: false, error });
              resolve({ id: p.id, error });
              return;
            }

            // No action list is the *normal* case now — most messages are plain
            // conversation. Only the prose is required; a proposal is a bonus.
            const raw = bufferRef.current;
            const parsed = parseActions(raw);
            const reply = extractReply(raw);
            const proposal = parsed ? { ...validateActions(parsed), raw } : null;
            const error = (!reply && !parsed) ? 'The agent returned nothing — see the output below.' : null;
            patchTurn(p.id, { running: false, reply, proposal, error });

            // Keep the answer alongside the question. Only the prose is stored:
            // raw stdout can be thousands of lines, and a *proposal* is
            // deliberately not persisted because it was computed against the
            // workspaces as they were — re-applying it later could act on state
            // that has since changed.
            setHistory(prev => persistHistory(
              prev.map(h => (h.id === p.id ? { ...h, reply } : h))
            ));

            resolve({ id: p.id, error, reply, proposal });
          });

          unlistenRef.current = [onOutput, onDone];

          const prompt = scaffold
            ? buildScaffoldPrompt(request.trim(), opts.scaffoldContext)
            : buildPrompt(workspaces, request.trim(), priorTurns, opts.attachments);
          const spec = scaffold ? buildScaffoldSpec(prompt, cwd) : buildSpec(adapter, prompt, cwd);
          await invoke('ai_cli_run', { id, spec });
        } catch (e) {
          console.error('[AiCli] run failed:', e);
          const error = String(e?.message || e);
          patchTurn(id, { running: false, error });
          setRunning(false);
          activeRef.current = null;
          teardown();
          resolve({ id, error });
        }
      })();
    });
  }, [adapter, running, teardown, patchTurn]);

  const cancel = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ai_cli_cancel', { id });
    } catch (e) {
      console.warn('[AiCli] cancel failed:', e);
    }
    patchTurn(id, { running: false, error: 'Stopped.' });
    setRunning(false);
    activeRef.current = null;
    teardown();
  }, [teardown, patchTurn]);

  /** Drop a turn's proposal once it has been applied or dismissed. */
  const clearProposal = useCallback((id) => patchTurn(id, { proposal: null }), [patchTurn]);

  /** Reopen a past exchange as the transcript, so its answer is readable again. */
  const restoreFromHistory = useCallback((entry) => {
    if (!entry) return;
    setTurns([{
      id: entry.id || `hist-${entry.at}`,
      request: entry.text,
      reply: entry.reply || '',
      lines: [],
      proposal: null,
      error: entry.reply ? null : 'No answer was recorded for this request.',
      running: false,
    }]);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* nothing to clear */ }
  }, []);

  /** Wipe the transcript (leaving the mode active). */
  const reset = useCallback(() => {
    setTurns([]);
    bufferRef.current = '';
  }, []);

  return {
    adapters, adapter, adapterId, selectAdapter, available,
    running, turns, history, clearHistory, restoreFromHistory,
    run, cancel, reset, clearProposal,
  };
}
