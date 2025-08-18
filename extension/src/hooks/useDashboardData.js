import { useEffect, useState } from 'react';
import { getHostDashboard, setHostDashboard } from '../services/extensionApi';
import { listWorkspaces } from '../db';

const normalize = (dashboardData) => {
  const bookmarks = (dashboardData?.bookmarks || []).map((b) => ({ ...b, type: 'Bookmark' }))
  const history = (dashboardData?.history || []).map((h) => ({ ...h, type: 'History' }))
  // Prefer history entries over bookmarks so we keep enrichment like workspaceGroup
  const combined = [...history, ...bookmarks]
  const map = new Map()
  combined.forEach((it) => {
    const prev = map.get(it.url)
    if (!prev) {
      // Apply fallback logic even for single items
      let item = { ...it }
      // Do NOT derive workspaceGroup from category.name. Only use explicit workspaceGroup.
      map.set(it.url, item)
    } else {
      // Merge to preserve enriched fields from either source
      let merged = {
        ...prev,
        ...it,
        // Prefer truthy enriched metadata from either prev or it
        workspaceGroup: it.workspaceGroup || prev.workspaceGroup,
        category: it.category || prev.category,
        secondaryCategories: it.secondaryCategories || prev.secondaryCategories,
        tags: it.tags || prev.tags,
        summary: it.summary || prev.summary,
        // Keep the most recent timing info
        lastVisitTime: Math.max(prev.lastVisitTime || 0, it.lastVisitTime || 0) || (prev.lastVisitTime || it.lastVisitTime),
        dateAdded: Math.max(prev.dateAdded || 0, it.dateAdded || 0) || (prev.dateAdded || it.dateAdded),
        // Max visitCount to keep prominence
        visitCount: Math.max(prev.visitCount || 0, it.visitCount || 0) || (prev.visitCount || it.visitCount),
        // Prefer a meaningful title
        title: (it.title && it.title.trim()) ? it.title : prev.title,
      }
      // Do NOT derive workspaceGroup from category.name. Only use explicit workspaceGroup.
      map.set(it.url, merged)
    }
  })
  return Array.from(map.values()).sort((a, b) => (b.lastVisitTime || b.dateAdded || 0) - (a.lastVisitTime || a.dateAdded || 0))
}

// Build a minimal dashboard snapshot from local workspaces to show something in UI
const synthesizeFromWorkspaces = async () => {
  try {
    const wss = await listWorkspaces();
    const bookmarks = [];
    const seen = new Set();
    for (const w of (Array.isArray(wss) ? wss : [])) {
      const wsName = w?.name || undefined;
      const urls = Array.isArray(w?.urls) ? w.urls : [];
      for (const u of urls) {
        const url = String(u?.url || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        bookmarks.push({
          type: 'Bookmark',
          url,
          title: (u?.title && String(u.title).trim()) ? u.title : url,
          dateAdded: typeof u?.addedAt === 'number' ? u.addedAt : Date.now(),
          workspaceGroup: wsName,
        });
      }
    }
    return { history: [], bookmarks };
  } catch {
    return { history: [], bookmarks: [] };
  }
}

export function useDashboardData() {
  const [data, setData] = useState([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [populating, setPopulating] = useState(false)

  // Phase 1: Fast path from local storage (if available)
  const loadFastFromStorage = async () => {
    const hasStorage = typeof chrome !== 'undefined' && chrome?.storage?.local && typeof chrome.storage.local.get === 'function'
    let dashboardData = null
    if (hasStorage) {
      try {
        const res = await chrome.storage.local.get(['dashboardData'])
        dashboardData = res?.dashboardData || null
      } catch { /* ignore */ }
    }
    let arr = normalize(dashboardData)
    // If nothing in local storage, try to synthesize from local workspaces
    if (!arr.length) {
      const synthesized = await synthesizeFromWorkspaces();
      const arrSynth = normalize(synthesized);
      if (arrSynth.length) {
        arr = arrSynth;
        try { await setHostDashboard(synthesized) } catch { }
      }
    }
    setData(arr)
    setLoadingInitial(false)
    // If we already have data locally (items/history/bookmarks), mirror it to the host
    if (arr.length && dashboardData) {
      try { await setHostDashboard(dashboardData) } catch { /* ignore */ }
    }
    // If empty, ask background to populate (no UI block)
    if (!arr.length && !populating) {
      setPopulating(true)
      try {
        const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage
        if (hasRuntime) {
          try { chrome.runtime.sendMessage({ action: 'populateData' }) } catch { }
        }
      } finally {
        setPopulating(false)
      }
    }
  }

  // Phase 2: Background hydrate from host, then mirror back
  const hydrateFromHost = async () => {
    setRefreshing(true)
    let dashboardData = null
    try {
      const host = await getHostDashboard();
      if (host?.ok && host.dashboard && (
        Array.isArray(host.dashboard.history) || Array.isArray(host.dashboard.bookmarks)
      )) {
        dashboardData = host.dashboard;
      }
    } catch { /* ignore */ }

    if (dashboardData && ((dashboardData.history && dashboardData.history.length) || (dashboardData.bookmarks && dashboardData.bookmarks.length))) {
      const arr = normalize(dashboardData)
      setData(arr)
      // Mirror enriched dashboard to host so Electron renderer can show categories
      try {
        await setHostDashboard(dashboardData)
      } catch { }
      try {
        const histLen = (dashboardData?.history || []).length
        const bmLen = (dashboardData?.bookmarks || []).length
        const groups = Array.from(new Set(arr.map(it => it.workspaceGroup).filter(Boolean)))
        const sampleAI = arr.find(it => (it.category || it.workspaceGroup || it.summary || it.tags) && typeof it.url === 'string')
        console.debug('[CoolDesk] Hydrated snapshot:', { historyCount: histLen, bookmarkCount: bmLen, mergedCount: arr.length, uniqueGroups: groups, sampleAI })
      } catch { }
    } else {
      // Host empty as well — last-resort synthesis from local workspaces
      try {
        const synthesized = await synthesizeFromWorkspaces();
        const arr = normalize(synthesized);
        if (arr.length) {
          setData(arr);
          try { await setHostDashboard(synthesized) } catch { }
        }
      } catch { }
    }
    setRefreshing(false)
  }

  useEffect(() => {
    // Show something ASAP
    loadFastFromStorage()
    // Then hydrate in background
    hydrateFromHost()

    const listener = (req) => {
      if (req?.action === 'updateData' || req?.action === 'aiComplete') {
        hydrateFromHost()
      }
    }
    const canListen = typeof chrome !== 'undefined' && chrome?.runtime && typeof chrome.runtime.onMessage?.addListener === 'function'
    if (canListen) {
      chrome.runtime.onMessage.addListener(listener)
    }
    return () => {
      if (canListen && typeof chrome.runtime.onMessage?.removeListener === 'function') {
        chrome.runtime.onMessage.removeListener(listener)
      }
    }
  }, [])

  const populate = () => {
    try {
      const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage
      if (hasRuntime) chrome.runtime.sendMessage({ action: 'populateData' })
    } catch { /* ignore */ }
  }

  return { data, loading: loadingInitial, refreshing, populate }
}
