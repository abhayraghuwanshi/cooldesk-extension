import { faFileLines, faFolder, faHistory, faPenToSquare, faPlus, faRotateRight, faStop, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AgentMarkdown } from '../AgentMarkdown';
import { CopyButton } from '../CopyButton';
import { ProposalCard } from './ProposalCard';

// /agent — Claude Code chat, adapter picker, per-workspace context chips, and
// the .cooldesk/ scaffold action. The transcript itself (aiCli.turns) is the
// only part with real per-run state; everything else here is menus/toggles.
/**
 * The distinct steps a run took, in order. A status line can hold several
 * calls joined with " · " (opencode batches them), and the same lookup often
 * repeats — both are folded so "Reading which sites you use" shows once.
 */
function stepsOf(lines) {
    const seen = new Set();
    const out = [];
    for (const l of lines || []) {
        if (l.stream === 'stderr') continue;
        for (const part of String(l.text).split(' · ')) {
            const t = part.trim();
            if (t && !seen.has(t)) { seen.add(t); out.push(t); }
        }
    }
    return out;
}

export function AgentPanel({
    aiCli, wsScaffoldPlan, agentContext, setAgentContext, agentLogRef, applyProposal, discardProposal, inputRef, onRetry,
}) {
    return (
        <div className="spotlight-ai-mode spotlight-agent-mode">
            {/* Attached context — picked from the results list below
                (click, or arrow to highlight + Enter) instead of
                opening. Sent alongside every request until removed. */}
            {agentContext.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 4px 8px' }}>
                    {agentContext.map(c => (
                        <span key={c.id} className="spotlight-agent-chip" title={c.path || c.name}>
                            <FontAwesomeIcon icon={c.kind === 'folder' ? faFolder : c.kind === 'data' ? faHistory : faFileLines} />
                            {c.name}
                            {c.status === 'loading' && ' …'}
                            {c.status === 'unreadable' && ' (unreadable)'}
                            <button
                                type="button"
                                className="spotlight-add-badge-exit"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setAgentContext(prev => prev.filter(x => x.id !== c.id));
                                }}
                                title="Remove from context"
                                aria-label={`Remove ${c.name} from context`}
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="spotlight-ai-messages spotlight-agent-log" ref={agentLogRef}>
                {aiCli.turns.length === 0 && (
                    <div className="spotlight-ai-hint">
                        Describe how to reorganise your workspaces, then press Enter.
                        {' '}Pick a file or folder below (click, or arrow to it and press Enter) to attach it as context.
                        {' '}Type <code>/name &lt;title&gt;</code> to rename this workspace instantly.
                        {wsScaffoldPlan?.hub && (
                            <> Or use the {wsScaffoldPlan.members.length ? 'Link' : 'Set up'} button in the search bar to scaffold a shared <code>.cooldesk/</code> in {wsScaffoldPlan.hub.name} (the workspace picked in the dropdown).</>
                        )}
                        {aiCli.available?.[aiCli.adapter.bin] === false && (
                            <div className="spotlight-agent-warn">
                                <code>{aiCli.adapter.bin}</code> isn’t on your PATH — install it or pick another above.
                            </div>
                        )}
                    </div>
                )}

                {aiCli.turns.map(turn => (
                    <div key={turn.id} className="spotlight-agent-turn">
                        {/* Chat convention: the user's message as a right-aligned
                            bubble, the answer as plain full-width text under it. */}
                        <div className="spotlight-agent-request">
                            <div className="spotlight-agent-bubble">{turn.request}</div>
                        </div>
                        {turn.contextNote && (
                            <div className="spotlight-agent-context-note">{turn.contextNote}</div>
                        )}

                        {/* Above the answer, as chat apps do ("Searched 3 sites"). Progress — tool calls ("Searching the web: …")
                            and stderr, already turned into readable lines by
                            createOutputParser rather than raw protocol.
                            While the run is in flight this is the main sign
                            of life, so it stays open.
                            Once it's done, a plain conversational reply
                            already says everything there is to say — showing
                            a second "Output" toggle full of protocol noise
                            under it (see turn.reply above) was confusing, not
                            informative. It only stays worth folding away
                            (rather than dropping entirely) when there's a
                            proposal to double-check the parse of, or when the
                            run finished without either a reply or a proposal
                            (the only sign of what happened, then). */}
                        {(() => {
                            const steps = stepsOf(turn.lines);
                            const warnings = [...new Set(turn.lines.filter(l => l.stream === 'stderr').map(l => l.text))];
                            const failed = !turn.running && !turn.reply && !turn.proposal;
                            return (
                                <>
                                    {/* While running: one line that updates in place, not a
                                        growing list — a dozen near-identical tool lines read
                                        like a stack trace. */}
                                    {turn.running && steps.length > 0 && (
                                        <div className="spotlight-agent-activity">
                                            <span className="spotlight-agent-spinner" aria-hidden="true" />
                                            <span className="spotlight-agent-activity-text">{steps[steps.length - 1]}…</span>
                                            {steps.length > 1 && <span className="spotlight-agent-activity-count">{steps.length} steps</span>}
                                        </div>
                                    )}
                                    {/* Done: a one-line summary of what it looked at, which
                                        expands to the full log. A failed run (no answer, no
                                        proposal) shows the log open — it's all there is. */}
                                    {!turn.running && steps.length > 0 && (
                                        <details className="spotlight-agent-raw" open={failed}>
                                            <summary>
                                                <span className="spotlight-agent-raw-gist">
                                                    ⎿ {steps.slice(0, 3).join(' · ')}{steps.length > 3 ? ` +${steps.length - 3} more` : ''}
                                                </span>
                                                <CopyButton
                                                    getText={() => turn.lines.map(l => l.text).join('\n')}
                                                    title="Copy raw output"
                                                />
                                            </summary>
                                            <pre className="spotlight-agent-stream">
                                                {turn.lines.map((l, i) => (
                                                    <div key={i} className={l.stream === 'stderr' ? 'is-stderr' : undefined}>{l.text}</div>
                                                ))}
                                            </pre>
                                        </details>
                                    )}
                                    {/* Warnings ("data tools didn't connect") stay visible. */}
                                    {warnings.map((w, i) => (
                                        <div key={i} className="spotlight-agent-warning">{w}</div>
                                    ))}
                                </>
                            );
                        })()}

                        {/* The answer. Ordinary conversation is the common
                            case, so this is the headline; raw stdout is
                            folded away below since it's mostly protocol. */}
                        {turn.reply && (
                            <div className="spotlight-agent-reply">
                                <div className="spotlight-agent-reply-text">
                                    <AgentMarkdown text={turn.reply} />
                                </div>
                                {/* Under the answer, shown on hover (always on the
                                    latest turn) — after the text in the DOM so selecting
                                    the answer doesn't sweep the buttons into it. */}
                                <div className="spotlight-agent-reply-actions">
                                    <CopyButton
                                        getText={() => turn.reply}
                                        title="Copy answer (or select part of it and press Ctrl+C)"
                                    />
                                    {onRetry && (
                                        <button
                                            type="button"
                                            className="spotlight-agent-action"
                                            disabled={aiCli.running}
                                            onMouseDown={(e) => { e.preventDefault(); onRetry(turn.request); }}
                                            title="Ask again"
                                            aria-label="Ask again"
                                        >
                                            <FontAwesomeIcon icon={faRotateRight} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* The answer as it streams in — replaced by the
                            reply block above once the run finishes. */}
                        {turn.running && turn.partial && (
                            <div className="spotlight-agent-reply">
                                <div className="spotlight-agent-reply-text">
                                    <AgentMarkdown text={turn.partial} />
                                </div>
                            </div>
                        )}


                        {turn.running && !turn.lines.length && !turn.partial && (
                            <div className="spotlight-agent-waiting">Waiting for {aiCli.adapter.label}…</div>
                        )}

                        {turn.error && (
                            <div className="spotlight-ai-message error">
                                <div className="message-avatar">⚠️</div>
                                <div className="message-content">{turn.error}</div>
                            </div>
                        )}

                        {/* An action block that survived validation empty —
                            only worth a line, and only when there was no
                            prose answer to show instead. */}
                        {turn.proposal && turn.proposal.valid.length === 0 && !turn.reply && (
                            <div className="spotlight-agent-empty">No changes proposed.</div>
                        )}

                        {turn.proposal && turn.proposal.valid.length > 0 && (
                            <ProposalCard
                                turn={turn}
                                setActionsOff={aiCli.setActionsOff}
                                applyProposal={applyProposal}
                                discardProposal={discardProposal}
                                inputRef={inputRef}
                            />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// The agent's controls — which CLI runs it, past requests, new chat, stop —
// live at the right end of the search row instead of a row of their own: the
// mode is already obvious from the search box, so a full-width header just
// pushed the conversation down. Compact on purpose: text-only picker, icon
// buttons with tooltips, and the scaffold/stop controls only when relevant.
export function AgentToolbar({
    aiCli, agentAdapterOpen, setAgentAdapterOpen, agentHistoryOpen, setAgentHistoryOpen,
    wsScaffoldPlan, runCreateWorkspace, query, setQuery, setAgentContext,
    inputRef, setAgentOriginWorkspace,
}) {
    return (
        <div className="spotlight-agent-toolbar">
            {/* Scaffolds (and, when the workspace holds several project
                folders, links) .cooldesk/. Only shown once a project folder
                is resolved, so an ordinary question isn't cluttered by it. */}
            {wsScaffoldPlan?.hub && (
                <button
                    type="button"
                    className="spotlight-agent-tool is-text"
                    disabled={aiCli.running}
                    onMouseDown={(e) => { e.preventDefault(); runCreateWorkspace(query.trim()); setQuery(''); }}
                    title={`Scaffold .cooldesk/ for "${wsScaffoldPlan.hub.name}"${wsScaffoldPlan.members.length ? ` and link ${wsScaffoldPlan.members.length} sibling project(s)` : ''}`}
                >
                    <FontAwesomeIcon icon={faFolder} />
                    {/* Named, because it acts on the space picked in the
                        workspace dropdown — not on anything in the chat. */}
                    {wsScaffoldPlan.members.length
                        ? `Link ${wsScaffoldPlan.members.length + 1} in ${wsScaffoldPlan.workspace?.name || wsScaffoldPlan.hub.name}`
                        : `Set up ${wsScaffoldPlan.hub.name}`}
                </button>
            )}

            {/* Which CLI runs the agent — text only, it's a setting not a mode. */}
            <div className="spotlight-agent-menu-wrap">
                <button
                    type="button"
                    className={`spotlight-agent-tool is-text${agentAdapterOpen ? ' is-open' : ''}`}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setAgentAdapterOpen(v => !v);
                        setAgentHistoryOpen(false);
                    }}
                    title={`Running with ${aiCli.adapter.label} — click to switch`}
                    aria-expanded={agentAdapterOpen}
                >
                    <span>{aiCli.adapter.label}</span>
                    <span className="spotlight-agent-caret">▾</span>
                </button>
                {agentAdapterOpen && (
                    <div className="spotlight-agent-menu is-right">
                        {aiCli.adapters.map(a => {
                            const found = aiCli.available?.[a.bin];
                            return (
                                <button
                                    key={a.id}
                                    type="button"
                                    className={`spotlight-agent-menu-item${a.id === aiCli.adapterId ? ' is-selected' : ''}${found === false ? ' is-missing' : ''}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        aiCli.selectAdapter(a.id);
                                        setAgentAdapterOpen(false);
                                    }}
                                    title={found === false ? `${a.bin} not found on PATH` : `Run with ${a.label}`}
                                >
                                    <span>{a.label}</span>
                                    {/* Still selectable when missing — the label is
                                        the explanation, not a lockout. */}
                                    {found === false && <span className="spotlight-agent-menu-note">not installed</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Past requests. The transcript is per-session by design; this is
                the part that persists, so a prompt worth reusing isn't lost. */}
            <div className="spotlight-agent-history-wrap">
                <button
                    type="button"
                    className={`spotlight-agent-tool${agentHistoryOpen ? ' is-open' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); setAgentHistoryOpen(v => !v); setAgentAdapterOpen(false); }}
                    title="Previous requests"
                    aria-label="Previous requests"
                    aria-expanded={agentHistoryOpen}
                >
                    <FontAwesomeIcon icon={faHistory} />
                </button>
                {agentHistoryOpen && (
                    <div className="spotlight-agent-history">
                        {aiCli.history.length === 0 ? (
                            <div className="spotlight-agent-history-empty">Nothing asked yet.</div>
                        ) : (
                            <>
                                {aiCli.history.map((h) => (
                                    <div key={`${h.at}-${h.text}`} className="spotlight-agent-history-row">
                                        {/* Opens the saved exchange rather than re-running it:
                                            a run costs time and tokens, and the answer is here. */}
                                        <button
                                            type="button"
                                            className="spotlight-agent-history-item"
                                            title={h.reply ? `${h.text}\n\n${h.reply}` : h.text}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                aiCli.restoreFromHistory(h);
                                                setAgentHistoryOpen(false);
                                            }}
                                        >
                                            <span className="spotlight-agent-history-q">{h.text}</span>
                                            {h.reply && (
                                                <span className="spotlight-agent-history-a">{h.reply}</span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            className="spotlight-agent-history-reuse"
                                            title="Edit and ask again"
                                            aria-label="Edit and ask again"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                setQuery(h.text);
                                                setAgentHistoryOpen(false);
                                                inputRef.current?.focus();
                                            }}
                                        >
                                            <FontAwesomeIcon icon={faPlus} />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="spotlight-agent-history-clear"
                                    onMouseDown={(e) => { e.preventDefault(); aiCli.clearHistory(); }}
                                >
                                    Clear history
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* New chat: every prompt carries the last six turns, so an unrelated
                question otherwise drags old context along. Only when there's
                something to clear. */}
            {aiCli.turns.length > 0 && (
                <button
                    type="button"
                    className="spotlight-agent-tool"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        aiCli.reset();
                        setQuery('');
                        setAgentHistoryOpen(false);
                        setAgentContext([]);
                        setAgentOriginWorkspace?.(null);
                        inputRef.current?.focus();
                    }}
                    title="New chat — the next question won't carry this conversation's context or attachments"
                    aria-label="New chat"
                >
                    <FontAwesomeIcon icon={faPenToSquare} />
                </button>
            )}

            {aiCli.running && (
                <button
                    type="button"
                    className="spotlight-agent-tool is-stop"
                    onMouseDown={(e) => { e.preventDefault(); aiCli.cancel(); }}
                    title="Stop"
                    aria-label="Stop"
                >
                    <FontAwesomeIcon icon={faStop} />
                </button>
            )}
        </div>
    );
}
