import React, { useState } from 'react';
import { getFaviconUrl } from '../utils';

export function AddLinkFlow({ allItems, currentWorkspace, onAdd, onCancel }) {
  const [search, setSearch] = useState('');
  // Debounce the search input to avoid filtering on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('');

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const handleAddItem = (item) => {
    onAdd(item, currentWorkspace);
  };

  const filteredItems = React.useMemo(() => {
    const q = debouncedSearch;
    if (!q) return allItems.filter(item => !item.workspaceGroup);
    return allItems.filter(item => {
      if (item.workspaceGroup) return false;
      const title = item.title?.toLowerCase() ?? '';
      const url = item.url?.toLowerCase() ?? '';
      const desc = item.description?.toLowerCase() ?? '';
      return title.includes(q) || url.includes(q) || desc.includes(q);
    });
  }, [allItems, debouncedSearch]);

  return (
    <div className="add-link-flow">
      <div
        className="add-link-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingBottom: 8,
          borderBottom: '1px solid #273043',
          marginBottom: 10,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Add to "{currentWorkspace}"</h3>
        <button onClick={onCancel} className="cancel-btn">Done</button>
      </div>
      <input
        type="text"
        placeholder="Search existing items or paste a new link..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="search-input"
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid #273043',
          background: '#1b2331',
          color: '#e5e7eb',
          outline: 'none',
          marginBottom: 8,
        }}
      />
      <ul className="workspace-grid">
        {filteredItems.map((item) => {
          const base = item.url;
          const favicon = getFaviconUrl(base);
          return (
            <li key={item.id} className="workspace-item">
              <div
                className="item-header"
                onClick={() => window.open(base, '_blank')}
                title={base}
              >
                <div className="item-info">
                  {favicon && <img className="favicon" src={favicon} alt="" />}
                  <div className="domain-info">
                    <span className="url-key">
                      {base.length > 40 ? base.slice(0, 37) + '…' : base}
                    </span>
                  </div>
                </div>
                <div className="item-actions">
                  <button
                    className="details-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddItem(item);
                    }}
                    title="Add this link to the workspace"
                  >
                    Add
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
