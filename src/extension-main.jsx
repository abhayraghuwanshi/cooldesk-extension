/**
 * Extension-only entry point
 * Does NOT import electron-shim or other app-only dependencies
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ExtensionApp from './ExtensionApp.jsx';
import './index.css';

// No electron shim needed for extension
// No chrome polyfill needed - we're in actual Chrome

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ExtensionApp />
  </StrictMode>,
);
