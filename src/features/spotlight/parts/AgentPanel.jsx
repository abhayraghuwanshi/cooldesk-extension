import { faFileLines, faFolder, faHistory, faPlus, faTerminal, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { describeAction } from '../../../services/workspaceActions';
import { AgentMarkdown } from '../AgentMarkdown';
import { CopyButton } from '../CopyButton';

// /agent — Claude Code chat, adapter picker, per-workspace context chips, and
// the .cooldesk/ scaffold action. The transcript itself (aiCli.turns) is the
// only part with real per-run state; everything else here is menus/toggles.
export function AgentPanel({
    aiCli, agentAdapterOpen, setAgentAdapterOpen, agentHistoryOpen, setAgentHistoryOpen,
    wsScaffoldPlan, runCreateWorkspace, query, setQuery, agentContext, setAgentContext,
    inputRef, agentLogRef, applyProposal, setAgentOriginWorkspace,
}) {
    return (
        <div className="spotlight-ai-mode spotlight-agent-mode">
            {/* No "Agent" title here — the chip in the search box
                already says which mode you're in, and repeating it
                two rows apart just took space the controls needed. */}
            <div className="spotlight-ai-header">
                <div className="spotlight-agent-menu-wrap">
                    <button
                        type="button"
                        className={`spotlight-agent-chip is-active${agentAdapterOpen ? ' is-open' : ''}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setAgentAdapterOpen(v => !v);
                            setAgentHistoryOpen(false);
                        }}
                        title={`Running with ${aiCli.adapter.label}`}
                        aria-expanded={agentAdapterOpen}
                    >
                        <FontAwesomeIcon icon={faTerminal} />
                        <span>{aiCli.adapter.label}</span>
                        <span className="spotlight-agent-caret">▾</span>
                    </button>
                    {agentAdapterOpen && (
                        <div className="spotlight-agent-menu">
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

                <div className="spotlight-agent-header-spacer" />

                {/* Scaffolds (and, when the workspace holds several
                    project folders, links) .cooldesk/ — replaces the
                    separate cooldesk-plugin's /cd-init + /cd-link.
                    Hidden entirely until a project folder is resolved,
                    so an ordinary chat request isn't cluttered by a
                    button that does nothing for it. */}
                {wsScaffoldPlan?.hub && (
                    <button
                        type="button"
                        className="spotlight-agent-chip"
                        disabled={aiCli.running}
                        onMouseDown={(e) => { e.preventDefault(); runCreateWorkspace(query.trim()); setQuery(''); }}
                        title={`Scaffold .cooldesk/ for "${wsScaffoldPlan.hub.name}"${wsScaffoldPlan.members.length ? ` and link ${wsScaffoldPlan.members.length} sibling project(s)` : ''}`}
                    >
                        <FontAwesomeIcon icon={faFolder} />
                        {wsScaffoldPlan.members.length
                            ? `Create + link ${wsScaffoldPlan.members.length + 1} projects`
                            : 'Create workspace'}
                    </button>
                )}

                {/* Clears the transcript without leaving the mode.
                    Worth its own control: every prompt carries the
                    last six turns, so asking something unrelated
                    otherwise drags irrelevant context along — and
                    the only alternative was Esc and retyping
                    /agent. Hidden until there's something to clear. */}
                {aiCli.turns.length > 0 && (
                    <button
                        type="button"
                        className="spotlight-agent-chip"
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
                    >
                        New chat
                    </button>
                )}

                {/* Past requests. The transcript is per-session by
                    design; this is the part that persists, so a
                    prompt worth reusing isn't lost on close. */}
                <div className="spotlight-agent-history-wrap">
                    <button
                        type="button"
                        className={`spotlight-agent-chip${agentHistoryOpen ? ' is-active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); setAgentHistoryOpen(v => !v); setAgentAdapterOpen(false); }}
                        title="Previous requests"
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
                                            {/* Opens the saved exchange — question and
                                                answer — rather than re-running it. An
                                                agent run costs time and tokens, and the
                                                answer you already paid for is right here. */}
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
                                            {/* Separate control, because reusing a prompt
                                                and rereading an answer are different jobs. */}
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

                {aiCli.running && (
                    <button
                        type="button"
                        className="spotlight-agent-cancel"
                        onMouseDown={(e) => { e.preventDefault(); aiCli.cancel(); }}
                    >
                        Stop
                    </button>
                )}
            </div>

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
                            <> Or use the {wsScaffoldPlan.members.length ? 'Create + link' : 'Create workspace'} button above to scaffold a shared <code>.cooldesk/</code>.</>
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
                        <div className="spotlight-agent-request">
                            <span className="spotlight-agent-request-mark">›</span>
                            {turn.request}
                        </div>

                        {/* The answer. Ordinary conversation is the common
                            case, so this is the headline; raw stdout is
                            folded away below since it's mostly protocol. */}
                        {turn.reply && (
                            <div className="spotlight-agent-reply">
                                <div className="spotlight-agent-reply-head">
                                    <span className="spotlight-agent-reply-who">CoolDesk</span>
                                    <CopyButton
                                        getText={() => turn.reply}
                                        title="Copy answer (or select part of it and press Ctrl+C)"
                                    />
                                </div>
                                <div className="spotlight-agent-reply-text">
                                    <AgentMarkdown text={turn.reply} />
                                </div>
                            </div>
                        )}

                        {/* Raw output — the underlying stream-json protocol
                            lines (system init, tool calls, the final result
                            envelope), not prose. While the run is in flight
                            this is the only sign of life, so it stays open.
                            Once it's done, a plain conversational reply
                            already says everything there is to say — showing
                            a second "Output" toggle full of protocol noise
                            under it (see turn.reply above) was confusing, not
                            informative. It only stays worth folding away
                            (rather than dropping entirely) when there's a
                            proposal to double-check the parse of, or when the
                            run finished without either a reply or a proposal
                            (the only sign of what happened, then). */}
                        {turn.lines.length > 0 && (turn.running || (!turn.reply && !turn.proposal) ? (
                            <pre className="spotlight-agent-stream">
                                {turn.lines.map((l, i) => (
                                    <div key={i} className={l.stream === 'stderr' ? 'is-stderr' : undefined}>{l.text}</div>
                                ))}
                            </pre>
                        ) : turn.proposal ? (
                            <details className="spotlight-agent-raw">
                                <summary>
                                    Output
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
                        ) : null)}

                        {turn.running && !turn.lines.length && (
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
                            <div className="spotlight-agent-proposal">
                                <div className="spotlight-agent-proposal-head">
                                    Proposed changes ({turn.proposal.valid.length})
                                </div>
                                <ul className="spotlight-agent-actions">
                                    {turn.proposal.valid.map((a, i) => (
                                        <li key={i} className={a.type.startsWith('remove') ? 'is-remove' : 'is-add'}>
                                            {describeAction(a)}
                                        </li>
                                    ))}
                                </ul>
                                {/* Rejected actions are surfaced, not swallowed: applying
                                    half a plan without saying so is worse than failing. */}
                                {turn.proposal.rejected.length > 0 && (
                                    <details className="spotlight-agent-rejected">
                                        <summary>{turn.proposal.rejected.length} action(s) discarded as invalid</summary>
                                        <ul>
                                            {turn.proposal.rejected.map((r, i) => (
                                                <li key={i}>{r.reason}</li>
                                            ))}
                                        </ul>
                                    </details>
                                )}
                                <div className="spotlight-agent-confirm">
                                    <button
                                        type="button"
                                        className="spotlight-agent-apply"
                                        onMouseDown={(e) => { e.preventDefault(); applyProposal(turn); }}
                                    >
                                        Apply
                                    </button>
                                    <button
                                        type="button"
                                        className="spotlight-agent-discard"
                                        onMouseDown={(e) => { e.preventDefault(); aiCli.clearProposal(turn.id); }}
                                    >
                                        Discard
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
