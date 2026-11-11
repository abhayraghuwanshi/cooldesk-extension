import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '../shared/styles/base.css';
import '../shared/styles/mac-select.css';

import './electron-shim'; // Load Tauri/Electron Shim
import { initChromePolyfill } from '../services/chromePolyfill';
import { initActivityTracking } from '../services/analytics';

// Initialize Polyfill for Electron
initChromePolyfill();
// Anonymous "was CoolDesk used this minute" signal — see services/analytics.js.
initActivityTracking();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)