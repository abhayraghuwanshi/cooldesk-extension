import React, { useState } from 'react';

export function Tabs({
  children,
  activeTab: controlledActiveTab,
  onTabChange,
  disabledTitles = []
}) {
  const childArray = React.Children.toArray(children);

  // Initial order = [0, 1, 2, ...]
  const [order, setOrder] = useState(childArray.map((_, i) => i));

  const [internalTab, setInternalTab] = useState(0);
  const activeTab =
    typeof controlledActiveTab === "number" ? controlledActiveTab : internalTab;

  const setActiveTab =
    typeof onTabChange === "function" ? onTabChange : setInternalTab;

  // Move clicked tab index to top (last used first)
  const handleTabClick = (index) => {
    setOrder((prev) => {
      const newOrder = prev.filter((i) => i !== index);
      newOrder.unshift(index); // put clicked tab at top
      return newOrder;
    });

    setActiveTab(index);
  };

  return (
    <div>
      <div
        className="tab-list"
        role="tablist"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4
        }}
      >
        {order.map((childIndex) => {
          const child = childArray[childIndex];
          const title = child.props.title;

          const isDisabled =
            Array.isArray(disabledTitles) && disabledTitles.includes(title);

          const isActive = activeTab === childIndex;

          return (
            <button
              key={childIndex}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                if (!isDisabled) handleTabClick(childIndex);
              }}
              disabled={isDisabled}
              className="filter-btn"
              style={{
                borderRadius: "8px",
                padding: "8px 12px",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                cursor: isDisabled ? "not-allowed" : "pointer",
                background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                color: isDisabled ? "var(--text-muted)" : "var(--text)",
                fontWeight: isActive ? 600 : 500,
                border: "none"
              }}
            >
              {title}
            </button>
          );
        })}
      </div>

      {/* Render content of actual active tab */}
      <div className="tab-content" style={{ marginTop: 0 }}>
        {childArray[activeTab]}
      </div>
    </div>
  );
}

export function TabItem({ title, children }) {
  return <>{children}</>;
}
