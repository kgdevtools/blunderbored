'use client';
import { useMemo, useRef, useState } from 'react';
import type { ReviewedMove } from '@/lib/analysis';
import { QUALITY_META, winP } from '@/lib/accuracy';

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
const PHASE_LABEL: Record<string, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

// Eval gridlines (white-POV centipawns) shown on the y-axis.
const Y_TICKS = [500, 200, 0, -200, -500];
function evalTickLabel(cp: number): string {
  if (cp === 0) return '0';
  const v = (Math.abs(cp) / 100).toFixed(0);
  return cp > 0 ? `+${v}` : `−${v}`;
}

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
  const phasesPresent = useMemo(() => [...new Set(bands.map((b) => b.phase))], [bands]);

  // y-axis ticks as {label, topPct} for an HTML overlay (SVG text would stretch).
  const yTicks = useMemo(
    () => Y_TICKS.map((cp) => ({ label: evalTickLabel(cp), topPct: (y(winP(cp)) / H) * 100 })),
    [],
  );
  // x-axis ticks at 0 / ¼ / ½ / ¾ / end, labelled by move number.
  const xTicks = useMemo(() => {
    if (n === 0) return [];
    const seen = new Set<number>();
    return [0, 0.25, 0.5, 0.75, 1]
      .map((f) => Math.round(f * (n - 1)))
      .filter((i) => (seen.has(i) ? false : (seen.add(i), true)))
      .map((i) => ({ label: `${Math.floor(i / 2) + 1}`, leftPct: (x(i) / W) * 100 }));
  }, [n]);

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
    <div className="relative w-full select-none">
      {/* Phase legend */}
      {phasesPresent.length > 0 && (
        <div className="flex items-center gap-3 mb-1 pl-8 text-[9px] text-zinc-500">
          {phasesPresent.map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-[1px]" style={{ background: PHASE_FILL[p], opacity: 0.85 }} />
              {PHASE_LABEL[p]}
            </span>
          ))}
        </div>
      )}

      <div className="flex">
        {/* y-axis (eval) */}
        <div className="relative w-8 shrink-0 h-32 text-[9px] tabular-nums text-zinc-500">
          {yTicks.map((t) => (
            <span key={t.label} className="absolute right-1 -translate-y-1/2" style={{ top: `${t.topPct}%` }}>{t.label}</span>
          ))}
        </div>

        {/* chart */}
        <div className="relative flex-1 h-32">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full h-full cursor-pointer touch-none"
            onPointerMove={(e) => setHover(pick(e.clientX))}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(e) => { const i = pick(e.clientX); if (i != null) onSelectMove(i); }}
          >
            {/* Phase bands + a stronger top accent rule per band */}
            {bands.map((b, i) => (
              <g key={i}>
                <rect x={b.x0} y={0} width={Math.max(0, b.x1 - b.x0)} height={H} fill={PHASE_FILL[b.phase]} opacity={0.14} />
                <rect x={b.x0} y={0} width={Math.max(0, b.x1 - b.x0)} height={3} fill={PHASE_FILL[b.phase]} opacity={0.7} />
              </g>
            ))}
            {/* eval gridlines (0 solid, others dashed) */}
            {yTicks.map((t) => (
              <line key={t.label} x1={0} y1={(t.topPct / 100) * H} x2={W} y2={(t.topPct / 100) * H}
                stroke="#52525b" strokeWidth={1} strokeDasharray={t.label === '0' ? '0' : '3 5'} opacity={t.label === '0' ? 0.7 : 0.4} />
            ))}
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
        </div>
      </div>

      {/* x-axis (move number) — offset to sit under the chart, past the y gutter */}
      <div className="relative ml-8 h-3 mt-0.5 text-[9px] tabular-nums text-zinc-500">
        {xTicks.map((t, i) => (
          <span key={i} className="absolute -translate-x-1/2" style={{ left: `${t.leftPct}%` }}>{t.label}</span>
        ))}
      </div>

      {/* Tooltip */}
      {marker != null && moves[marker] && (
        <div className="pointer-events-none absolute top-0 left-10 rounded-[2px] bg-zinc-800/90 px-2 py-0.5 text-[10px] font-mono text-zinc-200 tracking-tight">
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
