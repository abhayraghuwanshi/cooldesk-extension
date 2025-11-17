import React, { useState } from 'react';

export function Tabs({ children, activeTab: controlledActiveTab, onTabChange, disabledTitles = [] }) {
  const [internalTab, setInternalTab] = useState(0);
  const activeTab = (typeof controlledActiveTab === 'number') ? controlledActiveTab : internalTab;
  const setActiveTab = (typeof onTabChange === 'function') ? onTabChange : setInternalTab;

  return (
    <div>
      <div
        className="tab-list"
        role="tablist"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {React.Children.map(children, (child, index) => {
          const title = child.props.title;
          const isDisabled = Array.isArray(disabledTitles) && disabledTitles.includes(title);
          const isActive = activeTab === index;

          return (
            <button
              key={index}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                if (isDisabled) return;
                setActiveTab(index);
              }}
              disabled={isDisabled}
              className="filter-btn"
              style={{
                borderRadius: '8px',
                padding: '8px 12px',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: isDisabled ? 'var(--text-muted)' : 'var(--text)',
                fontWeight: isActive ? 600 : 500,
                border: 'none',
              }}
            >
              {title}
            </button>
          );
        })}
      </div>
      <div className="tab-content" style={{ marginTop: 0 }}>
        {React.Children.toArray(children)[activeTab]}
      </div>
    </div>
  );
}

export function TabItem({ title, children }) {
  return <>{children}</>;
}