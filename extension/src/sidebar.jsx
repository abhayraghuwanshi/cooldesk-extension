// Global error caching for debugging "White Screen"
window.onerror = function (msg, url, line, col, error) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:20px;z-index:9999;font-size:12px;white-space:pre-wrap';
    div.textContent = 'Global Error: ' + msg + '\nLocation: ' + url + ':' + line + ':' + col + '\n' + (error ? error.stack : '');
    document.body.appendChild(div);
    return false;
};

window.onunhandledrejection = function (event) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:darkred;color:white;padding:20px;z-index:9999;font-size:12px;white-space:pre-wrap';
    div.textContent = 'Unhandled Rejection: ' + event.reason;
    document.body.appendChild(div);
};

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SidebarApp from './SidebarApp.jsx';
import './index.css';

try {
    const rootElement = document.getElementById('root');
    if (!rootElement) throw new Error('Root element #root not found');

    const root = createRoot(rootElement);
    root.render(
        <StrictMode>
            <SidebarApp />
        </StrictMode>,
    );
} catch (e) {
    console.error("Mount Error:", e);
    const div = document.createElement('div');
    div.style.color = 'red';
    div.textContent = 'Mount Error: ' + e.message;
    document.body.appendChild(div);
}
