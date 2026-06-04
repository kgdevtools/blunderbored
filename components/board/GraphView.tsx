'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, LibraryGame } from '@/lib/db';
import { conceptLevelGraph, egoNetwork } from '@/lib/edges';
import { colorForFamily, ensureOpeningHierarchy } from '@/lib/concepts';

interface GraphViewProps {
  onOpenGame: (game: LibraryGame) => void;
}

// 'concept-level' = the default overview (concepts only, games collapsed to counts).
// 'ego' = the neighbourhood around one node, reached by clicking it.
type View = { kind: 'concept-level' } | { kind: 'ego'; id: string };

interface ModelNode {
  id: string;
  type: 'concept' | 'game';
  label: string;
  color: string;
  count: number; // tagged-game count (concepts in the overview)
}
interface ModelEdge {
  source: string;
  target: string;
  type: 'concept-concept' | 'concept-game' | 'game-game';
  isRef: boolean;
}
interface RenderModel {
  nodes: ModelNode[];
  edges: ModelEdge[];
  focus?: ModelNode;
}

// Live, mutable simulation node (positions persist across model updates by id).
interface SimNode extends ModelNode {
  x: number; y: number; vx: number; vy: number;
}

const GAME_COLOR = '#a1a1aa';

// Zoom bounds. Min is generous so small screens can pull the whole graph into view.
const MIN_K = 0.25, MAX_K = 4;

// Zoom `t` to `nextK` while keeping the canvas point (px, py) fixed under the cursor/pinch.
function applyZoom(t: { x: number; y: number; k: number }, nextK: number, px: number, py: number) {
  const k = Math.max(MIN_K, Math.min(MAX_K, nextK));
  t.x = px - (px - t.x) * (k / t.k);
  t.y = py - (py - t.y) * (k / t.k);
  t.k = k;
}

export function GraphView({ onOpenGame }: GraphViewProps) {
  const [view, setView] = useState<View>({ kind: 'concept-level' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Backfill the opening hierarchy for pre-existing data (idempotent). New
  // imports build it during seeding; this covers libraries seeded before it
  // existed. The live query below picks up any edges this adds.
  useEffect(() => { ensureOpeningHierarchy().catch(() => {}); }, []);

  // ── Build the render model for the current view ────────────────────────────
  const model = useLiveQuery<RenderModel>(async () => {
    if (view.kind === 'concept-level') {
      const { concepts, edges, gameCounts } = await conceptLevelGraph();
      return {
        nodes: concepts.map((c) => ({
          id: c.id, type: 'concept', label: c.name, color: colorForFamily(c.family), count: gameCounts[c.id] ?? 0,
        })),
        edges: edges.map((e) => ({ source: e.source, target: e.target, type: e.type, isRef: false })),
      };
    }
    // ego view: resolve each neighbour id against both tables
    const { nodeIds, edges } = await egoNetwork(view.id, 1);
    const [concepts, games] = await Promise.all([
      db.conceptNodes.bulkGet(nodeIds),
      db.games.bulkGet(nodeIds),
    ]);
    const nodes: ModelNode[] = nodeIds.map((id, i) => {
      const c = concepts[i];
      if (c) return { id, type: 'concept', label: c.name, color: colorForFamily(c.family), count: 0 };
      const g = games[i];
      if (g) return { id, type: 'game', label: g.title, color: GAME_COLOR, count: 0 };
      return { id, type: 'game', label: '(deleted)', color: '#52525b', count: 0 };
    });
    const focus = nodes.find((n) => n.id === view.id);
    return {
      nodes,
      edges: edges.map((e) => ({ source: e.source, target: e.target, type: e.type, isRef: !!e.sourceNodeId })),
      focus,
    };
  }, [view.kind, view.kind === 'ego' ? view.id : '']);

  // ── Force simulation + canvas render ────────────────────────────────────────
  const simRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<ModelEdge[]>([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const onOpenRef = useRef(onOpenGame);
  onOpenRef.current = onOpenGame;

  // Reconcile sim nodes whenever the model changes (keep positions of surviving ids).
  useEffect(() => {
    if (!model) return;
    const prev = new Map(simRef.current.map((n) => [n.id, n]));
    const c = canvasRef.current;
    const cx = c ? c.clientWidth / 2 : 200;
    const cy = c ? c.clientHeight / 2 : 200;
    simRef.current = model.nodes.map((n) => {
      const old = prev.get(n.id);
      return old
        ? { ...n, x: old.x, y: old.y, vx: old.vx, vy: old.vy }
        : { ...n, x: cx + (Math.random() - 0.5) * 200, y: cy + (Math.random() - 0.5) * 200, vx: 0, vy: 0 };
    });
    edgesRef.current = model.edges;
  }, [model]);

  // rAF loop: integrate forces, then draw. Runs for the component's lifetime.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const radius = (n: SimNode) => (n.type === 'concept' ? 8 + Math.min(n.count, 40) * 0.5 : 5);

    const step = () => {
      const nodes = simRef.current;
      const edges = edgesRef.current;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const cx = w / 2, cy = h / 2;
      const byId = new Map(nodes.map((n) => [n.id, n]));

      // Repulsion (O(n²) — fine for the small visible set).
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
          const f = 4000 / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      // Spring attraction along edges.
      for (const e of edges) {
        const a = byId.get(e.source), b = byId.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 90) * 0.02;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      // Centering + integrate with damping.
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.002;
        n.vy += (cy - n.y) * 0.002;
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
      }

      // ── Draw ──
      const t = transformRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Edges — distinct style per type; refs accented.
      for (const e of edges) {
        const a = byId.get(e.source), b = byId.get(e.target);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (e.isRef) { ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
        else if (e.type === 'concept-concept') { ctx.strokeStyle = '#52525b'; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
        else if (e.type === 'concept-game') { ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); }
        else { ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 1; ctx.setLineDash([1, 3]); }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes.
      for (const n of nodes) {
        const r = radius(n);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        if (n.type === 'concept') {
          ctx.fillStyle = '#e4e4e7';
          ctx.font = '11px sans-serif';
          ctx.fillText(n.label, n.x + r + 3, n.y + 3);
        }
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── Pointer: 1-finger pan + tap (hit-test), 2-finger pinch-zoom, wheel zoom ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // All active pointers, keyed by id — lets us tell a pan from a pinch.
    const pointers = new Map<number, { x: number; y: number }>();
    let panId: number | null = null; // pointer currently driving a pan
    let moved = false, lastX = 0, lastY = 0;
    let pinchDist = 0;               // last 2-finger gap; 0 means "not pinching"

    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        panId = e.pointerId; moved = false; lastX = e.clientX; lastY = e.clientY;
      } else if (pointers.size === 2) {
        panId = null; // a second finger landed — switch from pan to pinch
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && dist > 0) {
          const rect = canvas.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
          const t = transformRef.current;
          applyZoom(t, t.k * (dist / pinchDist), mx, my);
        }
        pinchDist = dist;
        moved = true;
        return;
      }

      if (e.pointerId !== panId) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      transformRef.current.x += dx; transformRef.current.y += dy;
      lastX = e.clientX; lastY = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      const wasPan = e.pointerId === panId;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;

      if (pointers.size === 1) {
        // dropped from pinch back to one finger — rebase the pan to the survivor
        const [[id, p]] = [...pointers.entries()];
        panId = id; lastX = p.x; lastY = p.y;
        return;
      }
      if (pointers.size > 0) return;

      panId = null;
      if (!wasPan || moved) return; // a pan/pinch, not a tap
      const { x, y } = toWorld(e.clientX, e.clientY);
      let hit: SimNode | null = null;
      for (const n of simRef.current) {
        const r = (n.type === 'concept' ? 8 + Math.min(n.count, 40) * 0.5 : 5) + 4;
        if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) { hit = n; break; }
      }
      if (hit) setView({ kind: 'ego', id: hit.id });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyZoom(t, t.k * factor, e.clientX - rect.left, e.clientY - rect.top);
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Button zoom (mobile-friendly fallback): zoom about the canvas centre.
  const zoomByButton = (factor: number) => {
    const c = canvasRef.current;
    if (!c) return;
    applyZoom(transformRef.current, transformRef.current.k * factor, c.clientWidth / 2, c.clientHeight / 2);
  };
  const resetView = () => { transformRef.current = { x: 0, y: 0, k: 1 }; };

  const focusGameId = view.kind === 'ego' && model?.focus?.type === 'game' ? view.id : null;

  return (
    <div className="relative w-full h-full min-h-[320px]">
      {/* Header / controls */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-2 bg-zinc-900/80 backdrop-blur-sm">
        {view.kind === 'ego' ? (
          <>
            <button
              onClick={() => setView({ kind: 'concept-level' })}
              className="text-[11px] text-zinc-400 hover:text-zinc-100"
            >
              ← All concepts
            </button>
            <span className="text-xs text-zinc-200 truncate flex-1">{model?.focus?.label ?? ''}</span>
            {focusGameId && (
              <button
                onClick={async () => {
                  const g = await db.games.get(focusGameId);
                  if (g) onOpenRef.current(g);
                }}
                className="text-[11px] rounded bg-blue-700 hover:bg-blue-600 text-white px-2 py-0.5"
              >
                Open on board
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-zinc-400">Library graph — click a concept to explore</span>
        )}
      </div>

      <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing touch-none" />

      {/* Zoom controls — primary on touch / small screens, also work on desktop */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
        <button
          onClick={() => zoomByButton(1.25)}
          aria-label="Zoom in"
          className="h-9 w-9 grid place-items-center rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 text-lg leading-none border border-zinc-700"
        >
          +
        </button>
        <button
          onClick={() => zoomByButton(0.8)}
          aria-label="Zoom out"
          className="h-9 w-9 grid place-items-center rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 text-lg leading-none border border-zinc-700"
        >
          −
        </button>
        <button
          onClick={resetView}
          aria-label="Reset view"
          className="h-9 w-9 grid place-items-center rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 text-sm leading-none border border-zinc-700"
        >
          ⟲
        </button>
      </div>

      {model && model.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-zinc-600 text-center max-w-[240px]">
            Nothing to show yet. Save some games (opening concepts appear automatically) or create concepts.
          </p>
        </div>
      )}
    </div>
  );
}
