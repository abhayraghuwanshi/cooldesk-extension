import { useEffect, useRef, useState } from 'react';

/**
 * The /agent proposal as a diff of the user's workspaces: each workspace the
 * plan touches, with what it already holds folded away, `+` for additions,
 * `−` for removals, and a url moved between workspaces shown as one move.
 *
 * Two ways through it:
 * - the diff itself — every row and workspace header is a toggle;
 * - triage ("Review one by one") — a change at a time, Y keep / N skip.
 *
 * Whatever ends up unticked is also what teaches CoolDesk which placements
 * were bad (see applyProposal in GlobalSpotlight.jsx).
 */

const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};
// Saved links often use the url itself as their title.
const realTitle = (title, url) => (title && title !== url && !/^[a-z]+:\/\//i.test(title) ? title : null);
const baseName = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p;
const samePage = (a, b) => {
    const n = (u) => (u || '').trim().replace(/\/+$/, '').replace(/^[a-z]+:\/\//i, '').replace(/^www\./, '').toLowerCase();
    return n(a) === n(b);
};

/** Title first, mechanics second. */
function labelOf(a) {
    if (a.type === 'add_url' || a.type === 'remove_url') {
        return { label: realTitle(a.title, a.url) || hostOf(a.url), meta: hostOf(a.url) };
    }
    if (a.type === 'add_app' || a.type === 'remove_app') {
        return { label: a.name || baseName(a.path), meta: a.appType || 'app' };
    }
    if (a.type === 'add_project_resource' || a.type === 'remove_project_resource') {
        return { label: a.name || a.url || baseName(a.path), meta: a.scope === 'shared' ? 'project · shared' : 'project · personal' };
    }
    return { label: a.type, meta: '' };
}

/**
 * Turn the action list into workspaces-with-changes plus the list of
 * decisions ("units") the user makes. A unit is usually one action; a move
 * (remove_url here + add_url of the same page there) is one unit of two.
 */
function buildDiff(valid, base) {
    const groups = [];
    const byName = new Map();
    const group = (name) => {
        let g = byName.get(name);
        if (!g) {
            g = { name, createIndex: null, renameIndex: null, renamedFrom: null, why: null, rows: [] };
            byName.set(name, g);
            groups.push(g);
        }
        return g;
    };

    // Pair removals with an add of the same page elsewhere.
    const moveOf = new Map(); // action index -> unit
    valid.forEach((r, i) => {
        if (r.type !== 'remove_url') return;
        const j = valid.findIndex((a, k) => a.type === 'add_url' && a.workspace !== r.workspace && samePage(a.url, r.url) && !moveOf.has(k));
        if (j < 0) return;
        const unit = { key: `m${i}`, indices: [i, j], move: { from: r.workspace, to: valid[j].workspace }, action: valid[j] };
        moveOf.set(i, unit);
        moveOf.set(j, unit);
    });

    const units = [];
    const seen = new Set();
    valid.forEach((a, i) => {
        if (a.type === 'create_workspace') {
            const g = group(a.name);
            g.createIndex = i;
            g.why = g.why || a.why || null;
            return;
        }
        if (a.type === 'rename_workspace') {
            const g = group(a.to);
            g.renameIndex = i;
            g.renamedFrom = a.from;
            g.why = g.why || a.why || null;
            return;
        }
        const unit = moveOf.get(i) || { key: `a${i}`, indices: [i], move: null, action: a };
        const kind = unit.move
            ? (a.type === 'remove_url' ? 'move-out' : 'move-in')
            : (a.type.startsWith('remove') ? 'remove' : 'add');
        const g = group(a.workspace);
        g.rows.push({ unit, kind });
        unit.groups = [...(unit.groups || []), g];
        if (!seen.has(unit.key)) { seen.add(unit.key); units.push(unit); }
    });

    // What each workspace already holds, minus what this plan takes out.
    for (const g of groups) {
        const was = (base || []).find(w => w.name === (g.renamedFrom || g.name));
        const removed = g.rows.filter(r => r.kind === 'remove' || r.kind === 'move-out').map(r => r.unit.action.url || r.unit.action.path);
        const removedHere = (v) => removed.some(x => x && (samePage(x, v) || x === v));
        g.existing = was ? [
            ...was.urls.filter(u => !g.rows.some(r => r.kind === 'remove' && samePage(r.unit.action.url, u.url)) && !removedHere(u.url))
                .map(u => ({ label: realTitle(u.title, u.url) || hostOf(u.url), meta: hostOf(u.url) })),
            ...was.apps.filter(a => !removedHere(a.path)).map(a => ({ label: a.name || baseName(a.path), meta: a.appType || 'app' })),
        ] : [];
    }
    return { groups, units };
}

/** remove_url carries no title — borrow the one the workspace saved. */
function withTitle(a, base) {
    if (a.type !== 'remove_url' || a.title) return a;
    const saved = (base || []).find(w => w.name === a.workspace)?.urls.find(u => samePage(u.url, a.url));
    return saved?.title ? { ...a, title: saved.title } : a;
}

export function ProposalCard({ turn, setActionsOff, applyProposal, discardProposal, inputRef }) {
    const { rejected, base } = turn.proposal;
    const valid = turn.proposal.valid.map(a => withTitle(a, base));
    const excluded = turn.proposal.excluded || [];
    const isOff = (i) => excluded.includes(i);
    const kept = valid.length - excluded.length;
    const { groups, units } = buildDiff(valid, base);
    const [triage, setTriage] = useState(null); // index into units while reviewing
    const [openExisting, setOpenExisting] = useState(() => new Set());

    const setOff = (indices, off) => setActionsOff(turn.id, indices, off);
    const unitOff = (u) => u.indices.every(isOff);

    // A new workspace exists only for its items: dropping the last one drops
    // the create, and keeping any item brings it back.
    const decide = (unit, off) => {
        const indices = [...unit.indices];
        for (const g of unit.groups || []) {
            if (g.createIndex == null) continue;
            const othersOn = g.rows.some(r => r.unit !== unit && !unitOff(r.unit));
            if (!off || !othersOn) indices.push(g.createIndex);
        }
        setOff(indices, off);
    };
    const groupIndices = (g) => [g.createIndex, g.renameIndex, ...g.rows.flatMap(r => r.unit.indices)].filter(i => i != null);
    const toggleGroup = (g) => {
        const all = groupIndices(g);
        setOff(all, all.some(i => !isOff(i)));
    };

    const counts = (g) => {
        const live = g.rows.filter(r => !unitOff(r.unit));
        return {
            add: live.filter(r => r.kind === 'add' || r.kind === 'move-in').length,
            remove: live.filter(r => r.kind === 'remove' || r.kind === 'move-out').length,
        };
    };

    if (triage != null && units.length) {
        return (
            <Triage
                units={units}
                index={triage}
                setIndex={setTriage}
                unitOff={unitOff}
                decide={decide}
                kept={kept}
                total={valid.length}
                onApply={() => applyProposal(turn)}
                onExit={() => { setTriage(null); inputRef?.current?.focus(); }}
            />
        );
    }

    return (
        <div className="spotlight-agent-proposal">
            <div className="spotlight-agent-proposal-head">
                <span>{groups.length > 1 ? `${groups.length} workspaces change` : '1 workspace changes'}</span>
                {units.length > 1 && (
                    <button
                        type="button"
                        className="spotlight-proposal-review"
                        onMouseDown={(e) => { e.preventDefault(); setTriage(0); }}
                        title="Go through the changes one at a time: Y keep, N skip"
                    >
                        Review one by one
                    </button>
                )}
            </div>

            {groups.map(g => {
                const all = groupIndices(g);
                const on = all.filter(i => !isOff(i)).length;
                const state = on === 0 ? 'off' : on === all.length ? 'on' : 'mixed';
                const { add, remove } = counts(g);
                const showExisting = openExisting.has(g.name);
                return (
                    <div key={g.name} className={`spotlight-proposal-group is-${state}`}>
                        <div
                            className="spotlight-proposal-group-head"
                            role="checkbox"
                            aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
                            tabIndex={0}
                            title={state === 'off' ? 'Include this workspace' : 'Skip this whole workspace'}
                            onMouseDown={(e) => { e.preventDefault(); toggleGroup(g); }}
                            onKeyDown={onToggleKey(() => toggleGroup(g))}
                        >
                            <span className="spotlight-proposal-check" aria-hidden="true" />
                            <span className="spotlight-proposal-group-name">{g.name}</span>
                            {g.createIndex != null && <span className="spotlight-proposal-badge is-new">new</span>}
                            {g.renamedFrom && <span className="spotlight-proposal-badge">was {g.renamedFrom}</span>}
                            <span className="spotlight-proposal-count">
                                {add > 0 && <span className="is-add">+{add}</span>}
                                {remove > 0 && <span className="is-remove">−{remove}</span>}
                            </span>
                        </div>
                        {g.why && <div className="spotlight-proposal-why is-group">{g.why}</div>}

                        <ul className="spotlight-proposal-items">
                            {g.rows.map(({ unit, kind }) => {
                                // A move reads the same on both sides: the page (titled
                                // from its add half), then where it goes or came from.
                                const a = unit.action;
                                const { label, meta } = labelOf(a);
                                const off = unitOff(unit);
                                const isRemove = kind === 'remove' || kind === 'move-out';
                                return (
                                    <li
                                        key={unit.key + kind}
                                        role="checkbox"
                                        aria-checked={!off}
                                        tabIndex={0}
                                        title={`${off ? 'Skipped — click to include' : 'Click to skip'}\n${a.url || a.path || ''}`}
                                        className={`${isRemove ? 'is-remove' : 'is-add'}${off ? ' is-off' : ''}`}
                                        onMouseDown={(e) => { e.preventDefault(); decide(unit, !off); }}
                                        onKeyDown={onToggleKey(() => decide(unit, !off))}
                                    >
                                        <span className="spotlight-proposal-sign" aria-hidden="true">{isRemove ? '−' : '+'}</span>
                                        <span className="spotlight-proposal-item-body">
                                            <span className="spotlight-proposal-item-line">
                                                <span className="spotlight-proposal-item-label">{label}</span>
                                                {kind === 'move-out' && <span className="spotlight-proposal-item-meta is-move">→ {unit.move.to}</span>}
                                                {kind === 'move-in' && <span className="spotlight-proposal-item-meta is-move">← from {unit.move.from}</span>}
                                                {!unit.move && meta && meta !== label && <span className="spotlight-proposal-item-meta">{meta}</span>}
                                            </span>
                                            {a.why && kind !== 'move-out' && <span className="spotlight-proposal-why">{a.why}</span>}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>

                        {g.existing.length > 0 && (
                            <>
                                <button
                                    type="button"
                                    className="spotlight-proposal-existing-toggle"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        setOpenExisting(prev => {
                                            const next = new Set(prev);
                                            next.has(g.name) ? next.delete(g.name) : next.add(g.name);
                                            return next;
                                        });
                                    }}
                                >
                                    {showExisting ? '▾' : '▸'} {g.existing.length} already here
                                </button>
                                {showExisting && (
                                    <ul className="spotlight-proposal-existing">
                                        {g.existing.map((x, k) => (
                                            <li key={k}>
                                                <span className="spotlight-proposal-item-label">{x.label}</span>
                                                {x.meta && x.meta !== x.label && <span className="spotlight-proposal-item-meta">{x.meta}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </div>
                );
            })}

            {/* Rejected actions are surfaced, not swallowed: applying half a
                plan without saying so is worse than failing. */}
            {rejected.length > 0 && (
                <details className="spotlight-agent-rejected">
                    <summary>{rejected.length} action(s) discarded as invalid</summary>
                    <ul>
                        {rejected.map((r, i) => <li key={i}>{r.reason}</li>)}
                    </ul>
                </details>
            )}

            <div className="spotlight-agent-confirm">
                <button
                    type="button"
                    className="spotlight-agent-apply"
                    disabled={kept === 0}
                    onMouseDown={(e) => { e.preventDefault(); applyProposal(turn); }}
                >
                    {excluded.length ? `Apply ${kept} of ${valid.length}` : 'Apply'}
                    <kbd>⌘⏎</kbd>
                </button>
                <button
                    type="button"
                    className="spotlight-agent-discard"
                    onMouseDown={(e) => { e.preventDefault(); discardProposal(turn); }}
                >
                    Discard
                </button>
            </div>
        </div>
    );
}

/**
 * One change at a time. Owns the keyboard while open (Y/N/←/→/Esc) — the
 * search input would otherwise swallow the letters — and hands focus back to
 * the input on the way out.
 */
function Triage({ units, index, setIndex, unitOff, decide, kept, total, onApply, onExit }) {
    const ref = useRef(null);
    useEffect(() => { ref.current?.focus(); }, []);

    const unit = units[Math.min(index, units.length - 1)];
    const a = unit.action;
    const { label, meta } = labelOf(a);
    const off = unitOff(unit);
    const isRemove = !unit.move && a.type.startsWith('remove');
    const target = unit.groups?.find(g => g.name === a.workspace) || unit.groups?.[0];
    const keptUnits = units.filter(u => !unitOff(u)).length;

    const next = () => (index + 1 >= units.length ? onExit() : setIndex(index + 1));
    const choose = (keep) => { decide(unit, !keep); next(); };

    const onKeyDown = (e) => {
        const k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (kept > 0) onApply(); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (k === 'y') { e.preventDefault(); choose(true); }
        else if (k === 'n') { e.preventDefault(); choose(false); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setIndex(Math.min(index + 1, units.length - 1)); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex(Math.max(index - 1, 0)); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onExit(); }
    };

    return (
        <div className="spotlight-agent-proposal spotlight-triage" ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="spotlight-agent-proposal-head">
                <span>Review {index + 1} of {units.length}</span>
                <span className="spotlight-triage-tally">{keptUnits} kept · {units.length - keptUnits} skipped</span>
            </div>

            <div className={`spotlight-triage-item${off ? ' is-off' : ''}`}>
                <div className="spotlight-triage-label">{label}</div>
                {meta && meta !== label && <div className="spotlight-proposal-item-meta">{meta}</div>}
                <div className="spotlight-triage-target">
                    {unit.move ? (
                        <>Move from <b>{unit.move.from}</b> to <b>{unit.move.to}</b></>
                    ) : isRemove ? (
                        <>Remove from <b>{a.workspace}</b></>
                    ) : (
                        <>Add to <b>{a.workspace}</b>{target?.createIndex != null && <span className="spotlight-proposal-badge is-new">new</span>}</>
                    )}
                </div>
                {a.why && <div className="spotlight-proposal-why">{a.why}</div>}
            </div>

            <div className="spotlight-triage-keys">
                <button type="button" className="spotlight-agent-apply" onMouseDown={(e) => { e.preventDefault(); choose(true); }}>
                    Keep <kbd>Y</kbd>
                </button>
                <button type="button" className="spotlight-agent-discard" onMouseDown={(e) => { e.preventDefault(); choose(false); }}>
                    Skip <kbd>N</kbd>
                </button>
                <span className="spotlight-triage-hint">← → move · Esc back to the list</span>
            </div>
        </div>
    );
}

const onToggleKey = (fn) => (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        fn();
    }
};
