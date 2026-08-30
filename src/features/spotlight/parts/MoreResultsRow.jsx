import { memo, useCallback, useEffect, useRef } from 'react';
import { isRealPointerMove } from '../../../utils/helpers';
import { lastPointerPos } from './hoverGuard';

// The "+N more results" row — a real navigable row (see hasMoreResultsRow in
// GlobalSpotlight's handleKeyDown) so it's reachable the same way as any other
// result, not just by clicking. Shares ResultItem's pointer-move guard and
// keyboard-driven scrollIntoView so it behaves identically under mouse/keyboard nav.
export const MoreResultsRow = memo(function MoreResultsRow({ isSelected, count, onSelect, onHover }) {
    const rowRef = useRef(null);
    const hoverSelectedRef = useRef(false);
    const handleMouseEnter = useCallback((e) => {
        if (!isRealPointerMove(lastPointerPos, e)) return;
        hoverSelectedRef.current = true;
        onHover();
    }, [onHover]);

    useEffect(() => {
        if (isSelected && rowRef.current && !hoverSelectedRef.current) {
            rowRef.current.scrollIntoView({ block: 'nearest' });
        }
        hoverSelectedRef.current = false;
    }, [isSelected]);

    return (
        <div
            ref={rowRef}
            className={`spotlight-more-results${isSelected ? ' selected' : ''}`}
            onClick={onSelect}
            onMouseEnter={handleMouseEnter}
        >
            +{count} more results (refine your search)
        </div>
    );
});
