import { faDiagramProject, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { forceCollide, forceX, forceY } from 'd3-force-3d';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import categoryManager from '../../data/categories.js';
import { fetchGraph, graphChanged } from '../../services/graphService';
import { getHostUrl } from '../../services/syncConfig';
import { computeDegrees, sparsifyLinks, STRUCTURAL_EDGE_TYPES } from '../../utils/graphSalience.js';
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

// Nodes that belong to no workspace: neutral gray, so color always means
// "which project" — never node type.
const UNSORTED_VIS = { base: '#475569', hi: '#94a3b8', glow: '#64748b', dim: '#47556930' };
const CLUSTER_UNSORTED = '__unsorted__';

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

// Size from what is actually on screen. The backend `weight` field cannot be
// used here: it means "member count" on a workspace, "degree" on an app, and is
// flat 0 for any node that only ever appeared in a co-occurrence pair — so it
// is not comparable across node types and understates a fifth of the graph.
function nodeRadius(node) {
  const links = node.degree || 0;
  if (node.type === 'workspace') return 14 + Math.sqrt(node.memberCount || 1) * 2.6;
  const byLinks = 3.5 + Math.sqrt(links) * 1.4;
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

  // ── Cluster model: every node belongs to a workspace or to "Unsorted" ─────
  // Membership comes first (the user said so explicitly). Anything left over
  // falls back to its domain category — the workspaces are named after the same
  // taxonomy, so a categorised URL lands in a hub that already exists instead of
  // in an anonymous pile.
  const { cluster: nodeCluster, inferred } = useMemo(() => {
    const wsIds = new Set(rawData.nodes.filter(n => n.type === 'workspace').map(n => n.id));
    const map = new Map();
    const inferred = new Set();
    wsIds.forEach(id => map.set(id, id));

    // Pass 1 — explicit workspace membership.
    rawData.links.forEach(l => {
      const src = typeof l.source === 'object' ? l.source.id : l.source;
      const tgt = typeof l.target === 'object' ? l.target.id : l.target;
      if (wsIds.has(src) && !wsIds.has(tgt) && !map.has(tgt)) map.set(tgt, src);
      if (wsIds.has(tgt) && !wsIds.has(src) && !map.has(src)) map.set(src, tgt);
    });

    // Pass 2 — category fallback, workspace label matched case-insensitively.
    const wsByName = new Map(
      rawData.nodes
        .filter(n => n.type === 'workspace')
        .map(n => [n.label.trim().toLowerCase(), n.id])
    );
    rawData.nodes.forEach(n => {
      if (map.has(n.id) || (n.type !== 'url' && n.type !== 'media')) return;
      const cat = categoryManager.categorizeUrl(n.label);
      if (cat === 'uncategorized') return;
      const wsId = wsByName.get(cat.toLowerCase());
      if (wsId) {
        map.set(n.id, wsId);
        inferred.add(n.id);
      }
    });

    // nodes absent from `cluster` are genuinely unsorted
    return { cluster: map, inferred };
  }, [rawData]);

  const clusterOf = useCallback(
    id => nodeCluster.get(id) || CLUSTER_UNSORTED,
    [nodeCluster]
  );

  // Fixed anchor per cluster, arranged on a ring — deterministic layout, so the
  // map reads as named regions and never reshuffles between refreshes.
  const clusterAnchors = useMemo(() => {
    // An empty workspace claims a ring slot and a full-size bubble while saying
    // nothing, so only hubs that actually hold something get anchored.
    const populated = new Set();
    nodeCluster.forEach((wsId, nodeId) => { if (nodeId !== wsId) populated.add(wsId); });
    const wsSorted = rawData.nodes
      .filter(n => n.type === 'workspace' && populated.has(n.id))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(n => n.id);
    const hasUnsorted = rawData.nodes.some(n => n.type !== 'workspace' && !nodeCluster.has(n.id));
    const ids = hasUnsorted ? [...wsSorted, CLUSTER_UNSORTED] : wsSorted;
    const n = ids.length;
    const map = new Map();
    if (n === 0) return map;
    const R = n === 1 ? 0 : Math.max(240, n * 70);
    ids.forEach((id, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      map.set(id, { x: Math.cos(a) * R, y: Math.sin(a) * R });
    });
    return map;
  }, [rawData, nodeCluster]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Pin each workspace at its ring anchor; children gravitate to it.
    rawData.nodes.forEach(n => {
      if (n.type === 'workspace') {
        const a = clusterAnchors.get(n.id);
        if (a) { n.fx = a.x; n.fy = a.y; }
      }
    });
    const anchorOf = node =>
      clusterAnchors.get(clusterOf(node.id)) || { x: 0, y: 0 };
    fg.d3Force('charge')?.strength(node =>
      node.type === 'workspace' ? -320 : -30
    );
    fg.d3Force('link')?.distance(link => {
      const srcType = typeof link.source === 'object' ? link.source.type : null;
      const tgtType = typeof link.target === 'object' ? link.target.type : null;
      if (srcType === 'workspace' || tgtType === 'workspace') return 70;
      return 110;
    });
    // Cluster gravity — this is what turns the hairball into readable groups
    fg.d3Force('x', forceX(node => anchorOf(node).x).strength(node => node.type === 'workspace' ? 0 : 0.08));
    fg.d3Force('y', forceY(node => anchorOf(node).y).strength(node => node.type === 'workspace' ? 0 : 0.08));
    // Hard collision bubble — nodes can NEVER overlap
    fg.d3Force('collide', forceCollide(node => nodeRadius(node) + 5));
    // Reheat so new forces take effect immediately
    fg.d3ReheatSimulation();
  }, [rawData, clusterAnchors, clusterOf]);

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
    // Salience pass: normalize co-occurrence by base rate, then keep each
    // node's strongest links. A flat weight cutoff cannot work here — raw
    // co-occurrence counts favour whatever is always open, so ~96% of edges
    // cleared the old threshold and every layout collapsed into one knot.
    const links = sparsifyLinks(data.links);

    // Size inputs, derived from what survived rather than from the backend's
    // overloaded `weight`. Mutating the node objects (rather than cloning) is
    // deliberate — react-force-graph keeps its simulation state on them.
    const degrees = computeDegrees(links);
    const memberCounts = new Map();
    nodeCluster.forEach((wsId, nodeId) => {
      if (nodeId === wsId) return;
      memberCounts.set(wsId, (memberCounts.get(wsId) || 0) + 1);
    });
    data.nodes.forEach(n => {
      n.degree = degrees.get(n.id) || 0;
      if (n.type === 'workspace') n.memberCount = memberCounts.get(n.id) || 0;
    });

    // Drop hubs that hold nothing — they get no ring anchor, so leaving them in
    // would strand them at the origin on top of everything else.
    const nodes = data.nodes.filter(n => n.type !== 'workspace' || n.memberCount > 0);
    const live = new Set(nodes.map(n => n.id));
    return {
      nodes,
      links: links.filter(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return live.has(s) && live.has(t);
      }),
    };
  }, [rawData, filter, timeCutoffMs, nodeCluster]);

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
    // Ranked over the links actually drawn, by salience — raw `weight` is not
    // comparable between a membership edge (always 1.0) and a measured one.
    const connections = filteredData.links
      .filter(l => getId(l.source) === selectedId || getId(l.target) === selectedId)
      .map(l => {
        const otherId = getId(l.source) === selectedId ? getId(l.target) : getId(l.source);
        return {
          node: rawData.nodes.find(n => n.id === otherId),
          edgeType: l.type,
          weight: l.salience ?? 0,
        };
      })
      .filter(c => c.node)
      .sort((a, b) => b.weight - a.weight);
    return { node, connections };
  }, [selectedId, rawData, filteredData]);

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
    // Workspaces are pre-pinned at their ring anchors; just frame the map.
    if (fgRef.current) fgRef.current.zoomToFit(400, 40);
  }, []);

  // ── Cluster bubbles: soft tinted region behind each workspace's nodes ─────
  const drawClusterBubbles = useCallback((ctx, globalScale) => {
    const groups = new Map();
    displayData.nodes.forEach(n => {
      if (!isFinite(n.x) || !isFinite(n.y)) return;
      const cid = clusterOf(n.id);
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid).push(n);
    });
    groups.forEach((members, cid) => {
      const isUnsorted = cid === CLUSTER_UNSORTED;
      if (members.length < 2) return;
      let cx = 0, cy = 0;
      members.forEach(m => { cx += m.x; cy += m.y; });
      cx /= members.length; cy /= members.length;
      let r = 0;
      members.forEach(m => {
        r = Math.max(r, Math.hypot(m.x - cx, m.y - cy) + (m.__r || 6));
      });
      r += 24;
      const base = isUnsorted ? UNSORTED_VIS.base : (wsColorMap.get(cid)?.vis?.base || UNSORTED_VIS.base);
      ctx.save();
      ctx.fillStyle   = base + '0c';
      ctx.strokeStyle = base + '2e';
      ctx.lineWidth   = 1 / globalScale;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      // Unsorted has no workspace node to label it — caption the bubble itself
      if (isUnsorted) {
        ctx.font         = `600 ${Math.max(10, 12 / globalScale)}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle    = 'rgba(148, 163, 184, 0.55)';
        ctx.fillText(`Unsorted · ${members.length}`, cx, cy - r - 5 / globalScale);
      }
      ctx.restore();
    });
  }, [displayData, clusterOf, wsColorMap]);

  // ── Node canvas renderer ──────────────────────────────────────────────────
  const handleNodeCanvasObject = useCallback((node, ctx, globalScale) => {
    ctx.save();

    const r   = nodeRadius(node);
    const colorEntry = wsColorMap.get(node.id);
    // Color encodes workspace membership only; unassigned nodes stay gray
    const vis = colorEntry?.vis
      || (node.type === 'workspace' ? NODE_VISUAL.workspace : UNSORTED_VIS);

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

    // A dashed rim marks a node placed by category rather than by the user, so
    // an inferred grouping never passes itself off as one you confirmed.
    ctx.strokeStyle = vis.hi + (faded ? '30' : '80');
    ctx.lineWidth   = 1 / globalScale;
    if (inferred.has(node.id)) ctx.setLineDash([2 / globalScale, 2 / globalScale]);
    ctx.stroke();
    ctx.setLineDash([]);

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
    // always for nodes that matter (real usage, heavy linking, or selection).
    if (isWs || globalScale > 1.1 || node.activeS || isSelected || r >= 8) {
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
  }, [connectedIds, selectedId, searchMatches, wsColorMap, wsChildCount, inferred]);

  const nodePointerAreaPaint = useCallback((node, col, ctx) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(node.x, node.y, (node.__r || nodeRadius(node)) + 4, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // ── Edge styling via native accessors (the custom linkCanvasObject renderer
  // was silently ignored by this react-force-graph version, so links fell back
  // to the library default rgba(0,0,0,0.15) — black lines on a black canvas).
  // Bridges between clusters are the story; ties inside a cluster are already
  // told by the bubble, so they stay quieter.
  const alphaHex = a => Math.round(a * 255).toString(16).padStart(2, '0');

  const linkEnds = link => [
    typeof link.source === 'object' ? link.source.id : link.source,
    typeof link.target === 'object' ? link.target.id : link.target,
  ];

  const handleLinkColor = useCallback(link => {
    const [srcId, tgtId] = linkEnds(link);
    const cross = clusterOf(srcId) !== clusterOf(tgtId);
    let alpha = cross ? 0.55 : 0.3;
    if (connectedIds) {
      alpha = (connectedIds.has(srcId) && connectedIds.has(tgtId)) ? 0.8 : 0.03;
    }
    const col = cross
      ? '#e2e8f0'
      : (wsColorMap.get(srcId)?.vis?.base || EDGE_COLORS[link.type] || '#64748b');
    return col + alphaHex(alpha);
  }, [connectedIds, wsColorMap, clusterOf]);

  // Width tracks `salience`, not the raw weight — the five edge types are on
  // five different scales, and membership edges are a flat 1.0, which used to
  // make the links the user typed in by hand the thickest thing on screen.
  // Those are context, so they render as hairlines; measured association gets
  // the ink.
  const handleLinkWidth = useCallback(link => {
    const [srcId, tgtId] = linkEnds(link);
    if (STRUCTURAL_EDGE_TYPES.has(link.type)) return 0.5;
    const s = link.salience ?? 0.3;
    return clusterOf(srcId) !== clusterOf(tgtId)
      ? Math.max(1, s * 4)
      : Math.max(0.7, s * 3.2);
  }, [clusterOf]);

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
              onRenderFramePre={drawClusterBubbles}
              nodeCanvasObject={handleNodeCanvasObject}
              nodePointerAreaPaint={nodePointerAreaPaint}
              linkColor={handleLinkColor}
              linkWidth={handleLinkWidth}
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
          const detailVis = wsColorMap.get(selectedDetail.node.id)?.vis || UNSORTED_VIS;
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
                <span className="kg-stat-val">{selectedDetail.node.degree ?? 0}</span>
                <span className="kg-stat-label">links shown</span>
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
                const cVis = wsColorMap.get(node.id)?.vis || UNSORTED_VIS;
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
        const tVis    = wsColorMap.get(tooltip.node.id)?.vis || UNSORTED_VIS;
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
              <span>{tooltip.node.degree ?? 0} links</span>
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
            Cool Activity
          </div>
          <button className="kg-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        {/* One scrolling page: overview readout on top, graph stage below */}
        <div className="kg-scroll">
          <ActivityOverview />
          <div className="kg-graph-heading">Knowledge graph</div>
          <div className="kg-graph-section">
            <GraphCanvas />
          </div>
        </div>
      </div>
    </div>
  );
}
