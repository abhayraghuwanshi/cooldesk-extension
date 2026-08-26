import '@fortawesome/fontawesome-svg-core/styles.css';
import { config } from '@fortawesome/fontawesome-svg-core';
config.autoAddCss = false;
import React, { Suspense } from 'react';
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
    return (
        <ErrorBoundary>
            <Suspense fallback={<div style={{ color: '#fff', padding: '20px' }}>Loading Spotlight...</div>}>
                <GlobalSpotlight isDesktopApp={isDesktopApp} />
            </Suspense>
        </ErrorBoundary>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <SpotlightApp />
);
