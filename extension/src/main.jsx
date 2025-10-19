import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Import layout components (only 2 layouts)
import FocusLayout from './layout/FocusLayout.jsx'
import DefaultLayout from './layout/DefaultLayout.jsx'

// Layout wrapper component that listens for changes
function LayoutWrapper({ children }) {
  const [layoutMode, setLayoutMode] = useState(() => {
    try {
      return localStorage.getItem('cooldesk_layout_mode') || 'default';
    } catch {
      return 'default';
    }
  });

  // Listen for layout changes
  useEffect(() => {
    const handleLayoutChange = (event) => {
      console.log('[CoolDesk] Layout changed to:', event.detail);
      setLayoutMode(event.detail);
    };

    window.addEventListener('layoutModeChanged', handleLayoutChange);
    return () => window.removeEventListener('layoutModeChanged', handleLayoutChange);
  }, []);

  // Update root class when layout changes
  useEffect(() => {
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.className = `layout-${layoutMode}`;
    }
  }, [layoutMode]);

  // Select layout component
  const LayoutComponent = layoutMode === 'focus' ? FocusLayout : DefaultLayout;

  return (
    <LayoutComponent>
      {children}
    </LayoutComponent>
  );
}

// Smart render with error boundary and performance monitoring
const renderApp = () => {
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    console.error('Root element not found');
    return;
  }

  // Check if we're in development mode
  const isDev = import.meta.env.DEV;
  
  // Get initial layout mode
  const savedLayoutMode = (() => {
    try {
      return localStorage.getItem('cooldesk_layout_mode') || 'default';
    } catch {
      return 'default';
    }
  })();

  // Apply layout class to root for CSS-based optimizations
  rootElement.className = `layout-${savedLayoutMode}`;

  // Render with layout wrapper that handles dynamic switching
  const AppWrapper = isDev ? (
    <StrictMode>
      <LayoutWrapper>
        <App />
      </LayoutWrapper>
    </StrictMode>
  ) : (
    <LayoutWrapper>
      <App />
    </LayoutWrapper>
  );

  createRoot(rootElement).render(AppWrapper);

  // Log render info in development
  if (isDev) {
    console.log('[CoolDesk] Rendered with layout:', savedLayoutMode);
  }
};

// Execute initial render
renderApp();

// Hot Module Replacement (HMR) support for Vite
if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', (newModule) => {
    console.log('[HMR] App module updated');
    renderApp();
  });
}
