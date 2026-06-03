'use client';
import { useMemo, useRef, useState } from 'react';
import type { ReviewedMove } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';
import { winP } from '@/lib/accuracy';

interface EvalCurveProps {
  moves: ReviewedMove[];
  currentMoveIndex: number;       // -1 = start position
  onSelectMove: (index: number) => void;
}

const W = 1000;
const H = 240;
const PAD = 6;

const PHASE_FILL: Record<string, string> = {
  opening: '#3b82f6',
  middlegame: '#a855f7',
  endgame: '#22c55e',
};

function formatEval(m: ReviewedMove): string {
  const cp = m.evalAfter;
  if (cp >= 9900) return '#'; if (cp <= -9900) return '-#';
  const a = (Math.abs(cp) / 100).toFixed(1);
  return cp >= 0 ? `+${a}` : `−${a}`;
}

export function EvalCurve({ moves, currentMoveIndex, onSelectMove }: EvalCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = moves.length;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const y = (winPct: number) => H - PAD - (winPct / 100) * (H - 2 * PAD);

  const pts = useMemo(() => moves.map((m, i) => ({ x: x(i), y: y(winP(m.evalAfter)) })), [moves]);

  // Phase bands: contiguous runs of the same phase.
  const bands = useMemo(() => {
    const out: { x0: number; x1: number; phase: string }[] = [];
    for (let i = 0; i < n; i++) {
      const p = moves[i].phase;
      const last = out[out.length - 1];
      if (last && last.phase === p) last.x1 = x(i);
      else out.push({ x0: i === 0 ? 0 : x(i), x1: x(i), phase: p });
    }
    if (out.length) out[out.length - 1].x1 = W;
    return out;
  }, [moves, n]);

  const linePath = pts.length ? 'M' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L') : '';
  const areaPath = pts.length ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z` : '';

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return null;
    const rect = svg.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(frac * (n - 1));
  };

  const marker = hover ?? (currentMoveIndex >= 0 ? currentMoveIndex : null);

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-32 cursor-pointer touch-none select-none"
        onPointerMove={(e) => setHover(pick(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => { const i = pick(e.clientX); if (i != null) onSelectMove(i); }}
      >
        {/* Phase bands */}
        {bands.map((b, i) => (
          <rect key={i} x={b.x0} y={0} width={Math.max(0, b.x1 - b.x0)} height={H} fill={PHASE_FILL[b.phase]} opacity={0.08} />
        ))}
        {/* 50% midline */}
        <line x1={0} y1={y(50)} x2={W} y2={y(50)} stroke="#52525b" strokeWidth={1} strokeDasharray="4 4" />
        {/* Area + curve */}
        {areaPath && <path d={areaPath} fill="#e4e4e7" opacity={0.12} />}
        {linePath && <path d={linePath} fill="none" stroke="#d4d4d8" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {/* Quality dots (skip plain good/book to reduce noise) */}
        {moves.map((m, i) => {
          if (m.quality === 'good' || m.quality === 'book') return null;
          return <circle key={i} cx={pts[i].x} cy={pts[i].y} r={4} fill={QUALITY_META[m.quality].hex} vectorEffect="non-scaling-stroke" />;
        })}
        {/* Current / hover marker */}
        {marker != null && pts[marker] && (
          <>
            <line x1={pts[marker].x} y1={0} x2={pts[marker].x} y2={H} stroke="#3b82f6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={pts[marker].x} cy={pts[marker].y} r={5} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {marker != null && moves[marker] && (
        <div className="pointer-events-none absolute top-1 left-2 rounded bg-zinc-800/90 px-2 py-0.5 text-[10px] font-mono text-zinc-200 tracking-tight">
          {Math.floor(marker / 2) + 1}{moves[marker].color === 'w' ? '.' : '…'} {moves[marker].moveSan}
          <span className="ml-1.5 text-zinc-400">{formatEval(moves[marker])}</span>
          {moves[marker].quality !== 'good' && moves[marker].quality !== 'book' && (
            <span className="ml-1.5" style={{ color: QUALITY_META[moves[marker].quality].hex }}>
              {QUALITY_META[moves[marker].quality].label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
