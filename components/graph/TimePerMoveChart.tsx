'use client';
import { useMemo, useState } from 'react';

// Time-per-move bar chart (chess.com/chessigma-style). Two-sided when both
// players have times: White bars grow up from the centre baseline, Black bars
// grow down — identity by position AND colour AND the axis chips, never
// colour-alone. Single-sided (blunderable: only the player's times exist)
// grows up from the bottom. Seconds labels on outliers only. Bars in
// time-trouble (clock under 10s after the move) go status-red.

export interface TimeBar {
  index: number;         // ply index in the caller's space
  seconds: number;
  side: 'w' | 'b';
  danger?: boolean;      // time trouble — status colour
  label: string;         // tooltip, e.g. "14. Qf3 — 126s"
}

const SIDE_COLOR: Record<'w' | 'b', string> = { w: '#d4d4d8', b: '#71717a' };
const DANGER = '#ef4444';

export function TimePerMoveChart({
  bars, maxIndex, currentIndex = null, onSelect,
}: {
  bars: TimeBar[];
  maxIndex: number;
  currentIndex?: number | null;
  onSelect?: (index: number) => void;
}) {
  const [hover, setHover] = useState<TimeBar | null>(null);
  const mirror = useMemo(() => bars.some((b) => b.side === 'b') && bars.some((b) => b.side === 'w'), [bars]);
  const maxS = Math.max(1, ...bars.map((b) => b.seconds));
  // Outlier labels: top ~2 slowest, and only when meaningfully slow.
  const labelled = useMemo(() => {
    const sorted = [...bars].sort((a, b) => b.seconds - a.seconds).slice(0, 2);
    return new Set(sorted.filter((b) => b.seconds >= Math.max(10, maxS * 0.6)).map((b) => b.index));
  }, [bars, maxS]);

  const W = 1000, H = mirror ? 160 : 110, PAD = 6;
  const baseline = mirror ? H / 2 : H - PAD;
  const slotW = (W - 2 * PAD) / Math.max(1, maxIndex + 1);
  const barW = Math.max(3, Math.min(14, slotW * 0.7));
  const scale = (s: number) => (s / maxS) * (mirror ? H / 2 - PAD - 12 : H - 2 * PAD - 14);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: mirror ? 72 : 52 }} preserveAspectRatio="none">
        <line x1={PAD} x2={W - PAD} y1={baseline} y2={baseline} stroke="#3f3f46" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {bars.map((b) => {
          const h = Math.max(2, scale(b.seconds));
          const up = !mirror || b.side === 'w';
          const cx = PAD + b.index * slotW + slotW / 2;
          const isCur = currentIndex === b.index;
          return (
            <g key={b.index}>
              <rect
                x={cx - barW / 2}
                y={up ? baseline - h : baseline}
                width={barW}
                height={h}
                rx={2}
                fill={b.danger ? DANGER : SIDE_COLOR[b.side]}
                opacity={hover && hover.index !== b.index ? 0.45 : isCur ? 1 : 0.9}
                stroke={isCur ? '#3b82f6' : 'none'}
                strokeWidth={isCur ? 1.5 : 0}
                vectorEffect="non-scaling-stroke"
              />
              {/* fatter invisible hit target */}
              <rect
                x={cx - slotW / 2} y={0} width={slotW} height={H} fill="transparent"
                className={onSelect ? 'cursor-pointer' : undefined}
                onPointerEnter={() => setHover(b)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onSelect?.(b.index)}
              />
            </g>
          );
        })}
      </svg>
      {/* outlier labels — HTML overlay so text doesn't stretch */}
      {bars.filter((b) => labelled.has(b.index)).map((b) => {
        const up = !mirror || b.side === 'w';
        return (
          <span
            key={b.index}
            className="absolute text-[9px] tabular-nums text-zinc-400 -translate-x-1/2 pointer-events-none"
            style={{
              left: `${((PAD + b.index * slotW + slotW / 2) / W) * 100}%`,
              ...(up ? { top: 0 } : { bottom: 0 }),
            }}
          >
            {Math.round(b.seconds)}s
          </span>
        );
      })}
      {mirror && (
        <div className="absolute top-0 right-0 flex gap-2 text-[9px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: SIDE_COLOR.w }} />W ↑</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: SIDE_COLOR.b }} />B ↓</span>
        </div>
      )}
      {hover && (
        <div
          className="absolute -top-1 -translate-y-full -translate-x-1/2 px-1.5 py-0.5 rounded-sm bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-200 whitespace-nowrap pointer-events-none z-10"
          style={{ left: `${((PAD + hover.index * slotW + slotW / 2) / W) * 100}%` }}
        >
          {hover.label}
        </div>
      )}
    </div>
  );
}
