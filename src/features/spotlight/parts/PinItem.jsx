import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback } from 'react';
import { getFaviconUrl } from '../../../utils/helpers';

// Memoized Pin Item to prevent unnecessary re-renders
export const PinItem = memo(function PinItem({ pin, index, isSelected, onSelect, onHover, onRemove, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(pin), [pin, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handleRemove = useCallback((e) => onRemove(index, e), [index, onRemove]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '<span class="fa-icon-wrapper">💻</span>';
    }, []);
    const handleFaviconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '🔗';
    }, []);

    return (
        <div
            className={`pin-item ${pin.type === 'app' ? 'pin-app' : ''} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
        >
            <div className="pin-icon">
                {pin.type === 'app' ? (
                    (pin.icon && pin.icon.length > 50) ? (
                        <img src={pin.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(pin.name)} className="app-icon" />
                    )
                ) : (() => {
                    const resolvedFavicon = pin.favicon || (pin.url ? getFaviconUrl(pin.url, 32, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleFaviconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={faGlobe} />
                    );
                })()}
            </div>
            <span className="pin-label">{pin.title || pin.name || 'Link'}</span>
            <span className="pin-remove" onClick={handleRemove}>×</span>
        </div>
    );
});
