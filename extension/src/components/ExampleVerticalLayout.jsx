import React, { useState } from 'react';
import { VerticalHeader } from './VerticalHeader';

// Example component showing how to use the vertical sidebar layout
export function ExampleVerticalLayout() {
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [activeTab, setActiveTab] = useState('workspace');
  const [activeSection, setActiveSection] = useState(0);
  const [useVerticalLayout, setUseVerticalLayout] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const progress = { running: false };
  
  const openSyncControls = () => {
    console.log('Opening sync controls...');
  };
  
  const openInTab = (url) => {
    console.log('Opening in tab:', url);
  };

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f1522 0%, #1b2331 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      position: 'relative'
    }}>
      
      {/* Toggle Button for Demo */}
      <button
        onClick={() => setUseVerticalLayout(!useVerticalLayout)}
        style={{
          position: 'fixed',
          top: '20px',
          left: '20px',
          zIndex: 3000,
          padding: '8px 16px',
          background: 'rgba(96, 165, 250, 0.8)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '500'
        }}
      >
        {useVerticalLayout ? 'Switch to Horizontal' : 'Switch to Vertical'}
      </button>

      {/* Vertical Sidebar (when enabled) */}
      {useVerticalLayout && (
        <VerticalHeader
          search={search}
          setSearch={setSearch}
          setShowSettings={setShowSettings}
          openSyncControls={openSyncControls}
          progress={progress}
          setShowCreateWorkspace={setShowCreateWorkspace}
          openInTab={openInTab}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
        />
      )}

      {/* Main Content Area */}
      <div
        className={useVerticalLayout ? `content-with-vertical-sidebar ${sidebarCollapsed ? 'collapsed' : ''}` : ''}
        style={{
          padding: useVerticalLayout ? '40px 40px 40px 40px' : '80px 40px 40px 40px',
          minHeight: '100vh',
          transition: 'margin-right 0.3s ease'
        }}
      >
        {/* Original Header (when vertical is disabled) */}
        {!useVerticalLayout && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: '60px',
            background: 'linear-gradient(90deg, rgba(15, 21, 34, 0.95) 0%, rgba(27, 35, 49, 0.95) 100%)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            zIndex: 1000,
            color: 'white'
          }}>
            <div>Horizontal Header Layout</div>
            <div>Search • Controls • Actions</div>
          </div>
        )}

        {/* Demo Content */}
        <div style={{ color: 'white' }}>
          <h1 style={{ 
            fontSize: '2.5em', 
            fontWeight: '700', 
            margin: '0 0 20px 0',
            background: 'linear-gradient(135deg, #60a5fa 0%, #8b5cf6 100%)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            {useVerticalLayout ? 'Vertical Sidebar Layout' : 'Horizontal Header Layout'}
          </h1>
          
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Layout Features:</h3>
            {useVerticalLayout ? (
              <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6' }}>
                <li>✅ **Vertical sidebar** on the right side</li>
                <li>✅ **Collapsible design** - click toggle to minimize</li>
                <li>✅ **Scrollable content area** with proper margins</li>
                <li>✅ **Grouped controls** - Search, Navigation, Actions</li>
                <li>✅ **Responsive design** - mobile overlay on small screens</li>
                <li>✅ **Smooth animations** and hover effects</li>
                <li>✅ **Icon-only mode** when collapsed</li>
                <li>✅ **Music controls** inline when expanded</li>
              </ul>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6' }}>
                <li>📏 **Horizontal header** across the top</li>
                <li>📐 **Fixed height** takes up less vertical space</li>
                <li>📱 **Better for wide screens** and traditional layouts</li>
                <li>🔄 **Easy to switch** between layouts</li>
              </ul>
            )}
          </div>

          {/* Demo Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            marginTop: '20px'
          }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div
                key={i}
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  backdropFilter: 'blur(10px)'
                }}
              >
                <h4 style={{ margin: '0 0 10px 0' }}>Content Card {i}</h4>
                <p style={{ margin: 0, opacity: 0.8, fontSize: '14px', lineHeight: '1.5' }}>
                  This is example content that demonstrates how the layout works with scrollable content. 
                  The {useVerticalLayout ? 'vertical sidebar' : 'horizontal header'} provides easy access to all controls.
                </p>
              </div>
            ))}
          </div>

          <div style={{ 
            marginTop: '40px', 
            padding: '20px',
            background: 'rgba(96, 165, 250, 0.1)',
            borderRadius: '12px',
            border: '1px solid rgba(96, 165, 250, 0.3)'
          }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#60a5fa' }}>Implementation Guide:</h3>
            <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
              <p><strong>1. Import the VerticalHeader component:</strong></p>
              <code style={{ 
                display: 'block', 
                background: 'rgba(0, 0, 0, 0.3)', 
                padding: '10px', 
                borderRadius: '6px', 
                fontSize: '13px',
                marginBottom: '10px'
              }}>
                import {`{VerticalHeader}`} from './components/VerticalHeader';
              </code>
              
              <p><strong>2. Add the content wrapper class:</strong></p>
              <code style={{ 
                display: 'block', 
                background: 'rgba(0, 0, 0, 0.3)', 
                padding: '10px', 
                borderRadius: '6px', 
                fontSize: '13px',
                marginBottom: '10px'
              }}>
                &lt;div className="content-with-vertical-sidebar"&gt;...&lt;/div&gt;
              </code>
              
              <p><strong>3. The sidebar automatically adjusts content margins</strong></p>
              <p><strong>4. Mobile responsive - becomes overlay on small screens</strong></p>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Modals */}
      {showSettings && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #0f1522 0%, #1b2331 100%)',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'white'
          }}>
            <h3>Settings Modal</h3>
            <p>This would be your settings content.</p>
            <button onClick={() => setShowSettings(false)}>Close</button>
          </div>
        </div>
      )}

      {showCreateWorkspace && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #0f1522 0%, #1b2331 100%)',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'white'
          }}>
            <h3>Create Workspace Modal</h3>
            <p>This would be your create workspace form.</p>
            <button onClick={() => setShowCreateWorkspace(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}