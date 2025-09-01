import React, { useState } from 'react';

export function Tabs({ children, activeTab: controlledActiveTab, onTabChange, disabledTitles = [] }) {
  const [internalTab, setInternalTab] = useState(0);
  const activeTab = (typeof controlledActiveTab === 'number') ? controlledActiveTab : internalTab;
  const setActiveTab = (typeof onTabChange === 'function') ? onTabChange : setInternalTab;
  
  return (
    <div>
      <div className="tab-list" role="tablist" style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        {React.Children.map(children, (child, index) => (
          <button
            key={index}
            role="tab"
            aria-selected={activeTab === index}
            onClick={() => {
              const title = child.props.title
              const isDisabled = Array.isArray(disabledTitles) && disabledTitles.includes(title)
              if (isDisabled) return
              setActiveTab(index)
            }}
            disabled={Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)}
            className="filter-btn"
            style={{
              fontSize: '14px',
              fontWeight: '600',
              padding: '12px 20px',
              borderRadius: '12px',
              border: 'none',
              cursor: Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
              background: Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)
                ? 'rgba(255, 255, 255, 0.03)'
                : (activeTab === index ? '#34C759' : 'rgba(255, 255, 255, 0.1)'),
              border: activeTab === index ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
              color: Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)
                ? '#6b7280'
                : (activeTab === index ? 'white' : '#e5e7eb'),
              backdropFilter: 'blur(10px)',
              fontWeight: activeTab === index ? '600' : '500',
              opacity: Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title) ? 0.5 : 1,
              position: 'relative',
              overflow: 'hidden',
              boxShadow: activeTab === index ? '0 4px 16px rgba(52, 199, 89, 0.3)' : 'none',
            }}
            onMouseEnter={(e) => {
              if (!(Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title))) {
                if (activeTab !== index) {
                  e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                  e.target.style.transform = 'translateY(-1px)';
                }
              }
            }}
            onMouseLeave={(e) => {
              if (!(Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title))) {
                if (activeTab !== index) {
                  e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.target.style.transform = 'translateY(0)';
                }
              }
            }}
          >
            {child.props.title}
            {activeTab === index && (
              <div style={{
                position: 'absolute',
                bottom: '0',
                left: '0',
                right: '0',
                height: '2px',
                background: 'rgba(255, 255, 255, 0.3)',
                borderRadius: '1px'
              }} />
            )}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {React.Children.toArray(children)[activeTab]}
      </div>
    </div>
  );
}

export function TabItem({ title, children }) {
  return <>{children}</>;
}