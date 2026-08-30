import { faThumbtack, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { getFaviconUrl, isRealPointerMove } from '../../../utils/helpers';
import { getFileVisual, getIcon } from './fileIcons';
import { lastPointerPos } from './hoverGuard';

// Memoized Result Item to prevent unnecessary re-renders
export const ResultItem = memo(function ResultItem({ item, index, isSelected, onSelect, onHover, onTogglePin, onRemove, formatUrl, getBadgeLabel, getAppIcon, depth = 0, isFolderRow = false, isExpanded = false, onToggleExpand }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    // Mark hover-driven selection so the scroll effect can skip it: while wheel
    // scrolling, rows slide under the stationary cursor and fire mouseenter —
    // auto-scrolling to each one fights the user's scroll direction and makes
    // the end of a long result list hard to reach.
    const hoverSelectedRef = useRef(false);
    const handleMouseEnter = useCallback((e) => {
        // Chromium re-fires mouseenter on whatever row ends up under a
        // *stationary* cursor whenever the layout shifts beneath it — e.g. the
        // results column narrowing to 280px the moment arrow-key navigation
        // lands on a file with a Quick Look preview (see .has-preview in
        // GlobalSpotlight.css). Without this guard that synthetic enter calls
        // onHover() and silently overwrites the selection the keyboard just
        // set, so navigating with arrow keys while the mouse merely rests
        // over the list list feels random. A real hover always carries
        // coordinates that differ from the last recorded mouse position; a
        // reflow-triggered one repeats the same coordinates because the
        // pointer device never moved.
        if (!isRealPointerMove(lastPointerPos, e)) return;
        hoverSelectedRef.current = true;
        onHover(index);
    }, [index, onHover]);
    const handlePinClick = useCallback((e) => onTogglePin(item, e), [item, onTogglePin]);
    const handleRemoveClick = useCallback((e) => { e.stopPropagation(); onRemove(item, e); }, [item, onRemove]);
    const handleToggle = useCallback((e) => { e.stopPropagation(); onToggleExpand?.(item); }, [item, onToggleExpand]);

    // Track icon load errors to show fallback
    const [iconError, setIconError] = useState(false);
    const rowRef = useRef(null);
    // Per-extension logo + tint for file rows (e.g. React-blue for .tsx).
    const fileMeta = item.type === 'file' ? getFileVisual(item.title || item.name) : null;

    // Reset error when item changes
    useEffect(() => {
        setIconError(false);
    }, [item.id, item.icon, item.favicon]);

    // Keep the keyboard-selected row visible as the tree scrolls. Hover-driven
    // selection is skipped — the row is already under the cursor, and scrolling
    // to it would hijack an in-progress wheel scroll.
    useEffect(() => {
        if (isSelected && rowRef.current && !hoverSelectedRef.current) {
            rowRef.current.scrollIntoView({ block: 'nearest' });
        }
        hoverSelectedRef.current = false;
    }, [isSelected]);

    return (
        <div
            ref={rowRef}
            className={`result-item ${isSelected ? 'selected' : ''} result-${['tab', 'bookmark', 'history', 'workspace', 'note', 'app', 'folder', 'file', 'todo'].includes(item.type) ? item.type : 'link'}`}
            title={(item.type === 'folder' || item.type === 'file') ? item.path : undefined}
            onClick={handleClick}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={handleMouseEnter}
        >
            {/* Tree indentation guides (one vertical line per ancestor level) */}
            {depth > 0 && Array.from({ length: depth }).map((_, d) => (
                <span key={d} className="tree-indent" />
            ))}
            {/* Expand/collapse chevron for folders in the tree */}
            {isFolderRow ? (
                <button
                    className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                    onClick={handleToggle}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                >▸</button>
            ) : (depth > 0 && <span className="tree-chevron-spacer" />)}
            <div
                className="result-icon"
                style={fileMeta?.color ? { color: fileMeta.color, background: `${fileMeta.color}1f` } : undefined}
            >
                {item.type === 'app' ? (
                    (item.icon && item.icon.length > 50 && !iconError) ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={() => setIconError(true)} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} className="app-icon" />
                    )
                ) : item.type === 'file' && fileMeta ? (
                    fileMeta.kind === 'si'
                        ? <fileMeta.Icon className="file-glyph" />
                        : <FontAwesomeIcon icon={fileMeta.Icon} />
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 32, null, true) : null);
                    return resolvedFavicon && !iconError ? (
                        <img src={resolvedFavicon} onError={() => setIconError(true)} alt="" />
                    ) : (
                        <div className="fa-icon-wrapper">
                            <FontAwesomeIcon icon={getIcon(item.type, item.title || item.name)} />
                        </div>
                    );
                })()}
            </div>
            <div className="result-content">
                <span className="result-title">{item.title || item.name}</span>
                <span className="result-desc">
                    {item.type === 'app'
                        ? (item.isRunning ? 'Running' : (item.path?.split(/[/\\]/).pop()?.replace(/\.app$/i, '') || 'Application'))
                        : (item.description || formatUrl(item.url))}
                </span>
            </div>

            {isSelected ? (
                <div className="result-hint">
                    <span>{item.type === 'app' ? (item.isRunning ? 'Focus' : 'Launch') : 'Open'}</span>
                    <span className="shortcut-key">↵</span>
                </div>
            ) : (
                <span className={`result-badge ${item.type === 'app' && item.isRunning ? 'badge-running' : ''}`}>
                    {getBadgeLabel(item)}
                </span>
            )}

            {onRemove ? (
                <span className="pin-btn" title="Remove" onClick={handleRemoveClick}>
                    <FontAwesomeIcon icon={faTimes} />
                </span>
            ) : (
                <span
                    className="pin-btn"
                    title="Pin this"
                    onClick={handlePinClick}
                    style={(item.url || item.type === 'app') ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
                >
                    <FontAwesomeIcon icon={faThumbtack} />
                </span>
            )}
        </div>
    );
});
