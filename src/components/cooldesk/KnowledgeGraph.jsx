import { faDiagramProject, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { forceCollide } from 'd3-force-3d';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchGraph, graphChanged } from '../../services/graphService';
import { getHostUrl } from '../../services/syncConfig';
import { ActivityOverview } from './ActivityOverview';
import './KnowledgeGraph.css';

// ── Visual config ─────────────────────────────────────────────────────────────

// Fallbacks for unassigned nodes
const NODE_VISUAL = {
  workspace: { base: '#6366f1', hi: '#a5b4fc', glow: '#818cf8', dim: '#6366f130' },
  url:       { base: '#10b981', hi: '#6ee7b7', glow: '#34d399', dim: '#10b98130' },
  app:       { base: '#f59e0b', hi: '#fde68a', glow: '#fbbf24', dim: '#f59e0b30' },
  folder:    { base: '#eab308', hi: '#fef08a', glow: '#facc15', dim: '#eab30830' },
  file:      { base: '#475569', hi: '#94a3b8', glow: '#64748b', dim: '#47556930' },
  media:     { base: '#ec4899', hi: '#f9a8d4', glow: '#f472b6', dim: '#ec489930' },
};

// 8 distinct colors — one per workspace, deterministic by sorted name
const WORKSPACE_PALETTE = [
  { base: '#6366f1', hi: '#a5b4fc', glow: '#818cf8', dim: '#6366f128' },
  { base: '#10b981', hi: '#6ee7b7', glow: '#34d399', dim: '#10b98128' },
  { base: '#f59e0b', hi: '#fde68a', glow: '#fbbf24', dim: '#f59e0b28' },
  { base: '#ec4899', hi: '#f9a8d4', glow: '#f472b6', dim: '#ec489928' },
  { base: '#06b6d4', hi: '#67e8f9', glow: '#22d3ee', dim: '#06b6d428' },
  { base: '#8b5cf6', hi: '#c4b5fd', glow: '#a78bfa', dim: '#8b5cf628' },
  { base: '#f43f5e', hi: '#fda4af', glow: '#fb7185', dim: '#f43f5e28' },
  { base: '#14b8a6', hi: '#5eead4', glow: '#2dd4bf', dim: '#14b8a628' },
];

// Moon nodes use lighter, slightly muted version of their planet's palette
function makeMoonVis(p) {
  return { base: p.hi, hi: '#ffffff', glow: p.glow, dim: p.dim };
}

const EDGE_COLORS = {
  co_occurrence:          '#818cf8',
  session_co_occurrence:  '#c084fc',
  url_in_workspace:       '#34d399',
  app_in_workspace:       '#fbbf24',
  folder_in_workspace:    '#facc15',
  file_in_workspace:      '#64748b',
  shared_resource:        'rgba(255,255,255,0.2)',
};

// Keep flat colors for pointer area + detail panel dots
const NODE_COLORS = Object.fromEntries(
  Object.entries(NODE_VISUAL).map(([k, v]) => [k, v.base])
);

const FILTERS = ['all', 'url', 'app', 'folder', 'file', 'media', 'workspace'];

function nodeRadius(node) {
  if (node.type === 'workspace') return 16 + Math.sqrt(node.weight || 1) * 3;
  const byLinks = 3.5 + Math.sqrt(node.weight || 1) * 1.4;
  // Real usage beats link count: size by active minutes (14d) when the sampler
  // has data for this node.
  if (node.activeS) {
    const byUsage = 4 + Math.sqrt(node.activeS / 60) * 0.55;
    return Math.min(15, Math.max(byLinks, byUsage));
  }
  return byLinks;
}

function fmtActive(secs) {
  if (!secs || secs < 60) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function applyFilter(graphData, filter) {
  if (filter === 'all') return graphData;
  const keep = new Set(graphData.nodes.filter(n => n.type === filter).map(n => n.id));
  graphData.links.forEach(l => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    if (keep.has(src)) keep.add(tgt);
    if (keep.has(tgt)) keep.add(src);
  });
  return {
    nodes: graphData.nodes.filter(n => keep.has(n.id)),
    links: graphData.links.filter(l => {
      const src = typeof l.source === 'object' ? l.source.id : l.source;
      const tgt = typeof l.target === 'object' ? l.target.id : l.target;
      return keep.has(src) && keep.has(tgt);
    })
  };
}

// ── GraphCanvas ───────────────────────────────────────────────────────────────

const LIVE_INTERVAL_MS = 30_000;

export function GraphCanvas() {
  const [rawData, setRawData]             = useState({ nodes: [], links: [] });
  const [loading, setLoading]             = useState(false);
  const [filter, setFilter]               = useState('all');
  const [selectedId, setSelectedId]       = useState(null);
  const [tooltip, setTooltip]             = useState(null);
  const [dims, setDims]                   = useState(null);
  const [liveMode, setLiveMode]           = useState(true);
  const [hasNewData, setHasNewData]       = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [timeRange, setTimeRange]         = useState('all');
  const [localMode, setLocalMode]         = useState(false);
  const [hopDepth, setHopDepth]           = useState(1);

  // Fixed weak-edge cutoff (was a user slider; a good default beats a knob)
  const EDGE_THRESHOLD = 0.05;

  const fgRef      = useRef(null);
  const canvasRef  = useRef(null);
  const mousePos   = useRef({ x: 0, y: 0 });
  const rawDataRef = useRef(rawData);
  const flashTimer = useRef(null);
  useEffect(() => { rawDataRef.current = rawData; }, [rawData]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // ── Usage enrichment: size nodes by real active time from the focus sampler ──
  const [usageMap, setUsageMap] = useState(null);
  useEffect(() => {
    fetch(`${getHostUrl()}/activity/app-usage?days=14`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data?.trends) return;
        const map = new Map();
        // Mirror the backend's graph-node id cleaning (server.rs snapshot loop)
        const cleanApp = n => n.toLowerCase().replace(/\.exe$/, '')
          .replace('visual studio code', 'vscode').trim().replace(/ /g, '_');
        (data.trends.apps || []).forEach(a => {
          map.set(`app::${cleanApp(a.name)}`, a.totalActiveS);
          map.set(`media::${cleanApp(a.name)}`, a.totalActiveS);
        });
        (data.trends.contexts || []).forEach(c => {
          map.set(`folder::${c.name.toLowerCase().replace(/ /g, '_')}`, c.totalActiveS);
        });
        setUsageMap(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!usageMap || rawData.nodes.length === 0) return;
    rawData.nodes.forEach(n => {
      const secs = usageMap.get(n.id);
      if (secs) n.activeS = secs;
    });
  }, [usageMap, rawData]);

  useEffect(() => {
    const track = e => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', track);
    return () => window.removeEventListener('mousemove', track);
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Tight clusters: strong enough to separate groups without scattering the
    // map into empty space (the old -1800/220 values produced a mostly-void canvas).
    fg.d3Force('charge')?.strength(node =>
      node.type === 'workspace' ? -500 : -40
    );
    fg.d3Force('link')?.distance(link => {
      const srcType = typeof link.source === 'object' ? link.source.type : null;
      const tgtType = typeof link.target === 'object' ? link.target.type : null;
      if (srcType === 'workspace' || tgtType === 'workspace') return 80;
      return 140;
    });
    // Hard collision bubble — nodes can NEVER overlap
    fg.d3Force('collide', forceCollide(node => nodeRadius(node) + 6));
    // Reheat so new forces take effect immediately
    fg.d3ReheatSimulation();
  }, [rawData]);

  const applyGraphData = useCallback((data, isLiveUpdate = false) => {
    if (!data) return;
    const next = {
      nodes: data.nodes,
      links: (data.edges || []).map(e => ({ ...e }))
    };
    if (isLiveUpdate && !graphChanged(
      { nodes: rawDataRef.current.nodes, edges: rawDataRef.current.links },
      { nodes: next.nodes, edges: next.links }
    )) return;
    setRawData(next);
    if (isLiveUpdate) {
      setHasNewData(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setHasNewData(false), 2000);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchGraph(false, controller.signal)
      .then(data => { if (!controller.signal.aborted) applyGraphData(data); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applyGraphData]);

  useEffect(() => {
    if (!liveMode) return;
    const id = setInterval(async () => {
      const data = await fetchGraph(true);
      applyGraphData(data, true);
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [liveMode, applyGraphData]);

  const handleRefresh = useCallback(async () => {
    const data = await fetchGraph(true);
    applyGraphData(data);
  }, [applyGraphData]);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setDims({ w: Math.floor(width), h: Math.floor(height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timeCutoffMs = useMemo(() => {
    if (timeRange === 'all') return null;
    return Date.now() - (timeRange === '7d' ? 7 : 30) * 86400000;
  }, [timeRange]);

  const filteredData = useMemo(() => {
    let data = applyFilter(rawData, filter);
    if (timeCutoffMs) {
      data = { ...data, links: data.links.filter(l => !l.last_seen || l.last_seen >= timeCutoffMs) };
    }
    {
      const STATIC = new Set(['url_in_workspace','app_in_workspace','folder_in_workspace','file_in_workspace','shared_resource']);
      data = { ...data, links: data.links.filter(l => STATIC.has(l.type) || (l.weight || 0) >= EDGE_THRESHOLD) };
    }
    return data;
  }, [rawData, filter, timeCutoffMs]);

  const connectedIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set([selectedId]);
    rawData.links.forEach(l => {
      const src = typeof l.source === 'object' ? l.source.id : l.source;
      const tgt = typeof l.target === 'object' ? l.target.id : l.target;
      if (src === selectedId) set.add(tgt);
      if (tgt === selectedId) set.add(src);
    });
    return set;
  }, [selectedId, rawData.links]);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return new Set(rawData.nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
  }, [searchQuery, rawData.nodes]);

  const displayData = useMemo(() => {
    if (!localMode || !selectedId) return filteredData;
    const visited = new Set([selectedId]);
    let frontier = new Set([selectedId]);
    for (let h = 0; h < hopDepth; h++) {
      const next = new Set();
      filteredData.links.forEach(l => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        if (frontier.has(src) && !visited.has(tgt)) { next.add(tgt); visited.add(tgt); }
        if (frontier.has(tgt) && !visited.has(src)) { next.add(src); visited.add(src); }
      });
      frontier = next;
      if (frontier.size === 0) break;
    }
    return {
      nodes: filteredData.nodes.filter(n => visited.has(n.id)),
      links: filteredData.links.filter(l => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        return visited.has(src) && visited.has(tgt);
      })
    };
  }, [localMode, selectedId, hopDepth, filteredData]);

  const selectedDetail = useMemo(() => {
    if (!selectedId) return null;
    const node = rawData.nodes.find(n => n.id === selectedId);
    if (!node) return null;
    const getId = x => typeof x === 'object' ? x.id : x;
    const connections = rawData.links
      .filter(l => getId(l.source) === selectedId || getId(l.target) === selectedId)
      .map(l => {
        const otherId = getId(l.source) === selectedId ? getId(l.target) : getId(l.source);
        return { node: rawData.nodes.find(n => n.id === otherId), edgeType: l.type, weight: l.weight || 0 };
      })
      .filter(c => c.node)
      .sort((a, b) => b.weight - a.weight);
    return { node, connections };
  }, [selectedId, rawData]);

  // ── Per-node workspace color map ─────────────────────────────────────────
  // Workspaces get WORKSPACE_PALETTE[i] sorted by label.
  // Their child nodes (moons) inherit a dimmer version of the same palette.
  const wsColorMap = useMemo(() => {
    const map = new Map();
    const sorted = rawData.nodes
      .filter(n => n.type === 'workspace')
      .sort((a, b) => a.label.localeCompare(b.label));

    const wsIdxMap = new Map();
    sorted.forEach((ws, i) => {
      const p = WORKSPACE_PALETTE[i % WORKSPACE_PALETTE.length];
      wsIdxMap.set(ws.id, i);
      map.set(ws.id, { vis: p, isWorkspace: true, paletteIdx: i });
    });

    rawData.links.forEach(link => {
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
      const wsId  = wsIdxMap.has(srcId) ? srcId : wsIdxMap.has(tgtId) ? tgtId : null;
      if (!wsId) return;
      const childId = wsId === srcId ? tgtId : srcId;
      if (!map.has(childId)) {
        const p = WORKSPACE_PALETTE[wsIdxMap.get(wsId) % WORKSPACE_PALETTE.length];
        map.set(childId, { vis: makeMoonVis(p), isWorkspace: false, paletteIdx: wsIdxMap.get(wsId) });
      }
    });
    return map;
  }, [rawData]);

  // Count of direct children per workspace (for planet label subtitle)
  const wsChildCount = useMemo(() => {
    const wsIds = new Set(rawData.nodes.filter(n => n.type === 'workspace').map(n => n.id));
    const counts = new Map();
    rawData.links.forEach(link => {
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
      if (wsIds.has(srcId)) counts.set(srcId, (counts.get(srcId) || 0) + 1);
      if (wsIds.has(tgtId)) counts.set(tgtId, (counts.get(tgtId) || 0) + 1);
    });
    return counts;
  }, [rawData]);

  // Primary workspace label for tooltip ("in Productivity")
  const nodeToWorkspace = useMemo(() => {
    const wsLabels = new Map(rawData.nodes.filter(n => n.type === 'workspace').map(n => [n.id, n.label]));
    const result = new Map();
    rawData.links.forEach(link => {
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
      if (wsLabels.has(srcId)) result.set(tgtId, wsLabels.get(srcId));
      else if (wsLabels.has(tgtId)) result.set(srcId, wsLabels.get(tgtId));
    });
    return result;
  }, [rawData]);

  const handleNodeClick       = useCallback(node => setSelectedId(p => p === node.id ? null : node.id), []);
  const handleBackgroundClick = useCallback(() => { setSelectedId(null); setTooltip(null); }, []);
  const handleNodeHover       = useCallback(node => {
    if (!node) { setTooltip(null); return; }
    setTooltip({ x: mousePos.current.x, y: mousePos.current.y, node });
  }, []);
  const handleEngineStop = useCallback(() => {
    if (fgRef.current) fgRef.current.zoomToFit(400, 40);
    // Pin workspace planets after settle so live refreshes don't shuffle the map.
    rawData.nodes.forEach(n => {
      if (n.type === 'workspace' && isFinite(n.x)) { n.fx = n.x; n.fy = n.y; }
    });
  }, [rawData]);

  // ── Node canvas renderer ──────────────────────────────────────────────────
  const handleNodeCanvasObject = useCallback((node, ctx, globalScale) => {
    ctx.save();

    const r   = nodeRadius(node);
    const colorEntry = wsColorMap.get(node.id);
    const vis = colorEntry?.vis || NODE_VISUAL[node.type] || NODE_VISUAL.url;

    const searchActive = searchMatches !== null;
    const searchHit    = searchActive && searchMatches.has(node.id);
    const isSelected   = selectedId === node.id;
    const faded        = (connectedIds && !connectedIds.has(node.id))
                       || (searchActive && !searchHit);

    if (!isFinite(node.x) || !isFinite(node.y)) { ctx.restore(); return; }

    const baseAlpha = faded ? 0.055 : 1;
    ctx.globalAlpha = baseAlpha;

    const isWs = node.type === 'workspace';

    // ── Selection / search highlight: one ring, subtle glow ──
    if (isSelected || searchHit) {
      const ringCol = searchHit && !isSelected ? '#fbbf24' : vis.hi;
      ctx.strokeStyle = ringCol;
      ctx.lineWidth   = 1.5 / globalScale;
      ctx.shadowColor = ringCol;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 5 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Flat core: solid fill + thin lighter rim ──
    ctx.shadowColor = vis.glow;
    ctx.shadowBlur  = isWs ? 12 : 5;
    ctx.fillStyle   = vis.base;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = vis.hi + (faded ? '30' : '80');
    ctx.lineWidth   = 1 / globalScale;
    ctx.stroke();

    // ── Workspace: single clean outer ring ──
    if (isWs && !faded) {
      ctx.strokeStyle = vis.hi + '50';
      ctx.lineWidth   = 1.2 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 1.4, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // ── Labels ──
    // Workspace labels always visible; child labels once mildly zoomed in, or
    // always for nodes with real usage / selection (what the user cares about).
    if (isWs || globalScale > 1.1 || node.activeS || isSelected) {
      const fs  = isWs ? Math.max(12, 14 / globalScale) : Math.max(8, 9 / globalScale);
      const lbl = node.label.length > 24 ? node.label.slice(0, 23) + '…' : node.label;
      const ty  = node.y + r + (isWs ? 7 : 3) / globalScale;

      ctx.font         = `${isWs ? 700 : 500} ${fs}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor  = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur   = 4;
      ctx.fillStyle    = faded ? 'rgba(255,255,255,0.08)' : (isWs ? '#f1f5f9' : '#cbd5e1');
      ctx.fillText(lbl, node.x, ty);

      // Workspace subtitle: child count + active time when known
      if (isWs && !faded) {
        const count = wsChildCount.get(node.id) || 0;
        const bits = [];
        if (count > 0) bits.push(`${count} items`);
        const act = fmtActive(node.activeS);
        if (act) bits.push(act);
        if (bits.length > 0) {
          ctx.font      = `500 ${Math.max(9, 10 / globalScale)}px -apple-system, system-ui, sans-serif`;
          ctx.fillStyle = vis.hi + '99';
          ctx.fillText(bits.join(' · '), node.x, ty + fs + 2 / globalScale);
        }
      }
      ctx.shadowBlur = 0;
    }

    ctx.restore();
    node.__r = r;
  }, [connectedIds, selectedId, searchMatches, wsColorMap, wsChildCount]);

  const nodePointerAreaPaint = useCallback((node, col, ctx) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(node.x, node.y, (node.__r || nodeRadius(node)) + 4, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // ── Edge renderer: one clean pass, opacity by weight ─────────────────────
  const handleLinkCanvasObject = useCallback((link, ctx, globalScale) => {
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || !isFinite(src.x) || !isFinite(tgt.x)) return;

    // Use workspace-inherited color if available; fall back to edge-type color
    const srcId   = typeof src === 'object' ? src.id : src;
    const wsEntry = wsColorMap.get(srcId);
    const col     = wsEntry?.vis?.base || EDGE_COLORS[link.type] || '#64748b';
    const w       = Math.max(0.5, (link.weight || 0.3) * 2);

    let alpha = 0.3;
    if (connectedIds) {
      const tgtId = typeof tgt === 'object' ? tgt.id : tgt;
      alpha = (connectedIds.has(srcId) && connectedIds.has(tgtId)) ? 0.8 : 0.03;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap     = 'round';
    ctx.strokeStyle = col;
    ctx.lineWidth   = w / globalScale;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.stroke();
    ctx.restore();
  }, [connectedIds, wsColorMap]);

  const isEmpty = rawData.nodes.length === 0 && !loading;

  return (
    <div className="kg-canvas-root">

      {/* Single control bar: search · type filters · time · live · fit */}
      <div className="kg-topbar">
        <div className="kg-search-wrap">
          <svg className="kg-search-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input className="kg-search-input" type="text" placeholder="Search…"
                 value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <button className="kg-search-clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
        <div className="kg-filters">
          {FILTERS.map(f => (
            <button key={f} className={`kg-pill ${f} ${filter === f ? 'active' : ''}`}
                    onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>
        <div className="kg-actions">
          {[['7d','7d'],['30d','30d'],['all','All']].map(([val, label]) => (
            <button key={val}
                    className={`kg-pill ${timeRange === val ? 'active all' : ''}`}
                    onClick={() => setTimeRange(val)}>
              {label}
            </button>
          ))}
          <span className={`kg-live-badge ${liveMode ? 'on' : 'off'} ${hasNewData ? 'pulse' : ''}`}
                onClick={() => setLiveMode(v => !v)}>
            <span className="kg-live-dot" />
            {liveMode ? 'Live' : 'Paused'}
          </span>
          <button className="kg-btn" onClick={handleRefresh} title="Refresh now">↺</button>
          <button className="kg-btn" onClick={() => fgRef.current?.zoomToFit(400, 30)}>Fit</button>
        </div>
      </div>

      {/* Canvas + detail panel */}
      <div className="kg-body">
        <div className="kg-canvas" ref={canvasRef}>
          {loading && (
            <div className="kg-state kg-state-overlay">
              <div className="kg-spinner" />
              <h4>Building your graph…</h4>
              <p>Mapping connections from your workspaces and activity</p>
            </div>
          )}
          {!loading && isEmpty && (
            <div className="kg-state kg-state-overlay">
              <div className="kg-empty-icon">
                <FontAwesomeIcon icon={faDiagramProject} />
              </div>
              <h4>Your graph is empty</h4>
              <p>Start using CoolDesk — add URLs, apps, and folders to workspaces and the graph will grow organically.</p>
            </div>
          )}
          {!loading && !isEmpty && dims && (
            <ForceGraph2D
              ref={fgRef}
              graphData={displayData}
              width={dims.w}
              height={dims.h}
              backgroundColor="transparent"
              nodeCanvasObject={handleNodeCanvasObject}
              nodePointerAreaPaint={nodePointerAreaPaint}
              linkCanvasObject={handleLinkCanvasObject}
              linkCanvasObjectMode="replace"
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onBackgroundClick={handleBackgroundClick}
              onEngineStop={handleEngineStop}
              cooldownTicks={280}
              d3AlphaDecay={0.012}
              d3VelocityDecay={0.38}
              nodeId="id" linkSource="source" linkTarget="target"
            />
          )}

          {/* Workspace color legend — floating over the canvas */}
          {!loading && rawData.nodes.some(n => n.type === 'workspace') && (
            <div className="kg-legend">
              {rawData.nodes
                .filter(n => n.type === 'workspace')
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((ws, i) => {
                  const p = WORKSPACE_PALETTE[i % WORKSPACE_PALETTE.length];
                  return (
                    <button
                      key={ws.id}
                      className="kg-legend-item"
                      style={{ '--legend-color': p.base, '--legend-glow': p.glow }}
                      onClick={() => setSelectedId(prev => prev === ws.id ? null : ws.id)}
                      title={`${ws.label} — click to focus`}
                    >
                      <span className="kg-legend-dot" />
                      <span className="kg-legend-label">{ws.label}</span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedDetail && (() => {
          const detailVis = wsColorMap.get(selectedDetail.node.id)?.vis
                          || NODE_VISUAL[selectedDetail.node.type]
                          || NODE_VISUAL.url;
          const wsName = nodeToWorkspace.get(selectedDetail.node.id);
          return (
          <div className="kg-detail-panel">
            <div className="kg-detail-header"
                 style={{ borderBottom: `1px solid ${detailVis.base}33` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="kg-detail-type-badge"
                        style={{ color: detailVis.hi, background: detailVis.dim }}>
                    {selectedDetail.node.type}
                  </span>
                  {wsName && (
                    <span style={{ fontSize: 9, color: detailVis.hi + 'aa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {wsName}
                    </span>
                  )}
                </div>
                <div className="kg-detail-name" style={{ marginTop: 4 }}>{selectedDetail.node.label}</div>
              </div>
              <button className="kg-close" onClick={() => setSelectedId(null)}>
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>

            <div className="kg-detail-stats">
              <div className="kg-stat">
                <span className="kg-stat-val">{selectedDetail.connections.length}</span>
                <span className="kg-stat-label">connections</span>
              </div>
              <div className="kg-stat">
                <span className="kg-stat-val">{selectedDetail.node.weight}</span>
                <span className="kg-stat-label">weight</span>
              </div>
              {fmtActive(selectedDetail.node.activeS) && (
                <div className="kg-stat">
                  <span className="kg-stat-val" style={{ color: '#4ade80' }}>
                    {fmtActive(selectedDetail.node.activeS)}
                  </span>
                  <span className="kg-stat-label">active · 14d</span>
                </div>
              )}
            </div>

            <div className="kg-detail-local">
              <button className={`kg-btn ${localMode ? 'active' : ''}`}
                      onClick={() => setLocalMode(v => !v)}>
                {localMode ? '◎ Focused' : '◎ Focus'}
              </button>
              {localMode && (
                <div className="kg-hop-pills">
                  {[1, 2, 3].map(h => (
                    <button key={h}
                            className={`kg-pill all ${hopDepth === h ? 'active' : ''}`}
                            onClick={() => setHopDepth(h)}>
                      {h}hop
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="kg-detail-section-title">Connections</div>
            <div className="kg-detail-connections">
              {selectedDetail.connections.map(({ node, edgeType }, i) => {
                const cVis = wsColorMap.get(node.id)?.vis || NODE_VISUAL[node.type] || NODE_VISUAL.url;
                return (
                  <div key={i} className="kg-detail-row" onClick={() => setSelectedId(node.id)}>
                    <span className="kg-detail-dot" style={{ background: cVis.base, boxShadow: `0 0 6px ${cVis.glow}88` }} />
                    <span className="kg-detail-row-label">{node.label}</span>
                    <span className="kg-detail-edge-tag"
                          style={{ color: cVis.base }}>
                      {edgeType.replace(/_in_workspace/, '').replace(/_/g, ' ')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })()}
      </div>

      {/* Tooltip */}
      {tooltip && (() => {
        const tVis    = wsColorMap.get(tooltip.node.id)?.vis || NODE_VISUAL[tooltip.node.type] || NODE_VISUAL.url;
        const wsName  = nodeToWorkspace.get(tooltip.node.id);
        return (
          <div className="kg-tooltip"
               style={{ left: tooltip.x + 16, top: tooltip.y - 12, borderColor: tVis.base + '44' }}>
            <div className="kg-tooltip-label">{tooltip.node.label}</div>
            <div className="kg-tooltip-meta">
              <span className="kg-tooltip-type" style={{ color: tVis.hi }}>
                {tooltip.node.type}
              </span>
              {wsName && <><span>·</span><span style={{ color: tVis.hi + 'cc' }}>{wsName}</span></>}
              <span>·</span>
              <span>{tooltip.node.weight} links</span>
              {fmtActive(tooltip.node.activeS) && (
                <><span>·</span><span style={{ color: '#4ade80' }}>{fmtActive(tooltip.node.activeS)} active</span></>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

export function KnowledgeGraph({ isOpen, onClose }) {
  const [view, setView] = useState('overview');

  useEffect(() => {
    const h = e => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="kg-overlay" onClick={onClose}>
      <div className="kg-modal" onClick={e => e.stopPropagation()}>
        <div className="kg-toolbar">
          <div className="kg-title">
            <FontAwesomeIcon icon={faDiagramProject} />
            Activity
          </div>
          <div className="kg-view-tabs">
            <button className={`kg-pill all ${view === 'overview' ? 'active' : ''}`}
                    onClick={() => setView('overview')}>
              Overview
            </button>
            <button className={`kg-pill all ${view === 'graph' ? 'active' : ''}`}
                    onClick={() => setView('graph')}>
              Graph
            </button>
          </div>
          <button className="kg-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        {view === 'overview' ? <ActivityOverview /> : <GraphCanvas />}
      </div>
    </div>
  );
}
