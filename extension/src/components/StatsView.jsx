import React, { useMemo } from 'react';
import { StatsCard } from './StatsCard';

export function StatsView({ items, search, workspace, onAddRelated }) {
  const searchLower = (search || '').toLowerCase()
  const filtered = items.filter((it) => {
    // Check workspaceGroup or fallback to category.name
    const itemWorkspace = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null)
    const inWs = workspace === 'All' || itemWorkspace === workspace
    const inSearch = !searchLower || (it.title?.toLowerCase().includes(searchLower) || it.url?.toLowerCase().includes(searchLower))
    return inWs && inSearch
  })

  const frequent = useMemo(() => {
    const counts = {}
    filtered.forEach((it) => {
      const k = it.url
      if (!counts[k]) counts[k] = { title: it.title, url: it.url, count: 0 }
      counts[k].count = Math.max(counts[k].count, it.visitCount || 1)
    })
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [filtered])

  const recent = useMemo(() => {
    return filtered
      .filter((it) => it.lastVisitTime || it.dateAdded)
      .slice(0, 8)
  }, [filtered])

  return (
    <div className="stats-container">
      <section>
        <h3>Most Visited</h3>
        <ul className="stats-grid">
          {frequent.map((item) => (
            <StatsCard key={item.url} item={item} showCount={true} onAISuggest={onAddRelated} />
          ))}
        </ul>
      </section>
      <section>
        <h3>Recently Accessed</h3>
        <ul className="stats-grid">
          {recent.map((item) => (
            <StatsCard key={item.url} item={item} showCount={false} onAISuggest={onAddRelated} />
          ))}
        </ul>
      </section>
    </div>
  )
}
