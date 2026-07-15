'use client';
import { useCallback, useRef, useState } from 'react';

// Accuracy-per-move line chart (chessigma-style): one smoothed line per player,
// quality-coloured dots on the misses, hover crosshair + tooltip, click to jump.
//
// Series colours are the app's chess-semantic grays (White = light, Black =
// mid-gray) — identity is never colour-alone: each series carries a direct
// label chip and the caller's duel header names the values (palette CVD ΔE
// 42.8 / contrast ≥3:1 on the zinc-900 surface; low chroma is deliberate —
// gray IS the entity here).

export interface AccPoint {
  index: number;          // ply/move index in the caller's space
  acc: number;            // 0–100
  dotHex?: string | null; // quality colour → draws a marker dot
  label: string;          // tooltip line, e.g. "12… Be6 ?? 10.0"
}
export interface AccSeries {
  label: string;          // 'W' | 'B' | 'You'
  color: string;
  points: AccPoint[];
}

const W = 1000, H = 220, PAD = 8;

// Catmull-Rom → cubic bezier path for a gently smoothed line.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function AccuracyPerMoveChart({
  series, maxIndex, currentIndex = null, onSelect,
}: {
  series: AccSeries[];
  maxIndex: number;                 // highest index across the game (x scale)
  currentIndex?: number | null;
  onSelect?: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ index: number; label: string; xPct: number } | null>(null);

  const x = useCallback((i: number) => PAD + (i / Math.max(1, maxIndex)) * (W - 2 * PAD), [maxIndex]);
  const y = (acc: number) => PAD + (1 - acc / 100) * (H - 2 * PAD);

  // Nearest point (across all series) to a client-x position.
  const pick = useCallback((clientX: number): AccPoint | null => {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const relIdx = ((clientX - rect.left) / rect.width) * W;
    let best: AccPoint | null = null, bestDist = Infinity;
    for (const s of series) {
      for (const p of s.points) {
        const d = Math.abs(x(p.index) - relIdx);
        if (d < bestDist) { bestDist = d; best = p; }
      }
    }
    return best;
  }, [series, x]);

  const onPointer = (e: React.PointerEvent) => {
    const p = pick(e.clientX);
    if (p) setHover({ index: p.index, label: p.label, xPct: (x(p.index) / W) * 100 });
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-24 cursor-crosshair"
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => { const p = pick(e.clientX); if (p && onSelect) onSelect(p.index); }}
      >
        {/* recessive gridlines at 100/75/50/25 */}
        {[100, 75, 50, 25].map((v) => (
          <line key={v} x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)}
            stroke="#3f3f46" strokeWidth={v === 50 ? 1 : 0.5} strokeDasharray={v === 50 ? undefined : '3 5'}
            vectorEffect="non-scaling-stroke" opacity={0.5} />
        ))}
        {series.map((s) => (
          <path key={s.label} d={smoothPath(s.points.map((p) => ({ x: x(p.index), y: y(p.acc) })))}
            fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            vectorEffect="non-scaling-stroke" />
        ))}
        {/* quality dots (with a 2px surface ring so they read over the lines) */}
        {series.flatMap((s) =>
          s.points.filter((p) => p.dotHex).map((p) => (
            <circle key={`${s.label}${p.index}`} cx={x(p.index)} cy={y(p.acc)} r={4}
              fill={p.dotHex!} stroke="#18181b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          )),
        )}
        {(hover || currentIndex != null) && (
          <line
            x1={x(hover?.index ?? currentIndex!)} x2={x(hover?.index ?? currentIndex!)}
            y1={PAD} y2={H - PAD} stroke="#3b82f6" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.8}
          />
        )}
      </svg>
      {/* direct series labels (identity never colour-alone) */}
      {series.length > 1 && (
        <div className="absolute top-0 right-0 flex gap-2 text-[9px] text-zinc-500">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {hover && (
        <div
          className="absolute -top-1 -translate-y-full -translate-x-1/2 px-1.5 py-0.5 rounded-sm bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-200 whitespace-nowrap pointer-events-none z-10"
          style={{ left: `${hover.xPct}%` }}
        >
          {hover.label}
        </div>
      )}
    </div>
  );
}
