import { faDiagramProject, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { forceCollide } from 'd3-force-3d';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchGraph, graphChanged } from '../../services/graphService';
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
  return 3.5 + Math.sqrt(node.weight || 1) * 1.4;
}

function drawDiamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
}

function drawSquare(ctx, x, y, r) {
  ctx.beginPath();
  ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
}

function drawHex(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    i === 0
      ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
      : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
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
  const [showLabels, setShowLabels]       = useState(true);
  const [selectedId, setSelectedId]       = useState(null);
  const [tooltip, setTooltip]             = useState(null);
  const [dims, setDims]                   = useState(null);
  const [liveMode, setLiveMode]           = useState(true);
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [hasNewData, setHasNewData]       = useState(false);
  const [edgeThreshold, setEdgeThreshold] = useState(0.05);
  const [searchQuery, setSearchQuery]     = useState('');
  const [timeRange, setTimeRange]         = useState('all');
  const [localMode, setLocalMode]         = useState(false);
  const [hopDepth, setHopDepth]           = useState(1);

  const fgRef      = useRef(null);
  const canvasRef  = useRef(null);
  const mousePos   = useRef({ x: 0, y: 0 });
  const rawDataRef = useRef(rawData);
  const flashTimer = useRef(null);
  const orbitRef   = useRef(null);   // orbital data after simulation settles
  const rafRef     = useRef(null);   // animation frame ID
  useEffect(() => { rawDataRef.current = rawData; }, [rawData]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  // Clean up orbital RAF on unmount
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  useEffect(() => {
    const track = e => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', track);
    return () => window.removeEventListener('mousemove', track);
  }, []);

  useEffect(() => {
    // Cancel any running orbital loop before new simulation starts
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    orbitRef.current = null;

    const fg = fgRef.current;
    if (!fg) return;
    // Workspaces = massive planets pushing each other away; moons = gentle repulsion
    fg.d3Force('charge')?.strength(node =>
      node.type === 'workspace' ? -1800 : -60
    );
    // Short orbit radius for workspace→moon; long distance for cross-cluster co-occurrence
    fg.d3Force('link')?.distance(link => {
      const srcType = typeof link.source === 'object' ? link.source.type : null;
      const tgtType = typeof link.target === 'object' ? link.target.type : null;
      if (srcType === 'workspace' || tgtType === 'workspace') return 120;
      return 220;
    });
    // Hard collision bubble — nodes can NEVER overlap
    fg.d3Force('collide', forceCollide(node => nodeRadius(node) + 8));
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
    setLastUpdated(new Date());
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
    if (edgeThreshold > 0) {
      const STATIC = new Set(['url_in_workspace','app_in_workspace','folder_in_workspace','file_in_workspace','shared_resource']);
      data = { ...data, links: data.links.filter(l => STATIC.has(l.type) || (l.weight || 0) >= edgeThreshold) };
    }
    return data;
  }, [rawData, filter, edgeThreshold, timeCutoffMs]);

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
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    // ── Pin workspace planets so D3 won't move them ──────────────────────────
    rawData.nodes.forEach(n => {
      if (n.type === 'workspace' && isFinite(n.x)) { n.fx = n.x; n.fy = n.y; }
    });

    // ── Assign moons to orbital rings per workspace ───────────────────────────
    const orbit  = {};
    const placed = new Set();

    rawData.nodes
      .filter(n => n.type === 'workspace' && isFinite(n.x))
      .forEach(ws => {
        const moons = [];
        rawData.links.forEach(link => {
          const src = typeof link.source === 'object' ? link.source : null;
          const tgt = typeof link.target === 'object' ? link.target : null;
          if (!src || !tgt) return;
          const isWsSrc = src.id === ws.id;
          const isWsTgt = tgt.id === ws.id;
          if (!isWsSrc && !isWsTgt) return;
          const moon = isWsSrc ? tgt : src;
          if (moon.type === 'workspace' || placed.has(moon.id) || !isFinite(moon.x)) return;
          placed.add(moon.id);
          moons.push(moon);
        });

        if (moons.length === 0) return;
        moons.sort((a, b) => (b.weight || 0) - (a.weight || 0));

        // Ring radii scale with planet size; Keplerian speeds (inner = faster)
        const pr     = nodeRadius(ws);
        const RADII  = [Math.max(90, pr * 3.8), Math.max(138, pr * 5.8), Math.max(188, pr * 7.8)];
        const SPEEDS = [0.28, 0.158, 0.094]; // rad/s  (r³/² Kepler scaling)
        const CAPS   = [7, 13, Infinity];

        const rings = [];
        let idx = 0;
        RADII.forEach((radius, ri) => {
          const batch = moons.slice(idx, idx + CAPS[ri]);
          if (batch.length === 0) return;
          idx += batch.length;
          rings.push({
            radius,
            speed: SPEEDS[ri],
            moons: batch.map((node, i) => ({
              node,
              // Spread evenly; offset each ring so they don't start aligned
              angle: (i / batch.length) * 2 * Math.PI + ri * (Math.PI / 2.2),
            })),
          });
        });

        orbit[ws.id] = { node: ws, rings };
      });

    orbitRef.current = orbit;
    if (Object.keys(orbit).length === 0) return;

    // ── Orbital animation loop ────────────────────────────────────────────────
    let prevTs = 0;
    const animate = (ts) => {
      if (!orbitRef.current || !fgRef.current) return;
      const dt = prevTs ? Math.min((ts - prevTs) / 1000, 0.05) : 0.016;
      prevTs = ts;

      Object.values(orbitRef.current).forEach(({ node: ws, rings }) => {
        if (!isFinite(ws.x)) return;
        rings.forEach(ring => {
          const delta = ring.speed * dt;
          ring.moons.forEach(m => {
            m.angle += delta;
            m.node.x = ws.x + Math.cos(m.angle) * ring.radius;
            m.node.y = ws.y + Math.sin(m.angle) * ring.radius;
          });
        });
      });

      fgRef.current.refresh();
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
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

    // ── Orbital trail rings (workspace nodes only) ────────────────────────────
    if (node.type === 'workspace') {
      const wsOrbit = orbitRef.current?.[node.id];
      if (wsOrbit) {
        ctx.save();
        wsOrbit.rings.forEach((ring, ri) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, ring.radius, 0, 2 * Math.PI);
          ctx.strokeStyle = vis.glow;
          ctx.lineWidth   = 0.6 / globalScale;
          ctx.globalAlpha = faded ? 0.04 : (ri === 0 ? 0.18 : ri === 1 ? 0.12 : 0.08);
          ctx.setLineDash([4 / globalScale, 7 / globalScale]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
        ctx.restore();
        ctx.globalAlpha = baseAlpha;
      }
    }

    // ── Ambient volumetric halo (outermost, very diffuse) ──
    if (!faded) {
      const haloR = r * (isSelected ? 3.2 : 2.4);
      const halo = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, haloR);
      halo.addColorStop(0, vis.glow + '44');
      halo.addColorStop(0.4, vis.glow + '18');
      halo.addColorStop(1, 'transparent');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(node.x, node.y, haloR, 0, 2 * Math.PI);
      ctx.fill();
    }

    // ── Planetary orbital ring (workspace nodes only) ──
    if (node.type === 'workspace' && !faded) {
      ctx.save();
      ctx.globalAlpha = baseAlpha * (isSelected ? 0.55 : 0.32);
      ctx.strokeStyle = vis.hi;
      ctx.lineWidth   = 1.5 / globalScale;
      ctx.shadowColor = vis.glow;
      ctx.shadowBlur  = 6;
      // Tilted ellipse ring like Saturn
      ctx.beginPath();
      ctx.ellipse(node.x, node.y, r * 2.5, r * 0.55, -0.28, 0, 2 * Math.PI);
      ctx.stroke();
      // Outer faint ring
      ctx.globalAlpha = baseAlpha * 0.14;
      ctx.lineWidth   = 1 / globalScale;
      ctx.beginPath();
      ctx.ellipse(node.x, node.y, r * 3.1, r * 0.68, -0.28, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    // ── Selection rings ──
    if (isSelected) {
      ctx.shadowColor = vis.glow;
      ctx.shadowBlur  = 28;
      ctx.strokeStyle = vis.hi;
      ctx.lineWidth   = 1.5 / globalScale;

      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 10 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 22 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 36 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.globalAlpha = baseAlpha;
      ctx.shadowBlur  = 0;
    }

    // ── Search glow ring ──
    if (searchHit) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur  = 24;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth   = 2 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 6 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Node core glow ──
    ctx.shadowColor = vis.glow;
    ctx.shadowBlur  = isSelected ? 36 : 18;

    // ── Sphere gradient fill ──
    const grad = ctx.createRadialGradient(
      node.x - r * 0.32, node.y - r * 0.32, r * 0.02,
      node.x, node.y, r
    );
    grad.addColorStop(0,    '#ffffff');
    grad.addColorStop(0.12, vis.hi);
    grad.addColorStop(0.48, vis.base);
    grad.addColorStop(1,    vis.dim);
    ctx.fillStyle = grad;

    // ── Shape ──
    if (node.type === 'workspace') {
      drawHex(ctx, node.x, node.y, r * 1.35);
    } else if (node.type === 'folder') {
      drawDiamond(ctx, node.x, node.y, r * 1.3);
    } else if (node.type === 'file') {
      drawSquare(ctx, node.x, node.y, r);
    } else if (node.type === 'media') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;
      const ig = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 0.5);
      ig.addColorStop(0, '#ffffff');
      ig.addColorStop(0.25, vis.hi);
      ig.addColorStop(1, vis.base);
      ctx.fillStyle = ig;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 0.42, 0, 2 * Math.PI);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    }
    ctx.fill();

    ctx.shadowBlur = 0;

    // ── Workspace hex border ──
    if (node.type === 'workspace') {
      ctx.strokeStyle = vis.hi + 'bb';
      ctx.lineWidth   = 1.5 / globalScale;
      ctx.stroke();
    }

    // ── Specular highlight (glass sphere top-left shine) ──
    if (!faded) {
      const specGrad = ctx.createRadialGradient(
        node.x - r * 0.3, node.y - r * 0.34, 0,
        node.x - r * 0.2, node.y - r * 0.22, r * 0.7
      );
      specGrad.addColorStop(0,    'rgba(255,255,255,0.52)');
      specGrad.addColorStop(0.35, 'rgba(255,255,255,0.1)');
      specGrad.addColorStop(1,    'rgba(255,255,255,0)');
      ctx.fillStyle = specGrad;
      if (node.type === 'workspace') {
        drawHex(ctx, node.x, node.y, r * 1.35);
      } else if (node.type === 'folder') {
        drawDiamond(ctx, node.x, node.y, r * 1.3);
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    }

    // ── Labels ──
    const isWs = node.type === 'workspace';
    // Workspace labels always visible; moon labels only when zoomed in close
    if (showLabels && (isWs || globalScale > 1.8)) {
      const fs  = isWs ? Math.max(13, 15 / globalScale) : Math.max(8, 9 / globalScale);
      const lbl = node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label;
      const ty  = node.y + (isWs ? r * 1.72 : r + 1) + 3 / globalScale;

      ctx.font         = `${isWs ? 800 : 500} ${fs}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';

      // Text shadow for readability
      ctx.fillStyle = 'rgba(0,0,0,0.95)';
      ctx.fillText(lbl, node.x + 0.8 / globalScale, ty + 0.8 / globalScale);
      ctx.fillText(lbl, node.x - 0.5 / globalScale, ty - 0.5 / globalScale);

      if (!faded) { ctx.shadowColor = vis.glow; ctx.shadowBlur = 8; }
      ctx.fillStyle = faded ? 'rgba(255,255,255,0.08)' : (isWs ? '#f8fafc' : vis.hi);
      ctx.fillText(lbl, node.x, ty);
      ctx.shadowBlur = 0;

      // Workspace subtitle: child count
      if (isWs) {
        const count = wsChildCount.get(node.id) || 0;
        if (count > 0) {
          const subFs = Math.max(9, 10 / globalScale);
          const subTy = ty + fs + 2 / globalScale;
          ctx.font      = `500 ${subFs}px -apple-system, system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.fillText(`${count} items`, node.x + 0.6 / globalScale, subTy + 0.6 / globalScale);
          ctx.fillStyle = faded ? 'rgba(255,255,255,0.06)' : vis.hi + '99';
          ctx.fillText(`${count} items`, node.x, subTy);
        }
      }
    }

    ctx.restore();
    node.__r = r;
  }, [connectedIds, selectedId, showLabels, searchMatches, wsColorMap, wsChildCount]);

  const nodePointerAreaPaint = useCallback((node, col, ctx) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(node.x, node.y, (node.__r || nodeRadius(node)) + 4, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // ── Fiber-optic edge renderer ─────────────────────────────────────────────
  const handleLinkCanvasObject = useCallback((link, ctx, globalScale) => {
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || !isFinite(src.x) || !isFinite(tgt.x)) return;

    // Use workspace-inherited color if available; fall back to edge-type color
    const srcId    = typeof src === 'object' ? src.id : src;
    const wsEntry  = wsColorMap.get(srcId);
    const col      = wsEntry?.vis?.base || EDGE_COLORS[link.type] || '#94a3b8';
    const base = link.type === 'shared_resource' ? 0.6 : (link.weight || 0.3);
    const w    = Math.max(0.3, base * 2.5);
    const isCurved = link.type === 'shared_resource';

    let alpha = 1;
    if (connectedIds) {
      const srcId = typeof src === 'object' ? src.id : src;
      const tgtId = typeof tgt === 'object' ? tgt.id : tgt;
      alpha = (connectedIds.has(srcId) && connectedIds.has(tgtId)) ? 1 : 0.04;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';

    const drawPath = () => {
      ctx.beginPath();
      if (isCurved) {
        const dx   = tgt.x - src.x;
        const dy   = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mx   = (src.x + tgt.x) / 2;
        const my   = (src.y + tgt.y) / 2;
        const ang  = Math.atan2(dy, dx) + Math.PI / 2;
        ctx.moveTo(src.x, src.y);
        ctx.quadraticCurveTo(
          mx + Math.cos(ang) * dist * 0.3,
          my + Math.sin(ang) * dist * 0.3,
          tgt.x, tgt.y
        );
      } else {
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
      }
    };

    // Outer diffuse glow
    drawPath();
    ctx.strokeStyle = col + '14';
    ctx.lineWidth   = w * 9 / globalScale;
    ctx.stroke();

    // Mid bloom
    drawPath();
    ctx.strokeStyle = col + '30';
    ctx.lineWidth   = w * 3.5 / globalScale;
    ctx.stroke();

    // Inner glow
    drawPath();
    ctx.strokeStyle = col + '70';
    ctx.lineWidth   = w * 1.2 / globalScale;
    ctx.stroke();

    // Core filament
    drawPath();
    ctx.strokeStyle = col + 'ee';
    ctx.lineWidth   = w * 0.45 / globalScale;
    ctx.stroke();

    ctx.restore();
  }, [connectedIds, wsColorMap]);

  const isEmpty = rawData.nodes.length === 0 && !loading;

  return (
    <div className="kg-canvas-root">

      {/* Search + time row */}
      <div className="kg-search-row">
        <div className="kg-search-wrap">
          <svg className="kg-search-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input className="kg-search-input" type="text" placeholder="Search nodes…"
                 value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <button className="kg-search-clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
        <div className="kg-time-pills">
          {[['7d','7d'],['30d','30d'],['all','All']].map(([val, label]) => (
            <button key={val}
                    className={`kg-pill ${timeRange === val ? 'active all' : ''}`}
                    onClick={() => setTimeRange(val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter + action row */}
      <div className="kg-controls">
        <div className="kg-filters">
          {FILTERS.map(f => (
            <button key={f} className={`kg-pill ${f} ${filter === f ? 'active' : ''}`}
                    onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>
        <div className="kg-actions">
          <span className={`kg-live-badge ${liveMode ? 'on' : 'off'} ${hasNewData ? 'pulse' : ''}`}
                onClick={() => setLiveMode(v => !v)}>
            <span className="kg-live-dot" />
            {liveMode ? 'Live' : 'Paused'}
          </span>
          <button className="kg-btn" onClick={handleRefresh} title="Refresh now">↺</button>
          {lastUpdated && (
            <span className="kg-last-updated">
              {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <label className="kg-slider-label" title="Filter weak edges">
            Strength
            <input type="range" className="kg-slider" min="0" max="0.9" step="0.05"
                   value={edgeThreshold} onChange={e => setEdgeThreshold(parseFloat(e.target.value))} />
            <span className="kg-slider-val">
              {edgeThreshold > 0 ? `>${(edgeThreshold * 100).toFixed(0)}%` : 'all'}
            </span>
          </label>
          <button className={`kg-btn ${showLabels ? 'active' : ''}`}
                  onClick={() => setShowLabels(v => !v)}>Labels</button>
          <button className="kg-btn" onClick={() => fgRef.current?.zoomToFit(400, 30)}>Fit</button>
        </div>
      </div>

      {/* Workspace color legend */}
      {rawData.nodes.filter(n => n.type === 'workspace').length > 0 && (
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
              {selectedDetail.connections.map(({ node, edgeType, weight }, i) => {
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
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

export function KnowledgeGraph({ isOpen, onClose }) {
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
            Knowledge Graph
          </div>
          <button className="kg-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        <GraphCanvas />
      </div>
    </div>
  );
}
