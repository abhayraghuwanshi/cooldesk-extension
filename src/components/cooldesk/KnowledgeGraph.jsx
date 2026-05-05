import { faDiagramProject, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchGraph, graphChanged } from '../../services/graphService';
import './KnowledgeGraph.css';

// ── Visual config ─────────────────────────────────────────────────────────────

const NODE_VISUAL = {
  workspace: { base: '#6366f1', hi: '#a5b4fc', glow: '#818cf8', dim: '#6366f144' },
  url:       { base: '#10b981', hi: '#6ee7b7', glow: '#34d399', dim: '#10b98144' },
  app:       { base: '#f59e0b', hi: '#fde68a', glow: '#fbbf24', dim: '#f59e0b44' },
  folder:    { base: '#eab308', hi: '#fef08a', glow: '#facc15', dim: '#eab30844' },
  file:      { base: '#475569', hi: '#94a3b8', glow: '#64748b', dim: '#47556944' },
  media:     { base: '#ec4899', hi: '#f9a8d4', glow: '#f472b6', dim: '#ec489944' },
};

const EDGE_COLORS = {
  co_occurrence:          '#818cf8',
  session_co_occurrence:  '#c084fc',
  url_in_workspace:       '#34d399',
  app_in_workspace:       '#fbbf24',
  folder_in_workspace:    '#facc15',
  file_in_workspace:      '#64748b',
  shared_resource:        'rgba(255,255,255,0.25)',
};

// Keep flat colors for pointer area + detail panel dots
const NODE_COLORS = Object.fromEntries(
  Object.entries(NODE_VISUAL).map(([k, v]) => [k, v.base])
);

const BASE_RADIUS = 5;
const FILTERS = ['all', 'url', 'app', 'folder', 'file', 'media', 'workspace'];

function nodeRadius(node) {
  return BASE_RADIUS + Math.sqrt(node.weight || 1) * 2.2;
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
  const [graphModule, setGraphModule]     = useState(null);
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
  useEffect(() => { rawDataRef.current = rawData; }, [rawData]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useEffect(() => {
    const track = e => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', track);
    return () => window.removeEventListener('mousemove', track);
  }, []);

  useEffect(() => {
    if (graphModule) return;
    import('react-force-graph-2d').then(m => setGraphModule(() => m.default));
  }, [graphModule]);

  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force('charge')?.strength(-220);
    fgRef.current.d3Force('link')?.distance(90);
  }, [graphModule, rawData]);

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

  const handleNodeClick       = useCallback(node => setSelectedId(p => p === node.id ? null : node.id), []);
  const handleBackgroundClick = useCallback(() => { setSelectedId(null); setTooltip(null); }, []);
  const handleNodeHover       = useCallback(node => {
    if (!node) { setTooltip(null); return; }
    setTooltip({ x: mousePos.current.x, y: mousePos.current.y, node });
  }, []);
  const handleEngineStop = useCallback(() => { fgRef.current?.zoomToFit(400, 40); }, []);

  // ── Node canvas renderer ──────────────────────────────────────────────────
  const handleNodeCanvasObject = useCallback((node, ctx, globalScale) => {
    ctx.save();

    const r   = nodeRadius(node);
    const vis = NODE_VISUAL[node.type] || NODE_VISUAL.url;

    const searchActive = searchMatches !== null;
    const searchHit    = searchActive && searchMatches.has(node.id);
    const isSelected   = selectedId === node.id;
    const faded        = (connectedIds && !connectedIds.has(node.id))
                       || (searchActive && !searchHit);

    ctx.globalAlpha = faded ? 0.07 : 1;

    // ── Selection rings ──
    if (isSelected) {
      ctx.shadowColor = vis.glow;
      ctx.shadowBlur  = 24;
      ctx.strokeStyle = vis.hi;
      ctx.lineWidth   = 1.2 / globalScale;

      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 10 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 18 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
    }

    // ── Search glow ring ──
    if (searchHit) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur  = 18;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth   = 2 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 5 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Node glow ──
    ctx.shadowColor = vis.glow;
    ctx.shadowBlur  = isSelected ? 20 : 9;

    // ── Radial gradient fill (sphere effect) ──
    // Guard: node positions are NaN during the first simulation ticks
    if (!isFinite(node.x) || !isFinite(node.y)) { ctx.restore(); return; }

    const grad = ctx.createRadialGradient(
      node.x - r * 0.38, node.y - r * 0.38, r * 0.04,
      node.x, node.y, r
    );
    grad.addColorStop(0,    vis.hi);
    grad.addColorStop(0.42, vis.base);
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
      ig.addColorStop(0, vis.hi);
      ig.addColorStop(1, vis.base);
      ctx.fillStyle = ig;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 0.42, 0, 2 * Math.PI);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    }
    ctx.fill();

    // ── Workspace hex border ──
    if (node.type === 'workspace') {
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = vis.hi + 'cc';
      ctx.lineWidth   = 1 / globalScale;
      ctx.stroke();
    }

    // ── Selected inner bright spot ──
    if (isSelected) {
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = vis.hi + '55';
      ctx.beginPath();
      ctx.arc(node.x - r * 0.25, node.y - r * 0.25, r * 0.28, 0, 2 * Math.PI);
      ctx.fill();
    }

    // ── Labels ──
    const isWs = node.type === 'workspace';
    if (showLabels && (isWs ? globalScale > 0.22 : globalScale > 0.9)) {
      ctx.shadowBlur = 0;
      const fs  = isWs ? Math.max(11, 13 / globalScale) : Math.max(9, 10 / globalScale);
      const lbl = node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label;
      const ty  = node.y + (isWs ? r * 1.55 : r) + 3 / globalScale;

      ctx.font         = `${isWs ? 700 : 500} ${fs}px Inter, system-ui, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';

      // Drop shadow for readability
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText(lbl, node.x + 0.6 / globalScale, ty + 0.6 / globalScale);
      ctx.fillStyle = faded ? 'rgba(255,255,255,0.15)' : (isWs ? '#f1f5f9' : vis.hi);
      ctx.fillText(lbl, node.x, ty);
    }

    ctx.restore();
    node.__r = r;
  }, [connectedIds, selectedId, showLabels, searchMatches]);

  const nodePointerAreaPaint = useCallback((node, col, ctx) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(node.x, node.y, (node.__r || nodeRadius(node)) + 4, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback(link => {
    const col = EDGE_COLORS[link.type] || '#94a3b8';
    if (!connectedIds) return col + 'aa';
    const src = typeof link.source === 'object' ? link.source.id : link.source;
    const tgt = typeof link.target === 'object' ? link.target.id : link.target;
    return connectedIds.has(src) && connectedIds.has(tgt) ? col : col + '18';
  }, [connectedIds]);

  const linkWidth = useCallback(link => {
    const base = link.type === 'shared_resource' ? 1 : (link.weight || 0.3) * 2.5;
    return Math.max(0.5, base);
  }, []);

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
          {!loading && !isEmpty && graphModule && dims && (() => {
            const ForceGraph2D = graphModule;
            return (
              <ForceGraph2D
                ref={fgRef}
                graphData={displayData}
                width={dims.w}
                height={dims.h}
                backgroundColor="transparent"
                nodeCanvasObject={handleNodeCanvasObject}
                nodePointerAreaPaint={nodePointerAreaPaint}
                linkColor={linkColor}
                linkWidth={linkWidth}
                linkCurvature={link => link.type === 'shared_resource' ? 0.3 : 0}
                onNodeClick={handleNodeClick}
                onNodeHover={handleNodeHover}
                onBackgroundClick={handleBackgroundClick}
                onEngineStop={handleEngineStop}
                cooldownTicks={160}
                d3AlphaDecay={0.018}
                d3VelocityDecay={0.28}
                nodeId="id" linkSource="source" linkTarget="target"
              />
            );
          })()}
        </div>

        {/* Detail panel */}
        {selectedDetail && (
          <div className="kg-detail-panel">
            <div className="kg-detail-header"
                 style={{ borderBottom: `1px solid ${NODE_VISUAL[selectedDetail.node.type]?.base || '#6366f1'}33` }}>
              <span className="kg-detail-type-badge"
                    style={{
                      color: NODE_VISUAL[selectedDetail.node.type]?.hi || '#a5b4fc',
                      background: NODE_VISUAL[selectedDetail.node.type]?.dim || '#6366f144',
                    }}>
                {selectedDetail.node.type}
              </span>
              <span className="kg-detail-name">{selectedDetail.node.label}</span>
              <button className="kg-close" style={{ marginLeft: 'auto' }}
                      onClick={() => setSelectedId(null)}>
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
                const vis = NODE_VISUAL[node.type] || NODE_VISUAL.url;
                return (
                  <div key={i} className="kg-detail-row" onClick={() => setSelectedId(node.id)}>
                    <span className="kg-detail-dot" style={{ background: vis.base, boxShadow: `0 0 6px ${vis.glow}88` }} />
                    <span className="kg-detail-row-label">{node.label}</span>
                    <span className="kg-detail-edge-tag"
                          style={{ color: EDGE_COLORS[edgeType] || '#94a3b8' }}>
                      {edgeType.replace(/_in_workspace/, '').replace(/_/g, ' ')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="kg-tooltip"
             style={{ left: tooltip.x + 16, top: tooltip.y - 12,
                      borderColor: NODE_VISUAL[tooltip.node.type]?.base + '55' || 'rgba(148,163,184,0.2)' }}>
          <div className="kg-tooltip-label">{tooltip.node.label}</div>
          <div className="kg-tooltip-meta">
            <span className="kg-tooltip-type"
                  style={{ color: NODE_VISUAL[tooltip.node.type]?.hi || '#94a3b8' }}>
              {tooltip.node.type}
            </span>
            <span>·</span>
            <span>{tooltip.node.weight} connections</span>
          </div>
        </div>
      )}
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
