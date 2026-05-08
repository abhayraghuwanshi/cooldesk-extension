import '@fortawesome/fontawesome-svg-core/styles.css';
import { config } from '@fortawesome/fontawesome-svg-core';
config.autoAddCss = false;
import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { initChromePolyfill } from './services/chromePolyfill';

// Initialize Chrome API polyfill for Electron environment
// Initialize Chrome API polyfill for Electron environment
import './electron-shim';
initChromePolyfill();

// Lazy load GlobalSpotlight to keep initial bundle small
const GlobalSpotlight = React.lazy(() =>
    import('./components/GlobalSpotlight').then(module => ({ default: module.GlobalSpotlight }))
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

function SpotlightApp() {
    return (
        <ErrorBoundary>
            <Suspense fallback={<div style={{ color: '#fff', padding: '20px' }}>Loading Spotlight...</div>}>
                <GlobalSpotlight />
            </Suspense>
        </ErrorBoundary>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <SpotlightApp />
);
