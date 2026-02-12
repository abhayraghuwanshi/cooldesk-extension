import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { initChromePolyfill } from './services/chromePolyfill';

// Initialize Chrome API polyfill for Electron environment
initChromePolyfill();

// Lazy load GlobalSpotlight to keep initial bundle small
const GlobalSpotlight = React.lazy(() =>
    import('./components/GlobalSpotlight').then(module => ({ default: module.GlobalSpotlight }))
);

function SpotlightApp() {
    return (
        <Suspense fallback={<div style={{ color: '#fff', padding: '20px' }}>Loading...</div>}>
            <GlobalSpotlight />
        </Suspense>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <SpotlightApp />
    </React.StrictMode>
);
