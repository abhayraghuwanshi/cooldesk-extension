import React from 'react';

export function Header({
  search,
  setSearch,
  populate,
  setShowSettings,
  startEnrichment,
  progress,
  setShowCreateWorkspace,
  openInTab,
}) {
  return (
    <header className="header">
      <div className="logo-placeholder">
        <div className="logo-icon">🚀</div>
        <span className="logo-text">CoolDesk AI</span>
      </div>
      <div className="header-actions">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const q = (search || '').trim();
              if (!q) return;
              try {
                if (chrome?.search?.query) {
                  chrome.search.query({ text: q, disposition: 'NEW_TAB' });
                } else if (chrome?.tabs?.create) {
                  chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
                }
              } catch (err) {
                console.error('Search failed:', err);
              }
            }
          }}
          placeholder="Search Google..."
          className="search"
        />
        <button className="icon-btn" onClick={populate} title="Refresh Data">
          <i className="fas fa-sync-alt"></i>
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
          <i className="fas fa-cog"></i>
        </button>
        <button className="icon-btn" onClick={startEnrichment} disabled={progress.running} title={progress.running ? 'Syncing…' : 'Sync with AI'}>
          <i className={`fas ${progress.running ? 'fa-spinner fa-spin' : 'fa-robot'}`}></i>
        </button>
        <button className="icon-btn" onClick={() => setShowCreateWorkspace(true)} title="Create Workspace">
          <i className="fas fa-plus"></i>
        </button>
        <button className="icon-btn" onClick={openInTab} title="Open in Tab">
          <i className="fas fa-external-link-alt"></i>
        </button>
      </div>
    </header>
  );
}
