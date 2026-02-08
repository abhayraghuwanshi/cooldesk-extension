import { useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '../services/extensionApi';
import { isNaturalLanguageQuery, naturalLanguageSearch, quickSearch } from '../services/searchService';
import './GlobalSpotlight.css';

// Hook to detect click outside
function useOnClickOutside(ref, handler) {
    useEffect(() => {
        const listener = (event) => {
            // Do nothing if clicking ref's element or descendent elements
            if (!ref.current || ref.current.contains(event.target)) {
                return;
            }
            handler(event);
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler]);
}

export function GlobalSpotlight() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1); // Start with nothing selected
    const [pinnedItems, setPinnedItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deepSearch, setDeepSearch] = useState(false);
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    // Focus input on mount and load pins
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
        loadPinnedItems();

        // Listen for spotlight-shown event from Electron (when Alt+K is pressed)
        if (window.electronAPI?.subscribe) {
            const unsubscribe = window.electronAPI.subscribe('spotlight-shown', () => {
                // Reset state and focus input
                setQuery('');
                setResults([]);
                setSelectedIndex(-1);
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            });
            return () => unsubscribe();
        }
    }, []);

    // Load Pinned Items
    const loadPinnedItems = async () => {
        try {
            const data = await storageGet(['spotlight_pins']);
            setPinnedItems(data.spotlight_pins || []);
        } catch (e) {
            console.warn('Failed to load pins', e);
        }
    };

    // Save Pinned Items
    const savePinnedItems = async (items) => {
        setPinnedItems(items);
        try {
            await storageSet({ spotlight_pins: items });
        } catch (e) {
            console.warn('Failed to save pins', e);
        }
    };

    // Toggle Pin
    const togglePin = (item, e) => {
        if (e) e.stopPropagation();

        const exists = pinnedItems.find(p => p.url === item.url);
        if (exists) {
            const newPins = pinnedItems.filter(p => p.url !== item.url);
            savePinnedItems(newPins);
        } else {
            if (pinnedItems.length >= 8) return; // Max 8
            const newPin = {
                title: item.title,
                url: item.url,
                favicon: item.favicon || item.icon,
                type: item.type
            };
            savePinnedItems([...pinnedItems, newPin]);
        }
    };

    const removePin = (index, e) => {
        if (e) e.stopPropagation();
        const newPins = [...pinnedItems];
        newPins.splice(index, 1);
        savePinnedItems(newPins);
    };

    // Handle Search
    useEffect(() => {
        const performSearch = async () => {
            if (!query.trim()) {
                setResults([]);
                setSelectedIndex(-1);
                return;
            }
            setLoading(true);
            try {
                // Mock Deep Search Delay
                if (deepSearch) {
                    await new Promise(r => setTimeout(r, 1500));
                }
                let searchResults;
                const isNaturalLanguage = isNaturalLanguageQuery(query);

                console.log('[GlobalSpotlight] Searching:', { query, isNaturalLanguage });

                if (isNaturalLanguage) {
                    searchResults = await naturalLanguageSearch(query, 12);
                } else {
                    searchResults = await quickSearch(query, 12);
                }

                // Filter out command type results (as per footerBar.js logic)
                if (searchResults) {
                    searchResults = searchResults.filter(r => r.type !== 'command');
                }

                // Enhance results with mock deep search data if enabled
                if (deepSearch) {
                    searchResults.unshift({
                        id: 'deep-search-result',
                        title: `Deep Analysis: ${query}`,
                        description: 'Generated comprehensive insight from 12 sources...',
                        type: 'ai',
                        icon: '✨'
                    });
                }

                setResults(searchResults || []);
                // Reset selection when results change
                setSelectedIndex(-1);
            } catch (err) {
                console.error('Search failed:', err);
            } finally {
                setLoading(false);
            }
        };

        const timeoutId = setTimeout(performSearch, 150);
        return () => clearTimeout(timeoutId);
    }, [query]);

    // Handle Keyboard Navigation
    const handleKeyDown = (e) => {
        if (results.length === 0) {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && results[selectedIndex]) {
                handleSelect(results[selectedIndex]);
            } else if (query.startsWith('http')) {
                handleSelect({ url: query, type: 'url' });
            } else if (results.length > 0) {
                // If nothing selected but results exist, select first
                handleSelect(results[0]);
            } else if (query.trim()) {
                // Fallback: Search Google (match footerBar.js behavior)
                const q = query.trim();
                console.log('[GlobalSpotlight] No results, searching Google for:', q);
                if (window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
                } else {
                    window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, '_blank');
                }
                handleClose();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
        } else if (e.key === 'p' && (e.metaKey || e.ctrlKey) && selectedIndex >= 0) {
            // Cmd+P to pin
            e.preventDefault();
            togglePin(results[selectedIndex]);
        }
    };

    const handleSelect = async (item) => {
        // For tabs, switch to the existing tab instead of opening new
        if (item.type === 'tab' && item.tabId) {
            console.log('[Spotlight] Jumping to tab:', item.tabId);
            try {
                // Use chrome.runtime.sendMessage - works in both extension and Electron (via polyfill)
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage({ type: 'JUMP_TO_TAB', tabId: item.tabId }, (response) => {
                        console.log('[Spotlight] JUMP_TO_TAB response:', response);
                    });
                }
                handleClose();
                return;
            } catch (e) {
                console.warn('[Spotlight] Failed to switch to tab, opening URL instead:', e);
            }
        }

        // Default: open URL
        if (item.url) {
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(item.url);
            } else {
                window.open(item.url, '_blank');
            }
        } else if (item.type === 'command') {
            // Handle commands if any
            console.log('Command executed:', item);
        }
        handleClose();
    };

    const handleSummarise = () => {
        // In global scope, we can't easily summarise "active page" unless we talk to main
        // Placeholder interaction
        console.log('Summarise requested');
        // Could send IPC to main to ask "active browser window" to summarize
        handleClose();
    };

    const handleClose = useCallback(() => {
        setQuery('');
        setResults([]);
        if (window.electronAPI && window.electronAPI.sendMessage) {
            window.electronAPI.sendMessage({ type: 'SPOTLIGHT_HIDE' });
        }
    }, []);

    // Close on click outside
    useOnClickOutside(containerRef, handleClose);

    // Format URL helper
    const formatUrl = (url) => {
        if (!url) return '';
        try {
            const u = new URL(url);
            return u.hostname.replace('www.', '') + (u.pathname !== '/' ? u.pathname : '');
        } catch { return url; }
    };

    // Badge Helper
    const getBadgeLabel = (item) => {
        if (item.type === 'tab') return 'Tab';
        if (item.type === 'workspace') return 'Space';
        if (item.type === 'history') return 'History';
        if (item.type === 'bookmark') return 'Bookmark';
        return item.category || 'Link';
    };

    return (
        <div className="spotlight-overlay">
            <div className="spotlight-container" ref={containerRef}>
                {/* Search Header */}
                <div className="spotlight-search-box">
                    <span className="spotlight-prompt">{'>'}</span>
                    <input
                        ref={inputRef}
                        className="spotlight-input"
                        placeholder="Search tabs, history, workspaces..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        spellCheck={false}
                    />
                    {loading && <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>}

                    <button
                        className={`spotlight-deep-btn ${deepSearch ? 'active' : ''}`}
                        onClick={() => setDeepSearch(!deepSearch)}
                        title="Toggle Deep Search"
                    >
                        ✨ Deep
                    </button>
                    <button
                        className="spotlight-close-btn"
                        onClick={handleClose}
                        title="Close (Esc)"
                    >
                        ×
                    </button>
                </div>

                {/* Pinned Section - Always visible if empty or matches logic */}
                <div className="spotlight-pins">
                    <div className="spotlight-pins-header">
                        <span className="spotlight-pins-title">Pinned Quick Access</span>
                    </div>
                    <div className="spotlight-pins-grid">
                        {pinnedItems.map((pin, i) => (
                            <div key={i} className="pin-item" onClick={() => handleSelect(pin)}>
                                <div className="pin-icon">
                                    {pin.favicon ? <img src={pin.favicon} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.innerHTML = '🔗' }} alt="" /> : '🔗'}
                                </div>
                                <span className="pin-label">{pin.title || 'Link'}</span>
                                <span className="pin-remove" onClick={(e) => removePin(i, e)}>×</span>
                            </div>
                        ))}
                        {pinnedItems.length < 8 && (
                            <div style={{ opacity: 0.3, fontSize: 11, padding: '6px', fontStyle: 'italic' }}>
                                {/* Placeholder for alignment */}
                            </div>
                        )}
                    </div>
                </div>

                {/* AI Actions */}
                <div className="spotlight-ai-actions">
                    <button className="spotlight-ai-btn" onClick={handleSummarise}>
                        <div className="btn-shine"></div>
                        <span style={{ fontSize: 16 }}>✨</span>
                        <span>Summarise Page</span>
                    </button>
                </div>

                {/* Results */}
                {results.length > 0 && (
                    <div className="spotlight-results">
                        {results.map((item, index) => (
                            <div
                                key={item.id || index}
                                className={`result-item ${index === selectedIndex ? 'selected' : ''}`}
                                onClick={() => handleSelect(item)}
                                onMouseEnter={() => setSelectedIndex(index)}
                            >
                                <div className="result-icon">
                                    {item.favicon ? (
                                        <img src={item.favicon} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.innerHTML = getIcon(item.type) }} alt="" />
                                    ) : (
                                        <span>{getIcon(item.type)}</span>
                                    )}
                                </div>
                                <div className="result-content">
                                    <span className="result-title">{item.title}</span>
                                    <span className="result-desc">{item.description || formatUrl(item.url)}</span>
                                </div>

                                {/* Badge OR Hint */}
                                {index === selectedIndex ? (
                                    <div className="result-hint">
                                        <span>Open</span>
                                        <span className="shortcut-key">↵</span>
                                    </div>
                                ) : (
                                    <span className="result-badge">{getBadgeLabel(item)}</span>
                                )}

                                {item.url && (
                                    <span
                                        className="pin-btn"
                                        title="Pin this"
                                        onClick={(e) => togglePin(item, e)}
                                    >
                                        📌
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div className="spotlight-footer">
                    <div className="shortcut-hint"><span className="shortcut-key">↵</span> Open</div>
                    <div className="shortcut-hint"><span className="shortcut-key">↑↓</span> Navigate</div>
                    <div className="shortcut-hint"><span className="shortcut-key">Esc</span> Close</div>
                    <div className="shortcut-hint" style={{ marginLeft: 'auto' }}><span className="shortcut-key">⌘P</span> Pin</div>
                </div>
            </div>
            <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
        </div>
    );
}

function getIcon(type) {
    switch (type) {
        case 'tab': return '🔵';
        case 'history': return '📜';
        case 'bookmark': return '⭐';
        case 'workspace': return '📁';
        case 'note': return '📝';
        default: return '🔗';
    }
}
