import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback } from 'react';
import { getFaviconUrl } from '../../../utils/helpers';
import { getRunningAppContext } from './appContext';

// Memoized Context Item - compact version for grouped display
export const ContextItem = memo(function ContextItem({ item, index, isSelected, onSelect, onHover, onClose, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handleClose = useCallback((e) => onClose?.(item, e), [item, onClose]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
    }, []);

    const isApp = item.type === 'app';
    const isRunning = isApp && item.isRunning;
    const appContext = isApp ? getRunningAppContext(item) : null;
    // Tabs are always closable; apps only when running (an installed app isn't "open")
    const canClose = !isApp || isRunning;

    return (
        <div
            className={`context-item ${isApp ? 'context-app' : 'context-tab'} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            title={isApp ? [item.name || item.title, appContext].filter(Boolean).join(' • ') : (item.title || item.url)}
        >
            <div className="pin-icon">
                {isApp ? (
                    (item.icon && item.icon.length > 50) ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} style={{ color: '#60a5fa' }} />
                    )
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 16, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleIconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={faGlobe} style={{ color: '#a78bfa' }} />
                    );
                })()}
            </div>
            <span className="pin-label">
                {isApp ? (appContext || item.name || item.title) : (item.title || 'Tab')}
            </span>
            {isRunning && <span className="running-dot" />}
            {canClose && (
                <span
                    className="context-close"
                    onClick={handleClose}
                    title={isApp ? 'Close app' : 'Close tab'}
                    role="button"
                    aria-label={isApp ? 'Close app' : 'Close tab'}
                >
                    ×
                </span>
            )}
        </div>
    );
});
