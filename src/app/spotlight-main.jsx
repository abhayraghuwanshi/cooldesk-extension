import '@fortawesome/fontawesome-svg-core/styles.css';
import { config } from '@fortawesome/fontawesome-svg-core';
config.autoAddCss = false;
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { initChromePolyfill } from '../services/chromePolyfill';

// Initialize Chrome API polyfill for Electron environment
// Initialize Chrome API polyfill for Electron environment
import './electron-shim';
initChromePolyfill();

// GlobalSpotlight.css scopes its window chrome (transparent bg, no scroll) to
// this class so the shared component can also be embedded in the main app.
document.body.classList.add('spotlight-window');

// Lazy load GlobalSpotlight to keep initial bundle small
const GlobalSpotlight = React.lazy(() =>
    import('../features/spotlight/GlobalSpotlight').then(module => ({ default: module.GlobalSpotlight }))
);

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Spotlight Error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, color: 'white' }}>
                    <h2>Something went wrong.</h2>
                    <pre style={{ color: 'red' }}>{this.state.error?.toString()}</pre>
                </div>
            );
        }

        return this.props.children;
    }
}

// Same detection CoolDeskContainer uses for the embedded spotlight — this
// standalone overlay window is a second Tauri window of the same app, so
// window.__TAURI__ is present here too. GlobalSpotlight defaults
// isDesktopApp to false when the prop is omitted, which silently disabled
// every desktop-only feature (app search, /a and /u browsing, the agent,
// dock layout controls, …) in this window specifically — the embedded
// spotlight passed the prop correctly and never showed the gap.
const isDesktopApp = typeof window !== 'undefined' &&
    !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.electronAPI);

function SpotlightApp() {
    // "Edit" from the sidebar card or the dock bar — the main window has no
    // embedded spotlight there, so it asks the backend (open_spotlight_edit)
    // to show this window and leaves the target in a pending slot. Take it on
    // mount (target set before this webview finished loading) and on every
    // nudge event. A fresh object each time, so re-editing the same
    // workspace re-triggers GlobalSpotlight's editTarget effect.
    const [editTarget, setEditTarget] = useState(null);
    useEffect(() => {
        if (!isDesktopApp) return;
        let unlisten = null;
        let cancelled = false;
        const take = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const ws = await invoke('take_spotlight_edit');
                if (ws?.id && !cancelled) setEditTarget({ id: ws.id, name: ws.name });
            } catch (e) {
                console.warn('[Spotlight] take_spotlight_edit failed:', e);
            }
        };
        take();
        import('@tauri-apps/api/event')
            .then(({ listen }) => listen('spotlight-edit-workspace', take))
            .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
            .catch(() => {});
        return () => { cancelled = true; unlisten?.(); };
    }, []);
    const handleExitEditMode = useCallback(() => setEditTarget(null), []);

    return (
        <ErrorBoundary>
            <Suspense fallback={<div style={{ color: '#fff', padding: '20px' }}>Loading Spotlight...</div>}>
                <GlobalSpotlight isDesktopApp={isDesktopApp} editTarget={editTarget} onExitEditMode={handleExitEditMode} />
            </Suspense>
        </ErrorBoundary>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <SpotlightApp />
);
