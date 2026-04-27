import { faDiagramProject, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchGraph } from '../../services/graphService';
import './KnowledgeGraph.css';

// ── Visual config ─────────────────────────────────────────────────────────────

const NODE_COLORS = {
  workspace: '#6366f1',
  url:       '#22c55e',
  app:       '#f59e0b',
  folder:    '#facc15',
  file:      '#94a3b8',
};

const EDGE_COLORS = {
  co_occurrence:       '#6366f1',
  url_in_workspace:    '#22c55e',
  app_in_workspace:    '#f59e0b',
  folder_in_workspace: '#facc15',
  file_in_workspace:   '#94a3b8',
};

const BASE_RADIUS = 5;
const FILTERS = ['all', 'url', 'app', 'folder', 'file', 'workspace'];

function nodeRadius(node) {
  return BASE_RADIUS + Math.sqrt(node.weight || 1) * 2;
}

function drawDiamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function drawSquare(ctx, x, y, r) {
  ctx.beginPath();
  ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
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

// ── GraphCanvas — embeddable graph component ──────────────────────────────────

export function GraphCanvas() {
  const [rawData, setRawData]         = useState({ nodes: [], links: [] });
  const [loading, setLoading]         = useState(false);
  const [filter, setFilter]           = useState('all');
  const [showLabels, setShowLabels]   = useState(true);
  const [selectedId, setSelectedId]   = useState(null);
  const [tooltip, setTooltip]         = useState(null);
  const [graphModule, setGraphModule] = useState(null);
  const [dims, setDims]               = useState(null); // null until measured

  const fgRef      = useRef(null);
  const canvasRef  = useRef(null);
  const mousePos   = useRef({ x: 0, y: 0 }); // track real mouse coords for tooltip

  // Track mouse position globally so the tooltip can follow the cursor
  useEffect(() => {
    const track = e => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', track);
    return () => window.removeEventListener('mousemove', track);
  }, []);

  // Lazy-load react-force-graph-2d on mount
  useEffect(() => {
    if (graphModule) return;
    import('react-force-graph-2d').then(m => setGraphModule(() => m.default));
  }, [graphModule]);

  // Strengthen repulsion after graph module + data are ready
  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force('charge')?.strength(-200);
    fgRef.current.d3Force('link')?.distance(80);
  }, [graphModule, rawData]);

  // Fetch graph data on mount
  useEffect(() => {
    setLoading(true);
    fetchGraph().then(data => {
      if (!data) return;
      setRawData({
        nodes: data.nodes,
        links: (data.edges || []).map(e => ({ ...e, source: e.source, target: e.target }))
      });
    }).finally(() => setLoading(false));
  }, []);

  // Measure container synchronously on layout, then track resizes.
  // useLayoutEffect fires after DOM paint so getBoundingClientRect is accurate.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setDims({ w: Math.floor(width), h: Math.floor(height) });
      }
    };

    measure(); // immediate read

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filteredData = useMemo(() => applyFilter(rawData, filter), [rawData, filter]);

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

  const handleNodeClick       = useCallback(node => setSelectedId(prev => prev === node.id ? null : node.id), []);
  const handleBackgroundClick = useCallback(() => { setSelectedId(null); setTooltip(null); }, []);

  // onNodeHover passes (node, prevNode) — no event arg; use tracked mouse position instead
  const handleNodeHover = useCallback((node) => {
    if (!node) { setTooltip(null); return; }
    setTooltip({ x: mousePos.current.x, y: mousePos.current.y, node });
  }, []);

  // Auto-fit to view once simulation settles
  const handleEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit(400, 40);
  }, []);

  const handleNodeCanvasObject = useCallback((node, ctx, globalScale) => {
    ctx.save(); // isolate all state changes for this node

    const r     = nodeRadius(node);
    const col   = NODE_COLORS[node.type] || '#60a5fa';
    const faded = connectedIds && !connectedIds.has(node.id);

    ctx.globalAlpha = faded ? 0.15 : 1;
    ctx.fillStyle   = col;
    ctx.strokeStyle = selectedId === node.id ? '#ffffff' : 'transparent';
    ctx.lineWidth   = 1.5 / globalScale;

    if (node.type === 'workspace') {
      const rr = r * 1.4;
      ctx.beginPath();
      // roundRect fallback for older WebKit
      if (ctx.roundRect) {
        ctx.roundRect(node.x - rr, node.y - rr, rr * 2, rr * 2, 4 / globalScale);
      } else {
        ctx.rect(node.x - rr, node.y - rr, rr * 2, rr * 2);
      }
    } else if (node.type === 'folder') {
      drawDiamond(ctx, node.x, node.y, r * 1.3);
    } else if (node.type === 'file') {
      drawSquare(ctx, node.x, node.y, r);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    }
    ctx.fill();
    if (selectedId === node.id) ctx.stroke();

    // Workspace labels: always visible. URL/app labels: only when zoomed in.
    const isWorkspace = node.type === 'workspace';
    const showThisLabel = showLabels && (isWorkspace ? globalScale > 0.3 : globalScale > 1.2);

    if (showThisLabel) {
      const fontSize = isWorkspace
        ? Math.max(11, 13 / globalScale)
        : Math.max(9, 10 / globalScale);
      ctx.font         = `${isWorkspace ? 600 : 400} ${fontSize}px Inter, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = faded
        ? 'rgba(255,255,255,0.15)'
        : isWorkspace ? '#e2e8f0' : 'rgba(255,255,255,0.7)';
      const maxLen = isWorkspace ? 24 : 20;
      const label  = node.label.length > maxLen ? node.label.slice(0, maxLen - 1) + '…' : node.label;
      ctx.fillText(label, node.x, node.y + r + 3 / globalScale);
    }

    ctx.restore(); // restore all canvas state before next node draws
    node.__r = r;
  }, [connectedIds, selectedId, showLabels]);

  const nodePointerAreaPaint = useCallback((node, col, ctx) => {
    const r = node.__r || nodeRadius(node);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback(link => {
    const col = EDGE_COLORS[link.type] || '#94a3b8';
    if (!connectedIds) return col + '99';
    const src = typeof link.source === 'object' ? link.source.id : link.source;
    const tgt = typeof link.target === 'object' ? link.target.id : link.target;
    return connectedIds.has(src) && connectedIds.has(tgt) ? col : col + '22';
  }, [connectedIds]);

  const linkWidth = useCallback(link => (link.weight || 0.3) * 2.5, []);

  const isEmpty = rawData.nodes.length === 0 && !loading;

  return (
    <div className="kg-canvas-root">
      {/* Controls bar */}
      <div className="kg-controls">
        <div className="kg-filters">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`kg-pill ${f} ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>
        <div className="kg-actions">
          <button className={`kg-btn ${showLabels ? 'active' : ''}`} onClick={() => setShowLabels(v => !v)}>
            Labels
          </button>
          <button className="kg-btn" onClick={() => fgRef.current?.zoomToFit(400)}>
            Fit
          </button>
        </div>
      </div>

      {/* Graph area — always rendered so ref is measurable from mount */}
      <div className="kg-canvas" ref={canvasRef}>
        {loading && (
          <div className="kg-state kg-state-overlay">
            <div className="kg-spinner" />
            <h4>Building graph…</h4>
          </div>
        )}

        {!loading && isEmpty && (
          <div className="kg-state kg-state-overlay">
            <FontAwesomeIcon icon={faDiagramProject} style={{ fontSize: 32, color: '#334155' }} />
            <h4>No graph data yet</h4>
            <p>Add URLs, apps, and folders to workspaces — the graph grows as you use the app.</p>
          </div>
        )}

        {!loading && !isEmpty && graphModule && dims && (() => {
          const ForceGraph2D = graphModule;
          return (
            <ForceGraph2D
              ref={fgRef}
              graphData={filteredData}
              width={dims.w}
              height={dims.h}
              backgroundColor="transparent"
              nodeCanvasObject={handleNodeCanvasObject}
              nodePointerAreaPaint={nodePointerAreaPaint}
              linkColor={linkColor}
              linkWidth={linkWidth}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onBackgroundClick={handleBackgroundClick}
              onEngineStop={handleEngineStop}
              cooldownTicks={150}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              nodeId="id"
              linkSource="source"
              linkTarget="target"
            />
          );
        })()}
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div className="kg-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <div className="kg-tooltip-label">{tooltip.node.label}</div>
          <div className="kg-tooltip-meta">
            {tooltip.node.type} · weight {tooltip.node.weight}
            {tooltip.node.title && ` · ${tooltip.node.title}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ── KnowledgeGraph — full-screen modal wrapper ────────────────────────────────

export function KnowledgeGraph({ isOpen, onClose }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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
