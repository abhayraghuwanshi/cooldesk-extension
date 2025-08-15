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
    const items = allItems.filter(item => !item.workspaceGroup);
    if (!q) return items.slice(0, 200);

    const tokens = q.split(/\s+/).filter(Boolean);

    const isSubsequence = (needle, hay) => {
      let i = 0; for (let c of hay) { if (c === needle[i]) { i++; if (i === needle.length) return true; } }
      return needle.length === 0;
    };

    const safeDomain = (u) => {
      try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
    };

    const now = Date.now();
    const scoreItem = (it) => {
      const title = (it.title || '').toLowerCase();
      const url = (it.url || '').toLowerCase();
      const desc = (it.description || '').toLowerCase();
      const domain = safeDomain(url);

      let score = 0;
      // Primary includes
      if (title.includes(q)) score += 60;
      if (url.includes(q)) score += 45;
      if (domain && domain.includes(q)) score += 40;

      // Starts-with boosts
      if (title.startsWith(q)) score += 15;
      if (domain && domain.startsWith(q)) score += 12;

      // Token-based scoring
      for (const t of tokens) {
        if (t.length < 2) continue;
        if (title.includes(t)) score += 8;
        if (domain.includes(t)) score += 6;
        if (url.includes(t)) score += 4;
        // word-start boost
        if (new RegExp(`(^|[^a-z0-9])${t}`).test(title)) score += 4;
      }

      // Simple fuzzy subsequence
      if (!title.includes(q) && isSubsequence(q, title)) score += 6;

      // Recency and popularity boosts
      const vc = it.visitCount || 0;
      if (vc) score += Math.min(20, Math.log10(vc + 1) * 8);
      const t = it.lastVisitTime || it.dateAdded || 0;
      if (t) {
        const ageDays = Math.max(0, (now - t) / (1000 * 60 * 60 * 24));
        const recency = Math.max(0, 18 - Math.log2(1 + ageDays)); // decays with age
        score += recency;
      }

      // Prefer shorter URLs a bit (cleanup factor)
      score += Math.max(0, 6 - Math.min(6, Math.floor(url.length / 100)));

      return score;
    };

    return items
      .map(it => ({ it, score: scoreItem(it) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200)
      .map(x => x.it);
  }, [allItems, debouncedSearch]);

  return (
    <div className="add-link-flow">
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
